/**
 * 角色政策測試（Sprint 5–6，Priority A）。
 *
 * ── 這個檔案要處理的實際風險 ──────────────────────────────────────────
 * 「校內網域內、學號形式（s + 7 位數字）不符的帳戶一律視為教師」是 fail-open 的：
 * 只要有任何學生的帳戶是別名（例如 `chan.tai.ming@pochiu.edu.hk`）又不在學生名冊內，
 * 該帳戶就會取得**教師**權限，可讀取全部學生的練習記錄。
 *
 * **Sprint 6 起這條途徑已被移除**：角色判定只有兩個來源——`AUTH_ADMIN_EMAILS` 及
 * `AUTH_TEACHER_EMAILS`。網域本身不再授予任何教職員權限。舊變數
 * （`AUTH_IN_DOMAIN_ROLE`、`AUTH_ALLOW_LEGACY_IN_DOMAIN_TEACHER`）仍會被讀取，
 * 但只會產生 **error 級**設定警示，不再影響判定。
 *
 * 本檔驗證：政策移除後的完整判定矩陣、設定錯誤時的 fail-closed 行為、工作階段的
 * 降權／不可升權／不可篡改，以及在**真實 route handler** 上的授權結果。
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("role-policy");
process.env.LLM_PROVIDER = "mock";
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_TEACHER_EMAILS = "teacher@example.com";
process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.AUTH_REQUIRE_SIGN_IN = "true";
delete process.env.ADMIN_TOKEN;
delete process.env.K_SERVICE;

type Role = typeof import("@/server/auth/role");
type Config = typeof import("@/server/config");
type Diagnostics = typeof import("@/server/config-diagnostics");
type Session = typeof import("@/server/auth/session");
type Seed = typeof import("@/server/seed");

let role: Role;
let config: Config;
let diagnostics: Diagnostics;
let session: Session;
let seed: Seed;

/** 學號形式的學生帳戶（校內網域 + s + 7 位數字） */
const STUDENT_NUMBER_EMAIL = "s2024146@pochiu.edu.hk";
/** 別名形式的學生帳戶：校內網域但學號形式不符 */
const ALIAS_EMAIL = "chan.tai.ming@pochiu.edu.hk";
/** 另一個別名（例如學號加姓名） */
const ALIAS_WITH_NUMBER_EMAIL = "s2024147chan@pochiu.edu.hk";
const OUTSIDE_DOMAIN_EMAIL = "someone@gmail.com";
const TEACHER_EMAIL = "teacher@example.com";
const ADMIN_EMAIL = "admin@example.com";

function currentAuth() {
  return config.getServerConfig().auth;
}

/** 依目前設定判定角色（角色只來自明確名單，與名冊狀態無關） */
function roleOf(email: string) {
  return role.resolveSignInRole(email, currentAuth());
}

function issueLevel(code: string): string | null {
  return diagnostics.describeConfigIssues().find((issue) => issue.code === code)?.level ?? null;
}

function issueCodes(): string[] {
  return diagnostics.describeConfigIssues().map((issue) => issue.code);
}

/** 還原環境變數到「安全預設」狀態 */
function resetPolicy(): void {
  delete process.env.AUTH_IN_DOMAIN_ROLE;
  delete process.env.AUTH_ALLOW_LEGACY_IN_DOMAIN_TEACHER;
  process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
  process.env.AUTH_TEACHER_EMAILS = "teacher@example.com";
  process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
}

beforeAll(async () => {
  role = await import("@/server/auth/role");
  config = await import("@/server/config");
  diagnostics = await import("@/server/config-diagnostics");
  session = await import("@/server/auth/session");
  seed = await import("@/server/seed");
  seed.ensureBootstrap();
});

afterEach(() => {
  resetPolicy();
});

describe("預設政策：只有明確列在名單內的帳戶才是教職員", () => {
  it("校內網域的別名帳戶是學生，不會取得教師權限", () => {
    resetPolicy();
    expect(roleOf(ALIAS_EMAIL)).toBe("student");
    expect(roleOf(ALIAS_WITH_NUMBER_EMAIL)).toBe("student");
    expect(roleOf(STUDENT_NUMBER_EMAIL)).toBe("student");
  });

  it("校內網域判定要求完整標籤（相似網域不會被當成校內）", () => {
    resetPolicy();
    expect(roleOf("someone@pochiu.edu.hk.evil.com")).toBe("student");
    expect(role.isSchoolDomain("someone@pochiu.edu.hk.evil.com", ["pochiu.edu.hk"])).toBe(false);
    expect(role.isSchoolDomain("someone@pochiu.edu.hk", ["pochiu.edu.hk"])).toBe(true);
  });

  it("外部網域帳戶一律是學生（除非明確列入名單）", () => {
    resetPolicy();
    expect(roleOf(OUTSIDE_DOMAIN_EMAIL)).toBe("student");
  });

  it("明確列入名單的教師及管理員不受網域影響", () => {
    resetPolicy();
    expect(roleOf(TEACHER_EMAIL)).toBe("teacher");
    expect(roleOf(ADMIN_EMAIL)).toBe("admin");
    // 即使該帳戶是校內網域，名單仍然優先
    process.env.AUTH_TEACHER_EMAILS = "history.teacher@pochiu.edu.hk";
    expect(roleOf("history.teacher@pochiu.edu.hk")).toBe("teacher");
    // 大小寫及前後空白不影響（以目前名單內的帳戶驗證）
    expect(roleOf("  History.Teacher@Pochiu.EDU.HK  ")).toBe("teacher");
  });

  it("未設定教師名單時只有 warning（管理員仍可運作）", () => {
    resetPolicy();
    delete process.env.AUTH_TEACHER_EMAILS;
    expect(issueLevel("auth-no-teachers-configured")).toBe("warning");
    expect(roleOf(ADMIN_EMAIL)).toBe("admin");
    expect(roleOf(ALIAS_EMAIL)).toBe("student");
  });
});

describe("舊的「校內網域 = 教師」政策已移除", () => {
  it("設定 AUTH_IN_DOMAIN_ROLE=teacher 不再授予教師權限，並產生 error 級警示", () => {
    resetPolicy();
    process.env.AUTH_IN_DOMAIN_ROLE = "teacher";

    // 本測試檔最重要的斷言：舊設定已無效，別名帳戶不會變成教師
    expect(currentAuth().legacyInDomainTeacherConfigured).toBe(true);
    expect(currentAuth().inDomainRole).toBe("student");
    expect(roleOf(ALIAS_EMAIL)).toBe("student");
    expect(roleOf(ALIAS_WITH_NUMBER_EMAIL)).toBe("student");

    expect(issueCodes()).toContain("auth-legacy-in-domain-teacher-removed");
    expect(issueLevel("auth-legacy-in-domain-teacher-removed")).toBe("error");
  });

  it("即使用舊的確認旗標，仍然不會授予教師權限", () => {
    resetPolicy();
    process.env.AUTH_IN_DOMAIN_ROLE = "teacher";
    process.env.AUTH_ALLOW_LEGACY_IN_DOMAIN_TEACHER = "true";
    expect(roleOf(ALIAS_EMAIL)).toBe("student");
    expect(issueLevel("auth-legacy-in-domain-teacher-removed")).toBe("error");
  });

  it("只設定確認旗標（沒有 AUTH_IN_DOMAIN_ROLE）同樣不會授予權限", () => {
    resetPolicy();
    process.env.AUTH_ALLOW_LEGACY_IN_DOMAIN_TEACHER = "true";
    expect(currentAuth().legacyInDomainTeacherConfigured).toBe(true);
    expect(roleOf(ALIAS_EMAIL)).toBe("student");
    expect(issueLevel("auth-legacy-in-domain-teacher-removed")).toBe("error");
  });

  it("舊設定不會影響明確列入名單的教師（名單仍然是唯一途徑）", () => {
    resetPolicy();
    process.env.AUTH_IN_DOMAIN_ROLE = "teacher";
    process.env.AUTH_ALLOW_LEGACY_IN_DOMAIN_TEACHER = "true";
    process.env.AUTH_TEACHER_EMAILS = "history.teacher@pochiu.edu.hk;teacher@example.com";
    expect(roleOf("history.teacher@pochiu.edu.hk")).toBe("teacher");
    expect(roleOf(TEACHER_EMAIL)).toBe("teacher");
    // 未列入名單的校內帳戶仍然是學生
    expect(roleOf(ALIAS_EMAIL)).toBe("student");
  });

  it("設定拼錯或空白時一律當作學生（fail-closed）", () => {
    resetPolicy();
    for (const value of ["teachr", "true", "  ", "1", "STAFF"]) {
      process.env.AUTH_IN_DOMAIN_ROLE = value;
      expect(roleOf(ALIAS_EMAIL), `AUTH_IN_DOMAIN_ROLE=${value}`).toBe("student");
    }
  });

  it("舊設定移除後不再有警示（避免永久噪音）", () => {
    resetPolicy();
    expect(issueCodes()).not.toContain("auth-legacy-in-domain-teacher-removed");
    expect(issueCodes()).not.toContain("auth-broad-school-domain");
  });

  it("學號形式的判讀只作顯示用途，不影響角色", () => {
    resetPolicy();
    expect(role.looksLikeStudentNumber(STUDENT_NUMBER_EMAIL)).toBe(true);
    expect(role.looksLikeStudentNumber(ALIAS_EMAIL)).toBe(false);
    expect(role.looksLikeStudentNumber("not-an-email")).toBe(false);
    // 兩者都是學生（角色只由名單決定）
    expect(roleOf(STUDENT_NUMBER_EMAIL)).toBe("student");
    expect(roleOf(ALIAS_EMAIL)).toBe("student");
  });
});

describe("工作階段角色：降權即時生效、不可升權、不可篡改", () => {
  const sessionUser = (roleName: "student" | "teacher" | "admin", email: string) => ({
    email,
    name: "測試",
    role: roleName,
    learnerId: role.learnerIdForUser(email, roleName),
    pictureUrl: null,
    studentNumber: null,
    className: null,
    rosterVerified: false,
  });

  it("別名帳戶的舊「教師」工作階段立即被降為學生（即使舊政策仍設定）", () => {
    resetPolicy();
    process.env.AUTH_IN_DOMAIN_ROLE = "teacher";
    process.env.AUTH_ALLOW_LEGACY_IN_DOMAIN_TEACHER = "true";

    const stale = sessionUser("teacher", ALIAS_EMAIL);
    const revalidated = role.revalidateSessionUser(stale, currentAuth());
    expect(revalidated.role).toBe("student");
    expect(revalidated.learnerId).toBe(`school:${ALIAS_EMAIL}`);
  });

  it("把教師移出 AUTH_TEACHER_EMAILS 後，現有工作階段立即降為學生", () => {
    resetPolicy();
    const teacherSession = sessionUser("teacher", TEACHER_EMAIL);
    // 先確認仍是教師
    expect(role.revalidateSessionUser(teacherSession, currentAuth()).role).toBe("teacher");

    process.env.AUTH_TEACHER_EMAILS = "someone-else@example.com";
    const revoked = role.revalidateSessionUser(teacherSession, currentAuth());
    expect(revoked.role).toBe("student");
    expect(revoked.learnerId.startsWith("school:")).toBe(true);
  });

  it("把帳戶移出管理員名單後，現有管理員工作階段立即降為學生", () => {
    resetPolicy();
    const adminSession = sessionUser("admin", "removed-admin@example.com");
    const revalidated = role.revalidateSessionUser(adminSession, currentAuth());
    expect(revalidated.role).toBe("student");
    expect(revalidated.learnerId.startsWith("school:")).toBe(true);
  });

  it("學生工作階段不會因為設定改變而被升為教師（升權需重新登入）", () => {
    resetPolicy();
    process.env.AUTH_TEACHER_EMAILS = "someone@example.com";
    const studentSession = sessionUser("student", ALIAS_EMAIL);
    // 即使之後把該帳戶加入教師名單，舊 cookie 仍然是學生
    process.env.AUTH_TEACHER_EMAILS = `someone@example.com,${ALIAS_EMAIL}`;
    const revalidated = role.revalidateSessionUser(studentSession, currentAuth());
    expect(revalidated.role).toBe("student");
  });

  it("新增教師名單後，新登入的帳戶才取得教師身分", () => {
    resetPolicy();
    process.env.AUTH_TEACHER_EMAILS = `teacher@example.com,${ALIAS_EMAIL}`;
    // buildSessionUser 代表「重新登入」時的判定
    const built = role.buildSessionUser(
      { email: ALIAS_EMAIL, name: "測試", pictureUrl: null },
      currentAuth(),
    );
    expect(built.role).toBe("teacher");
    expect(built.learnerId).toBe(`teacher:${ALIAS_EMAIL}`);
  });

  it("篡改 cookie 內的角色會令簽章失效（工作階段無效）", () => {
    resetPolicy();
    const token = session.encodeSession(sessionUser("student", STUDENT_NUMBER_EMAIL));
    const tampered = `${token.slice(0, 10)}X${token.slice(11)}`;
    expect(session.decodeSession(tampered)).toBeNull();
  });

  it("不同角色的學習者 ID 前綴不同（記錄不會混用）", () => {
    resetPolicy();
    expect(role.learnerIdForUser(STUDENT_NUMBER_EMAIL, "student")).toBe(
      `school:${STUDENT_NUMBER_EMAIL}`,
    );
    expect(role.learnerIdForUser(TEACHER_EMAIL, "teacher")).toBe(`teacher:${TEACHER_EMAIL}`);
    expect(role.learnerIdForUser(ADMIN_EMAIL, "admin")).toBe(`admin:${ADMIN_EMAIL}`);
  });
});

describe("員工端點：政策決定誰能通過（以真實 route handler 驗證）", () => {
  const asUser = (roleName: "student" | "teacher" | "admin", email: string) => ({
    email,
    name: "測試",
    role: roleName,
    learnerId: role.learnerIdForUser(email, roleName),
    pictureUrl: null,
    studentNumber: null,
    className: null,
    rosterVerified: false,
  });

  function cookieFor(user: ReturnType<typeof asUser>): string {
    return `hk-history-session=${encodeURIComponent(session.encodeSession(user))}`;
  }

  async function callTeacher(cookie?: string): Promise<Response> {
    const route = await import("@/app/api/teacher/overview/route");
    return route.GET(
      new Request("http://localhost:3000/api/teacher/overview", {
        headers: cookie ? { cookie } : {},
      }),
    );
  }

  async function callAdmin(cookie?: string): Promise<Response> {
    const route = await import("@/app/api/admin/system/overview/route");
    return route.GET(
      new Request("http://localhost:3000/api/admin/system/overview", {
        headers: cookie ? { cookie } : {},
      }),
    );
  }

  it("未登入不可讀取教師端或管理員端（401）", async () => {
    resetPolicy();
    expect((await callTeacher()).status).toBe(401);
    expect((await callAdmin()).status).toBe(401);
  });

  it("學生（含別名帳戶）不可讀取教師端或管理員端（403），即使舊政策仍設定", async () => {
    resetPolicy();
    process.env.AUTH_IN_DOMAIN_ROLE = "teacher";

    for (const email of [STUDENT_NUMBER_EMAIL, ALIAS_EMAIL, ALIAS_WITH_NUMBER_EMAIL]) {
      const cookie = cookieFor(asUser("student", email));
      expect((await callTeacher(cookie)).status, `teacher route / ${email}`).toBe(403);
      expect((await callAdmin(cookie)).status, `admin route / ${email}`).toBe(403);
    }
  });

  it("名列教師可以使用教師端，但不能使用管理員端", async () => {
    resetPolicy();
    const cookie = cookieFor(asUser("teacher", TEACHER_EMAIL));
    expect((await callTeacher(cookie)).status).toBe(200);
    expect((await callAdmin(cookie)).status).toBe(403);
  });

  it("管理員可以使用教師端及管理員端", async () => {
    resetPolicy();
    const cookie = cookieFor(asUser("admin", ADMIN_EMAIL));
    expect((await callTeacher(cookie)).status).toBe(200);
    expect((await callAdmin(cookie)).status).toBe(200);
  });

  it("已從教師名單移除的工作階段即時失效（403）", async () => {
    resetPolicy();
    const cookie = cookieFor(asUser("teacher", "removed-teacher@example.com"));
    expect((await callTeacher(cookie)).status).toBe(403);
  });

  it("未登入不可覆核題目或發布題目（401）", async () => {
    resetPolicy();
    const review = await import("@/app/api/teacher/questions/[questionId]/review/route");
    const anonymous = await review.POST(
      new Request("http://localhost:3000/api/teacher/questions/q1/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "approved" }),
      }),
      { params: Promise.resolve({ questionId: "q1" }) },
    );
    expect(anonymous.status).toBe(401);

    const { PATCH } = await import("@/app/api/teacher/questions/[questionId]/route");
    const publish = await PATCH(
      new Request("http://localhost:3000/api/teacher/questions/q1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "status", status: "published" }),
      }),
      { params: Promise.resolve({ questionId: "q1" }) },
    );
    expect(publish.status).toBe(401);
  });

  it("學生不可覆核或發布題目（403）", async () => {
    resetPolicy();
    const cookie = cookieFor(asUser("student", ALIAS_EMAIL));
    const review = await import("@/app/api/teacher/questions/[questionId]/review/route");
    const asStudent = await review.POST(
      new Request("http://localhost:3000/api/teacher/questions/q1/review", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ decision: "approved" }),
      }),
      { params: Promise.resolve({ questionId: "q1" }) },
    );
    expect(asStudent.status).toBe(403);
  });
});
