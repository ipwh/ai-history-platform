/**
 * AI 語意批改的服務層。
 *
 * 呼叫 AI 判斷填充題／短答題的答案是否達到要求，並把結果整理成介面可用的格式。
 * 任何失敗（未設定 AI、逾時、格式不合）都只會回傳 null 或帶 note 的提示，
 * 絕不令學生無法提交答案。
 *
 * 每次批改都會寫入監控記錄（成功、失敗、回退、回應時間、錯誤類別）及 LLM 用量，
 * 供教師端查看；記錄不會包含學生的答案內容或 API key。
 */
import type { AiGrading, Question } from "../../lib/types";
import { getServerConfig } from "../config";
import { resolveGrader } from "../llm";
import { buildGradingInput, parseGradingResult } from "../llm/grader";
import { categorizeLlmError, logGradingAttempt, logLlmUsage } from "./llm-usage";

/** 需要批改時使用的題目資訊（避免服務層再查一次快照） */
export interface AiGradingContext {
  question: Question;
  topicTitle: string;
  topicId?: string | null;
  sessionId?: string | null;
  studentAnswer: string;
}

/**
 * 以 AI 按語意批改一個答案。
 *
 * @returns 已驗證的批改結果；未設定 AI、題型不適用或批改失敗時回傳 null 或帶 note 的結果。
 */
export async function gradeWithAi(context: AiGradingContext): Promise<AiGrading | null> {
  const grader = resolveGrader();
  if (grader === null) return null;

  const input = buildGradingInput(context.question, context.topicTitle, context.studentAnswer);
  if (input === null) return null;

  const started = Date.now();
  const baseLog = {
    questionId: context.question.id,
    sessionId: context.sessionId ?? null,
    questionType: context.question.questionType,
    provider: grader.providerName,
  };
  const model = getServerConfig().llm.model;

  try {
    const outcome = await grader.gradeAnswer(input);
    const durationMs = Date.now() - started;
    const parsed = parseGradingResult(outcome.grading, {
      questionType: input.questionType,
      gradingPoints: input.gradingPoints,
    });

    if (parsed === null) {
      // 模型回應格式可用度不足：視為回退，交由原本的判斷方式處理
      logGradingAttempt({
        ...baseLog,
        success: false,
        fellBack: true,
        durationMs,
        errorType: "unusable-result",
      });
      logLlmUsage({
        requestType: "grading",
        provider: grader.providerName,
        model,
        topicId: context.topicId ?? null,
        success: false,
        durationMs,
        usage: outcome.usage,
        errorType: "unusable-result",
      });
      return {
        verdict: "partial",
        hitPoints: [],
        missingPoints: [],
        feedback: "",
        note: "AI 這次未能給出可用的評語，請參考參考答案及得分要點自我檢查。",
      };
    }

    logGradingAttempt({ ...baseLog, success: true, fellBack: false, durationMs, errorType: null });
    logLlmUsage({
      requestType: "grading",
      provider: grader.providerName,
      model,
      topicId: context.topicId ?? null,
      success: true,
      durationMs,
      usage: outcome.usage,
      errorType: null,
    });
    return parsed;
  } catch (error) {
    const errorType = categorizeLlmError(error);
    const durationMs = Date.now() - started;
    logGradingAttempt({ ...baseLog, success: false, fellBack: true, durationMs, errorType });
    logLlmUsage({
      requestType: "grading",
      provider: grader.providerName,
      model,
      topicId: context.topicId ?? null,
      success: false,
      durationMs,
      usage: null,
      errorType,
    });
    console.warn("[ai-grading] 語意批改失敗，沿用原本的判斷方式", errorType);
    return {
      verdict: "partial",
      hitPoints: [],
      missingPoints: [],
      feedback: "",
      note: "AI 語意批改暫時無法使用（可能是網絡或額度問題），這次只顯示參考答案及得分要點。",
    };
  }
}
