/**
 * 學生端「我的練習記錄」API。
 *
 * 契約：
 *   - 學習者身分只取自工作階段；查詢參數 `learnerId` 不能用來讀取其他學生的記錄。
 *   - 未登入（且已要求登入）時回 401。
 *   - 匯出檔同樣只包含自己的記錄。
 *   - 統計涵蓋整個查詢範圍，並非只加總清單內容。
 */
import { beforeAll, describe, expect, it } from "vitest";

import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("student-records");
process.env.LLM_PROVIDER = "mock";
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_REQUIRE_SIGN_IN = "true";
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
delete process.env.ADMIN_TOKEN;
delete process.env.K_SERVICE;
delete process.env.HISTORY_ALLOW_UNSAFE_DEMO_MODE;

type PracticeService = typeof import("@/server/services/practice-service");
type SessionModule = typeof import("@/server/auth/session");
type Seed = typeof import("@/server/seed");
type PracticeRepositories = typeof import("@/server/repositories/practice");

let practice: PracticeService;
let session: SessionModule;
let seed: Seed;
let repository: PracticeRepositories;

const STUDENT = {
  email: "s2024146@pochiu.edu.hk",
  name: "測試學生",
  role: "student" as const,
  learnerId: "school:s2024146@pochiu.edu.hk",
  pictureUrl: null,
};
const OTHER_STUDENT = {
  email: "s2024152@pochiu.edu.hk",
  name: "另一名學生",
  role: "student" as const,
  learnerId: "school:s2024152@pochiu.edu.hk",
  pictureUrl: null,
};

function cookieHeader(user: typeof STUDENT | typeof OTHER_STUDENT): string {
  return `hk-history-session=${encodeURIComponent(session.encodeSession(user))}`;
}

async function createAnsweredPractice(learnerId: string): Promise<void> {
  const created = await practice.createPractice({
    learnerId,
    topicId: "topic-5",
    sectionIds: ["topic-5-renaissance-reformation"],
    questionTypes: ["mc"],
    difficulty: "basic",
    questionCount: 1,
    mode: "standard",
    sourceSessionId: null,
  });
  const questions = repository.getSessionQuestions(created.session.id);
  await practice.submitAnswer(created.session.id, learnerId, questions[0].id, questions[0].correctAnswer);
}

beforeAll(async () => {
  practice = await import("@/server/services/practice-service");
  session = await import("@/server/auth/session");
  seed = await import("@/server/seed");
  repository = await import("@/server/repositories/practice");
  seed.ensureBootstrap();
  await createAnsweredPractice(STUDENT.learnerId);
  await createAnsweredPractice(OTHER_STUDENT.learnerId);
});

describe("GET /api/records", () => {
  it("只回傳工作階段學生的記錄，並忽略查詢參數指定的其他學習者", async () => {
    const { GET } = await import("@/app/api/records/route");
    const response = await GET(
      new Request(
        `http://localhost:3000/api/records?learnerId=${encodeURIComponent(OTHER_STUDENT.learnerId)}`,
        { headers: { cookie: cookieHeader(STUDENT) } },
      ),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      records: { learnerId: string }[];
      summary: { sessions: number; learners: number; correct: number };
      truncated: boolean;
      limit: number;
    };
    expect(payload.records.length).toBeGreaterThan(0);
    expect(payload.records.every((record) => record.learnerId === STUDENT.learnerId)).toBe(true);
    expect(payload.summary.learners).toBe(1);
    expect(payload.summary.sessions).toBe(payload.records.length);
    expect(payload.truncated).toBe(false);
    expect(payload.limit).toBe(200);
  });

  it("未登入時回 401（不可用匿名身分讀取學校帳戶記錄）", async () => {
    const { GET } = await import("@/app/api/records/route");
    const response = await GET(
      new Request(`http://localhost:3000/api/records?learnerId=${encodeURIComponent(STUDENT.learnerId)}`),
    );
    expect(response.status).toBe(401);
  });
});

describe("GET /api/records/export", () => {
  it("匯出的 CSV 只包含自己的記錄", async () => {
    const { GET } = await import("@/app/api/records/export/route");
    const response = await GET(
      new Request(
        `http://localhost:3000/api/records/export?format=csv&learnerId=${encodeURIComponent(OTHER_STUDENT.learnerId)}`,
        { headers: { cookie: cookieHeader(STUDENT) } },
      ),
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain(STUDENT.learnerId);
    expect(text).not.toContain(OTHER_STUDENT.learnerId);
    expect(response.headers.get("X-Records-Count")).toBe("1");
  });
});
