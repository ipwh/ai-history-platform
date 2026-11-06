import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE, encodeSession } from "@/server/auth/session";
import { ensureLearner } from "@/server/repositories/learners";
import { getTutorMessages } from "@/server/repositories/tutor";
import {
  isBlockedWebAddress,
  matchTutorWebAllowlist,
  normalizeTutorWebAllowlist,
} from "@/server/services/tutor-web-allowlist";
import {
  extractReadableText,
  fetchAllowlistedText,
  type TutorWebSupplementConfig,
} from "@/server/services/tutor-web-supplement";
import { freshTestDatabasePath } from "./test-database";

/**
 * 學伴白名單網頁補充（Web Supplement MVP）的測試。
 *
 * 所有外網一律 mock：
 *   - `node:dns/promises` 以 `vi.hoisted` 提供固定位址，令 SSRF 檢查可在離線環境驗證；
 *   - 全域 `fetch` 由 `installFetchMock` 按網址分派（搜尋端點、目標頁面、DeepSeek 上游）。
 * 沒有任何一項測試會真正連上互聯網。
 */
const dnsState = vi.hoisted(() => ({
  addresses: [{ address: "93.184.216.34", family: 4 }] as { address: string; family: number }[],
  byHost: {} as Record<string, { address: string; family: number }[]>,
  failure: null as Error | null,
}));

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (hostname: string) => {
    if (dnsState.failure !== null) throw dnsState.failure;
    return dnsState.byHost[hostname] ?? dnsState.addresses;
  }),
}));

process.env.APP_DATABASE_PATH = freshTestDatabasePath("tutor-web-supplement");
process.env.AUTH_SECRET = "tutor-web-supplement-secret-0123456789";
process.env.AUTH_REQUIRE_SIGN_IN = "true";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_STAFF_ACCESS_POLICY = "allowlist";
delete process.env.AUTH_STAFF_DOMAINS;
process.env.LLM_PROVIDER = "deepseek";
process.env.DEEPSEEK_API_KEY = "test-only-key";
process.env.AI_LIMITS_ENABLED = "true";
process.env.AI_LIMIT_WINDOW_MINUTES = "60";
process.env.AI_GENERATIONS_PER_LEARNER = "100";
process.env.AI_GENERATIONS_GLOBAL = "100";
process.env.BACKUP_ENABLED = "false";

const STUDENT = "school:s2024501@pochiu.edu.hk";
const SEARCH_ENDPOINT = "https://search.example.com/tutor";
const BRITANNICA_URL = "https://www.britannica.com/event/Treaty-of-Versailles";
const PAGE_SENTENCE =
  "《凡爾賽條約》規定德國須限制軍隊數目、放棄海外殖民地及支付巨額賠款，並承認發動戰爭的責任；條約亦設立國際聯盟。";
const PAGE_TEXT = PAGE_SENTENCE.repeat(6);
const PAGE_HTML = [
  "<html><head><title>Treaty of Versailles | Britannica</title>",
  "<style>body{color:#000}</style><script>window.x = 1;</script></head><body>",
  "<nav>主頁 | 關於我們</nav><main><h1>Treaty of Versailles</h1>",
  "<p>",
  PAGE_TEXT,
  "</p></main><footer>版權所有</footer></body></html>",
].join("");

let postChat: typeof import("@/app/api/tutor/chat/route").POST;
let getChat: typeof import("@/app/api/tutor/chat/route").GET;
let getServerConfig: typeof import("@/server/config").getServerConfig;
let getDb: typeof import("@/server/db/connection").getDb;

function requestFor(method: "GET" | "POST", body?: unknown, query = ""): Request {
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(
    encodeSession({
      email: STUDENT.slice("school:".length),
      name: "測試學生",
      role: "student",
      learnerId: STUDENT,
      rosterVerified: true,
      className: "1A",
      studentNumber: "s2024501",
    }),
  )}`;
  return new Request(`http://localhost/api/tutor/chat${query}`, {
    method,
    headers: {
      cookie,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function sseEvents(streamText: string): { event: string; data: unknown }[] {
  return streamText
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const eventLine = chunk.split("\n").find((line) => line.startsWith("event:"));
      const dataLine = chunk.split("\n").find((line) => line.startsWith("data:"));
      return {
        event: eventLine?.slice(6).trim() ?? "",
        data: dataLine ? (JSON.parse(dataLine.slice(5).trim()) as unknown) : null,
      };
    });
}

function streamingAnswer(answer = "你認為條約如何影響德國？"): Response {
  const events = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
  return new Response(events, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function htmlResponse(html = PAGE_HTML): Response {
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * 按網址分派 fetch。
 *
 * 呼叫次序（與 route 一致）：① 搜尋端點 → ② 目標頁面 → ③ DeepSeek 上游。
 */
function installFetchMock(handlers: {
  answer?: string;
  search?: () => Response | Promise<Response>;
  /** 第三方 provider（Brave Search API） */
  brave?: () => Response | Promise<Response>;
  pages?: Record<string, () => Response | Promise<Response>>;
}) {
  const mock = vi.fn<typeof fetch>(async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    if (url.startsWith("https://search.example.com/")) {
      if (!handlers.search) throw new Error(`unexpected search fetch: ${url}`);
      return handlers.search();
    }
    if (url.startsWith("https://api.search.brave.com/")) {
      if (!handlers.brave) throw new Error(`unexpected brave fetch: ${url}`);
      return handlers.brave();
    }
    if (url.includes("/chat/completions")) return streamingAnswer(handlers.answer);
    const page = handlers.pages?.[url];
    if (page) return page();
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function requestedUrls(mock: ReturnType<typeof installFetchMock>): string[] {
  return mock.mock.calls.map(([input]) =>
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url,
  );
}

function enableWebSupplement(options: {
  allowlist?: string;
  blockedTopics?: string;
  searchEndpoint?: string | null;
  mode?: string;
} = {}): void {
  process.env.TUTOR_WEB_SUPPLEMENT_ENABLED = "true";
  // 這些測試驗證的是抓取行為，所以明確使用 always；
  // not-covered-only 的分支另有獨立測試。
  process.env.TUTOR_WEB_MODE = options.mode ?? "always";
  if (options.searchEndpoint === null) delete process.env.TUTOR_WEB_SEARCH_ENDPOINT;
  else process.env.TUTOR_WEB_SEARCH_ENDPOINT = options.searchEndpoint ?? SEARCH_ENDPOINT;
  if (options.allowlist !== undefined) process.env.TUTOR_WEB_ALLOWLIST = options.allowlist;
  if (options.blockedTopics !== undefined) process.env.TUTOR_WEB_BLOCKED_TOPICS = options.blockedTopics;
}

function webConfig(overrides: Partial<TutorWebSupplementConfig> = {}): TutorWebSupplementConfig {
  return {
    enabled: true,
    mode: "always",
    allowlist: ["britannica.com"],
    topicAllowlist: [],
    maxSources: 2,
    maxCharsPerSource: 600,
    fetchTimeoutMs: 4_000,
    budgetMs: 1_500,
    blockedTopicIds: [],
    searchEndpoint: SEARCH_ENDPOINT,
    provider: { provider: null, apiKey: null, siteHints: [] },
    ...overrides,
  };
}

beforeAll(async () => {
  ({ POST: postChat, GET: getChat } = await import("@/app/api/tutor/chat/route"));
  ({ getServerConfig } = await import("@/server/config"));
  getDb = (await import("@/server/db/connection")).getDb;
  ensureLearner(STUDENT);

  const db = getDb();
  const now = "2026-11-01T00:00:00.000+08:00";
  db.prepare(
    `INSERT INTO topics (id, title, description, published, sort_order, created_at, updated_at)
     VALUES ('topic-9', '課題9：20世紀的國際紛爭及危機(I)–兩次世界大戰', '', 1, 9, ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO sections (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
     VALUES ('topic-9-interwar', 'topic-9', NULL, '兩次大戰期間', '', '["凡爾賽條約","極權"]', 1, ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO material_documents
       (id, file_name, kind, status, created_at, student_distribution, rights_confirmed_at)
     VALUES ('doc-notes', '課題9 兩次世界大戰_筆記.docx', 'demo', 'ready', ?, 1, ?)`,
  ).run(now, now);
  [
    "凡爾賽條約的內容",
    "《凡爾賽條約》規定德國須限制軍隊數目、放棄海外殖民地及支付巨額賠款，並承認發動戰爭的責任。",
    "條約亦設立國際聯盟，但美國最終沒有加入。",
  ].forEach((text, index) => {
    db.prepare(
      `INSERT INTO material_blocks
         (id, document_id, topic_id, section_id, sort_order, type, text, source_location, created_at, extraction_method)
       VALUES (?, 'doc-notes', 'topic-9', NULL, ?, 'paragraph', ?, ?, ?, 'native')`,
    ).run(
      `block-${index}`,
      index,
      text,
      `課題9 兩次世界大戰_筆記.docx · 第 ${index + 1} 段（段落）`,
      now,
    );
  });
});

beforeEach(() => {
  vi.unstubAllGlobals();
  process.env.DEEPSEEK_API_KEY = "test-only-key";
  process.env.AI_GENERATIONS_GLOBAL = "100";
  // 預設狀態：白名單補充關閉（與生產預設一致）
  delete process.env.TUTOR_WEB_SUPPLEMENT_ENABLED;
  delete process.env.TUTOR_WEB_MODE;
  delete process.env.TUTOR_WEB_SEARCH_ENDPOINT;
  delete process.env.TUTOR_WEB_ALLOWLIST;
  delete process.env.TUTOR_WEB_BLOCKED_TOPICS;
  delete process.env.TUTOR_WEB_TOPIC_ALLOWLIST;
  delete process.env.TUTOR_WEB_MAX_SOURCES;
  delete process.env.TUTOR_WEB_MAX_CHARS_PER_SOURCE;
  delete process.env.TUTOR_WEB_FETCH_TIMEOUT_MS;
  delete process.env.TUTOR_WEB_BUDGET_MS;
  delete process.env.TUTOR_WEB_SEARCH_PROVIDER;
  delete process.env.TUTOR_WEB_SEARCH_API_KEY;
  delete process.env.TUTOR_WEB_SEARCH_FALLBACK_PROVIDER;
  delete process.env.TUTOR_WEB_SEARCH_FALLBACK_API_KEY;
  delete process.env.TUTOR_WEB_SEARCH_SITE_HINTS;
  dnsState.addresses = [{ address: "93.184.216.34", family: 4 }];
  dnsState.byHost = {};
  dnsState.failure = null;
  const db = getDb();
  db.prepare("DELETE FROM tutor_messages").run();
  db.prepare("DELETE FROM tutor_sessions").run();
  db.prepare("DELETE FROM ai_operations").run();
});

describe("白名單及 SSRF 防護（純函式）", () => {
  it("後綴匹配必須在標籤邊界，子網域可以，偽冒網域不可以", () => {
    const allowlist = ["bbc.co.uk", "britannica.com"];
    expect(matchTutorWebAllowlist("www.bbc.co.uk", allowlist)).toBe("bbc.co.uk");
    expect(matchTutorWebAllowlist("bbc.co.uk", allowlist)).toBe("bbc.co.uk");
    expect(matchTutorWebAllowlist("britannica.com", allowlist)).toBe("britannica.com");
    // `bbc.co.uk.evil.example` 只是以白名單字串作後綴，不是其子網域
    expect(matchTutorWebAllowlist("bbc.co.uk.evil.example", allowlist)).toBeNull();
    expect(matchTutorWebAllowlist("notbbc.co.uk", allowlist)).toBeNull();
  });

  it("共筆百科及社交平台即使寫進白名單亦不會被採用", () => {
    const allowlist = ["wikipedia.org", "zhihu.com", "history.com"];
    expect(matchTutorWebAllowlist("zh.wikipedia.org", allowlist)).toBeNull();
    expect(matchTutorWebAllowlist("www.zhihu.com", allowlist)).toBeNull();
    expect(matchTutorWebAllowlist("www.history.com", allowlist)).toBe("history.com");
  });

  it("白名單正規化會丟棄 IP、單一標籤主機及空白項", () => {
    expect(
      normalizeTutorWebAllowlist([
        "https://www.BBC.co.uk/news",
        "bbc.co.uk",
        "127.0.0.1",
        "localhost",
        "internal",
        "10.0.0.5:8080",
        "   ",
      ]),
    ).toEqual(["www.bbc.co.uk", "bbc.co.uk"]);
  });

  it.each([
    "127.0.0.1",
    "0.0.0.0",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.1",
    "100.64.0.1",
    "169.254.169.254",
    "192.0.2.10",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "ff02::1",
    "::ffff:169.254.169.254",
    "64:ff9b::10.0.0.5",
    "not-an-address",
  ])("位址 %s 屬不可外連範圍", (address) => {
    expect(isBlockedWebAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "2001:4860:4860::8888", "2606:4700::1111"])(
    "公網位址 %s 可以外連",
    (address) => {
      expect(isBlockedWebAddress(address)).toBe(false);
    },
  );

  it("正文抽取會移除 script／style／導覽，解碼實體並截斷", () => {
    const html =
      "<html><head><title>條約 &amp; 和會</title></head><body><nav>選單</nav>" +
      "<main><p>第一段&#12290;</p><p>第二段內容很長很長很長很長</p></main></body></html>";
    const extracted = extractReadableText(html, 6);
    expect(extracted.title).toBe("條約 & 和會");
    expect(extracted.text.startsWith("第一段。")).toBe(true);
    expect(extracted.text).not.toContain("選單");
    expect(extracted.text.length).toBe(6);
  });

  it("只准 https：http 及非白名單網址一律拒絕", async () => {
    await expect(
      fetchAllowlistedText("http://127.0.0.1/", webConfig({ allowlist: ["127.0.0.1"] })),
    ).rejects.toThrow();
    await expect(
      fetchAllowlistedText("http://169.254.169.254/latest/meta-data/", webConfig()),
    ).rejects.toThrow();
    await expect(
      fetchAllowlistedText("https://169.254.169.254/latest/meta-data/", webConfig()),
    ).rejects.toThrow();
    await expect(
      fetchAllowlistedText("https://evil.example/topic", webConfig()),
    ).rejects.toThrow();
  });

  it("白名單網域解析到私網位址時中止，不會發出請求", async () => {
    dnsState.addresses = [{ address: "10.0.0.5", family: 4 }];
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchAllowlistedText(BRITANNICA_URL, webConfig()),
    ).rejects.toThrow(/non-public/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("學伴 API：外部參考", () => {
  it("預設關閉時零外網請求，狀態為 disabled", async () => {
    // 即使設定了搜尋端點，未開啟開關就不應發出任何請求
    process.env.TUTOR_WEB_SEARCH_ENDPOINT = SEARCH_ENDPOINT;
    const fetchMock = installFetchMock({
      search: () => {
        throw new Error("搜尋端點不應被呼叫");
      },
    });

    const response = await postChat(
      requestFor("POST", { message: "凡爾賽條約如何約束德國？" }),
    );
    const events = sseEvents(await response.text());
    const meta = events.find((entry) => entry.event === "meta")?.data as {
      webSources: unknown[];
      webSupplementStatus: string;
    };
    const done = events.find((entry) => entry.event === "done")?.data as {
      webSources: unknown[];
      webSupplementStatus: string;
      sources: unknown[];
    };

    expect(meta.webSupplementStatus).toBe("disabled");
    expect(meta.webSources).toEqual([]);
    expect(done.webSupplementStatus).toBe("disabled");
    expect(done.webSources).toEqual([]);
    // 只有一次對外請求：DeepSeek 上游
    expect(requestedUrls(fetchMock)).toHaveLength(1);
    expect(requestedUrls(fetchMock)[0]).toContain("/chat/completions");

    const systemPrompt = String(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).messages[0]?.content,
    );
    expect(systemPrompt).not.toContain("【外部參考摘錄");
  });

  it("開啟後抓取白名單頁面，於 meta 及 done 附上外部參考，並在提示詞分開標示", async () => {
    enableWebSupplement();
    const fetchMock = installFetchMock({
      search: () => jsonResponse({ results: [{ url: BRITANNICA_URL, title: "Treaty of Versailles" }] }),
      pages: { [BRITANNICA_URL]: () => htmlResponse() },
    });

    const response = await postChat(
      requestFor("POST", { message: "凡爾賽條約如何約束德國？" }),
    );
    const events = sseEvents(await response.text());
    const meta = events.find((entry) => entry.event === "meta")?.data as {
      webSources: { url: string; siteLabel: string }[];
      webSupplementStatus: string;
    };
    const done = events.find((entry) => entry.event === "done")?.data as {
      webSources: { url: string; title: string; siteLabel: string; excerpt: string }[];
      webSupplementStatus: string;
      sources: unknown[];
      grounding: string;
    };

    expect(meta.webSupplementStatus).toBe("ok");
    expect(done.webSupplementStatus).toBe("ok");
    expect(done.webSources).toHaveLength(1);
    const source = done.webSources[0]!;
    expect(source.url).toBe(BRITANNICA_URL);
    expect(source.siteLabel).toBe("britannica.com");
    expect(source.title).toBe("Treaty of Versailles | Britannica");
    expect(source.excerpt.length).toBeGreaterThan(0);
    expect(source.excerpt.length).toBeLessThanOrEqual(121);
    // 教材依據與外部參考同時存在，且兩者分開
    expect(done.grounding).toBe("grounded");
    expect(done.sources.length).toBeGreaterThan(0);
    expect(meta.webSources).toEqual(done.webSources);

    const systemPrompt = String(
      JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body)).messages[0]?.content,
    );
    expect(systemPrompt).toContain("【教材片段】");
    expect(systemPrompt).toContain("【外部參考摘錄——非校本教材、非評卷標準】");
    expect(systemPrompt).toContain("以教材為準");
    expect(systemPrompt).toContain(BRITANNICA_URL);
    // 提示詞取得較完整的段落（TUTOR_WEB_MAX_CHARS_PER_SOURCE），
    // 但顯示給學生的摘錄維持 120 字上限。
    expect(systemPrompt).toContain(PAGE_TEXT.slice(200, 260));
    expect(source.excerpt).not.toContain(PAGE_TEXT.slice(200, 260));
    // 送去提示詞的較長段落不會經 API 外泄
    expect(done).not.toHaveProperty("promptSources");
    // 外部參考區塊必須排在教材片段之後（教材優先）
    expect(systemPrompt.indexOf("【教材片段】")).toBeLessThan(
      systemPrompt.indexOf("【外部參考摘錄"),
    );

    // 重新載入對話仍顯示同一組外部參考
    const sessionId = response.headers.get("x-tutor-session-id") ?? "";
    const reloaded = await getChat(
      requestFor("GET", undefined, `?sessionId=${encodeURIComponent(sessionId)}`),
    );
    const payload = (await reloaded.json()) as {
      messages: { role: string; webSources?: { url: string }[] }[];
    };
    const answer = payload.messages.find((message) => message.role === "assistant");
    expect(answer?.webSources).toEqual([expect.objectContaining({ url: BRITANNICA_URL })]);

    const stored = getTutorMessages(sessionId).find((message) => message.role === "assistant");
    expect(stored?.webSources).toHaveLength(1);
  });

  it("搜尋結果非白名單時全部丟棄，不會抓取任何頁面", async () => {
    enableWebSupplement();
    const fetchMock = installFetchMock({
      search: () =>
        jsonResponse({
          results: [
            { url: "https://zh.wikipedia.org/wiki/凡爾賽條約", title: "維基百科" },
            { url: "https://www.reddit.com/r/history/xyz", title: "Reddit" },
            { url: "https://britannica.com.evil.example/topic", title: "偽冒" },
            { url: "http://www.britannica.com/topic/x", title: "非 https" },
          ],
        }),
    });

    const response = await postChat(
      requestFor("POST", { message: "凡爾賽條約如何約束德國？" }),
    );
    const done = sseEvents(await response.text()).find((entry) => entry.event === "done")
      ?.data as { webSources: unknown[]; webSupplementStatus: string };

    expect(response.status).toBe(200);
    expect(done.webSupplementStatus).toBe("not-used");
    expect(done.webSources).toEqual([]);
    // 只有搜尋端點及 DeepSeek 上游，沒有任何頁面抓取
    const urls = requestedUrls(fetchMock);
    expect(urls).toHaveLength(2);
    expect(urls.filter((url) => url.includes("chat/completions"))).toHaveLength(1);
  });

  it("目標網域解析到私網位址（SSRF）時放棄該來源，回應仍然成功", async () => {
    enableWebSupplement({ allowlist: "internal.example.com" });
    // 搜尋端點仍解析到公網；只有目標網域指向雲端中繼資料服務
    dnsState.byHost["internal.example.com"] = [{ address: "169.254.169.254", family: 4 }];
    const fetchMock = installFetchMock({
      search: () =>
        jsonResponse({ results: [{ url: "https://internal.example.com/meta-data", title: "x" }] }),
    });

    const response = await postChat(
      requestFor("POST", { message: "凡爾賽條約如何約束德國？" }),
    );
    const done = sseEvents(await response.text()).find((entry) => entry.event === "done")
      ?.data as { webSources: unknown[]; webSupplementStatus: string; sources: unknown[] };

    expect(response.status).toBe(200);
    expect(done.webSupplementStatus).toBe("failed");
    expect(done.webSources).toEqual([]);
    // 只有搜尋端點及 DeepSeek 上游：目標頁面根本沒有被請求
    expect(requestedUrls(fetchMock)).toHaveLength(2);
  });

  it("重定向離開白名單時中止，不採用該來源", async () => {
    enableWebSupplement();
    const fetchMock = installFetchMock({
      search: () => jsonResponse({ results: [{ url: BRITANNICA_URL, title: "t" }] }),
      pages: {
        [BRITANNICA_URL]: () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://evil.example/collect" },
          }),
      },
    });

    const response = await postChat(
      requestFor("POST", { message: "凡爾賽條約如何約束德國？" }),
    );
    const done = sseEvents(await response.text()).find((entry) => entry.event === "done")
      ?.data as { webSources: unknown[]; webSupplementStatus: string };

    expect(done.webSupplementStatus).toBe("failed");
    expect(done.webSources).toEqual([]);
    expect(requestedUrls(fetchMock).some((url) => url.includes("evil.example"))).toBe(false);
  });

  it("外網完全失敗時仍以 200 串流回覆，只有教材依據", async () => {
    enableWebSupplement();
    installFetchMock({
      search: () => jsonResponse({ error: "upstream down" }, 500),
    });

    const response = await postChat(
      requestFor("POST", { message: "凡爾賽條約如何約束德國？" }),
    );
    const streamText = await response.text();
    const events = sseEvents(streamText);
    const done = events.find((entry) => entry.event === "done")?.data as {
      webSources: unknown[];
      webSupplementStatus: string;
      sources: unknown[];
      grounding: string;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(done.webSupplementStatus).toBe("failed");
    expect(done.webSources).toEqual([]);
    expect(done.grounding).toBe("grounded");
    expect(done.sources.length).toBeGreaterThan(0);
    expect(streamText).toContain("你認為條約如何影響德國？");
  });

  it("頁面抓取逾時／非 HTML 時靜默降級", async () => {
    enableWebSupplement();
    installFetchMock({
      search: () => jsonResponse({ results: [{ url: BRITANNICA_URL, title: "t" }] }),
      pages: {
        [BRITANNICA_URL]: () =>
          new Response("<html><body>no text</body></html>", {
            status: 200,
            headers: { "content-type": "application/pdf" },
          }),
      },
    });

    const response = await postChat(
      requestFor("POST", { message: "凡爾賽條約如何約束德國？" }),
    );
    const done = sseEvents(await response.text()).find((entry) => entry.event === "done")
      ?.data as { webSources: unknown[]; webSupplementStatus: string };

    expect(response.status).toBe(200);
    expect(done.webSupplementStatus).toBe("failed");
    expect(done.webSources).toEqual([]);
  });

  it("課題列於封鎖清單時完全不做外網補充", async () => {
    enableWebSupplement({ blockedTopics: "topic-9" });
    const fetchMock = installFetchMock({
      search: () => {
        throw new Error("封鎖課題不應呼叫搜尋端點");
      },
    });

    const response = await postChat(
      requestFor("POST", { message: "凡爾賽條約如何約束德國？" }),
    );
    const done = sseEvents(await response.text()).find((entry) => entry.event === "done")
      ?.data as { webSources: unknown[]; webSupplementStatus: string };

    expect(done.webSupplementStatus).toBe("blocked-topic");
    expect(done.webSources).toEqual([]);
    expect(requestedUrls(fetchMock)).toHaveLength(1);
  });

  it("未設定任何搜尋來源時如實回報 not-used，不嘗試其他抓取方式", async () => {
    enableWebSupplement({ searchEndpoint: null });
    process.env.TUTOR_WEB_SEARCH_PROVIDER = "brave";
    delete process.env.TUTOR_WEB_SEARCH_API_KEY;
    process.env.TUTOR_WEB_SEARCH_FALLBACK_PROVIDER = "none";
    const fetchMock = installFetchMock({});

    const response = await postChat(
      requestFor("POST", { message: "凡爾賽條約如何約束德國？" }),
    );
    const done = sseEvents(await response.text()).find((entry) => entry.event === "done")
      ?.data as { webSources: unknown[]; webSupplementStatus: string };

    expect(done.webSupplementStatus).toBe("not-used");
    expect(requestedUrls(fetchMock)).toHaveLength(1);
  });

  it("改用第三方 provider（無自訂端點）時仍能抓到外部參考，並走同一套白名單過濾", async () => {
    enableWebSupplement({ searchEndpoint: null });
    process.env.TUTOR_WEB_SEARCH_PROVIDER = "brave";
    process.env.TUTOR_WEB_SEARCH_API_KEY = "test-key";
    const fetchMock = installFetchMock({
      brave: () =>
        jsonResponse({
          web: {
            results: [
              { title: "Treaty of Versailles | Britannica", url: BRITANNICA_URL },
              // provider 回傳非白名單結果：必須被丟棄，且不會被抓取
              { title: "維基百科", url: "https://zh.wikipedia.org/wiki/凡爾賽條約" },
            ],
          },
        }),
      pages: { [BRITANNICA_URL]: () => htmlResponse() },
    });

    const response = await postChat(
      requestFor("POST", { message: "凡爾賽條約如何約束德國？" }),
    );
    const done = sseEvents(await response.text()).find((entry) => entry.event === "done")
      ?.data as {
      webSources: { url: string; siteLabel: string }[];
      webSupplementStatus: string;
      sources: unknown[];
    };

    expect(response.status).toBe(200);
    expect(done.webSupplementStatus).toBe("ok");
    expect(done.webSources).toEqual([
      expect.objectContaining({ url: BRITANNICA_URL, siteLabel: "britannica.com" }),
    ]);
    // 教材依據與外部參考仍然分軌
    expect(done.sources.length).toBeGreaterThan(0);

    const urls = requestedUrls(fetchMock);
    expect(urls.some((url) => url.startsWith("https://api.search.brave.com/"))).toBe(true);
    expect(urls.some((url) => url.includes("wikipedia.org"))).toBe(false);
  });

  it("provider 失敗時靜默降級，主回答仍然 200", async () => {
    enableWebSupplement({ searchEndpoint: null });
    process.env.TUTOR_WEB_SEARCH_PROVIDER = "brave";
    process.env.TUTOR_WEB_SEARCH_API_KEY = "test-key";
    // 關閉後備，令「主要來源失敗」直接代表 failed
    process.env.TUTOR_WEB_SEARCH_FALLBACK_PROVIDER = "none";
    // 令 provider 的實際請求失敗（Brave 主機不在 mock 分派內 → 會拋錯）
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url.includes("/chat/completions")) return streamingAnswer();
        throw new Error(`upstream down: ${url}`);
      }),
    );

    const response = await postChat(
      requestFor("POST", { message: "凡爾賽條約如何約束德國？" }),
    );
    const done = sseEvents(await response.text()).find((entry) => entry.event === "done")
      ?.data as { webSources: unknown[]; webSupplementStatus: string; grounding: string };

    expect(response.status).toBe(200);
    expect(done.webSupplementStatus).toBe("failed");
    expect(done.webSources).toEqual([]);
    expect(done.grounding).toBe("grounded");
  });

  it("澄清分支不觸發任何外網抓取", async () => {
    enableWebSupplement();
    const fetchMock = installFetchMock({});
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      requestFor("POST", { message: "極權主義嗰啲嘢係點？" }),
    );
    const payload = (await response.json()) as {
      clarify?: boolean;
      webSources?: unknown[];
      webSupplementStatus?: string;
    };

    expect(payload.clarify).toBe(true);
    expect(payload.webSources).toEqual([]);
    expect(payload.webSupplementStatus).toBe("not-used");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("離題分支不觸發任何外網抓取", async () => {
    enableWebSupplement();
    const fetchMock = installFetchMock({});
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(requestFor("POST", { message: "幫我寫 Python" }));
    const payload = (await response.json()) as {
      onTopic?: boolean;
      webSources?: unknown[];
      webSupplementStatus?: string;
    };

    expect(payload.onTopic).toBe(false);
    expect(payload.webSources).toEqual([]);
    expect(payload.webSupplementStatus).toBe("not-used");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("設定讀取：預設關閉、預設白名單不含共筆百科", () => {
    const config = getServerConfig().webSupplement;
    expect(config.enabled).toBe(false);
    expect(config.mode).toBe("off");
    expect(config.topicAllowlist).toEqual([]);
    expect(config.maxSources).toBe(2);
    expect(config.maxCharsPerSource).toBe(600);
    expect(config.fetchTimeoutMs).toBe(4_000);
    expect(config.budgetMs).toBe(1_500);
    expect(config.searchEndpoint).toBeNull();
    expect(config.allowlist).toContain("britannica.com");
    expect(config.allowlist).toContain("hk.history.museum");
    expect(config.allowlist).toContain("edb.gov.hk");
    expect(config.allowlist).not.toContain("wikipedia.org");
  });

  it("開啟但未指定 TUTOR_WEB_MODE 時，預設策略為 not-covered-only", () => {
    process.env.TUTOR_WEB_SUPPLEMENT_ENABLED = "true";
    expect(getServerConfig().webSupplement.mode).toBe("not-covered-only");
  });

  it("health 端點回報外網補充開關狀態（只有布林值，不含搜尋端點網址）", async () => {
    const { GET: health } = await import("@/app/api/health/route");
    const payload = (await (await health()).json()) as {
      tutorWeb: {
        enabled: boolean;
        mode: string;
        searchConfigured: boolean;
        searchProvider: string | null;
      };
    };
    expect(payload.tutorWeb).toEqual({
      enabled: false,
      mode: "off",
      searchConfigured: false,
      searchProvider: null,
    });
  });

  it("開啟後 health 如實反映開關及「是否已設定搜尋端點」，且不外泄端點網址", async () => {
    enableWebSupplement();
    const { GET: health } = await import("@/app/api/health/route");
    const raw = await (await health()).text();
    expect(raw).not.toContain("search.example.com");
    const payload = JSON.parse(raw) as {
      tutorWeb: {
        enabled: boolean;
        mode: string;
        searchConfigured: boolean;
        searchProvider: string | null;
      };
    };
    expect(payload.tutorWeb).toEqual({
      enabled: true,
      mode: "always",
      searchConfigured: true,
      searchProvider: "endpoint",
    });
  });

  it("只開啟開關而未設定任何搜尋來源時，health 顯示 searchConfigured=false（不會誤報可用）", async () => {
    enableWebSupplement({ searchEndpoint: null });
    process.env.TUTOR_WEB_SEARCH_PROVIDER = "brave";
    delete process.env.TUTOR_WEB_SEARCH_API_KEY;
    // 沒有主要來源，也沒有後備 → 不應誤報可用
    process.env.TUTOR_WEB_SEARCH_FALLBACK_PROVIDER = "none";
    const { GET: health } = await import("@/app/api/health/route");
    const payload = (await (await health()).json()) as {
      tutorWeb: { enabled: boolean; searchConfigured: boolean; searchProvider: string | null };
    };
    expect(payload.tutorWeb.enabled).toBe(true);
    expect(payload.tutorWeb.searchConfigured).toBe(false);
    expect(payload.tutorWeb.searchProvider).toBeNull();
  });

  it("改用第三方 provider 時 health 顯示 searchProvider=brave 且不外泄 API key", async () => {
    enableWebSupplement({ searchEndpoint: null });
    process.env.TUTOR_WEB_SEARCH_PROVIDER = "brave";
    process.env.TUTOR_WEB_SEARCH_API_KEY = "secret-key-should-not-leak";
    const { GET: health } = await import("@/app/api/health/route");
    const raw = await (await health()).text();
    expect(raw).not.toContain("secret-key-should-not-leak");
    const payload = JSON.parse(raw) as {
      tutorWeb: { searchConfigured: boolean; searchProvider: string | null };
    };
    expect(payload.tutorWeb.searchConfigured).toBe(true);
    expect(payload.tutorWeb.searchProvider).toBe("brave");
  });

  it("mode=not-covered-only 時，教材已命中就不抓外網", async () => {
    enableWebSupplement({ mode: "not-covered-only" });
    const fetchMock = installFetchMock({});

    const response = await postChat(
      requestFor("POST", { message: "凡爾賽條約如何約束德國？" }),
    );
    const done = sseEvents(await response.text()).find((entry) => entry.event === "done")
      ?.data as { webSupplementStatus: string; webSources: unknown[]; grounding: string };

    expect(done.grounding).toBe("grounded");
    expect(done.webSupplementStatus).toBe("not-used");
    expect(done.webSources).toEqual([]);
    // 只有 DeepSeek 上游，沒有搜尋或抓取
    expect(requestedUrls(fetchMock)).toHaveLength(1);
  });

  it("TUTOR_WEB_TOPIC_ALLOWLIST 未包含當前課題時不做外網", async () => {
    enableWebSupplement();
    process.env.TUTOR_WEB_TOPIC_ALLOWLIST = "topic-5";
    const fetchMock = installFetchMock({});

    const response = await postChat(
      requestFor("POST", { message: "凡爾賽條約如何約束德國？" }),
    );
    const done = sseEvents(await response.text()).find((entry) => entry.event === "done")
      ?.data as { webSupplementStatus: string; webSources: unknown[] };

    expect(done.webSupplementStatus).toBe("not-used");
    expect(done.webSources).toEqual([]);
    expect(requestedUrls(fetchMock)).toHaveLength(1);
  });

  it("外網超過時間預算時放棄，主回答仍然成功且狀態為 failed", async () => {
    enableWebSupplement();
    process.env.TUTOR_WEB_BUDGET_MS = "200";
    installFetchMock({
      // 搜尋端點永遠不回應（模擬慢速外網）
      search: () => new Promise<Response>(() => {}),
    });

    const response = await postChat(
      requestFor("POST", { message: "凡爾賽條約如何約束德國？" }),
    );
    const streamText = await response.text();
    const done = sseEvents(streamText).find((entry) => entry.event === "done")?.data as {
      webSupplementStatus: string;
      webSources: unknown[];
      grounding: string;
    };

    expect(response.status).toBe(200);
    expect(done.grounding).toBe("grounded");
    expect(done.webSupplementStatus).toBe("failed");
    expect(done.webSources).toEqual([]);
    expect(streamText).toContain("你認為條約如何影響德國？");
  });
});
