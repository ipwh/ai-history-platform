/**
 * Google Gemini API provider（伺服器端）。
 * 需要 GEMINI_API_KEY；未設定時不會使用此 provider。
 */
import type { LlmQuestion } from "../../lib/types";
import { buildUserPrompt, systemPromptFor } from "./prompt";
import {
  LlmProviderError,
  type GenerateQuestionsOutcome,
  type LlmProvider,
  type QuestionGenerationInput,
} from "./provider";

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string; status?: string };
}

export interface GeminiOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export function createGeminiProvider(options: GeminiOptions): LlmProvider {
  return {
    name: "gemini",
    label: `Google Gemini API（${options.model}）`,
    async generateQuestions(input: QuestionGenerationInput): Promise<GenerateQuestionsOutcome> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);
      const url = `${options.baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(
        options.model,
      )}:generateContent`;

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": options.apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPromptFor(input.stage) }] },
            contents: [{ role: "user", parts: [{ text: buildUserPrompt(input) }] }],
            generationConfig: {
              temperature: 0.6,
              responseMimeType: "application/json",
            },
          }),
          signal: controller.signal,
        });

        const payload = (await response.json()) as GeminiResponse;

        if (!response.ok) {
          const message = payload.error?.message ?? `HTTP ${response.status}`;
          throw new LlmProviderError(`Gemini API 回應錯誤：${message}`, {
            retryable: response.status === 429 || response.status >= 500,
          });
        }

        const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
        if (text.trim().length === 0) {
          throw new LlmProviderError("Gemini API 沒有回傳任何內容", { retryable: true });
        }

        const parsed: unknown = JSON.parse(text);
        return {
          questions: normalizeQuestions(parsed),
          usage: {
            inputTokens: typeof payload.usageMetadata?.promptTokenCount === "number"
              ? payload.usageMetadata.promptTokenCount
              : null,
            outputTokens: typeof payload.usageMetadata?.candidatesTokenCount === "number"
              ? payload.usageMetadata.candidatesTokenCount
              : null,
          },
        };
      } catch (error) {
        if (error instanceof LlmProviderError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new LlmProviderError("Gemini API 回應逾時，請稍後再試", { retryable: true });
        }
        throw new LlmProviderError(
          `呼叫 Gemini API 失敗：${error instanceof Error ? error.message : String(error)}`,
          { retryable: true },
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Gemini 有時會回傳單一物件而不是陣列，這裡統一處理 */
function normalizeQuestions(parsed: unknown): LlmQuestion[] {
  const container = (() => {
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.questions)) return record.questions;
    }
    return [parsed];
  })();

  const questions: LlmQuestion[] = [];
  for (const item of container) {
    if (item && typeof item === "object") {
      questions.push(item as LlmQuestion);
    }
  }
  return questions;
}
