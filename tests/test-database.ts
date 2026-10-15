/**
 * 測試資料庫路徑（單一來源）。
 *
 * ── 為甚麼需要這個小工具 ──────────────────────────────────────────────
 * 每個測試檔都需要自己的 SQLite 資料庫，而檔案名以 `${process.pid}` 區分。問題是
 * 作業系統會**回收 PID**：若上一次執行的同一個 PID 留下了資料庫檔案，這次執行就會
 * 沿用舊資料（連題目、教材、作答記錄都還在），令測試結果取決於歷史而非程式碼。
 *
 * 這正是 `tests/question-bank-difficulty.test.ts` 偶爾失敗（生成 0 題）的根因：
 * 舊資料庫的題目已經齊備，`generateQuestionBank` 正確地判定無需生成。實測約 4% 執行
 * 機會出現，並在 55 毫秒內失敗。
 *
 * 修法：**在使用資料庫之前，先刪除自己的檔案**（`freshTestDatabasePath`）。
 * 這是確定性的：
 *   - 只刪除自己的路徑（`hist-test-<名稱>-<pid>.db` 及其 WAL／SHM），不會影響其他檔案；
 *   - 平行執行的另一個測試程序有不同 PID，因此不會互相刪除；
 *   - PID 重用不再有害，因為舊檔案在使用前已被刪除；
 *   - Windows／macOS／Linux 皆適用（只用 node:fs 的 rmSync，force 令檔案不存在時不報錯）。
 *
 * `tests/global-setup.ts` 另外會**依檔案年齡**清理遺留的暫存資料庫（見該檔說明），
 * 只作清理用途，不作為隔離手段。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 本測試套件使用的檔名前綴（供清理工具辨識，避免誤刪其他程式或專案的檔案） */
export const TEST_DATABASE_PREFIX = "hist-test-";

/**
 * 取得（並清空）這個測試程序專用的資料庫路徑。
 *
 * @param name 測試檔的短名稱（例如 `learning-loop`），只用於可讀性。
 *   名稱**不可**包含路徑分隔符或 `..`：這個函式只應在作業系統的暫存目錄內建立
 *   （及刪除）檔案，名稱不安全時會直接拋出，避免刪到預期以外的檔案。
 */
export function freshTestDatabasePath(name: string): string {
  const safe = sanitizeTestDatabaseName(name);
  const file = path.join(os.tmpdir(), `${TEST_DATABASE_PREFIX}${safe}-${process.pid}.db`);

  // 第二道防線：即使名稱合法，路徑亦必須留在暫存目錄內
  if (path.resolve(path.dirname(file)) !== path.resolve(os.tmpdir())) {
    throw new Error(`測試資料庫路徑不在暫存目錄內：${file}`);
  }

  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(`${file}${suffix}`, { force: true });
    } catch {
      // 另一個程序持有檔案（例如防毒或並行執行）時不應令測試失敗；
      // 這種情況極少見，而且會在下一次執行自行消失。
    }
  }
  return file;
}

/**
 * 把測試檔短名稱限於安全範圍：不接受空白、路徑分隔符及 `..`（會拋出），
 * 其他字元一律換成 `-`，令 `hist-test-` 前綴及 `.db` 副檔名的判定保持可靠。
 */
function sanitizeTestDatabaseName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error("測試資料庫名稱不可為空");
  if (/[\\/]/.test(trimmed)) throw new Error(`測試資料庫名稱不可包含路徑分隔符：${name}`);
  if (trimmed.includes("..")) throw new Error(`測試資料庫名稱不可包含上層路徑：${name}`);
  return trimmed.replace(/[^A-Za-z0-9._-]/g, "-");
}

/** 這個檔名是否屬於本測試套件的暫存資料庫 */
export function isTestDatabaseFile(fileName: string): boolean {
  if (!fileName.startsWith(TEST_DATABASE_PREFIX)) return false;
  // 只接受單純的檔名（清理工具比對的是暫存目錄內的項目名稱）
  if (/[\\/]/.test(fileName) || fileName.includes("..")) return false;
  return fileName.endsWith(".db") || fileName.endsWith(".db-wal") || fileName.endsWith(".db-shm");
}
