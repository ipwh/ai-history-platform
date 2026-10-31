import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, encodeSession } from "@/server/auth/session";
import {
  createTutorSession,
  getTutorMessages,
  saveTutorMessage,
} from "@/server/repositories/tutor";
import { upsertSection, upsertTopic } from "@/server/repositories/topics";
import { ensureLearner } from "@/server/repositories/learners";
import { reserveAiOperation } from "@/server/services/ai-limits";
import {
  answeredTurnsOnly,
  hongKongDayStart,
  hongKongTimestamp,
  isShortHistoryFollowUp,
  tutorDailyUsage,
} from "@/server/services/tutor";
import { freshTestDatabasePath } from "./test-database";
import { TUTOR_COLLOQUIAL_UTTERANCES } from "./fixtures/tutor-colloquial-utterances";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("tutor-chat");
process.env.AUTH_SECRET = "tutor-test-secret-012345678901234567890";
process.env.AUTH_REQUIRE_SIGN_IN = "true";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
// 教師帳戶必須明確列在名單內：revalidateSessionUser 會依目前設定重新判定角色，
// 未列名者一律降為學生（且不會有名冊核對資料），因此學伴會回 403。
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

const STUDENT_A = "school:s2024101@pochiu.edu.hk";
const STUDENT_B = "school:s2024102@pochiu.edu.hk";

let postChat: typeof import("@/app/api/tutor/chat/route").POST;
let getChat: typeof import("@/app/api/tutor/chat/route").GET;
let getDb: typeof import("@/server/db/connection").getDb;

function sessionCookieFor(
  learnerId: string,
  options: { role?: "student" | "teacher" | "admin"; rosterVerified?: boolean } = {},
): string {
  const role = options.role ?? "student";
  const email =
    role === "student"
      ? learnerId.slice("school:".length)
      : learnerId.slice(learnerId.indexOf(":") + 1);
  return `${SESSION_COOKIE}=${encodeURIComponent(
    encodeSession({
      email,
      name: role === "student" ? "測試學生" : "測試教師",
      role,
      learnerId,
      rosterVerified: role === "student" ? (options.rosterVerified ?? true) : false,
      className: role === "student" ? "1A" : null,
      studentNumber: role === "student" ? email.split("@")[0] : null,
    }),
  )}`;
}

function studentCookie(learnerId: string): string {
  return sessionCookieFor(learnerId);
}

function requestFor(
  method: "GET" | "POST",
  learnerId: string | null,
  body?: unknown,
  query = "",
): Request {
  const cookie =
    learnerId === null
      ? null
      : learnerId.startsWith("school:") || learnerId.startsWith("teacher:") || learnerId.startsWith("admin:")
        ? sessionCookieFor(learnerId, {
            role: learnerId.startsWith("school:")
              ? "student"
              : learnerId.startsWith("teacher:")
                ? "teacher"
                : "admin",
          })
        : studentCookie(learnerId);
  return new Request(`http://localhost/api/tutor/chat${query}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/** 名冊未核對的學生（角色為學生但 rosterVerified=false） */
function unverifiedStudentRequest(learnerId: string, body: unknown): Request {
  return new Request("http://localhost/api/tutor/chat", {
    method: "POST",
    headers: {
      cookie: sessionCookieFor(learnerId, { role: "student", rosterVerified: false }),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function mockStreamingAnswer(answer = "你認為條約如何影響德國？"): Response {
  const events = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
  return new Response(events, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function countRows(table: "ai_operations" | "tutor_messages"): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as
    | { count: number }
    | undefined;
  return Number(row?.count ?? 0);
}

beforeAll(async () => {
  ({ POST: postChat, GET: getChat } = await import("@/app/api/tutor/chat/route"));
  getDb = (await import("@/server/db/connection")).getDb;

  upsertTopic({
    id: "topic-9",
    title: "課題9：20世紀的國際紛爭及危機－兩次世界大戰",
    published: true,
    order: 9,
  });
  upsertTopic({ id: "topic-5", title: "課題5：近代歐洲的興起", published: true, order: 5 });
  upsertTopic({ id: "topic-10", title: "課題10：冷戰及後冷戰時代", published: true, order: 10 });
  upsertSection({
    id: "topic-9-versailles",
    topicId: "topic-9",
    title: "凡爾賽條約的內容",
    matchKeywords: ["德國", "戰後安排"],
    order: 1,
  });
  upsertSection({
    id: "topic-9-ww1",
    topicId: "topic-9",
    title: "第一次世界大戰的起因",
    matchKeywords: ["戰爭爆發", "WW1"],
    order: 2,
  });
  upsertSection({
    id: "topic-5-renaissance",
    topicId: "topic-5",
    title: "文藝復興藝術",
    matchKeywords: ["藝術三傑", "人文主義"],
    order: 1,
  });
  upsertSection({
    id: "topic-5-meiji",
    topicId: "topic-5",
    title: "明治維新",
    matchKeywords: ["改革"],
    order: 2,
  });
  upsertSection({
    id: "topic-10-cold-war",
    topicId: "topic-10",
    title: "冷戰的發展",
    matchKeywords: ["國際關係", "兩德統一"],
    order: 1,
  });
});

beforeEach(() => {
  vi.unstubAllGlobals();
  process.env.DEEPSEEK_API_KEY = "test-only-key";
  process.env.AI_GENERATIONS_GLOBAL = "100";
  const db = getDb();
  db.prepare("DELETE FROM tutor_messages").run();
  db.prepare("DELETE FROM tutor_sessions").run();
  db.prepare("DELETE FROM ai_operations").run();
});

describe("AI 歷史自學學伴 API", () => {
  it.each(
    TUTOR_COLLOQUIAL_UTTERANCES.filter(
      (utterance) => utterance.category === "history" || utterance.category === "homework",
    ),
  )("$id：歷史口語／作業提問通過硬閘、保留原文並進入 LLM 正常流程", async ({ raw, category }) => {
    const fetchMock = vi.fn<typeof fetch>(async () => mockStreamingAnswer());
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(requestFor("POST", STUDENT_A, { message: raw }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(requestBody.messages.at(-1)).toEqual({ role: "user", content: raw });
    if (category === "homework") {
      expect(requestBody.messages[0]?.content).toContain("不直接代做功課");
      expect(requestBody.messages[0]?.content).toContain("提出引導問題");
      expect(requestBody.messages[0]?.content).toContain("不可提供可直接提交的完整作業答案");
    }

    await response.text();
    const sessionId = response.headers.get("x-tutor-session-id");
    expect(getTutorMessages(sessionId ?? "").find((message) => message.role === "user")?.content).toBe(
      raw,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tutorDailyUsage(STUDENT_A).used).toBe(1);
  });

  it.each(
    TUTOR_COLLOQUIAL_UTTERANCES.filter((utterance) => utterance.category === "clarify"),
  )("$id：含混歷史語料回傳澄清選項，選擇後走正常提問流程", async ({ raw }) => {
    const fetchMock = vi.fn<typeof fetch>(async () => mockStreamingAnswer());
    vi.stubGlobal("fetch", fetchMock);

    const clarification = await postChat(requestFor("POST", STUDENT_A, { message: raw }));
    expect(clarification.status).toBe(200);
    expect(clarification.headers.get("content-type")).toContain("application/json");
    const payload = (await clarification.json()) as {
      clarify: boolean;
      reply: string;
      candidates: Array<{ id: string; label: string; suggestedQuestion: string }>;
      sessionId: string | null;
      remaining: number;
      dailyLimit: number;
    };
    expect(payload.clarify).toBe(true);
    expect(payload.candidates.length).toBeGreaterThanOrEqual(2);
    expect(payload.candidates.length).toBeLessThanOrEqual(4);
    expect(payload.candidates.every((candidate) => candidate.suggestedQuestion.endsWith("？"))).toBe(
      true,
    );
    expect(payload.reply).toContain("自行改寫");
    expect(payload.remaining).toBe(15);
    expect(payload.dailyLimit).toBe(15);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(tutorDailyUsage(STUDENT_A).used).toBe(0);
    expect(countRows("ai_operations")).toBe(0);
    expect(countRows("tutor_messages")).toBe(0);
    expect(payload.sessionId).toBeNull();

    const selected = payload.candidates[0];
    expect(selected).toBeDefined();
    const followUp = await postChat(
      requestFor("POST", STUDENT_A, {
        message: selected!.suggestedQuestion,
        ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
      }),
    );
    expect(followUp.status).toBe(200);
    expect(followUp.headers.get("content-type")).toContain("text/event-stream");
    await followUp.text();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tutorDailyUsage(STUDENT_A).used).toBe(1);
    expect(countRows("ai_operations")).toBe(1);
  });

  it.each(TUTOR_COLLOQUIAL_UTTERANCES.filter((utterance) => utterance.category === "reject"))(
    "$id：明確離題固定拒答，不澄清、不呼叫 LLM、不扣日額",
    async ({ raw }) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const response = await postChat(requestFor("POST", STUDENT_A, { message: raw }));
      const payload = (await response.json()) as {
        clarify?: boolean;
        reply: string;
        remaining: number;
      };

      expect(response.status).toBe(200);
      expect(payload.clarify).not.toBe(true);
      expect(payload.reply).toBe(
        "我是你的歷史科自學學伴，只能討論歷史科相關話題喔！你可以告訴我你想探討哪一個歷史事件或課題嗎？",
      );
      expect(payload.remaining).toBe(15);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(tutorDailyUsage(STUDENT_A).used).toBe(0);
      expect(countRows("ai_operations")).toBe(0);
    },
  );

  it("以香港時區計算每日限額重置時間", () => {
    expect(hongKongDayStart(new Date("2026-10-25T16:00:00.000Z"))).toBe(
      "2026-10-26T00:00:00.000+08:00",
    );
  });

  it("沒有回覆的提問不會送去模型（避免下一輪一併回答）", () => {
    // 上一次請求失敗：資料庫只剩學生提問
    expect(answeredTurnsOnly([{ role: "user", content: "凡爾賽條約如何約束德國？" }])).toEqual([]);
    expect(
      answeredTurnsOnly([
        { role: "user", content: "凡爾賽條約如何約束德國？" },
        { role: "assistant", content: "你認為哪一項約束最嚴厲？" },
        { role: "user", content: "點解？" },
      ]),
    ).toEqual([
      { role: "user", content: "凡爾賽條約如何約束德國？" },
      { role: "assistant", content: "你認為哪一項約束最嚴厲？" },
    ]);
  });

  it("連續兩則學生訊息只保留最新一則", () => {
    expect(
      answeredTurnsOnly([
        { role: "user", content: "凡爾賽條約如何約束德國？" },
        { role: "user", content: "我想知道文藝復興如何導致宗教革命的出現。" },
        { role: "assistant", content: "可以先想宗教改革的傳播條件。" },
      ]),
    ).toEqual([
      { role: "user", content: "我想知道文藝復興如何導致宗教革命的出現。" },
      { role: "assistant", content: "可以先想宗教改革的傳播條件。" },
    ]);
  });

  it.each(["今天天氣如何", "幫我寫 Python"])(
    "離題問題「%s」會被攔截，而且不呼叫 LLM",
    async (message) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const response = await postChat(requestFor("POST", STUDENT_A, { message }));

      expect(response.status).toBe(200);
      expect((await response.json()).reply).toBe(
        "我是你的歷史科自學學伴，只能討論歷史科相關話題喔！你可以告訴我你想探討哪一個歷史事件或課題嗎？",
      );
      expect(fetchMock).toHaveBeenCalledTimes(0);
    },
  );

  it("簡體字的歷史問題不會被主題閘誤判為離題", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => mockStreamingAnswer());
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      requestFor("POST", STUDENT_A, {
        message: "文艺复兴中所有历史事件的顺序是什么",
      }),
    );

    expect(response.status).toBe(200);
    await response.text();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    "文艺复兴系咩来？",
    "文藝復興中所有歷史事件的順序是什麼",
    "二战点解会打起来？",
    "希特拉個人做咗乜？",
    "咁希特拉佢有咩做過？",
    "法西斯同納粹係咪一樣嘢？",
    "南京條約嗰個係割咗邊度",
    "五四嗰時啲學生做乜",
  ])("模擬學生以口語、錯字或簡體提問「%s」仍可進入學伴", async (message) => {
    const fetchMock = vi.fn<typeof fetch>(async () => mockStreamingAnswer());
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(requestFor("POST", STUDENT_A, { message }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await response.text();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    "咁跟住呢？",
    "跟住点？",
    "然后呢",
    "之後點呀？",
    "咁之後發生咩事？",
    "咁佢最後點？",
    "咁呢個有咩影響？",
    "後來呢？",
    "有咩結果？",
  ])(
    "常見口語跟進「%s」可沿用已建立的歷史對話",
    (message) => {
      expect(isShortHistoryFollowUp(message)).toBe(true);
    },
  );

  it("含糊歷史問題直接回傳課程澄清方向，不呼叫主回答 LLM", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      requestFor("POST", STUDENT_A, { message: "極權主義嗰啲嘢係點？" }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      clarify: boolean;
      candidates: Array<{ id: string; label: string; suggestedQuestion: string }>;
      remaining: number;
    };
    expect(payload.clarify).toBe(true);
    expect(payload.candidates.length).toBeGreaterThanOrEqual(2);
    expect(payload.candidates.length).toBeLessThanOrEqual(4);
    expect(payload.remaining).toBe(15);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("未登入學生回傳 401", async () => {
    const response = await postChat(requestFor("POST", null, { message: "一戰的起因是甚麼？" }));
    expect(response.status).toBe(401);
  });

  it("教師可以使用學伴作科組測試（記錄在 teacher: 之下）", async () => {
    const learnerId = "teacher:teacher@example.com";
    ensureLearner(learnerId);
    const fetchMock = vi.fn<typeof fetch>(async () => mockStreamingAnswer());
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      requestFor("POST", learnerId, { message: "凡爾賽條約如何約束德國？" }),
    );

    expect(response.status).toBe(200);
    await response.text();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sessionId = response.headers.get("x-tutor-session-id");
    expect(sessionId).not.toBeNull();
    // 對話記錄屬於教師帳戶，學生帳戶看不到
    expect(getTutorMessages(sessionId ?? "")).toHaveLength(2);
    expect(tutorDailyUsage(learnerId).used).toBe(1);
    expect(tutorDailyUsage(STUDENT_A).used).toBe(0);
  });

  it("名冊未核對的學生仍被拒絕（403），且不呼叫 LLM", async () => {
    const learnerId = "school:s2024199@pochiu.edu.hk";
    ensureLearner(learnerId);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      unverifiedStudentRequest(learnerId, { message: "一戰的起因是甚麼？" }),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain("名冊");
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("DeepSeek 金鑰缺失時明確回傳 503，且不呼叫 LLM", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      requestFor("POST", STUDENT_A, { message: "一戰的起因是甚麼？" }),
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("TUTOR_LLM_NOT_CONFIGURED");
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("不允許學生讀取或寫入另一位學生的對話", async () => {
    ensureLearner(STUDENT_B);
    const foreignSession = createTutorSession(STUDENT_B, hongKongTimestamp());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      requestFor("POST", STUDENT_A, {
        message: "一戰的起因是甚麼？",
        sessionId: foreignSession,
      }),
    );

    expect(response.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("不允許學生讀取另一位學生的對話", async () => {
    ensureLearner(STUDENT_B);
    const foreignSession = createTutorSession(STUDENT_B, hongKongTimestamp());

    const response = await getChat(
      requestFor("GET", STUDENT_A, undefined, `?sessionId=${encodeURIComponent(foreignSession)}`),
    );

    expect(response.status).toBe(404);
  });

  it("第 16 次已通過主題閘的提問回傳 429，且不呼叫 LLM", async () => {
    const sessionId = createTutorSession(STUDENT_A, hongKongTimestamp());
    for (let index = 0; index < 15; index += 1) {
      // 每日額度只計「成功學伴回覆」的提問
      saveTutorMessage(sessionId, "user", `一戰原因 ${index}`, hongKongTimestamp());
      saveTutorMessage(sessionId, "assistant", "引導問題", hongKongTimestamp(), 0, {
        groundingStatus: "grounded",
      });
    }
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      requestFor("POST", STUDENT_A, { message: "二戰的起因是甚麼？", sessionId }),
    );

    expect(response.status).toBe(429);
    expect((await response.json()).error).toContain("15 次");
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("學伴提問共用 ai_operations 的 generation 全域時間窗上限", async () => {
    process.env.AI_GENERATIONS_GLOBAL = "1";
    reserveAiOperation(STUDENT_B, "generation");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(
      requestFor("POST", STUDENT_A, { message: "冷戰的成因是甚麼？" }),
    );

    expect(response.status).toBe(429);
    expect((await response.json()).error).toContain("AI 使用上限");
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("「一戰」同義詞可以通過閘門並呼叫 DeepSeek 串流", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => mockStreamingAnswer());
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(requestFor("POST", STUDENT_A, { message: "一戰的起因是甚麼？" }));
    const streamText = await response.text();

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestInit = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      stream: true,
      temperature: 0.4,
    });
    expect(streamText).toContain("你認為條約如何影響德國？");
    const sessionId = response.headers.get("x-tutor-session-id");
    expect(sessionId).not.toBeNull();
    expect(getTutorMessages(sessionId ?? "")).toHaveLength(2);
  });

  it("短跟進只在已有歷史對話時通過硬閘", async () => {
    const fetchMock = vi.fn(async () => mockStreamingAnswer());
    vi.stubGlobal("fetch", fetchMock);

    const firstResponse = await postChat(
      requestFor("POST", STUDENT_A, { message: "明治維新有甚麼影響？" }),
    );
    const sessionId = firstResponse.headers.get("x-tutor-session-id");
    await firstResponse.text();
    const followUp = await postChat(
      requestFor("POST", STUDENT_A, { message: "點解？", sessionId: sessionId ?? undefined }),
    );

    expect(followUp.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("全新對話只輸入「點解？」會被硬閘攔截，不呼叫 LLM", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await postChat(requestFor("POST", STUDENT_A, { message: "點解？" }));

    expect(response.headers.get("content-type")).toContain("application/json");
    expect((await response.json()).reply).toBe(
      "我是你的歷史科自學學伴，只能討論歷史科相關話題喔！你可以告訴我你想探討哪一個歷史事件或課題嗎？",
    );
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("離題提問不扣減每日額度；成功提問才遞減", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => mockStreamingAnswer());
    vi.stubGlobal("fetch", fetchMock);

    const offTopic = await postChat(requestFor("POST", STUDENT_A, { message: "幫我寫 Python" }));
    expect((await offTopic.json()).remaining).toBe(15);

    const onTopic = await postChat(
      requestFor("POST", STUDENT_A, { message: "凡爾賽條約如何約束德國？" }),
    );
    await onTopic.text();
    // header 於回覆完成前送出，因此是「提問前」的剩餘；權威數字由 done 與 GET 提供
    expect(onTopic.headers.get("x-tutor-remaining")).toBe("15");

    const status = await getChat(requestFor("GET", STUDENT_A));
    expect(await status.json()).toMatchObject({ remaining: 14, dailyLimit: 15 });
  });

  it("上一輪被判為離題後，不接受沒有歷史關鍵詞的短跟進", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => mockStreamingAnswer());
    vi.stubGlobal("fetch", fetchMock);

    const firstResponse = await postChat(
      requestFor("POST", STUDENT_A, { message: "明治維新有甚麼影響？" }),
    );
    const sessionId = firstResponse.headers.get("x-tutor-session-id");
    await firstResponse.text();
    await postChat(
      requestFor("POST", STUDENT_A, {
        message: "今天天氣如何？",
        sessionId: sessionId ?? undefined,
      }),
    );
    const followUp = await postChat(
      requestFor("POST", STUDENT_A, { message: "點解？", sessionId: sessionId ?? undefined }),
    );

    expect(followUp.headers.get("content-type")).toContain("application/json");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
