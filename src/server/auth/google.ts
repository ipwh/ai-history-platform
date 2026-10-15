/**
 * Google OAuth 2.0（授權碼流程 + PKCE）。
 *
 * 只做登入所需的最小範圍（openid email profile）：
 *   1. 以 /api/auth/google/start 導向 Google 的同意頁。
 *   2. Google 回呼 /api/auth/google/callback 後，伺服器以 TLS 直接向 Google 換取 token。
 *   3. 以 access token 讀取 userinfo，並要求 email_verified = true。
 *
 * 因為 token 及 userinfo 都是由本伺服器直接向 Google 取得（非由瀏覽器提供），
 * 所以毋須自行驗證 ID token 的簽章。
 */
import { getServerConfig } from "../config";
import type { GoogleProfile } from "./role";

export class AuthError extends Error {
  readonly code: string;

  constructor(message: string, code = "auth_failed") {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

const AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";
const SCOPE = "openid email profile";

/**
 * 取得 Google 端點網址。
 * 可用環境變數覆寫（GOOGLE_AUTHORIZE_ENDPOINT／GOOGLE_TOKEN_ENDPOINT／GOOGLE_USERINFO_ENDPOINT），
 * 供本機以 stub 驗證登入及名冊流程；正式環境保持預設值即可。
 */
export function resolveGoogleEndpoint(
  envName: string,
  fallback: string,
): string {
  const configured = (process.env[envName] ?? "").trim();
  return configured.length > 0 ? configured : fallback;
}

/**
 * 由請求推導對外公開的來源網址（例如 https://history-self-study-xxx.a.run.app）。
 *
 * Cloud Run 等環境中，容器內看到的請求網址是內部位址（0.0.0.0:8080），
 * 因此必須優先採用反向代理提供的 X-Forwarded-Host／X-Forwarded-Proto，
 * 否則任何絕對網址（OAuth 重新導向、登入後導向）都會指向無法連線的內部位址。
 * 亦可用 AUTH_PUBLIC_ORIGIN 明確指定（例如自訂網域）。
 */
export function resolvePublicOrigin(request: Request): string {
  const configured = (process.env.AUTH_PUBLIC_ORIGIN ?? "").trim();
  if (configured.length > 0) {
    try {
      return new URL(configured).origin;
    } catch {
      // 設定格式不正確時忽略，改用請求標頭
    }
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? "";
  if (forwardedHost.length > 0 && /^[A-Za-z0-9.\-:[\]]+$/.test(forwardedHost)) {
    const protoHeader = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "";
    const proto = protoHeader === "http" || protoHeader === "https" ? protoHeader : "https";
    return `${proto}://${forwardedHost}`;
  }

  return new URL(request.url).origin;
}

/**
 * 產生指向本站的絕對網址（供 NextResponse.redirect 使用）。
 *
 * 這是「站內導向」的最後一道防線：即使呼叫端傳入的路徑通過了 safeNextPath，
 * 解析後只要離開本站（例如 `\` 被解析成斜線而變成外部主機）就一律退回網站首頁。
 */
export function publicUrl(request: Request, path: string): URL {
  const origin = resolvePublicOrigin(request);
  const resolved = new URL(path, `${origin}/`);
  if (resolved.origin !== origin) return new URL("/", `${origin}/`);
  return resolved;
}

/**
 * 依請求來源組出重新導向 URI。
 *
 * 優先順序：
 *   1. AUTH_REDIRECT_URI（明確設定，最穩定，建議正式部署時使用）
 *   2. 反向代理／負載平衡器提供的 X-Forwarded-Host 及 X-Forwarded-Proto
 *   3. 請求本身的來源
 */
export function resolveRedirectUri(request: Request): string {
  const configured = getServerConfig().auth.redirectUri;
  if (configured !== null) return configured;
  return `${resolvePublicOrigin(request)}/api/auth/google/callback`;
}

export function buildAuthorizeUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(resolveGoogleEndpoint("GOOGLE_AUTHORIZE_ENDPOINT", AUTHORIZE_ENDPOINT));
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", options.state);
  url.searchParams.set("code_challenge", options.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  // 讓使用者可以選擇其他 Google 帳戶（學校電腦可能已登入個人帳戶）
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

interface TokenResponse {
  access_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface UserInfoResponse {
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  hd?: string;
}

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const timeoutMs = getServerConfig().llm.requestTimeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new AuthError("Google 登入服務回應逾時，請稍後再試", "timeout");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** 以授權碼換取 access token，並讀取帳戶資料 */
export async function fetchGoogleProfile(options: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<GoogleProfile> {
  const config = getServerConfig();
  const clientId = config.auth.googleClientId;
  const clientSecret = config.auth.googleClientSecret;
  if (clientId === null || clientSecret === null) {
    throw new AuthError("尚未設定 Google 登入憑證", "not_configured");
  }

  const token = await withTimeout(async (signal) => {
    const response = await fetch(resolveGoogleEndpoint("GOOGLE_TOKEN_ENDPOINT", TOKEN_ENDPOINT), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: options.code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: options.redirectUri,
        grant_type: "authorization_code",
        code_verifier: options.codeVerifier,
      }),
      signal,
      cache: "no-store",
    });
    const payload = (await response.json()) as TokenResponse;
    if (!response.ok || !payload.access_token) {
      throw new AuthError(
        payload.error_description ?? payload.error ?? `Google 拒絕登入（HTTP ${response.status}）`,
        "token_exchange_failed",
      );
    }
    return payload;
  });

  const profile = await withTimeout(async (signal) => {
    const response = await fetch(resolveGoogleEndpoint("GOOGLE_USERINFO_ENDPOINT", USERINFO_ENDPOINT), {
      headers: { authorization: `Bearer ${token.access_token}` },
      signal,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new AuthError(`無法讀取 Google 帳戶資料（HTTP ${response.status}）`, "userinfo_failed");
    }
    return (await response.json()) as UserInfoResponse;
  });

  if (!profile.email || profile.email_verified !== true) {
    throw new AuthError("Google 帳戶沒有已驗證的電郵地址，無法登入", "email_not_verified");
  }

  return {
    email: profile.email,
    name: profile.name ?? "",
    pictureUrl: profile.picture ?? null,
  };
}
