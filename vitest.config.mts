import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // 清除上次執行遺留的暫存測試資料庫（PID 會被作業系統回收，令測試沿用舊資料）。
    // 這是 tests/question-bank-difficulty.test.ts 偶爾失敗的根因，詳見 tests/global-setup.ts。
    globalSetup: ["./tests/global-setup.ts"],
    // 匯入教材的測試會經儲存層寫檔；未指定上載目錄時會寫進專案的 data/uploads，
    // 令真實資料夾累積無用的重複副本，詳見 tests/test-uploads.ts。
    setupFiles: ["./tests/setup-uploads.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
