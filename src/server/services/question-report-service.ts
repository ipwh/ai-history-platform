/**
 * 題目回報服務層。
 *
 * 學生在答案頁回報問題題目（題目不清楚、答案有爭議等），回報會寫入資料庫，
 * 令該題在教師端顯示「待覆核」。回報**不會**自動刪除或停用題目，只供教師覆核。
 */
import {
  questionReportInputSchema,
  questionReportStatusSchema,
  type Question,
  type QuestionReportDetail,
  type QuestionReportInput,
  type QuestionReportStatus,
} from "../../lib/types";
import { ApiRouteError } from "../http";
import {
  getAttemptById,
  getSession,
  getSessionQuestions,
} from "../repositories/practice";
import { getQuestion, listQuestions } from "../repositories/questions";
import {
  countOpenReportsByQuestion,
  getReport,
  hasOpenReport,
  insertReport,
  listReports,
  updateReportStatus,
  type ReportFilter,
} from "../repositories/reports";
import { getSection, getTopic } from "../repositories/topics";
import {
  autoValidationIsCurrent,
  changeQuestionStatus,
  questionFingerprint,
  revalidateQuestion,
} from "./question-service";

export interface SubmitReportResult {
  reportId: string;
  status: QuestionReportStatus;
  /** 之前已回報同一題目版本而未處理時為 true（不會重複建立記錄） */
  alreadyReported: boolean;
}

/**
 * 提交題目回報。
 *
 * 題目可以來自題庫，也可以只存在於練習快照（AI 即時生成的題目不會寫入題庫，
 * 但仍必須可以回報，否則學生最常遇到的就是這類題目）。
 * 提供 sessionId 時會核對該題確實屬於這次練習，避免任意回報；
 * 回報會記錄**當時的題目版本及內容指紋**，以及相關的作答紀錄（如有），
 * 令教師可以確定「學生回報的是哪一版、當時答了甚麼」。
 * 同一學習者對同一題目版本已有未處理回報時不會重複建立。
 */
export function submitQuestionReport(
  learnerId: string,
  input: QuestionReportInput,
): SubmitReportResult {
  const parsed = questionReportInputSchema.parse(input);

  const session = parsed.sessionId ? getSession(parsed.sessionId) : null;
  if (parsed.sessionId) {
    if (!session) throw new ApiRouteError("找不到這次練習記錄", 404);
    if (session.learnerId !== learnerId) {
      throw new ApiRouteError("不能回報其他學習者練習中的題目", 403);
    }
  }

  const bankQuestion = getQuestion(parsed.questionId);
  const snapshotQuestion = session
    ? (getSessionQuestions(session.id).find((item) => item.id === parsed.questionId) ?? null)
    : null;

  if (session && !snapshotQuestion) {
    throw new ApiRouteError("這條題目不屬於該次練習", 400);
  }

  const question = bankQuestion ?? snapshotQuestion;
  if (!question) throw new ApiRouteError("找不到指定的題目", 404);

  // 相關作答（可選）：必須屬於這位學生、這次練習、這一題。
  let attemptId: string | null = null;
  if (parsed.attemptId !== null) {
    const attempt = getAttemptById(parsed.attemptId);
    if (!attempt) throw new ApiRouteError("找不到相關的作答記錄", 404);
    if (attempt.learnerId !== learnerId) {
      throw new ApiRouteError("不能回報其他學習者的作答", 403);
    }
    if (attempt.questionId !== question.id) {
      throw new ApiRouteError("相關作答不屬於這條題目", 400);
    }
    attemptId = attempt.id;
  }

  if (hasOpenReport(question.id, learnerId, question.revision)) {
    return { reportId: "", status: "open", alreadyReported: true };
  }

  const report = insertReport({
    questionId: question.id,
    sessionId: parsed.sessionId,
    attemptId,
    learnerId,
    topicId: question.topicId,
    reason: parsed.reason,
    detail: parsed.detail.trim(),
    questionRevision: question.revision,
    questionFingerprint: questionFingerprint(question),
  });

  return { reportId: report.id, status: report.status, alreadyReported: false };
}

export interface QuestionReportListFilter {
  status?: QuestionReportStatus | null;
  topicId?: string | null;
  questionId?: string | null;
  limit?: number;
}

/**
 * 教師端：回報清單（附題目、分節及課題名稱，並標示同一題目的未處理回報數）。
 *
 * 題目文字優先取題庫；若該題只存在於練習快照（AI 即時生成題目），
 * 會改用快照內容顯示並以 inQuestionBank = false 標示，教師仍可核對題目。
 */
export function listQuestionReports(filter: QuestionReportListFilter = {}): QuestionReportDetail[] {
  const reportFilter: ReportFilter = {
    statuses: filter.status ? [questionReportStatusSchema.parse(filter.status)] : undefined,
    topicId: filter.topicId ?? undefined,
    questionId: filter.questionId ?? undefined,
    limit: filter.limit,
  };
  const reports = listReports(reportFilter);
  if (reports.length === 0) return [];

  const questionIds = [...new Set(reports.map((report) => report.questionId))];
  const questions = new Map(
    listQuestions({ ids: questionIds }).map((question) => [question.id, question]),
  );
  const openCounts = countOpenReportsByQuestion(questionIds);
  const topicTitles = new Map<string, string>();
  const sectionTitles = new Map<string, string>();
  const snapshotQuestions = new Map<string, Question>();
  for (const sessionId of new Set(
    reports.map((report) => report.sessionId).filter((id): id is string => Boolean(id)),
  )) {
    for (const question of getSessionQuestions(sessionId)) {
      snapshotQuestions.set(`${sessionId}:${question.id}`, question);
    }
  }

  return reports.map((report) => {
    const question = questions.get(report.questionId);
    const snapshot = report.sessionId
      ? snapshotQuestions.get(`${report.sessionId}:${report.questionId}`)
      : undefined;
    if (!topicTitles.has(report.topicId)) {
      topicTitles.set(report.topicId, getTopic(report.topicId)?.title ?? "（課題已刪除）");
    }
    const sectionId = question?.sectionId ?? snapshot?.sectionId ?? "";
    if (sectionId.length > 0 && !sectionTitles.has(sectionId)) {
      sectionTitles.set(sectionId, getSection(sectionId)?.title ?? "（分節已刪除）");
    }
    // 相關作答：教師需要看到學生當時的答案及批改結果，才判斷得了回報是否成立
    const attempt = report.attemptId ? getAttemptById(report.attemptId) : null;
    // 題目可能在回報之後被修正或撤回：標示版本已經不同，避免教師把舊版回報
    // 當成現行版本的缺陷（或相反）
    const revisionChanged =
      question !== undefined &&
      report.questionRevision !== null &&
      report.questionRevision !== question.revision;
    return {
      ...report,
      question: question?.question ?? snapshot?.question ?? "（題目已刪除）",
      questionStatus: question?.status ?? snapshot?.status ?? "disabled",
      inQuestionBank: question !== undefined,
      sectionTitle: sectionId.length > 0 ? (sectionTitles.get(sectionId) as string) : "",
      topicTitle: topicTitles.get(report.topicId) as string,
      openCountForQuestion: openCounts.get(report.questionId) ?? 1,
      revisionChanged,
      attemptAnswer: attempt?.answer ?? null,
      attemptIsCorrect: attempt?.isCorrect ?? null,
      attemptRevision: attempt?.questionRevision ?? null,
      questionAutoValidated: question !== undefined && autoValidationIsCurrent(question),
    };
  });
}

/** 教師端：更新回報狀態（已處理 / 已略過 / 待覆核），只影響回報記錄 */
export function resolveQuestionReport(
  reportId: string,
  status: QuestionReportStatus,
  resolvedBy: string | null,
  resolutionAction: string | null = null,
): QuestionReportDetail | null {
  const existing = getReport(reportId);
  if (!existing) return null;
  updateReportStatus(
    reportId,
    questionReportStatusSchema.parse(status),
    resolvedBy,
    resolutionAction,
  );
  return listQuestionReports({ questionId: existing.questionId }).find(
    (item) => item.id === reportId,
  ) ?? null;
}

/** 教師處理回報時可以一併採取的題目行動（記錄在回報的 resolution_action） */
export const REPORT_REMEDIATION_ACTIONS = ["withdraw-question", "revalidate-question"] as const;
export type ReportRemediationAction =
  | (typeof REPORT_REMEDIATION_ACTIONS)[number]
  | "revalidate-failed"
  | "not-in-bank";

export interface ReportRemediationResult {
  /** 實際執行的行動（未執行時為 null，例如題目只在練習快照內） */
  action: ReportRemediationAction | null;
  /** 自動品質驗證的結果（revalidate-question 時） */
  autoValidated: boolean;
  /** 驗證不通過的原因（給教師看，不是給學生） */
  issues: string[];
  view: QuestionReportDetail | null;
}

/** 教師端：從回報一鍵暫時下架題目（不刪除，可隨時重新發布） */
export function withdrawQuestionFromReport(
  reportId: string,
  resolvedBy: string | null,
): ReportRemediationResult {
  const report = getReport(reportId);
  if (!report) return { action: null, autoValidated: false, issues: [], view: null };
  const question = getQuestion(report.questionId);
  if (!question) {
    resolveQuestionReport(reportId, "resolved", resolvedBy, "not-in-bank");
    return {
      action: "not-in-bank",
      autoValidated: false,
      issues: ["這條題目只存在於練習快照（AI 即時生成），無法在題庫下架"],
      view: null,
    };
  }
  changeQuestionStatus(question.id, "disabled");
  resolveQuestionReport(reportId, "resolved", resolvedBy, "withdraw-question");
  return {
    action: "withdraw-question",
    autoValidated: false,
    issues: [],
    view: listQuestionReports({ questionId: question.id }).find((item) => item.id === reportId) ?? null,
  };
}

/**
 * 教師端：重新執行自動品質驗證（修正題目後可立即重新取得學生可用狀態）。
 *
 * 通過時記錄自動驗證結果；**不會**建立人工覆核紀錄，因此教師端仍能分辨
 * 「機器檢查通過」與「教師確認過」。回報本身不會被自動結案。
 */
export function revalidateQuestionFromReport(
  reportId: string,
  resolvedBy: string | null,
): ReportRemediationResult {
  const report = getReport(reportId);
  if (!report) return { action: null, autoValidated: false, issues: [], view: null };
  const question = getQuestion(report.questionId);
  if (!question) {
    return {
      action: "not-in-bank",
      autoValidated: false,
      issues: ["這條題目只存在於練習快照（AI 即時生成），請先由教師手動建立或修正"],
      view: null,
    };
  }
  const result = revalidateQuestion(question.id);
  const action: ReportRemediationAction = result.autoValidated
    ? "revalidate-question"
    : "revalidate-failed";
  if (result.autoValidated) {
    resolveQuestionReport(reportId, "resolved", resolvedBy, action);
  }
  return {
    action,
    autoValidated: result.autoValidated,
    issues: [...result.sourceIssues, ...result.qualityIssues],
    view: listQuestionReports({ questionId: question.id }).find((item) => item.id === reportId) ?? null,
  };
}
