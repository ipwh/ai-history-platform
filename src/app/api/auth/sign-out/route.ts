import { NextResponse } from "next/server";

import { OAUTH_COOKIE, SESSION_COOKIE } from "@/server/auth/session";

export const runtime = "nodejs";

/** 登出：清除工作階段 cookie */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  response.cookies.set(OAUTH_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
