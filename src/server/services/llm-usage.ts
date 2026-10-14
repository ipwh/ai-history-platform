/**
 * LLM 用量及 AI 批改監控的服務層。
 *
 * 只記錄統計所需的資料：provider、模型、請求類型、成功與否、回應時間、token 數
 * 及錯誤「類別」。**不會**記錄 API key、完整回應內容或學生的答案內容。
 * 記錄失敗一律靜默處理，不可影響出題或批改流程。
 */
import { LlmProviderError } from "../llm/provider";
import { recordGradingLog, recordLlmUsage, type NewGradingLogInput } from "../repositories/llm-logs";
import type { LlmRequestType, LlmUsage, LlmUsageEntry } from "../../lib/types";

export function addUsage(left: LlmUsage | null, right: LlmUsage | null): LlmUsage | null {
  if (!left) return right;
  if (!right) return left;
  return {
    inputTokens:
      left.inputTokens === null && right.inputTokens === null
        ? null
        : (left.inputTokens ?? 0) + (right.inputTokens ?? 0),
    outputTokens:
      left.outputTokens === null && right.outputTokens === null
        ? null
        : (left.outputTokens ?? 0) + (right.outputTokens ?? 0),
  };
}

/** 把錯誤歸類（供教師端了解失敗原因，不記錄原始訊息內容） */
export function categorizeLlmError(error: unknown): string {
  if (error instanceof LlmProviderError) {
    const message = error.message;
    if (message.includes("逾時")) return "timeout";
    if (message.includes("沒有回傳內容") || message.includes("空白")) return "empty-response";
    if (message.includes("格式") || message.includes("JSON")) return "invalid-response";
    if (message.includes("401") || message.includes("403")) return "auth";
    if (message.includes("429")) return "rate-limit";
    if (message.includes("HTTP 5")) return "server";
    return "provider-error";
  }
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  if (error instanceof SyntaxError) return "invalid-response";
  return "unknown";
}

export interface LlmUsageLogInput extends Omit<LlmUsageEntry, "inputTokens" | "outputTokens"> {
  usage: LlmUsage | null;
}

/** 記錄一次 LLM 請求（即時出題／題庫生成／AI 批改） */
export function logLlmUsage(input: LlmUsageLogInput): void {
  try {
    recordLlmUsage({
      requestType: input.requestType as LlmRequestType,
      provider: input.provider,
      model: input.model,
      topicId: input.topicId,
      success: input.success,
      durationMs: input.durationMs,
      inputTokens: input.usage?.inputTokens ?? null,
      outputTokens: input.usage?.outputTokens ?? null,
      errorType: input.errorType,
    });
  } catch (error) {
    console.warn("[llm-usage] 無法寫入用量記錄（不影響主要流程）", error);
  }
}

/** 記錄一次 AI 語意批改（成功、失敗或回退） */
export function logGradingAttempt(input: NewGradingLogInput): void {
  try {
    recordGradingLog(input);
  } catch (error) {
    console.warn("[llm-usage] 無法寫入批改記錄（不影響主要流程）", error);
  }
}
