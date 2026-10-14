/**
 * Provider 解析：依環境變數決定使用哪個 LLM provider。
 * 沒有任何憑證時自動使用本地示範生成，確保網站仍可啟動及示範。
 */
import { getServerConfig, isDemoLlmMode, LLM_PROVIDER_LABELS } from "../config";
import { createGeminiProvider } from "./gemini-provider";
import { createChatGrader, createGeminiGrader, type AnswerGrader } from "./grader";
import { mockProvider } from "./mock-provider";
import { createOpenAiCompatibleProvider } from "./openai-provider";
import type { LlmProvider } from "./provider";

export interface ResolvedProvider {
  provider: LlmProvider;
  /** 是否處於本地示範模式（沒有真實 LLM） */
  demoMode: boolean;
  /** 需要告知使用者的訊息（例如設定不完整） */
  notice: string | null;
}

export function resolveProvider(): ResolvedProvider {
  const config = getServerConfig();
  const {
    provider,
    apiKey,
    baseUrl,
    model,
    maxTokens,
    thinking,
    reasoningEffort,
    emptyContentRetries,
    requestTimeoutMs: timeoutMs,
  } = config.llm;

  if (provider === "mock") {
    return {
      provider: mockProvider,
      demoMode: true,
      notice: null,
    };
  }

  if (apiKey === null || baseUrl === null || model === null) {
    return {
      provider: mockProvider,
      demoMode: true,
      notice: `已設定 LLM_PROVIDER=${provider}，但缺少 API key 或模型設定，現時使用本地示範生成。請參考 README 設定環境變數。`,
    };
  }

  if (provider === "gemini") {
    return {
      provider: createGeminiProvider({ apiKey, baseUrl, model, timeoutMs }),
      demoMode: false,
      notice: null,
    };
  }

  if (provider === "deepseek") {
    return {
      provider: createOpenAiCompatibleProvider({
        apiKey,
        baseUrl,
        model,
        timeoutMs,
        name: "deepseek",
        maxTokens,
        thinking,
        reasoningEffort,
        emptyContentRetries,
      }),
      demoMode: false,
      notice: null,
    };
  }

  return {
    provider: createOpenAiCompatibleProvider({
      apiKey,
      baseUrl,
      model,
      timeoutMs,
      maxTokens,
      thinking,
      reasoningEffort,
      emptyContentRetries,
    }),
    demoMode: false,
    notice: null,
  };
}

export interface LlmStatus {
  provider: string;
  providerLabel: string;
  configured: boolean;
  demoMode: boolean;
  notice: string | null;
}

/**
 * 解析 AI 語意批改器（填充題／短答題）。
 * 本地示範模式、未設定憑證或停用批改時回傳 null，呼叫者會沿用原本的判斷方式。
 */
export function resolveGrader(): AnswerGrader | null {
  const config = getServerConfig();
  const {
    provider,
    apiKey,
    baseUrl,
    model,
    maxTokens,
    thinking,
    reasoningEffort,
    emptyContentRetries,
    gradingEnabled,
    requestTimeoutMs: timeoutMs,
  } = config.llm;

  if (!gradingEnabled) return null;
  if (provider === "mock" || apiKey === null || baseUrl === null || model === null) return null;

  const shared = { apiKey, baseUrl, model, timeoutMs, maxTokens, thinking, reasoningEffort, emptyContentRetries };
  if (provider === "gemini") return createGeminiGrader(shared);

  return createChatGrader({
    ...shared,
    providerName: provider,
    label:
      provider === "deepseek" ? `DeepSeek API（${model}）` : `OpenAI 相容 API（${model}）`,
  });
}

/** 目前是否可使用 AI 語意批改（供介面顯示） */
export function isAiGradingAvailable(): boolean {
  return resolveGrader() !== null;
}

export function describeLlm(): LlmStatus {
  const config = getServerConfig();
  const resolved = resolveProvider();
  return {
    provider: resolved.provider.name,
    providerLabel: resolved.provider.label,
    configured: config.llm.configured,
    demoMode: isDemoLlmMode(config),
    notice: resolved.notice,
  };
}

/** 環境變數名稱的顯示標籤（供健康檢查及錯誤訊息使用） */
export const PROVIDER_ENV_LABELS: Record<string, string> = LLM_PROVIDER_LABELS;

export type { LlmProvider };
