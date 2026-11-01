/**
 * 教師端「學伴使用概況」（只讀聚合統計）。
 *
 * ── 為甚麼只有數字 ────────────────────────────────────────────────────
 * 教師需要知道「學伴有沒有被用、有沒有常常離題、澄清是否過多」，但**不需要**
 * （亦不應該）在後台逐句閱讀學生的對話。本模組因此只回傳按日彙總的計數，
 * 回應物件固定帶 `contentIncluded: false`，令前端、測試及日後的審核都能直接
 * 確認「沒有回傳任何訊息內容」。
 *
 * 抽樣檢視（需要另設權限、保留期限及去識別化）屬 P1，本輪**沒有**實作；
 * 教師若需要個別跟進，可請學生自行提供對話，或由管理員依既有程序處理。
 *
 * ── 語意 ──────────────────────────────────────────────────────────────
 *   - `answered`：assistant 回覆且 `groundingStatus` 為 `grounded`／`not-covered`
 *     （即成功回答；離題固定句及舊資料不計）；
 *   - `offTopic`：assistant 回覆標記 `off-topic`（固定拒答，不計每日額度）；
 *   - `clarify`／`reject`／`normalize`：來自 `tutor_query_events` 的匿名事件
 *     （澄清不寫入 `tutor_messages`，所以只能由事件表統計）；
 *   - `webSupplement`：每次回覆的外部參考狀態分佈（`disabled`／`not-used`／`ok`／
 *     `failed`／`blocked-topic`；`none` = 舊資料或學生提問，不計）。
 *
 * 日期一律以**香港時間**的日期字串（`YYYY-MM-DD`）分桶，與每日 15 次額度同一口徑。
 */
import { getDb } from "../db/connection";
import {
  countTutorQueryEventsByDaySince,
  countTutorQueryEventsSince,
} from "../repositories/tutor-events";
import { hongKongDayStart } from "./tutor";
import type { TeacherTutorStats } from "../../lib/types";

/** 允許的統計期間（日）；其他值一律收斂至 7 */
export const TEACHER_TUTOR_STATS_PERIODS = [7, 30] as const;
/** 預設統計期間 */
export const TEACHER_TUTOR_STATS_DEFAULT_DAYS = 7;

export function normaliseTutorStatsDays(days: number | null | undefined): number {
  return days !== undefined && days !== null && (TEACHER_TUTOR_STATS_PERIODS as readonly number[]).includes(days)
    ? days
    : TEACHER_TUTOR_STATS_DEFAULT_DAYS;
}

interface DayRow {
  day: string;
  answered: number;
  offTopic: number;
}

interface WebStatusRow {
  status: string;
  total: number;
}

/** 把「N 日前」轉成香港時間當日零時（含當日，所以是 days - 1） */
export function tutorStatsSince(days: number, now = new Date()): string {
  const backdated = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return hongKongDayStart(backdated);
}

export function getTeacherTutorStats(options: {
  days?: number | null;
  now?: Date;
} = {}): TeacherTutorStats {
  const days = normaliseTutorStatsDays(options.days);
  const now = options.now ?? new Date();
  const since = tutorStatsSince(days, now);

  const dayRows = getDb()
    .prepare(
      `SELECT substr(createdAt, 1, 10) AS day,
              SUM(CASE WHEN role = 'assistant'
                        AND groundingStatus IN ('grounded', 'not-covered')
                       THEN 1 ELSE 0 END) AS answered,
              SUM(CASE WHEN role = 'assistant' AND groundingStatus = 'off-topic'
                       THEN 1 ELSE 0 END) AS offTopic
       FROM tutor_messages
       WHERE createdAt >= ?
       GROUP BY day`,
    )
    .all(since) as unknown as DayRow[];

  const statusRows = getDb()
    .prepare(
      `SELECT webSupplementStatus AS status, COUNT(*) AS total
       FROM tutor_messages
       WHERE createdAt >= ?
         AND role = 'assistant'
         AND webSupplementStatus <> 'none'
       GROUP BY webSupplementStatus`,
    )
    .all(since) as unknown as WebStatusRow[];

  const eventsByDay = countTutorQueryEventsByDaySince(since);
  const eventTotals = countTutorQueryEventsSince(since);

  const daily = new Map<
    string,
    { answered: number; offTopic: number; clarify: number; reject: number; normalize: number }
  >();
  const bucket = (day: string) => {
    const existing = daily.get(day);
    if (existing !== undefined) return existing;
    const created = { answered: 0, offTopic: 0, clarify: 0, reject: 0, normalize: 0 };
    daily.set(day, created);
    return created;
  };
  for (const row of dayRows) {
    const entry = bucket(row.day);
    entry.answered = Number(row.answered ?? 0);
    entry.offTopic = Number(row.offTopic ?? 0);
  }
  for (const [day, counts] of eventsByDay) {
    const entry = bucket(day);
    entry.clarify = counts.clarify;
    entry.reject = counts.reject;
    entry.normalize = counts.normalize;
  }

  const webSupplement: Record<string, number> = {};
  for (const row of statusRows) {
    if (row.status.length === 0) continue;
    webSupplement[row.status] = Number(row.total);
  }

  const sortedDays = [...daily.entries()].sort((left, right) => left[0].localeCompare(right[0]));

  return {
    days,
    from: since,
    to: now.toISOString(),
    contentIncluded: false,
    totals: {
      answered: sortedDays.reduce((total, [, value]) => total + value.answered, 0),
      offTopic: sortedDays.reduce((total, [, value]) => total + value.offTopic, 0),
      clarify: eventTotals.clarify,
      reject: eventTotals.reject,
      normalize: eventTotals.normalize,
    },
    webSupplement,
    daily: sortedDays.map(([date, value]) => ({ date, ...value })),
  };
}
