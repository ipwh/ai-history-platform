import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE, encodeSession } from "@/server/auth/session";
import { ensureLearner } from "@/server/repositories/learners";
import { upsertTopic } from "@/server/repositories/topics";
import { listTutorQueryEvents } from "@/server/repositories/tutor-events";
import { tutorDailyUsage } from "@/server/services/tutor";
import { freshTestDatabasePath } from "./test-database";

/**
 * 澄清／離題／正規化事件的「數據閉環」及教師端聚合統計測試。
 *
 * 兩個不可退讓的性質：
 *   1. 事件表**不含學生身分**，亦不含任何題目／答案；
 *   2. 教師統計 API **不含對話正文**，學生呼叫一律 403。
 */
process.env.APP_DATABASE_PATH = freshTestDatabasePath("tutor-query-events");
process.env.AUTH_SECRET = "tutor-query-events-secret-0123456789";
process.env.AUTH_REQUIRE_SIGN_IN = "true";
// 必須啟用登入，否則 requireTeacher 會走「未啟用登入」的示範分支（回 200）。
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_TEACHER_EMAILS = "teacher@example.com";
process.env.AUTH_STAFF_ACCESS_POLICY = "allowlist";
delete process.env.AUTH_STAFF_DOMAINS;
process.env.LLM_PROVIDER = "deepseek";
process.env.DEEPSEEK_API_KEY = "test-only-key";
process.env.AI_LIMITS_ENABLED = "true";
process.env.AI_LIMIT_WINDOW_MINUTES = "60";
process.env.AI_GENERATIONS_PER_LEARNER = "100";
process.env.AI_GENERATIONS_GLOBAL = "100";
process.env.BACKUP_ENABLED = "false";
delete process.env.TUTOR_WEB_SUPPLEMENT_ENABLED;
delete process.env.TUTOR_WEB_SEARCH_ENDPOINT;

const STUDENT = "school:s2024801@pochiu.edu.hk";
const TEACHER = "teacher:teacher@example.com";

let chatRoute: typeof import("@/app/api/tutor/chat/route");
let statsRoute: typeof import("@/app/api/teacher/tutor-stats/route");
let getDb: typeof import("@/server/db/connection").getDb;

function cookieFor(learnerId: string, role: "student" | "teacher"): string {
  const email = learnerId.slice(learnerId.indexOf(":") + 1);
  return `${SESSION_COOKIE}=${encodeURIComponent(
    encodeSession({
      email,
      name: role === "student" ? "測試學生" : "測試教師",
      role,
      learnerId,
      rosterVerified: role === "student",
      className: role === "student" ? "1A" : null,
      studentNumber: role === "student" ? email.split("@")[0] : null,
    }),
  )}`;
}

function request(learnerId: string, role: "student" | "teacher", body?: unknown): Request {
  return new Request("http://localhost/api/tutor/chat", {
    method: body === undefined ? "GET" : "POST",
    headers: {
      cookie: cookieFor(learnerId, role),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function statsRequest(learnerId: string, role: "student" | "teacher", days?: number): Request {
  return new Request(
    `http://localhost/api/teacher/tutor-stats${days === undefined ? "" : `?days=${days}`}`,
    { headers: { cookie: cookieFor(learnerId, role) } },
  );
}

function streamingAnswer(answer = "你可以先想：這條條約限制了德國哪一方面？"): Response {
  const events = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
  return new Response(events, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function eventRows(): { eventType: string; rawPreview: string; normalizedPreview: string | null }[] {
  return getDb()
    .prepare("SELECT eventType, rawPreview, normalizedPreview FROM tutor_query_events")
    .all() as unknown as { eventType: string; rawPreview: string; normalizedPreview: string | null }[];
}

beforeAll(async () => {
  chatRoute = await import("@/app/api/tutor/chat/route");
  statsRoute = await import("@/app/api/teacher/tutor-stats/route");
  getDb = (await import("@/server/db/connection")).getDb;

  ensureLearner(STUDENT);
  ensureLearner(TEACHER);
  upsertTopic({ id: "topic-9", title: "課題9：20世紀的國際紛爭及危機(I)–兩次世界大戰", published: true, order: 9 });
});

beforeEach(() => {
  vi.unstubAllGlobals();
  process.env.DEEPSEEK_API_KEY = "test-only-key";
  process.env.AI_GENERATIONS_GLOBAL = "100";
  const db = getDb();
  db.prepare("DELETE FROM tutor_messages").run();
  db.prepare("DELETE FROM tutor_sessions").run();
  db.prepare("DELETE FROM ai_operations").run();
  db.prepare("DELETE FROM tutor_query_events").run();
});

describe("匿名事件記錄", () => {
  it("離題提問寫入 reject 事件，且不扣每日額度、不預留 AI 用量", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await chatRoute.POST(request(STUDENT, "student", { message: "幫我寫 Python" }));
    expect(response.status).toBe(200);
    await response.json();

    expect(eventRows()).toEqual([
      expect.objectContaining({ eventType: "reject", rawPreview: "幫我寫 Python" }),
    ]);
    expect(tutorDailyUsage(STUDENT).used).toBe(0);
    const ops = getDb().prepare("SELECT COUNT(*) AS total FROM ai_operations").get() as { total: number };
    expect(ops.total).toBe(0);
  });

  it("含混提問寫入 clarify 事件，並記錄是否已有對話", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await chatRoute.POST(
      request(STUDENT, "student", { message: "極權主義嗰啲嘢係點？" }),
    );
    expect(response.status).toBe(200);
    await response.json();

    expect(eventRows()).toEqual([
      expect.objectContaining({ eventType: "clarify", rawPreview: "極權主義嗰啲嘢係點？" }),
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("正規化有實際改寫時寫入 normalize 事件，並保留改寫前後預覽", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => streamingAnswer());
    vi.stubGlobal("fetch", fetchMock);

    const response = await chatRoute.POST(
      request(STUDENT, "student", { message: "文藝復興喺邊度開始？" }),
    );
    expect(response.status).toBe(200);
    await response.text();

    const normalizeRows = eventRows().filter((row) => row.eventType === "normalize");
    expect(normalizeRows).toHaveLength(1);
    expect(normalizeRows[0]!.rawPreview).toContain("喺");
    expect(normalizeRows[0]!.normalizedPreview).toContain("在");
  });

  it("正常歷史回答不寫入事件（減少資料量及曝露面）", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => streamingAnswer());
    vi.stubGlobal("fetch", fetchMock);

    const response = await chatRoute.POST(
      request(STUDENT, "student", { message: "凡爾賽條約如何約束德國？" }),
    );
    expect(response.status).toBe(200);
    await response.text();
    expect(eventRows()).toHaveLength(0);
  });

  it("事件表沒有學生身分欄位，預覽亦截斷至 120 字", async () => {
    const columns = getDb()
      .prepare("PRAGMA table_info(tutor_query_events)")
      .all() as unknown as { name: string }[];
    const names = columns.map((column) => column.name);
    expect(names).not.toContain("learnerId");
    expect(names).not.toContain("learner_id");
    expect(names).not.toContain("email");

    const longMessage = `幫我寫程式 ${"很長的離題內容".repeat(40)}`;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await chatRoute.POST(request(STUDENT, "student", { message: longMessage }));
    const rows = eventRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rawPreview.length).toBeLessThanOrEqual(121);
  });

  it("匯出用查詢只回傳事件預覽，不含題目或答案", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await chatRoute.POST(request(STUDENT, "student", { message: "幫我寫 Python" }));

    const events = listTutorQueryEvents({ limit: 10 });
    expect(events.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(events);
    expect(serialised).not.toContain("correctAnswer");
    expect(serialised).not.toContain("explanation");
    expect(Object.keys(events[0]!).sort()).toEqual(
      ["createdAt", "eventType", "hadSession", "id", "normalizedPreview", "rawPreview"].sort(),
    );
  });
});

describe("教師端學伴統計 API", () => {
  it("學生呼叫回 403", async () => {
    const response = await statsRoute.GET(statsRequest(STUDENT, "student"));
    expect(response.status).toBe(403);
  });

  it("教師可讀取，回應只有聚合數字且明確標示不含內容", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => streamingAnswer());
    vi.stubGlobal("fetch", fetchMock);
    await (await chatRoute.POST(request(STUDENT, "student", { message: "凡爾賽條約如何約束德國？" }))).text();
    await (await chatRoute.POST(request(STUDENT, "student", { message: "幫我寫 Python" }))).json();
    await (await chatRoute.POST(request(STUDENT, "student", { message: "極權主義嗰啲嘢係點？" }))).json();

    const response = await statsRoute.GET(statsRequest(TEACHER, "teacher", 7));
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).not.toContain("messages");
    expect(raw).not.toContain("凡爾賽條約如何約束德國");

    const payload = JSON.parse(raw) as {
      days: number;
      contentIncluded: boolean;
      totals: { answered: number; offTopic: number; clarify: number; reject: number; normalize: number };
      webSupplement: Record<string, number>;
      daily: { date: string }[];
    };
    expect(payload.days).toBe(7);
    expect(payload.contentIncluded).toBe(false);
    expect(payload.totals.answered).toBe(1);
    expect(payload.totals.offTopic).toBe(1);
    expect(payload.totals.reject).toBe(1);
    expect(payload.totals.clarify).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(payload.daily)).toBe(true);
    expect(Object.keys(payload.webSupplement)).toEqual(
      expect.arrayContaining(["disabled"]),
    );
    expect(payload).not.toHaveProperty("messages");
  });

  it("無效的 days 會收斂至 7 日", async () => {
    const response = await statsRoute.GET(statsRequest(TEACHER, "teacher", 999));
    const payload = (await response.json()) as { days: number };
    expect(payload.days).toBe(7);
  });

  it("近 30 日亦可讀取", async () => {
    const response = await statsRoute.GET(statsRequest(TEACHER, "teacher", 30));
    const payload = (await response.json()) as { days: number };
    expect(payload.days).toBe(30);
  });
});
