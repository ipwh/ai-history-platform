import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE, encodeSession } from "@/server/auth/session";
import { ensureLearner } from "@/server/repositories/learners";
import { insertQuestion } from "@/server/repositories/questions";
import { upsertSection, upsertTopic } from "@/server/repositories/topics";
import { questionSchema } from "@/lib/types";
import { freshTestDatabasePath } from "./test-database";

/**
 * 練習 → 學伴（P0 安全邊界）測試。
 *
 * 這一組測試的目的只有一個：**證明標準答案、解釋、知識點、評卷資料永遠不會**
 * 經「練習上下文」這條新路徑離開伺服器——無論是 API 回應，還是送去模型的提示詞。
 * 因此每個測試都會同時檢查回應 JSON 及（可取得時）提示詞內容。
 */
process.env.APP_DATABASE_PATH = freshTestDatabasePath("tutor-practice-link");
process.env.AUTH_SECRET = "tutor-practice-link-secret-0123456789";
process.env.AUTH_REQUIRE_SIGN_IN = "true";
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
// 學伴的語意改寫（services/tutor-query-expansion.ts）預設開啟，但它會令「字詞檢索失敗」的提問
// 多發一次模型請求；本檔以固定次序的假回應模擬模型，因此明確關閉。語意改寫本身由
// tests/tutor-query-expansion.test.ts 及 tests/tutor-query-expansion-route.test.ts 專項驗證。
process.env.TUTOR_QUERY_EXPANSION_ENABLED = "false";
// 外部參考在此測試中一律關閉，令提示詞內容可完全預期
delete process.env.TUTOR_WEB_SUPPLEMENT_ENABLED;
delete process.env.TUTOR_WEB_SEARCH_ENDPOINT;

const STUDENT = "school:s2024701@pochiu.edu.hk";
const OTHER_STUDENT = "school:s2024702@pochiu.edu.hk";

/** 只在題庫出現的字串：一旦外泄，測試即可斷言失敗 */
const SECRET_ANSWER = "標準答案絕對不可外泄";
const SECRET_EXPLANATION = "評卷參考：本題的評分準則不得外泄";
const SECRET_KNOWLEDGE_POINT = "知識點本身就是答案";

const PUBLISHED_QUESTION_ID = "q-published-1";
const DRAFT_QUESTION_ID = "q-draft-1";
const AI_QUESTION_ID = "q-ai-only-1";

let practiceContextRoute: typeof import("@/app/api/tutor/practice-context/route");
let chatRoute: typeof import("@/app/api/tutor/chat/route");
let practiceService: typeof import("@/server/services/practice-service");
let getDb: typeof import("@/server/db/connection").getDb;

function cookieFor(learnerId: string, role: "student" | "teacher" = "student"): string {
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

function practiceContextRequest(learnerId: string, query: string): Request {
  return new Request(`http://localhost/api/tutor/practice-context${query}`, {
    method: "GET",
    headers: { cookie: cookieFor(learnerId) },
  });
}

function chatRequest(learnerId: string, body: unknown): Request {
  return new Request("http://localhost/api/tutor/chat", {
    method: "POST",
    headers: { cookie: cookieFor(learnerId), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function streamingAnswer(answer = "你可以先想：這條條約限制了德國哪一方面？"): Response {
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

function promptFromFetch(fetchMock: ReturnType<typeof vi.fn>, callIndex = 0): string {
  const body = String(fetchMock.mock.calls[callIndex]?.[1]?.body ?? "");
  const parsed = JSON.parse(body) as { messages: { role: string; content: string }[] };
  return parsed.messages[0]?.content ?? "";
}

beforeAll(async () => {
  practiceContextRoute = await import("@/app/api/tutor/practice-context/route");
  chatRoute = await import("@/app/api/tutor/chat/route");
  practiceService = await import("@/server/services/practice-service");
  getDb = (await import("@/server/db/connection")).getDb;

  ensureLearner(STUDENT);
  ensureLearner(OTHER_STUDENT);

  upsertTopic({ id: "topic-5", title: "課題5：近代歐洲的興起", published: true, order: 5 });
  upsertTopic({ id: "topic-9", title: "課題9：20世紀的國際紛爭及危機(I)–兩次世界大戰", published: true, order: 9 });
  upsertTopic({ id: "topic-99", title: "課題99：未發布課題", published: false, order: 99 });
  upsertSection({
    id: "topic-5-renaissance",
    topicId: "topic-5",
    title: "文藝復興藝術",
    matchKeywords: ["藝術三傑", "人文主義"],
    order: 1,
  });
  upsertSection({
    id: "topic-9-versailles",
    topicId: "topic-9",
    title: "凡爾賽條約的內容",
    matchKeywords: ["德國", "戰後安排"],
    order: 1,
  });
  upsertSection({
    id: "topic-99-secret",
    topicId: "topic-99",
    title: "未發布課題分節",
    matchKeywords: ["未發布"],
    order: 1,
  });

  const now = "2026-11-01T00:00:00.000+08:00";
  insertQuestion(
    questionSchema.parse({
      id: PUBLISHED_QUESTION_ID,
      topicId: "topic-9",
      sectionId: "topic-9-versailles",
      questionType: "fill",
      difficulty: "basic",
      question: "《凡爾賽條約》規定德國在軍事上須＿＿＿，並放棄海外殖民地。",
      options: [],
      correctAnswer: SECRET_ANSWER,
      acceptedAnswers: [],
      explanation: SECRET_EXPLANATION,
      knowledgePoint: SECRET_KNOWLEDGE_POINT,
      sourceExcerpt: "《凡爾賽條約》規定德國須限制軍隊數目。",
      sourceLocation: "課題9 兩次世界大戰_筆記.docx · 第 2 段",
      sourceBlockIds: [],
      gradingPoints: [],
      origin: "demo",
      status: "published",
      sourceVerified: true,
      skill: "準確排列歷史事件的次序",
      revision: 1,
      createdAt: now,
    }),
  );

  // 未發布題目：學生不應能經練習上下文看到任何內容
  insertQuestion(
    questionSchema.parse({
      id: DRAFT_QUESTION_ID,
      topicId: "topic-9",
      sectionId: "topic-9-versailles",
      questionType: "fill",
      difficulty: "basic",
      question: "《凡爾賽條約》設立了哪一個國際組織？",
      options: [],
      correctAnswer: SECRET_ANSWER,
      acceptedAnswers: [],
      explanation: SECRET_EXPLANATION,
      knowledgePoint: SECRET_KNOWLEDGE_POINT,
      sourceExcerpt: "條約亦設立國際聯盟。",
      sourceLocation: "課題9 兩次世界大戰_筆記.docx · 第 3 段",
      sourceBlockIds: [],
      gradingPoints: [],
      origin: "demo",
      status: "draft",
      sourceVerified: true,
      revision: 1,
      createdAt: now,
    }),
  );

  // 所屬課題未發布：即使題目本身已發布亦不可經此路徑讀取
  insertQuestion(
    questionSchema.parse({
      id: AI_QUESTION_ID,
      topicId: "topic-99",
      sectionId: "topic-99-secret",
      questionType: "fill",
      difficulty: "basic",
      question: "未發布課題的題幹不應外泄。",
      options: [],
      correctAnswer: SECRET_ANSWER,
      acceptedAnswers: [],
      explanation: SECRET_EXPLANATION,
      knowledgePoint: SECRET_KNOWLEDGE_POINT,
      sourceExcerpt: "未發布課題的教材節錄。",
      sourceLocation: "未發布課題 · 第 1 段",
      sourceBlockIds: [],
      gradingPoints: [],
      origin: "demo",
      status: "published",
      sourceVerified: true,
      revision: 1,
      createdAt: now,
    }),
  );
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

describe("練習上下文 API：只回傳學生安全欄位", () => {
  it("已發布題目回傳課題／題型／技能／題幹摘要及建議問題，且不含任何答案", async () => {
    const response = await practiceContextRoute.GET(
      practiceContextRequest(STUDENT, `?questionId=${PUBLISHED_QUESTION_ID}`),
    );
    expect(response.status).toBe(200);
    const raw = await response.text();
    // 先把整個回應當字串檢查：任何洩漏都會在此被抓到
    expect(raw).not.toContain(SECRET_ANSWER);
    expect(raw).not.toContain(SECRET_EXPLANATION);
    expect(raw).not.toContain(SECRET_KNOWLEDGE_POINT);
    expect(raw).not.toContain("correctAnswer");
    expect(raw).not.toContain("explanation");

    const payload = JSON.parse(raw) as {
      practiceContext: {
        questionId: string;
        topicId: string;
        topicTitle: string;
        questionType: string;
        skill: string | null;
        stemSummary: string;
        suggestedQuestions: string[];
      };
      skillHint: string | null;
    };
    expect(payload.practiceContext.questionId).toBe(PUBLISHED_QUESTION_ID);
    expect(payload.practiceContext.topicId).toBe("topic-9");
    expect(payload.practiceContext.topicTitle).toContain("課題9");
    expect(payload.practiceContext.questionType).toBe("填充題");
    expect(payload.practiceContext.skill).toBe("準確排列歷史事件的次序");
    expect(payload.practiceContext.stemSummary).toContain("凡爾賽條約");
    expect(payload.practiceContext.stemSummary.length).toBeLessThanOrEqual(301);
    expect(payload.practiceContext.suggestedQuestions.length).toBeGreaterThan(0);
    expect(payload.skillHint).toContain("準確排列歷史事件的次序");
  });

  it("未發布題目一律 404，訊息與「不存在」相同（不可用作探測）", async () => {
    const draft = await practiceContextRoute.GET(
      practiceContextRequest(STUDENT, `?questionId=${DRAFT_QUESTION_ID}`),
    );
    const missing = await practiceContextRoute.GET(
      practiceContextRequest(STUDENT, "?questionId=q-does-not-exist"),
    );
    expect(draft.status).toBe(404);
    expect(missing.status).toBe(404);
    const draftBody = (await draft.json()) as { error?: string };
    const missingBody = (await missing.json()) as { error?: string };
    expect(draftBody.error).toBe(missingBody.error);
    expect(JSON.stringify(draftBody)).not.toContain(SECRET_ANSWER);
  });

  it("所屬課題未發布時亦 404", async () => {
    const response = await practiceContextRoute.GET(
      practiceContextRequest(STUDENT, `?questionId=${AI_QUESTION_ID}`),
    );
    expect(response.status).toBe(404);
  });

  it("缺少 questionId 回 400", async () => {
    const response = await practiceContextRoute.GET(practiceContextRequest(STUDENT, ""));
    expect(response.status).toBe(400);
  });

  it("未登入回 401", async () => {
    const response = await practiceContextRoute.GET(
      new Request(`http://localhost/api/tutor/practice-context?questionId=${PUBLISHED_QUESTION_ID}`),
    );
    expect(response.status).toBe(401);
  });

  it("讀取他人的練習紀錄回 403，且不洩漏任何欄位", async () => {
    // 以另一位學生建立練習（mock 出題方式會用到題庫，故用 bank）
    const practice = await practiceService.createPractice({
      learnerId: OTHER_STUDENT,
      topicId: "topic-9",
      sectionIds: ["topic-9-versailles"],
      questionTypes: ["fill"],
      difficulty: "basic",
      questionCount: 1,
      mode: "standard",
      questionSource: "bank",
    });
    const questionId = practice.questions[0]?.id;
    expect(questionId).toBeTruthy();

    const response = await practiceContextRoute.GET(
      practiceContextRequest(
        STUDENT,
        `?questionId=${encodeURIComponent(questionId!)}&sessionId=${encodeURIComponent(practice.session.id)}`,
      ),
    );
    expect(response.status).toBe(403);
    const raw = await response.text();
    expect(raw).not.toContain(SECRET_ANSWER);
  });

  it("自己的練習紀錄可讀，並同樣不含答案（快照路徑）", async () => {
    const practice = await practiceService.createPractice({
      learnerId: STUDENT,
      topicId: "topic-9",
      sectionIds: ["topic-9-versailles"],
      questionTypes: ["fill"],
      difficulty: "basic",
      questionCount: 1,
      mode: "standard",
      questionSource: "bank",
    });
    const questionId = practice.questions[0]?.id ?? "";
    const response = await practiceContextRoute.GET(
      practiceContextRequest(
        STUDENT,
        `?questionId=${encodeURIComponent(questionId)}&sessionId=${encodeURIComponent(practice.session.id)}`,
      ),
    );
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).not.toContain(SECRET_ANSWER);
    expect(raw).not.toContain(SECRET_EXPLANATION);
    expect(raw).not.toContain(SECRET_KNOWLEDGE_POINT);
  });
});

describe("學伴提問：練習上下文只注入安全內容", () => {
  it("提示詞含練習上下文區塊及題幹摘要，但沒有標準答案或解釋", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => streamingAnswer());
    vi.stubGlobal("fetch", fetchMock);

    const response = await chatRoute.POST(
      chatRequest(STUDENT, {
        message: "凡爾賽條約如何約束德國？",
        practiceQuestionId: PUBLISHED_QUESTION_ID,
      }),
    );
    expect(response.status).toBe(200);
    const events = sseEvents(await response.text());
    const meta = events.find((entry) => entry.event === "meta")?.data as {
      skillHint: string | null;
    };
    const done = events.find((entry) => entry.event === "done")?.data as {
      skillHint: string | null;
      practiceQuestionId: string | null;
    };

    const prompt = promptFromFetch(fetchMock);
    expect(prompt).toContain("【練習上下文");
    expect(prompt).toContain("凡爾賽條約");
    expect(prompt).toContain("不要直接給出這題的答案");
    // 三條禁線：答案、解釋、知識點
    expect(prompt).not.toContain(SECRET_ANSWER);
    expect(prompt).not.toContain(SECRET_EXPLANATION);
    expect(prompt).not.toContain(SECRET_KNOWLEDGE_POINT);

    expect(meta.skillHint).toContain("準確排列歷史事件的次序");
    expect(done.skillHint).toContain("準確排列歷史事件的次序");
    expect(done.practiceQuestionId).toBe(PUBLISHED_QUESTION_ID);
  });

  it("前端夾帶答案欄位時一律忽略（伺服器自行重組上下文）", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => streamingAnswer());
    vi.stubGlobal("fetch", fetchMock);

    const response = await chatRoute.POST(
      chatRequest(STUDENT, {
        message: "凡爾賽條約如何約束德國？",
        practiceQuestionId: PUBLISHED_QUESTION_ID,
        correctAnswer: SECRET_ANSWER,
        explanation: SECRET_EXPLANATION,
        knowledgePoint: SECRET_KNOWLEDGE_POINT,
        options: ["限制軍隊數目"],
        rubric: SECRET_EXPLANATION,
      }),
    );
    expect(response.status).toBe(200);
    await response.text();

    const prompt = promptFromFetch(fetchMock);
    expect(prompt).not.toContain(SECRET_ANSWER);
    expect(prompt).not.toContain(SECRET_EXPLANATION);
    expect(prompt).not.toContain(SECRET_KNOWLEDGE_POINT);
  });

  it("練習題不可用時仍可正常提問（只是沒有練習上下文）", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => streamingAnswer());
    vi.stubGlobal("fetch", fetchMock);

    const response = await chatRoute.POST(
      chatRequest(STUDENT, {
        message: "凡爾賽條約如何約束德國？",
        practiceQuestionId: DRAFT_QUESTION_ID,
      }),
    );
    expect(response.status).toBe(200);
    await response.text();
    const prompt = promptFromFetch(fetchMock);
    expect(prompt).not.toContain("【練習上下文");
    expect(prompt).not.toContain(SECRET_ANSWER);
  });

  it("提交後重新載入對話仍保留練習上下文（用於重建開場引導）", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => streamingAnswer());
    vi.stubGlobal("fetch", fetchMock);

    const posted = await chatRoute.POST(
      chatRequest(STUDENT, {
        message: "凡爾賽條約如何約束德國？",
        practiceQuestionId: PUBLISHED_QUESTION_ID,
      }),
    );
    await posted.text();
    const sessionId = posted.headers.get("x-tutor-session-id") ?? "";

    const reloaded = await chatRoute.GET(
      new Request(`http://localhost/api/tutor/chat?sessionId=${encodeURIComponent(sessionId)}`, {
        headers: { cookie: cookieFor(STUDENT) },
      }),
    );
    const payload = (await reloaded.json()) as {
      practiceContext: { questionId: string; stemSummary: string } | null;
      topicId: string | null;
    };
    expect(payload.practiceContext?.questionId).toBe(PUBLISHED_QUESTION_ID);
    expect(payload.practiceContext?.stemSummary).toContain("凡爾賽條約");
    expect(payload.topicId).toBe("topic-9");
    expect(JSON.stringify(payload)).not.toContain(SECRET_ANSWER);
  });
});

describe("學習目標課題（M4 soft prior）", () => {
  it("設定學習目標後，含混短問的澄清候選會偏向該課題（含課題卡問題）", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await chatRoute.POST(
      chatRequest(STUDENT, {
        message: "極權主義嗰啲嘢係點？",
        goalTopicId: "topic-9",
      }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      clarify?: boolean;
      topicId?: string | null;
      candidates: { suggestedQuestion: string }[];
    };
    expect(payload.clarify).toBe(true);
    expect(payload.topicId).toBe("topic-9");
    expect(fetchMock).not.toHaveBeenCalled();
    // 課題9 的內建課題卡問題應排在候選最前
    expect(payload.candidates.some((candidate) =>
      candidate.suggestedQuestion.includes("第一次世界大戰的爆發"),
    )).toBe(true);
  });

  it("明確問另一個課題的專名時，仍以當前提問為準（不會被學習目標蓋過）", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => streamingAnswer());
    vi.stubGlobal("fetch", fetchMock);

    const response = await chatRoute.POST(
      chatRequest(STUDENT, {
        message: "文藝復興有甚麼特色？",
        goalTopicId: "topic-9",
      }),
    );
    expect(response.status).toBe(200);
    await response.text();
    const prompt = promptFromFetch(fetchMock);
    // 提示詞仍會提到學習目標（soft prior），但教材 grounding 必須是文藝復興（課題5）
    expect(prompt).toContain("【學習目標】");
    const groundBlock = prompt.slice(prompt.indexOf("【教材片段】"), prompt.indexOf("【教材片段】") + 400);
    expect(groundBlock.includes("文藝復興") || groundBlock.includes("本次提問未能在本校教材中找到")).toBe(
      true,
    );
  });

  it("無效或未發布的 goalTopicId 會被忽略", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await chatRoute.POST(
      chatRequest(STUDENT, {
        message: "極權主義嗰啲嘢係點？",
        goalTopicId: "topic-99",
      }),
    );
    const payload = (await response.json()) as { topicId?: string | null };
    expect(payload.topicId).not.toBe("topic-99");
  });
});
