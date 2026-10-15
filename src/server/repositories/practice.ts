/**
 * 練習記錄及作答的資料存取。
 * 每次練習會凍結當時的題目快照，確保之後重看結果時內容一致。
 */
import { getDb, nowIso, newId, toSqlBool, fromSqlBool } from "../db/connection";
import {
  aiGradingSchema,
  questionSchema,
  type AiGrading,
  type Difficulty,
  type PracticeMode,
  type PracticeSession,
  type Question,
  type QuestionType,
} from "../../lib/types";

interface SessionRow {
  id: string;
  learner_id: string;
  topic_id: string;
  section_ids_json: string;
  question_types_json: string;
  difficulty: string;
  question_count: number;
  mode: string;
  source_session_id: string | null;
  origin: string;
  question_snapshot_json: string;
  notice: string | null;
  created_at: string;
  completed_at: string | null;
}

interface AttemptRow {
  id: string;
  session_id: string;
  question_id: string;
  learner_id: string;
  answer: string;
  auto_graded: number;
  is_correct: number | null;
  self_assessment: string | null;
  answered_at: string;
  ai_grading_json: string | null;
  ai_verdict: string | null;
  uncertain: number | null;
}

export interface Attempt {
  id: string;
  sessionId: string;
  questionId: string;
  learnerId: string;
  answer: string;
  autoGraded: boolean;
  isCorrect: boolean | null;
  selfAssessment: "understood" | "needs-review" | null;
  answeredAt: string;
  /** AI 語意批改結果；未使用 AI 時為 null */
  aiGrading: AiGrading | null;
  /**
   * 填充題的答案與標準答案只差一個字（評分當時判定，不會隨題目之後的修改而改變）。
   * 這類答案不可當成正確，亦不可當成「明確學不懂」，進度及重溫佇列會分開處理。
   */
  uncertain: boolean;
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function mapSession(row: SessionRow): PracticeSession {
  return {
    id: row.id,
    learnerId: row.learner_id,
    topicId: row.topic_id,
    sectionIds: parseJsonArray(row.section_ids_json),
    questionTypes: parseJsonArray(row.question_types_json) as QuestionType[],
    difficulty: row.difficulty as Difficulty,
    questionCount: row.question_count,
    mode: row.mode as PracticeMode,
    sourceSessionId: row.source_session_id,
    origin: row.origin as PracticeSession["origin"],
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function mapAttempt(row: AttemptRow): Attempt {
  return {
    id: row.id,
    sessionId: row.session_id,
    questionId: row.question_id,
    learnerId: row.learner_id,
    answer: row.answer,
    autoGraded: fromSqlBool(row.auto_graded),
    isCorrect: row.is_correct === null ? null : fromSqlBool(row.is_correct),
    selfAssessment: (row.self_assessment as Attempt["selfAssessment"]) ?? null,
    answeredAt: row.answered_at,
    aiGrading: parseAiGrading(row.ai_grading_json),
    uncertain: row.uncertain === 1,
  };
}

/** 解析 attempts.ai_grading_json；格式不合時當作沒有 AI 批改結果 */
function parseAiGrading(value: string | null): AiGrading | null {
  if (!value) return null;
  try {
    const parsed = aiGradingSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface NewSessionInput {
  learnerId: string;
  topicId: string;
  sectionIds: string[];
  questionTypes: QuestionType[];
  difficulty: Difficulty;
  mode: PracticeMode;
  sourceSessionId: string | null;
  origin: PracticeSession["origin"];
  questions: Question[];
  notice: string | null;
}

export function createSession(input: NewSessionInput): PracticeSession {
  const id = newId("sess");
  getDb()
    .prepare(
      `INSERT INTO practice_sessions
       (id, learner_id, topic_id, section_ids_json, question_types_json, difficulty, question_count,
        mode, source_session_id, origin, question_snapshot_json, notice, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      id,
      input.learnerId,
      input.topicId,
      JSON.stringify(input.sectionIds),
      JSON.stringify(input.questionTypes),
      input.difficulty,
      input.questions.length,
      input.mode,
      input.sourceSessionId,
      input.origin,
      JSON.stringify(input.questions),
      input.notice,
      nowIso(),
    );
  const session = getSession(id);
  if (!session) throw new Error("練習記錄建立失敗");
  return session;
}

export function getSession(sessionId: string): PracticeSession | null {
  const row = getDb().prepare("SELECT * FROM practice_sessions WHERE id = ?").get(sessionId) as
    | unknown as SessionRow
    | undefined;
  return row ? mapSession(row) : null;
}

export function getSessionNotice(sessionId: string): string | null {
  const row = getDb()
    .prepare("SELECT notice FROM practice_sessions WHERE id = ?")
    .get(sessionId) as unknown as { notice: string | null } | undefined;
  return row?.notice ?? null;
}

/** 取得練習快照中的題目（學生作答及結果頁都以此為準） */
export function getSessionQuestions(sessionId: string): Question[] {
  const row = getDb()
    .prepare("SELECT question_snapshot_json FROM practice_sessions WHERE id = ?")
    .get(sessionId) as unknown as { question_snapshot_json: string } | undefined;
  if (!row) return [];
  try {
    const parsed: unknown = JSON.parse(row.question_snapshot_json);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => questionSchema.parse(item));
  } catch {
    return [];
  }
}

export function markSessionCompleted(sessionId: string): void {
  getDb()
    .prepare("UPDATE practice_sessions SET completed_at = ? WHERE id = ? AND completed_at IS NULL")
    .run(nowIso(), sessionId);
}

export function deleteSession(sessionId: string): void {
  getDb().prepare("DELETE FROM practice_sessions WHERE id = ?").run(sessionId);
}

export function listSessionsByLearner(learnerId: string, topicId?: string): PracticeSession[] {
  const db = getDb();
  const rows = (
    topicId
      ? db
          .prepare(
            "SELECT * FROM practice_sessions WHERE learner_id = ? AND topic_id = ? ORDER BY created_at DESC",
          )
          .all(learnerId, topicId)
      : db
          .prepare("SELECT * FROM practice_sessions WHERE learner_id = ? ORDER BY created_at DESC")
          .all(learnerId)
  ) as unknown as SessionRow[];
  return rows.map(mapSession);
}

export function saveAttempt(input: {
  sessionId: string;
  questionId: string;
  learnerId: string;
  answer: string;
  autoGraded: boolean;
  isCorrect: boolean | null;
  selfAssessment?: "understood" | "needs-review" | null;
  aiGrading?: AiGrading | null;
  /** 填充題的答案與標準答案只差一個字（見 Attempt.uncertain） */
  uncertain?: boolean;
}): Attempt {
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM attempts WHERE session_id = ? AND question_id = ?")
    .get(input.sessionId, input.questionId) as unknown as AttemptRow | undefined;
  const timestamp = nowIso();
  const aiGradingJson = input.aiGrading ? JSON.stringify(input.aiGrading) : null;
  const aiVerdict = input.aiGrading?.verdict ?? null;

  if (existing) {
    db.prepare(
      `UPDATE attempts SET answer = ?, auto_graded = ?, is_correct = ?, self_assessment = ?, answered_at = ?,
         ai_grading_json = COALESCE(?, ai_grading_json), ai_verdict = COALESCE(?, ai_verdict),
         uncertain = ?
       WHERE id = ?`,
    ).run(
      input.answer,
      toSqlBool(input.autoGraded),
      input.isCorrect === null ? null : toSqlBool(input.isCorrect),
      input.selfAssessment ?? existing.self_assessment,
      timestamp,
      aiGradingJson,
      aiVerdict,
      input.uncertain === true ? 1 : (existing.uncertain ?? 0),
      existing.id,
    );
    const updated = db.prepare("SELECT * FROM attempts WHERE id = ?").get(existing.id) as unknown as
      | AttemptRow
      | undefined;
    if (!updated) throw new Error("作答記錄更新失敗");
    return mapAttempt(updated);
  }

  const id = newId("att");
  db.prepare(
    `INSERT INTO attempts
     (id, session_id, question_id, learner_id, answer, auto_graded, is_correct, self_assessment, answered_at,
      ai_grading_json, ai_verdict, uncertain)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.sessionId,
    input.questionId,
    input.learnerId,
    input.answer,
    toSqlBool(input.autoGraded),
    input.isCorrect === null ? null : toSqlBool(input.isCorrect),
    input.selfAssessment ?? null,
    timestamp,
    aiGradingJson,
    aiVerdict,
    input.uncertain === true ? 1 : 0,
  );
  const created = db.prepare("SELECT * FROM attempts WHERE id = ?").get(id) as unknown as
    | AttemptRow
    | undefined;
  if (!created) throw new Error("作答記錄寫入失敗");
  return mapAttempt(created);
}

export function listAttempts(sessionId: string): Attempt[] {
  const rows = getDb()
    .prepare("SELECT * FROM attempts WHERE session_id = ? ORDER BY answered_at ASC")
    .all(sessionId) as unknown as AttemptRow[];
  return rows.map(mapAttempt);
}

export function getAttempt(sessionId: string, questionId: string): Attempt | null {
  const row = getDb()
    .prepare("SELECT * FROM attempts WHERE session_id = ? AND question_id = ?")
    .get(sessionId, questionId) as unknown as AttemptRow | undefined;
  return row ? mapAttempt(row) : null;
}

/** 取得某學習者答錯過的題目 ID（可用於「針對錯題再練習」） */
export interface WrongAttemptRef {
  sessionId: string;  questionId: string;
  answeredAt: string;
}

/**
 * 需要重做的作答記錄。
 *
 * 只查 attempts，不連結 questions 表：即時生成的題目即使不在題庫中，
 * 只要仍在練習快照內，學生也可以重做錯題。
 *
 * 需要重做的情況：自動評分答錯、短答題自我標記「需要重溫」，或 AI 語意批改判定未達到要求。
 */
export function listWrongAttempts(options: {
  learnerId: string;
  topicId: string;
  sourceSessionId?: string | null;
}): WrongAttemptRef[] {
  const db = getDb();
  const params: (string | number)[] = [options.learnerId, options.topicId];
  let clause = "";
  if (options.sourceSessionId) {
    clause += " AND a.session_id = ?";
    params.push(options.sourceSessionId);
  }

  const rows = db
    .prepare(
      `SELECT a.session_id AS sessionId, a.question_id AS questionId, a.answered_at AS answeredAt
       FROM attempts a
       JOIN practice_sessions s ON s.id = a.session_id
       WHERE a.learner_id = ? AND s.topic_id = ?
         AND (a.is_correct = 0 OR a.self_assessment = 'needs-review' OR a.ai_verdict = 'incorrect')${clause}
       ORDER BY a.answered_at DESC`,
    )
    .all(...params) as unknown as WrongAttemptRef[];
  return rows;
}

/** 教師端學習記錄的篩選條件；日期以本地日期字串（YYYY-MM-DD）表示 */
export interface SessionRecordFilter {
  learnerId?: string | null;
  topicId?: string | null;
  /** 起始日期（含當日） */
  from?: string | null;
  /** 結束日期（含當日） */
  to?: string | null;
  limit?: number;
}

/** 教師端查閱用的練習記錄清單（最新在前，可依學習者、課題及日期篩選） */
export function listSessionsForRecords(filter: SessionRecordFilter = {}): PracticeSession[] {
  const conditions: string[] = [];
  const params: string[] = [];

  if (filter.learnerId) {
    conditions.push("learner_id = ?");
    params.push(filter.learnerId);
  }
  if (filter.topicId) {
    conditions.push("topic_id = ?");
    params.push(filter.topicId);
  }
  // created_at 為 ISO 字串，取前 10 個字元即日期部分，可直接作字串比較
  if (filter.from) {
    conditions.push("substr(created_at, 1, 10) >= ?");
    params.push(filter.from);
  }
  if (filter.to) {
    conditions.push("substr(created_at, 1, 10) <= ?");
    params.push(filter.to);
  }

  const clause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 500, 1), 2000);
  const rows = getDb()
    .prepare(`SELECT * FROM practice_sessions ${clause} ORDER BY created_at DESC LIMIT ${limit}`)
    .all(...params) as unknown as SessionRow[];
  return rows.map(mapSession);
}

/** 教師端查閱用：列出所有曾作答的學習者（最新記錄在前，不重複） */
export function listRecordLearners(): { learnerId: string; lastAt: string; sessions: number }[] {
  return getDb()
    .prepare(
      `SELECT learner_id AS learnerId, MAX(created_at) AS lastAt, COUNT(*) AS sessions
       FROM practice_sessions
       GROUP BY learner_id
       ORDER BY lastAt DESC`,
    )
    .all() as unknown as { learnerId: string; lastAt: string; sessions: number }[];
}

/** 學習進度及重溫排程使用的作答記錄（已連結題庫題目） */
export interface LearnerQuestionAttempt {
  questionId: string;
  topicId: string;
  sectionId: string;
  /** 題目標示的歷史技能（可能是 null 或不在 HISTORY_SKILLS 內的舊值） */
  skill: string | null;
  answeredAt: string;
  isCorrect: boolean | null;
  /** 填充題的近似答案（不確定），不可當成正確或明確錯誤 */
  uncertain: boolean;
}

/**
 * 取得某學習者已作答的**已發布題庫題目**記錄（用於進度及重溫排程）。
 *
 * 刻意使用 INNER JOIN questions 並限定 `status = 'published'`：
 *   - 學生即時生成（只存在於練習快照、未寫入題庫）的題目不計入進度，
 *     因為它們從未經教師核對，不應成為學習成果的證據；
 *   - 草稿、已停用（retired）及已刪除的題目同樣不會出現；
 *   - 題目之後被停用時，其歷史作答記錄亦不會再計入進度（不會洩漏內容）。
 *
 * 查詢以 `s.learner_id` 為準（由伺服器端的工作階段推導），不存在跨學生存取的途徑。
 */
export function listPublishedAttemptsForLearner(
  learnerId: string,
  topicId?: string,
): LearnerQuestionAttempt[] {
  const params: string[] = [learnerId];
  let clause = "";
  if (topicId) {
    clause = " AND s.topic_id = ?";
    params.push(topicId);
  }

  const rows = getDb()
    .prepare(
      `SELECT a.question_id AS questionId, q.topic_id AS topicId, q.section_id AS sectionId,
              q.skill AS skill, a.answered_at AS answeredAt, a.is_correct AS isCorrect,
              a.uncertain AS uncertain
       FROM attempts a
       JOIN practice_sessions s ON s.id = a.session_id
       JOIN questions q ON q.id = a.question_id
       WHERE s.learner_id = ? AND q.status = 'published'${clause}
       ORDER BY a.answered_at ASC, a.id ASC`,
    )
    .all(...params) as unknown as {
    questionId: string;
    topicId: string;
    sectionId: string;
    skill: string | null;
    answeredAt: string;
    isCorrect: number | null;
    uncertain: number | null;
  }[];

  return rows.map((row) => ({
    questionId: row.questionId,
    topicId: row.topicId,
    sectionId: row.sectionId,
    skill: row.skill,
    answeredAt: row.answeredAt,
    isCorrect: row.isCorrect === null ? null : row.isCorrect === 1,
    uncertain: row.uncertain === 1,
  }));
}

/** 某課題內已發布題目的數量及技能分佈（進度的分母） */
export function listPublishedQuestionsForProgress(
  topicId: string,
): { id: string; sectionId: string; skill: string | null }[] {
  return getDb()
    .prepare(
      "SELECT id, section_id AS sectionId, skill FROM questions WHERE topic_id = ? AND status = 'published'",
    )
    .all(topicId) as unknown as { id: string; sectionId: string; skill: string | null }[];
}
