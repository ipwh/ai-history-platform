/**
 * AI 語意批改（填充題）。
 *
 * 目的：避免「逐字比對」造成過嚴的判斷，例如學生答「文藝復興時期」而標準答案是
 * 「文藝復興」時被判錯。
 *
 * 設計原則：
 *   1. 模型只判斷「學生的答案在意思上是否達到要求」，不可以改變標準答案。
 *   2. 模型的輸出一定要驗證（見 parseGradingResult），不合格就當作沒有 AI 結果。
 *   3. 批改失敗（逾時、格式錯誤）不可影響學生提交答案：呼叫者會回退到原本的判斷方式。
 *   4. 這不是 HKDSE 官方評分，介面必須明確說明。
 */
import type { AiGrading, LlmUsage, Question, QuestionType } from "../../lib/types";
import { llmGradingSchema } from "../../lib/types";
import { requestGeminiJsonCompletion, requestJsonCompletion, type ChatMessage } from "./chat-client";
import { GRADING_SYSTEM_PROMPT, buildGradingPrompt } from "./prompt";

export interface AnswerGradingInput {
  topicTitle: string;
  questionType: Extract<QuestionType, "fill">;
  question: string;
  /** 標準答案（填充題為需要填寫的字詞） */
  referenceAnswer: string;
  acceptedAnswers: string[];
  gradingPoints: string[];
  knowledgePoint: string;
  explanation: string;
  studentAnswer: string;
}

export interface LlmAnswerGrading {
  verdict: "correct" | "partial" | "incorrect";
  hitPointIndexes: number[];
  feedback: string;
}

/** 批改結果及 API 回報的 token 用量 */
export interface GradingOutcome {
  grading: LlmAnswerGrading;
  usage: LlmUsage | null;
}

export interface AnswerGrader {
  /** provider 內部名稱，例如 deepseek */
  readonly providerName: string;
  readonly label: string;
  gradeAnswer(input: AnswerGradingInput): Promise<GradingOutcome>;
}

export interface GraderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxTokens?: number | null;
  thinking?: "enabled" | "disabled" | null;
  reasoningEffort?: string | null;
  emptyContentRetries?: number;
}

function gradingMessages(input: AnswerGradingInput): ChatMessage[] {
  return [
    { role: "system", content: GRADING_SYSTEM_PROMPT },
    { role: "user", content: buildGradingPrompt(input) },
  ];
}

function asGrading(payload: unknown): LlmAnswerGrading {
  const parsed = llmGradingSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      `AI 批改回應格式不正確：${parsed.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("；")}`,
    );
  }
  return {
    verdict: parsed.data.verdict,
    hitPointIndexes: parsed.data.hitPointIndexes,
    feedback: parsed.data.feedback.trim(),
  };
}

/** OpenAI 相容（含 DeepSeek）的批改器 */
export function createChatGrader(options: GraderOptions & { providerName: string; label: string }): AnswerGrader {
  return {
    providerName: options.providerName,
    label: options.label,
    async gradeAnswer(input: AnswerGradingInput): Promise<GradingOutcome> {
      const completion = await requestJsonCompletion(
        { ...options, temperature: 0 },
        gradingMessages(input),
        options.label,
      );
      return { grading: asGrading(completion.data), usage: completion.usage };
    },
  };
}

/** Google Gemini 的批改器 */
export function createGeminiGrader(options: GraderOptions): AnswerGrader {
  return {
    providerName: "gemini",
    label: "Google Gemini API",
    async gradeAnswer(input: AnswerGradingInput): Promise<GradingOutcome> {
      const completion = await requestGeminiJsonCompletion(
        { ...options, temperature: 0 },
        gradingMessages(input),
      );
      return { grading: asGrading(completion.data), usage: completion.usage };
    },
  };
}

/** 只有填充題需要（且可以）進行語意批改 */
export function supportsAiGrading(questionType: QuestionType): boolean {
  return questionType === "fill";
}

export interface GradingParseContext {
  questionType: Extract<QuestionType, "fill">;
  gradingPoints: string[];
}

/**
 * 把模型輸出轉成介面可用的批改結果。
 * 不合法（例如要點索引越界、沒有回饋文字）時回傳 null，呼叫者會沿用原本的判斷。
 */
export function parseGradingResult(
  raw: LlmAnswerGrading,
  context: GradingParseContext,
): AiGrading | null {
  const points = context.gradingPoints;
  const hitPoints: string[] = [];
  for (const index of new Set(raw.hitPointIndexes)) {
    const point = points[index];
    if (point !== undefined && !hitPoints.includes(point)) hitPoints.push(point);
  }
  const missingPoints = points.filter((point) => !hitPoints.includes(point));

  const feedback = raw.feedback.trim();
  const verdict = raw.verdict;

  return {
    verdict,
    hitPoints,
    missingPoints,
    feedback:
      feedback.length > 0
        ? feedback
        : verdict === "correct"
          ? "你的答案與標準答案意思相同。"
          : "你的答案與標準答案有差異，請參考解釋再整理一次。",
    note: null,
  };
}

/** 由題目及學生答案建立批改輸入 */
export function buildGradingInput(
  question: Question,
  topicTitle: string,
  studentAnswer: string,
): AnswerGradingInput | null {
  const questionType = question.questionType;
  if (questionType === "mc") return null;
  return {
    topicTitle,
    questionType,
    question: question.question,
    referenceAnswer: question.correctAnswer,
    acceptedAnswers: question.acceptedAnswers,
    gradingPoints: question.gradingPoints,
    knowledgePoint: question.knowledgePoint,
    explanation: question.explanation,
    studentAnswer,
  };
}
