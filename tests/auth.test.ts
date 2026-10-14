import os from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

// 使用獨立暫存資料庫及測試憑證，避免影響本機設定
process.env.APP_DATABASE_PATH = path.join(os.tmpdir(), `hist-test-auth-${process.pid}.db`);
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_TEACHER_EMAILS = "admin@example.com";
process.env.AUTH_ADMIN_EMAILS = "superadmin@example.com";
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";

type RoleModule = typeof import("@/server/auth/role");
type SessionModule = typeof import("@/server/auth/session");
type ConfigModule = typeof import("@/server/config");
type LlmModule = typeof import("@/server/llm");

let role: RoleModule;
let session: SessionModule;
let configModule: ConfigModule;
let llm: LlmModule;

beforeAll(async () => {
  role = await import("@/server/auth/role");
  session = await import("@/server/auth/session");
  configModule = await import("@/server/config");
  llm = await import("@/server/llm");
});

describe("學校帳戶角色判定", () => {
  it("學號形式的校內帳戶是學生，其他校內帳戶是教師", () => {
    const { auth } = configModule.getServerConfig();
    expect(role.resolveSignInRole("s2024146@pochiu.edu.hk", auth)).toBe("student");
    expect(role.resolveSignInRole("S2024146@POCHIU.EDU.HK", auth)).toBe("student");
    expect(role.resolveSignInRole("history.teacher@pochiu.edu.hk", auth)).toBe("teacher");
    // 學號必須是 s + 7 位數字
    expect(role.resolveSignInRole("s123456@pochiu.edu.hk", auth)).toBe("teacher");
  });

  it("非校內網域一律視為學生，且不會因相似網域取得教師權限", () => {
    const { auth } = configModule.getServerConfig();
    expect(role.resolveSignInRole("student@gmail.com", auth)).toBe("student");
    expect(role.resolveSignInRole("x@pochiu.edu.hk.evil.com", auth)).toBe("student");
    expect(role.resolveSignInRole("teacher@pochiu.edu.hk.evil.com", auth)).toBe("student");
  });

  it("AUTH_TEACHER_EMAILS 內的帳戶一律是教師", () => {
    const { auth } = configModule.getServerConfig();
    expect(role.resolveSignInRole("admin@example.com", auth)).toBe("teacher");
  });

  it("AUTH_ADMIN_EMAILS 內的帳戶一律是管理員（優先於教師名單）", () => {
    const { auth } = configModule.getServerConfig();
    expect(role.resolveSignInRole("superadmin@example.com", auth)).toBe("admin");
    expect(role.resolveSignInRole("SuperAdmin@Example.com", auth)).toBe("admin");
  });

  it("同一帳戶的學習者 ID 固定，學生、教師及管理員使用不同前綴", () => {
    expect(role.learnerIdForUser("S2024146@Pochiu.edu.hk", "student")).toBe(
      "school:s2024146@pochiu.edu.hk",
    );
    // 教師與學生的記錄必須分開，因此使用不同前綴
    expect(role.learnerIdForUser("History.Teacher@pochiu.edu.hk", "teacher")).toBe(
      "teacher:history.teacher@pochiu.edu.hk",
    );
    expect(role.learnerIdForUser("Superadmin@example.com", "admin")).toBe(
      "admin:superadmin@example.com",
    );
    expect(role.learnerIdForUser("history.teacher@pochiu.edu.hk", "student")).not.toBe(
      role.learnerIdForUser("history.teacher@pochiu.edu.hk", "teacher"),
    );
  });

  it("由 Google 帳戶建立的 session 會使用對應角色的學習者 ID", () => {
    const { auth } = configModule.getServerConfig();
    const student = role.buildSessionUser(
      { email: "s2024146@pochiu.edu.hk", name: "學生", pictureUrl: null },
      auth,
    );
    const teacher = role.buildSessionUser(
      { email: "history.teacher@pochiu.edu.hk", name: "教師", pictureUrl: null },
      auth,
    );
    const admin = role.buildSessionUser(
      { email: "superadmin@example.com", name: "管理員", pictureUrl: null },
      auth,
    );

    expect(student.role).toBe("student");
    expect(student.learnerId).toBe("school:s2024146@pochiu.edu.hk");
    expect(teacher.role).toBe("teacher");
    expect(teacher.learnerId).toBe("teacher:history.teacher@pochiu.edu.hk");
    expect(admin.role).toBe("admin");
    expect(admin.learnerId).toBe("admin:superadmin@example.com");
  });
});

describe("工作階段 cookie", () => {
  const user = {
    email: "s2024146@pochiu.edu.hk",
    name: "測試學生",
    role: "student" as const,
    learnerId: "school:s2024146@pochiu.edu.hk",
    pictureUrl: null,
  };

  it("簽署後的 cookie 可以還原使用者", () => {
    // 未提供名冊欄位時會補上預設值（名冊未核對）
    expect(session.decodeSession(session.encodeSession(user))).toEqual({
      ...user,
      className: null,
      studentNumber: null,
      rosterVerified: false,
    });
  });

  it("名冊核對後的班別、學號及標示可以完整還原", () => {
    const verified = session.encodeSession({
      ...user,
      name: "陳大文",
      className: "1A",
      studentNumber: "s2024146",
      rosterVerified: true,
    });
    const decoded = session.decodeSession(verified);
    expect(decoded?.className).toBe("1A");
    expect(decoded?.studentNumber).toBe("s2024146");
    expect(decoded?.rosterVerified).toBe(true);
    expect(decoded?.name).toBe("陳大文");
  });

  it("被改動、格式錯誤或已過期的 cookie 一律無效", () => {
    const token = session.encodeSession(user);
    const tampered = `${token.slice(0, -4)}AAAA`;
    expect(session.decodeSession(tampered)).toBeNull();
    expect(session.decodeSession("not-a-token")).toBeNull();
    expect(session.decodeSession(null)).toBeNull();
    expect(session.decodeSession(session.encodeSession(user), Date.now() + 60 * 60 * 1000)).not.toBeNull();
    // 30 天後（超過有效期）會被視為已過期
    expect(session.decodeSession(session.encodeSession(user), Date.now() + 31 * 24 * 60 * 60 * 1000)).toBeNull();
  });

  it("OAuth state cookie 會驗證簽署及到期時間", () => {
    const encoded = session.encodeOAuthState({ state: "abc", verifier: "verifier", next: "/" });
    expect(session.decodeOAuthState(encoded)?.state).toBe("abc");
    expect(session.decodeOAuthState(`${encoded}x`)).toBeNull();
    expect(
      session.decodeOAuthState(
        session.encodeOAuthState({ state: "abc", verifier: "v", next: "/" }),
        Date.now() + 30 * 60 * 1000,
      ),
    ).toBeNull();
  });
});

describe("登入設定", () => {
  it("已設定 Google 憑證時啟用登入，並要求學生登入", () => {
    const { auth } = configModule.getServerConfig();
    expect(auth.enabled).toBe(true);
    expect(auth.requireSignIn).toBe(true);
    expect(auth.schoolDomains).toEqual(["pochiu.edu.hk"]);
    expect(auth.teacherEmails).toEqual(["admin@example.com"]);
    expect(auth.adminEmails).toEqual(["superadmin@example.com"]);
  });

  it("未設定 Google 憑證時不會啟用登入（維持匿名示範模式）", () => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;

    try {
      expect(configModule.getServerConfig().auth.enabled).toBe(false);
    } finally {
      process.env.GOOGLE_CLIENT_ID = clientId;
      process.env.GOOGLE_CLIENT_SECRET = clientSecret;
    }
  });
});

describe("LLM provider 設定", () => {
  it("LLM_PROVIDER=deepseek 時使用 DeepSeek 端點、deepseek-flash 及關閉思考模式", () => {
    process.env.LLM_PROVIDER = "deepseek";
    process.env.DEEPSEEK_API_KEY = "sk-test";
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_THINKING;
    delete process.env.LLM_MAX_TOKENS;

    try {
      const config = configModule.getServerConfig();
      expect(config.llm.provider).toBe("deepseek");
      expect(config.llm.configured).toBe(true);
      expect(config.llm.baseUrl).toBe("https://api.deepseek.com");
      expect(config.llm.model).toBe("deepseek-flash");
      expect(config.llm.thinking).toBe("disabled");
      expect(config.llm.maxTokens).toBe(8192);
      expect(configModule.isDemoLlmMode(config)).toBe(false);

      const resolved = llm.resolveProvider();
      expect(resolved.provider.name).toBe("deepseek");
      expect(resolved.demoMode).toBe(false);
      expect(resolved.provider.label).toContain("DeepSeek");
    } finally {
      delete process.env.LLM_PROVIDER;
      delete process.env.DEEPSEEK_API_KEY;
      delete process.env.LLM_MAX_TOKENS;
    }
  });

  it("可用 LLM_THINKING 及 LLM_MAX_TOKENS 調整 DeepSeek 參數", () => {
    process.env.LLM_PROVIDER = "deepseek";
    process.env.DEEPSEEK_API_KEY = "sk-test";
    process.env.LLM_THINKING = "enabled";
    process.env.LLM_REASONING_EFFORT = "max";
    process.env.LLM_MAX_TOKENS = "off";

    try {
      const config = configModule.getServerConfig();
      expect(config.llm.thinking).toBe("enabled");
      expect(config.llm.reasoningEffort).toBe("max");
      expect(config.llm.maxTokens).toBeNull();
    } finally {
      delete process.env.LLM_PROVIDER;
      delete process.env.DEEPSEEK_API_KEY;
      delete process.env.LLM_THINKING;
      delete process.env.LLM_REASONING_EFFORT;
      delete process.env.LLM_MAX_TOKENS;
    }
  });

  it("其他 provider 未設定時不傳送思考模式及 token 上限", () => {
    process.env.LLM_PROVIDER = "openai-compatible";
    process.env.LLM_API_KEY = "sk-test";
    delete process.env.LLM_THINKING;
    delete process.env.LLM_MAX_TOKENS;

    try {
      const config = configModule.getServerConfig();
      expect(config.llm.provider).toBe("openai-compatible");
      expect(config.llm.thinking).toBeNull();
      expect(config.llm.maxTokens).toBeNull();
    } finally {
      delete process.env.LLM_PROVIDER;
      delete process.env.LLM_API_KEY;
    }
  });

  it("設定了 provider 但沒有 API key 時回退本地示範生成並提供說明", () => {
    process.env.LLM_PROVIDER = "deepseek";
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.LLM_API_KEY;

    try {
      const resolved = llm.resolveProvider();
      expect(resolved.provider.name).toBe("mock");
      expect(resolved.demoMode).toBe(true);
      expect(resolved.notice).toContain("缺少 API key");
    } finally {
      delete process.env.LLM_PROVIDER;
    }
  });
});
