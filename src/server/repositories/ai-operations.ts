/**
 * AI 用量保留記錄的資料存取。
 *
 * 只儲存學習者 ID、操作類別及時間，不儲存題目內容、學生答案或任何個人資料，
 * 因此可用於用量統計而不會增加私隱風險。
 */
import { getDb, newId, nowIso } from "../db/connection";

export type AiOperationKind = "generation" | "grading";

interface AiOperationRow {
  total: number;
}

/** 記錄一次 AI 操作（在呼叫模型之前寫入，作為用量保留） */
export function recordAiOperation(learnerId: string, kind: AiOperationKind): void {
  getDb()
    .prepare("INSERT INTO ai_operations (id, learner_id, kind, created_at) VALUES (?, ?, ?, ?)")
    .run(newId("aiop"), learnerId, kind, nowIso());
}

/** 時間窗內某類操作（或所有操作）的次數 */
export function countOperationsSince(kind: AiOperationKind | null, sinceIso: string): number {
  const row = (
    kind === null
      ? getDb()
          .prepare("SELECT COUNT(*) AS total FROM ai_operations WHERE created_at >= ?")
          .get(sinceIso)
      : getDb()
          .prepare("SELECT COUNT(*) AS total FROM ai_operations WHERE kind = ? AND created_at >= ?")
          .get(kind, sinceIso)
  ) as unknown as AiOperationRow | undefined;
  return row?.total ?? 0;
}

/** 目前儲存的用量記錄筆數（供保留期管理顯示） */
export function countStoredOperations(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS total FROM ai_operations")
    .get() as unknown as AiOperationRow | undefined;
  return row?.total ?? 0;
}

/** 時間窗內某位學習者的操作次數 */
export function countRecentOperationsForLearner(
  learnerId: string,
  kind: AiOperationKind,
  sinceIso: string,
): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS total FROM ai_operations
       WHERE learner_id = ? AND kind = ? AND created_at >= ?`,
    )
    .get(learnerId, kind, sinceIso) as unknown as AiOperationRow | undefined;
  return row?.total ?? 0;
}

/** 時間窗內所有使用者的操作次數 */
export function countRecentOperations(kind: AiOperationKind, sinceIso: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS total FROM ai_operations WHERE kind = ? AND created_at >= ?")
    .get(kind, sinceIso) as unknown as AiOperationRow | undefined;
  return row?.total ?? 0;
}

/** 刪除時間窗以前的記錄（避免表格無限增長；由呼叫端決定何時執行） */
export function purgeOperationsBefore(cutoffIso: string): number {
  const result = getDb().prepare("DELETE FROM ai_operations WHERE created_at < ?").run(cutoffIso);
  return Number(result.changes ?? 0);
}
