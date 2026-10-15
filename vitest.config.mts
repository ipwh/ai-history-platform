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
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
