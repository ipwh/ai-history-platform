/**
 * 角色與權限測試（直接呼叫 route handler，以自製 cookie 模擬登入）。
 *
 * 驗證：
 *   1. 學生不可存取教師 API 及管理員 API（403）。
 *   2. 教師可存取教師 API、可使用學生端 API，但不可存取管理員 API（403）。
 *   3. 管理員可存取教師 API 及管理員 API。
 *   4. 已啟用登入時，未登入不可存取受保護 API（401）。
 *   5. 前端傳入的 learnerId 不可覆寫工作階段的 learnerId。
 *   6. 學生、教師及管理員使用不同的學習者身分，記錄不會混用。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("access");
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_TEACHER_EMAILS = "teacher@example.com";
process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.LLM_PROVIDER = "mock";
delete process.env.ADMIN_TOKEN;

type SessionModule = typeof import("@/server/auth/session");
type SeedModule = typeof import("@/server/seed");
type TypesModule = typeof import("@/lib/types");

let session: SessionModule;
let seed: SeedModule;
let types: TypesModule;

const STUDENT = {
  email: "s2024146@pochiu.edu.hk",
  name: "測試學生",
  role: "student" as const,
  learnerId: "school:s2024146@pochiu.edu.hk",
  pictureUrl: null,
};

const TEACHER = {
  email: "teacher@example.com",
  name: "測試教師",
  role: "teacher" as const,
  learnerId: "teacher:teacher@example.com",
  pictureUrl: null,
};

const ADMIN = {
  email: "admin@example.com",
  name: "測試管理員",
  role: "admin" as const,
  learnerId: "admin:admin@example.com",
  pictureUrl: null,
};

type TestUser = typeof STUDENT | typeof TEACHER | typeof ADMIN;

function cookieFor(user: TestUser): string {
  return `hk-history-session=${encodeURIComponent(session.encodeSession(user))}`;
}

function request(url: string, init: { method?: string; cookie?: string; body?: unknown } = {}): Request {
  return new Request(`http://localhost:3000${url}`, {
    method: init.method ?? "GET",
    headers: {
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

beforeAll(async () => {
  session = await import("@/server/auth/session");
  seed = await import("@/server/seed");
  types = await import("@/lib/types");
  seed.ensureBootstrap();
});

describe("角色與權限", () => {
  it("教師 API：學生收到 403，教師及管理員可通過", async () => {
    const { GET } = await import("@/app/api/teacher/overview/route");

    const studentResponse = await GET(request("/api/teacher/overview", { cookie: cookieFor(STUDENT) }));
    expect(studentResponse.status).toBe(403);
    const studentBody = (await studentResponse.json()) as { error: string };
    expect(studentBody.error).toContain("只限教師或管理員");

    const teacherResponse = await GET(
      request("/api/teacher/overview", { cookie: cookieFor(TEACHER) }),
    );
    expect(teacherResponse.status).toBe(200);

    const adminResponse = await GET(request("/api/teacher/overview", { cookie: cookieFor(ADMIN) }));
    expect(adminResponse.status).toBe(200);
  });

  it("管理員 API：學生及教師收到 403，管理員可通過", async () => {
    const { GET } = await import("@/app/api/admin/system/health/route");

    const studentResponse = await GET(request("/api/admin/system/health", { cookie: cookieFor(STUDENT) }));
    expect(studentResponse.status).toBe(403);

    const teacherResponse = await GET(request("/api/admin/system/health", { cookie: cookieFor(TEACHER) }));
    expect(teacherResponse.status).toBe(403);
    const teacherBody = (await teacherResponse.json()) as { error: string };
    expect(teacherBody.error).toContain("只限管理員");

    const adminResponse = await GET(request("/api/admin/system/health", { cookie: cookieFor(ADMIN) }));
    expect(adminResponse.status).toBe(200);
    const adminBody = (await adminResponse.json()) as { version: string; auth: { enabled: boolean } };
    expect(typeof adminBody.version).toBe("string");
    expect(adminBody.auth.enabled).toBe(true);
  });

  it("已啟用登入時，未登入呼叫後台 API 會收到 401", async () => {
    const teacherApi = (await import("@/app/api/teacher/overview/route")).GET;
    const adminApi = (await import("@/app/api/admin/system/health/route")).GET;
    expect((await teacherApi(request("/api/teacher/overview"))).status).toBe(401);
    expect((await adminApi(request("/api/admin/system/health"))).status).toBe(401);
  });

  it("管理員可使用教材 API（原教師端功能已改為管理員職能）", async () => {
    const { GET } = await import("@/app/api/admin/materials/route");
    const response = await GET(request("/api/admin/materials", { cookie: cookieFor(ADMIN) }));
    expect(response.status).toBe(200);
  });

  it("教師可使用學生端 API（課題清單及建立練習）", async () => {
    const { GET } = await import("@/app/api/topics/route");
    const topicsResponse = await GET(request("/api/topics", { cookie: cookieFor(TEACHER) }));
    expect(topicsResponse.status).toBe(200);
    const topicsBody = (await topicsResponse.json()) as { topics: { id: string; level: number }[] };
    expect(topicsBody.topics.length).toBeGreaterThan(0);

    // 使用示範題庫建立練習（課題5 有內建示範題）
    const { POST } = await import("@/app/api/practice/route");
    const practiceResponse = await POST(
      request("/api/practice", {
        method: "POST",
        cookie: cookieFor(TEACHER),
        body: {
          learnerId: "attacker-controlled-id",
          topicId: "topic-5",
          sectionIds: ["topic-5-renaissance-features"],
          questionTypes: ["mc"],
          difficulty: "basic",
          questionCount: 1,
        },
      }),
    );
    expect(practiceResponse.status).toBe(201);
    const practice = (await practiceResponse.json()) as {
      session: { learnerId: string };
      questions: unknown[];
    };
    // learnerId 一律由工作階段推導，前端傳來的值不會被採用
    expect(practice.session.learnerId).toBe(TEACHER.learnerId);
    expect(practice.questions.length).toBeGreaterThan(0);
  });

  it("學生的練習記錄使用 school: 身分，且教師不可讀取", async () => {
    const { POST: createPracticeRoute } = await import("@/app/api/practice/route");
    const studentPractice = await createPracticeRoute(
      request("/api/practice", {
        method: "POST",
        cookie: cookieFor(STUDENT),
        body: {
          learnerId: "another-learner",
          topicId: "topic-5",
          sectionIds: ["topic-5-renaissance-features"],
          questionTypes: ["mc"],
          difficulty: "basic",
          questionCount: 1,
        },
      }),
    );
    expect(studentPractice.status).toBe(201);
    const studentSession = (await studentPractice.json()) as { session: { id: string; learnerId: string } };
    expect(studentSession.session.learnerId).toBe(STUDENT.learnerId);

    const { GET: getPractice } = await import("@/app/api/practice/[sessionId]/route");
    const teacherRead = await getPractice(
      request(`/api/practice/${studentSession.session.id}`, { cookie: cookieFor(TEACHER) }),
      { params: Promise.resolve({ sessionId: studentSession.session.id }) },
    );
    expect(teacherRead.status).toBe(403);

    const studentRead = await getPractice(
      request(`/api/practice/${studentSession.session.id}`, { cookie: cookieFor(STUDENT) }),
      { params: Promise.resolve({ sessionId: studentSession.session.id }) },
    );
    expect(studentRead.status).toBe(200);
  });

  it("未登入時建立練習會收到 401（已啟用登入且要求登入）", async () => {
    const { POST } = await import("@/app/api/practice/route");
    const response = await POST(
      request("/api/practice", {
        method: "POST",
        body: {
          learnerId: "anonymous-id",
          topicId: "topic-5",
          sectionIds: ["topic-5-renaissance-features"],
          questionTypes: ["mc"],
          difficulty: "basic",
          questionCount: 1,
        },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("未登入時，未通過格式驗證的請求仍然是 401（不先洩漏 body 驗證細節）", async () => {
    const { POST: createPractice } = await import("@/app/api/practice/route");
    const practiceResponse = await createPractice(
      request("/api/practice", { method: "POST", body: { topicId: "topic-5" } }),
    );
    expect(practiceResponse.status).toBe(401);

    const { POST: submitReport } = await import("@/app/api/reports/route");
    const reportResponse = await submitReport(request("/api/reports", { method: "POST", body: {} }));
    expect(reportResponse.status).toBe(401);
  });

  it("在 Cloud Run 上未啟用登入時，後台 API 會被拒絕（除非明確允許示範模式）", async () => {
    const { GET } = await import("@/app/api/admin/system/health/route");
    const originalService = process.env.K_SERVICE;
    const originalClientId = process.env.GOOGLE_CLIENT_ID;
    const originalClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    process.env.K_SERVICE = "history-self-study";
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    try {
      const denied = await GET(request("/api/admin/system/health"));
      expect(denied.status).toBe(403);
      const body = (await denied.json()) as { error: string };
      expect(body.error).toContain("後台 API");

      process.env.HISTORY_ALLOW_UNSAFE_DEMO_MODE = "true";
      const allowed = await GET(request("/api/admin/system/health"));
      expect(allowed.status).toBe(200);
    } finally {
      delete process.env.HISTORY_ALLOW_UNSAFE_DEMO_MODE;
      if (originalService === undefined) delete process.env.K_SERVICE;
      else process.env.K_SERVICE = originalService;
      if (originalClientId !== undefined) process.env.GOOGLE_CLIENT_ID = originalClientId;
      if (originalClientSecret !== undefined) process.env.GOOGLE_CLIENT_SECRET = originalClientSecret;
    }
  });

  it("正式建置（next start）未設定 HISTORY_ALLOW_UNSAFE_DEMO_MODE 時，後台一律拒絕", async () => {
    const { GET } = await import("@/app/api/admin/system/health/route");
    const originalNodeEnv = process.env.NODE_ENV;
    const originalService = process.env.K_SERVICE;
    const originalClientId = process.env.GOOGLE_CLIENT_ID;
    const originalClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    // 模擬 `next start`：NODE_ENV=production，但不在 Cloud Run 上（舊行為會誤開後台）
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.K_SERVICE;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.HISTORY_ALLOW_UNSAFE_DEMO_MODE;
    try {
      const denied = await GET(request("/api/admin/system/health"));
      expect(denied.status).toBe(403);

      process.env.HISTORY_ALLOW_UNSAFE_DEMO_MODE = "true";
      const allowed = await GET(request("/api/admin/system/health"));
      expect(allowed.status).toBe(200);
    } finally {
      delete process.env.HISTORY_ALLOW_UNSAFE_DEMO_MODE;
      if (originalNodeEnv === undefined) {
        delete (process.env as Record<string, string | undefined>).NODE_ENV;
      } else {
        (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
      }
      if (originalService === undefined) delete process.env.K_SERVICE;
      else process.env.K_SERVICE = originalService;
      if (originalClientId !== undefined) process.env.GOOGLE_CLIENT_ID = originalClientId;
      if (originalClientSecret !== undefined) process.env.GOOGLE_CLIENT_SECRET = originalClientSecret;
    }
  });

  it("學習者 ID 使用角色前綴，學生、教師及管理員不會共用記錄", () => {
    expect(STUDENT.learnerId.startsWith("school:")).toBe(true);
    expect(TEACHER.learnerId.startsWith("teacher:")).toBe(true);
    expect(ADMIN.learnerId.startsWith("admin:")).toBe(true);
    expect(types.signInRoleSchema.parse(TEACHER.role)).toBe("teacher");
    expect(types.signInRoleSchema.parse(ADMIN.role)).toBe("admin");
  });
});
