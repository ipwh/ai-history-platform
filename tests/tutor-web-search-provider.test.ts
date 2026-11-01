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

function googleConfig(overrides: Partial<TutorWebSearchProviderConfig> = {}): TutorWebSearchProviderConfig {
  return {
    provider: "google",
    apiKey: "test-key",
    engineId: "test-cx",
    siteHints: [],
    ...overrides,
  };
}

function braveConfig(overrides: Partial<TutorWebSearchProviderConfig> = {}): TutorWebSearchProviderConfig {
  return {
    provider: "brave",
    apiKey: "test-key",
    engineId: null,
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
  it("只接受 google／brave，其餘視為未設定", () => {
    expect(parseTutorWebSearchProvider("google")).toBe("google");
    expect(parseTutorWebSearchProvider(" BRAVE ")).toBe("brave");
    expect(parseTutorWebSearchProvider("bing")).toBeNull();
    expect(parseTutorWebSearchProvider("")).toBeNull();
    expect(parseTutorWebSearchProvider(null)).toBeNull();
  });

  it("key 齊全才算 ready；google 另需 cx，brave 不需要", () => {
    expect(isTutorWebSearchProviderReady(googleConfig())).toBe(true);
    expect(isTutorWebSearchProviderReady(googleConfig({ engineId: null }))).toBe(false);
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
});

describe("呼叫第三方 provider", () => {
  it("Google：帶 key／cx／num／safe=active，並映射 items", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        items: [
          { title: "Treaty of Versailles", link: BRITANNICA },
          { title: "Ignored", link: "https://example.com/x" },
          { title: "No link" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const hits = await searchWithProvider({ query: "凡爾賽條約", config: googleConfig(), timeoutMs: 500 });
    expect(hits).toEqual([
      { url: BRITANNICA, title: "Treaty of Versailles" },
      { url: "https://example.com/x", title: "Ignored" },
    ]);

    const url = calledUrl(fetchMock);
    expect(url.origin + url.pathname).toBe("https://www.googleapis.com/customsearch/v1");
    expect(url.searchParams.get("key")).toBe("test-key");
    expect(url.searchParams.get("cx")).toBe("test-cx");
    expect(url.searchParams.get("q")).toBe("凡爾賽條約");
    expect(url.searchParams.get("num")).toBe("10");
    // 學生使用：一律嚴格安全搜尋
    expect(url.searchParams.get("safe")).toBe("active");
    expect((calledInit(fetchMock) as { redirect?: string }).redirect).toBe("error");
  });

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

  it("未設定或不完整時回空陣列，且不發出請求", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    expect(await searchWithProvider({ query: "x", config: googleConfig({ engineId: null }), timeoutMs: 500 })).toEqual([]);
    expect(await searchWithProvider({ query: "x", config: braveConfig({ provider: null }), timeoutMs: 500 })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 429, 500])("非 2xx（%i）會拋出，由呼叫方降級為 failed", async (status) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => jsonResponse({}, status)));
    await expect(
      searchWithProvider({ query: "凡爾賽條約", config: googleConfig(), timeoutMs: 500 }),
    ).rejects.toThrow(String(status));
  });

  it("回應格式不符（沒有 items）時回空陣列而不是拋錯", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => jsonResponse({ kind: "customsearch#search" })));
    expect(
      await searchWithProvider({ query: "凡爾賽條約", config: googleConfig(), timeoutMs: 500 }),
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
