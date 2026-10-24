/**
 * 獨立批改端點（POST /api/quiz/submit）的服務層。
 *
 * 設計原則：**答案只存在伺服器**。
 *   - 學生端取得的題目不含標準答案（見 lib/student-question）。
 *   - 學生提交作答後，由這裡比對資料庫中的標準答案，再把結果、正確答案及解釋回傳。
 *
 * 兩種使用情境：
 *   1. 帶 `sessionId`：沿用練習流程（`submitAnswer`），會記錄作答、計算進度，
 *      並在需要時使用 AI 語意批改；重複提交不會改變分數。
 *   2. 不帶 `sessionId`：直接以題庫題目批改（自學／單題核對）。只接受已發布且
 *      結構上可作答的題目，避免未發布或待教師覆核的題目成為取得答案的入口。
 *      這條路徑只做確定性批改（逐字比對 + 歷史專名同義詞庫），不呼叫 AI，
 *      以免任何人重複提交即可無上限消耗模型額度。
 */
import { z } from "zod";

import type { QuestionFeedback } from "../../lib/types";
import { ApiRouteError } from "../http";
import { getQuestion } from "../repositories/questions";
import { getTopic } from "../repositories/topics";
import { buildFeedback, PracticeServiceError, submitAnswer } from "./practice-service";
import { gradeSubmittedAnswer } from "./grading";
import { checkQuestionServable } from "./question-servability";

export const quizSubmissionSchema = z.object({
  /** 匿名示範模式下由前端提供；已登入時一律以工作階段為準 */
  learnerId: z.string().min(1).max(128).optional(),
  /** 練習場境（可省略）：提供時會記錄作答並回傳進度 */
  sessionId: z.string().min(1).max(128).optional(),
  questionId: z.string().min(1).max(128),
  /** 單一作答（字串）或多個空格（陣列） */
  studentAnswer: z.union([
    z.string().max(2000),
    z.array(z.string().max(2000)).min(1).max(10),
  ]),
});
export type QuizSubmissionInput = z.infer<typeof quizSubmissionSchema>;

export interface QuizSubmissionResult {
  questionId: string;
  /** 學生提交的答案（原樣，未經正規化） */
  studentAnswer: string;
  autoGraded: boolean;
  isCorrect: boolean | null;
  correctAnswer: string;
  acceptedAnswers: string[];
  explanation: string;
  knowledgePoint: string;
  gradingPoints: string[];
  sourceExcerpt: string | null;
  sourceLocation: string | null;
  sourceBlockIds: string[];
  sourceWithheld: boolean;
  reviewFlag: "uncertain-answer" | null;
  aiLimitReached: boolean;
  /** 這次提交是否已記錄（只有帶 sessionId 的提交會寫入作答記錄） */
  recorded: boolean;
  /** 已作答題數；沒有練習場境時為 null */
  answeredCount: number | null;
  /** 練習總題數；沒有練習場境時為 null */
  totalQuestions: number | null;
}

function toSubmissionResult(
  feedback: QuestionFeedback,
  extra: Pick<QuizSubmissionResult, "studentAnswer" | "recorded" | "answeredCount" | "totalQuestions">,
): QuizSubmissionResult {
  return {
    questionId: feedback.questionId,
    studentAnswer: extra.studentAnswer,
    autoGraded: feedback.autoGraded,
    isCorrect: feedback.isCorrect,
    correctAnswer: feedback.correctAnswer,
    acceptedAnswers: feedback.acceptedAnswers,
    explanation: feedback.explanation,
    knowledgePoint: feedback.knowledgePoint,
    gradingPoints: feedback.gradingPoints,
    sourceExcerpt: feedback.sourceExcerpt,
    sourceLocation: feedback.sourceLocation,
    sourceBlockIds: feedback.sourceBlockIds,
    sourceWithheld: feedback.sourceWithheld,
    reviewFlag: feedback.reviewFlag,
    aiLimitReached: feedback.aiLimitReached,
    recorded: extra.recorded,
    answeredCount: extra.answeredCount,
    totalQuestions: extra.totalQuestions,
  };
}

function answerAsText(answer: string | string[]): string {
  return typeof answer === "string" ? answer.trim() : answer.map((part) => part.trim()).join(" ／ ");
}

/**
 * 批改一次提交。
 *
 * `learnerId` 由路由層以工作階段解析後傳入，不接受呼叫端自行指定他人的 ID。
 */
export async function submitQuizAnswer(
  input: QuizSubmissionInput & { learnerId: string },
): Promise<QuizSubmissionResult> {
  const studentAnswer = answerAsText(input.studentAnswer);
  if (studentAnswer.trim().length === 0) {
    throw new ApiRouteError("請先作答再提交。", 400);
  }

  if (input.sessionId) {
    const result = await submitAnswer(
      input.sessionId,
      input.learnerId,
      input.questionId,
      input.studentAnswer,
    );
    return toSubmissionResult(result.feedback, {
      studentAnswer,
      recorded: result.recorded,
      answeredCount: result.answeredCount,
      totalQuestions: result.totalQuestions,
    });
  }

  const question = getQuestion(input.questionId);
  if (!question) {
    throw new ApiRouteError("找不到指定的題目", 404);
  }
  // 與建立練習使用同一道閘門：未發布的課題不可透過批改端點取得題目及答案。
  const topic = getTopic(question.topicId);
  if (!topic || !topic.published) {
    throw new ApiRouteError("找不到指定的題目", 404);
  }
  if (question.status !== "published") {
    throw new ApiRouteError("這條題目目前不開放作答。", 409);
  }
  if (question.teacherConfirmationRequired || !checkQuestionServable(question).ok) {
    throw new PracticeServiceError(
      "這條題目正在教師覆核中，暫時不能作答。",
      409,
    );
  }

  const outcome = gradeSubmittedAnswer(question, input.studentAnswer);
  const feedback = buildFeedback(
    question,
    studentAnswer,
    { autoGraded: outcome.autoGraded, isCorrect: outcome.isCorrect },
    false,
    outcome.uncertain === true && outcome.isCorrect !== true ? "uncertain-answer" : null,
  );

  return toSubmissionResult(feedback, {
    studentAnswer,
    recorded: false,
    answeredCount: null,
    totalQuestions: null,
  });
}
