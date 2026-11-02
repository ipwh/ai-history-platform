/**
 * 學伴「語意改寫」的路由接線測試（端到端）。
 *
 * 情境：學生的說法與教材用語完全不重疊（學生問「貿易安排」，教材寫「自由貿易港口」），
 * 字詞檢索因此一段都找不到。語意改寫（預設開啟）會先請模型把提問改寫成教材用語，
 * 再重試檢索；成功後才把教材片段放進提示詞，並在 meta 事件標示 `grounded`。
 *
 * 這裡刻意用完整的 API 路由（而不是只測服務），因為要驗證的是「只在檢索失敗時觸發」、
 * 「改寫請求是 JSON 模式」、「重試結果會覆蓋原來的 not-covered」這三項接線行為。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE, encodeSession } from "@/server/auth/session";
import { ensureLearner } from "@/server/repositories/learners";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("tutor-query-expansion-route");
process.env.AUTH_SECRET = "tutor-expansion-route-secret-0123456789";
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
process.env.TUTOR_QUERY_EXPANSION_ENABLED = "true";

const STUDENT = "school:s2024501@pochiu.edu.hk";
/** 學生的問法：與教材用語（自由貿易港口）完全不重疊 */
const QUESTION = "香港開埠後，當地嘅貿易安排有甚麼改變？";
/** 教材原文：刻意不含「開埠」「自由港」「割讓」「侵佔」「佔領香港」等同義寫法 */
const PASSAGE = "英國於1841年取得香港島後，宣布當地為自由貿易港口，商人可自由進出。";

let postChat: typeof import("@/app/api/tutor/chat/route").POST;
let getDb: typeof import("@/server/db/connection").getDb;
let expansion: typeof import("@/server/services/tutor-query-expansion");

function requestFor(body: unknown): Request {
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
  return new Request("http://localhost/api/tutor/chat", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockStreamingAnswer(answer: string): Response {
  const events = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
  return new Response(events, { status: 200, headers: { "content-type": "text/event-stream" } });
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

interface FetchBody {
  stream?: boolean;
  response_format?: { type?: string };
  messages?: { role: string; content: string }[];
}

/**
 * 假模型：語意改寫請求（帶 `response_format`）回傳 JSON；其餘（串流回答）回傳 SSE。
 * 這樣兩次呼叫都不需依賴次序假設。
 */
function mockLlm(): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as FetchBody;
    if (body.response_format !== undefined) {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ terms: ["自由貿易", "港口"] }) } }],
          usage: { prompt_tokens: 90, completion_tokens: 18 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return mockStreamingAnswer("你可以先想想，自由貿易如何影響香港的港口發展？");
  });
}

beforeAll(async () => {
  ({ POST: postChat } = await import("@/app/api/tutor/chat/route"));
  getDb = (await import("@/server/db/connection")).getDb;
  expansion = await import("@/server/services/tutor-query-expansion");
  ensureLearner(STUDENT);

  const db = getDb();
  const now = "2026-11-02T00:00:00.000+08:00";
  db.prepare(
    `INSERT INTO topics (id, title, description, published, sort_order, created_at, updated_at)
     VALUES ('topic-8', '課題8：香港直至19世紀末的成長與發展', '', 1, 8, ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO material_documents
       (id, file_name, kind, status, created_at, student_distribution, rights_confirmed_at)
     VALUES ('doc-hk', '課題8 香港直至十九世紀末的成長與發展_筆記.docx', 'demo', 'ready', ?, 1, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO material_blocks
       (id, document_id, topic_id, section_id, sort_order, type, text, source_location, created_at, extraction_method)
     VALUES ('block-hk', 'doc-hk', 'topic-8', NULL, 0, 'paragraph', ?, ?, ?, 'native')`,
  ).run(
    PASSAGE,
    "課題8 香港直至十九世紀末的成長與發展_筆記.docx · 第 1 段（段落）",
    now,
  );
});

beforeEach(() => {
  vi.unstubAllGlobals();
  expansion.clearTutorQueryExpansionCache();
  process.env.DEEPSEEK_API_KEY = "test-only-key";
  process.env.TUTOR_QUERY_EXPANSION_ENABLED = "true";
  const db = getDb();
  db.prepare("DELETE FROM tutor_messages").run();
  db.prepare("DELETE FROM tutor_sessions").run();
  db.prepare("DELETE FROM ai_operations").run();
});

describe("學伴語意改寫：路由接線", () => {
  it("字詞檢索失敗時先改寫再重試，成功後以教材片段作答", async () => {
    const fetchMock = mockLlm();
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(requestFor({ message: QUESTION }));
    expect(response.status).toBe(200);
    const events = sseEvents(await response.text());

    // ① 改寫請求：JSON 模式，只帶提問及課題，不含任何身分資料
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const expansionBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as FetchBody &
      Record<string, unknown>;
    expect(expansionBody.response_format?.type).toBe("json_object");
    // 送去改寫的是正規化後的提問（與檢索使用同一份文字），不含身分資料
    expect(expansionBody.messages?.[1]?.content).toContain("開埠");
    expect(expansionBody.messages?.[1]?.content).toContain("貿易安排");
    expect(JSON.stringify(expansionBody)).not.toContain("s2024501");

    // ② 主回答請求：教材片段已由重試檢索取得
    const answerBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as FetchBody;
    expect(answerBody.stream).toBe(true);
    expect(answerBody.messages?.[0]?.content).toContain(PASSAGE);

    // ③ 介面標示：由 not-covered 改為 grounded，並附上課題8 的出處
    const meta = events.find((entry) => entry.event === "meta")?.data as {
      grounding: string;
      sources: { documentLabel: string }[];
    };
    expect(meta.grounding).toBe("grounded");
    expect(meta.sources.length).toBeGreaterThan(0);
    expect(meta.sources[0]?.documentLabel).toContain("課題8");
  });

  it("改寫失敗時安靜降級，維持原本的「未找到教材依據」", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as FetchBody;
      if (body.response_format !== undefined) {
        return new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 });
      }
      return mockStreamingAnswer("我在教材中找不到這部分的內容，以下屬補充。");
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(requestFor({ message: QUESTION }));
    expect(response.status).toBe(200);
    const events = sseEvents(await response.text());

    const meta = events.find((entry) => entry.event === "meta")?.data as {
      grounding: string;
      sources: unknown[];
    };
    expect(meta.grounding).toBe("not-covered");
    expect(meta.sources).toHaveLength(0);
  });

  it("教材一開始就命中時不會呼叫改寫（零額外請求）", async () => {
    const fetchMock = mockLlm();
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      requestFor({ message: "香港開埠後有甚麼自由貿易港口？" }),
    );
    expect(response.status).toBe(200);
    const events = sseEvents(await response.text());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      (JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as FetchBody).response_format,
    ).toBeUndefined();
    const meta = events.find((entry) => entry.event === "meta")?.data as { grounding: string };
    expect(meta.grounding).toBe("grounded");
  });
});
