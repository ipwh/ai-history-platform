import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildProviderQuery,
  isTutorWebSearchProviderReady,
  parseTutorWebSearchProvider,
  searchWithProvider,
  toAllowlistedCandidates,
  TUTOR_WEB_SEARCH_QUERY_MAX_CHARS,
  type TutorWebSearchProviderConfig,
} from "@/server/services/tutor-web-search-provider";

const BRITANNICA = "https://www.britannica.com/event/Treaty-of-Versailles";

function braveConfig(overrides: Partial<TutorWebSearchProviderConfig> = {}): TutorWebSearchProviderConfig {
  return {
    provider: "brave",
    apiKey: "test-key",
    siteHints: [],
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function calledUrl(fetchMock: ReturnType<typeof vi.fn>): URL {
  return new URL(String(fetchMock.mock.calls[0]?.[0]));
}

function calledInit(fetchMock: ReturnType<typeof vi.fn>): RequestInit {
  return (fetchMock.mock.calls[0]?.[1] ?? {}) as RequestInit;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("provider 設定判斷", () => {
  it("接受 brave／deepseek，其餘（包括已移除的 google）視為未設定", () => {
    expect(parseTutorWebSearchProvider("google")).toBeNull();
    expect(parseTutorWebSearchProvider(" BRAVE ")).toBe("brave");
    expect(parseTutorWebSearchProvider("deepseek")).toBe("deepseek");
    expect(parseTutorWebSearchProvider(" DEEPSEEK ")).toBe("deepseek");
    expect(parseTutorWebSearchProvider("bing")).toBeNull();
    expect(parseTutorWebSearchProvider("")).toBeNull();
    expect(parseTutorWebSearchProvider(null)).toBeNull();
  });

  it("Brave 及 DeepSeek 都只需 API key", () => {
    expect(isTutorWebSearchProviderReady(braveConfig())).toBe(true);
    expect(isTutorWebSearchProviderReady(braveConfig({ apiKey: "  " }))).toBe(false);
    expect(isTutorWebSearchProviderReady(braveConfig({ provider: null }))).toBe(false);
  });
});

describe("查詢字串組裝", () => {
  it("壓縮空白並截斷至上限（減少學生原句外送）", () => {
    const long = `凡爾賽條約   ${"很長的補充說明".repeat(60)}`;
    const query = buildProviderQuery(long, []);
    expect(query.length).toBeLessThanOrEqual(TUTOR_WEB_SEARCH_QUERY_MAX_CHARS);
    expect(query).not.toContain("  ");
  });

  it("沒有 site 提示時使用純查詢", () => {
    expect(buildProviderQuery("凡爾賽條約如何約束德國？", [])).toBe("凡爾賽條約如何約束德國？");
  });

  it("site 提示以 OR 串連，最多 6 個", () => {
    const query = buildProviderQuery("凡爾賽條約", [
      "britannica.com",
      "bbc.co.uk",
      "history.com",
      "worldhistory.org",
      "khanacademy.org",
      "nobelprize.org",
      "un.org",
    ]);
    expect(query).toContain("(site:britannica.com OR site:bbc.co.uk");
    expect(query).not.toContain("site:un.org");
  });

  it("DeepSeek 語法：site 提示不加括號，並在 128 字符內保留完整提示", () => {
    const hints = ["britannica.com", "bbc.co.uk", "history.com", "worldhistory.org"];
    const query = buildProviderQuery("凡爾賽條約如何約束德國？".repeat(12), hints, TUTOR_WEB_SEARCH_QUERY_MAX_CHARS, {
      hintSyntax: "plain",
      hardMaxChars: 128,
    });
    expect(query.length).toBeLessThanOrEqual(128);
    expect(query).not.toContain("(site:");
    expect(query).toContain("site:britannica.com OR site:bbc.co.uk");
    // 提示本身已超出上限時只用問題，不會留下半截 "site:"
    expect(query.endsWith("site:")).toBe(false);
  });
});

describe("呼叫第三方 provider", () => {
  it("Brave：帶 X-Subscription-Token 及 safesearch=strict，並映射 web.results", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ web: { results: [{ title: "條約", url: BRITANNICA }] } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const hits = await searchWithProvider({ query: "凡爾賽條約", config: braveConfig(), timeoutMs: 500 });
    expect(hits).toEqual([{ url: BRITANNICA, title: "條約" }]);

    const url = calledUrl(fetchMock);
    expect(url.origin + url.pathname).toBe("https://api.search.brave.com/res/v1/web/search");
    expect(url.searchParams.get("safesearch")).toBe("strict");
    expect(url.searchParams.get("count")).toBe("10");
    const headers = (calledInit(fetchMock) as { headers?: Record<string, string> }).headers ?? {};
    expect(headers["X-Subscription-Token"]).toBe("test-key");
  });

  it("DeepSeek：POST /v1/tools/search（Bearer key、need_content=false），並映射 results", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        results: [
          { title: "Treaty of Versailles | Britannica", url: BRITANNICA },
          { title: "沒有網址" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const hits = await searchWithProvider({
      query: "凡爾賽條約如何約束德國？",
      config: {
        provider: "deepseek",
        apiKey: "deepseek-key",
        siteHints: ["britannica.com", "bbc.co.uk"],
      },
      timeoutMs: 500,
    });
    expect(hits).toEqual([{ url: BRITANNICA, title: "Treaty of Versailles | Britannica" }]);

    const url = calledUrl(fetchMock);
    expect(url.origin + url.pathname).toBe("https://api.deepseek.com/v1/tools/search");
    const init = calledInit(fetchMock);
    expect((init as { method?: string }).method).toBe("POST");
    expect((init as { redirect?: string }).redirect).toBe("error");
    const headers = (init as { headers?: Record<string, string> }).headers ?? {};
    expect(headers.authorization).toBe("Bearer deepseek-key");
    const body = JSON.parse(String(init.body)) as { query: string; count: number; need_content: boolean };
    expect(body.need_content).toBe(false);
    expect(body.count).toBe(10);
    expect(body.query).toContain("site:britannica.com OR site:bbc.co.uk");
    expect(body.query).not.toContain("(site:");
  });

  it("未設定或不完整時回空陣列，且不發出請求", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    expect(await searchWithProvider({ query: "x", config: braveConfig({ apiKey: "  " }), timeoutMs: 500 })).toEqual([]);
    expect(await searchWithProvider({ query: "x", config: braveConfig({ provider: null }), timeoutMs: 500 })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 429, 500])("非 2xx（%i）會拋出，由呼叫方降級為 failed", async (status) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => jsonResponse({}, status)));
    await expect(
      searchWithProvider({ query: "凡爾賽條約", config: braveConfig(), timeoutMs: 500 }),
    ).rejects.toThrow(String(status));
  });

  it("回應格式不符（沒有 web.results）時回空陣列而不是拋錯", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => jsonResponse({ kind: "brave#search" })));
    expect(
      await searchWithProvider({ query: "凡爾賽條約", config: braveConfig(), timeoutMs: 500 }),
    ).toEqual([]);
  });
});

describe("白名單過濾（兩條搜尋路徑共用）", () => {
  const allowlist = ["britannica.com", "bbc.co.uk"];

  it("只保留 https 及白名單 host，並移除 hash、去重", () => {
    const candidates = toAllowlistedCandidates(
      [
        { url: `${BRITANNICA}#section`, title: "A" },
        { url: `${BRITANNICA}#another`, title: "重複" },
        { url: "http://www.britannica.com/x", title: "非 https" },
        { url: "https://www.bbc.co.uk/history", title: "  B  " },
        { url: "https://zh.wikipedia.org/wiki/x", title: "共筆百科" },
        { url: "https://britannica.com.evil.example/x", title: "偽冒" },
        { url: "not-a-url", title: "壞網址" },
      ],
      allowlist,
    );
    expect(candidates).toEqual([
      { url: BRITANNICA, title: "A", siteLabel: "britannica.com" },
      { url: "https://www.bbc.co.uk/history", title: "B", siteLabel: "bbc.co.uk" },
    ]);
  });

  it("title 過長會截斷，空 title 保留空字串", () => {
    const [candidate] = toAllowlistedCandidates(
      [{ url: BRITANNICA, title: "x".repeat(500) }],
      allowlist,
    );
    expect(candidate!.title.length).toBe(200);
    expect(toAllowlistedCandidates([{ url: BRITANNICA, title: "" }], allowlist)).toHaveLength(1);
  });
});
