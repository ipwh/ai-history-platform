/**
 * LLM 呼叫的共用層（伺服器端）。
 *
 * 題目生成與 AI 語意批改都需要「送出系統＋使用者訊息，取回 JSON」，
 * 因此把 OpenAI 相容 Chat Completions 及 Gemini generateContent 的細節集中在這裡，
 * 確保兩者使用一致的參數（JSON 模式、token 上限、思考模式、逾時及重試）。
 *
 * 依 DeepSeek「JSON Output」文件：必須設定 response_format = json_object、
 * prompt 內含「json」字樣，並設定 max_tokens 以免 JSON 被中途截斷；
 * JSON 模式偶爾會回傳空白內容，因此支援自動重試。
 */
import { LlmProviderError } from "./provider";
import type { LlmUsage } from "../../lib/types";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface ChatCompletionOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  /** 單次回應的 token 上限（null = 不傳送） */
  maxTokens?: number | null;
  /** 思考模式；null = 不傳送此參數（由 API 使用預設值） */
  thinking?: "enabled" | "disabled" | null;
  /** 思考強度，只在思考模式開啟時傳送 */
  reasoningEffort?: string | null;
  /** 回應內容為空時額外重試次數 */
  emptyContentRetries?: number;
  temperature?: number;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string };
}

/** API 回報的 token 用量（沒有提供時為 null） */
export interface JsonCompletionResult {
  data: unknown;
  usage: LlmUsage | null;
}

function toNumberOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function toProviderError(error: unknown, label: string): LlmProviderError {
  if (error instanceof LlmProviderError) return error;
  if (isAbortError(error)) {
    return new LlmProviderError(`${label} 回應逾時，請稍後再試`, { retryable: true });
  }
  return new LlmProviderError(
    `呼叫 ${label} 失敗：${error instanceof Error ? error.message : String(error)}`,
    { retryable: true },
  );
}

/**
 * 呼叫 OpenAI 相容的 chat/completions，並把回應內容解析成 JSON。
 * 適用於 OpenAI、DeepSeek 及其他相容服務。
 */
export async function requestJsonCompletion(
  options: ChatCompletionOptions,
  messages: ChatMessage[],
  label = "LLM API",
): Promise<JsonCompletionResult> {
  const url = `${options.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const maxAttempts = 1 + Math.max(0, options.emptyContentRetries ?? 0);

  const body: Record<string, unknown> = {
    model: options.model,
    response_format: { type: "json_object" },
    messages,
  };
  // 思考模式不支援 temperature（傳送亦不會生效），因此只在非思考模式時傳送
  if (options.thinking !== "enabled") body.temperature = options.temperature ?? 0.6;
  if (options.maxTokens !== null && options.maxTokens !== undefined) {
    body.max_tokens = options.maxTokens;
  }
  if (options.thinking !== null && options.thinking !== undefined) {
    body.thinking = { type: options.thinking };
    if (options.thinking === "enabled" && options.reasoningEffort) {
      body.reasoning_effort = options.reasoningEffort;
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    let emptyResponses = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: ["Bearer", options.apiKey].join(" "),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const payload = (await response.json()) as ChatCompletionResponse;

      if (!response.ok) {
        const message = payload.error?.message ?? `HTTP ${response.status}`;
        throw new LlmProviderError(`${label} 回應錯誤：${message}`, {
          retryable: response.status === 429 || response.status >= 500,
        });
      }

      const text = payload.choices?.[0]?.message?.content ?? "";
      if (text.trim().length === 0) {
        // JSON 模式偶爾會回傳空白內容，重試通常可以成功
        emptyResponses += 1;
        continue;
      }

      return {
        data: JSON.parse(text),
        usage: {
          inputTokens: toNumberOrNull(payload.usage?.prompt_tokens),
          outputTokens: toNumberOrNull(payload.usage?.completion_tokens),
        },
      };
    }

    throw new LlmProviderError(
      `${label} 連續 ${emptyResponses} 次沒有回傳內容（JSON 模式的已知偶發問題），請稍後再試`,
      { retryable: true },
    );
  } catch (error) {
    throw toProviderError(error, label);
  } finally {
    clearTimeout(timer);
  }
}

/** 呼叫 Google Gemini 的 generateContent，並把回應內容解析成 JSON */
export async function requestGeminiJsonCompletion(
  options: ChatCompletionOptions,
  messages: ChatMessage[],
): Promise<JsonCompletionResult> {
  const label = "Gemini API";
  const url = `${options.baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(
    options.model,
  )}:generateContent`;

  const systemMessages = messages.filter((message) => message.role === "system");
  const userMessages = messages.filter((message) => message.role === "user");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": options.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: systemMessages.map((message) => ({ text: message.content })),
        },
        contents: userMessages.map((message) => ({
          role: "user",
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          temperature: options.temperature ?? 0.6,
          responseMimeType: "application/json",
          ...(options.maxTokens ? { maxOutputTokens: options.maxTokens } : {}),
        },
      }),
      signal: controller.signal,
    });

    const payload = (await response.json()) as GeminiResponse;

    if (!response.ok) {
      const message = payload.error?.message ?? `HTTP ${response.status}`;
      throw new LlmProviderError(`${label} 回應錯誤：${message}`, {
        retryable: response.status === 429 || response.status >= 500,
      });
    }

    const text =
      payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    if (text.trim().length === 0) {
      throw new LlmProviderError(`${label} 沒有回傳任何內容`, { retryable: true });
    }

    return {
      data: JSON.parse(text),
      usage: {
        inputTokens: toNumberOrNull(payload.usageMetadata?.promptTokenCount),
        outputTokens: toNumberOrNull(payload.usageMetadata?.candidatesTokenCount),
      },
    };
  } catch (error) {
    throw toProviderError(error, label);
  } finally {
    clearTimeout(timer);
  }
}
