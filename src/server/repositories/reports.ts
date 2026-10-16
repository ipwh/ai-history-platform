/**
 * 題目回報的資料存取（學生回報 → 教師覆核）。
 *
 * 回報只是「提示教師留意」，不會自動刪除或停用題目；
 * 教師可在教師端把回報標記為已處理或已略過。
 */
import { getDb, newId, nowIso } from "../db/connection";
import {
  questionReportSchema,
  questionReportStatusSchema,
  type QuestionReport,
  type QuestionReportStatus,
} from "../../lib/types";

interface ReportRow {
  id: string;
  question_id: string;
  session_id: string | null;
  attempt_id: string | null;
  learner_id: string;
  topic_id: string;
  reason: string;
  detail: string;
  status: string;
  question_revision: number | null;
  question_fingerprint: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_action: string | null;
}

function mapReport(row: ReportRow): QuestionReport {
  return questionReportSchema.parse({
    id: row.id,
    questionId: row.question_id,
    sessionId: row.session_id,
    attemptId: row.attempt_id ?? null,
    learnerId: row.learner_id,
    topicId: row.topic_id,
    reason: row.reason,
    detail: row.detail,
    status: questionReportStatusSchema.parse(row.status),
    questionRevision: row.question_revision ?? null,
    questionFingerprint: row.question_fingerprint ?? null,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    resolutionAction: row.resolution_action ?? null,
  });
}

export interface NewReportInput {
  questionId: string;
  sessionId: string | null;
  attemptId: string | null;
  learnerId: string;
  topicId: string;
  reason: string;
  detail: string;
  /** 回報時題目的版本及內容指紋（題目其後可能被修正，見 questions.revision） */
  questionRevision: number | null;
  questionFingerprint: string | null;
}

export function insertReport(input: NewReportInput): QuestionReport {
  const id = newId("report");
  getDb()
    .prepare(
      `INSERT INTO question_reports
        (id, question_id, session_id, attempt_id, learner_id, topic_id, reason, detail, status,
         question_revision, question_fingerprint, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    )
    .run(
      id,
      input.questionId,
      input.sessionId,
      input.attemptId,
      input.learnerId,
      input.topicId,
      input.reason,
      input.detail,
      input.questionRevision,
      input.questionFingerprint,
      nowIso(),
    );
  const created = getReport(id);
  if (!created) throw new Error("題目回報寫入失敗");
  return created;
}

export function getReport(reportId: string): QuestionReport | null {
  const row = getDb().prepare("SELECT * FROM question_reports WHERE id = ?").get(reportId) as unknown as
    | ReportRow
    | undefined;
  return row ? mapReport(row) : null;
}

export interface ReportFilter {
  statuses?: QuestionReportStatus[];
  topicId?: string;
  questionId?: string;
  learnerId?: string;
  limit?: number;
}

export function listReports(filter: ReportFilter = {}): QuestionReport[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filter.statuses && filter.statuses.length > 0) {
    conditions.push(`status IN (${filter.statuses.map(() => "?").join(", ")})`);
    params.push(...filter.statuses);
  }
  if (filter.topicId) {
    conditions.push("topic_id = ?");
    params.push(filter.topicId);
  }
  if (filter.questionId) {
    conditions.push("question_id = ?");
    params.push(filter.questionId);
  }
  if (filter.learnerId) {
    conditions.push("learner_id = ?");
    params.push(filter.learnerId);
  }

  const clause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const rows = getDb()
    .prepare(`SELECT * FROM question_reports ${clause} ORDER BY created_at DESC LIMIT ${limit}`)
    .all(...params) as unknown as ReportRow[];
  return rows.map(mapReport);
}

/** 未處理（待覆核）的回報數 */
export function countOpenReports(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS total FROM question_reports WHERE status = 'open'")
    .get() as unknown as { total: number } | undefined;
  return row?.total ?? 0;
}

/** 每題的未處理回報數（供教師端在題目上顯示「待覆核」） */
export function countOpenReportsByQuestion(questionIds: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  if (questionIds.length === 0) return counts;
  const placeholders = questionIds.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(
      `SELECT question_id, COUNT(*) AS total FROM question_reports
       WHERE status = 'open' AND question_id IN (${placeholders})
       GROUP BY question_id`,
    )
    .all(...questionIds) as unknown as { question_id: string; total: number }[];
  for (const row of rows) counts.set(row.question_id, row.total);
  return counts;
}

export function updateReportStatus(
  reportId: string,
  status: QuestionReportStatus,
  resolvedBy: string | null,
  resolutionAction: string | null = null,
): QuestionReport | null {
  const resolvedAt = status === "open" ? null : nowIso();
  getDb()
    .prepare(
      `UPDATE question_reports
         SET status = ?, resolved_at = ?, resolved_by = ?, resolution_action = ?
       WHERE id = ?`,
    )
    .run(
      status,
      resolvedAt,
      status === "open" ? null : resolvedBy,
      status === "open" ? null : resolutionAction,
      reportId,
    );
  return getReport(reportId);
}

/**
 * 該學習者是否已就**同一題目版本**回報過且仍未處理。
 *
 * 以版本為單位（見 migration 0019）：題目被修正後（新版本）學生可以再次回報，
 * 舊版本的回報不會阻止新版本的回報；同一版本的重複提交則不會產生新的回報，
 * 避免單一學生令回報量失控。
 */
export function hasOpenReport(questionId: string, learnerId: string, revision: number | null = null): boolean {
  const params: (string | number)[] = [questionId, learnerId];
  let clause = "";
  if (revision !== null) {
    clause = " AND (question_revision IS NULL OR question_revision = ?)";
    params.push(revision);
  }
  const row = getDb()
    .prepare(
      `SELECT id FROM question_reports
       WHERE question_id = ? AND learner_id = ? AND status = 'open'${clause} LIMIT 1`,
    )
    .get(...params);
  return row !== undefined;
}
