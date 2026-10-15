/**
 * 題目的資料存取。題目一律經過 zod schema 驗證後才寫入／讀出。
 */
import { getDb, nowIso, toSqlBool, fromSqlBool } from "../db/connection";
import {
  questionReviewSchema,
  questionSchema,
  type Difficulty,
  type Question,
  type QuestionOrigin,
  type QuestionReview,
  type QuestionReviewDecision,
  type QuestionStatus,
  type QuestionType,
} from "../../lib/types";

interface QuestionRow {
  id: string;
  topic_id: string;
  section_id: string;
  question_type: string;
  difficulty: string;
  question: string;
  options_json: string;
  correct_answer: string;
  accepted_answers_json: string;
  explanation: string;
  knowledge_point: string;
  source_excerpt: string;
  source_location: string;
  source_block_ids_json: string;
  grading_points_json: string;
  origin: string;
  status: string;
  source_verified: number;
  quality_warnings_json: string | null;
  skill: string | null;
  revision: number | null;
  created_at: string;
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function mapQuestion(row: QuestionRow): Question {
  return questionSchema.parse({
    id: row.id,
    topicId: row.topic_id,
    sectionId: row.section_id,
    questionType: row.question_type as QuestionType,
    difficulty: row.difficulty as Difficulty,
    question: row.question,
    options: parseJsonArray(row.options_json),
    correctAnswer: row.correct_answer,
    acceptedAnswers: parseJsonArray(row.accepted_answers_json),
    explanation: row.explanation,
    knowledgePoint: row.knowledge_point,
    sourceExcerpt: row.source_excerpt,
    sourceLocation: row.source_location,
    sourceBlockIds: parseJsonArray(row.source_block_ids_json),
    gradingPoints: parseJsonArray(row.grading_points_json),
    origin: row.origin as QuestionOrigin,
    status: row.status as QuestionStatus,
    sourceVerified: fromSqlBool(row.source_verified),
    qualityWarnings: parseJsonArray(row.quality_warnings_json),
    skill: row.skill ?? null,
    // 舊資料庫在 migration 0015 之前的列不會有 revision（回報 null）時視為第 1 版
    revision: row.revision ?? 1,
    createdAt: row.created_at,
  });
}

export interface QuestionFilter {
  topicId?: string;
  sectionIds?: string[];
  questionTypes?: QuestionType[];
  difficulties?: Difficulty[];
  statuses?: QuestionStatus[];
  origins?: QuestionOrigin[];
  ids?: string[];
}

function buildWhere(filter: QuestionFilter): { clause: string; params: (string | number)[] } {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filter.topicId) {
    conditions.push("topic_id = ?");
    params.push(filter.topicId);
  }
  if (filter.sectionIds && filter.sectionIds.length > 0) {
    conditions.push(`section_id IN (${filter.sectionIds.map(() => "?").join(", ")})`);
    params.push(...filter.sectionIds);
  }
  if (filter.questionTypes && filter.questionTypes.length > 0) {
    conditions.push(`question_type IN (${filter.questionTypes.map(() => "?").join(", ")})`);
    params.push(...filter.questionTypes);
  }
  if (filter.difficulties && filter.difficulties.length > 0) {
    conditions.push(`difficulty IN (${filter.difficulties.map(() => "?").join(", ")})`);
    params.push(...filter.difficulties);
  }
  if (filter.statuses && filter.statuses.length > 0) {
    conditions.push(`status IN (${filter.statuses.map(() => "?").join(", ")})`);
    params.push(...filter.statuses);
  }
  if (filter.origins && filter.origins.length > 0) {
    conditions.push(`origin IN (${filter.origins.map(() => "?").join(", ")})`);
    params.push(...filter.origins);
  }
  if (filter.ids && filter.ids.length > 0) {
    conditions.push(`id IN (${filter.ids.map(() => "?").join(", ")})`);
    params.push(...filter.ids);
  }

  return { clause: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

export function listQuestions(filter: QuestionFilter = {}): Question[] {
  const { clause, params } = buildWhere(filter);
  const rows = getDb()
    .prepare(`SELECT * FROM questions ${clause} ORDER BY section_id ASC, created_at ASC`)
    .all(...params) as unknown as QuestionRow[];
  return rows.map(mapQuestion);
}

export function getQuestion(questionId: string): Question | null {
  const row = getDb().prepare("SELECT * FROM questions WHERE id = ?").get(questionId) as unknown as
    | QuestionRow
    | undefined;
  return row ? mapQuestion(row) : null;
}

export function countQuestions(filter: QuestionFilter = {}): number {
  const { clause, params } = buildWhere(filter);
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS total FROM questions ${clause}`)
    .get(...params) as unknown as { total: number } | undefined;
  return row?.total ?? 0;
}

/** 統計各狀態的題目數（供教師儀表板使用，避免逐個狀態查詢） */
export function countQuestionsByStatus(): Record<QuestionStatus, number> & { total: number } {
  const rows = getDb()
    .prepare("SELECT status, COUNT(*) AS total FROM questions GROUP BY status")
    .all() as unknown as { status: string; total: number }[];
  const counts = { draft: 0, published: 0, disabled: 0, total: 0 };
  for (const row of rows) {
    const status = row.status as QuestionStatus;
    if (status in counts) counts[status] = row.total;
    counts.total += row.total;
  }
  return counts;
}

/** 未通過教材依據核對的題目數（教材重新匯入後可能出現，需教師處理） */
export function countUnverifiedQuestions(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS total FROM questions WHERE source_verified = 0")
    .get() as unknown as { total: number } | undefined;
  return row?.total ?? 0;
}

/**
 * 未通過教材依據核對、且**應該**有教材依據的題目數。
 *
 * 校內試題（`origin = school-paper`）的來源是試卷本身而非教材段落，
 * 本來就沒有教材依據，不應計入「未通過核對」，否則教師儀表板會顯示
 * 大量假警報（例如全部校內試題都被標示為未通過）。
 */
export function countUnverifiedQuestionsNeedingReview(): number {
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) AS total FROM questions WHERE source_verified = 0 AND origin <> 'school-paper'",
    )
    .get() as unknown as { total: number } | undefined;
  return row?.total ?? 0;
}

/** 校內試題（來源為試卷）的題目數，供教師核對進度參考 */
export function countSchoolPaperQuestions(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS total FROM questions WHERE origin = 'school-paper'")
    .get() as unknown as { total: number } | undefined;
  return row?.total ?? 0;
}

export function insertQuestion(question: Question): Question {
  const parsed = questionSchema.parse(question);
  getDb()
    .prepare(
      `INSERT INTO questions
       (id, topic_id, section_id, question_type, difficulty, question, options_json, correct_answer,
        accepted_answers_json, explanation, knowledge_point, source_excerpt, source_location,
        source_block_ids_json, grading_points_json, origin, status, source_verified,
        quality_warnings_json, skill, revision, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      parsed.id,
      parsed.topicId,
      parsed.sectionId,
      parsed.questionType,
      parsed.difficulty,
      parsed.question,
      JSON.stringify(parsed.options),
      parsed.correctAnswer,
      JSON.stringify(parsed.acceptedAnswers),
      parsed.explanation,
      parsed.knowledgePoint,
      parsed.sourceExcerpt,
      parsed.sourceLocation,
      JSON.stringify(parsed.sourceBlockIds),
      JSON.stringify(parsed.gradingPoints),
      parsed.origin,
      parsed.status,
      toSqlBool(parsed.sourceVerified),
      JSON.stringify(parsed.qualityWarnings),
      parsed.skill,
      parsed.revision,
      parsed.createdAt,
    );
  const created = getQuestion(parsed.id);
  if (!created) throw new Error("題目寫入失敗");
  return created;
}

export function updateQuestion(questionId: string, question: Question): Question {
  const parsed = questionSchema.parse({ ...question, id: questionId });
  getDb()
    .prepare(
      `UPDATE questions SET topic_id = ?, section_id = ?, question_type = ?, difficulty = ?,
        question = ?, options_json = ?, correct_answer = ?, accepted_answers_json = ?,
        explanation = ?, knowledge_point = ?, source_excerpt = ?, source_location = ?,
        source_block_ids_json = ?, grading_points_json = ?, origin = ?, status = ?,
        source_verified = ?, quality_warnings_json = ?, skill = ?,
        revision = revision + 1 WHERE id = ?`,
    )
    .run(
      parsed.topicId,
      parsed.sectionId,
      parsed.questionType,
      parsed.difficulty,
      parsed.question,
      JSON.stringify(parsed.options),
      parsed.correctAnswer,
      JSON.stringify(parsed.acceptedAnswers),
      parsed.explanation,
      parsed.knowledgePoint,
      parsed.sourceExcerpt,
      parsed.sourceLocation,
      JSON.stringify(parsed.sourceBlockIds),
      JSON.stringify(parsed.gradingPoints),
      parsed.origin,
      parsed.status,
      toSqlBool(parsed.sourceVerified),
      JSON.stringify(parsed.qualityWarnings),
      parsed.skill,
      questionId,
    );
  const updated = getQuestion(questionId);
  if (!updated) throw new Error("題目更新失敗");
  return updated;
}

export function setQuestionStatus(questionId: string, status: QuestionStatus): Question | null {
  getDb().prepare("UPDATE questions SET status = ? WHERE id = ?").run(status, questionId);
  return getQuestion(questionId);
}

export function deleteQuestion(questionId: string): void {
  getDb().prepare("DELETE FROM questions WHERE id = ?").run(questionId);
}

export function deleteQuestionsByOrigin(origin: QuestionOrigin): void {
  getDb().prepare("DELETE FROM questions WHERE origin = ?").run(origin);
}

export function knowledgePointExists(topicId: string, knowledgePoint: string): boolean {
  const row = getDb()
    .prepare(
      "SELECT id FROM questions WHERE topic_id = ? AND knowledge_point = ? AND status != 'disabled' LIMIT 1",
    )
    .get(topicId, knowledgePoint);
  return row !== undefined;
}

export function createdAtNow(): string {
  return nowIso();
}

/* ------------------------------------------------------------------ */
/* 人工覆核紀錄                                                        */
/* ------------------------------------------------------------------ */

interface QuestionReviewRow {
  id: string;
  question_id: string;
  revision: number;
  decision: string;
  reason: string | null;
  reviewer_email: string;
  reviewer_role: string;
  question_fingerprint: string;
  created_at: string;
}

function mapReview(row: QuestionReviewRow): QuestionReview {
  return questionReviewSchema.parse({
    id: row.id,
    questionId: row.question_id,
    revision: row.revision,
    decision: row.decision,
    reason: row.reason,
    reviewerEmail: row.reviewer_email,
    reviewerRole: row.reviewer_role,
    questionFingerprint: row.question_fingerprint,
    createdAt: row.created_at,
  });
}

/**
 * 新增一筆人工覆核紀錄。
 *
 * 使用 `INSERT ... ON CONFLICT DO NOTHING` 配合唯一索引，令重試或重複提交
 * 同一決定時**不會**產生重複事件（冪等）；回傳值指出這次是否真的寫入了新紀錄，
 * 讓呼叫端可以如實回應「已記錄」或「先前已記錄相同決定」，而不是假裝成功兩次。
 */
export function insertQuestionReview(input: {
  id: string;
  questionId: string;
  revision: number;
  decision: QuestionReviewDecision;
  reason: string | null;
  reviewerEmail: string;
  reviewerRole: string;
  questionFingerprint: string;
  createdAt: string;
}): { review: QuestionReview; created: boolean } {
  const result = getDb()
    .prepare(
      `INSERT INTO question_reviews
       (id, question_id, revision, decision, reason, reviewer_email, reviewer_role,
        question_fingerprint, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (question_id, revision, decision, question_fingerprint) DO NOTHING`,
    )
    .run(
      input.id,
      input.questionId,
      input.revision,
      input.decision,
      input.reason,
      input.reviewerEmail,
      input.reviewerRole,
      input.questionFingerprint,
      input.createdAt,
    );

  const existing = getDb()
    .prepare(
      `SELECT * FROM question_reviews
       WHERE question_id = ? AND revision = ? AND decision = ? AND question_fingerprint = ?
       LIMIT 1`,
    )
    .get(input.questionId, input.revision, input.decision, input.questionFingerprint) as unknown as
    | QuestionReviewRow
    | undefined;
  if (!existing) throw new Error("覆核紀錄寫入失敗");

  return { review: mapReview(existing), created: Number(result.changes ?? 0) > 0 };
}

/** 某題的覆核紀錄（最新在前） */
export function listQuestionReviews(questionId: string, limit = 20): QuestionReview[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM question_reviews WHERE question_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(questionId, limit) as unknown as QuestionReviewRow[];
  return rows.map(mapReview);
}

/** 一次取得多題的最新覆核紀錄（避免為每題單獨查詢） */
export function listLatestReviews(questionIds: string[]): Map<string, QuestionReview> {
  const latest = new Map<string, QuestionReview>();
  if (questionIds.length === 0) return latest;
  const placeholders = questionIds.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(
      `SELECT * FROM question_reviews WHERE question_id IN (${placeholders})
       ORDER BY created_at ASC, rowid ASC`,
    )
    .all(...questionIds) as unknown as QuestionReviewRow[];
  for (const row of rows) {
    // 依時間升序走訪，最後寫入的即為最新一筆
    latest.set(row.question_id, mapReview(row));
  }
  return latest;
}

/** 針對「指定版本」且決定為 approved 的覆核紀錄 */
export function findApprovedReview(
  questionId: string,
  revision: number,
  questionFingerprint: string,
): QuestionReview | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM question_reviews
       WHERE question_id = ? AND revision = ? AND decision = 'approved' AND question_fingerprint = ?
       LIMIT 1`,
    )
    .get(questionId, revision, questionFingerprint) as unknown as QuestionReviewRow | undefined;
  return row ? mapReview(row) : null;
}

/** 任何已通過的覆核（用於判斷「曾經覆核，但內容已改」的情況） */
export function findAnyApprovedReview(questionId: string): QuestionReview | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM question_reviews WHERE question_id = ? AND decision = 'approved'
       ORDER BY revision DESC, created_at DESC LIMIT 1`,
    )
    .get(questionId) as unknown as QuestionReviewRow | undefined;
  return row ? mapReview(row) : null;
}

/** 覆核紀錄總數（供教師端顯示覆核進度；不會回傳任何學生資料） */
export function countQuestionReviews(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS total FROM question_reviews")
    .get() as unknown as { total: number } | undefined;
  return row?.total ?? 0;
}
