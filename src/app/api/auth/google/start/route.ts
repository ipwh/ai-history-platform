import { NextResponse } from "next/server";

import { buildAuthorizeUrl, publicUrl, resolveRedirectUri } from "@/server/auth/google";
import {
  OAUTH_COOKIE,
  createPkcePair,
  createState,
  encodeOAuthState,
  oauthCookieOptions,
} from "@/server/auth/session";
import { getServerConfig } from "@/server/config";

export const runtime = "nodejs";

/** 只接受站內路徑，避免被利用作開放式轉址 */
function safeNextPath(value: string | null): string {
  if (value === null) return "/";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

/** 開始 Google 登入：設定 state／PKCE 暫存 cookie 後導向 Google 同意頁 */
export async function GET(request: Request) {
  const config = getServerConfig();
  if (!config.auth.enabled || config.auth.googleClientId === null) {
    return NextResponse.redirect(publicUrl(request, "/login?error=not_configured"));
  }

  const state = createState();
  const { verifier, challenge } = createPkcePair();

  const response = NextResponse.redirect(
    buildAuthorizeUrl({
      clientId: config.auth.googleClientId,
      redirectUri: resolveRedirectUri(request),
      state,
      codeChallenge: challenge,
    }),
  );
  response.cookies.set(
    OAUTH_COOKIE,
    encodeOAuthState({ state, verifier, next: safeNextPath(new URL(request.url).searchParams.get("next")) }),
    oauthCookieOptions,
  );
  return response;
}
