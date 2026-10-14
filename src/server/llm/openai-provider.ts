/**
 * OpenAI 相容 API provider（伺服器端）。
 *
 * 可用於 OpenAI、DeepSeek、Azure OpenAI 相容端點，或其他相容服務；
 * 只需要設定 API key 與 base URL。實際的 HTTP 呼叫及參數處理集中在 chat-client.ts，
 * 與 AI 語意批改共用同一套 JSON 模式設定。
 */
import type { LlmQuestion } from "../../lib/types";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import { requestJsonCompletion, type ChatCompletionOptions } from "./chat-client";
import type { GenerateQuestionsOutcome, LlmProvider, QuestionGenerationInput } from "./provider";

export interface OpenAiCompatibleOptions extends Omit<ChatCompletionOptions, "temperature"> {
  /** 內部名稱（預設 openai-compatible，DeepSeek 會使用 deepseek） */
  name?: string;
  /** 顯示名稱；未提供時依 name 及 model 產生 */
  label?: string;
}

export function createOpenAiCompatibleProvider(options: OpenAiCompatibleOptions): LlmProvider {
  const name = options.name ?? "openai-compatible";
  return {
    name,
    label:
      options.label ??
      (name === "deepseek"
        ? `DeepSeek API（${options.model}）`
        : `OpenAI 相容 API（${options.model}）`),
    async generateQuestions(input: QuestionGenerationInput): Promise<GenerateQuestionsOutcome> {
      const completion = await requestJsonCompletion(
        options,
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(input) },
        ],
        options.label ?? "LLM API",
      );

      const parsed = completion.data;
      const container = Array.isArray(parsed)
        ? parsed
        : ((parsed as Record<string, unknown>).questions as unknown[] | undefined) ?? [parsed];
      const questions = container.filter(
        (item): item is LlmQuestion => typeof item === "object" && item !== null,
      );
      return { questions, usage: completion.usage };
    },
  };
}