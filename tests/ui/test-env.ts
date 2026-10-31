import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 瀏覽器測試的隔離環境定義。
 *
 * 所有測試資料都放在作業系統暫存目錄下的固定資料夾，測試開始前會整個重建。
 * 正式資料庫、正式上傳目錄及 materials 目錄只會被「讀取並複製」，不會被寫入。
 */
export const UI_TEST_PORT = 3100;
export const UI_TEST_BASE_URL = `http://127.0.0.1:${UI_TEST_PORT}`;

export const UI_TEST_SECRET = "ui-test-only-secret-value-0123456789abcdef";

export const UI_TEST_IDENTITIES = {
  student: "ui-student-0000001@example.test",
  tutorStudent: "s2024001@example.test",
  teacher: "ui-teacher@example.test",
  admin: "ui-admin@example.test",
  reviewer: "ui-reviewer@example.test",
} as const;

export interface UiTestPaths {
  root: string;
  databasePath: string;
  uploadsDir: string;
  materialsDir: string;
  cookiesFile: string;
}

export function projectRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

export function uiTestPaths(): UiTestPaths {
  const root = path.join(os.tmpdir(), "ai-history-ui-test");
  return {
    root,
    databasePath: path.join(root, "app.db"),
    uploadsDir: path.join(root, "uploads"),
    materialsDir: path.join(root, "materials"),
    cookiesFile: path.join(root, "cookies.json"),
  };
}

/** 測試伺服器使用的環境變數（不可指向正式資料庫或正式上傳目錄）。 */
export function uiTestServerEnv(): Record<string, string> {
  const paths = uiTestPaths();
  return {
    APP_DATABASE_PATH: paths.databasePath,
    APP_UPLOADS_DIR: paths.uploadsDir,
    APP_MATERIALS_DIR: paths.materialsDir,
    AUTH_SECRET: UI_TEST_SECRET,
    // 明確設定 Google OAuth 憑證，避免落入匿名示範模式。
    GOOGLE_CLIENT_ID: "ui-test-client-id",
    GOOGLE_CLIENT_SECRET: "ui-test-client-secret",
    AUTH_STAFF_ACCESS_POLICY: "allowlist",
    AUTH_ADMIN_EMAILS: UI_TEST_IDENTITIES.admin,
    AUTH_TEACHER_EMAILS: [UI_TEST_IDENTITIES.teacher, UI_TEST_IDENTITIES.reviewer].join(","),
    HISTORY_REVIEWER_EMAILS: UI_TEST_IDENTITIES.reviewer,
    LLM_PROVIDER: "mock",
    STORAGE_PROVIDER: "local",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

export type UiTestCookies = Record<keyof typeof UI_TEST_IDENTITIES, string>;

export function readTestCookies(): UiTestCookies {
  const paths = uiTestPaths();
  const raw = fs.readFileSync(paths.cookiesFile, "utf8");
  return JSON.parse(raw) as UiTestCookies;
}
