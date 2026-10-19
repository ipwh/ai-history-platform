import { NextResponse } from "next/server";

import { OAUTH_COOKIE, SESSION_COOKIE } from "@/server/auth/session";
import { privateResponseHeaders } from "@/server/http";

export const runtime = "nodejs";

/** 登出：清除工作階段 cookie */
export async function POST() {
  const response = NextResponse.json({ ok: true }, { headers: privateResponseHeaders() });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  response.cookies.set(OAUTH_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
