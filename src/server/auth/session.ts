/**
 * 工作階段管理：把已登入的學校帳戶放在 HttpOnly、經 HMAC-SHA256 簽署的 cookie 內。
 *
 * 設計重點：
 *   1. cookie 內容為 base64url(JSON) + "." + base64url(HMAC)，瀏覽器無法自行修改。
 *   2. 密鑰優先使用 AUTH_SECRET；未設定時在本機 data/ 目錄產生隨機密鑰檔，
 *      讓本機開發毋須額外設定，同時不會把密鑰寫入版本控制。
 *   3. 讀取 cookie 只在伺服器端進行，前端永遠不會接觸密鑰。
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { cookies } from "next/headers";

import { sessionUserSchema, type SessionUser, type SessionUserInput } from "../../lib/types";
import { getServerConfig } from "../config";

export const SESSION_COOKIE = "hk-history-session";
/** 未完成 OAuth 流程時的暫存 cookie（存放 state 及 PKCE verifier） */
export const OAUTH_COOKIE = "hk-history-oauth";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const OAUTH_TTL_SECONDS = 60 * 10;

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

let cachedSecret: string | null = null;

/** 取得簽署密鑰：AUTH_SECRET → data/auth-secret.key（首次使用時自動產生） */
export function getSessionSecret(): string {
  if (cachedSecret !== null) return cachedSecret;

  const configured = getServerConfig().auth.secret;
  if (configured !== null) {
    cachedSecret = configured;
    return cachedSecret;
  }

  const keyPath = path.join(path.dirname(getServerConfig().databasePath), "auth-secret.key");
  try {
    if (fs.existsSync(keyPath)) {
      const existing = fs.readFileSync(keyPath, "utf8").trim();
      if (existing.length >= 32) {
        cachedSecret = existing;
        return cachedSecret;
      }
    }
    const generated = randomBytes(32).toString("hex");
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, generated, { encoding: "utf8", mode: 0o600 });
    cachedSecret = generated;
    return cachedSecret;
  } catch (error) {
    console.warn("[auth] 無法讀寫本機登入密鑰，改為使用本次執行期間的隨機密鑰", error);
    cachedSecret = randomBytes(32).toString("hex");
    return cachedSecret;
  }
}

interface SessionPayload extends SessionUser {
  /** 到期時間（Unix 秒） */
  exp: number;
}

/** 產生簽署後的 cookie 值 */
export function encodeSession(user: SessionUserInput, now = Date.now()): string {
  const payload: SessionPayload = {
    ...sessionUserSchema.parse(user),
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
  };
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${body}.${sign(body, getSessionSecret())}`;
}

/** 驗證簽署及到期時間，並回傳使用者；任何異常一律回傳 null */
export function decodeSession(token: string | null | undefined, now = Date.now()): SessionUser | null {
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;

  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!safeEqual(signature, sign(body, getSessionSecret()))) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const candidate = parsed as SessionPayload;
    if (typeof candidate.exp !== "number" || candidate.exp * 1000 <= now) return null;
    return sessionUserSchema.parse(candidate);
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
} as const;

/** 讀取目前登入的學校帳戶（Server Component 及 Route Handler 皆可使用） */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return decodeSession(store.get(SESSION_COOKIE)?.value);
}

/**
 * 由 Request 標頭讀取 cookie。
 * Route Handler 直接呼叫 `cookies()` 需要 Next.js 的請求內容，改用標頭解析可讓
 * 流程（例如 Google 回呼）以一般 Request 測試，行為與瀏覽器相同。
 */
export function readCookieFromRequest(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? decodeURIComponent(value) : null;
  }
  return null;
}

/** 產生隨機的 OAuth state 值 */
export function createState(): string {
  return randomBytes(16).toString("base64url");
}

/** 產生 PKCE code verifier 及其 challenge（S256） */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export interface OAuthStatePayload {
  state: string;
  verifier: string;
  /** 登入完成後的導向路徑 */
  next: string;
  exp: number;
}

export function encodeOAuthState(payload: Omit<OAuthStatePayload, "exp">, now = Date.now()): string {
  const body = base64UrlEncode(
    JSON.stringify({ ...payload, exp: Math.floor(now / 1000) + OAUTH_TTL_SECONDS }),
  );
  return `${body}.${sign(body, getSessionSecret())}`;
}

export function decodeOAuthState(token: string | null | undefined, now = Date.now()): OAuthStatePayload | null {
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!safeEqual(signature, sign(body, getSessionSecret()))) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthStatePayload;
    if (typeof parsed.exp !== "number" || parsed.exp * 1000 <= now) return null;
    if (typeof parsed.state !== "string" || typeof parsed.verifier !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export const oauthCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: OAUTH_TTL_SECONDS,
} as const;
