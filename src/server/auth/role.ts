/**
 * 登入角色判定（單一事實來源）。
 *
 * 判定次序：
 *   AUTH_ADMIN_EMAILS 內的帳戶                                    → 管理員
 *   AUTH_TEACHER_EMAILS 內的帳戶                                  → 教師
 *   非校內網域（例如 gmail.com）                                  → 學生
 *   學生名冊內的帳戶                                              → 學生
 *   校內網域 + 學號形式（s 加 7 位數字，例如 s2024146@pochiu.edu.hk）→ 學生
 *   校內網域的其他帳號                                             → 依 AUTH_IN_DOMAIN_ROLE
 *                                                                    （預設學生，fail-closed）
 *
 * 「校內網域的其他帳號」曾經一律視為教師，但這是一個 fail-open 的預設值：只要有任何
 * 一個學生的帳戶不是 s 加 7 位數字（別名、學號加上姓名等），該學生就會取得教師權限，
 * 可以讀取全部學生的練習記錄。因此：
 *   1. 學生名冊（若已設定）是學生身分的權威來源，名冊內的帳戶一律是學生；
 *   2. 預設（AUTH_IN_DOMAIN_ROLE 未設定）改為學生，教師必須列在 AUTH_TEACHER_EMAILS，
 *      或明確設定 AUTH_IN_DOMAIN_ROLE=teacher 承擔此風險。
 *
 * 網域比對要求完整標籤，因此 `x@pochiu.edu.hk.evil.com` 會被判為學生。
 */
import { sessionUserSchema, type SessionUser, type SignInRole } from "../../lib/types";
import type { RosterStudent } from "../roster/columns";
import type { AuthConfig } from "../config";

/** 學號形式：s + 7 位數字 */
const STUDENT_LOCAL_PART = /^s\d{7}$/;

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

export interface RoleResolutionOptions {
  /** 該電郵是否已確認在學生名冊內（名冊是學生身分的權威來源） */
  rosterStudent?: boolean;
}

/** 該電郵是否由設定明確列為教師或管理員（不受校內網域預設值影響） */
export function isExplicitStaff(email: string, config: AuthConfig): boolean {
  const normalized = normalizeEmail(email);
  return config.adminEmails.includes(normalized) || config.teacherEmails.includes(normalized);
}

export function resolveSignInRole(
  email: string,
  config: AuthConfig,
  options: RoleResolutionOptions = {},
): SignInRole {
  const normalized = normalizeEmail(email);
  if (config.adminEmails.includes(normalized)) return "admin";
  if (config.teacherEmails.includes(normalized)) return "teacher";
  if (!isSchoolDomain(normalized, config.schoolDomains)) return "student";

  // 名冊內的帳戶一律是學生：即使學號形式不符，也不可取得教師權限
  if (options.rosterStudent === true) return "student";

  const at = normalized.lastIndexOf("@");
  const localPart = normalized.slice(0, at);
  if (STUDENT_LOCAL_PART.test(localPart)) return "student";

  return config.inDomainRole === "teacher" ? "teacher" : "student";
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

export function buildSessionUser(
  profile: GoogleProfile,
  config: AuthConfig,
  options: RoleResolutionOptions = {},
): SessionUser {
  const email = normalizeEmail(profile.email);
  const role = resolveSignInRole(email, config, options);
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
 * 名冊同時是角色判定的依據：名冊內的帳戶一律是學生（見 resolveSignInRole），
 * 因此「校內網域但學號形式不符」的別名帳戶不會取得教師權限。
 * 名冊只收錄學生，因此不在名冊內的帳戶不會因此變成教師或管理員。
 */
export function buildSessionUserWithRoster(
  profile: GoogleProfile,
  config: AuthConfig,
  student: RosterStudent | null,
): SessionUser {
  const base = buildSessionUser(profile, config, { rosterStudent: student !== null });
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
