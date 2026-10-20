/**
 * 負向授權測試：逐一檢查每一個特權路由，而不只是抽樣。
 *
 * 每個特權路由都會以四種身分呼叫：
 *   1. 未登入（沒有 cookie）→ 401
 *   2. 學生 → 403
 *   3. 教師 → 管理員專用路由 403，其餘可通過（不會是 401／403）
 *   4. 管理員 → 可通過
 *
 * 另外驗證：
 *   - 偽造／過期的 cookie 不能取得特權（角色一律由伺服器端設定重新判定）。
 *   - 把帳號移出 AUTH_ADMIN_EMAILS 後，現有的管理員 cookie 立即失效。
 *   - ADMIN_TOKEN 只在長度足夠時有效；以固定時間比較，未提供或長度不足皆不可通過。
 *   - 損毀的 cookie 不會造成 500。
 *   - 登入後導向不會被利用作開放式轉址（含反斜線寫法）。
 *   - 匯出的 CSV 不會被試算表當成公式執行（CSV 公式注入）。
 *   - Cloud Run 上未啟用登入時，後台頁面不會渲染。
 */
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("authz-negative");
process.env.LLM_PROVIDER = "mock";
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_TEACHER_EMAILS = "teacher@example.com";
process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
// 歷史科內容審核者名單（Sprint 12）：Golden 裁決需要學科授權，教師在此名單內。
process.env.HISTORY_REVIEWER_EMAILS = "teacher@example.com";
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
delete process.env.ADMIN_TOKEN;
delete process.env.K_SERVICE;
delete process.env.HISTORY_ALLOW_UNSAFE_DEMO_MODE;

type SessionModule = typeof import("@/server/auth/session");
type SeedModule = typeof import("@/server/seed");

let session: SessionModule;
let seed: SeedModule;

/** 測試用身分（電郵必須與上面的設定一致，否則會被重新判定為學生） */
const STUDENT_USER = {
  email: "s2024146@pochiu.edu.hk",
  name: "測試學生",
  role: "student" as const,
  learnerId: "school:s2024146@pochiu.edu.hk",
  pictureUrl: null,
};
const OTHER_STUDENT_USER = {
  email: "s2024152@pochiu.edu.hk",
  name: "另一名學生",
  role: "student" as const,
  learnerId: "school:s2024152@pochiu.edu.hk",
  pictureUrl: null,
};
const TEACHER_USER = {
  email: "teacher@example.com",
  name: "測試教師",
  role: "teacher" as const,
  learnerId: "teacher:teacher@example.com",
  pictureUrl: null,
};
const ADMIN_USER = {
  email: "admin@example.com",
  name: "測試管理員",
  role: "admin" as const,
  learnerId: "admin:admin@example.com",
  pictureUrl: null,
};

type TestUser =
  | typeof STUDENT_USER
  | typeof OTHER_STUDENT_USER
  | typeof TEACHER_USER
  | typeof ADMIN_USER;

function cookieHeader(user: TestUser): string {
  return `hk-history-session=${encodeURIComponent(session.encodeSession(user))}`;
}

interface RouteCase {
  /** 例如 "GET /api/teacher/overview" */
  target: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** 只限管理員的路由 */
  adminOnly: boolean;
  /**
   * 管理員是否也可通過（預設 true）。
   * Sprint 12：Golden fixture 裁決需要歷史科學科授權（`HISTORY_REVIEWER_EMAILS`），
   * 平台 admin 角色不足，因此該路由設為 false。
   */
  adminAllowed?: boolean;
  load: () => Promise<unknown>;
  /** 動態路由參數（一律用不存在的 ID，避免測試改動資料） */
  params?: Record<string, string>;
  body?: unknown;
}

const ROUTES: RouteCase[] = [
  {
    target: "GET /api/teacher/overview",
    method: "GET",
    adminOnly: false,
    load: () => import("@/app/api/teacher/overview/route"),
  },
  {
    target: "GET /api/teacher/questions",
    method: "GET",
    adminOnly: false,
    load: () => import("@/app/api/teacher/questions/route"),
  },
  {
    target: "POST /api/teacher/questions",
    method: "POST",
    adminOnly: false,
    load: () => import("@/app/api/teacher/questions/route"),
  },
  {
    target: "POST /api/teacher/questions/generate",
    method: "POST",
    adminOnly: false,
    load: () => import("@/app/api/teacher/questions/generate/route"),
  },
  {
    target: "PATCH /api/teacher/questions/[questionId]",
    method: "PATCH",
    adminOnly: false,
    load: () => import("@/app/api/teacher/questions/[questionId]/route"),
    params: { questionId: "missing-question" },
    body: { action: "status", status: "published" },
  },
  {
    target: "GET /api/teacher/questions/[questionId]/review",
    method: "GET",
    adminOnly: false,
    load: () => import("@/app/api/teacher/questions/[questionId]/review/route"),
    params: { questionId: "missing-question" },
  },
  {
    target: "POST /api/teacher/questions/[questionId]/review",
    method: "POST",
    adminOnly: false,
    load: () => import("@/app/api/teacher/questions/[questionId]/review/route"),
    params: { questionId: "missing-question" },
    body: { decision: "approved" },
  },
  {
    target: "POST /api/teacher/questions/[questionId]/servability",
    method: "POST",
    adminOnly: false,
    load: () => import("@/app/api/teacher/questions/[questionId]/servability/route"),
    params: { questionId: "missing-question" },
    body: { decision: "return_to_draft", reason: "測試用理由", expectedRevision: 1 },
  },
  {
    target: "GET /api/teacher/golden",
    method: "GET",
    adminOnly: false,
    load: () => import("@/app/api/teacher/golden/route"),
  },
  {
    target: "GET /api/teacher/review-queue",
    method: "GET",
    adminOnly: false,
    load: () => import("@/app/api/teacher/review-queue/route"),
  },
  {
    target: "GET /api/teacher/content-improvement",
    method: "GET",
    adminOnly: false,
    load: () => import("@/app/api/teacher/content-improvement/route"),
  },
  {
    target: "POST /api/teacher/content-improvement",
    method: "POST",
    adminOnly: false,
    load: () => import("@/app/api/teacher/content-improvement/route"),
    body: {
      flag: "explanation_needs_rewrite",
      action: "mark",
      questionIds: ["missing-question"],
      reason: "測試用理由",
    },
  },
  {
    target: "POST /api/teacher/golden/[questionId]",
    method: "POST",
    adminOnly: false,
    adminAllowed: false,
    load: () => import("@/app/api/teacher/golden/[questionId]/route"),
    params: { questionId: "missing-question" },
    body: { decision: "rejected", reason: "測試用理由", expectedRevision: 1 },
  },
  {
    target: "DELETE /api/teacher/questions/[questionId]",
    method: "DELETE",
    adminOnly: false,
    load: () => import("@/app/api/teacher/questions/[questionId]/route"),
    params: { questionId: "missing-question" },
  },
  {
    target: "GET /api/teacher/records",
    method: "GET",
    adminOnly: false,
    load: () => import("@/app/api/teacher/records/route"),
  },
  {
    target: "GET /api/teacher/records/export",
    method: "GET",
    adminOnly: false,
    load: () => import("@/app/api/teacher/records/export/route"),
  },
  {
    target: "GET /api/teacher/reports",
    method: "GET",
    adminOnly: false,
    load: () => import("@/app/api/teacher/reports/route"),
  },
  {
    target: "PATCH /api/teacher/reports",
    method: "PATCH",
    adminOnly: false,
    load: () => import("@/app/api/teacher/reports/route"),
    body: { reportId: "missing-report", status: "resolved" },
  },
  {
    target: "POST /api/health（後台系統資訊）",
    method: "POST",
    adminOnly: false,
    load: () => import("@/app/api/health/route"),
  },
  {
    target: "GET /api/admin/materials",
    method: "GET",
    adminOnly: true,
    load: () => import("@/app/api/admin/materials/route"),
  },
  {
    target: "POST /api/admin/materials",
    method: "POST",
    adminOnly: true,
    load: () => import("@/app/api/admin/materials/route"),
  },
  {
    target: "GET /api/admin/materials/import",
    method: "GET",
    adminOnly: true,
    load: () => import("@/app/api/admin/materials/import/route"),
  },
  {
    target: "POST /api/admin/materials/import",
    method: "POST",
    adminOnly: true,
    load: () => import("@/app/api/admin/materials/import/route"),
    body: { fileName: "missing.docx" },
  },
  {
    target: "GET /api/admin/materials/[documentId]",
    method: "GET",
    adminOnly: true,
    load: () => import("@/app/api/admin/materials/[documentId]/route"),
    params: { documentId: "missing-document" },
  },
  {
    target: "PATCH /api/admin/materials/[documentId]",
    method: "PATCH",
    adminOnly: true,
    load: () => import("@/app/api/admin/materials/[documentId]/route"),
    params: { documentId: "missing-document" },
    body: { published: true },
  },
  {
    target: "DELETE /api/admin/materials/[documentId]",
    method: "DELETE",
    adminOnly: true,
    load: () => import("@/app/api/admin/materials/[documentId]/route"),
    params: { documentId: "missing-document" },
  },
  {
    target: "GET /api/admin/materials/[documentId]/ocr",
    method: "GET",
    adminOnly: true,
    load: () => import("@/app/api/admin/materials/[documentId]/ocr/route"),
    params: { documentId: "missing-document" },
  },
  {
    target: "POST /api/admin/materials/[documentId]/ocr",
    method: "POST",
    adminOnly: true,
    load: () => import("@/app/api/admin/materials/[documentId]/ocr/route"),
    params: { documentId: "missing-document" },
    body: {},
  },
  {
    target: "PATCH /api/admin/materials/blocks/[blockId]",
    method: "PATCH",
    adminOnly: true,
    load: () => import("@/app/api/admin/materials/blocks/[blockId]/route"),
    params: { blockId: "missing-block" },
    body: { text: "內容" },
  },
  {
    target: "PATCH /api/admin/sections/[sectionId]",
    method: "PATCH",
    adminOnly: true,
    load: () => import("@/app/api/admin/sections/[sectionId]/route"),
    params: { sectionId: "missing-section" },
    body: { published: true },
  },
  {
    target: "PATCH /api/admin/topics/[topicId]",
    method: "PATCH",
    adminOnly: true,
    load: () => import("@/app/api/admin/topics/[topicId]/route"),
    params: { topicId: "missing-topic" },
    body: { published: true },
  },
  {
    target: "GET /api/admin/system/health",
    method: "GET",
    adminOnly: true,
    load: () => import("@/app/api/admin/system/health/route"),
  },
  {
    target: "GET /api/admin/system/overview",
    method: "GET",
    adminOnly: true,
    load: () => import("@/app/api/admin/system/overview/route"),
  },
];

/** route handler 的實際簽名（動態路由的 params 各不相同，這裡只取共通部分） */
type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;

function buildRequest(route: RouteCase, init: { cookie?: string; token?: string } = {}): Request {
  return new Request(`http://localhost:3000${route.target.replace(/^[A-Z]+ /, "")}`, {
    method: route.method,
    headers: {
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...(init.token ? { "x-admin-token": init.token } : {}),
      ...(route.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: route.body !== undefined ? JSON.stringify(route.body) : undefined,
  });
}

async function call(route: RouteCase, request: Request): Promise<Response> {
  const loaded = (await route.load()) as Record<string, unknown>;
  const handler = loaded[route.method] as unknown as RouteHandler;
  return handler(request, { params: Promise.resolve(route.params ?? {}) });
}

/** 可通過授權檢查（後續的 400／404 等不屬於授權問題） */
function isAuthorized(response: Response): boolean {
  return response.status !== 401 && response.status !== 403;
}

beforeAll(async () => {
  session = await import("@/server/auth/session");
  seed = await import("@/server/seed");
  seed.ensureBootstrap();
});

describe("負向授權：每一個特權路由", () => {
  for (const route of ROUTES) {
    describe(route.target, () => {
      it("未登入會被拒絕（401）", async () => {
        const response = await call(route, buildRequest(route));
        expect(response.status).toBe(401);
      });

      it("學生會被拒絕（403）", async () => {
        const response = await call(route, buildRequest(route, { cookie: cookieHeader(STUDENT_USER) }));
        expect(response.status).toBe(403);
      });

      it(route.adminOnly ? "教師會被拒絕（403）" : "教師可以使用", async () => {
        const response = await call(route, buildRequest(route, { cookie: cookieHeader(TEACHER_USER) }));
        if (route.adminOnly) {
          expect(response.status).toBe(403);
        } else {
          expect(isAuthorized(response)).toBe(true);
        }
      });

      it(route.adminAllowed === false ? "管理員被學科授權拒絕（403）" : "管理員可以使用", async () => {
        const response = await call(route, buildRequest(route, { cookie: cookieHeader(ADMIN_USER) }));
        if (route.adminAllowed === false) {
          expect(response.status).toBe(403);
        } else {
          expect(isAuthorized(response)).toBe(true);
        }
      });
    });
  }
});

/**
 * 暫時的全校教職員政策（Sprint 7.2）：`AUTH_STAFF_ACCESS_POLICY=school-domain` 時，
 * `AUTH_STAFF_DOMAINS` 所列網域的非學號形式帳戶可通過教師端，但不可通過管理員端；
 * 停用後同一個 cookie 立即被拒絕。
 */
describe("暫時的全校教職員政策（school-domain）在真實路由上的效果", () => {
  const STAFF_EMAIL = "staff.member@pochiu.edu.hk";
  const STAFF_USER = {
    email: STAFF_EMAIL,
    name: "校內職員",
    role: "teacher" as const,
    learnerId: `teacher:${STAFF_EMAIL}`,
    pictureUrl: null,
  };

  async function callOverview(cookie?: string): Promise<Response> {
    const { GET } = await import("@/app/api/teacher/overview/route");
    return GET(
      new Request("http://localhost:3000/api/teacher/overview", {
        headers: cookie ? { cookie } : {},
      }),
    ) as Promise<Response>;
  }

  async function callAdminOverview(cookie?: string): Promise<Response> {
    const { GET } = await import("@/app/api/admin/system/overview/route");
    return GET(
      new Request("http://localhost:3000/api/admin/system/overview", {
        headers: cookie ? { cookie } : {},
      }),
    ) as Promise<Response>;
  }

  afterEach(() => {
    delete process.env.AUTH_STAFF_ACCESS_POLICY;
    delete process.env.AUTH_STAFF_DOMAINS;
  });

  it("政策開啟：校內職員可讀取教師端，但不可讀取管理員端", async () => {
    process.env.AUTH_STAFF_ACCESS_POLICY = "school-domain";
    process.env.AUTH_STAFF_DOMAINS = "pochiu.edu.hk";
    const cookie = cookieHeader(STAFF_USER);
    expect(isAuthorized(await callOverview(cookie))).toBe(true);
    expect((await callAdminOverview(cookie)).status).toBe(403);
  });

  it("政策停用：同一個 cookie 立即被拒絕（不需等待工作階段到期）", async () => {
    process.env.AUTH_STAFF_ACCESS_POLICY = "school-domain";
    process.env.AUTH_STAFF_DOMAINS = "pochiu.edu.hk";
    const cookie = cookieHeader(STAFF_USER);
    expect(isAuthorized(await callOverview(cookie))).toBe(true);

    delete process.env.AUTH_STAFF_ACCESS_POLICY;
    expect((await callOverview(cookie)).status).toBe(403);
  });

  it("政策開啟但網域不在清單內：仍然被拒絕", async () => {
    process.env.AUTH_STAFF_ACCESS_POLICY = "school-domain";
    process.env.AUTH_STAFF_DOMAINS = "other-school.edu.hk";
    expect((await callOverview(cookieHeader(STAFF_USER))).status).toBe(403);
  });

  it("政策開啟時，學生（學號形式）仍被拒絕，也不可透過偽造 cookie 升級", async () => {
    process.env.AUTH_STAFF_ACCESS_POLICY = "school-domain";
    process.env.AUTH_STAFF_DOMAINS = "pochiu.edu.hk";
    expect((await callOverview(cookieHeader(STUDENT_USER))).status).toBe(403);
    // 偽造：把學生帳號寫成教師角色
    const forged = cookieHeader({ ...STUDENT_USER, role: "teacher" as const, learnerId: "teacher:x" });
    expect((await callOverview(forged)).status).toBe(403);
  });
});

/**
 * 這份清單是「路由清單」與「測試覆蓋」之間的契約：任何新增的 API handler 若未列在
 * 上面的特權表格（ROUTES）或下面的公開清單，測試就會失敗，避免出現沒有人測試過的
 * 特權路由。
 */
const PUBLIC_API_ROUTES = new Set([
  "GET /api/auth/google/callback",
  "GET /api/auth/google/start",
  "GET /api/auth/session",
  "POST /api/auth/sign-out",
  "GET /api/health",
  "GET /api/topics",
  "GET /api/topics/[topicId]",
  "POST /api/practice",
  "GET /api/practice/[sessionId]",
  "POST /api/practice/[sessionId]/answers",
  "POST /api/practice/[sessionId]/complete",
  "GET /api/practice/[sessionId]/result",
  "POST /api/reports",
  // 學生自己的學習進度、重溫佇列及建議（學習者身分由工作階段推導，不接受偽造）
  "GET /api/progress",
]);

/** 由檔案系統取得完整的 API 路由清單（route.ts 及其匯出的 HTTP 方法） */
function inventoryApiRoutes(): string[] {
  const apiRoot = path.resolve(process.cwd(), "src/app/api");
  const routes: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name !== "route.ts") continue;
      const source = fs.readFileSync(full, "utf8");
      const relative = path
        .relative(apiRoot, path.dirname(full))
        .split(path.sep)
        .join("/");
      // 允許 `*/export async function POST(` 這種註解與宣告同行寫法
      for (const match of source.matchAll(/\bexport (?:async )?function (GET|POST|PATCH|PUT|DELETE)\b/g)) {
        routes.push(`${match[1]} /api/${relative === "." ? "" : relative}`);
      }
    }
  };
  walk(apiRoot);
  return routes.sort();
}

function inventoryStaffPages(): { file: string; source: string }[] {
  const root = path.resolve(process.cwd(), "src/app");
  const pages: { file: string; source: string }[] = [];
  for (const area of ["teacher", "admin"]) {
    const walk = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "page.tsx") {
          pages.push({ file: path.relative(root, full).split(path.sep).join("/"), source: fs.readFileSync(full, "utf8") });
        }
      }
    };
    walk(path.join(root, area));
  }
  return pages.sort((a, b) => a.file.localeCompare(b.file));
}

describe("路由清單覆蓋（新增路由時必須先聲明身分要求）", () => {
  it("每個 API handler 都列在特權表格或公開清單內，且都有負向授權測試", () => {
    const declared = new Set([...ROUTES.map((route) => route.target.replace("（後台系統資訊）", "")), ...PUBLIC_API_ROUTES]);
    const missing = inventoryApiRoutes().filter((route) => !declared.has(route));
    expect(missing).toEqual([]);
  });

  it("特權表格與公開清單沒有列出已不存在的路由", () => {
    const actual = new Set(inventoryApiRoutes());
    const stale = [...ROUTES.map((route) => route.target.replace("（後台系統資訊）", "")), ...PUBLIC_API_ROUTES].filter(
      (route) => !actual.has(route),
    );
    expect(stale).toEqual([]);
  });

  it("每個教師端／管理員端頁面都呼叫對應的頁面守衛，或只是舊路徑導向", () => {
    const pages = inventoryStaffPages();
    expect(pages.length).toBeGreaterThan(0);

    for (const page of pages) {
      const expectedGuard = page.file.startsWith("admin/") ? "guardAdminPage" : "guardTeacherPage";
      const hasGuard = page.source.includes(expectedGuard);
      // 舊路徑的相容導向頁沒有內容，只會 redirect 到已受守衛的新路徑
      const isRedirectStub = !page.source.includes("guard") && page.source.includes("redirect(");
      expect(
        hasGuard || isRedirectStub,
        `${page.file} 必須呼叫 ${expectedGuard} 或只是導向頁`,
      ).toBe(true);
    }
  });
});

describe("練習資源的擁有權（跨學生）", () => {
  async function createStudentPractice(): Promise<{ sessionId: string; questionId: string }> {
    const { POST } = await import("@/app/api/practice/route");
    const response = await POST(
      buildRequest(
        {
          target: "POST /api/practice",
          method: "POST",
          adminOnly: false,
          load: () => import("@/app/api/practice/route"),
          body: {
            learnerId: "attacker-supplied",
            topicId: "topic-5",
            sectionIds: ["topic-5-renaissance-reformation"],
            questionTypes: ["mc"],
            difficulty: "basic",
            questionCount: 1,
          },
        },
        { cookie: cookieHeader(STUDENT_USER) },
      ),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { session: { id: string }; questions: { id: string }[] };
    return { sessionId: body.session.id, questionId: body.questions[0].id };
  }

  it("其他學生不可讀取、作答、自我檢查、完成或查看成績", async () => {
    const { sessionId, questionId } = await createStudentPractice();
    const params = Promise.resolve({ sessionId });
    const otherCookie = cookieHeader(OTHER_STUDENT_USER);

    const attempts: { label: string; run: () => Promise<Response> }[] = [
      {
        label: "GET /api/practice/[sessionId]",
        run: async () => {
          const { GET } = await import("@/app/api/practice/[sessionId]/route");
          return GET(new Request(`http://localhost:3000/api/practice/${sessionId}`, { headers: { cookie: otherCookie } }), { params });
        },
      },
      {
        label: "POST /api/practice/[sessionId]/answers",
        run: async () => {
          const { POST } = await import("@/app/api/practice/[sessionId]/answers/route");
          return POST(
            new Request(`http://localhost:3000/api/practice/${sessionId}/answers`, {
              method: "POST",
              headers: { cookie: otherCookie, "content-type": "application/json" },
              body: JSON.stringify({ learnerId: "attacker-supplied", questionId, answer: "人文主義" }),
            }),
            { params },
          );
        },
      },
      {
        label: "POST /api/practice/[sessionId]/complete",
        run: async () => {
          const { POST } = await import("@/app/api/practice/[sessionId]/complete/route");
          return POST(
            new Request(`http://localhost:3000/api/practice/${sessionId}/complete`, {
              method: "POST",
              headers: { cookie: otherCookie, "content-type": "application/json" },
              body: JSON.stringify({ learnerId: "attacker-supplied" }),
            }),
            { params },
          );
        },
      },
      {
        label: "GET /api/practice/[sessionId]/result",
        run: async () => {
          const { GET } = await import("@/app/api/practice/[sessionId]/result/route");
          return GET(new Request(`http://localhost:3000/api/practice/${sessionId}/result`, { headers: { cookie: otherCookie } }), { params });
        },
      },
    ];

    for (const attempt of attempts) {
      const response = await attempt.run();
      expect(response.status, `${attempt.label} 應拒絕其他學生`).toBe(403);
    }
  });
});

describe("學習進度及重溫（跨學生）", () => {
  /** 以指定身分完成一次練習及一次作答 */
  async function practise(
    user: typeof STUDENT_USER | typeof OTHER_STUDENT_USER,
  ): Promise<void> {
    const { POST: createPractice } = await import("@/app/api/practice/route");
    const created = await createPractice(
      new Request("http://localhost:3000/api/practice", {
        method: "POST",
        headers: { cookie: cookieHeader(user), "content-type": "application/json" },
        body: JSON.stringify({
          learnerId: "attacker-supplied",
          topicId: "topic-5",
          sectionIds: ["topic-5-renaissance-reformation"],
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
          learnerId: "attacker-supplied",
          questionId: body.questions[0].id,
          answer: "測試答案",
        }),
      }),
      { params: Promise.resolve({ sessionId: body.session.id }) },
    );
    expect(answered.status).toBe(200);
  }

  it("只回傳自己的工作階段所屬的進度（偽造 learnerId 無效）", async () => {
    const { GET } = await import("@/app/api/progress/route");
    await practise(STUDENT_USER);

    const mine = await GET(
      new Request("http://localhost:3000/api/progress?topicId=topic-5", {
        headers: { cookie: cookieHeader(STUDENT_USER) },
      }),
    );
    expect(mine.status).toBe(200);
    const minePayload = (await mine.json()) as { topics: { topicId: string; attemptedQuestions: number }[] };
    expect(
      minePayload.topics.find((topic) => topic.topicId === "topic-5")?.attemptedQuestions,
    ).toBeGreaterThan(0);

    // 另一位學生即使偽造前一位學生的學習者 ID，也只會取得自己的進度
    const forged = await GET(
      new Request(
        `http://localhost:3000/api/progress?topicId=topic-5&learnerId=${encodeURIComponent(STUDENT_USER.learnerId)}`,
        { headers: { cookie: cookieHeader(OTHER_STUDENT_USER) } },
      ),
    );
    expect(forged.status).toBe(200);
    const forgedPayload = (await forged.json()) as {
      topics: { topicId: string; attemptedQuestions: number }[];
    };
    expect(forgedPayload.topics.find((topic) => topic.topicId === "topic-5")?.attemptedQuestions).toBe(0);
  });

  it("未登入時不可讀取學習進度（401，與其他學生端 API 一致）", async () => {
    const { GET } = await import("@/app/api/progress/route");
    const response = await GET(new Request("http://localhost:3000/api/progress"));
    expect(response.status).toBe(401);
  });
});

describe("API 回應不可被快取", () => {
  it("學生端、教師端及登入狀態的回應都帶有 no-store 及 Vary: Cookie", async () => {
    const cases: { label: string; run: () => Promise<Response> }[] = [
      {
        label: "GET /api/topics",
        run: async () => {
          const { GET } = await import("@/app/api/topics/route");
          return GET(buildRequest({ target: "GET /api/topics", method: "GET", adminOnly: false, load: () => import("@/app/api/topics/route") }, { cookie: cookieHeader(STUDENT_USER) }));
        },
      },
      {
        label: "GET /api/auth/session",
        run: async () => {
          const { GET } = await import("@/app/api/auth/session/route");
          return GET();
        },
      },
      {
        label: "GET /api/teacher/records",
        run: async () => {
          const { GET } = await import("@/app/api/teacher/records/route");
          return GET(new Request("http://localhost:3000/api/teacher/records", { headers: { cookie: cookieHeader(TEACHER_USER) } }));
        },
      },
      {
        label: "GET /api/teacher/records/export（學生個人資料 CSV）",
        run: async () => {
          const { GET } = await import("@/app/api/teacher/records/export/route");
          return GET(new Request("http://localhost:3000/api/teacher/records/export", { headers: { cookie: cookieHeader(TEACHER_USER) } }));
        },
      },
    ];

    for (const item of cases) {
      const response = await item.run();
      expect(response.headers.get("cache-control"), `${item.label} 的 Cache-Control`).toContain(
        "no-store",
      );
      expect(response.headers.get("vary"), `${item.label} 的 Vary`).toContain("Cookie");
    }
  });

  it("錯誤回應同樣不可被快取（避免快取住他人的錯誤或身分資訊）", async () => {
    const response = await call(ROUTES[0], buildRequest(ROUTES[0]));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});

describe("上載大小限制會在讀取內容之前生效", () => {
  it("Content-Length 超過上限時回傳 413，不會先把整個檔案載入記憶體", async () => {
    const original = process.env.APP_MAX_UPLOAD_BYTES;
    process.env.APP_MAX_UPLOAD_BYTES = "1024";
    try {
      const { POST } = await import("@/app/api/admin/materials/route");
      // 超過 1024 位元組的上限與 64 KB 的 multipart 開銷容許值
      const oversized = "x".repeat(200 * 1024);
      const body =
        `--boundary\r\ncontent-disposition: form-data; name="file"; filename="big.docx"\r\n` +
        `content-type: application/octet-stream\r\n\r\n${oversized}\r\n--boundary--\r\n`;

      const response = await POST(
        new Request("http://localhost:3000/api/admin/materials", {
          method: "POST",
          headers: {
            cookie: cookieHeader(ADMIN_USER),
            "content-type": "multipart/form-data; boundary=boundary",
            // 真實的 HTTP 請求由瀏覽器／客戶端帶上這個標頭（Node 的 Request 不會自動補）
            "content-length": String(Buffer.byteLength(body)),
          },
          body,
        }),
      );

      expect(response.status).toBe(413);
      const payload = (await response.json()) as { error: string };
      expect(payload.error).toContain("檔案過大");
    } finally {
      if (original === undefined) delete process.env.APP_MAX_UPLOAD_BYTES;
      else process.env.APP_MAX_UPLOAD_BYTES = original;
    }
  });
});

describe("工作階段與權杖的強化", () => {
  it("偽造 cookie 把學生寫成管理員，仍會被重新判定為學生而拒絕", async () => {
    const forged = session.encodeSession({
      ...STUDENT_USER,
      role: "admin",
      learnerId: "admin:s2024146@pochiu.edu.hk",
    });
    const response = await call(ROUTES[0], buildRequest(ROUTES[0], { cookie: `hk-history-session=${forged}` }));
    expect(response.status).toBe(403);
  });

  it("把帳號移出 AUTH_ADMIN_EMAILS 後，現有管理員 cookie 立即失效", async () => {
    const cookie = cookieHeader(ADMIN_USER);
    const healthRoute = ROUTES.find((route) => route.target === "GET /api/admin/system/health") as RouteCase;
    expect(isAuthorized(await call(healthRoute, buildRequest(healthRoute, { cookie })))).toBe(true);

    const original = process.env.AUTH_ADMIN_EMAILS;
    process.env.AUTH_ADMIN_EMAILS = "";
    try {
      // 校內網域以外的帳號不再被視為教師或管理員，權限即時撤銷
      const revoked = await call(healthRoute, buildRequest(healthRoute, { cookie }));
      expect(revoked.status).toBe(403);
    } finally {
      process.env.AUTH_ADMIN_EMAILS = original;
    }
  });

  it("校內網域的別名帳戶不可透過 cookie 取得教師權限", async () => {
    // 若學生的帳戶不是 s + 7 位數字（別名），舊行為會把他當成教師
    const aliasUser = {
      email: "s2024146.chan@pochiu.edu.hk",
      name: "測試學生",
      role: "teacher" as const,
      learnerId: "teacher:s2024146.chan@pochiu.edu.hk",
      pictureUrl: null,
    };
    const response = await call(
      ROUTES[0],
      buildRequest(ROUTES[0], { cookie: cookieHeader(aliasUser) }),
    );
    expect(response.status).toBe(403);
  });

  it("讀取工作階段時（不限於 API 守衛）都會以目前設定重新判定角色", () => {
    const token = session.encodeSession(ADMIN_USER);
    const original = process.env.AUTH_ADMIN_EMAILS;
    try {
      expect(session.decodeSession(token)?.role).toBe("admin");
      expect(session.decodeSession(token)?.learnerId).toBe("admin:admin@example.com");

      process.env.AUTH_ADMIN_EMAILS = "";
      const revoked = session.decodeSession(token);
      expect(revoked?.role).toBe("student");
      expect(revoked?.learnerId).toBe("school:admin@example.com");
    } finally {
      process.env.AUTH_ADMIN_EMAILS = original;
    }
  });

  it("損毀的 cookie 會被視為未登入（401），不會變成 500", async () => {
    const response = await call(ROUTES[0], buildRequest(ROUTES[0], { cookie: "hk-history-session=%" }));
    expect(response.status).toBe(401);
  });

  it("ADMIN_TOKEN 需具備足夠長度，過短一律不接受", async () => {
    const originalToken = process.env.ADMIN_TOKEN;
    const originalClientId = process.env.GOOGLE_CLIENT_ID;
    const originalClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    process.env.ADMIN_TOKEN = "too-short";
    try {
      // 已啟用登入時：過短的權杖不會被接受（等同未登入）
      const withAuth = await call(ROUTES[0], buildRequest(ROUTES[0], { token: "too-short" }));
      expect(withAuth.status).toBe(401);

      // 未啟用登入時：設定失誤會以明確訊息告知，而不是靜靜變成開放
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      const withoutAuth = await call(ROUTES[0], buildRequest(ROUTES[0], { token: "too-short" }));
      expect(withoutAuth.status).toBe(401);
      const body = (await withoutAuth.json()) as { error: string };
      expect(body.error).toContain("長度不足");
    } finally {
      if (originalToken === undefined) delete process.env.ADMIN_TOKEN;
      else process.env.ADMIN_TOKEN = originalToken;
      if (originalClientId !== undefined) process.env.GOOGLE_CLIENT_ID = originalClientId;
      if (originalClientSecret !== undefined) process.env.GOOGLE_CLIENT_SECRET = originalClientSecret;
    }
  });

  it("長度足夠的 ADMIN_TOKEN 可用於自動化，錯誤的權杖不可", async () => {
    const token = "0123456789abcdef0123456789abcdef";
    const original = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = token;
    try {
      const accepted = await call(ROUTES[0], buildRequest(ROUTES[0], { token }));
      expect(isAuthorized(accepted)).toBe(true);

      const rejected = await call(ROUTES[0], buildRequest(ROUTES[0], { token: `${token}x` }));
      expect(rejected.status).toBe(401);
    } finally {
      if (original === undefined) delete process.env.ADMIN_TOKEN;
      else process.env.ADMIN_TOKEN = original;
    }
  });
});

describe("登入導向不可被利用作開放式轉址", () => {
  it("safeNextPath 只接受站內路徑（含反斜線的寫法一律拒絕）", async () => {
    const { safeNextPath } = await import("@/server/auth/redirect");
    expect(safeNextPath("/teacher/questions")).toBe("/teacher/questions");
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath("//evil.example.com")).toBe("/");
    expect(safeNextPath("/\\evil.example.com")).toBe("/");
    expect(safeNextPath("https://evil.example.com")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
  });

  it("publicUrl 解析後離開本站時退回網站首頁", async () => {
    const { publicUrl } = await import("@/server/auth/google");
    const request = new Request("https://school.example.hk/api/auth/google/start");
    expect(publicUrl(request, "/teacher").href).toBe("https://school.example.hk/teacher");
    expect(publicUrl(request, "/\\evil.example.com").href).toBe("https://school.example.hk/");
  });

  it("start 路由不會把反斜線路徑寫入 OAuth 狀態 cookie", async () => {
    const { GET } = await import("@/app/api/auth/google/start/route");
    const { decodeOAuthState, OAUTH_COOKIE } = await import("@/server/auth/session");

    const response = await GET(
      new Request("https://school.example.hk/api/auth/google/start?next=%2F%5Cevil.example.com"),
    );
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(OAUTH_COOKIE);

    const value = decodeURIComponent(
      (setCookie.split(";")[0] as string).slice(`${OAUTH_COOKIE}=`.length),
    );
    expect(decodeOAuthState(value)?.next).toBe("/");
  });
});

describe("匯出的 CSV 不會被試算表執行公式", () => {
  it("以 =、+、-、@ 起首的學生答案會被加上前置單引號", async () => {
    const { buildRecordsCsv } = await import("@/server/services/practice-records");

    const records = [
      {
        sessionId: "s1",
        learnerId: "school:s1@pochiu.edu.hk",
        learnerLabel: "1A（01）",
        topicId: "topic-5",
        topicTitle: "課題5",
        createdAt: "2026-01-01T00:00:00.000Z",
        completedAt: null,
        questionTypes: ["fill"],
        questionTypeLabels: ["填充題"],
        difficulty: "basic",
        difficultyLabel: "基礎",
        totalQuestions: 1,
        answeredCount: 1,
        correctCount: 0,
        wrongCount: 1,
        accuracy: 0,
        questions: [
          {
            questionId: "q1",
            questionType: "fill",
            questionTypeLabel: "填充題",
            question: "＿＿＿是文藝復興的核心思想。",
            sectionTitle: "第一節",
            studentAnswer: '=HYPERLINK("https://evil.example/","詳解")',
            correctAnswer: "人文主義",
            isCorrect: false,
            selfAssessment: null,
            aiVerdict: null,
            answered: true,
          },
        ],
      },
    ] as unknown as Parameters<typeof buildRecordsCsv>[0];

    const csv = buildRecordsCsv(records);
    const dataLine = csv.split("\r\n")[1] as string;
    expect(dataLine).toContain("'=HYPERLINK");
    // 沒有任何欄位會以公式字元開頭（引號內或行首都不會）
    for (const line of csv.split("\r\n")) {
      for (const cell of line.split(",")) {
        expect(/^"?[=+\-@\t\r]/.test(cell)).toBe(false);
      }
    }
  });
});

describe("後台頁面在公開部署環境不會渲染", () => {
  it("Cloud Run 上未啟用登入時，/admin 會導向登入頁", async () => {
    const original = {
      service: process.env.K_SERVICE,
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    };
    process.env.K_SERVICE = "history-self-study";
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    try {
      const { guardAdminPage, guardTeacherPage } = await import("@/server/auth/guards");
      for (const guard of [guardAdminPage, guardTeacherPage]) {
        await expect(guard("/admin")).rejects.toThrow();
      }
    } finally {
      if (original.service === undefined) delete process.env.K_SERVICE;
      else process.env.K_SERVICE = original.service;
      if (original.clientId !== undefined) process.env.GOOGLE_CLIENT_ID = original.clientId;
      if (original.clientSecret !== undefined) process.env.GOOGLE_CLIENT_SECRET = original.clientSecret;
    }
  });

  it("本機（非 Cloud Run）未啟用登入時仍可瀏覽後台頁面（示範模式）", async () => {
    const original = {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    };
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    try {
      const { guardAdminPage } = await import("@/server/auth/guards");
      await expect(guardAdminPage("/admin")).resolves.toBeNull();
    } finally {
      if (original.clientId !== undefined) process.env.GOOGLE_CLIENT_ID = original.clientId;
      if (original.clientSecret !== undefined) process.env.GOOGLE_CLIENT_SECRET = original.clientSecret;
    }
  });
});
