/**
 * 工作階段簽署密鑰（AUTH_SECRET）及有效期的處理測試。
 *
 * 驗證：
 *   1. 正式環境拒絕長度不足的 AUTH_SECRET（fail-closed），並說明如何修正。
 *   2. 本機（非正式）只會警告，不阻擋流程。
 *   3. 更換 AUTH_SECRET（輪換）會令所有既有 cookie 立即失效。
 *   4. 未設定 AUTH_SECRET 時會自動產生足夠長度的本機密鑰檔。
 *   5. AUTH_SESSION_TTL_HOURS 決定工作階段有效期（名冊移除後仍可使用的時間上限）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hist-test-secret-"));
process.env.APP_DATABASE_PATH = path.join(tempRoot, "app.db");
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.AUTH_REQUIRE_SIGN_IN = "true";
process.env.LLM_PROVIDER = "mock";

const STRONG_SECRET = "0123456789abcdefghijklmnopqrstuv"; // 32 個字元
const ROTATED_SECRET = "zyxwvutsrqponmlkjihgfedcba987654"; // 32 個字元（輪換後）
/** 與 src/server/config.ts 的 MIN_AUTH_SECRET_LENGTH 一致 */
const MIN_SECRET_LENGTH = 32;

/** NODE_ENV 在型別上是唯讀的；測試需要模擬正式環境，因此明確覆寫 */
const mutableEnv = process.env as Record<string, string | undefined>;

const USER = {
  email: "s2024146@pochiu.edu.hk",
  name: "測試學生",
  role: "student" as const,
  learnerId: "school:s2024146@pochiu.edu.hk",
  pictureUrl: null,
};

type SessionModule = typeof import("@/server/auth/session");

const originalNodeEnv = process.env.NODE_ENV;
const originalTtl = process.env.AUTH_SESSION_TTL_HOURS;

async function loadSession(): Promise<SessionModule> {
  vi.resetModules();
  return import("@/server/auth/session");
}

afterEach(() => {
  process.env.AUTH_SECRET = STRONG_SECRET;
  mutableEnv.NODE_ENV = originalNodeEnv;
  if (originalTtl === undefined) delete process.env.AUTH_SESSION_TTL_HOURS;
  else process.env.AUTH_SESSION_TTL_HOURS = originalTtl;
  vi.restoreAllMocks();
});

beforeAll(async () => {
  process.env.AUTH_SECRET = STRONG_SECRET;
});

describe("AUTH_SECRET 強度", () => {
  it("正式環境拒絕過短的密鑰，並提供可執行的修正說明", async () => {
    process.env.AUTH_SECRET = "short-secret";
    mutableEnv.NODE_ENV = "production";
    const session = await loadSession();

    expect(() => session.encodeSession(USER)).toThrowError(/AUTH_SECRET 長度不足/);
    // 拒絕使用時不會用弱密鑰驗證任何 cookie（等於全部失效），而不是繼續放行
    expect(() => session.decodeSession("anything.signature")).toThrow();
  });

  it("本機開發只警告，不阻擋登入流程", async () => {
    process.env.AUTH_SECRET = "short-secret";
    mutableEnv.NODE_ENV = "test";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const session = await loadSession();

    const token = session.encodeSession(USER);
    expect(session.decodeSession(token)?.email).toBe(USER.email);
    expect(warn).toHaveBeenCalled();
  });

  it("更換 AUTH_SECRET 後，舊 cookie 立即失效（輪換等於登出所有人）", async () => {
    process.env.AUTH_SECRET = STRONG_SECRET;
    const before = await loadSession();
    const oldCookie = before.encodeSession(USER);
    expect(before.decodeSession(oldCookie)?.email).toBe(USER.email);

    process.env.AUTH_SECRET = ROTATED_SECRET;
    const after = await loadSession();

    expect(after.decodeSession(oldCookie)).toBeNull();
    // 輪換後新簽發的 cookie 正常運作
    expect(after.decodeSession(after.encodeSession(USER))?.email).toBe(USER.email);
  });

  it("未設定 AUTH_SECRET 時會自動產生足夠長度的本機密鑰檔", async () => {
    delete process.env.AUTH_SECRET;
    const session = await loadSession();

    const secret = session.getSessionSecret();
    expect(secret.length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);

    const keyPath = path.join(tempRoot, "auth-secret.key");
    expect(fs.existsSync(keyPath)).toBe(true);
    expect(fs.readFileSync(keyPath, "utf8").trim()).toBe(secret);
    expect(session.decodeSession(session.encodeSession(USER))?.email).toBe(USER.email);
  });
});

describe("工作階段有效期（AUTH_SESSION_TTL_HOURS）", () => {
  it("預設 30 天，並可用環境變數縮短", async () => {
    const defaultSession = await loadSession();
    expect(defaultSession.sessionCookieOptions.maxAge).toBe(720 * 60 * 60);

    process.env.AUTH_SESSION_TTL_HOURS = "8";
    const shortSession = await loadSession();
    expect(shortSession.sessionCookieOptions.maxAge).toBe(8 * 60 * 60);

    const now = Date.now();
    const token = shortSession.encodeSession(USER, now);
    // 7 小時後仍有效，9 小時後失效
    expect(shortSession.decodeSession(token, now + 7 * 60 * 60 * 1000)).not.toBeNull();
    expect(shortSession.decodeSession(token, now + 9 * 60 * 60 * 1000)).toBeNull();
  });
});
