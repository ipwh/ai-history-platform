import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE, encodeSession } from "@/server/auth/session";
import {
  createTutorSession,
  getTutorMessages,
  saveTutorMessage,
} from "@/server/repositories/tutor";
import { ensureLearner } from "@/server/repositories/learners";
import { hongKongTimestamp } from "@/server/services/tutor";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("tutor-grounding-api");
process.env.AUTH_SECRET = "tutor-grounding-api-secret-012345678901";
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

const STUDENT = "school:s2024301@pochiu.edu.hk";

let postChat: typeof import("@/app/api/tutor/chat/route").POST;
let getChat: typeof import("@/app/api/tutor/chat/route").GET;
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
      studentNumber: "s2024301",
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

beforeAll(async () => {
  ({ POST: postChat, GET: getChat } = await import("@/app/api/tutor/chat/route"));
  getDb = (await import("@/server/db/connection")).getDb;
  ensureLearner(STUDENT);

  const db = getDb();
  const now = "2026-10-27T00:00:00.000+08:00";
  db.prepare(
    `INSERT INTO topics (id, title, description, published, sort_order, created_at, updated_at)
     VALUES ('topic-9', '課題9：20世紀的國際紛爭及危機(I)–兩次世界大戰', '', 1, 9, ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO material_documents
       (id, file_name, kind, status, created_at, student_distribution, rights_confirmed_at)
     VALUES ('doc-notes', '課題9 兩次世界大戰_筆記.docx', 'demo', 'ready', ?, 1, ?)`,
  ).run(now, now);
  // 另一個課題的教材：用於驗證上一輪的課題不會污染當前問題
  db.prepare(
    `INSERT INTO topics (id, title, description, published, sort_order, created_at, updated_at)
     VALUES ('topic-5', '課題5：近代歐洲的興起', '', 1, 5, ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO material_documents
       (id, file_name, kind, status, created_at, student_distribution, rights_confirmed_at)
     VALUES ('doc-renaissance', '課題5 近代歐洲的興起_筆記.docx', 'demo', 'ready', ?, 1, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO material_blocks
       (id, document_id, topic_id, section_id, sort_order, type, text, source_location, created_at, extraction_method)
     VALUES ('block-renaissance', 'doc-renaissance', 'topic-5', NULL, 0, 'paragraph',
             '文藝復興復興古希臘、羅馬文明，重視人文主義及個人價值，藝術創作採用透視法。',
             '課題5 近代歐洲的興起_筆記.docx · 第 1 段（段落）', ?, 'native')`,
  ).run(now);
  const texts = [
    "凡爾賽條約的內容",
    "《凡爾賽條約》規定德國須限制軍隊數目、放棄海外殖民地及支付巨額賠款，並承認發動戰爭的責任。",
    "條約亦設立國際聯盟，但美國最終沒有加入。",
  ];
  texts.forEach((text, index) => {
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
  const db = getDb();
  db.prepare("DELETE FROM tutor_messages").run();
  db.prepare("DELETE FROM tutor_sessions").run();
  db.prepare("DELETE FROM ai_operations").run();
});

describe("學伴 API：教材依據", () => {
  it("先送出教材依據，再把教材片段放進提示詞，並保存出處", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      mockStreamingAnswer("你認為《凡爾賽條約》如何影響德國？"),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      requestFor("POST", { message: "凡爾賽條約如何約束德國？" }),
    );
    const streamText = await response.text();
    const events = sseEvents(streamText);

    const meta = events.find((entry) => entry.event === "meta")?.data as {
      grounding: string;
      sources: { documentLabel: string; location: string; excerpt: string }[];
    };
    expect(meta.grounding).toBe("grounded");
    expect(meta.sources.length).toBeGreaterThan(0);
    expect(meta.sources[0]?.excerpt.length).toBeLessThanOrEqual(60);

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      messages: { role: string; content: string }[];
    };
    const systemPrompt = requestBody.messages[0]?.content ?? "";
    expect(systemPrompt).toContain("【教材片段】");
    expect(systemPrompt).toContain("唯一可用的事實依據");
    expect(systemPrompt).toContain("巨額賠款");

    const sessionId = response.headers.get("x-tutor-session-id") ?? "";
    const saved = getTutorMessages(sessionId);
    expect(saved).toHaveLength(2);
    const answer = saved.find((message) => message.role === "assistant");
    expect(answer?.groundingStatus).toBe("grounded");
    expect(answer?.sources.length).toBeGreaterThan(0);
  });

  it("模型用了課本以外譯名時，回覆完成事件會帶同課本用語對照", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      mockStreamingAnswer("希特勒於1933年出任德國總理，他承諾推翻《凡爾賽條約》。"),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      requestFor("POST", { message: "凡爾賽條約如何約束德國？" }),
    );
    const streamText = await response.text();
    const done = sseEvents(streamText).find((entry) => entry.event === "done")?.data as {
      termNotes: { canonical: string; used: string }[];
    };

    expect(done.termNotes).toEqual([{ canonical: "希特拉", used: "希特勒" }]);

    const sessionId = response.headers.get("x-tutor-session-id") ?? "";
    const answer = getTutorMessages(sessionId).find((message) => message.role === "assistant");
    expect(answer?.termNotes).toEqual([{ canonical: "希特拉", used: "希特勒" }]);
  });

  it("教材找不到相關內容時仍會回答，但標示為「課本未涵蓋」", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      mockStreamingAnswer("課本這部分沒有提及；一般而言……"),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      requestFor("POST", { message: "伊斯蘭曆法的計算方法是甚麼？" }),
    );
    const streamText = await response.text();
    const meta = sseEvents(streamText).find((entry) => entry.event === "meta")?.data as {
      grounding: string;
      sources: unknown[];
    };

    expect(meta.grounding).toBe("not-covered");
    expect(meta.sources).toHaveLength(0);

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      messages: { role: string; content: string }[];
    };
    const systemPrompt = requestBody.messages[0]?.content ?? "";
    expect(systemPrompt).toContain("本次提問未能在本校教材中找到相關段落");
    expect(systemPrompt).not.toContain("唯一可用的事實依據");
  });

  it("重新載入對話仍然顯示同一組教材依據標示", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      mockStreamingAnswer("你認為條約如何影響德國？"),
    );
    vi.stubGlobal("fetch", fetchMock);

    const posted = await postChat(
      requestFor("POST", { message: "凡爾賽條約如何約束德國？" }),
    );
    await posted.text();
    const sessionId = posted.headers.get("x-tutor-session-id") ?? "";

    const response = await getChat(
      requestFor("GET", undefined, `?sessionId=${encodeURIComponent(sessionId)}`),
    );
    const payload = (await response.json()) as {
      messages: { role: string; groundingStatus?: string; sources?: unknown[] }[];
    };
    const answer = payload.messages.find((message) => message.role === "assistant");
    expect(answer?.groundingStatus).toBe("grounded");
    expect(answer?.sources?.length).toBeGreaterThan(0);
  });

  it("模型自行說「課本沒有提及」時，最終標示降級為未涵蓋且不顯示出處", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      mockStreamingAnswer("課本這部分沒有提及；以下屬一般背景補充，不是教材說法。"),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      requestFor("POST", { message: "凡爾賽條約如何約束德國？" }),
    );
    const streamText = await response.text();
    const events = sseEvents(streamText);
    const meta = events.find((entry) => entry.event === "meta")?.data as { grounding: string };
    const done = events.find((entry) => entry.event === "done")?.data as {
      grounding: string;
      sources: unknown[];
      topicTitle: string | null;
    };

    // 檢索當下找到段落，但模型判斷內容不適用，最終標示以模型說明為準
    expect(meta.grounding).toBe("grounded");
    expect(done.grounding).toBe("not-covered");
    expect(done.sources).toHaveLength(0);
    expect(done.topicTitle).toBeNull();

    const sessionId = response.headers.get("x-tutor-session-id") ?? "";
    const answer = getTutorMessages(sessionId).find((message) => message.role === "assistant");
    expect(answer?.groundingStatus).toBe("not-covered");
    expect(answer?.sources).toHaveLength(0);
  });

  it("同一對話先問文藝復興，之後問凡爾賽條約仍以課題9 教材為依據", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      mockStreamingAnswer("你認為條約如何影響德國？"),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await postChat(
      requestFor("POST", { message: "文藝復興有甚麼特色？" }),
    );
    const sessionId = first.headers.get("x-tutor-session-id") ?? "";
    await first.text();

    const second = await postChat(
      requestFor("POST", { message: "凡爾賽條約如何約束德國？", sessionId }),
    );
    const streamText = await second.text();
    const meta = sseEvents(streamText).find((entry) => entry.event === "meta")?.data as {
      grounding: string;
      sources: { documentLabel: string }[];
    };

    expect(meta.grounding).toBe("grounded");
    expect(meta.sources.every((source) => source.documentLabel.includes("課題9"))).toBe(true);

    const secondRequestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      messages: { role: string; content: string }[];
    };
    expect(secondRequestBody.messages[0]?.content).not.toContain("透視法");
  });

  it("上一次失敗留下的提問不會送去模型，也不會影響本次教材依據", async () => {
    const sessionId = createTutorSession(STUDENT, hongKongTimestamp());
    // 模擬上一次請求失敗：資料庫只有學生提問，沒有 assistant 回覆
    saveTutorMessage(sessionId, "user", "凡爾賽條約如何約束德國？", hongKongTimestamp());

    const fetchMock = vi.fn<typeof fetch>(async () =>
      mockStreamingAnswer("可以從思想工具與傳播條件去想。"),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      requestFor("POST", {
        message: "我想知道文藝復興如何導致宗教革命的出現。",
        sessionId,
      }),
    );
    const streamText = await response.text();

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      messages: { role: string; content: string }[];
    };
    // 只有 system 及本次提問：失敗的提問不可令模型一併回答兩題
    expect(requestBody.messages).toHaveLength(2);
    expect(requestBody.messages[1]?.content).toBe("我想知道文藝復興如何導致宗教革命的出現。");

    const meta = sseEvents(streamText).find((entry) => entry.event === "meta")?.data as {
      grounding: string;
      sources: { documentLabel: string }[];
    };
    expect(meta.grounding).toBe("grounded");
    expect(meta.sources.every((source) => source.documentLabel.includes("課題5"))).toBe(true);
  });
});
