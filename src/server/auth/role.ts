/**
 * 登入角色判定（單一事實來源）。
 *
 * 判定次序：
 *   AUTH_ADMIN_EMAILS 內的帳戶                                    → 管理員
 *   AUTH_TEACHER_EMAILS 內的帳戶                                  → 教師
 *   其他所有帳戶（包括校內網域）                                   → 學生
 *
 * 「校內網域的其他帳號」曾經可以依 `AUTH_IN_DOMAIN_ROLE=teacher` 取得教師權限。那是一個
 * fail-open 的設計：只要有任何學生的帳戶不是「s 加 7 位數字」（別名、學號加姓名等），
 * 又不在學生名冊內，該學生就會取得教師權限，可讀取**全部**學生的練習記錄。
 *
 * **Sprint 6 起，網域本身不再授予任何教職員權限**：教師必須明確列在
 * `AUTH_TEACHER_EMAILS`（或列在 `AUTH_ADMIN_EMAILS`）。舊的兩個變數仍會被讀取，
 * 但只會產生 error 級設定警示，不再影響判定（見 config-diagnostics.ts）。
 *
 * 網域比對要求完整標籤，因此 `x@pochiu.edu.hk.evil.com` 會被判為學生。
 */
import { sessionUserSchema, type SessionUser, type SignInRole } from "../../lib/types";
import type { RosterStudent } from "../roster/columns";
import type { AuthConfig } from "../config";

/**
 * 學號形式：`s` 加**一或多個**數字（例如 `s2024146`、`s1234565`），大小寫不限。
 *
 * 這是校內學生帳戶的命名慣例，只按電郵本地部分（`@` 之前）比對：
 *   - `s1234565@pochiu.edu.hk` → 學號形式（學生）
 *   - `teacher.name@pochiu.edu.hk` → 非學號形式
 *
 * 學號形式**只**代表「這是學生帳戶」，不代表可以登入：名冊及強制登入規則仍然適用
 * （見 src/app/api/auth/google/callback/route.ts）。
 */
const STUDENT_LOCAL_PART = /^s\d+$/i;

/** 角色高低（只用於「降權即時生效、升權需重新登入」的比較） */
const ROLE_RANK: Record<SignInRole, number> = { student: 0, teacher: 1, admin: 2 };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
/** 取出電郵的網域部分；沒有 @ 或格式不合理時回傳 null */
export function emailDomain(email: string): string | null {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return null;
  const domain = normalized.slice(at + 1);
  return /^[a-z0-9.-]+$/.test(domain) ? domain : null;
}

export function isSchoolDomain(email: string, schoolDomains: string[]): boolean {
  const domain = emailDomain(email);
  if (domain === null) return false;
  // 完整標籤比對，避免 pochiu.edu.hk.evil.com 被誤判為校內網域
  return schoolDomains.some((candidate) => candidate === domain);
}

/** 該電郵是否由設定明確列為教師或管理員（不受校內網域影響） */
export function isExplicitStaff(email: string, config: AuthConfig): boolean {
  const normalized = normalizeEmail(email);
  return config.adminEmails.includes(normalized) || config.teacherEmails.includes(normalized);
}

/**
 * 該電郵是否為教職員身分（明確名單，或暫時校內網域政策生效時的校內教職員帳戶）。
 *
 * 用於登入流程判斷是否需要核對學生名冊：教職員不是名冊成員。學號形式一律回傳 false，
 * 因此學生帳戶永遠不會因為這個函式而略過名冊核對。
 */
export function isStaffAccount(email: string, config: AuthConfig): boolean {
  return resolveSignInRole(email, config) !== "student";
}

/**
 * 判定登入角色（伺服器端唯一來源）。
 *
 * 次序（先符合者為準）：
 *   1. `AUTH_ADMIN_EMAILS` → 管理員（明確授權，最優先）
 *   2. **學號形式**（`^s[0-9]+$`，不分大小寫）→ 學生。學號形式一律是學生，
 *      因此即使名冊核對失敗、或校內網域政策開啟，都不可能落入教師角色。
 *   3. `AUTH_TEACHER_EMAILS` → 教師（明確授權）
 *   4. `AUTH_STAFF_ACCESS_POLICY=school-domain` 且電郵網域在 `AUTH_STAFF_DOMAINS` 內
 *      （完整標籤比對）→ 教師（擁有者授權的**暫時**全校教職員政策）
 *   5. 其他一律學生
 *
 * 電郵來自伺服器端向 Google userinfo 取得的**已驗證**地址（`email_verified=true`，
 * 見 src/server/auth/google.ts），不是前端提供的字串；網域比對要求完整標籤，
 * 因此 `x@pochiu.edu.hk.evil.com` 不會被當作校內帳戶。
 */
export function resolveSignInRole(email: string, config: AuthConfig): SignInRole {
  const normalized = normalizeEmail(email);
  if (config.adminEmails.includes(normalized)) return "admin";
  // 學號形式一律學生：這是最重要的一條防線——學生帳戶不會因名冊資料缺失、
  // 網域政策開啟或設定錯誤而取得教師權限。
  if (isStudentPatternEmail(normalized)) return "student";
  if (config.teacherEmails.includes(normalized)) return "teacher";
  if (config.staffAccessPolicy === "school-domain" && isApprovedStaffDomain(normalized, config)) {
    return "teacher";
  }
  return "student";
}

/** 這是否為校內核准的教職員網域（僅在暫時政策開啟時有意義） */
export function isApprovedStaffDomain(email: string, config: AuthConfig): boolean {
  const domain = emailDomain(email);
  if (domain === null) return false;
  return config.staffDomains.some((candidate) => candidate === domain);
}

/** 學號形式的學生帳戶（供角色判定及診斷使用；不代表可以登入） */
export function isStudentPatternEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf("@");
  if (at <= 0) return false;
  return STUDENT_LOCAL_PART.test(normalized.slice(0, at));
}

/** @deprecated 使用 `isStudentPatternEmail`；保留舊名稱以避免破壞既有呼叫端 */
export function looksLikeStudentNumber(email: string): boolean {
  return isStudentPatternEmail(email);
}

/** 由電郵及角色推導穩定的學習者 ID，讓學習記錄跟隨學校帳戶。
 *
 * 教師、管理員與學生使用不同的前綴（teacher: / admin: / school:），確保三者的學習記錄
 * 不會混用，亦令教師或管理員以學生端功能測試平台時，記錄不會與任何學生重疊。
 */
export function learnerIdForUser(email: string, role: SignInRole): string {
  const normalized = normalizeEmail(email);
  const prefix = role === "teacher" ? "teacher" : role === "admin" ? "admin" : "school";
  return `${prefix}:${normalized}`;
}

/**
 * 以「目前」的設定重新判定工作階段的角色及學習者 ID。
 *
 * 工作階段是簽署過的 cookie，角色在登入時寫入並可存活 30 天。若管理員之後把某個帳號
 * 移出 AUTH_ADMIN_EMAILS／AUTH_TEACHER_EMAILS（或把新帳號加入），舊 cookie 仍帶著
 * 登入當時的角色。因此每次讀取工作階段都以目前設定重新判定角色：角色變更在重新部署後
 * 即時生效（撤銷的有效期為 0，毋須等待 cookie 到期）。
 *
 * 名冊核對資料（班別、學號）只反映登入時的名冊狀態，不會在這裡重新查核；
 * 若角色不再是學生，也會一併移除這些學生專屬欄位。
 */
export function revalidateSessionUser(user: SessionUser, config: AuthConfig): SessionUser {
  const candidate = resolveSignInRole(user.email, config);
  // 只維持或降權：升權一律要求重新登入。這樣即使重新判定時沒有名冊資料，
  // 也不可能把已登入的學生變成教師。
  const role = ROLE_RANK[candidate] <= ROLE_RANK[user.role] ? candidate : user.role;
  const learnerId = learnerIdForUser(user.email, role);
  if (role === user.role && learnerId === user.learnerId) return user;

  return sessionUserSchema.parse({
    ...user,
    role,
    learnerId,
    ...(role === "student"
      ? {}
      : { studentNumber: null, className: null, rosterVerified: false }),
  });
}

export interface GoogleProfile {
  email: string;
  name: string;
  pictureUrl: string | null;
}

export function buildSessionUser(profile: GoogleProfile, config: AuthConfig): SessionUser {
  const email = normalizeEmail(profile.email);
  const role = resolveSignInRole(email, config);
  return sessionUserSchema.parse({
    email,
    name: profile.name,
    role,
    learnerId: learnerIdForUser(email, role),
    pictureUrl: profile.pictureUrl,
  });
}

/**
 * 建立工作階段使用者，並在學生已於名冊核對時帶入班別、學號及姓名。
 *
 * 名冊只提供學生身分資料，**不影響角色判定**：名冊內的帳戶一律是學生，
 * 不在名冊內的帳戶亦不會因此變成教師或管理員（教師只來自 `AUTH_TEACHER_EMAILS`）。
 */
export function buildSessionUserWithRoster(
  profile: GoogleProfile,
  config: AuthConfig,
  student: RosterStudent | null,
): SessionUser {
  const base = buildSessionUser(profile, config);
  if (base.role !== "student" || student === null) return base;

  return sessionUserSchema.parse({
    ...base,
    // 名冊上的姓名為準（學校官方寫法），未填時沿用 Google 帳戶名稱
    name: student.name.length > 0 ? student.name : base.name,
    studentNumber: student.studentNumber.length > 0 ? student.studentNumber : null,
    className: student.className.length > 0 ? student.className : null,
    rosterVerified: true,
  });
}
