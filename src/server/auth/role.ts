/**
 * 登入角色判定（單一事實來源）。
 *
 * 參考 ai-english-platform 的規則：
 *   AUTH_ADMIN_EMAILS 內的帳戶                                    → 管理員
 *   AUTH_TEACHER_EMAILS 內的帳戶                                  → 教師
 *   校內網域 + 學號形式（s 加 7 位數字，例如 s2024146@pochiu.edu.hk）→ 學生
 *   校內網域的其他帳號                                            → 教師
 *   非校內網域（例如 gmail.com）                                  → 學生
 *
 * 網域比對要求完整標籤，因此 `x@pochiu.edu.hk.evil.com` 會被判為學生。
 */
import { sessionUserSchema, type SessionUser, type SignInRole } from "../../lib/types";
import type { RosterStudent } from "../roster/columns";
import type { AuthConfig } from "../config";

/** 學號形式：s + 7 位數字 */
const STUDENT_LOCAL_PART = /^s\d{7}$/;

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

export function resolveSignInRole(email: string, config: AuthConfig): SignInRole {
  const normalized = normalizeEmail(email);
  if (config.adminEmails.includes(normalized)) return "admin";
  if (config.teacherEmails.includes(normalized)) return "teacher";
  if (!isSchoolDomain(normalized, config.schoolDomains)) return "student";

  const at = normalized.lastIndexOf("@");
  const localPart = normalized.slice(0, at);
  return STUDENT_LOCAL_PART.test(localPart) ? "student" : "teacher";
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
 * 教師帳戶不受名冊影響（名冊只收錄學生）。
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
