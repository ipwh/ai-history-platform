/**
 * 學伴「語意改寫」（LLM query expansion）測試。
 *
 * 驗證重點：
 *   1. 關閉或非 DeepSeek provider 時**零請求**（與加入此功能前的行為一致）。
 *   2. 詞語過濾：繁體化、長度、停用詞、重複、數量上限。
 *   3. 失敗（HTTP 錯誤、格式錯誤）一律 fail-open，不會令學伴請求失敗。
 *   4. 同一條提問只改寫一次（程序內快取）。
 *   5. 用量記錄可區分為 `tutor-expansion`，方便教師端查看成本。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("tutor-query-expansion");
process.env.AUTH_SECRET = "tutor-expansion-secret-0123456789012345";
process.env.AUTH_REQUIRE_SIGN_IN = "false";
process.env.BACKUP_ENABLED = "false";

type ExpansionModule = typeof import("@/server/services/tutor-query-expansion");

let expansion: ExpansionModule;
let getDb: typeof import("@/server/db/connection").getDb;

const CONFIG = { enabled: true, budgetMs: 2_500, maxTerms: 6 };
const LLM = {
  provider: "deepseek",
  apiKey: "test-only-key",
  baseUrl: "https://api.deepseek.example/v1",
  model: "deepseek-chat",
};

function jsonResponse(content: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 120, completion_tokens: 24 },
    }),
    { status, headers: { "content-type": "application/json" } },
  );
}

function usageRows(): { request_type: string; success: number; error_type: string | null }[] {
  return getDb()
    .prepare("SELECT request_type, success, error_type FROM llm_usage_logs ORDER BY rowid")
    .all() as unknown as { request_type: string; success: number; error_type: string | null }[];
}

beforeAll(async () => {
  expansion = await import("@/server/services/tutor-query-expansion");
  getDb = (await import("@/server/db/connection")).getDb;
});

beforeEach(() => {
  expansion.clearTutorQueryExpansionCache();
  vi.unstubAllGlobals();
});

describe("學伴語意改寫：開關及供應商", () => {
  it("功能關閉時不會發出任何請求", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const result = await expansion.expandTutorQuery({
      message: "列出香港開埠的過程",
      topicTitle: null,
      config: { ...CONFIG, enabled: false },
      llm: LLM,
    });

    expect(result).toEqual({ status: "disabled", terms: [], usage: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("非 DeepSeek provider 時不會發出請求", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const result = await expansion.expandTutorQuery({
      message: "列出香港開埠的過程",
      topicTitle: null,
      config: CONFIG,
      llm: { ...LLM, provider: "mock" },
    });

    expect(result.status).toBe("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("學伴語意改寫：詞語過濾", () => {
  it("只保留可作教材檢索的詞語（繁體化、去停用詞、去重、限長）", () => {
    const terms = expansion.sanitizeExpansionTerms(
      {
        terms: [
          "割让", // 簡體 → 割讓
          "自由港",
          "自由港", // 重複
          "甚麼", // 提問用語
          "香", // 太短（1 字）
          "一二三四五六七八九十一二三", // 太長（13 字）
          "南京條約",
          123,
          "",
        ],
      },
      { maxTerms: 6, question: "列出香港開埠的過程" },
    );

    expect(terms).toContain("割讓");
    expect(terms).toContain("自由港");
    expect(terms).toContain("南京條約");
    expect(terms.filter((term) => term === "自由港")).toHaveLength(1);
    expect(terms).not.toContain("甚麼");
    expect(terms).not.toContain("一二三四五六七八九十一二三");
    expect(new Set(terms).size).toBe(terms.length);
  });

  it("整條提問原句不會成為檢索詞", () => {
    expect(
      expansion.sanitizeExpansionTerms(
        { terms: ["香港開埠的過程", "自由港"] },
        { question: "香港開埠的過程" },
      ),
    ).toEqual(["自由港"]);
  });

  it("數量受上限約束", () => {
    const terms = expansion.sanitizeExpansionTerms(
      { terms: ["割讓", "自由港", "侵佔", "轉口港", "東華三院", "保良局", "團防局"] },
      { maxTerms: 3 },
    );
    expect(terms).toHaveLength(3);
  });
});

describe("學伴語意改寫：呼叫模型", () => {
  it("回傳可用詞語並記錄用量", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(JSON.stringify({ terms: ["割讓", "自由港", "南京條約", "甚麼"] })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await expansion.expandTutorQuery({
      message: "列出香港開埠的過程",
      topicTitle: "課題8：香港直至19世紀末的成長與發展",
      topicId: "topic-8",
      config: CONFIG,
      llm: LLM,
    });

    expect(result.status).toBe("expanded");
    expect(result.terms).toEqual(["割讓", "自由港", "南京條約"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(usageRows()).toContainEqual(
      expect.objectContaining({ request_type: "tutor-expansion", success: 1 }),
    );

    // 請求內容：JSON 模式、角色提示、不夾帶任何身分資料
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      response_format?: { type?: string };
      messages?: { role: string; content: string }[];
    };
    expect(body.response_format?.type).toBe("json_object");
    expect(body.messages?.[0]?.content).toContain("json");
    expect(body.messages?.[1]?.content).toContain("列出香港開埠的過程");
    expect(JSON.stringify(body)).not.toContain("learner");
  });

  it("同一條提問只改寫一次", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(JSON.stringify({ terms: ["割讓"] })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await expansion.expandTutorQuery({
      message: "列出香港開埠的過程",
      topicTitle: null,
      config: CONFIG,
      llm: LLM,
    });
    const second = await expansion.expandTutorQuery({
      message: "列出香港開埠的過程",
      topicTitle: null,
      config: CONFIG,
      llm: LLM,
    });

    expect(first.terms).toEqual(["割讓"]);
    expect(second.terms).toEqual(["割讓"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("上游錯誤時 fail-open（回傳空詞表並記錄失敗）", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await expansion.expandTutorQuery({
      message: "這條提問會失敗",
      topicTitle: null,
      config: CONFIG,
      llm: LLM,
    });

    expect(result.status).toBe("failed");
    expect(result.terms).toEqual([]);
    expect(usageRows()).toContainEqual(
      expect.objectContaining({ request_type: "tutor-expansion", success: 0 }),
    );
  });

  it("模型回覆不是 JSON 時 fail-open", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse("自由港、割讓"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await expansion.expandTutorQuery({
      message: "另一條提問",
      topicTitle: null,
      config: CONFIG,
      llm: LLM,
    });

    expect(result.status).toBe("failed");
    expect(result.terms).toEqual([]);
  });

  it("沒有合格詞語時回傳 empty", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(JSON.stringify({ terms: ["甚麼", "如何"] })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await expansion.expandTutorQuery({
      message: "第三條提問",
      topicTitle: null,
      config: CONFIG,
      llm: LLM,
    });

    expect(result.status).toBe("empty");
    expect(result.terms).toEqual([]);
  });
});
