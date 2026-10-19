/**
 * 瀏覽器測試專用的伺服器啟動器。
 *
 * Playwright 會在執行測試檔前先啟動 webServer，因此所有環境準備（暫存資料庫、上傳檔案、
 * 測試 cookie）都必須在啟動伺服器之前完成，並在同一個程序內進行，避免兩者對暫存資料庫競爭。
 *
 * 資料庫來源（依序）：
 *   1. 若存在 `data/app.db`：以唯讀連線執行 `VACUUM INTO`，取得**一致**的單檔快照。
 *      直接複製 `app.db` 連同 `-wal`／`-shm` 會有競態（WAL 正在寫入時複本可能不一致）。
 *      來源檔案的位元組不會被改變（Sprint 19 實測）。
 *   2. 若不存在（例如 CI 沒有內容資料庫）：在暫存目錄建立空資料庫並套用 migration，
 *      令伺服器、授權檢查及頁面仍可被測試；內容相關的斷言會在測試內明確 skip。
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(import.meta.dirname, "..", "..");
const uiRoot = path.join(process.env.TEMP ?? process.env.TMP ?? root, "ai-history-ui-test");
const databasePath = path.join(uiRoot, "app.db");
const uploadsDir = path.join(uiRoot, "uploads");
const materialsDir = path.join(uiRoot, "materials");
const cookiesFile = path.join(uiRoot, "cookies.json");

const PORT = process.env.UI_TEST_PORT ?? "3100";

const env = {
  ...process.env,
  APP_DATABASE_PATH: databasePath,
  APP_UPLOADS_DIR: uploadsDir,
  APP_MATERIALS_DIR: materialsDir,
  AUTH_SECRET: "ui-test-only-secret-value-0123456789abcdef",
  GOOGLE_CLIENT_ID: "ui-test-client-id",
  GOOGLE_CLIENT_SECRET: "ui-test-client-secret",
  AUTH_STAFF_ACCESS_POLICY: "allowlist",
  AUTH_ADMIN_EMAILS: "ui-admin@example.test",
  AUTH_TEACHER_EMAILS: "ui-teacher@example.test,ui-reviewer@example.test",
  HISTORY_REVIEWER_EMAILS: "ui-reviewer@example.test",
  LLM_PROVIDER: "mock",
  STORAGE_PROVIDER: "local",
  NEXT_TELEMETRY_DISABLED: "1",
};

function reset() {
  fs.rmSync(uiRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(materialsDir, { recursive: true });
}

/** 以唯讀連線 + VACUUM INTO 取得一致快照（不產生 sidecar、不改動來源）。 */
function snapshotDatabase(source) {
  const sourceSize = fs.statSync(source).size;
  const handle = new DatabaseSync(source, { readOnly: true });
  try {
    handle.exec(`VACUUM INTO '${databasePath.replace(/\\/g, "/").replace(/'/g, "''")}'`);
  } finally {
    handle.close();
  }

  const after = fs.statSync(source).size;
  if (after !== sourceSize) {
    throw new Error(
      `快照期間來源資料庫大小改變（${sourceSize} → ${after}）；請停止其他寫入後重試。`,
    );
  }

  const copy = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const integrity = copy.prepare("PRAGMA integrity_check").get();
    const value = integrity?.integrity_check;
    if (value !== "ok") throw new Error(`快照 integrity_check 失敗：${JSON.stringify(integrity)}`);
  } finally {
    copy.close();
  }
}

function mintCookies() {
  const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  const result = spawnSync(
    process.execPath,
    [tsxCli, path.join(root, "tests", "ui", "mint-cookies.ts")],
    { cwd: root, env, stdio: "inherit" },
  );
  if (result.status !== 0 || !fs.existsSync(cookiesFile)) {
    throw new Error("測試 cookie 未產生，瀏覽器測試無法進行授權檢查。");
  }
}

try {
  reset();

  const sourceDatabase = process.env.UI_TEST_SOURCE_DB
    ? path.resolve(process.env.UI_TEST_SOURCE_DB)
    : path.join(root, "data", "app.db");
  if (!fs.existsSync(sourceDatabase)) {
    // 內容資料庫（data/）依政策不納入版本控制（第三方版權），因此 GitHub 託管的 CI
    // 沒有可供快照的來源。這裡必須明確失敗，不可改用空資料庫假裝已測試內容行為。
    throw new Error(
      `找不到內容資料庫：${sourceDatabase}。瀏覽器測試需要一份真實（或經核准的）內容資料庫快照；` +
        "請在具備內容的機器或 self-hosted runner 上執行，或以 UI_TEST_SOURCE_DB 指定快照路徑。",
    );
  }
  snapshotDatabase(sourceDatabase);
  console.log("[ui-test] 已由內容資料庫建立一致快照（VACUUM INTO）");
  const sourceUploads = path.join(root, "data", "uploads");
  if (fs.existsSync(sourceUploads)) fs.cpSync(sourceUploads, uploadsDir, { recursive: true });

  mintCookies();
} catch (error) {
  console.error("[ui-test] 環境準備失敗：", error instanceof Error ? error.message : error);
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [path.join(root, "node_modules", "next", "dist", "bin", "next"), "start", "--port", PORT],
  { cwd: root, env, stdio: "inherit" },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 0));
