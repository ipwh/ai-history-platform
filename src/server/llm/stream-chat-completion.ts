/**
 * 學伴串流對話的共用 adapter（Sprint 33）。
 *
 * ── 為甚麼要抽出來 ────────────────────────────────────────────────────
 * Sprint 32 發現：學伴的 upstream 呼叫內嵌在 `src/app/api/tutor/chat/route.ts`
 * （`openUpstream()` 直接 `fetch`），而受控評估需要同一條路徑才能證明「評估用的
 * 就是學生用的」。若評估自行寫一套 fetch，兩者的 timeout、錯誤分類、串流解析及
 * 參數處理就會各自漂移，評估結果也不能代表正式行為。
 *
 * 因此這裡把純技術部分集中：組裝請求、開啟連線（含逾時）、解析 SSE、取得 token
 * usage、錯誤分類。**業務決策留在呼叫端**：
 *   - route 仍負責 SSE `meta`／`delta`／`done` 事件、空白回應重試、訊息保存；
 *   - 評估工具只取最終文字與用量。
 *
 * ── 安全 ────────────────────────────────────────────────────────────
 *   - 不記錄、不回傳 `authorization` header 或 API key；
 *   - 只把 HTTP 狀態碼及錯誤類別往外傳；
 *   - 不改變既有 endpoint、model、messages 的處理方式。
 */

export interface StreamChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamChatOptions {
  /** 完整 chat/completions 端點（由呼叫端用既有 `buildDeepSeekEndpoint` 之類方式組出） */
  endpoint: string;
  apiKey: string | null;
  model: string | null;
  messages: readonly StreamChatMessage[];
  maxTokens: number;
  /** 思考模式；`null` = 不傳送此參數 */
  thinking?: "enabled" | "disabled" | null;
  reasoningEffort?: string | null;
  temperature?: number;
  timeoutMs: number;
  /**
   * 是否要求供應商在串流最後回傳 usage（`stream_options.include_usage`）。
   *
   * 預設 `false`：正式學伴 route 保持原本請求不變（不多送參數、不多收一段
   * usage chunk），避免改變學生可見行為。受控評估會設為 `true` 以取得實際 token 數。
   */
  includeUsage?: boolean;
  /** 逐段回呼；route 用來轉成 SSE delta */
  onDelta?: (delta: string) => void;
  /** 外部取消（route 的 client 斷線） */
  signal?: AbortSignal;
}

export type StreamChatErrorCode =
  | "missing-api-key"
  | "timeout"
  | "network"
  | "rate-limited"
  | "server-error"
  | "invalid-response"
  | "empty"
  | "aborted";

export interface StreamChatUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface StreamChatResult {
  ok: boolean;
  text: string;
  usage: StreamChatUsage | null;
  errorCode: StreamChatErrorCode | null;
  /**
   * 供應商可能已處理請求，但本地沒有取得完整回覆（逾時、連線中斷）。
   *
   * 用途：評估工具不可對這類情況自動重試，因為對方可能已計費。
   */
  outcomeUncertain: boolean;
  /** HTTP 狀態碼（連線階段失敗時為 null） */
  status: number | null;
  /** 429 時供應商建議的等待時間（毫秒），沒有則為 null */
  retryAfterMs: number | null;
}

const MAX_ERROR_BODY_CHARS = 300;

/** 由 `Retry-After`（秒或 HTTP 日期）取出毫秒；無法解析時回傳 null */
export function parseRetryAfterMs(header: string | null): number | null {
  if (header === null) return null;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    const delta = date - Date.now();
    return delta > 0 ? delta : 0;
  }
  return null;
}

function toUsageNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 從一個 SSE `data:` payload 取出 delta 文字（保留既有 route 的容錯行為） */
export function extractStreamDelta(data: string): string | null {
  if (data === "[DONE]") return null;
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || typeof choices[0] !== "object" || choices[0] === null) {
    return null;
  }
  const delta = (choices[0] as { delta?: unknown }).delta;
  if (typeof delta !== "object" || delta === null) return null;
  const content = (delta as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

/** 從一個 SSE `data:` payload 取出 usage（供應商未必提供） */
export function extractStreamUsage(data: string): StreamChatUsage | null {
  if (data === "[DONE]") return null;
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const usage = (payload as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return null;
  const inputTokens = toUsageNumber((usage as { prompt_tokens?: unknown }).prompt_tokens);
  const outputTokens = toUsageNumber((usage as { completion_tokens?: unknown }).completion_tokens);
  if (inputTokens === null && outputTokens === null) return null;
  return { inputTokens, outputTokens };
}

function buildRequestBody(options: StreamChatOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    stream: true,
    max_tokens: options.maxTokens,
  };
  // 思考模式不支援 temperature（傳送亦不會生效），因此只在非思考模式時傳送。
  if (options.thinking !== "enabled") body.temperature = options.temperature ?? 0.4;
  if (options.thinking !== null && options.thinking !== undefined) {
    body.thinking = { type: options.thinking };
    if (options.thinking === "enabled" && options.reasoningEffort) {
      body.reasoning_effort = options.reasoningEffort;
    }
  }
  if (options.includeUsage === true) {
    body.stream_options = { include_usage: true };
  }
  return body;
}

/**
 * 送出一串流對話請求，讀完整個回覆後回傳最終文字及用量。
 *
 * 行為與原本 route 內的實作一致：
 *   - 逐行解析 `data:`，忽略 `[DONE]` 及無法解析的 payload；
 *   - payload 結構不符（JSON 壞掉）視為 `invalid-response`（原本會拋 `TUTOR_LLM_STREAM_ERROR`）；
 *   - 完全沒有文字視為 `empty`（原本會拋 `TUTOR_LLM_EMPTY_RESPONSE`）；
 *   - 連線階段失敗視為 `network`／`timeout`（原本拋 `TUTOR_LLM_UNAVAILABLE`）；
 *   - 非 2xx 視為 `rate-limited`（429）或 `server-error`（其餘）。
 */
export interface OpenedChatStream {
  kind: "opened";
  /** HTTP 狀態碼（2xx） */
  status: number;
  /** 讀完整個串流；逐段經 `onDelta` 回呼 */
  consume(options?: { onDelta?: (delta: string) => void; signal?: AbortSignal }): Promise<StreamChatResult>;
}

export interface FailedChatStream {
  kind: "error";
  errorCode: StreamChatErrorCode;
  status: number | null;
  retryAfterMs: number | null;
  /** 供應商錯誤內容的少量文字（不含 header／key） */
  detail: string;
  outcomeUncertain: boolean;
}

export type OpenChatStreamResult = OpenedChatStream | FailedChatStream;

function failed(
  errorCode: StreamChatErrorCode,
  extra: Partial<FailedChatStream> = {},
): FailedChatStream {
  return {
    kind: "error",
    errorCode,
    status: null,
    retryAfterMs: null,
    detail: "",
    outcomeUncertain: false,
    ...extra,
  };
}

/**
 * 只建立連線並檢查 HTTP 狀態；**不讀取內容**。
 *
 * 為甚麼要分成兩步：正式 route 必須在**開始串流之前**以 503 回報「供應商 5xx／
 * 無法連線」，否則學生會看到 200 之後才出現錯誤訊息（既有行為，Sprint 33 回歸測試
 * 明確要求保留）。評估工具則可以直接呼叫 `streamChatCompletion`。
 */
export async function openChatStream(
  options: StreamChatOptions,
): Promise<OpenChatStreamResult> {
  if (options.apiKey === null || options.apiKey.trim().length === 0) {
    return failed("missing-api-key");
  }
  if (options.model === null || options.model.trim().length === 0) {
    return failed("missing-api-key");
  }
  if (options.signal !== undefined && options.signal.aborted) {
    return failed("aborted");
  }

  const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
  const signal =
    options.signal === undefined ? timeoutSignal : AbortSignal.any([timeoutSignal, options.signal]);

  let response: Response;
  try {
    response = await fetch(options.endpoint, {
      method: "POST",
      headers: {
        authorization: ["Bearer", options.apiKey].join(" "),
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify(buildRequestBody(options)),
      signal,
    });
  } catch (error) {
    if (options.signal !== undefined && options.signal.aborted) {
      return failed("aborted");
    }
    const timedOut =
      (timeoutSignal.aborted as boolean) ||
      (error instanceof Error && error.name === "TimeoutError");
    // 逾時／連線中斷：請求可能已送達並被處理 → 結果不確定，不可自動重試。
    return failed(timedOut ? "timeout" : "network", { outcomeUncertain: true });
  }

  if (!response.ok) {
    const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
    let detail = "";
    try {
      detail = (await response.text()).slice(0, MAX_ERROR_BODY_CHARS);
    } catch {
      detail = "";
    }
    return failed(response.status === 429 ? "rate-limited" : "server-error", {
      status: response.status,
      retryAfterMs,
      detail,
    });
  }

  if (response.body === null) {
    return failed("invalid-response", { status: response.status });
  }

  return {
    kind: "opened",
    status: response.status,
    consume: async (consumeOptions = {}) =>
      readChatStream(response, response.status, consumeOptions, timeoutSignal),
  };
}

/** 讀取已開啟的串流（與原本 route 內的 relay 行為一致） */
async function readChatStream(
  response: Response,
  status: number,
  options: { onDelta?: (delta: string) => void; signal?: AbortSignal },
  timeoutSignal: AbortSignal,
): Promise<StreamChatResult> {
  const base: StreamChatResult = {
    ok: false,
    text: "",
    usage: null,
    errorCode: null,
    outcomeUncertain: false,
    status,
    retryAfterMs: null,
  };

  const reader = response.body!.getReader();
  /**
   * 外部取消（route 的 client 斷線）必須真的中止讀取（Sprint 34 修正）。
   *
   * Sprint 33 把串流邏輯抽出時，只把 signal 傳到 `consume()`，而 `fetch` 是在
   * `openChatStream()` 時建立的，於是「學生關掉分頁」實際上不會中止上游請求：
   * 伺服器會繼續讀完整個回應（繼續計費）直到 `LLM_REQUEST_TIMEOUT_MS`。這裡補上
   * reader 層的取消，令 signal 一觸發即停止讀取。
   */
  if (options.signal !== undefined) {
    if (options.signal.aborted) {
      await reader.cancel().catch(() => undefined);
      return { ...base, errorCode: "aborted", outcomeUncertain: true };
    }
    options.signal.addEventListener("abort", () => void reader.cancel().catch(() => undefined), {
      once: true,
    });
  }
  const decoder = new TextDecoder();
  let pending = "";
  let answer = "";
  let usage: StreamChatUsage | null = null;
  let malformed = false;

  const handleLine = (line: string): void => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (data === "[DONE]") return;
    const parsedUsage = extractStreamUsage(data);
    if (parsedUsage !== null) usage = parsedUsage;
    let delta: string | null;
    try {
      JSON.parse(data);
      delta = extractStreamDelta(data);
    } catch {
      malformed = true;
      return;
    }
    if (delta === null) return;
    answer += delta;
    options.onDelta?.(delta);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
      if (malformed) break;
    }
    if (!malformed) {
      pending += decoder.decode();
      if (pending.length > 0) handleLine(pending);
    }
  } catch {
    // 串流中途斷線：先把已緩衝的完整行處理掉，再回報不確定（不要丟掉已收到的文字）。
    for (const line of pending.split(/\r?\n/)) handleLine(line);
    return {
      ok: false,
      text: answer,
      usage,
      errorCode: "invalid-response",
      outcomeUncertain: true,
      status,
      retryAfterMs: null,
    };
  } finally {
    reader.releaseLock();
  }

  if (options.signal !== undefined && options.signal.aborted) {
    // 外部取消：`reader.cancel()` 會令 `read()` 回報完成，若不在這裡判斷，被取消的
    // 請求會被當成「成功但內容較短」。
    return { ...base, text: answer, usage, errorCode: "aborted", outcomeUncertain: true };
  }
  if (malformed) {
    return { ...base, text: answer, usage, errorCode: "invalid-response" };
  }
  if ((timeoutSignal.aborted as boolean)) {
    return { ...base, text: answer, usage, errorCode: "timeout", outcomeUncertain: true };
  }
  if (answer.trim().length === 0) {
    return { ...base, text: answer, usage, errorCode: "empty" };
  }
  return { ok: true, text: answer, usage, errorCode: null, outcomeUncertain: false, status, retryAfterMs: null };
}

/**
 * 一次完成「開啟 + 讀取」。供受控評估使用；正式 route 用 `openChatStream` 以便在
 * 串流開始前回報 503。
 */
export async function streamChatCompletion(
  options: StreamChatOptions,
): Promise<StreamChatResult> {
  const opened = await openChatStream(options);
  if (opened.kind === "error") {
    return {
      ok: false,
      text: opened.detail,
      usage: null,
      errorCode: opened.errorCode,
      outcomeUncertain: opened.outcomeUncertain,
      status: opened.status,
      retryAfterMs: opened.retryAfterMs,
    };
  }
  return opened.consume({ onDelta: options.onDelta, signal: options.signal });
}

/** 由 baseUrl 組出 chat/completions 端點（與 route 內既有寫法一致） */
export function buildChatCompletionsEndpoint(baseUrl: string): string {
  return new URL("chat/completions", `${baseUrl.replace(/\/+$/, "")}/`).toString();
}
