/**
 * 按級別匯出學生一般練習作答情況（供教師每日定時存檔）。
 *
 * 口徑（與教師端「學生練習記錄」一致，但刻意收窄）：
 *   - 只計 `mode = 'standard'` 的練習；`wrong-only`（重溫錯題）一律不計入
 *     練習次數、作答題數及準確率，避免把重做同一批錯題當成新的學習成果；
 *   - 只計已作答（答案非空白）的題目；未作答題目仍會顯示在「獲派題目」與「未作答」；
 *   - 準確率 = 答對 ÷ 已作答，沒有已作答題目時為 null（介面顯示「—」，不是 0%）。
 *
 * 名單一律以名冊（`roster_students`）為準，因此當日沒有練習的學生亦會列出（0 次），
 * 教師不必自行比對誰沒有交。日期以香港時間（UTC+8）劃分，與教師端篩選一致。
 */
import type { DatabaseSync } from "node:sqlite";

export interface GradePracticeRow {
  className: string;
  studentNumber: string;
  name: string;
  email: string;
  /** 一般練習次數（不含重溫錯題） */
  sessions: number;
  /** 該批練習的題目總數（含未作答） */
  assignedQuestions: number;
  answeredQuestions: number;
  correct: number;
  wrong: number;
  /** 0-1；沒有已作答題目時為 null */
  accuracy: number | null;
  /** 最近一次一般練習的 ISO 時間；沒有練習時為 null */
  lastPractisedAt: string | null;
}

export interface GradePracticeExport {
  formLevel: string;
  from: string;
  to: string;
  rows: GradePracticeRow[];
  classes: {
    className: string;
    students: number;
    activeStudents: number;
    sessions: number;
    assignedQuestions: number;
    answeredQuestions: number;
    correct: number;
    wrong: number;
    accuracy: number | null;
  }[];
  totals: {
    students: number;
    activeStudents: number;
    sessions: number;
    assignedQuestions: number;
    answeredQuestions: number;
    correct: number;
    wrong: number;
    accuracy: number | null;
  };
}

interface RawRow {
  className: string;
  studentNumber: string;
  name: string;
  email: string;
  sessions: number | null;
  assignedQuestions: number | null;
  answeredQuestions: number | null;
  correct: number | null;
  wrong: number | null;
  lastPractisedAt: string | null;
}

function ratio(correct: number, answered: number): number | null {
  return answered > 0 ? Number((correct / answered).toFixed(4)) : null;
}

/** 學號以數值排序（「01」與「1」相鄰）；沒有學號或非數字者排最後 */
function studentNumberKey(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

export function buildGradePracticeExport(
  database: DatabaseSync,
  options: { formLevel: string; from: string; to: string },
): GradePracticeExport {
  const { formLevel, from, to } = options;
  const rows = database
    .prepare(
      `WITH standard_sessions AS (
         SELECT s.id, s.learner_id, s.question_count, s.created_at
         FROM practice_sessions s
         WHERE s.mode = 'standard'
           AND substr(datetime(s.created_at, '+8 hours'), 1, 10) BETWEEN ? AND ?
       ),
       session_totals AS (
         SELECT learner_id,
                COUNT(*) AS sessions,
                COALESCE(SUM(question_count), 0) AS assignedQuestions,
                MAX(created_at) AS lastPractisedAt
         FROM standard_sessions
         GROUP BY learner_id
       ),
       answer_totals AS (
         SELECT s.learner_id,
                COUNT(CASE WHEN trim(a.answer) <> '' THEN 1 END) AS answeredQuestions,
                COUNT(CASE WHEN a.is_correct = 1 THEN 1 END) AS correct,
                COUNT(CASE WHEN a.is_correct = 0 THEN 1 END) AS wrong
         FROM standard_sessions s
         JOIN attempts a ON a.session_id = s.id
         GROUP BY s.learner_id
       )
       SELECT r.class_name AS className,
              r.student_number AS studentNumber,
              r.name AS name,
              lower(r.email) AS email,
              st.sessions AS sessions,
              st.assignedQuestions AS assignedQuestions,
              at.answeredQuestions AS answeredQuestions,
              at.correct AS correct,
              at.wrong AS wrong,
              st.lastPractisedAt AS lastPractisedAt
       FROM roster_students r
       LEFT JOIN session_totals st ON lower(st.learner_id) = 'school:' || lower(r.email)
       LEFT JOIN answer_totals at ON lower(at.learner_id) = 'school:' || lower(r.email)
       WHERE r.in_scope = 1 AND r.class_name GLOB ?`,
    )
    .all(from, to, `${formLevel}[A-Z]`) as unknown as RawRow[];

  const mapped: GradePracticeRow[] = rows
    .map((row) => {
      const answeredQuestions = Number(row.answeredQuestions ?? 0);
      const correct = Number(row.correct ?? 0);
      return {
        className: row.className,
        studentNumber: row.studentNumber,
        name: row.name,
        email: row.email,
        sessions: Number(row.sessions ?? 0),
        assignedQuestions: Number(row.assignedQuestions ?? 0),
        answeredQuestions,
        correct,
        wrong: Number(row.wrong ?? 0),
        accuracy: ratio(correct, answeredQuestions),
        lastPractisedAt: row.lastPractisedAt,
      };
    })
    .sort(
      (left, right) =>
        left.className.localeCompare(right.className, "zh-HK", { numeric: true }) ||
        studentNumberKey(left.studentNumber) - studentNumberKey(right.studentNumber) ||
        left.name.localeCompare(right.name, "zh-HK"),
    );

  const classNames = [...new Set(mapped.map((row) => row.className))].sort((left, right) =>
    left.localeCompare(right, "zh-HK", { numeric: true }),
  );

  const classes = classNames.map((className) => {
    const members = mapped.filter((row) => row.className === className);
    const correct = members.reduce((sum, row) => sum + row.correct, 0);
    const answeredQuestions = members.reduce((sum, row) => sum + row.answeredQuestions, 0);
    return {
      className,
      students: members.length,
      activeStudents: members.filter((row) => row.sessions > 0).length,
      sessions: members.reduce((sum, row) => sum + row.sessions, 0),
      assignedQuestions: members.reduce((sum, row) => sum + row.assignedQuestions, 0),
      answeredQuestions,
      correct,
      wrong: members.reduce((sum, row) => sum + row.wrong, 0),
      accuracy: ratio(correct, answeredQuestions),
    };
  });

  const correct = mapped.reduce((sum, row) => sum + row.correct, 0);
  const answeredQuestions = mapped.reduce((sum, row) => sum + row.answeredQuestions, 0);

  return {
    formLevel,
    from,
    to,
    rows: mapped,
    classes,
    totals: {
      students: mapped.length,
      activeStudents: mapped.filter((row) => row.sessions > 0).length,
      sessions: mapped.reduce((sum, row) => sum + row.sessions, 0),
      assignedQuestions: mapped.reduce((sum, row) => sum + row.assignedQuestions, 0),
      answeredQuestions,
      correct,
      wrong: mapped.reduce((sum, row) => sum + row.wrong, 0),
      accuracy: ratio(correct, answeredQuestions),
    },
  };
}

/** 香港時間 `YYYY-MM-DD`（伺服器可能以 UTC 執行，不可用本機時區推導日期） */
export function hongKongDate(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 香港時間 `YYYY-MM-DD HH:mm` */
export function hongKongDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ");
}

/** 香港時間 `MM-DD`（電郵表格的「最後練習」欄） */
export function hongKongMonthDay(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(5, 10);
}

/**
 * 本週一（香港時間）的 `YYYY-MM-DD`。
 *
 * 用於「逢星期一至五、累計本週至今」的每日更新：星期一至日都回傳該週的星期一。
 * 以香港日期計算，避免在 UTC 伺服器上把香港星期一凌晨誤算成上一個星期日。
 */
export function hongKongWeekStart(now: Date = new Date()): string {
  const dayKey = hongKongDate(now);
  const weekday = new Date(`${dayKey}T00:00:00Z`).getUTCDay(); // 0 = 星期日
  const offset = weekday === 0 ? 6 : weekday - 1;
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) - offset * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** 香港日期加減日數（純日期字串運算，不受伺服器時區影響） */
export function addHongKongDays(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` → `MM-DD`（表格標題用） */
function monthDayOf(dateKey: string): string {
  return dateKey.slice(5);
}

function rangeLabelOf(from: string, to: string): string {
  return from === to ? monthDayOf(from) : `${monthDayOf(from)} 至 ${monthDayOf(to)}`;
}

/**
 * 一次交付包含哪些統計期間。
 *
 * 交付規則（2026-11-23 使用者指示）：
 *   - **星期一**：上一個完整星期（上星期一至**日**）。07:45 時本週才剛開始，本週累計
 *     必然是 0——當日實際派出的正是「0 位有練習」的空白檔案；
 *   - **星期二至五**：前一日，以及本週一至前一日的累計（星期二的兩個期間相同，
 *     因此數字一樣，這是規則本身的結果，不是重複計算）。
 *
 * 星期六、日排程不會執行；手動執行時沿用「前一日＋本週累計」的寫法。
 */
export interface GradePracticeDeliveryPeriod {
  key: "last-week" | "previous-day" | "week-to-date";
  /** 顯示名稱，例如「上週」「前一日」「本週累計」 */
  label: string;
  from: string;
  to: string;
  /** 日期範圍的簡短寫法，例如「11-22」或「11-23 至 11-24」 */
  rangeLabel: string;
}

export function gradePracticeDeliveryPeriods(now: Date = new Date()): GradePracticeDeliveryPeriod[] {
  const today = hongKongDate(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = 星期日
  if (weekday === 1) {
    const from = addHongKongDays(hongKongWeekStart(now), -7);
    // 上星期一至星期日（2026-11-23 使用者指示：由「一至五」改為「一至日」）
    const to = addHongKongDays(from, 6);
    return [{ key: "last-week", label: "上週", from, to, rangeLabel: rangeLabelOf(from, to) }];
  }
  const yesterday = addHongKongDays(today, -1);
  const weekStart = hongKongWeekStart(now);
  // 防禦：若執行時間早於本週一（時鐘異常），不要做出 from > to 的期間
  const from = weekStart <= yesterday ? weekStart : yesterday;
  return [
    {
      key: "previous-day",
      label: "前一日",
      from: yesterday,
      to: yesterday,
      rangeLabel: rangeLabelOf(yesterday, yesterday),
    },
    {
      key: "week-to-date",
      label: "本週累計",
      from,
      to: yesterday,
      rangeLabel: rangeLabelOf(from, yesterday),
    },
  ];
}

export interface GradePracticeSection {
  period: GradePracticeDeliveryPeriod;
  report: GradePracticeExport;
}

export function buildGradePracticeSections(
  database: DatabaseSync,
  options: { formLevel: string; now?: Date },
): GradePracticeSection[] {
  return gradePracticeDeliveryPeriods(options.now).map((period) => ({
    period,
    report: buildGradePracticeExport(database, {
      formLevel: options.formLevel,
      from: period.from,
      to: period.to,
    }),
  }));
}

/** 電郵正文及 JPG 共用同一個欄序（不可任意改動，教師會直接貼進 Excel 對照） */
export const PRACTICE_TABLE_COLUMNS = [
  "班別班號",
  "姓名",
  "練習",
  "獲派",
  "作答",
  "答對",
  "答錯",
  "準確率",
  "最後練習",
] as const;

/**
 * 逐位學生的表格內容（只列有練習紀錄的學生）。
 *
 * 只列 `sessions > 0`：教師要追蹤的是「誰交了」，把 100 多位 0 次的學生全部列出
 * 只會令表格失去焦點；完整名冊（含 0 次）仍在附件 Excel 內。
 */
export function practiceTableRows(rows: GradePracticeRow[]): string[][] {
  return rows
    .filter((row) => row.sessions > 0)
    .map((row) => [
      `${row.className}-${row.studentNumber}`,
      row.name,
      String(row.sessions),
      String(row.assignedQuestions),
      String(row.answeredQuestions),
      String(row.correct),
      String(row.wrong),
      row.accuracy === null ? "—" : `${(row.accuracy * 100).toFixed(2)}%`,
      hongKongMonthDay(row.lastPractisedAt),
    ]);
}

/** 電郵正文的表格（以 TAB 分隔，可直接貼進 Excel） */
export function formatPracticeTable(rows: GradePracticeRow[]): string {
  return [PRACTICE_TABLE_COLUMNS.join("\t"), ...practiceTableRows(rows).map((row) => row.join("\t"))].join(
    "\n",
  );
}

/** 單一期間的摘要句（電郵正文及 JPG 標題共用同一寫法） */
export function practiceSectionSummary(report: GradePracticeExport): string {
  const accuracy =
    report.totals.accuracy === null ? "—" : `${(report.totals.accuracy * 100).toFixed(2)}%`;
  return (
    `名冊 ${report.totals.students} 位，其中 ${report.totals.activeStudents} 位有練習；` +
    `練習 ${report.totals.sessions} 次、作答 ${report.totals.answeredQuestions}／` +
    `${report.totals.assignedQuestions} 題，準確率 ${accuracy}`
  );
}

const SECTION_ORDINALS = ["一", "二", "三", "四"];

/** `formatPracticeDigest` 需要的欄位（`GradePracticeSection` 結構上相容） */
export interface PracticeDigestSection {
  period: { label: string; from: string; to: string; rangeLabel: string };
  report: GradePracticeExport;
}

/**
 * 電郵正文：逐個統計期間一段（標題、摘要、TAB 表格）。
 *
 * 兩個期間的日期完全相同時（星期二：前一日即本週一）加一句說明，避免教師以為
 * 同一份表格重複寄了兩次。
 */
export function formatPracticeDigest(sections: readonly PracticeDigestSection[]): string {
  const blocks = sections.map((section, index) => {
    const heading =
      `${SECTION_ORDINALS[index] ?? String(index + 1)}、` +
      `${section.period.label}（${section.period.rangeLabel}）`;
    const empty = section.report.totals.activeStudents === 0;
    return [
      heading,
      practiceSectionSummary(section.report),
      "",
      formatPracticeTable(section.report.rows),
      empty
        ? "（此期間沒有任何一般練習紀錄。）"
        : "（只列有練習紀錄的學生；完整名冊見附件 Excel。）",
    ].join("\r\n");
  });
  const sameRange =
    sections.length === 2 &&
    sections[0]!.period.from === sections[1]!.period.from &&
    sections[0]!.period.to === sections[1]!.period.to;
  return [
    ...blocks,
    ...(sameRange ? ["（前一日與本週累計的期間相同，兩表數字一樣。）"] : []),
  ].join("\r\n\r\n");
}
