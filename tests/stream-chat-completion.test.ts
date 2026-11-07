import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildChatCompletionsEndpoint,
  extractStreamDelta,
  extractStreamUsage,
  openChatStream,
  parseRetryAfterMs,
  streamChatCompletion,
  type StreamChatOptions,
} from "@/server/llm/stream-chat-completion";

/**
 * Sprint 33：共用的串流 adapter 測試。
 *
 * 全部以 `vi.stubGlobal("fetch", ...)` 模擬供應商，**不會**連上真實 API。
 */

const BASE: StreamChatOptions = {
  endpoint: "https://api.example.test/chat/completions",
  apiKey: "test-key-not-real",
  model: "deepseek-flash",
  messages: [
    { role: "system", content: "系統提示" },
    { role: "user", content: "問題" },
  ],
  maxTokens: 1_000,
  thinking: "disabled",
  reasoningEffort: null,
  temperature: 0.4,
  timeoutMs: 5_000,
};

function sse(chunks: string[], options: { usage?: boolean; done?: boolean } = {}): string {
  const lines = chunks.map(
    (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
  );
  if (options.usage === true) {
    lines.push(
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 4_800, completion_tokens: 900 } })}\n\n`,
    );
  }
  if (options.done !== false) lines.push("data: [DONE]\n\n");
  return lines.join("");
}

function respond(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
    ...init,
  });
}

function requestBodyOf(mock: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  const init = mock.mock.calls[0]?.[1] as { body?: string } | undefined;
  return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("串流正常完成", () => {
  it("累積所有 delta 並逐段回呼", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond(sse(["明治", "維新", "。"]))),
    );
    const deltas: string[] = [];
    const result = await streamChatCompletion({ ...BASE, onDelta: (d) => deltas.push(d) });
    expect(result.ok).toBe(true);
    expect(result.text).toBe("明治維新。");
    expect(deltas).toEqual(["明治", "維新", "。"]);
    expect(result.status).toBe(200);
  });

  it("請求內容包含 stream、max_tokens 及 temperature（非思考模式）", async () => {
    const fetchMock = vi.fn(async () => respond(sse(["x"])));
    vi.stubGlobal("fetch", fetchMock);
    await streamChatCompletion(BASE);
    const body = requestBodyOf(fetchMock);
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(1_000);
    expect(body.temperature).toBe(0.4);
    expect(body.model).toBe("deepseek-flash");
    // 預設不加 stream_options（保持正式 route 請求不變）
    expect(body.stream_options).toBeUndefined();
  });

  it("includeUsage 時加入 stream_options 並讀到 usage", async () => {
    const fetchMock = vi.fn(async () => respond(sse(["x"], { usage: true })));
    vi.stubGlobal("fetch", fetchMock);
    const result = await streamChatCompletion({ ...BASE, includeUsage: true });
    const body = requestBodyOf(fetchMock);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(result.usage).toEqual({ inputTokens: 4_800, outputTokens: 900 });
  });

  it("思考模式不傳 temperature，並傳 thinking／reasoning_effort", async () => {
    const fetchMock = vi.fn(async () => respond(sse(["x"])));
    vi.stubGlobal("fetch", fetchMock);
    await streamChatCompletion({ ...BASE, thinking: "enabled", reasoningEffort: "high" });
    const body = requestBodyOf(fetchMock);
    expect(body.temperature).toBeUndefined();
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("high");
  });
});

describe("串流中途失敗", () => {
  it("串流讀取拋錯 → invalid-response 且結果不確定（已收到部分文字仍回傳）", async () => {
    let pulled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!pulled) {
          pulled = true;
          controller.enqueue(new TextEncoder().encode(sse(["部分"], { done: false })));
          return;
        }
        controller.error(new Error("connection reset"));
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream, { status: 200 })),
    );
    const result = await streamChatCompletion(BASE);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("invalid-response");
    expect(result.outcomeUncertain).toBe(true);
    // 已收到的文字不可被丟棄
    expect(result.text).toBe("部分");
  });

  it("格式不符（data 行不是 JSON）→ invalid-response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond("data: {not json}\n\ndata: [DONE]\n\n")),
    );
    const result = await streamChatCompletion(BASE);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("invalid-response");
    // 格式錯誤不代表供應商未處理，仍算已回覆 → 不標示不確定
    expect(result.outcomeUncertain).toBe(false);
  });

  it("完全空白 → empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond("data: [DONE]\n\n")));
    const result = await streamChatCompletion(BASE);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("empty");
  });

  it("只有空白字元的 delta → empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(sse(["   ", "\n"]))));
    const result = await streamChatCompletion(BASE);
    expect(result.errorCode).toBe("empty");
  });
});

describe("HTTP 錯誤分類", () => {
  it("429 → rate-limited，並解析 Retry-After", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("rate limited", { status: 429, headers: { "retry-after": "2" } }),
      ),
    );
    const result = await streamChatCompletion(BASE);
    expect(result.errorCode).toBe("rate-limited");
    expect(result.status).toBe(429);
    expect(result.retryAfterMs).toBe(2_000);
  });

  it("500 → server-error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const result = await streamChatCompletion(BASE);
    expect(result.errorCode).toBe("server-error");
    expect(result.status).toBe(500);
  });

  it("401 → server-error（不可重試）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorised", { status: 401 })));
    const result = await streamChatCompletion(BASE);
    expect(result.errorCode).toBe("server-error");
    expect(result.status).toBe(401);
  });

  it("Retry-After 為 HTTP 日期時亦可解析", () => {
    const future = new Date(Date.now() + 3_000).toUTCString();
    const ms = parseRetryAfterMs(future);
    expect(ms).not.toBeNull();
    expect(ms!).toBeGreaterThan(0);
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs("not-a-date")).toBeNull();
  });
});

describe("timeout 與 abort", () => {
  it("逾時 → timeout 且結果不確定（不可自動重試）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const error = new Error("timed out");
        error.name = "TimeoutError";
        throw error;
      }),
    );
    const result = await streamChatCompletion({ ...BASE, timeoutMs: 10 });
    expect(result.errorCode).toBe("timeout");
    expect(result.outcomeUncertain).toBe(true);
  });

  it("外部 abort → aborted（不是 timeout）", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("aborted");
      }),
    );
    const result = await streamChatCompletion({ ...BASE, signal: controller.signal });
    expect(result.errorCode).toBe("aborted");
    expect(result.outcomeUncertain).toBe(false);
  });

  it("串流開始後外部 abort → 立即停止讀取並回報 aborted（Sprint 34 修正）", async () => {
    // 模擬「學生關掉分頁」：signal 在 consume() 進行中才觸發。Sprint 33 的實作把
    // signal 只傳到 consume()，fetch 沒有收到，於是上游會繼續讀到逾時為止
    // （繼續計費），而且被取消的請求會被當成「成功但內容較短」。
    const controller = new AbortController();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(streamController) {
        pulls += 1;
        if (pulls === 1) {
          streamController.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: "第一段" } }] })}\n\n`,
            ),
          );
          return;
        }
        // 之後不再送資料：只有真的被取消才會結束，否則測試會逾時。
        controller.abort();
      },
    });
    const fetchMock = vi.fn(async () => new Response(body, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const opened = await openChatStream({ ...BASE, signal: controller.signal });
    expect(opened.kind).toBe("opened");
    if (opened.kind !== "opened") return;
    const result = await opened.consume({ signal: controller.signal });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("aborted");
    expect(result.outcomeUncertain).toBe(true);
    expect(result.text).toBe("第一段");
  });

  it("連線階段失敗 → network 且結果不確定", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const result = await streamChatCompletion(BASE);
    expect(result.errorCode).toBe("network");
    expect(result.outcomeUncertain).toBe(true);
  });
});

describe("設定缺失", () => {
  it("缺少 API key → missing-api-key，且不會發出請求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await streamChatCompletion({ ...BASE, apiKey: null });
    expect(result.errorCode).toBe("missing-api-key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("缺少 model → missing-api-key，且不會發出請求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await streamChatCompletion({ ...BASE, model: "" });
    expect(result.errorCode).toBe("missing-api-key");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("usage 處理", () => {
  it("供應商沒有提供 usage → usage 為 null（不可假設為 0）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(sse(["答案"]))));
    const result = await streamChatCompletion({ ...BASE, includeUsage: true });
    expect(result.ok).toBe(true);
    expect(result.usage).toBeNull();
  });

  it("usage 欄位不完整 → 回傳 null 而不是半個數字", () => {
    expect(extractStreamUsage(JSON.stringify({ usage: { prompt_tokens: 10 } }))).toEqual({
      inputTokens: 10,
      outputTokens: null,
    });
    expect(extractStreamUsage(JSON.stringify({ usage: {} }))).toBeNull();
    expect(extractStreamUsage(JSON.stringify({ choices: [] }))).toBeNull();
  });

  it("usage 只取最後一段（串流可能重複送出）", async () => {
    const body = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "a" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 4_800, completion_tokens: 900 } })}\n\n`,
      "data: [DONE]\n\n",
    ].join("");
    vi.stubGlobal("fetch", vi.fn(async () => respond(body)));
    const result = await streamChatCompletion(BASE);
    expect(result.usage).toEqual({ inputTokens: 4_800, outputTokens: 900 });
  });
});

describe("兩步式介面（正式 route 用）", () => {
  it("5xx 在 open 階段即回報錯誤（令 route 可在串流前回 503）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const opened = await openChatStream(BASE);
    expect(opened.kind).toBe("error");
    if (opened.kind === "error") {
      expect(opened.errorCode).toBe("server-error");
      expect(opened.status).toBe(500);
    }
  });

  it("2xx 時回傳可 consume 的 handle，且只發出一次請求", async () => {
    const fetchMock = vi.fn(async () => respond(sse(["完成"])));
    vi.stubGlobal("fetch", fetchMock);
    const opened = await openChatStream(BASE);
    expect(opened.kind).toBe("opened");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (opened.kind === "opened") {
      const result = await opened.consume();
      expect(result.ok).toBe(true);
      expect(result.text).toBe("完成");
    }
    // consume 不會再發出請求
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("不會把 API key 放進回傳結果或錯誤內容", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const opened = await openChatStream(BASE);
    expect(JSON.stringify(opened)).not.toContain("test-key-not-real");
  });
});

describe("輔助函式", () => {
  it("buildChatCompletionsEndpoint 處理尾斜線", () => {
    expect(buildChatCompletionsEndpoint("https://api.deepseek.com")).toBe(
      "https://api.deepseek.com/chat/completions",
    );
    expect(buildChatCompletionsEndpoint("https://api.deepseek.com/")).toBe(
      "https://api.deepseek.com/chat/completions",
    );
  });

  it("extractStreamDelta 容錯", () => {
    expect(extractStreamDelta("[DONE]")).toBeNull();
    expect(extractStreamDelta("{bad")).toBeNull();
    expect(extractStreamDelta(JSON.stringify({ choices: [] }))).toBeNull();
    expect(
      extractStreamDelta(JSON.stringify({ choices: [{ delta: { content: "字" } }] })),
    ).toBe("字");
  });
});
