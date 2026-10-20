/**
 * 集中式授權模組（單一事實來源）。
 *
 * 角色模型：
 *   - 學生（student）：只可使用學生端（課題、練習、成績、錯題重溫）及自己的學習記錄。
 *   - 教師（teacher）：可使用全部學生端功能（方便測試學生體驗），並可存取教師端
 *     （題目生成與審核、回報覆核、查看／下載學生練習記錄）。
 *   - 管理員（admin）：擁有教師的全部功能，另可存取管理員端（教材管理、OCR、
 *     分節及課題發布、系統狀態）。
 *   - 未登入（匿名示範模式，只在本機開發或示範時使用）：沿用原有的開放行為。
 *
 * 設計重點：
 *   1. 學習者 ID 一律由工作階段推導；已啟用登入時，前端傳來的 learnerId 會被忽略，
 *      因此任何使用者都無法讀取或修改他人的練習記錄。
 *   2. 學生、教師及管理員的學習者 ID 使用不同前綴（school: / teacher: / admin:），
 *      記錄不會混用。
 *   3. API 守衛優先由 Request 標頭讀取 cookie，令 route handler 可以在測試中以
 *      `new Request(url, { headers: { cookie } })` 直接驗證權限；Server Component
 *      則使用 next/headers 的 cookies()。
 *   4. 錯誤一律使用 ApiRouteError：未登入 → 401、角色不符 → 403、缺少學習者 ID → 400。
 */
import { createHash, timingSafeEqual } from "node:crypto";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import type { SessionUser } from "../../lib/types";
import { isStaffRole } from "../../lib/types";
import { getServerConfig } from "../config";
// ADMIN_TOKEN 可以繞過所有角色檢查（等同管理員），因此不接受過短的值：
// 已設定但過短的權杖一律視為無效，令設定失誤即時浮現而不是靜靜降低安全性。
import { MIN_ADMIN_TOKEN_LENGTH } from "../config-diagnostics";
import { isUnsafeDemoModeAllowed } from "../config";
import { ApiRouteError } from "../http";
import { ensureLearner } from "../repositories/learners";
import { SESSION_COOKIE, decodeSession } from "./session";

/**
 * 未登入時（匿名示範模式）可接受的學習者 ID 格式。
 *
 * 前端只會傳送自己產生的隨機 UUID（見 lib/api-client 的 getLearnerId），因此這裡
 * 一律拒絕由帳戶推導的 ID（school:／teacher:／admin:，見 auth/role.ts 的 learnerIdForUser）。
 * 否則任何未登入的人只要猜中某位學生的校內電郵，就可以用 `?learnerId=school:<電郵>`
 * 讀取該學生的練習記錄、進度及重溫佇列；同理亦可冒用教師或管理員的記錄。
 * 帳戶的學習記錄只能透過已簽署的工作階段取得。
 */
const ANONYMOUS_LEARNER_ID = /^[A-Za-z0-9._:@-]{1,128}$/;

/** 由帳戶推導的學習者 ID 前綴；未登入時不可使用（見 ANONYMOUS_LEARNER_ID 的說明） */
const ACCOUNT_LEARNER_PREFIXES = ["school:", "teacher:", "admin:"] as const;

/** 這個學習者 ID 是否由帳戶推導（即理論上會由工作階段產生） */
export function isAccountLearnerId(learnerId: string): boolean {
  return ACCOUNT_LEARNER_PREFIXES.some((prefix) => learnerId.startsWith(prefix));
}

/** 這次請求的身分與學習者 ID */
export interface RequestActor {
  /** 登入使用者；未登入時為 null */
  user: SessionUser | null;
  /** 這次請求使用的學習者 ID（學生、教師或匿名） */
  learnerId: string | null;
  /** 是否為教師帳戶 */
  isTeacher: boolean;
}

/** 是否已啟用學校帳戶登入 */
export function isAuthEnabled(): boolean {
  return getServerConfig().auth.enabled;
}

/** 是否要求登入才可使用學生功能 */
export function isSignInRequired(): boolean {
  const { auth } = getServerConfig();
  return auth.enabled && auth.requireSignIn;
}

export function isTeacherUser(user: SessionUser | null): boolean {
  return user !== null && isStaffRole(user.role);
}

/** 是否為管理員帳戶 */
export function isAdminUser(user: SessionUser | null): boolean {
  return user?.role === "admin";
}

/** 由 Cookie 標頭字串取出指定 cookie 的值（格式錯誤時視為沒有 cookie） */
function readCookieHeader(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      // 惡意或損毀的百分比編碼（例如 "%"）不應令請求變成 500
      return null;
    }
  }
  return null;
}

interface AdminTokenState {
  /** 可用的權杖；未設定或過短時為 null */
  value: string | null;
  /** 已設定但長度不足（設定錯誤） */
  weak: boolean;
}

function readAdminTokenState(): AdminTokenState {
  const raw = process.env.ADMIN_TOKEN?.trim() ?? "";
  if (raw.length === 0) return { value: null, weak: false };
  if (raw.length < MIN_ADMIN_TOKEN_LENGTH) return { value: null, weak: true };
  return { value: raw, weak: false };
}

/** 固定時間比較權杖（先雜湊，避免長度不同時提早回傳而洩漏長度資訊） */
function tokenMatches(provided: string, expected: string): boolean {
  const left = createHash("sha256").update(provided).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

/**
 * 未啟用學校帳戶登入時，是否允許使用後台功能（本機開發／示範）。
 * 正式建置（包括 `next start` 及 Cloud Run）一律 fail-closed，
 * 必須明確設定 HISTORY_ALLOW_UNSAFE_DEMO_MODE=true（見 config.ts）。
 */

/** 由 Request 標頭解析工作階段（測試及 route handler 皆適用，毋須 Next 請求內容） */
export function sessionFromRequest(request: Request): SessionUser | null {
  const header = request.headers.get("cookie") ?? "";
  return decodeSession(readCookieHeader(header, SESSION_COOKIE));
}

/**
 * 讀取目前的使用者。
 * 有傳入 Request 時優先由標頭解析；否則使用 next/headers（Server Component、
 * 由 Next 產生 Request 的 route handler）。無法取得請求內容時回傳 null。
 */
export async function getRequestUser(request?: Request): Promise<SessionUser | null> {
  if (request) {
    const fromHeader = sessionFromRequest(request);
    if (fromHeader) return fromHeader;
  }
  try {
    const store = await cookies();
    return decodeSession(store.get(SESSION_COOKIE)?.value);
  } catch {
    // 不在請求內容中（例如單元測試直接呼叫服務層）
    return null;
  }
}

function loginPath(nextPath: string): string {
  const safeNext = nextPath.startsWith("/") ? nextPath : "/";
  return `/login?next=${encodeURIComponent(safeNext)}`;
}

/* ------------------------------------------------------------------ */
/* API 守衛                                                            */
/* ------------------------------------------------------------------ */

/**
 * 需要登入的 API。
 * 已啟用登入時必須有有效工作階段；未啟用登入（匿名示範模式）時回傳 null。
 */
export async function requireSignedIn(request?: Request): Promise<SessionUser | null> {
  const user = await getRequestUser(request);
  if (user) {
    ensureLearner(user.learnerId);
    return user;
  }
  if (isSignInRequired()) throw new ApiRouteError("請先以學校 Google 帳戶登入", 401);
  return null;
}

/**
 * 後台 API 守衛（共用實作）。
 *
 * - 提供正確的 x-admin-token 時放行（供自動化腳本使用）。這個權杖等同管理員，
 *   會繞過角色檢查，因此只接受長度足夠的值，並以固定時間比較。
 * - 未啟用登入時：未設定 ADMIN_TOKEN 則維持開放（僅限本機示範），設定了則要求標頭。
 * - 已啟用登入時：需要教師或管理員帳戶（adminOnly = true 時只限管理員）；
 *   學生呼叫會收到 403，未登入會收到 401。
 */
async function requireStaff(
  request: Request,
  options: { adminOnly: boolean },
): Promise<SessionUser | null> {
  const admin = readAdminTokenState();
  const provided = request.headers.get("x-admin-token")?.trim() ?? "";
  if (admin.value !== null && provided.length > 0 && tokenMatches(provided, admin.value)) {
    return sessionFromRequest(request);
  }

  if (!isAuthEnabled()) {
    // 正式建置（包括 next start 及 Cloud Run）不允許「未啟用登入」的後台，
    // 否則任何人都能改教材及題目。
    if (!isUnsafeDemoModeAllowed()) {
      throw new ApiRouteError(
        "正式環境的後台 API 必須先啟用學校帳戶登入（設定 GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET 及 AUTH_SECRET）。如要臨時在本機示範，請設定 HISTORY_ALLOW_UNSAFE_DEMO_MODE=true。",
        403,
      );
    }
    if (admin.weak) {
      throw new ApiRouteError(
        `ADMIN_TOKEN 長度不足（最少 ${MIN_ADMIN_TOKEN_LENGTH} 個字元），後台 API 不會接受這個權杖`,
        401,
      );
    }
    if (admin.value === null) return null;
    throw new ApiRouteError("後台 API 需要有效的 x-admin-token 標頭", 401);
  }

  const user = await getRequestUser(request);
  if (!user) throw new ApiRouteError("請先以學校 Google 帳戶登入", 401);
  if (options.adminOnly ? !isAdminUser(user) : !isStaffRole(user.role)) {
    throw new ApiRouteError(
      options.adminOnly ? "此功能只限管理員帳戶使用" : "此功能只限教師或管理員帳戶使用",
      403,
    );
  }
  ensureLearner(user.learnerId);
  return user;
}

/** 教師 API 守衛（題目、回報、學生練習記錄）：教師及管理員皆可使用 */
export function requireTeacher(request: Request): Promise<SessionUser | null> {
  return requireStaff(request, { adminOnly: false });
}

/** 管理員 API 守衛（教材、OCR、課題發布、系統狀態）：只限管理員 */
export function requireAdmin(request: Request): Promise<SessionUser | null> {
  return requireStaff(request, { adminOnly: true });
}

/** 相容舊名稱：舊版管理 API 的守衛即管理員守衛 */
export const requireAdminApi = requireAdmin;

/**
 * 在讀取 request body 之前先確認身分。
 *
 * 學生 API 需要 body 內的 learnerId 作為匿名示範模式的後備值，因此無法先呼叫
 * resolveLearnerId；改為在解析 body 之前先攔截未登入的請求，確保啟用登入後
 * 未登入用戶一律收到 401，而不是先看到 body 驗證細節。
 */
export async function requireSignInBeforeBody(request: Request): Promise<void> {
  if (!isSignInRequired()) return;
  const user = await getRequestUser(request);
  if (!user) throw new ApiRouteError("請先以學校 Google 帳戶登入", 401);
  ensureLearner(user.learnerId);
}

/**
 * 學生 API 守衛：學生及教師皆可使用（教師需要以學生身分測試平台）。
 * 未登入時只有「未要求登入」的匿名示範模式可以通過。
 */
export async function requireStudentOrTeacher(request: Request): Promise<RequestActor> {
  const user = await requireSignedIn(request);
  if (user) {
    return { user, learnerId: user.learnerId, isTeacher: isTeacherUser(user) };
  }
  return { user: null, learnerId: null, isTeacher: false };
}

/* ------------------------------------------------------------------ */
/* 學習者 ID 解析                                                      */
/* ------------------------------------------------------------------ */

/**
 * 取得這次請求應該使用的學習者 ID。
 * 已登入時使用帳戶對應的 ID（教師有自己的 ID）；未啟用登入時使用前端提供的匿名 ID。
 */
export async function resolveLearnerId(
  request: Request | undefined,
  requested?: string | null,
): Promise<string> {
  const resolved = await resolveOptionalLearnerId(request, requested, { required: true });
  if (resolved === null) throw new ApiRouteError("缺少有效的學習者 ID", 400);
  return resolved;
}

/**
 * 同 resolveLearnerId，但容許「沒有學習者」（例如尚未登入時瀏覽課題清單）。
 * required = true 時，未登入且沒有有效的匿名 ID 會拋出錯誤。
 */
export async function resolveOptionalLearnerId(
  request: Request | undefined,
  requested?: string | null,
  options: { required?: boolean } = {},
): Promise<string | null> {
  const user = await getRequestUser(request);
  if (user) {
    ensureLearner(user.learnerId);
    return user.learnerId;
  }

  if (isSignInRequired()) {
    throw new ApiRouteError("請先以學校 Google 帳戶登入", 401);
  }

  const anonymous = requested?.trim() ?? "";
  if (anonymous.length === 0) {
    if (options.required) throw new ApiRouteError("缺少有效的學習者 ID", 400);
    return null;
  }
  if (!ANONYMOUS_LEARNER_ID.test(anonymous)) {
    throw new ApiRouteError("學習者 ID 格式不正確", 400);
  }
  // 未登入時不可冒用帳戶的學習者 ID（即使是同一位使用者，也必須先完成登入）
  if (isAccountLearnerId(anonymous)) {
    throw new ApiRouteError("未登入時不可使用學校帳戶的學習記錄，請先登入", 401);
  }
  return anonymous;
}

/* ------------------------------------------------------------------ */
/* 頁面守衛（Server Component）                                        */
/* ------------------------------------------------------------------ */

/** 學生頁面守衛：需要登入時未登入會導向登入頁（教師同樣可以進入） */
export async function guardStudentPage(currentPath: string): Promise<SessionUser | null> {
  const user = await getRequestUser();
  if (user) return user;
  if (isSignInRequired()) redirect(loginPath(currentPath));
  return null;
}

async function guardStaffPage(
  currentPath: string,
  options: { adminOnly: boolean },
): Promise<SessionUser | null> {
  // 先讀取工作階段（會呼叫 cookies()），令這個頁面一定是動態渲染。
  // 若先判斷 isAuthEnabled() 才讀 cookie，建置環境（沒有登入憑證）會在建置時直接
  // 執行下面的 redirect，並把它預先渲染成靜態頁面：已登入使用者其後會不停往返
  // 登入頁（見 src/app/layout.tsx 的 dynamic 說明）。根配置亦已強制動態渲染，
  // 這裡保留同一保證，避免日後移除根配置時再次出現。
  const user = await getRequestUser();

  if (!isAuthEnabled()) {
    // 與 requireStaff 採用同一套判斷：正式建置不可渲染未受保護的後台頁面，
    // 否則任何人只要開啟 /admin 或 /teacher 就會看到後台介面。
    if (!isUnsafeDemoModeAllowed()) {
      redirect(`/login?error=not_configured&next=${encodeURIComponent(currentPath)}`);
    }
    return user;
  }

  if (!user) redirect(loginPath(currentPath));
  const allowed = options.adminOnly ? isAdminUser(user) : isStaffRole(user.role);
  if (!allowed) {
    redirect(
      `/login?denied=${options.adminOnly ? "admin" : "teacher"}&next=${encodeURIComponent(currentPath)}`,
    );
  }
  return user;
}

/** 教師頁面守衛（/teacher/**）：未登入導向登入頁，學生帳戶導向拒絕存取說明；管理員亦可進入 */
export async function guardTeacherPage(currentPath: string): Promise<SessionUser | null> {
  return guardStaffPage(currentPath, { adminOnly: false });
}

/** 管理員頁面守衛（/admin/**）：未登入導向登入頁，教師及學生帳戶導向拒絕存取說明 */
export async function guardAdminPage(currentPath: string): Promise<SessionUser | null> {
  return guardStaffPage(currentPath, { adminOnly: true });
}

export type { SessionUser };
