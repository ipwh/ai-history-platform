/**
 * 學生練習記錄的查閱與匯出（教師端）。
 *
 * 練習記錄一律由資料庫的練習快照及作答記錄讀取；教師端回應只會按名冊補上
 * 班別、姓名、學號及帳戶電郵，未核對名冊的學習者仍以電郵或匿名 ID 顯示。
 */
import {
  DIFFICULTY_LABELS,
  QUESTION_TYPE_LABELS,
  type PracticeRecordLearner,
  type PracticeRecordQuestion,
  type PracticeRecordSession,
} from "../../lib/types";
import { practiceTopicLabel } from "../../lib/practice-summary";
import type { RosterStudent } from "../roster/columns";
import { getTopic, sectionTitleMap } from "../repositories/topics";
import {
  getSessionQuestions,
  listAttempts,
  listRecordLearners,
  listSessionsForRecords,
  type SessionRecordFilter,
} from "../repositories/practice";

export type { PracticeRecordQuestion, PracticeRecordSession };

/**
 * 教師端監察只列出真實學生：教師／管理員的測試記錄另有標示，
 * 端對端測試產生的 `e2e-` 學習者亦不應混入班別名單。
 */
function isRealStudentLearner(learnerId: string): boolean {
  return (
    !learnerId.startsWith("teacher:") &&
    !learnerId.startsWith("admin:") &&
    !learnerId.startsWith("e2e-")
  );
}

/** 只在教師端回應補上名冊身分資料。 */
export function enrichRecordLearners(
  learners: ReturnType<typeof listRecordLearners>,
  rosterStudents: RosterStudent[],
): PracticeRecordLearner[] {
  const rosterByEmail = new Map(rosterStudents.map((student) => [student.email, student]));
  const learnerById = new Map(
    learners
      .filter((learner) => isRealStudentLearner(learner.learnerId))
      .map((learner) => {
        const email = learner.learnerId.startsWith("school:")
          ? learner.learnerId.slice("school:".length).toLowerCase()
          : null;
        const rosterStudent = email ? rosterByEmail.get(email) : undefined;
        return [
          learner.learnerId,
          {
            ...learner,
            name: rosterStudent?.name || null,
            className: rosterStudent?.className || null,
            studentNumber: rosterStudent?.studentNumber || null,
            email,
          },
        ];
      }),
  );

  for (const student of rosterStudents) {
    if (!student.inScope) continue;
    const learnerId = `school:${student.email}`;
    if (learnerById.has(learnerId)) continue;
    learnerById.set(learnerId, {
      learnerId,
      lastAt: "",
      sessions: 0,
      answeredQuestions: 0,
      correctCount: 0,
      accuracy: null,
      name: student.name || null,
      className: student.className || null,
      studentNumber: student.studentNumber || null,
      email: student.email,
    });
  }

  return [...learnerById.values()].sort((left, right) => right.lastAt.localeCompare(left.lastAt));
}

/** 練習記錄及 CSV 匯出共用同一套學生標示。 */
export function enrichPracticeRecordLabels(
  records: PracticeRecordSession[],
  learners: PracticeRecordLearner[],
): PracticeRecordSession[] {
  const learnerById = new Map(learners.map((learner) => [learner.learnerId, learner]));
  return records.map((record) => {
    const learner = learnerById.get(record.learnerId);
    if (!learner) return record;
    const primary = learner.name || learner.email || record.learnerLabel;
    const details = [learner.className, learner.studentNumber]
      .filter((value): value is string => Boolean(value))
      .join(" ・ ");
    return {
      ...record,
      learnerLabel: [
        primary,
        details ? `（${details}）` : "",
        learner.name && learner.email ? ` · ${learner.email}` : "",
      ].join(""),
      learnerName: learner.name,
      learnerClassName: learner.className,
      learnerStudentNumber: learner.studentNumber,
      learnerEmail: learner.email,
    };
  });
}

/**
 * 把學習者 ID 轉成教師易讀的標示。
 * 學生帳戶為 school:<電郵>，教師測試為 teacher:<電郵>，管理員測試為 admin:<電郵>，
 * 其餘為匿名 ID。
 */
export function learnerLabel(learnerId: string): string {
  if (learnerId.startsWith("school:")) return learnerId.slice("school:".length);
  if (learnerId.startsWith("admin:")) return `${learnerId.slice("admin:".length)}（管理員測試）`;
  if (learnerId.startsWith("teacher:")) return `${learnerId.slice("teacher:".length)}（教師測試）`;
  return `匿名 ${learnerId.slice(0, 8)}`;}

function buildSessionRecord(
  session: ReturnType<typeof listSessionsForRecords>[number],
  topicTitle: string,
  sectionTitles: Map<string, string>,
): PracticeRecordSession {
  const questions = getSessionQuestions(session.id);
  const attempts = new Map(listAttempts(session.id).map((attempt) => [attempt.questionId, attempt]));

  const rows: PracticeRecordQuestion[] = questions.map((question) => {
    const attempt = attempts.get(question.id) ?? null;
    return {
      questionId: question.id,
      questionType: question.questionType,
      questionTypeLabel: QUESTION_TYPE_LABELS[question.questionType],
      question: question.question,
      sectionTitle: sectionTitles.get(question.sectionId) ?? "",
      studentAnswer: attempt?.answer ?? "",
      correctAnswer: question.correctAnswer,
      isCorrect: attempt?.isCorrect ?? null,
      selfAssessment: attempt?.selfAssessment ?? null,
      aiVerdict: attempt?.aiGrading?.verdict ?? null,
      answered: attempt !== null && attempt.answer.trim().length > 0,
    };
  });

  const graded = rows.filter((row) => row.isCorrect !== null);
  const correctCount = graded.filter((row) => row.isCorrect === true).length;

  return {
    sessionId: session.id,
    learnerId: session.learnerId,
    learnerLabel: learnerLabel(session.learnerId),
    learnerName: null,
    learnerClassName: null,
    learnerStudentNumber: null,
    learnerEmail: session.learnerId.startsWith("school:")
      ? session.learnerId.slice("school:".length)
      : null,
    topicId: session.topicId,
    topicTitle,
    createdAt: session.createdAt,
    completedAt: session.completedAt,
    questionTypes: session.questionTypes,
    questionTypeLabels: session.questionTypes.map((type) => QUESTION_TYPE_LABELS[type]),
    difficulty: session.difficulty,
    difficultyLabel: DIFFICULTY_LABELS[session.difficulty],
    totalQuestions: rows.length,
    answeredCount: rows.filter((row) => row.answered).length,
    correctCount,
    wrongCount: graded.length - correctCount,
    accuracy: graded.length > 0 ? Number((correctCount / graded.length).toFixed(4)) : null,
    questions: rows,
  };
}

/** 列出練習記錄（最新在前），供教師端查閱及匯出 */
export function listPracticeRecords(filter: SessionRecordFilter = {}): PracticeRecordSession[] {
  const sessions = listSessionsForRecords(filter);
  const topicTitles = new Map<string, string>();
  const sectionTitleCache = new Map<string, Map<string, string>>();

  const sectionTitlesFor = (topicId: string): Map<string, string> => {
    const cached = sectionTitleCache.get(topicId);
    if (cached) return cached;
    const titles = sectionTitleMap(topicId);
    sectionTitleCache.set(topicId, titles);
    return titles;
  };

  return sessions.map((session) => {
    let topicTitle = topicTitles.get(session.topicId);
    if (topicTitle === undefined) {
      const topic = getTopic(session.topicId);
      topicTitle = topic ? practiceTopicLabel(topic) : session.topicId;
      topicTitles.set(session.topicId, topicTitle);
    }
    return buildSessionRecord(session, topicTitle, sectionTitlesFor(session.topicId));
  });
}

/** 由查詢參數建立篩選條件（教師端 API 共用） */
export function recordFilterFromParams(
  params: URLSearchParams,
  defaultLimit = 200,
): SessionRecordFilter {
  const limit = Number.parseInt(params.get("limit") ?? String(defaultLimit), 10);
  return {
    topicId: params.get("topicId")?.trim() || null,
    learnerId: params.get("learnerId")?.trim() || null,
    from: params.get("from")?.trim() || null,
    to: params.get("to")?.trim() || null,
    limit: Number.isFinite(limit) ? limit : defaultLimit,
  };
}

/**
 * 會被試算表當成公式起首的字元。
 * Excel／Google Sheets 會把 =、+、-、@ 以及前置的 TAB／CR 視為公式或特殊輸入，
 * 學生只要把這類文字填在答案欄，教師開啟匯出檔時就會執行該公式
 * （CSV 公式注入，可用來外洩同檔案其他列的資料或觸發外部連線）。
 */
const FORMULA_LEADING = /^[=+\-@\t\r]/;

/** CSV 欄位轉義：公式起首的字元加前置單引號，含逗號、引號或換行時以雙引號包住 */
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (FORMULA_LEADING.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const OUTCOME_LABELS: Record<"correct" | "wrong" | "ungraded" | "unanswered", string> = {
  correct: "答對",
  wrong: "答錯",
  ungraded: "待自我檢查",
  unanswered: "未作答",
};

function outcomeOf(row: PracticeRecordQuestion): keyof typeof OUTCOME_LABELS {
  if (!row.answered) return "unanswered";
  if (row.isCorrect === true) return "correct";
  if (row.isCorrect === false) return "wrong";
  return "ungraded";
}

/** 單題結果的文字說明（CSV／XLSX 共用） */
export function recordOutcomeLabel(row: PracticeRecordQuestion): string {
  const outcome = outcomeOf(row);
  if (outcome === "ungraded" && row.selfAssessment === "needs-review") {
    return "待自我檢查（需重溫）";
  }
  return OUTCOME_LABELS[outcome];
}

/** 逐題記錄的欄位（CSV 及 XLSX 的「逐題記錄」工作表共用，次序不可任意改動） */
export const RECORDS_ROW_HEADER = [
  "作答日期",
  "學生姓名",
  "班別",
  "學號",
  "電郵",
  "學習者 ID",
  "課題",
  "分節",
  "題型",
  "難度",
  "題目",
  "學生答案",
  "正確答案",
  "結果",
  "練習編號",
] as const;

/** 一次練習中的每道題目各成一列（與 RECORDS_ROW_HEADER 對應） */
export function recordRowValues(record: PracticeRecordSession): (string | null)[][] {
  return record.questions.map((row) => [
    record.createdAt,
    record.learnerName,
    record.learnerClassName,
    record.learnerStudentNumber,
    record.learnerEmail,
    record.learnerId,
    record.topicTitle,
    row.sectionTitle,
    row.questionTypeLabel,
    record.difficultyLabel,
    row.question,
    row.studentAnswer,
    row.correctAnswer,
    recordOutcomeLabel(row),
    record.sessionId,
  ]);
}

/**
 * 把練習記錄轉成 CSV 文字（每題一列）。
 * 欄位包含作答日子、課題、分節、題型、題目、學生答案、正確答案及答對／答錯。
 */
export function buildRecordsCsv(records: PracticeRecordSession[]): string {
  const lines: string[] = [[...RECORDS_ROW_HEADER].map(csvCell).join(",")];
  for (const record of records) {
    for (const row of recordRowValues(record)) {
      lines.push(row.map(csvCell).join(","));
    }
  }
  return lines.join("\r\n");
}
