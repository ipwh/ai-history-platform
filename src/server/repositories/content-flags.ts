/**
 * 內容改進標記的資料存取（只可新增）。
 *
 * 這個 repository **沒有** update／delete：標記歷史不可覆寫，解除標記是新增一個
 * `state = "cleared"` 的事件（與 `question_reviews` 的處理方式一致）。
 */
import { getDb, newId, nowIso } from "../db/connection";
import {
  CONTENT_FLAGS,
  type ContentFlag,
  type ContentFlagEvent,
  type ContentFlagState,
} from "../quality/content-flags";

interface ContentFlagRow {
  id: string;
  question_id: string;
  revision: number;
  question_fingerprint: string;
  flag: string;
  state: string;
  reason: string;
  actor_email: string;
  actor_role: string;
  created_at: string;
}

function mapEvent(row: ContentFlagRow): ContentFlagEvent {
  return {
    id: row.id,
    questionId: row.question_id,
    revision: row.revision,
    questionFingerprint: row.question_fingerprint,
    flag: row.flag as ContentFlag,
    state: row.state as ContentFlagState,
    reason: row.reason,
    actorEmail: row.actor_email,
    actorRole: row.actor_role,
    createdAt: row.created_at,
  };
}

export interface InsertContentFlagInput {
  questionId: string;
  revision: number;
  questionFingerprint: string;
  flag: ContentFlag;
  state: ContentFlagState;
  reason: string;
  actorEmail: string;
  actorRole: string;
}

/**
 * 新增一個標記事件。
 *
 * 冪等：同一題、同一版本、同一內容指紋、同一標記的同一個決定只會寫入一次；
 * 重複提交回傳 `created: false`（與 `question_reviews` 的重複提交處理一致）。
 */
export function insertContentFlagEvent(
  input: InsertContentFlagInput,
): { event: ContentFlagEvent; created: boolean } {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT * FROM question_content_flags
        WHERE question_id = ? AND revision = ? AND question_fingerprint = ? AND flag = ? AND state = ?
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(
      input.questionId,
      input.revision,
      input.questionFingerprint,
      input.flag,
      input.state,
    ) as unknown as ContentFlagRow | undefined;
  if (existing) return { event: mapEvent(existing), created: false };

  const row: ContentFlagRow = {
    id: newId("qcf"),
    question_id: input.questionId,
    revision: input.revision,
    question_fingerprint: input.questionFingerprint,
    flag: input.flag,
    state: input.state,
    reason: input.reason,
    actor_email: input.actorEmail,
    actor_role: input.actorRole,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO question_content_flags
       (id, question_id, revision, question_fingerprint, flag, state, reason, actor_email, actor_role, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.question_id,
    row.revision,
    row.question_fingerprint,
    row.flag,
    row.state,
    row.reason,
    row.actor_email,
    row.actor_role,
    row.created_at,
  );
  return { event: mapEvent(row), created: true };
}

/**
 * 讀取標記事件（按時間由舊至新，方便推導現行狀態）。
 *
 * `questionIds` 有值時只讀取指定題目，避免把 1,800+ 題的全部事件送到不必要的路徑。
 */
export function listContentFlagEvents(filter: {
  questionIds?: string[];
  flag?: ContentFlag;
} = {}): ContentFlagEvent[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (filter.questionIds) {
    if (filter.questionIds.length === 0) return [];
    conditions.push(`question_id IN (${filter.questionIds.map(() => "?").join(", ")})`);
    params.push(...filter.questionIds);
  }
  if (filter.flag) {
    conditions.push("flag = ?");
    params.push(filter.flag);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT * FROM question_content_flags ${where} ORDER BY created_at ASC, id ASC`,
    )
    .all(...params) as unknown as ContentFlagRow[];
  return rows.map(mapEvent);
}

/** 目前 open 標記的題目數（按標記分組；不計已解除的事件） */
export function countLatestFlagsByFlag(): Record<ContentFlag, number> {
  const db = getDb();
  const counts = Object.fromEntries(CONTENT_FLAGS.map((flag) => [flag, 0])) as Record<
    ContentFlag,
    number
  >;
  const rows = db
    .prepare(
      `SELECT flag, state FROM question_content_flags AS event
        WHERE id = (
          SELECT id FROM question_content_flags AS latest
           WHERE latest.question_id = event.question_id AND latest.flag = event.flag
           ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
        )`,
    )
    .all() as unknown as { flag: string; state: string }[];
  for (const row of rows) {
    if (row.state !== "open") continue;
    if (!(row.flag in counts)) continue;
    counts[row.flag as ContentFlag] += 1;
  }
  return counts;
}
