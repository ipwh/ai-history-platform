import { defineConfig, devices } from "@playwright/test";

import { UI_TEST_BASE_URL, UI_TEST_PORT, uiTestServerEnv } from "./tests/ui/test-env";

/**
 * 瀏覽器測試設定（Sprint 18）。
 *
 * - 只使用 Chromium headless，避免下載多個瀏覽器。
 * - 伺服器以 `next start` 啟動（需先執行 `npm run build`），環境變數全部指向
 *   暫存目錄的資料庫及上傳資料夾，並明確設定測試專用的教師／審核者名單。
 * - 不使用 `webServer.reuseExistingServer`，避免誤用開發者正在運行的伺服器。
 */
export default defineConfig({
  testDir: "./tests/ui",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: UI_TEST_BASE_URL,
    trace: "off",
    screenshot: "off",
    video: "off",
    locale: "zh-HK",
    timezoneId: "Asia/Hong_Kong",
    ...devices["Desktop Chrome"],
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
