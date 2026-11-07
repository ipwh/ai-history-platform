/**
 * 受控評估的 live transport（Sprint 33）。
 *
 * ── 為甚麼這是「共用 adapter」而不是另一個 provider ──────────────────
 * 這裡**不**自己組 HTTP 請求：它呼叫 `llm/stream-chat-completion.ts` 的
 * `openChatStream()`／`consume()`——即正式學伴 route 使用的那一個。因此 timeout、
 * 錯誤分類、SSE 解析、token usage 及 abort 行為與學生實際看到的一致。
 *
 * ── 提示詞 ──────────────────────────────────────────────────────────
 * 用與 route 相同的 `buildTutorSystemPrompt()`，並先經 `findTutorGrounding()` 與
 * `classifyTutorAnswerability()`，因此評估不會繞過正式的安全政策、教材規則或
 * 可答性政策。深度用 `resolveTutorReplyDepth()`，`max_tokens` 用與 route 相同的
 * `min(LLM_MAX_TOKENS, 深度上限)` 封頂。
 *
 * ── 邊界 ────────────────────────────────────────────────────────────
 *   - 不寫入資料庫、不經 `reserveAiOperation`（不影響學生配額）；
 *   - 不記錄 API key（只回傳 token 用量及錯誤類別）；
 *   - 每次呼叫只發一個請求（重試由 `tutor-eval-engine` 決定並計入預算）。
 */
import {
  buildChatCompletionsEndpoint,
  openChatStream,
} from "../../src/server/llm/stream-chat-completion";
import {
  buildTutorGlossary,
  buildTutorSystemPrompt,
  findTutorGrounding,
  loadTutorCurriculumIndex,
  type TutorCurriculumIndex,
} from "../../src/server/services/tutor-grounding";
import { classifyTutorAnswerability } from "../../src/server/services/tutor-answerability";
import { isUnclearTutorQuery, normalizeTutorQuery } from "../../src/server/services/tutor-query";
import {
  resolveTutorReplyDepth,
  tutorMaxSourcesForDepth,
} from "../../src/server/services/tutor-depth";
import type {
  TutorEvalCallRequest,
  TutorEvalCallResult,
  TutorEvalErrorCode,
  TutorEvalTransport,
} from "../../src/server/quality/tutor-eval-engine";
import type { TutorReplyDepth } from "@/lib/types";

/** 與 `src/app/api/tutor/chat/route.ts` 的 `MAX_TOKENS_BY_DEPTH` 一致 */
export const DEPTH_TOKEN_CAPS: Record<TutorReplyDepth, number> = {
  standard: 1_000,
  advanced: 1_500,
  challenge: 2_000,
};

export interface LiveTransportConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxTokensCap: number | null;
  thinking: "enabled" | "disabled" | null;
  reasoningEffort: string | null;
}

export interface EvalCaseInput {
  id: string;
  query: string;
  history?: readonly string[];
}

export interface EvalPrompt {
  systemPrompt: string;
  userMessage: string;
  history: { role: "user" | "assistant"; content: string }[];
  depth: TutorReplyDepth;
  maxOutputTokens: number;
  stateFromClassifier: string;
  confidence: string | null;
  groundingStatus: string;
  passageCount: number;
}

function mapErrorCode(code: string | null): TutorEvalErrorCode {
  switch (code) {
    case "rate-limited":
      return "rate-limited";
    case "server-error":
      return "server-error";
    case "timeout":
      return "timeout";
    case "empty":
      return "empty";
    case "network":
    case "aborted":
      return "network";
    default:
      return "invalid-response";
  }
}

/**
 * 組出與 route 相同的提示詞，並回傳本回合的診斷資訊（不發出任何請求）。
 * 測試與執行都用這一個函式，確保「評估看到的就是學生看到的」。
 */
export function buildEvalPrompt(
  config: LiveTransportConfig,
  cases: readonly EvalCaseInput[],
  caseId: string,
  curriculum: TutorCurriculumIndex = loadTutorCurriculumIndex(),
): EvalPrompt {
  const entry = cases.find((item) => item.id === caseId);
  if (entry === undefined) throw new Error(`找不到案例：${caseId}`);

  const normalized = normalizeTutorQuery(entry.query);
  const history = (entry.history ?? []).map((content, index) => ({
    role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content,
  }));
  const groundingContext = history
    .filter((message) => message.role === "user")
    .map((message) => normalizeTutorQuery(message.content));
  const depth = resolveTutorReplyDepth("auto", entry.query, null);
  const grounding = findTutorGrounding(normalized, groundingContext, curriculum, {
    maxSources: tutorMaxSourcesForDepth(depth),
  });
  const decision = classifyTutorAnswerability({
    message: entry.query,
    curriculum,
    grounding,
    hasHistoryContext: history.length > 0,
    unclear: isUnclearTutorQuery(entry.query, curriculum, history.length > 0),
  });
  const glossary = buildTutorGlossary(
    grounding.topicId,
    [entry.query, ...grounding.passages.map((passage) => passage.promptText)].join("\n"),
  );
  const systemPrompt = buildTutorSystemPrompt({
    grounding,
    glossary,
    // 評估不啟用外部網頁補充：避免外網內容混入品質評估，亦避免額外網絡請求。
    webSources: [],
    depth,
    answerability: decision,
  });

  return {
    systemPrompt,
    userMessage: entry.query,
    history,
    depth,
    maxOutputTokens: Math.min(
      config.maxTokensCap ?? DEPTH_TOKEN_CAPS[depth],
      DEPTH_TOKEN_CAPS[depth],
    ),
    stateFromClassifier: decision.state,
    confidence: decision.confidence,
    groundingStatus: grounding.status,
    passageCount: grounding.passages.length,
  };
}

/**
 * 建立 live transport。
 *
 * `approved` 作硬性檢查：實際 provider／model 與批准值不同即拋出錯誤
 * （Sprint 33 §4「Provider model 與批准 model 不一致 → 停止」）。
 */
export function createLiveTransport(
  config: LiveTransportConfig,
  cases: readonly EvalCaseInput[],
  approved: { provider: string; model: string },
): TutorEvalTransport {
  if (config.provider !== approved.provider || config.model !== approved.model) {
    throw new Error(
      `provider／model 與批准設定不一致：實際 ${config.provider}/${config.model}，批准 ${approved.provider}/${approved.model}`,
    );
  }
  const endpoint = buildChatCompletionsEndpoint(config.baseUrl);
  const curriculum = loadTutorCurriculumIndex();

  return {
    name: "live-stream-chat-completion",
    provider: config.provider,
    model: config.model,
    async call(request: TutorEvalCallRequest): Promise<TutorEvalCallResult> {
      const prompt = buildEvalPrompt(config, cases, request.caseId, curriculum);
      const opened = await openChatStream({
        endpoint,
        apiKey: config.apiKey,
        model: config.model,
        messages: [
          { role: "system", content: prompt.systemPrompt },
          ...prompt.history,
          { role: "user", content: prompt.userMessage },
        ],
        maxTokens: Math.min(prompt.maxOutputTokens, request.maxOutputTokens),
        thinking: config.thinking,
        reasoningEffort: config.reasoningEffort,
        temperature: 0.4,
        timeoutMs: config.timeoutMs,
        // 只有評估要求 usage；正式 route 的請求保持不變（Sprint 33 保 behaviour）。
        includeUsage: true,
      });

      if (opened.kind === "error") {
        return {
          ok: false,
          usage: null,
          errorCode: mapErrorCode(opened.errorCode),
          outcomeUncertain: opened.outcomeUncertain,
        };
      }

      const result = await opened.consume();
      return {
        ok: result.ok,
        answer: result.ok ? result.text : null,
        usage: result.usage,
        errorCode: result.ok ? undefined : mapErrorCode(result.errorCode),
        outcomeUncertain: result.outcomeUncertain,
      };
    },
  };
}
