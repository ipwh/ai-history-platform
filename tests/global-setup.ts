/**
 * Vitest 全域設定：清理上一次執行遺留的暫存測試資料庫及暫存上載資料夾。
 *
 * ── 為甚麼需要 ────────────────────────────────────────────────────────
 * 各測試檔以 `${process.pid}` 命名自己的資料庫，而作業系統會**回收 PID**，因此當某次
 * 執行拿到曾用過的 PID 時，可能沿用上一次留下的資料庫。這正是
 * `tests/question-bank-difficulty.test.ts` 偶爾失敗（生成 0 題）的根因。
 *
 * 隔離本身由 `tests/test-database.ts` 的 `freshTestDatabasePath()` 負責（每個測試檔在
 * 使用資料庫前先刪除自己的檔案，屬確定性做法）。這裡只作**清理**，把長期遺留的檔案
 * 移除，避免暫存目錄無限增長。同一道理亦適用於上載資料夾：正常情況由
 * `tests/setup-uploads.ts` 在測試檔結束後刪除，這裡只清理程序被強制終止時留下的資料夾。
 *
 * ── 安全規則（Sprint 5 要求逐項驗證；測試見 tests/test-database-cleanup.test.ts）──
 *   1. **只限本套件的檔案**：檔名必須以 `hist-test-` 開頭，並以 `.db`／`.db-wal`／
 *      `.db-shm` 結尾（見 tests/test-database.ts 的 `isTestDatabaseFile`），或為
 *      `hist-test-uploads-<pid>` 形式的資料夾（見 tests/test-uploads.ts 的
 *      `isTestUploadsDir`）。
 *   2. **不會刪除無關檔案**：比對的是完整檔名（前綴 + 副檔名），不是包含關係，
 *      因此 `hist-test-…txt`、`hist-test-….db.bak`、`my-hist-test-….db`、
 *      其他專案的 `.db` 一律不受影響。
 *   3. **不影響並行執行**：只刪除**超過 6 小時沒有更新**的檔案；並行執行的另一個
 *      vitest 程序，其檔案是數秒前建立的，因此永遠不會被本程序刪除。
 *   4. **跨平台**：只用 node:fs 的 rmSync／readdirSync／statSync 及 path.join，
 *      Windows／macOS／Linux 行為一致（force 令檔案不存在時不報錯）。
 *   5. **失敗不影響測試**：無法讀取或刪除個別檔案時只計數，不會令整套測試失敗。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { isTestDatabaseFile } from "./test-database";
import { isTestUploadsDir } from "./test-uploads";

/**
 * 只清理超過這個時間沒有更新的檔案。
 *
 * 6 小時遠大於任何一次測試執行的長度（本專案約 10 至 30 秒），因此並行執行的檔案
 * 不可能符合條件；而真正被遺棄的檔案（上一次執行後留下）會在數小時後清掉。
 */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export interface CleanupReport {
  /** 符合本套件命名規則的檔案數 */
  candidates: number;
  /** 實際刪除數 */
  removed: number;
  /** 因過於近期而保留（可能屬並行執行的程序） */
  skippedRecent: number;
  /** 無法處理的檔案數 */
  failed: number;
}

/** 清理遺留的暫存測試資料庫；回傳統計供測試及診斷使用 */
export function cleanStaleTestDatabases(now: number = Date.now()): CleanupReport {
  const directory = os.tmpdir();
  const report: CleanupReport = { candidates: 0, removed: 0, skippedRecent: 0, failed: 0 };

  let entries: string[];
  try {
    entries = fs.readdirSync(directory);
  } catch {
    return report;
  }

  for (const entry of entries) {
    if (!isTestDatabaseFile(entry)) continue;
    report.candidates += 1;
    const fullPath = path.join(directory, entry);
    try {
      // lstat：符號連結只看連結本身的時間，不會跟隨到目標（否則會把目標的更新時間
      // 當成連結的時間，甚至把連結目標當成候選檔案刪除）。
      const stats = fs.lstatSync(fullPath);
      if (now - stats.mtimeMs < STALE_AFTER_MS) {
        report.skippedRecent += 1;
        continue;
      }
      fs.rmSync(fullPath, { force: true });
      report.removed += 1;
    } catch {
      report.failed += 1;
    }
  }

  return report;
}

/**
 * 清理遺留的暫存上載資料夾（`hist-test-uploads-<pid>`）。規則與資料庫檔案相同：只處理
 * 名稱符合本套件規則、且超過 `STALE_AFTER_MS` 未更新的項目。
 *
 * 正常情況不會留下這些資料夾（`tests/setup-uploads.ts` 會在測試檔結束後刪除自己的
 * 資料夾），這裡只處理程序被強制終止等例外情況。
 */
export function cleanStaleTestUploadDirs(now: number = Date.now()): CleanupReport {
  const directory = os.tmpdir();
  const report: CleanupReport = { candidates: 0, removed: 0, skippedRecent: 0, failed: 0 };

  let entries: string[];
  try {
    entries = fs.readdirSync(directory);
  } catch {
    return report;
  }

  for (const entry of entries) {
    if (!isTestUploadsDir(entry)) continue;
    report.candidates += 1;
    const fullPath = path.join(directory, entry);
    try {
      // lstat：與資料庫清理相同，只看資料夾／連結本身的時間，不會跟隨符號連結
      const stats = fs.lstatSync(fullPath);
      if (now - stats.mtimeMs < STALE_AFTER_MS) {
        report.skippedRecent += 1;
        continue;
      }
      fs.rmSync(fullPath, { recursive: true, force: true });
      report.removed += 1;
    } catch {
      report.failed += 1;
    }
  }

  return report;
}

export default function globalSetup(): () => void {
  const databases = cleanStaleTestDatabases();
  const uploads = cleanStaleTestUploadDirs();

  if (process.env.VITEST_VERBOSE_SETUP === "1") {
    console.log(
      `[test-setup] 暫存測試資料庫：移除 ${databases.removed}、保留（近期，可能屬並行執行）${databases.skippedRecent}、失敗 ${databases.failed}`,
    );
    console.log(
      `[test-setup] 暫存上載資料夾：移除 ${uploads.removed}、保留（近期，可能屬並行執行）${uploads.skippedRecent}、失敗 ${uploads.failed}`,
    );
  }

  return () => {
    // 執行結束後不刪除其他檔案：並行執行的程序可能仍在使用。
    // 每個測試檔的 DB 由 freshTestDatabasePath 自行處理，上載資料夾由 setup-uploads.ts 處理。
  };
}
