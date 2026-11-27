/**
 * 每週練習欠交及應補報告（教師查詢用）。
 *
 * 口徑（2026-11-27 使用者決定）：
 *   1. **上週**（星期一至五）每人應完成 50 題；不足的差額 **×2** 計（`weeklyShortfall`）；
 *   2. **本週**每工作日應完成 10 題。星期一的那 10 題**不計**（星期一本來就是補上週
 *      的時間），但學生在星期一的作答仍計入本週已做總數；
 *   3. 本週已做先滿足本週應做（`currentWeekDue`），**超出部分**才抵銷上週雙計欠數；
 *   4. 抵銷後多出的不會累積到日後（本報告不設結餘）。
 *
 * 只計一般練習（`mode = 'standard'`）且已作答（答案非空白）的題目；重溫錯題不計，
 * 與教師端紀錄及每日匯出的口徑一致。
 */
import type { DatabaseSync } from "node:sqlite";

export interface GradeMakeupRow {
  className: string;
  studentNumber: string;
  name: string;
  email: string;
  /** 上週獲派題目（含未作答）；用於核對「派題不足」而非學生欠交 */
  lastWeekAssigned: number;
  lastWeekAnswered: number;
  /** 上週欠題（`max(0, 每週應做 − 已作答)`，未雙計） */
  lastWeekShortfall: number;
  /** 上週欠數雙計後的應補題數（A） */
  weeklyMakeup: number;
  /** 本週逐日已作答（依 `creditedDays` 次序） */
  dailyAnswered: { date: string; answered: number }[];
  /** 本週已做總數（W） */
  currentWeekAnswered: number;
  /** 本週應做題數（不計星期一；已完結的日子） */
  currentWeekDue: number;
  /** 本週欠數（B） */
  currentWeekShortfall: number;
  /** 可抵銷上週欠數的餘數（C） */
  creditedAgainstMakeup: number;
  /** 尚欠題數＝max(0, A − C) + B */
  remaining: number;
  /** 尚欠換算為練習節數（每節 10 題，向上取整；0 表示已清零） */
  remainingSessions: number;
}

export interface GradeMakeupReport {
  formLevel: string;
  /** 上週統計期間（星期一至五） */
  lastWeek: { from: string; to: string };
  /** 本週計入每日配額的日期（不含星期一） */
  countedDays: string[];
  /** 已扣除每日配額的星期一（顯示用） */
  mondayDate: string | null;
  weeklyQuota: number;
  dailyTarget: number;
  rows: GradeMakeupRow[];
  totals: {
    /** 表格列出的學生數（預設只列有練習紀錄者） */
    students: number;
    /** 名冊人數（供核對被略過的零練習學生） */
    rosterStudents: number;
    studentsWithActivity: number;
    studentsOwing: number;
    lastWeekAnswered: number;
    weeklyMakeup: number;
    currentWeekAnswered: number;
    currentWeekShortfall: number;
    creditedAgainstMakeup: number;
    remaining: number;
    remainingSessions: number;
  };
}

export interface GradeMakeupQuery {
  formLevel: string;
  lastWeekFrom: string;
  lastWeekTo: string;
  /** 本週計入每日配額的日期（已按「星期一不計」及「今日未結束不計」篩選） */
  countedDays: string[];
  /** 計入本週已做總數的日期（通常為本週一至最後一個計入日） */
  creditedDays: string[];
  /** 已扣除的星期一（沒有則 null） */
  mondayDate: string | null;
  weeklyQuota?: number;
  dailyTarget?: number;
  /** 每節題數，用於換算應補次數 */
  questionsPerSession?: number;
  /**
   * 只列出本週或上週有練習紀錄的學生（預設 true）。
   *
   * 名冊共 135 位，其中 117 位上週及本週都沒有任何一般練習；把他們全部列出會令
   * 表格失去焦點（教師要跟進的是有使用平台但不足數的學生）。傳 false 可看完整名冊。
   */
  activeOnly?: boolean;
}

interface RawRow {
  className: string;
  studentNumber: string;
  name: string;
  email: string;
  lastWeekAssigned: number | null;
  lastWeekAnswered: number | null;
  [key: string]: unknown;
}

function studentNumberKey(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function dayColumn(day: string): string {
  return `d${day.replaceAll("-", "")}`;
}

export function buildGradeMakeupReport(
  database: DatabaseSync,
  query: GradeMakeupQuery,
): GradeMakeupReport {
  const weeklyQuota = query.weeklyQuota ?? 50;
  const dailyTarget = query.dailyTarget ?? 10;
  const questionsPerSession = query.questionsPerSession ?? 10;

  const creditColumns = query.creditedDays
    .map(
      (day) => `(SELECT COUNT(*)
         FROM practice_sessions s
         JOIN attempts a ON a.session_id = s.id
        WHERE lower(s.learner_id) = 'school:' || lower(r.email)
          AND s.mode = 'standard'
          AND substr(datetime(s.created_at, '+8 hours'), 1, 10) = @${dayColumn(day)}
          AND trim(a.answer) <> '') AS ${dayColumn(day)}`,
    )
    .join(",\n      ");

  const parameters: Record<string, string> = {
    lastFrom: query.lastWeekFrom,
    lastTo: query.lastWeekTo,
    classPattern: `${query.formLevel}[A-Z]`,
  };
  for (const day of query.creditedDays) parameters[dayColumn(day)] = day;

  const rows = database
    .prepare(
      `SELECT r.class_name AS className,
              r.student_number AS studentNumber,
              r.name AS name,
              lower(r.email) AS email,
              (SELECT COALESCE(SUM(s.question_count), 0)
                 FROM practice_sessions s
                WHERE lower(s.learner_id) = 'school:' || lower(r.email)
                  AND s.mode = 'standard'
                  AND substr(datetime(s.created_at, '+8 hours'), 1, 10)
                      BETWEEN @lastFrom AND @lastTo) AS lastWeekAssigned,
              (SELECT COUNT(*)
                 FROM practice_sessions s
                 JOIN attempts a ON a.session_id = s.id
                WHERE lower(s.learner_id) = 'school:' || lower(r.email)
                  AND s.mode = 'standard'
                  AND substr(datetime(s.created_at, '+8 hours'), 1, 10)
                      BETWEEN @lastFrom AND @lastTo
                  AND trim(a.answer) <> '') AS lastWeekAnswered,
      ${creditColumns}
         FROM roster_students r
        WHERE r.in_scope = 1 AND r.class_name GLOB @classPattern`,
    )
    .all(parameters) as unknown as RawRow[];

  const mapped: GradeMakeupRow[] = rows
    .map((row) => {
      const lastWeekAnswered = Number(row.lastWeekAnswered ?? 0);
      const lastWeekShortfall = Math.max(0, weeklyQuota - lastWeekAnswered);
      const weeklyMakeup = lastWeekShortfall * 2;
      const dailyAnswered = query.creditedDays.map((date) => ({
        date,
        answered: Number(row[dayColumn(date)] ?? 0),
      }));
      const currentWeekAnswered = dailyAnswered.reduce((sum, entry) => sum + entry.answered, 0);
      const currentWeekDue = query.countedDays.length * dailyTarget;
      const currentWeekShortfall = Math.max(0, currentWeekDue - currentWeekAnswered);
      const creditedAgainstMakeup = Math.min(
        weeklyMakeup,
        Math.max(0, currentWeekAnswered - currentWeekDue),
      );
      const remaining = Math.max(0, weeklyMakeup - creditedAgainstMakeup) + currentWeekShortfall;
      return {
        className: row.className,
        studentNumber: row.studentNumber,
        name: row.name,
        email: row.email,
        lastWeekAssigned: Number(row.lastWeekAssigned ?? 0),
        lastWeekAnswered,
        lastWeekShortfall,
        weeklyMakeup,
        dailyAnswered,
        currentWeekAnswered,
        currentWeekDue,
        currentWeekShortfall,
        creditedAgainstMakeup,
        remaining,
        remainingSessions: Math.ceil(remaining / questionsPerSession),
      };
    })
    .sort(
      (left, right) =>
        left.className.localeCompare(right.className, "zh-HK", { numeric: true }) ||
        studentNumberKey(left.studentNumber) - studentNumberKey(right.studentNumber) ||
        left.name.localeCompare(right.name, "zh-HK"),
    );

  const withActivity = mapped.filter(
    (row) => row.lastWeekAnswered > 0 || row.currentWeekAnswered > 0,
  );
  const listed = query.activeOnly === false ? mapped : withActivity;
  const owing = listed.filter((row) => row.remaining > 0);
  const remaining = owing.reduce((sum, row) => sum + row.remaining, 0);

  return {
    formLevel: query.formLevel,
    lastWeek: { from: query.lastWeekFrom, to: query.lastWeekTo },
    countedDays: [...query.countedDays],
    mondayDate: query.mondayDate,
    weeklyQuota,
    dailyTarget,
    rows: listed,
    totals: {
      students: listed.length,
      rosterStudents: mapped.length,
      studentsWithActivity: withActivity.length,
      studentsOwing: owing.length,
      lastWeekAnswered: listed.reduce((sum, row) => sum + row.lastWeekAnswered, 0),
      weeklyMakeup: listed.reduce((sum, row) => sum + row.weeklyMakeup, 0),
      currentWeekAnswered: listed.reduce((sum, row) => sum + row.currentWeekAnswered, 0),
      currentWeekShortfall: listed.reduce((sum, row) => sum + row.currentWeekShortfall, 0),
      creditedAgainstMakeup: listed.reduce((sum, row) => sum + row.creditedAgainstMakeup, 0),
      remaining,
      remainingSessions: Math.ceil(remaining / questionsPerSession),
    },
  };
}
