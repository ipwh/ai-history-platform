import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE, encodeSession } from "@/server/auth/session";
import { ensureLearner } from "@/server/repositories/learners";
import {
  createTutorSession,
  getTutorMessages,
  getTutorSessionLearnerId,
  saveTutorMessage,
} from "@/server/repositories/tutor";
import {
  hongKongTimestamp,
  TUTOR_DAILY_LIMIT,
  TUTOR_OFF_TOPIC_REPLY,
  tutorDailyUsage,
} from "@/server/services/tutor";
import { describeAiLimit } from "@/server/services/ai-limits";
import { TUTOR_STUDENT_EXCERPT_MAX_CHARS } from "@/server/services/tutor-grounding";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("tutor-simulation");
process.env.AUTH_SECRET = "tutor-simulation-secret-0123456789abc";
process.env.AUTH_REQUIRE_SIGN_IN = "true";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_STAFF_ACCESS_POLICY = "allowlist";
process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
process.env.AUTH_TEACHER_EMAILS = "teacher@example.com";
process.env.HISTORY_REVIEWER_EMAILS = "teacher@example.com";
delete process.env.AUTH_STAFF_DOMAINS;
process.env.LLM_PROVIDER = "deepseek";
process.env.DEEPSEEK_API_KEY = "simulation-key";
process.env.AI_LIMITS_ENABLED = "true";
process.env.AI_LIMIT_WINDOW_MINUTES = "60";
process.env.AI_GENERATIONS_PER_LEARNER = "100";
process.env.AI_GENERATIONS_GLOBAL = "100";
process.env.BACKUP_ENABLED = "false";

const STUDENT = "school:s2025001@pochiu.edu.hk";
const OTHER_STUDENT = "school:s2025002@pochiu.edu.hk";
const TEACHER = "teacher:teacher@example.com";
const ADMIN = "admin:admin@example.com";

let postChat: typeof import("@/app/api/tutor/chat/route").POST;
let getChat: typeof import("@/app/api/tutor/chat/route").GET;
let getDb: typeof import("@/server/db/connection").getDb;

function cookieFor(options: {
  learnerId: string;
  role: "student" | "teacher" | "admin";
  rosterVerified?: boolean;
}): string {
  const email = options.learnerId.slice(options.learnerId.indexOf(":") + 1);
  return `${SESSION_COOKIE}=${encodeURIComponent(
    encodeSession({
      email,
      name: "模擬使用者",
      role: options.role,
      learnerId: options.learnerId,
      rosterVerified: options.role === "student" ? (options.rosterVerified ?? true) : false,
      className: options.role === "student" ? "1A" : null,
      studentNumber: options.role === "student" ? "s2025001" : null,
    }),
  )}`;
}

function request(
  method: "GET" | "POST",
  options: {
    learnerId?: string | null;
    role?: "student" | "teacher" | "admin";
    rosterVerified?: boolean;
    body?: unknown;
    rawBody?: string;
    query?: string;
  } = {},
): Request {
  const cookie =
    options.learnerId === null || options.learnerId === undefined
      ? null
      : cookieFor({
          learnerId: options.learnerId,
          role: options.role ?? "student",
          rosterVerified: options.rosterVerified,
        });
  const payload =
    options.rawBody !== undefined
      ? options.rawBody
      : options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined;
  return new Request(`http://localhost/api/tutor/chat${options.query ?? ""}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(payload !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(payload !== undefined ? { body: payload } : {}),
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
      const lines = chunk.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event:"));
      const dataLine = lines.find((line) => line.startsWith("data:"));
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
  ensureLearner(OTHER_STUDENT);
  ensureLearner(TEACHER);
  ensureLearner(ADMIN);

  const db = getDb();
  const now = "2026-10-27T00:00:00.000+08:00";
  db.prepare(
    `INSERT INTO topics (id, title, description, published, sort_order, created_at, updated_at)
     VALUES ('topic-9', '課題9：20世紀的國際紛爭及危機(I)–兩次世界大戰', '', 1, 9, ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO sections (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
     VALUES ('topic-9-interwar', 'topic-9', NULL, '兩次大戰期間', '', '["極權","巴黎和會"]', 1, ?, ?)`,
  ).run(now, now);

  // 第二個課題：用於模擬「先問文藝復興、再問凡爾賽條約」的課題切換
  db.prepare(
    `INSERT INTO topics (id, title, description, published, sort_order, created_at, updated_at)
     VALUES ('topic-5', '課題5：近代歐洲的興起', '', 1, 5, ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO sections (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
     VALUES ('topic-5-renaissance', 'topic-5', NULL, '文藝復興', '', '["文藝復興","科學革命"]', 1, ?, ?)`,
  ).run(now, now);

  function seedDocument(input: {
    id: string;
    fileName: string;
    kind: string;
    studentDistribution: number;
    rightsConfirmedAt: string | null;
    topicId?: string;
    sectionId?: string | null;
    blocks: { text: string; type?: string }[];
  }): void {
    db.prepare(
      `INSERT INTO material_documents
         (id, file_name, kind, status, created_at, student_distribution, rights_confirmed_at)
       VALUES (?, ?, ?, 'ready', ?, ?, ?)`,
    ).run(input.id, input.fileName, input.kind, now, input.studentDistribution, input.rightsConfirmedAt);
    input.blocks.forEach((block, index) => {
      db.prepare(
        `INSERT INTO material_blocks
           (id, document_id, topic_id, section_id, sort_order, type, text, source_location, created_at, extraction_method)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'native')`,
      ).run(
        `${input.id}-b${index}`,
        input.id,
        input.topicId ?? "topic-9",
        input.sectionId === undefined ? "topic-9-interwar" : input.sectionId,
        index,
        block.type ?? "paragraph",
        block.text,
        `${input.fileName} · 第 ${index + 1} 段（段落）`,
        now,
      );
    });
  }

  seedDocument({
    id: "doc-notes",
    fileName: "課題9 兩次世界大戰_筆記.docx",
    kind: "demo",
    studentDistribution: 1,
    rightsConfirmedAt: now,
    blocks: [
      { text: "凡爾賽條約的內容" },
      {
        text: "《凡爾賽條約》規定德國須限制軍隊數目、放棄海外殖民地及支付巨額賠款，並承認發動戰爭的責任。",
      },
      // 教師專用（參考答案）——不得進入 sources
      { text: "參考答案：《凡爾賽條約》規定德國須支付巨額賠款，並限制軍隊數目。" },
      // 練習題目／評分參考——不得進入 sources
      { text: "《凡爾賽條約》規定德國須支付巨額賠款（3分）。" },
      // 圖片佔位——不得進入 sources
      { text: "凡爾賽條約的插圖", type: "image" },
    ],
  });

  // 校內試題檔——永不使用
  seedDocument({
    id: "doc-paper",
    fileName: "課題9 兩次世界大戰_填充題.docx",
    kind: "question-bank",
    studentDistribution: 0,
    rightsConfirmedAt: now,
    blocks: [{ text: "《凡爾賽條約》規定德國須支付巨額賠款（校內試題）" }],
  });

  // 未確認版權——即使已標示開放亦不得使用
  seedDocument({
    id: "doc-unconfirmed",
    fileName: "課題9 兩次世界大戰_未確認版權.docx",
    kind: "demo",
    studentDistribution: 1,
    rightsConfirmedAt: null,
    blocks: [{ text: "凡爾賽條約要求德國支付巨額賠款，此段來自未確認版權的文件。" }],
  });

  // 極權主義段落（課程用語進閘及召回測試用）
  seedDocument({
    id: "doc-totalitarian",
    fileName: "課題9 兩次世界大戰_極權筆記.docx",
    kind: "demo",
    studentDistribution: 1,
    rightsConfirmedAt: now,
    blocks: [
      { text: "極權主義的特點" },
      { text: "極權統治者以獨裁方式控制社會，一黨專政，並嚴密監控人民的思想與言論。" },
    ],
  });

  // 第二個課題的教材：用於「先問文藝復興、再問凡爾賽條約」的課題切換測試
  seedDocument({
    id: "doc-renaissance",
    fileName: "課題5 近代歐洲的興起_筆記.docx",
    topicId: "topic-5",
    sectionId: "topic-5-renaissance",
    kind: "demo",
    studentDistribution: 1,
    rightsConfirmedAt: now,
    blocks: [
      { text: "文藝復興時期的藝術" },
      { text: "藝術三傑包括達文西、米開蘭基羅及拉斐爾，他們的繪畫運用透視法及人體結構研究。" },
      { text: "科學革命強調科學方法，學者開始質疑傳統權威，天文學家以觀察驗證理論。" },
    ],
  });
});

beforeEach(() => {
  vi.unstubAllGlobals();
  process.env.DEEPSEEK_API_KEY = "simulation-key";
  process.env.AI_GENERATIONS_PER_LEARNER = "100";
  process.env.AI_GENERATIONS_GLOBAL = "100";
  const db = getDb();
  db.prepare("DELETE FROM tutor_messages").run();
  db.prepare("DELETE FROM tutor_sessions").run();
  db.prepare("DELETE FROM ai_operations").run();
});

describe("A. 權限與身份", () => {
  it("未登入 GET／POST 一律 401，且不回傳配額或訊息", async () => {
    const getResponse = await getChat(request("GET"));
    expect(getResponse.status).toBe(401);
    const getBody = (await getResponse.json()) as Record<string, unknown>;
    expect(getBody.error).toContain("登入");
    expect(getBody).not.toHaveProperty("remaining");
    expect(getBody).not.toHaveProperty("messages");

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const postResponse = await postChat(request("POST", { body: { message: "一戰的起因是甚麼？" } }));
    expect(postResponse.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("學生不可讀取或延續他人的對話（404，且不呼叫 LLM）", async () => {
    const foreign = createTutorSession(OTHER_STUDENT, hongKongTimestamp());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const getResponse = await getChat(
      request("GET", { learnerId: STUDENT, query: `?sessionId=${encodeURIComponent(foreign)}` }),
    );
    expect(getResponse.status).toBe(404);

    const postResponse = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "一戰的起因是甚麼？", sessionId: foreign } }),
    );
    expect(postResponse.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("名冊未核對的學生 403，且不呼叫 LLM", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postChat(
      request("POST", {
        learnerId: STUDENT,
        rosterVerified: false,
        body: { message: "一戰的起因是甚麼？" },
      }),
    );
    expect(response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("教師及管理員可作科組測試，記錄在自己帳戶之下", async () => {
    for (const [learnerId, role] of [
      [TEACHER, "teacher"],
      [ADMIN, "admin"],
    ] as const) {
      const fetchMock = vi.fn<typeof fetch>(async () => mockStreamingAnswer("你認為條約如何影響德國？"));
      vi.stubGlobal("fetch", fetchMock);

      const response = await postChat(
        request("POST", { learnerId, role, body: { message: "凡爾賽條約如何約束德國？" } }),
      );
      expect(response.status).toBe(200);
      await response.text();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const sessionId = response.headers.get("x-tutor-session-id") ?? "";
      expect(getTutorSessionLearnerId(sessionId)).toBe(learnerId);
      expect(tutorDailyUsage(learnerId).used).toBe(1);
      expect(tutorDailyUsage(STUDENT).used).toBe(0);
    }
  });
});

describe("B. 硬閘、輸入驗證與短跟進", () => {
  it("離題：回固定引導句、不呼叫 LLM、不扣每日額度，但保留紀錄（決策 2）", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const message of ["今天天氣如何", "幫我寫 Python"]) {
      const response = await postChat(request("POST", { learnerId: STUDENT, body: { message } }));
      expect(response.status).toBe(200);
      expect((await response.json()).onTopic).toBe(false);
    }
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(tutorDailyUsage(STUDENT).used).toBe(0);
    // 離題會保留 user 提問及固定引導句，讓學生重新載入後仍看到自己問過甚麼；
    // assistant 訊息標記為 off-topic，因此不計入每日額度，也不會被當成模型上文。
    const rows = getDb()
      .prepare(
        `SELECT messages.role AS role, messages.groundingStatus AS groundingStatus
         FROM tutor_messages AS messages
         INNER JOIN tutor_sessions AS sessions ON sessions.id = messages.sessionId
         WHERE sessions.learnerId = ?
         ORDER BY messages.rowid`,
      )
      .all(STUDENT) as { role: string; groundingStatus: string }[];
    expect(rows.filter((row) => row.role === "user")).toHaveLength(2);
    expect(rows.filter((row) => row.groundingStatus === "off-topic")).toHaveLength(2);

    const status = await getChat(request("GET", { learnerId: STUDENT }));
    expect(await status.json()).toMatchObject({ used: 0, remaining: TUTOR_DAILY_LIMIT });
  });

  it("離題輪次可重新載入，但不會被當成下一輪的模型上文", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => mockStreamingAnswer("你先想想條約的目的。"));
    vi.stubGlobal("fetch", fetchMock);

    const first = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "凡爾賽條約如何約束德國？" } }),
    );
    const sessionId = first.headers.get("x-tutor-session-id") ?? "";
    await first.text();

    const offTopic = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "今日有咩好食", sessionId } }),
    );
    expect((await offTopic.json()).onTopic).toBe(false);

    const third = await postChat(
      request("POST", {
        learnerId: STUDENT,
        body: { message: "凡爾賽條約對德國的軍事限制是甚麼？", sessionId },
      }),
    );
    await third.text();

    const reload = await getChat(
      request("GET", { learnerId: STUDENT, query: `?sessionId=${sessionId}` }),
    );
    const payload = (await reload.json()) as { messages: { role: string; content: string }[] };
    expect(payload.messages.map((message) => message.content)).toContain("今日有咩好食");
    // 兩則正式回覆 + 一則離題固定引導句
    expect(payload.messages.filter((message) => message.role === "assistant")).toHaveLength(3);
    expect(
      payload.messages.some((message) => message.content.includes("只能討論歷史科")),
    ).toBe(true);

    // 第二次呼叫 LLM 時的上文不可包含離題輪次
    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      messages: { role: string; content: string }[];
    };
    expect(body.messages.some((message) => message.content.includes("今日有咩好食"))).toBe(false);
    expect(body.messages.some((message) => message.content.includes("只能討論歷史科"))).toBe(false);
    expect(tutorDailyUsage(STUDENT).used).toBe(2);
  });

  it("超過 2,000 字或空白訊息回 400，不會 500", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const tooLong = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "凡".repeat(2001) } }),
    );
    expect(tooLong.status).toBe(400);
    const tooLongBody = (await tooLong.json()) as { details?: string[] };
    expect((tooLongBody.details ?? []).join(" ")).toContain("2,000");

    const blank = await postChat(request("POST", { learnerId: STUDENT, body: { message: "    " } }));
    expect(blank.status).toBe(400);

    const notJson = await postChat(
      request("POST", { learnerId: STUDENT, rawBody: "this is not json" }),
    );
    expect(notJson.status).toBe(400);

    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(tutorDailyUsage(STUDENT).used).toBe(0);
  });

  it("只有年份也是歷史提問（放行），全新對話的短跟進仍被擋", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => mockStreamingAnswer("你先想想當時的國際局勢。"));
    vi.stubGlobal("fetch", fetchMock);

    const dated = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "1914年發生甚麼事？" } }),
    );
    expect(dated.status).toBe(200);
    await dated.text();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const followUp = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "邊一年？" } }),
    );
    expect((await followUp.json()).onTopic).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("上一輪為離題後，短跟進不可「洗」進 LLM", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => mockStreamingAnswer("你先想想。"));
    vi.stubGlobal("fetch", fetchMock);

    const first = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "一戰的起因是甚麼？" } }),
    );
    const sessionId = first.headers.get("x-tutor-session-id") ?? "";
    await first.text();

    const offTopic = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "今天天氣如何？", sessionId } }),
    );
    expect((await offTopic.json()).onTopic).toBe(false);

    const followUp = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "點解？", sessionId } }),
    );
    expect((await followUp.json()).onTopic).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 離題句仍然保留在紀錄（決策 2），只是標記為 off-topic
    expect(getTutorMessages(sessionId).some((message) => message.content.includes("天氣"))).toBe(
      true,
    );
  });
});

describe("C. 教材依據（grounding）", () => {
  async function groundOnce(message = "凡爾賽條約如何約束德國？") {
    const fetchMock = vi.fn<typeof fetch>(async () => mockStreamingAnswer("你認為條約如何影響德國？"));
    vi.stubGlobal("fetch", fetchMock);
    const response = await postChat(request("POST", { learnerId: STUDENT, body: { message } }));
    const events = sseEvents(await response.text());
    const meta = events.find((entry) => entry.event === "meta")?.data as {
      grounding: string;
      sources: { blockId: string; documentLabel: string; location: string; excerpt: string }[];
    };
    return { meta, fetchMock, response };
  }

  it("只引用學生可見教材：試題檔、未確認版權、教師專用、練習題、圖片全部排除", async () => {
    const { meta } = await groundOnce();
    expect(meta.grounding).toBe("grounded");
    expect(meta.sources.length).toBeGreaterThan(0);

    const combined = meta.sources.map((source) => `${source.documentLabel}|${source.excerpt}`).join("\n");
    expect(combined).not.toContain("校內試題");
    expect(combined).not.toContain("未確認版權");
    expect(combined).not.toContain("參考答案");
    expect(combined).not.toContain("分）");
    expect(combined).not.toContain("插圖");
    expect(meta.sources.every((source) => source.documentLabel.includes("筆記"))).toBe(true);
  });

  it("每個出處欄位齊全（不出現空白項目），節錄不超過上限", async () => {
    const { meta } = await groundOnce();
    for (const source of meta.sources) {
      expect(source.blockId.length).toBeGreaterThan(0);
      expect(source.documentLabel.trim().length).toBeGreaterThan(0);
      expect(source.location.trim().length).toBeGreaterThan(0);
      expect(source.excerpt.trim().length).toBeGreaterThan(0);
      expect(source.excerpt.length).toBeLessThanOrEqual(TUTOR_STUDENT_EXCERPT_MAX_CHARS);
    }
  });

  it("找不到教材時標示 not-covered，且提示詞要求「片段中找不到」而非「課本沒有提及」", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => mockStreamingAnswer("我在教材中找不到這部分。"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "伊斯蘭曆法的計算方法是甚麼？" } }),
    );
    const streamText = await response.text();
    const meta = sseEvents(streamText).find((entry) => entry.event === "meta")?.data as {
      grounding: string;
      sources: unknown[];
    };
    expect(meta.grounding).toBe("not-covered");
    expect(meta.sources).toHaveLength(0);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      messages: { role: string; content: string }[];
    };
    const systemPrompt = body.messages[0]?.content ?? "";
    expect(systemPrompt).toContain("我在教材中找不到這部分的內容");
    expect(systemPrompt).toContain("不可斷言課本「沒有提及」");
  });
});

describe("D. 對話狀態與失敗", () => {
  it("沒有回覆的提問不會進入下一輪 LLM context", async () => {
    const sessionId = createTutorSession(STUDENT, hongKongTimestamp());
    saveTutorMessage(sessionId, "user", "凡爾賽條約如何約束德國？", hongKongTimestamp());

    const fetchMock = vi.fn<typeof fetch>(async () => mockStreamingAnswer("你先想想。"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      request("POST", {
        learnerId: STUDENT,
        body: { message: "一戰的起因是甚麼？", sessionId },
      }),
    );
    await response.text();

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      messages: { role: string; content: string }[];
    };
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1]?.content).toBe("一戰的起因是甚麼？");
  });

  it("重新載入可還原 sources／groundingStatus／termNotes", async () => {
    const sessionId = createTutorSession(STUDENT, hongKongTimestamp());
    saveTutorMessage(sessionId, "user", "凡爾賽條約如何約束德國？", hongKongTimestamp());
    saveTutorMessage(sessionId, "assistant", "課本提到條約苛刻。", hongKongTimestamp(), 0, {
      sources: [
        { blockId: "b1", documentLabel: "課題9 筆記", location: "第1段", excerpt: "節錄" },
      ],
      groundingStatus: "grounded",
      termNotes: [{ canonical: "希特拉", used: "希特勒" }],
    });

    const response = await getChat(
      request("GET", { learnerId: STUDENT, query: `?sessionId=${encodeURIComponent(sessionId)}` }),
    );
    const payload = (await response.json()) as {
      messages: { role: string; sources: unknown[]; groundingStatus: string; termNotes: unknown[] }[];
    };
    const assistant = payload.messages.find((message) => message.role === "assistant");
    expect(assistant?.groundingStatus).toBe("grounded");
    expect(assistant?.sources).toHaveLength(1);
    expect(assistant?.termNotes).toHaveLength(1);
  });
});

describe("E. 配額", () => {
  it("第 16 次回 429，且 GET 的 remaining 為 0（header 與 GET 一致）", async () => {
    const sessionId = createTutorSession(STUDENT, hongKongTimestamp());
    for (let index = 0; index < TUTOR_DAILY_LIMIT; index += 1) {
      // 每日額度只計「成功學伴回覆」：種資料時必須同時有 assistant 回覆
      saveTutorMessage(sessionId, "user", `一戰原因 ${index}`, hongKongTimestamp());
      saveTutorMessage(sessionId, "assistant", "你先想想當時的國際局勢。", hongKongTimestamp(), 0, {
        groundingStatus: "grounded",
      });
    }
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "二戰的起因是甚麼？", sessionId } }),
    );
    expect(response.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(0);

    // 額度用盡時不應再建立新對話或寫入訊息
    const before = getDb()
      .prepare("SELECT COUNT(*) AS total FROM tutor_sessions WHERE learnerId = ?")
      .get(STUDENT) as { total: number };
    const blocked = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "二戰的經過是甚麼？" } }),
    );
    expect(blocked.status).toBe(429);
    const after = getDb()
      .prepare("SELECT COUNT(*) AS total FROM tutor_sessions WHERE learnerId = ?")
      .get(STUDENT) as { total: number };
    expect(after.total).toBe(before.total);

    const status = await getChat(request("GET", { learnerId: STUDENT }));
    expect(await status.json()).toMatchObject({ used: TUTOR_DAILY_LIMIT, remaining: 0 });
  });

  it("只種「沒有回覆的提問」不會佔用每日額度（決策 1）", async () => {
    const sessionId = createTutorSession(STUDENT, hongKongTimestamp());
    for (let index = 0; index < TUTOR_DAILY_LIMIT + 5; index += 1) {
      saveTutorMessage(sessionId, "user", `一戰原因 ${index}`, hongKongTimestamp());
    }
    expect(tutorDailyUsage(STUDENT).used).toBe(0);

    const fetchMock = vi.fn<typeof fetch>(async () => mockStreamingAnswer("你先想想。"));
    vi.stubGlobal("fetch", fetchMock);
    const response = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "二戰的起因是甚麼？", sessionId } }),
    );
    expect(response.status).toBe(200);
    await response.text();
    expect(tutorDailyUsage(STUDENT).used).toBe(1);
  });

  it("學伴用量計入與 AI 出題共用的 generation 窗（不可自建用量繞過）", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => mockStreamingAnswer("你先想想。"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "凡爾賽條約如何約束德國？" } }),
    );
    await response.text();

    expect(describeAiLimit(STUDENT, "generation").learnerUsed).toBe(1);
    // 評分等其他類型的用量不受學伴提問影響
    expect(describeAiLimit(STUDENT, "grading").learnerUsed).toBe(0);
  });

  it("成功提問後 header 為「本次之前的剩餘」、done／GET 為最新剩餘（決策 1 契約）", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => mockStreamingAnswer("你先想想。"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "凡爾賽條約如何約束德國？" } }),
    );
    await response.text();
    // header 在回覆完成前送出，因此只可以是「提問前」的剩餘；權威數字在 done 與 GET
    expect(response.headers.get("x-tutor-remaining")).toBe(String(TUTOR_DAILY_LIMIT));

    const status = await getChat(request("GET", { learnerId: STUDENT }));
    expect(await status.json()).toMatchObject({ used: 1, remaining: TUTOR_DAILY_LIMIT - 1 });
  });

  it("長對話只回最近 80 則，並標示 truncated（決策 5）", async () => {
    const sessionId = createTutorSession(STUDENT, hongKongTimestamp());
    for (let index = 0; index < 45; index += 1) {
      saveTutorMessage(sessionId, "user", `一戰原因 ${index}`, hongKongTimestamp());
      saveTutorMessage(sessionId, "assistant", `引導問題 ${index}`, hongKongTimestamp(), 0, {
        groundingStatus: "grounded",
      });
    }

    const response = await getChat(
      request("GET", { learnerId: STUDENT, query: `?sessionId=${sessionId}` }),
    );
    const payload = (await response.json()) as {
      messages: { content: string }[];
      truncated?: boolean;
      messageCount?: number;
      messageLimit?: number;
    };
    expect(payload.messages).toHaveLength(80);
    expect(payload.messageCount).toBe(90);
    expect(payload.messageLimit).toBe(80);
    expect(payload.truncated).toBe(true);
    expect(payload.messages.at(-1)?.content).toBe("引導問題 44");
  });
});

describe("F. 模型參數、錯誤處理與提示詞約束", () => {
  it("請求參數：stream、限制 temp（非思考模式）、thinking 停用、max_tokens", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => mockStreamingAnswer("你先想想。"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "凡爾賽條約如何約束德國？" } }),
    );
    await response.text();

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      stream: boolean;
      temperature: number;
      thinking: { type: string };
      max_tokens: number;
    };
    expect(body.stream).toBe(true);
    expect(body.temperature).toBe(0.4);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.max_tokens).toBeGreaterThan(0);
  });

  it("提示詞含關鍵約束：繁體不夾雜簡體、港譯、不代做功課、不背誦全文", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => mockStreamingAnswer("你先想想。"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "凡爾賽條約如何約束德國？" } }),
    );
    await response.text();

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      messages: { role: string; content: string }[];
    };
    const systemPrompt = body.messages[0]?.content ?? "";
    expect(systemPrompt).toContain("繁體");
    expect(systemPrompt).toContain("不可夾雜簡體字");
    expect(systemPrompt).toContain("希特拉");
    expect(systemPrompt).toContain("不直接代做功課");
    expect(systemPrompt).toContain("不重現任何課本原文");
    // 平台「不提供」題庫／標準答案：提示詞是以禁止語氣出現，而不是把內容注入
    expect(systemPrompt).toContain("平台沒有提供題庫、標準答案或評分參考");
    expect(systemPrompt).not.toMatch(/標準答案[:：]/);
  });

  it("未設定 API key 時回 503（明確錯誤碼），不扣每日額、不建立對話", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "凡爾賽條約如何約束德國？" } }),
    );
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: string }).error).toContain(
      "TUTOR_LLM_NOT_CONFIGURED",
    );
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(tutorDailyUsage(STUDENT).used).toBe(0);
    const sessions = getDb()
      .prepare("SELECT COUNT(*) AS total FROM tutor_sessions WHERE learnerId = ?")
      .get(STUDENT) as { total: number };
    expect(sessions.total).toBe(0);
  });

  it("上游 5xx 回 503（明確錯誤碼），不保存 assistant 訊息、不扣每日額度", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));

    const response = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "凡爾賽條約如何約束德國？" } }),
    );
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: string }).error).toContain(
      "TUTOR_LLM_UPSTREAM_ERROR",
    );
    // 決策 1：失敗不計入每日 15 次（generation 時間窗仍然照樣保留用量）
    expect(tutorDailyUsage(STUDENT).used).toBe(0);
    expect(describeAiLimit(STUDENT, "generation").learnerUsed).toBe(1);
  });

  it("上游只回 reasoning_content 時視為空白，重試後才報錯（不會顯示思考內容）", async () => {
    const reasoningOnly = () =>
      new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "思考中" } }] })}\n\ndata: [DONE]\n\n`,
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    const fetchMock = vi.fn<typeof fetch>(async () => reasoningOnly());
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "凡爾賽條約如何約束德國？" } }),
    );
    const streamText = await response.text();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(streamText).toContain("TUTOR_LLM_EMPTY_RESPONSE");
    expect(streamText).not.toContain("思考中");
    // 決策 1：空白回覆不算成功回覆，不扣每日額度
    expect(tutorDailyUsage(STUDENT).used).toBe(0);
  });

  it("上游位元組在 JSON 中間被切開時，仍能完整組合答案（不誤報 STREAM_ERROR）", async () => {
    const payload = `data: ${JSON.stringify({
      choices: [{ delta: { content: "凡爾賽條約限制德國軍備。" } }],
    })}\n\ndata: [DONE]\n\n`;
    const bytes = new TextEncoder().encode(payload);
    const cut = 24;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(bytes.slice(0, cut));
                controller.enqueue(bytes.slice(cut));
                controller.close();
              },
            }),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          ),
      ),
    );

    const response = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "凡爾賽條約如何約束德國？" } }),
    );
    const streamText = await response.text();
    expect(streamText).not.toContain("TUTOR_LLM_STREAM_ERROR");
    expect(streamText).not.toContain("TUTOR_LLM_EMPTY_RESPONSE");
    const answer = sseEvents(streamText)
      .filter((entry) => entry.event === "delta")
      .map((entry) => (entry.data as { text: string }).text)
      .join("");
    expect(answer).toBe("凡爾賽條約限制德國軍備。");
  });

  it("串流格式錯誤回 STREAM_ERROR，不保存 assistant 訊息", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("data: {not-json}\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })),
    );

    const response = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "凡爾賽條約如何約束德國？" } }),
    );
    const streamText = await response.text();
    expect(streamText).toContain("TUTOR_LLM_STREAM_ERROR");

    const sessionId = response.headers.get("x-tutor-session-id") ?? "";
    expect(getTutorMessages(sessionId).filter((message) => message.role === "assistant")).toHaveLength(0);
    expect(tutorDailyUsage(STUDENT).used).toBe(0);
  });
});

describe("G. 串流協定（前端契約）", () => {
  it("事件順序為 meta → delta… → done，且 done 的 sources 與 meta 一致", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => mockStreamingAnswer("條約限制軍備。你再想想賠款。")),
    );

    const response = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "凡爾賽條約如何約束德國？" } }),
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = sseEvents(await response.text());

    expect(events[0]?.event).toBe("meta");
    expect(events.at(-1)?.event).toBe("done");
    expect(events.filter((entry) => entry.event === "delta").length).toBeGreaterThan(0);
    expect(events.findIndex((entry) => entry.event === "done")).toBe(events.length - 1);

    const meta = events[0]?.data as {
      grounding: string;
      sources: { blockId: string }[];
    };
    const done = events.at(-1)?.data as {
      grounding: string;
      sources: { blockId: string }[];
      remaining: number;
      termNotes: unknown[];
    };
    expect(done.grounding).toBe(meta.grounding);
    expect(done.sources.map((source) => source.blockId)).toEqual(
      meta.sources.map((source) => source.blockId),
    );
    expect(done.remaining).toBe(TUTOR_DAILY_LIMIT - 1);
    expect(Array.isArray(done.termNotes)).toBe(true);
    // header 是「提問前」的剩餘（回覆完成前已送出），done 才是權威數字
    expect(response.headers.get("x-tutor-remaining")).toBe(String(TUTOR_DAILY_LIMIT));
  });

  it("長開場白後才說找不到教材時，done 仍降為 not-covered（決策 4）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        mockStreamingAnswer(
          "先回應你的問題：凡爾賽條約的具體內容，我在教材片段中找不到。以下屬一般背景補充。",
        ),
      ),
    );

    const response = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "凡爾賽條約如何約束德國？" } }),
    );
    const events = sseEvents(await response.text());
    const done = events.at(-1)?.data as { grounding: string; sources: unknown[] };
    expect(events.at(-1)?.event).toBe("done");
    expect(done.grounding).toBe("not-covered");
    expect(done.sources).toEqual([]);
  });

  it("模型自認找不到教材時，done 會降為 not-covered 並清空 sources（與答案一致）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        mockStreamingAnswer("我在教材片段中找不到這部分，以下屬一般背景補充。"),
      ),
    );

    const response = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "凡爾賽條約如何約束德國？" } }),
    );
    const events = sseEvents(await response.text());
    const meta = events[0]?.data as { grounding: string; sources: { blockId: string }[] };
    const done = events.at(-1)?.data as {
      grounding: string;
      sources: { blockId: string }[];
      topicTitle: string | null;
    };

    // 檢索本身仍找到片段，但回覆否認有依據 → 介面需以回覆為準
    expect(meta.grounding).toBe("grounded");
    expect(done.grounding).toBe("not-covered");
    expect(done.sources).toEqual([]);
    expect(done.topicTitle).toBeNull();
  });
});

describe("H. 學生真實提問模擬（mock 教材 + mock LLM）", () => {
  it("離題兩連發：不呼叫模型、不扣額、兩輪都留在紀錄", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const message of ["幫我寫英文 essay", "今日有咩好食"]) {
      const response = await postChat(request("POST", { learnerId: STUDENT, body: { message } }));
      const payload = (await response.json()) as {
        onTopic: boolean;
        reply: string;
        sessionId: string | null;
      };
      expect(payload.onTopic).toBe(false);
      expect(payload.reply).toContain("只能討論歷史科");
      expect(payload.sessionId).toBeTruthy();
    }
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(tutorDailyUsage(STUDENT).used).toBe(0);
  });

  it("以離題開始新對話時會回傳 sessionId，令該輪紀錄可重新載入（決策 2）", async () => {
    vi.stubGlobal("fetch", vi.fn());

    const response = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "今日有咩好食" } }),
    );
    const payload = (await response.json()) as { onTopic: boolean; sessionId: string | null };
    expect(payload.onTopic).toBe(false);
    expect(payload.sessionId).toBeTruthy();

    // 前端必須沿用這個 sessionId，否則下一次提問會另開新對話，該輪離題紀錄就看不到
    const reload = await getChat(
      request("GET", { learnerId: STUDENT, query: `?sessionId=${payload.sessionId}` }),
    );
    const body = (await reload.json()) as {
      messages: { role: string; content: string; groundingStatus?: string }[];
    };
    expect(body.messages.map((message) => message.content)).toEqual([
      "今日有咩好食",
      TUTOR_OFF_TOPIC_REPLY,
    ]);
    expect(body.messages[1]?.groundingStatus).toBe("off-topic");
  });

  it("無上文的短跟進被擋；有歷史上文則放行並沿用上文課題檢索", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => mockStreamingAnswer("可以先想條約的目的。"));
    vi.stubGlobal("fetch", fetchMock);

    const alone = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "點解？" } }),
    );
    expect(((await alone.json()) as { onTopic: boolean }).onTopic).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(0);

    const first = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "凡爾賽條約如何約束德國？" } }),
    );
    const sessionId = first.headers.get("x-tutor-session-id") ?? "";
    await first.text();

    const followUp = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "點解？", sessionId } }),
    );
    expect(followUp.status).toBe(200);
    await followUp.text();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const prompt =
      (
        JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
          messages: { role: string; content: string }[];
        }
      ).messages[0]?.content ?? "";
    expect(prompt).toContain("凡爾賽條約");
  });

  it("課題切換：先問藝術三傑，再問凡爾賽條約條款，出處只可來自當前課題", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => mockStreamingAnswer("你先想想條約的目標。"));
    vi.stubGlobal("fetch", fetchMock);

    const first = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "列出文藝復興時期著名的藝術家" } }),
    );
    const sessionId = first.headers.get("x-tutor-session-id") ?? "";
    const firstMeta = sseEvents(await first.text())[0]?.data as {
      grounding: string;
      topicTitle: string | null;
    };
    expect(firstMeta.grounding).toBe("grounded");
    expect(firstMeta.topicTitle ?? "").toContain("近代歐洲");

    const second = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "凡爾賽條約有何條款？", sessionId } }),
    );
    const secondMeta = sseEvents(await second.text())[0]?.data as {
      grounding: string;
      topicTitle: string | null;
      sources: { documentLabel: string }[];
    };
    expect(secondMeta.grounding).toBe("grounded");
    expect(secondMeta.topicTitle ?? "").toContain("兩次世界大戰");
    expect(secondMeta.sources.length).toBeGreaterThan(0);
    // 不可沿用上一輪（文藝復興）的教材
    expect(secondMeta.sources.every((source) => !source.documentLabel.includes("近代歐洲"))).toBe(
      true,
    );
  });

  it("課程用語：極權主義通過硬閘並召回教材段落", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => mockStreamingAnswer("你認為極權統治有甚麼特徵？")),
    );

    const response = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "乜嘢係極權主義？" } }),
    );
    const meta = sseEvents(await response.text())[0]?.data as {
      grounding: string;
      sources: { excerpt: string }[];
    };
    expect(meta.grounding).toBe("grounded");
    expect(meta.sources.map((source) => source.excerpt).join("")).toContain("獨裁");
  });

  it("列舉科學革命的發明家或學者 → 靠類別詞展開召回", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => mockStreamingAnswer("教材提到學者與天文學家。")),
    );

    const response = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "列出科學革命有關的發明家或學者" } }),
    );
    const meta = sseEvents(await response.text())[0]?.data as {
      grounding: string;
      sources: { excerpt: string }[];
    };
    expect(meta.grounding).toBe("grounded");
    expect(meta.sources.map((source) => source.excerpt).join("")).toContain("質疑傳統權威");
  });

  it("譯名：模型用「希特勒」時顯示課本用語對照", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => mockStreamingAnswer("希特勒於1933年出任德國總理。"),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "希特拉點樣上台？" } }),
    );
    const events = sseEvents(await response.text());
    const done = events.at(-1)?.data as { termNotes: { canonical: string; used: string }[] };
    expect(done.termNotes).toEqual([{ canonical: "希特拉", used: "希特勒" }]);

    const systemPrompt =
      (
        JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
          messages: { role: string; content: string }[];
        }
      ).messages[0]?.content ?? "";
    expect(systemPrompt).toContain("希特拉");
    expect(systemPrompt).toContain("不可夾雜簡體字");
  });

  it("索取可抄的完整答案：提示詞要求鷹架、不代做功課", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => mockStreamingAnswer("先想一想條約的三個方向。"),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "凡爾賽條約內容列點俾我抄" } }),
    );
    await response.text();

    const systemPrompt =
      (
        JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
          messages: { role: string; content: string }[];
        }
      ).messages[0]?.content ?? "";
    expect(systemPrompt).toContain("不直接代做功課");
    expect(systemPrompt).toContain("提供一個相關歷史線索");
    expect(systemPrompt).not.toMatch(/標準答案[:：]/);
  });

  it("失敗後再成功：只有成功的提問計額，失敗提問不會被一併回答", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response("{}", { status: 500 })));
    const failed = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "凡爾賽條約如何約束德國？" } }),
    );
    expect(failed.status).toBe(503);
    expect(tutorDailyUsage(STUDENT).used).toBe(0);

    const latest = getDb()
      .prepare("SELECT id FROM tutor_sessions WHERE learnerId = ? ORDER BY rowid DESC LIMIT 1")
      .get(STUDENT) as { id: string };

    const fetchMock = vi.fn<typeof fetch>(async () => mockStreamingAnswer("你先想想條約的目的。"));
    vi.stubGlobal("fetch", fetchMock);
    const second = await postChat(
      request("POST", {
        learnerId: STUDENT,
        body: { message: "文藝復興如何導致宗教改革？", sessionId: latest.id },
      }),
    );
    await second.text();

    expect(tutorDailyUsage(STUDENT).used).toBe(1);
    const sent = (
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
        messages: { role: string; content: string }[];
      }
    ).messages;
    expect(sent.some((message) => message.content.includes("凡爾賽條約如何約束德國"))).toBe(false);
  });

  it("日額邊界：夾雜離題與失敗後，成功 15 次即滿，第 16 次 429", async () => {
    vi.stubGlobal("fetch", vi.fn());
    for (const message of ["幫我寫英文 essay", "今日有咩好食", "幫我寫 Python"]) {
      const response = await postChat(request("POST", { learnerId: STUDENT, body: { message } }));
      expect(((await response.json()) as { onTopic: boolean }).onTopic).toBe(false);
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    for (let index = 0; index < 2; index += 1) {
      const failed = await postChat(
        request("POST", { learnerId: STUDENT, body: { message: "凡爾賽條約如何約束德國？" } }),
      );
      expect(failed.status).toBe(503);
    }
    expect(tutorDailyUsage(STUDENT).used).toBe(0);

    const fetchMock = vi.fn<typeof fetch>(async () => mockStreamingAnswer("你先想想。"));
    vi.stubGlobal("fetch", fetchMock);
    let sessionId: string | undefined;
    for (let index = 0; index < TUTOR_DAILY_LIMIT; index += 1) {
      const response = await postChat(
        request("POST", {
          learnerId: STUDENT,
          body: { message: `凡爾賽條約有甚麼條款（${index}）？`, sessionId },
        }),
      );
      expect(response.status).toBe(200);
      if (index === 0) sessionId = response.headers.get("x-tutor-session-id") ?? undefined;
      await response.text();
    }
    expect(tutorDailyUsage(STUDENT).used).toBe(TUTOR_DAILY_LIMIT);

    const blocked = await postChat(
      request("POST", { learnerId: STUDENT, body: { message: "凡爾賽條約有甚麼條款（16）？" } }),
    );
    expect(blocked.status).toBe(429);
  });
});
