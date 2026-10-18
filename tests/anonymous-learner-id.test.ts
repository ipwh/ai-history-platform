/**
 * 匿名示範模式下的學習者身分測試。
 *
 * 這個檔案刻意**不設定** Google 憑證，令 `AUTH_REQUIRE_SIGN_IN` 不生效（示範模式），
 * 以便真正走到「前端傳入 learnerId」的程式分支。驗證：
 *   1. 未登入時仍可使用自己產生的匿名 UUID（示範模式的核心行為不變）。
 *   2. 未登入時**不可**使用由帳戶推導的學習者 ID（school:／teacher:／admin:）：
 *      否則只要猜中他人的校內電郵，就可以讀取他人的練習記錄、進度及重溫佇列。
 *   3. 已登入時，工作階段身分優先，偽造的 learnerId 不會生效（跨學生隔離）。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("anon-learner");
process.env.LLM_PROVIDER = "mock";
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_REQUIRE_SIGN_IN = "false";
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.ADMIN_TOKEN;
delete process.env.K_SERVICE;
delete process.env.HISTORY_ALLOW_UNSAFE_DEMO_MODE;

type SessionModule = typeof import("@/server/auth/session");
type SeedModule = typeof import("@/server/seed");

let session: SessionModule;
let seed: SeedModule;

const ANONYMOUS_A = "9f1a4c62-8ef0-4a1f-9b5d-4a5f7c2b6d31";
const ANONYMOUS_B = "1c7d0f8a-3f52-4b16-84c9-6a1e2d3b8c57";
const STUDENT_A = {
  email: "s2024146@pochiu.edu.hk",
  name: "測試學生A",
  role: "student" as const,
  learnerId: "school:s2024146@pochiu.edu.hk",
  pictureUrl: null,
};
const STUDENT_B = {
  email: "s2024152@pochiu.edu.hk",
  name: "測試學生B",
  role: "student" as const,
  learnerId: "school:s2024152@pochiu.edu.hk",
  pictureUrl: null,
};

/** 由帳戶推導的學習者 ID（未登入時一律不可使用） */
const ACCOUNT_LEARNER_IDS = [
  "school:s2024146@pochiu.edu.hk",
  "teacher:history.teacher@pochiu.edu.hk",
  "admin:admin@pochiu.edu.hk",
];

function cookieHeader(user: typeof STUDENT_A | typeof STUDENT_B): string {
  return `hk-history-session=${encodeURIComponent(session.encodeSession(user))}`;
}

beforeAll(async () => {
  session = await import("@/server/auth/session");
  seed = await import("@/server/seed");
  seed.ensureBootstrap();
});

describe("示範模式下的學習者身分", () => {
  it("未登入仍可使用自己的匿名 UUID（示範模式行為不變）", async () => {
    const { GET } = await import("@/app/api/topics/route");
    const response = await GET(new Request(`http://localhost:3000/api/topics?learnerId=${ANONYMOUS_A}`));
    expect(response.status).toBe(200);
  });

  it("未登入時以 school:／teacher:／admin: 的學習者 ID 讀取資料會被拒絕（401）", async () => {
    const { GET: topics } = await import("@/app/api/topics/route");
    const { GET: progress } = await import("@/app/api/progress/route");

    for (const learnerId of ACCOUNT_LEARNER_IDS) {
      const forgedTopics = await topics(
        new Request(`http://localhost:3000/api/topics?learnerId=${encodeURIComponent(learnerId)}`),
      );
      expect(forgedTopics.status, `GET /api/topics 不應接受 ${learnerId}`).toBe(401);
      const body = (await forgedTopics.json()) as { error?: string };
      // 訊息說明要先登入，不會透露該帳戶是否存在
      expect(body.error ?? "").toContain("登入");

      const forgedProgress = await progress(
        new Request(`http://localhost:3000/api/progress?learnerId=${encodeURIComponent(learnerId)}`),
      );
      expect(forgedProgress.status, `GET /api/progress 不應接受 ${learnerId}`).toBe(401);
    }
  });

  it("未登入時不可用帳戶的學習者 ID 建立練習", async () => {
    const { POST } = await import("@/app/api/practice/route");
    const response = await POST(
      new Request("http://localhost:3000/api/practice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          learnerId: ACCOUNT_LEARNER_IDS[0],
          topicId: "topic-5",
          sectionIds: ["topic-5-renaissance-features"],
          questionTypes: ["mc"],
          difficulty: "basic",
          questionCount: 1,
        }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("未登入時不可用帳戶的學習者 ID 回報題目", async () => {
    const { POST } = await import("@/app/api/reports/route");
    const response = await POST(
      new Request("http://localhost:3000/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          learnerId: ACCOUNT_LEARNER_IDS[1],
          questionId: "missing-question",
          reason: "unclear",
          detail: "測試",
        }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("未登入時使用格式錯誤的學習者 ID 仍是 400（不會洩漏商業邏輯）", async () => {
    const { GET } = await import("@/app/api/topics/route");
    const response = await GET(new Request("http://localhost:3000/api/topics?learnerId=%3Cscript%3E"));
    expect(response.status).toBe(400);
  });
});

describe("示範模式下的跨學生隔離（已登入時工作階段優先）", () => {
  async function practiseAs(user: typeof STUDENT_A | typeof STUDENT_B): Promise<void> {
    const { POST: createPractice } = await import("@/app/api/practice/route");
    const created = await createPractice(
      new Request("http://localhost:3000/api/practice", {
        method: "POST",
        headers: { cookie: cookieHeader(user), "content-type": "application/json" },
        body: JSON.stringify({
          learnerId: ANONYMOUS_A,
          topicId: "topic-5",
          sectionIds: ["topic-5-renaissance-features"],
          questionTypes: ["mc"],
          difficulty: "basic",
          questionCount: 1,
        }),
      }),
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as { session: { id: string }; questions: { id: string }[] };

    const { POST: submitAnswer } = await import("@/app/api/practice/[sessionId]/answers/route");
    const answered = await submitAnswer(
      new Request(`http://localhost:3000/api/practice/${body.session.id}/answers`, {
        method: "POST",
        headers: { cookie: cookieHeader(user), "content-type": "application/json" },
        body: JSON.stringify({
          learnerId: ANONYMOUS_B,
          questionId: body.questions[0].id,
          answer: "測試答案",
        }),
      }),
      { params: Promise.resolve({ sessionId: body.session.id }) },
    );
    expect(answered.status).toBe(200);
  }

  it("偽造 learnerId 無法讀取他人的學習進度", async () => {
    const { GET } = await import("@/app/api/progress/route");
    await practiseAs(STUDENT_A);

    const mine = await GET(
      new Request("http://localhost:3000/api/progress?topicId=topic-5", {
        headers: { cookie: cookieHeader(STUDENT_A) },
      }),
    );
    const minePayload = (await mine.json()) as { topics: { topicId: string; attemptedQuestions: number }[] };
    expect(
      minePayload.topics.find((topic) => topic.topicId === "topic-5")?.attemptedQuestions,
    ).toBeGreaterThan(0);

    const forged = await GET(
      new Request(
        `http://localhost:3000/api/progress?topicId=topic-5&learnerId=${encodeURIComponent(STUDENT_A.learnerId)}`,
        { headers: { cookie: cookieHeader(STUDENT_B) } },
      ),
    );
    expect(forged.status).toBe(200);
    const forgedPayload = (await forged.json()) as {
      topics: { topicId: string; attemptedQuestions: number }[];
    };
    expect(forgedPayload.topics.find((topic) => topic.topicId === "topic-5")?.attemptedQuestions).toBe(0);
  });

  it("匿名學習者只會看到自己的（零）進度", async () => {
    const { GET } = await import("@/app/api/progress/route");
    const response = await GET(
      new Request(`http://localhost:3000/api/progress?topicId=topic-5&learnerId=${ANONYMOUS_B}`),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      topics: { attemptedQuestions: number }[];
      skills: { attemptedQuestions: number }[];
      review: { dueItems: unknown[]; dueCount: number; dataIssues: number };
    };
    expect(payload.topics.length).toBeGreaterThan(0);
    expect(payload.topics.every((topic) => topic.attemptedQuestions === 0)).toBe(true);
    expect(payload.skills.every((skill) => skill.attemptedQuestions === 0)).toBe(true);
    expect(payload.review).toEqual({ dueItems: [], dueCount: 0, dataIssues: 0 });
    // 學生端不再提供自動建議（曾以少量作答記錄推斷弱項）
    expect(payload).not.toHaveProperty("recommendations");
  });
});
