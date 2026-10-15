/**
 * 學生登入流程測試（Google 回呼 + 學生名冊核對）。
 *
 * 以本機 stub 取代 Google 的 token／userinfo 端點（GOOGLE_TOKEN_ENDPOINT、
 * GOOGLE_USERINFO_ENDPOINT），因此可完整驗證：
 *   1. 名冊內的學生登入後取得班別、學號及名冊姓名。
 *   2. 名冊以外、未啟用強制時仍可登入，但標示未核對。
 *   3. STUDENT_ROSTER_ENFORCE=true 時，名冊以外的學生會被拒絕（導向登入頁並說明原因）。
 *   4. 名冊來源無法讀取時預設拒絕登入（failOpen=true 才放行）。
 *   5. 教師帳戶不受名冊限制（即使電郵出現在名冊亦不會被當成學生）。
 *   6. state 不符或 Google 未驗證電郵時不會建立工作階段。
 */
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("login-roster");
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_TEACHER_EMAILS = "teacher@example.com";
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.AUTH_REQUIRE_SIGN_IN = "true";
process.env.LLM_PROVIDER = "mock";
delete process.env.ADMIN_TOKEN;

type SessionModule = typeof import("@/server/auth/session");
type RosterModule = typeof import("@/server/roster");
type SeedModule = typeof import("@/server/seed");

let session: SessionModule;
let roster: RosterModule;
let seed: SeedModule;

const rosterFile = path.join(os.tmpdir(), `hist-login-roster-${process.pid}.csv`);
const ROSTER_CSV = ["班別,學號,姓名,電郵", "1A,s2024146,陳大文,s2024146@pochiu.edu.hk"].join("\n");

interface GoogleStub {
  server: Server;
  base: string;
  setEmail: (email: string, name?: string, verified?: boolean) => void;
}

let stub: GoogleStub;

function startGoogleStub(): Promise<GoogleStub> {
  let email = "s2024146@pochiu.edu.hk";
  let name = "Google 名稱";
  let verified = true;
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if ((request.url ?? "").startsWith("/token")) {
      response.end(JSON.stringify({ access_token: "stub-access-token", expires_in: 3600 }));
      return;
    }
    if ((request.url ?? "").startsWith("/userinfo")) {
      response.end(
        JSON.stringify({ email, email_verified: verified, name, picture: null }),
      );
      return;
    }
    response.statusCode = 404;
    response.end("{}");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        server,
        base: `http://127.0.0.1:${port}`,
        setEmail: (nextEmail, nextName = "Google 名稱", nextVerified = true) => {
          email = nextEmail;
          name = nextName;
          verified = nextVerified;
        },
      });
    });
  });
}

function clearRosterEnv(): void {
  for (const name of [
    "STUDENT_ROSTER_ENABLED",
    "STUDENT_ROSTER_ENFORCE",
    "STUDENT_ROSTER_SOURCE",
    "STUDENT_ROSTER_FILE",
    "STUDENT_ROSTER_SHEET_ID",
    "STUDENT_ROSTER_CSV_BASE",
    "STUDENT_ROSTER_FAIL_OPEN",
    "STUDENT_ROSTER_CACHE_TTL_SECONDS",
  ]) {
    delete process.env[name];
  }
}

/** 建立回呼請求（含有效的 state cookie，模擬 Google 導回） */
function callbackRequest(session: SessionModule, options: { state?: string; code?: string } = {}): Request {
  const state = options.state ?? "state-123";
  const oauthCookie = session.encodeOAuthState({ state, verifier: "verifier-123", next: "/" });
  const url = new URL("http://localhost:3000/api/auth/google/callback");
  url.searchParams.set("code", options.code ?? "auth-code-123");
  url.searchParams.set("state", state);
  return new Request(url, {
    headers: { cookie: `${session.OAUTH_COOKIE}=${encodeURIComponent(oauthCookie)}` },
  });
}

function sessionUserFromResponse(response: Response, session: SessionModule) {
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${session.SESSION_COOKIE}=`));
  if (header === undefined) return null;
  const raw = header.slice(session.SESSION_COOKIE.length + 1).split(";")[0];
  return session.decodeSession(decodeURIComponent(raw));
}

beforeAll(async () => {
  session = await import("@/server/auth/session");
  roster = await import("@/server/roster");
  seed = await import("@/server/seed");
  fs.writeFileSync(rosterFile, ROSTER_CSV, "utf8");
  stub = await startGoogleStub();
  process.env.GOOGLE_TOKEN_ENDPOINT = `${stub.base}/token`;
  process.env.GOOGLE_USERINFO_ENDPOINT = `${stub.base}/userinfo`;
  seed.ensureBootstrap();
});

afterAll(async () => {
  fs.rmSync(rosterFile, { force: true });
  delete process.env.GOOGLE_TOKEN_ENDPOINT;
  delete process.env.GOOGLE_USERINFO_ENDPOINT;
  await new Promise<void>((resolve) => stub.server.close(() => resolve()));
});

beforeEach(() => {
  clearRosterEnv();
  roster.resetRosterCache();
  stub.setEmail("s2024146@pochiu.edu.hk", "Google 名稱", true);
});

async function runCallback(request: Request): Promise<Response> {
  const { GET } = await import("@/app/api/auth/google/callback/route");
  return GET(request) as Promise<Response>;
}

describe("學生登入（Google 回呼）", () => {
  it("名冊內的學生：建立工作階段並帶入班別、學號及名冊姓名", async () => {
    process.env.STUDENT_ROSTER_FILE = rosterFile;
    const response = await runCallback(callbackRequest(session));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/");

    const user = sessionUserFromResponse(response, session);
    expect(user?.role).toBe("student");
    expect(user?.email).toBe("s2024146@pochiu.edu.hk");
    expect(user?.className).toBe("1A");
    expect(user?.studentNumber).toBe("s2024146");
    expect(user?.rosterVerified).toBe(true);
    expect(user?.name).toBe("陳大文");
    expect(user?.learnerId).toBe("school:s2024146@pochiu.edu.hk");
  });

  it("名冊以外但未啟用強制時：可以登入，但標示未核對", async () => {
    process.env.STUDENT_ROSTER_FILE = rosterFile;
    process.env.STUDENT_ROSTER_ENFORCE = "false";
    stub.setEmail("s2099999@pochiu.edu.hk", "未在名冊");

    const response = await runCallback(callbackRequest(session));
    const user = sessionUserFromResponse(response, session);
    expect(response.status).toBe(307);
    expect(user?.rosterVerified).toBe(false);
    expect(user?.className).toBeNull();
  });

  it("名冊以外且啟用強制時：拒絕登入並導向登入頁說明原因", async () => {
    process.env.STUDENT_ROSTER_FILE = rosterFile;
    stub.setEmail("s2099999@pochiu.edu.hk", "未在名冊");

    const response = await runCallback(callbackRequest(session));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login?error=not_in_roster");
    expect(sessionUserFromResponse(response, session)).toBeNull();
  });

  it("名冊來源無法讀取時：預設拒絕登入，failOpen=true 才放行", async () => {
    // 指向不存在的檔案，模擬 Google Sheet 暫時不可用
    process.env.STUDENT_ROSTER_FILE = path.join(os.tmpdir(), `hist-missing-${process.pid}.csv`);

    const blocked = await runCallback(callbackRequest(session));
    expect(blocked.headers.get("location")).toContain("/login?error=roster_unavailable");
    expect(sessionUserFromResponse(blocked, session)).toBeNull();

    roster.resetRosterCache();
    process.env.STUDENT_ROSTER_FAIL_OPEN = "true";
    const allowed = await runCallback(callbackRequest(session));
    const user = sessionUserFromResponse(allowed, session);
    expect(user?.role).toBe("student");
    expect(user?.rosterVerified).toBe(false);
  });

  it("教師帳戶不受名冊限制（即使電郵被誤加進名冊）", async () => {
    process.env.STUDENT_ROSTER_FILE = rosterFile;
    stub.setEmail("teacher@example.com", "陳老師");

    const response = await runCallback(callbackRequest(session));
    const user = sessionUserFromResponse(response, session);
    expect(user?.role).toBe("teacher");
    expect(user?.className).toBeNull();
    expect(user?.studentNumber).toBeNull();
    expect(user?.rosterVerified).toBe(false);
    expect(user?.learnerId).toBe("teacher:teacher@example.com");
  });

  it("state 不符時不會建立工作階段", async () => {
    process.env.STUDENT_ROSTER_FILE = rosterFile;
    const response = await runCallback(callbackRequest(session, { state: "state-123" }));
    expect(response.status).toBe(307);

    const tampered = await runCallback(
      new Request("http://localhost:3000/api/auth/google/callback?code=x&state=other-state", {
        headers: {
          cookie: `${session.OAUTH_COOKIE}=${encodeURIComponent(
            session.encodeOAuthState({ state: "state-123", verifier: "v", next: "/" }),
          )}`,
        },
      }),
    );
    expect(tampered.headers.get("location")).toContain("error=invalid_state");
    expect(sessionUserFromResponse(tampered, session)).toBeNull();
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("Google 未驗證電郵時不會建立工作階段", async () => {
    process.env.STUDENT_ROSTER_FILE = rosterFile;
    stub.setEmail("s2024146@pochiu.edu.hk", "未驗證", false);
    const response = await runCallback(callbackRequest(session));
    expect(response.headers.get("location")).toContain("error=email_not_verified");
    expect(sessionUserFromResponse(response, session)).toBeNull();
  });
});

describe("OAuth 重新導向網址（Cloud Run 反向代理）", () => {
  it("優先用 AUTH_REDIRECT_URI 設定值", async () => {
    const { resolveRedirectUri } = await import("@/server/auth/google");
    process.env.AUTH_REDIRECT_URI = "https://history.example.edu.hk/api/auth/google/callback";
    try {
      const request = new Request("https://0.0.0.0:8080/api/auth/google/start", {
        headers: { "x-forwarded-host": "history-self-study-abc.a.run.app", "x-forwarded-proto": "https" },
      });
      expect(resolveRedirectUri(request)).toBe("https://history.example.edu.hk/api/auth/google/callback");
    } finally {
      delete process.env.AUTH_REDIRECT_URI;
    }
  });

  it("未設定時使用 Cloud Run 的 X-Forwarded-Host，而非容器內部網址", async () => {
    const { resolveRedirectUri } = await import("@/server/auth/google");
    const request = new Request("https://0.0.0.0:8080/api/auth/google/start", {
      headers: { "x-forwarded-host": "history-self-study-bggdvmswzq-df.a.run.app", "x-forwarded-proto": "https" },
    });
    expect(resolveRedirectUri(request)).toBe(
      "https://history-self-study-bggdvmswzq-df.a.run.app/api/auth/google/callback",
    );
  });

  it("沒有代理標頭時沿用請求來源（本機開發）", async () => {
    const { resolveRedirectUri } = await import("@/server/auth/google");
    const request = new Request("http://localhost:3000/api/auth/google/start");
    expect(resolveRedirectUri(request)).toBe("http://localhost:3000/api/auth/google/callback");
  });

  it("忽略不合理的 X-Forwarded-Host（避免被注入任意網址）", async () => {
    const { resolveRedirectUri } = await import("@/server/auth/google");
    const request = new Request("http://localhost:3000/api/auth/google/start", {
      headers: { "x-forwarded-host": "evil.com/redirect?x=1" },
    });
    expect(resolveRedirectUri(request)).toBe("http://localhost:3000/api/auth/google/callback");
  });
});
describe("登入後導向使用對外公開網址（Cloud Run 內部位址問題）", () => {
  const forwarded = {
    "x-forwarded-host": "history-self-study-bggdvmswzq-df.a.run.app",
    "x-forwarded-proto": "https",
  };

  it("resolvePublicOrigin 使用 X-Forwarded-Host 而非容器內部的 0.0.0.0:8080", async () => {
    const { resolvePublicOrigin } = await import("@/server/auth/google");
    const request = new Request("https://0.0.0.0:8080/api/auth/google/start", { headers: forwarded });
    expect(resolvePublicOrigin(request)).toBe("https://history-self-study-bggdvmswzq-df.a.run.app");
  });

  it("AUTH_PUBLIC_ORIGIN 可明確指定對外網址（例如自訂網域）", async () => {
    const { resolvePublicOrigin } = await import("@/server/auth/google");
    process.env.AUTH_PUBLIC_ORIGIN = "https://history.pochiu.edu.hk";
    try {
      const request = new Request("https://0.0.0.0:8080/api/auth/google/start", { headers: forwarded });
      expect(resolvePublicOrigin(request)).toBe("https://history.pochiu.edu.hk");
    } finally {
      delete process.env.AUTH_PUBLIC_ORIGIN;
    }
  });

  it("登入成功後導向公開網址的首頁，而不是 0.0.0.0:8080", async () => {
    stub.setEmail("s2024146@pochiu.edu.hk", "陳大文");
    process.env.STUDENT_ROSTER_FILE = rosterFile;
    const request = new Request("https://0.0.0.0:8080/api/auth/google/callback?code=c&state=s", {
      headers: {
        cookie: `${session.OAUTH_COOKIE}=${encodeURIComponent(
          session.encodeOAuthState({ state: "s", verifier: "v", next: "/practice/new" }),
        )}`,
        ...forwarded,
      },
    });
    const response = await runCallback(request);
    expect(response.headers.get("location")).toBe(
      "https://history-self-study-bggdvmswzq-df.a.run.app/practice/new",
    );
  });

  it("登入失敗時導向公開網址的登入頁", async () => {
    const request = new Request("https://0.0.0.0:8080/api/auth/google/callback?error=access_denied&state=s", {
      headers: {
        cookie: `${session.OAUTH_COOKIE}=${encodeURIComponent(
          session.encodeOAuthState({ state: "s", verifier: "v", next: "/" }),
        )}`,
        ...forwarded,
      },
    });
    const response = await runCallback(request);
    expect(response.headers.get("location")).toBe(
      "https://history-self-study-bggdvmswzq-df.a.run.app/login?error=access_denied",
    );
  });
});
describe("只開放中一至中三（班別範圍）", () => {
  it("班別在範圍內的學生可以登入", async () => {
    process.env.STUDENT_ROSTER_FILE = rosterFile;
    process.env.STUDENT_ROSTER_CLASS_PREFIXES = "1,2,3";
    stub.setEmail("s2024146@pochiu.edu.hk", "陳大文");
    const response = await runCallback(callbackRequest(session));
    expect(sessionUserFromResponse(response, session)?.rosterVerified).toBe(true);
  });

  it("班別不在範圍內的學生會被拒絕並說明原因", async () => {
    const upperSecondary = path.join(os.tmpdir(), `hist-login-roster-upper-${process.pid}.csv`);
    fs.writeFileSync(
      upperSecondary,
      ["班別,學號,姓名,電郵", "4A,s2024999,中四同學,s2024999@pochiu.edu.hk"].join("\n"),
      "utf8",
    );
    process.env.STUDENT_ROSTER_FILE = upperSecondary;
    process.env.STUDENT_ROSTER_CLASS_PREFIXES = "1,2,3";
    stub.setEmail("s2024999@pochiu.edu.hk", "中四同學");
    try {
      const response = await runCallback(callbackRequest(session));
      expect(response.headers.get("location")).toContain("/login?error=outside_scope");
      expect(sessionUserFromResponse(response, session)).toBeNull();
    } finally {
      fs.rmSync(upperSecondary, { force: true });
    }
  });
});