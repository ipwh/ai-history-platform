import { defineConfig, devices } from "@playwright/test";

import { UI_TEST_BASE_URL, UI_TEST_PORT, uiTestServerEnv } from "./tests/ui/test-env";

/**
 * 瀏覽器測試設定（Sprint 18；Sprint 23 加入可選的 WebKit 專案）。
 *
 * - 預設只使用 Chromium headless，避免下載多個瀏覽器（既有行為不變）。
 * - 設定 `UI_TEST_WEBKIT=1` 時額外加入 WebKit 專案，用來檢查 Safari 引擎的相容性。
 *   **桌面 WebKit 不等同實體舊 iPadOS Safari**，通過亦不可當作已在舊裝置驗證
 *   （見 docs/browser-support.md）。
 * - 伺服器以 `next start` 啟動（需先執行 `npm run build`），環境變數全部指向
 *   暫存目錄的資料庫及上傳資料夾，並明確設定測試專用的教師／審核者名單。
 * - 不使用 `webServer.reuseExistingServer`，避免誤用開發者正在運行的伺服器。
 */
const includeWebkit = process.env.UI_TEST_WEBKIT === "1";

export default defineConfig({
  testDir: "./tests/ui",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    ...(includeWebkit ? [{ name: "webkit", use: { ...devices["Desktop Safari"] } }] : []),
  ],
  use: {
    baseURL: UI_TEST_BASE_URL,
    trace: "off",
    screenshot: "off",
    video: "off",
    locale: "zh-HK",
    timezoneId: "Asia/Hong_Kong",
  },
  webServer: {
    command: `node tests/ui/run-server.mjs`,
    url: UI_TEST_BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...(process.env as Record<string, string>),
      ...uiTestServerEnv(),
      UI_TEST_PORT: String(UI_TEST_PORT),
    },
  },
});
