/**
 * 學伴外部參考的「主要 → 後備」搜尋鏈（2026-11-06）。
 *
 * 擁有者決定：預設「Brave → DeepSeek」。Brave 失效（錯誤、逾時、結果全部不在白名單）
 * 或免費額度用完（401／402／403／429）時改用 DeepSeek；配額類錯誤會令主要來源暫停
 * 10 分鐘，期間直接使用後備。DeepSeek 沿用學伴本身的 API key，不增加憑證。
 * 所有外網一律以 mock fetch 取代，測試不會連上互聯網。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isTutorWebSearchProviderReady,
  parseTutorWebSearchProvider,
} from "@/server/services/tutor-web-search-provider";
import {
  resetTutorWebSearchPause,
  searchAllowlistedSources,
  TUTOR_WEB_PRIMARY_PAUSE_MS,
  tutorWebSearchPauseState,
  type TutorWebSupplementConfig,
} from "@/server/services/tutor-web-supplement";

const BRITANNICA_URL = "https://www.britannica.com/event/Treaty-of-Versailles";
const WIKI_URL = "https://zh.wikipedia.org/wiki/凡爾賽條約";
const BRAVE_HOST = "https://api.search.brave.com/";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/tools/search";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function configWithChain(): TutorWebSupplementConfig {
  return {
    enabled: true,
    mode: "always",
    allowlist: ["britannica.com"],
    topicAllowlist: [],
    maxSources: 2,
    maxCharsPerSource: 600,
    fetchTimeoutMs: 1_000,
    budgetMs: 1_500,
    blockedTopicIds: [],
    searchEndpoint: null,
    provider: {
      provider: "brave",
      apiKey: "brave-key",
      siteHints: [],
      fallback: {
        provider: "deepseek",
        apiKey: "deepseek-key",
        siteHints: [],
      },
    },
  };
}

function requestUrl(input: unknown): string {
  const value = input as string | URL | Request;
  return typeof value === "string"
    ? value
    : value instanceof URL
      ? value.toString()
      : (value as Request).url;
}

function urlsOf(mock: ReturnType<typeof vi.fn>): string[] {
  return mock.mock.calls.map(([input]) => requestUrl(input));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  resetTutorWebSearchPause();
});

describe("provider 判斷", () => {
  it("認得 brave／deepseek（google 已移除），且都只需 API key", () => {
    expect(parseTutorWebSearchProvider("brave")).toBe("brave");
    expect(parseTutorWebSearchProvider("deepseek")).toBe("deepseek");
    expect(parseTutorWebSearchProvider("google")).toBeNull();
    expect(
      isTutorWebSearchProviderReady({ provider: "deepseek", apiKey: "key", siteHints: [] }),
    ).toBe(true);
    expect(
      isTutorWebSearchProviderReady({ provider: "deepseek", apiKey: null, siteHints: [] }),
    ).toBe(false);
  });
});

describe("搜尋 provider 鏈（Brave → DeepSeek）", () => {
  it("Brave 請求失敗時改用 DeepSeek，並只用白名單結果", async () => {
    const mock = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      if (url.startsWith(BRAVE_HOST)) {
        return jsonResponse({ error: "rate limited" }, 429);
      }
      if (url === DEEPSEEK_URL) {
        return jsonResponse({
          results: [
            { title: "Treaty of Versailles | Britannica", url: BRITANNICA_URL },
            { title: "維基百科", url: WIKI_URL },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", mock);

    const candidates = await searchAllowlistedSources("凡爾賽條約", configWithChain());

    expect(candidates).toEqual([
      expect.objectContaining({ url: BRITANNICA_URL, siteLabel: "britannica.com" }),
    ]);
    const urls = urlsOf(mock);
    expect(urls.some((url) => url.startsWith(BRAVE_HOST))).toBe(true);
    expect(urls).toContain(DEEPSEEK_URL);

    const deepseekCall = mock.mock.calls.find(([input]) => requestUrl(input) === DEEPSEEK_URL);
    const init = deepseekCall?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string; need_content?: boolean };
    // 正文交由平台自行抓取，令白名單及 SSRF 檢查只有一套
    expect(body.need_content).toBe(false);
    expect(body.query).toContain("凡爾賽條約");
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBe("Bearer deepseek-key");
  });

  it("Brave 沒有結果時亦會改用 DeepSeek", async () => {
    const mock = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      if (url.startsWith(BRAVE_HOST)) return jsonResponse({ web: { results: [] } });
      if (url === DEEPSEEK_URL) {
        return jsonResponse({ results: [{ title: "Britannica", url: BRITANNICA_URL }] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", mock);

    const candidates = await searchAllowlistedSources("凡爾賽條約", configWithChain());
    expect(candidates).toHaveLength(1);
    expect(urlsOf(mock)).toContain(DEEPSEEK_URL);
  });

  it("Brave 結果全部不在白名單時，視為失效並改用 DeepSeek", async () => {
    const mock = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      if (url.startsWith(BRAVE_HOST)) {
        return jsonResponse({ web: { results: [{ title: "維基百科", url: WIKI_URL }] } });
      }
      if (url === DEEPSEEK_URL) {
        return jsonResponse({ results: [{ title: "Britannica", url: BRITANNICA_URL }] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", mock);

    const candidates = await searchAllowlistedSources("凡爾賽條約", configWithChain());
    expect(candidates.map((candidate) => candidate.url)).toEqual([BRITANNICA_URL]);
  });

  it("Brave 成功時不會呼叫後備來源", async () => {
    const mock = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      if (url.startsWith(BRAVE_HOST)) {
        return jsonResponse({ web: { results: [{ title: "Britannica", url: BRITANNICA_URL }] } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", mock);

    const candidates = await searchAllowlistedSources("凡爾賽條約", configWithChain());
    expect(candidates).toHaveLength(1);
    expect(urlsOf(mock)).not.toContain(DEEPSEEK_URL);
  });

  it("主要及後備來源都失敗時拋出錯誤（由呼叫方降級為 failed）", async () => {
    const mock = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      if (url.startsWith(BRAVE_HOST)) return jsonResponse({}, 503);
      if (url === DEEPSEEK_URL) return jsonResponse({}, 503);
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", mock);

    await expect(searchAllowlistedSources("凡爾賽條約", configWithChain())).rejects.toThrow(
      /search returned 5\d\d/,
    );
  });
});

describe("配額用完後暫停主要來源（Brave → DeepSeek）", () => {
  it("402／429 後改用 DeepSeek，並在冷卻期內不再呼叫 Brave", async () => {
    const mock = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      if (url.startsWith(BRAVE_HOST)) return jsonResponse({ error: "quota" }, 402);
      if (url === DEEPSEEK_URL) {
        return jsonResponse({ results: [{ title: "Britannica", url: BRITANNICA_URL }] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", mock);

    const first = await searchAllowlistedSources("凡爾賽條約", configWithChain());
    expect(first).toHaveLength(1);
    const pause = tutorWebSearchPauseState();
    expect(pause.provider).toBe("brave");
    expect(pause.until).toBeGreaterThan(Date.now());
    expect(pause.until).toBeLessThanOrEqual(Date.now() + TUTOR_WEB_PRIMARY_PAUSE_MS);

    const callsAfterFirst = mock.mock.calls.length;
    const second = await searchAllowlistedSources("凡爾賽條約", configWithChain());
    expect(second).toHaveLength(1);
    const secondCallUrls = urlsOf(mock).slice(callsAfterFirst);
    // 第二次直接使用後備：Brave 一次也沒有被呼叫
    expect(secondCallUrls.some((url) => url.startsWith(BRAVE_HOST))).toBe(false);
    expect(secondCallUrls).toContain(DEEPSEEK_URL);
  });

  it("暫時性錯誤（5xx）不會令主要來源暫停，下一題仍會再試 Brave", async () => {
    let braveAttempts = 0;
    const mock = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      if (url.startsWith(BRAVE_HOST)) {
        braveAttempts += 1;
        return braveAttempts === 1
          ? jsonResponse({}, 503)
          : jsonResponse({ web: { results: [{ title: "Britannica", url: BRITANNICA_URL }] } });
      }
      if (url === DEEPSEEK_URL) {
        return jsonResponse({ results: [{ title: "Britannica", url: BRITANNICA_URL }] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", mock);

    await searchAllowlistedSources("凡爾賽條約", configWithChain());
    expect(tutorWebSearchPauseState().provider).toBeNull();
    await searchAllowlistedSources("凡爾賽條約", configWithChain());
    expect(braveAttempts).toBe(2);
  });

  it("主要來源成功後會解除暫停", async () => {
    let braveAttempts = 0;
    const mock = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      if (url.startsWith(BRAVE_HOST)) {
        braveAttempts += 1;
        return braveAttempts === 1
          ? jsonResponse({}, 429)
          : jsonResponse({ web: { results: [{ title: "Britannica", url: BRITANNICA_URL }] } });
      }
      if (url === DEEPSEEK_URL) {
        return jsonResponse({ results: [{ title: "Britannica", url: BRITANNICA_URL }] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", mock);

    await searchAllowlistedSources("凡爾賽條約", configWithChain());
    expect(tutorWebSearchPauseState().provider).toBe("brave");
    // 模擬冷卻期已過（不改系統時鐘：直接清除暫停狀態）
    resetTutorWebSearchPause();
    await searchAllowlistedSources("凡爾賽條約", configWithChain());
    expect(braveAttempts).toBe(2);
    expect(tutorWebSearchPauseState().provider).toBeNull();
  });
});
