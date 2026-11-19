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
