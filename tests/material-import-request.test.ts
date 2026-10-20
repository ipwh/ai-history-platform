/**
 * 教材匯入請求格式及教材庫診斷欄位。
 *
 * 背景（2026-10-21 實測）：`/admin/materials` 的「匯入全部課程教材」按鈕以
 * `{ fileName: null, all: true }` 呼叫 `POST /api/admin/materials/import`，但該端點的
 * schema 寫成 `z.string().optional()`，`null` 不在允許範圍內，於是介面一直回
 * 「提交的資料格式不正確：fileName：expected string, received null」——即該功能從一開始
 * 就不能用，而學生端因此永遠沒有教材。
 *
 * 這裡守住兩件事：
 *   1. `fileName: null` 一律視為「未提供」（回可理解的 400 而不是格式錯誤）；
 *   2. `GET /api/health` 會回報教材庫數量，令「學生端為甚麼沒有教材」可以直接判斷。
 */
import { beforeAll, describe, expect, it } from "vitest";

import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("material-import-request");
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.LLM_PROVIDER = "mock";
delete process.env.ADMIN_TOKEN;

const ADMIN = {
  email: "admin@example.com",
  name: "測試管理員",
  role: "admin" as const,
  learnerId: "admin:admin@example.com",
  pictureUrl: null,
};

let cookie = "";

function request(url: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  return new Request(`http://localhost:3000${url}`, {
    method: init.method ?? "GET",
    headers: {
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

beforeAll(async () => {
  const session = await import("@/server/auth/session");
  const { ensureBootstrap } = await import("@/server/seed");
  ensureBootstrap();
  cookie = `hk-history-session=${encodeURIComponent(session.encodeSession(ADMIN))}`;
});

describe("教材匯入端點的請求格式", () => {
  it("fileName 為 null 時視為未提供，回可理解的 400 而不是格式錯誤", async () => {
    const { POST } = await import("@/app/api/admin/materials/import/route");
    const response = await POST(
      request("/api/admin/materials/import", {
        method: "POST",
        cookie,
        body: { fileName: null, all: false },
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; details: string[] };
    expect(body.error).toContain("請提供要匯入的教材檔案名稱");
    expect(body.details.join(" ")).not.toContain("expected string");
  });

  it("完全省略 fileName 亦不會被當成格式錯誤", async () => {
    const { POST } = await import("@/app/api/admin/materials/import/route");
    const response = await POST(
      request("/api/admin/materials/import", {
        method: "POST",
        cookie,
        body: { all: false },
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("請提供要匯入的教材檔案名稱");
  });

  it("空白字串同樣視為未提供（不會嘗試匯入不存在的檔名）", async () => {
    const { POST } = await import("@/app/api/admin/materials/import/route");
    const response = await POST(
      request("/api/admin/materials/import", {
        method: "POST",
        cookie,
        body: { fileName: "   ", all: false },
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("請提供要匯入的教材檔案名稱");
  });
});

describe("健康檢查的教材庫概況", () => {
  it("回報文件、段落及可向學生發布的文件數量（只有數字，不含檔名）", async () => {
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      materials?: { documents: number; blocks: number; studentVisibleDocuments: number };
    };
    expect(body.materials).toBeDefined();
    expect(typeof body.materials?.documents).toBe("number");
    expect(typeof body.materials?.blocks).toBe("number");
    expect(typeof body.materials?.studentVisibleDocuments).toBe("number");
    // 學生可見文件數不可能多於總文件數
    expect(body.materials!.studentVisibleDocuments).toBeLessThanOrEqual(body.materials!.documents);
    // 不含檔名或內容（只回報數字）
    expect(JSON.stringify(body.materials)).not.toMatch(/\.docx|\.pdf/);
  });
});
