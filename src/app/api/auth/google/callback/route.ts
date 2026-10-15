import { NextResponse } from "next/server";

import { AuthError, fetchGoogleProfile, publicUrl, resolveRedirectUri } from "@/server/auth/google";
import { safeNextPath } from "@/server/auth/redirect";
import { buildSessionUserWithRoster, isExplicitStaff, resolveSignInRole } from "@/server/auth/role";
import {
  OAUTH_COOKIE,
  SESSION_COOKIE,
  decodeOAuthState,
  encodeSession,
  oauthCookieOptions,
  readCookieFromRequest,
  sessionCookieOptions,
} from "@/server/auth/session";
import { getServerConfig } from "@/server/config";
import { ensureLearner } from "@/server/repositories/learners";
import { getRosterSnapshot, findStudentInSnapshot } from "@/server/roster";
import type { RosterStudent } from "@/server/roster/columns";

export const runtime = "nodejs";

/** Google 回呼：驗證 state、換取帳戶資料、建立工作階段 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const config = getServerConfig();

  const failure = (code: string) =>
    NextResponse.redirect(publicUrl(request, `/login?error=${encodeURIComponent(code)}`));

  if (!config.auth.enabled) return failure("not_configured");

  const error = url.searchParams.get("error");
  if (error !== null) {
    return failure(error === "access_denied" ? "access_denied" : "google_error");
  }

  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const stored = decodeOAuthState(readCookieFromRequest(request, OAUTH_COOKIE));

  if (code.length === 0 || stored === null || stored.state !== state) {
    return failure("invalid_state");
  }

  try {
    const profile = await fetchGoogleProfile({
      code,
      codeVerifier: stored.verifier,
      redirectUri: resolveRedirectUri(request),
    });

    // 學生名冊核對：只有名冊內的學生可登入（教師不受名冊限制）。
    // 名冊同時是角色判定的依據：名冊內的帳戶一律是學生，因此「校內網域但學號形式
    // 不符」的別名帳戶不會落入「校內其他帳號 = 教師」而取得教師權限。
    const baseRole = resolveSignInRole(profile.email, config.auth);
    const explicitStaff = isExplicitStaff(profile.email, config.auth);
    let student: RosterStudent | null = null;

    if (config.roster.enabled && !explicitStaff) {
      const snapshot = await getRosterSnapshot();
      if (!snapshot.loaded) {
        // 名冊暫時無法讀取：學生一律拒絕（避免未授權帳戶進入），
        // 可設 STUDENT_ROSTER_FAIL_OPEN=true 改為放行；教師帳戶不受影響。
        if (baseRole === "student" && !config.roster.failOpen) return failure("roster_unavailable");
      } else {
        student = findStudentInSnapshot(snapshot, profile.email);
        // 名冊以外的學生帳戶不可登入（教師不是名冊成員，因此不受此限）
        if (student === null && baseRole === "student" && config.roster.enforce) {
          return failure("not_in_roster");
        }
        // 只開放的班別（例如中一至中三）才可登入
        if (student !== null && !student.inScope) return failure("outside_scope");
      }
    }

    const user = buildSessionUserWithRoster(profile, config.auth, student);
    ensureLearner(user.learnerId);

    // stored.next 在 /start 已檢查過，這裡再檢查一次：即使 cookie 來自舊版本或被
    // 其他方式寫入，也不會成為開放式轉址。
    const response = NextResponse.redirect(publicUrl(request, safeNextPath(stored.next)));
    response.cookies.set(SESSION_COOKIE, encodeSession(user), sessionCookieOptions);
    response.cookies.set(OAUTH_COOKIE, "", { ...oauthCookieOptions, maxAge: 0 });
    return response;
  } catch (caught) {
    const reason = caught instanceof AuthError ? caught.code : "auth_failed";
    console.warn("[auth] Google 登入失敗", caught);
    return failure(reason);
  }
}
