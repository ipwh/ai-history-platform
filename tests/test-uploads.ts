/**
 * 測試上載目錄（單一來源）。
 *
 * ── 為甚麼需要這個小工具 ──────────────────────────────────────────────
 * 匯入教材的測試會經儲存層把教材副本寫入上載目錄（例如
 * `tests/materials-parsers.test.ts` 把課題5 的 9 MB 教師版課本匯入三次）。各測試檔一直
 * 只設定 `APP_DATABASE_PATH`（各自獨立的暫存資料庫），`APP_UPLOADS_DIR` 則沿用預設值，
 * 因此副本會寫進**專案的** `data/uploads`；測試資料庫被丟棄後，這些副本再無任何引用，
 * 成為真實資料夾內的孤立檔案（實測 2026-10-16 單日累積 463 個檔案、3,427 MB）。
 *
 * 修法：測試一律使用作業系統暫存目錄內的專用上載資料夾。
 *   - `tests/setup-uploads.ts` 在每個測試檔載入前設定 `APP_UPLOADS_DIR` 指向它；
 *   - 資料夾以 `${process.pid}` 命名（與 `freshTestDatabasePath` 相同做法），使用前先
 *     刪除，因此作業系統回收 PID 時不會沿用舊檔案，平行執行的測試程序亦不會互相影響；
 *   - 測試檔結束後由該 setup 檔刪除；程序被強制終止時留下的資料夾，則由
 *     `tests/global-setup.ts` 依檔案年齡清理。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 本測試套件使用的資料夾名（供清理工具辨識，避免誤刪其他程式或專案的資料夾） */
export const TEST_UPLOADS_DIR_PREFIX = "hist-test-uploads-";

/**
 * 取得（並清空）這個測試程序專用的上載資料夾。
 *
 * 只會在作業系統的暫存目錄內建立資料夾；路徑由暫存目錄及程式 PID 組成，不含呼叫者
 * 提供的名稱，因此不可能指向專案或其他位置。
 */
export function freshTestUploadsDir(): string {
  const dir = path.join(os.tmpdir(), `${TEST_UPLOADS_DIR_PREFIX}${process.pid}`);

  // 防線：即使上述組合有意外，路徑亦必須留在暫存目錄內
  if (path.resolve(path.dirname(dir)) !== path.resolve(os.tmpdir())) {
    throw new Error(`測試上載目錄不在暫存目錄內：${dir}`);
  }

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 刪除指定的測試上載資料夾。
 *
 * 只在**兩項條件同時成立**時才會刪除：路徑的父目錄必須是作業系統暫存目錄，且資料夾
 * 名稱符合本套件的命名規則。因此傳入專案的 `data/uploads`、暫存目錄本身或其他程式
 * 的資料夾都不會被碰。刪除失敗（例如檔案被鎖定）不會拋出，避免令測試因此失敗。
 */
export function removeTestUploadsDir(dir: string): void {
  const resolved = path.resolve(dir);
  if (path.resolve(path.dirname(resolved)) !== path.resolve(os.tmpdir())) return;
  if (!isTestUploadsDir(path.basename(resolved))) return;

  try {
    fs.rmSync(resolved, { recursive: true, force: true });
  } catch {
    // 略過：清理失敗不應令測試失敗
  }
}

/** 這個資料夾名是否屬於本測試套件的暫存上載資料夾（`hist-test-uploads-<pid>`） */
export function isTestUploadsDir(dirName: string): boolean {
  return new RegExp(`^${TEST_UPLOADS_DIR_PREFIX}\\d+$`).test(dirName);
}
