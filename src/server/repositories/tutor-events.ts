/**
 * 學伴澄清／離題／正規化事件的**匿名**記錄（append-only）。
 *
 * ── 為甚麼需要 ────────────────────────────────────────────────────────
 * 學伴的正規化規則（`services/tutor-query.ts`）是靠人手維護的有限規則表。要知道
 * 「下一條規則應該寫甚麼」，唯一可靠的方法是真實出現過的怪句。過去這些句子只留在
 * 記憶與使用者回報裡，於是規則更新憑印象。
 *
 * ── 私隱設計（不可放寬）──────────────────────────────────────────────
 *   1. **不存 learnerId、電郵、班別或學號**：這張表只為改進規則，不是學生監控。
 *      因此無法從事件追溯至任何一位學生（連「同一人問了幾次」都查不到）。
 *   2. 只存**截斷至 120 字**的句子預覽；不存模型回覆、教材節錄或外部參考。
 *   3. 只記錄 `reject`（固定拒答）、`clarify`（澄清）及 `normalize`（正規化有實際
 *      改寫）；正常歷史回答**不記錄**，以減少資料量及曝露面。
 *   4. 寫入失敗**永不可**影響學生的請求和回覆：呼叫方一律 `try/catch` 吞掉錯誤。
 *   5. 不會因記錄而扣除每日額度或預留 AI 用量（記錄與額度完全無關）。
 */
import { getDb, newId } from "../db/connection";
import type { TutorQueryEventType } from "../../lib/types";
import { hongKongTimestamp } from "../services/tutor";

/** 句子預覽上限（字符）；與規格一致 */
export const TUTOR_EVENT_PREVIEW_MAX_CHARS = 120;

export interface TutorQueryEvent {
  id: string;
  createdAt: string;
  eventType: TutorQueryEventType;
  rawPreview: string;
  normalizedPreview: string | null;
  hadSession: boolean;
}

interface TutorQueryEventRow {
  id: string;
  createdAt: string;
  eventType: string;
  rawPreview: string;
  normalizedPreview: string | null;
  hadSession: number;
}

/** 壓縮空白並截斷，避免把長題目或貼上的文章整段寫進事件表 */
export function tutorEventPreview(raw: string, maxChars = TUTOR_EVENT_PREVIEW_MAX_CHARS): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  return collapsed.length <= maxChars ? collapsed : `${collapsed.slice(0, maxChars)}…`;
}

export function recordTutorQueryEvent(input: {
  eventType: TutorQueryEventType;
  raw: string;
  normalized?: string | null;
  hadSession: boolean;
  createdAt?: string;
}): void {
  const rawPreview = tutorEventPreview(input.raw);
  if (rawPreview.length === 0) return;
  const normalized = input.normalized?.trim() ?? "";
  getDb()
    .prepare(
      `INSERT INTO tutor_query_events
         (id, createdAt, eventType, rawPreview, normalizedPreview, hadSession)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newId("tqev"),
      input.createdAt ?? hongKongTimestamp(),
      input.eventType,
      rawPreview,
      normalized.length > 0 ? tutorEventPreview(normalized) : null,
      input.hadSession ? 1 : 0,
    );
}

const EVENT_TYPES: readonly TutorQueryEventType[] = ["reject", "clarify", "normalize"];

function toEventType(value: string): TutorQueryEventType | null {
  return (EVENT_TYPES as readonly string[]).includes(value)
    ? (value as TutorQueryEventType)
    : null;
}

function mapEvent(row: TutorQueryEventRow): TutorQueryEvent | null {
  const eventType = toEventType(row.eventType);
  if (eventType === null) return null;
  return {
    id: row.id,
    createdAt: row.createdAt,
    eventType,
    rawPreview: row.rawPreview,
    normalizedPreview: row.normalizedPreview,
    hadSession: row.hadSession === 1,
  };
}

/** 匯出用：最近的事件（新到舊），可按類型及起始時間收窄 */
export function listTutorQueryEvents(options: {
  since?: string | null;
  limit?: number;
  eventTypes?: readonly TutorQueryEventType[];
} = {}): TutorQueryEvent[] {
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 500);
  const conditions: string[] = [];
  const params: string[] = [];
  if (options.since !== undefined && options.since !== null && options.since.length > 0) {
    conditions.push("createdAt >= ?");
    params.push(options.since);
  }
  if (options.eventTypes !== undefined && options.eventTypes.length > 0) {
    conditions.push(`eventType IN (${options.eventTypes.map(() => "?").join(", ")})`);
    params.push(...options.eventTypes);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = getDb()
    .prepare(
      `SELECT id, createdAt, eventType, rawPreview, normalizedPreview, hadSession
       FROM tutor_query_events
       ${where}
       ORDER BY createdAt DESC, rowid DESC
       LIMIT ?`,
    )
    .all(...params, limit) as unknown as TutorQueryEventRow[];
  return rows.flatMap((row) => {
    const event = mapEvent(row);
    return event === null ? [] : [event];
  });
}

/** 教師端統計用：每個事件類型的總數 */
export function countTutorQueryEventsSince(since: string): Record<TutorQueryEventType, number> {
  const rows = getDb()
    .prepare(
      `SELECT eventType, COUNT(*) AS total
       FROM tutor_query_events
       WHERE createdAt >= ?
       GROUP BY eventType`,
    )
    .all(since) as unknown as { eventType: string; total: number }[];
  const totals: Record<TutorQueryEventType, number> = { reject: 0, clarify: 0, normalize: 0 };
  for (const row of rows) {
    const eventType = toEventType(row.eventType);
    if (eventType !== null) totals[eventType] = Number(row.total);
  }
  return totals;
}

/** 教師端統計用：按日（香港時間）彙總的事件數 */
export function countTutorQueryEventsByDaySince(
  since: string,
): Map<string, Record<TutorQueryEventType, number>> {
  const rows = getDb()
    .prepare(
      `SELECT substr(createdAt, 1, 10) AS day, eventType, COUNT(*) AS total
       FROM tutor_query_events
       WHERE createdAt >= ?
       GROUP BY day, eventType`,
    )
    .all(since) as unknown as { day: string; eventType: string; total: number }[];
  const byDay = new Map<string, Record<TutorQueryEventType, number>>();
  for (const row of rows) {
    const eventType = toEventType(row.eventType);
    if (eventType === null) continue;
    const bucket = byDay.get(row.day) ?? { reject: 0, clarify: 0, normalize: 0 };
    bucket[eventType] = Number(row.total);
    byDay.set(row.day, bucket);
  }
  return byDay;
}
