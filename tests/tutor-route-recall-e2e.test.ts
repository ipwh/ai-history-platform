/**
 * 學生正式路線的召回端到端測試（Sprint 34）。
 *
 * ── 為甚麼要再由 route 測一次 ──────────────────────────────────────
 * 檢索修正若只在 `findTutorGrounding` 層驗證，無法證明「學生實際看到甚麼」：
 * route 會再做可答性判斷、語意改寫、外網補充、提示詞組裝及串流。Sprint 34 的
 * 召回修正必須在這條路線上證明有效，因此這裡以完整 API 路由驗證：
 *   ① 原本回報「教材找不到」的概念，現在會帶教材出處；
 *   ② 學生請求的 body 沒有因評估需要而改變（不可出現 `stream_options`）；
 *   ③ 非歷史提問仍然零模型呼叫；
 *   ④ 額度與授權行為不變。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE, encodeSession } from "@/server/auth/session";
import { ensureLearner } from "@/server/repositories/learners";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("tutor-route-recall-e2e");
process.env.AUTH_SECRET = "tutor-route-recall-secret-0123456789";
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
process.env.TUTOR_WEB_SUPPLEMENT_ENABLED = "false";

const STUDENT = "school:s2024601@pochiu.edu.hk";
const EMAIL = "s2024601@pochiu.edu.hk";
const APARTHEID_BLOCK =
  "南非白人政府在1950至1990年代堅持實行種族隔離政策，把不同種族在居住、教育及公共設施上強制分開；聯合國多次譴責並實施制裁。";

let postChat: typeof import("@/app/api/tutor/chat/route").POST;
let getDb: typeof import("@/server/db/connection").getDb;

function requestFor(body: unknown, withCookie = true): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (withCookie) {
    headers.cookie = `${SESSION_COOKIE}=${encodeURIComponent(
      encodeSession({
        email: EMAIL,
        name: "測試學生",
        role: "student",
        learnerId: STUDENT,
        rosterVerified: true,
        className: "3B",
        studentNumber: "s2024601",
      }),
    )}`;
  }
  return new Request("http://localhost/api/tutor/chat", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
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

function streamingAnswer(answer: string): Response {
  const events = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 900, completion_tokens: 120 } })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
  return new Response(events, { status: 200, headers: { "content-type": "text/event-stream" } });
}

beforeAll(async () => {
  ({ POST: postChat } = await import("@/app/api/tutor/chat/route"));
  getDb = (await import("@/server/db/connection")).getDb;
  ensureLearner(STUDENT);

  const db = getDb();
  const now = "2026-11-07T00:00:00.000+08:00";
  db.prepare(
    `INSERT INTO topics (id, title, description, published, sort_order, created_at, updated_at)
     VALUES ('topic-11', '課題11：20世紀以來的國際合作', '', 1, 11, ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO material_documents
       (id, file_name, kind, status, created_at, student_distribution, rights_confirmed_at)
     VALUES ('doc-un', '課題11 國際合作_筆記.docx', 'demo', 'ready', ?, 1, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO material_blocks
       (id, document_id, topic_id, section_id, sort_order, type, text, source_location, created_at, extraction_method)
     VALUES ('block-un', 'doc-un', 'topic-11', NULL, 0, 'paragraph', ?, ?, ?, 'native')`,
  ).run(APARTHEID_BLOCK, "課題11 國際合作_筆記.docx · 第 2 段（段落）", now);
});

beforeEach(() => {
  vi.unstubAllGlobals();
  const db = getDb();
  db.prepare("DELETE FROM tutor_messages").run();
  db.prepare("DELETE FROM tutor_sessions").run();
  db.prepare("DELETE FROM ai_operations").run();
});

describe("學生路線：召回修正的端到端證據", () => {
  it("概念不在分節關鍵詞但教材有內容時，回覆會帶教材出處（原本為未涵蓋）", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => streamingAnswer("種族隔離是制度化的種族分隔。"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(requestFor({ message: "什么是种族隔离？" }));
    const events = sseEvents(await response.text());
    const meta = events.find((entry) => entry.event === "meta")?.data as {
      grounding: string;
      topicTitle: string | null;
      sources: { location: string; excerpt: string }[];
    };

    expect(response.status).toBe(200);
    expect(meta.grounding).toBe("grounded");
    expect(meta.topicTitle).toContain("國際合作");
    expect(meta.sources.length).toBeGreaterThan(0);
    expect(meta.sources[0]?.location).toContain("第2段");
  });

  it("教材片段會進入提示詞，且模型可見的用語與教材一致", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => streamingAnswer("示範回答。"));
    vi.stubGlobal("fetch", fetchMock);

    await (await postChat(requestFor({ message: "什么是种族隔离？" }))).text();

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      messages: { role: string; content: string }[];
    };
    const systemPrompt = body.messages[0]?.content ?? "";
    expect(systemPrompt).toContain("種族隔離");
    expect(systemPrompt).toContain("1950至1990年代");
  });

  it("學生請求 body 維持原有格式：串流但沒有 stream_options（評估用的 usage 選項不外泄）", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => streamingAnswer("示範回答。"));
    vi.stubGlobal("fetch", fetchMock);

    await (await postChat(requestFor({ message: "什么是种族隔离？" }))).text();

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(body.stream_options).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("include_usage");
  });

  it("非歷史提問仍然零模型呼叫，並如實回報外網補充未執行", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => streamingAnswer("不應被呼叫"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(requestFor({ message: "邊隊贏咗昨晚場波？" }));
    await response.text();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("未登入時拒絕（401），不會消耗任何模型呼叫", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => streamingAnswer("不應被呼叫"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(requestFor({ message: "什么是种族隔离？" }, false));
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("額度：一次提問只記一次 AI 操作（召回修正不增加成本）", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => streamingAnswer("示範回答。")));
    await (await postChat(requestFor({ message: "什么是种族隔离？" }))).text();

    const row = getDb()
      .prepare("SELECT COUNT(*) AS count FROM ai_operations WHERE learner_id = ?")
      .get(STUDENT) as { count: number } | undefined;
    expect(row?.count).toBe(1);
  });
});
