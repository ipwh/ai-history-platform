/**
 * Vitest `setupFiles`：每個測試檔結束後，刪除它自己的暫存測試資料庫。
 *
 * ── 為甚麼需要 ────────────────────────────────────────────────────────
 * `tests/global-setup.ts` 的清理只在**下一次執行**、而且是「超過 6 小時未更新」時才會
 * 移除舊檔（6 小時是為了不刪到並行執行的測試）。因此每個測試檔留下的資料庫會一直留在
 * 暫存目錄：實測 2026-11-02 一天內約 15 次全套執行已累積 2,903 個檔案、2,273 MB。
 *
 * 這裡在**每個測試檔自己的 afterAll** 立即刪除，常見情況（正常結束）不會留下任何檔案；
 * 程序被強制終止等例外，才由 `global-setup.ts` 的 6 小時清掃作後備。
 *
 * ── 為何放在 setup file 而不是 `tests/test-database.ts` ────────────────
 * `tests/global-setup.ts` 也會匯入 `test-database.ts`，但 globalSetup 不是測試檔，
 * 在該情境註冊 `afterAll` 會因取不到 Vitest 內部狀態而報錯。setup file 只在測試檔
 * 執行時載入，是唯一安全的位置。
 *
 * 刪除前先呼叫 `closeDefaultDatabase()`：Windows 會鎖住仍開啟的 SQLite 檔案
 * （`rmSync` → EPERM），而每個測試檔在隔離的模組環境中執行，關閉連線不影響其他檔案。
 * 個別檔案刪除失敗一律略過，不令測試失敗。
 */
import fs from "node:fs";

import { afterAll } from "vitest";

import {
  forgetCreatedTestDatabasePaths,
  listCreatedTestDatabasePaths,
} from "./test-database";

afterAll(async () => {
  const files = listCreatedTestDatabasePaths();
  forgetCreatedTestDatabasePaths();
  if (files.length === 0) return;

  try {
    const { closeDefaultDatabase } = await import("@/server/db/connection");
    closeDefaultDatabase();
  } catch {
    // 沒有開啟過資料庫（或模組載入失敗）時不需關閉
  }

  for (const file of files) {
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.rmSync(`${file}${suffix}`, { force: true });
      } catch {
        // 仍被鎖住時交由 global-setup.ts 的 6 小時清掃處理
      }
    }
  }
});
