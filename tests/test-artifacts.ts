/**
 * 測試暫存物件的命名規則（單一來源）。
 *
 * ── 為甚麼需要 ────────────────────────────────────────────────────────
 * 測試套件在作業系統暫存目錄留下**四類**物件，但 `tests/global-setup.ts` 以往只認得
 * 其中兩類（`hist-test-*.db*` 及 `hist-test-uploads-<pid>`）。其餘兩類從不清除，
 * 實測在 2026-11-02 累積 1,229 項（最早可追溯至 2026-10-23）：
 *
 *   | 名稱 | 產生者 | 清理 |
 *   | --- | --- | --- |
 *   | `hist-test-<name>-<pid>.db` / `.db-wal` / `.db-shm` | `freshTestDatabasePath()` | ✅ |
 *   | `hist-test-uploads-<pid>/` | `freshTestUploadsDir()` | ✅ |
 *   | `hist-test-materials-<pid>/` | `tests/fixtures/pilot-material.ts` | ❌ 以往漏掉 |
 *   | `hist-test-storage-<id>/`、`hist-test-secret-<id>/` | `fs.mkdtempSync` | ❌ 以往漏掉 |
 *   | `hist-test-golden-candidates-<pid>.json` | `tests/fixtures/golden-candidates.ts` | ❌ 以往漏掉 |
 *
 * ── 安全規則（與資料庫清理一致，不可放寬）────────────────────────────
 *   1. **只認完整名稱**：必須以 `hist-test-` 開頭；資料庫／候選清單以固定副檔名結尾
 *      （不是「包含關係」，因此 `hist-test-….db.bak`、`my-hist-test-….db`、
 *      `hist-test-….txt` 一律不受影響）；資料夾必須完全符合白名單樣式。
 *   2. **拒絕路徑**：含 `/`、`\` 或 `..` 者一律不接受，清理工具亦只在暫存目錄內操作。
 *   3. **不認得就不刪**：日後新增其他暫存物件時，必須在此登記樣式，否則清理工具
 *      不會碰它——寧可殘留，也不可誤刪。
 */
import { TEST_DATABASE_PREFIX, isTestDatabaseFile } from "./test-database";

export { TEST_DATABASE_PREFIX as TEST_ARTIFACT_PREFIX };

/** 資料夾形式的本套件暫存物件（`<pid>` 或 `mkdtempSync` 的 6 字元隨機後綴） */
const ARTIFACT_DIR_PATTERNS: readonly RegExp[] = [
  /^hist-test-uploads-\d+$/,
  /^hist-test-materials-\d+$/,
  /^hist-test-storage-[a-z0-9]{6}$/i,
  /^hist-test-secret-[a-z0-9]{6}$/i,
];

/** 檔案形式的本套件暫存物件（資料庫以外） */
const ARTIFACT_FILE_PATTERNS: readonly RegExp[] = [
  /^hist-test-golden-candidates-\d+\.json$/,
];

/**
 * 這個名稱是否屬於本測試套件的暫存物件（檔案或資料夾）。
 *
 * `isDirectory` 只用於額外收窄：資料庫副檔名一律接受（與
 * `isTestDatabaseFile` 完全相同，避免兩處規則不一致）；資料夾只接受白名單樣式。
 */
export function isOwnedTestArtifact(fileName: string, isDirectory = false): boolean {
  if (!fileName.startsWith(TEST_DATABASE_PREFIX)) return false;
  if (fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) return false;
  if (ARTIFACT_DIR_PATTERNS.some((pattern) => pattern.test(fileName))) return true;
  if (ARTIFACT_FILE_PATTERNS.some((pattern) => pattern.test(fileName))) return true;
  if (isDirectory) return false;
  return isTestDatabaseFile(fileName);
}
