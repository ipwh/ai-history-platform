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

export interface SubmitReportResult {
  reportId: string;
  status: QuestionReportStatus;
  /** 之前已回報同一題目而未處理時為 true（不會重複建立記錄） */
  alreadyReported: boolean;
}

/**
 * 提交題目回報。
 *
 * 題目可以來自題庫，也可以只存在於練習快照（AI 即時生成的題目不會寫入題庫，
 * 但仍必須可以回報，否則學生最常遇到的就是這類題目）。
 * 提供 sessionId 時會核對該題確實屬於這次練習，避免任意回報；
 * 同一學習者對同一題目已有未處理回報時不會重複建立。
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

  if (hasOpenReport(question.id, learnerId)) {
    return { reportId: "", status: "open", alreadyReported: true };
  }

  const report = insertReport({
    questionId: question.id,
    sessionId: parsed.sessionId,
    learnerId,
    topicId: question.topicId,
    reason: parsed.reason,
    detail: parsed.detail.trim(),
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
    return {
      ...report,
      question: question?.question ?? snapshot?.question ?? "（題目已刪除）",
      questionStatus: question?.status ?? snapshot?.status ?? "disabled",
      inQuestionBank: question !== undefined,
      sectionTitle: sectionId.length > 0 ? (sectionTitles.get(sectionId) as string) : "",
      topicTitle: topicTitles.get(report.topicId) as string,
      openCountForQuestion: openCounts.get(report.questionId) ?? 1,
    };
  });
}

/** 教師端：更新回報狀態（已處理 / 已略過 / 待覆核），只影響回報記錄 */
export function resolveQuestionReport(
  reportId: string,
  status: QuestionReportStatus,
  resolvedBy: string | null,
): QuestionReportDetail | null {
  const existing = getReport(reportId);
  if (!existing) return null;
  updateReportStatus(reportId, questionReportStatusSchema.parse(status), resolvedBy);
  return listQuestionReports({ questionId: existing.questionId }).find(
    (item) => item.id === reportId,
  ) ?? null;
}
