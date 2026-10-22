/**
 * 資料庫備份與還原測試（免費持久化方案：SQLite 備份到 Cloud Storage）。
 *
 * 驗證：
 *   1. 未設定 BACKUP_BUCKET 時完全不會啟用（本機開發不受影響）。
 *   2. `VACUUM INTO` 快照包含所有資料，且上傳內容與快照一致。
 *   3. 啟動還原：本機沒有資料庫時由雲端還原；已有資料庫時預設不覆蓋。
 *   4. BACKUP_PREFER_CLOUD=true 時以雲端版本為準，並清除舊的 -wal／-shm。
 *   5. 雲端沒有備份時視為全新資料庫；上傳失敗只記錄錯誤，不會拋出例外。
 *   6. 備份狀態不含 bucket 憑證或學生資料。
 *   7. 狀態存放於 `globalThis`，Next.js 的啟動掛勾與 API route handler
 *      即使各自載入模組（不同模組實例）仍共用同一份狀態。
 */
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const databasePath = path.join(os.tmpdir(), `hist-test-backup-${process.pid}.db`);

type BackupModule = typeof import("@/server/db/backup");
type Connection = typeof import("@/server/db/connection");

let backup: BackupModule;
let connection: Connection;

interface UploadedObject {
  name: string;
  body: Buffer;
  authorization: string;
}

/** 以假 fetch 模擬 Cloud Storage（下載／上傳），不需要任何真實憑證 */
function createStorageStub(initial?: Buffer): {
  fetchImpl: typeof fetch;
  uploads: UploadedObject[];
  downloads: string[];
  stored: Map<string, Buffer>;
} {
  const stored = new Map<string, Buffer>();
  if (initial) stored.set("history/data/app.db", initial);
  const uploads: UploadedObject[] = [];
  const downloads: string[] = [];

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const authorization = String((init?.headers as Record<string, string>)?.["authorization"] ?? "");

    if (url.includes("/upload/storage/v1/")) {
      const name = decodeURIComponent(new URL(url).searchParams.get("name") ?? "");
      const body = Buffer.from(init?.body as Uint8Array);
      uploads.push({ name, body, authorization });
      stored.set(name, body);
      return new Response(JSON.stringify({ name }), { status: 200 });
    }
    if (url.includes("storage.googleapis.com")) {
      const objectName = decodeURIComponent(url.replace("https://storage.googleapis.com/", "").split("?")[0]);
      downloads.push(objectName);
      const body = stored.get(objectName.split("/").slice(1).join("/")) ?? stored.get(objectName);
      if (!body) return new Response("not found", { status: 404 });
      return new Response(new Uint8Array(body), { status: 200 });
    }
    return new Response("unexpected", { status: 500 });
  }) as unknown as typeof fetch;

  return { fetchImpl, uploads, downloads, stored };
}

const tokenProvider = async () => "stub-token";

function clearBackupEnv(): void {
  for (const name of [
    "BACKUP_BUCKET",
    "BACKUP_PREFIX",
    "BACKUP_ENABLED",
    "BACKUP_INTERVAL_SECONDS",
    "BACKUP_RESTORE_ON_START",
    "BACKUP_PREFER_CLOUD",
    "BACKUP_MIN_SPACING_SECONDS",
  ]) {
    delete process.env[name];
  }
}

beforeEach(async () => {
  clearBackupEnv();
  process.env.APP_DATABASE_PATH = databasePath;
  delete process.env.BACKUP_BUCKET;
  for (const suffix of ["", "-wal", "-shm", ".backup"]) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
  backup = await import("@/server/db/backup");
  connection = await import("@/server/db/connection");
  backup.resetBackupStateForTest();
});

afterEach(() => {
  connection.closeDefaultDatabase();
  clearBackupEnv();
});

describe("備份設定", () => {
  it("未設定 BACKUP_BUCKET 時不會啟用備份（本機開發不受影響）", async () => {
    const { getServerConfig } = await import("@/server/config");
    expect(getServerConfig().backup.enabled).toBe(false);
    expect(backup.getBackupStatus().enabled).toBe(false);

    const stub = createStorageStub();
    await backup.backupNow({ fetchImpl: stub.fetchImpl, tokenProvider });
    expect(stub.uploads).toHaveLength(0);

    backup.startBackupScheduler({ fetchImpl: stub.fetchImpl, tokenProvider });
    backup.stopBackupScheduler();
  });

  it("設定 bucket 後啟用，並可接受 gs:// 前綴", async () => {
    process.env.BACKUP_BUCKET = "gs://history-backup-bucket/";
    const { getServerConfig } = await import("@/server/config");
    const config = getServerConfig().backup;
    expect(config.enabled).toBe(true);
    expect(config.bucket).toBe("history-backup-bucket");
    expect(backup.backupObjectName(config)).toBe("history/data/app.db");
    expect(backup.getBackupStatus().enabled).toBe(true);
  });

  it("BACKUP_ENABLED=false 會停用備份", async () => {
    process.env.BACKUP_BUCKET = "history-backup-bucket";
    process.env.BACKUP_ENABLED = "false";
    const { getServerConfig } = await import("@/server/config");
    expect(getServerConfig().backup.enabled).toBe(false);
  });
});

describe("快照與上傳", () => {
  it("VACUUM INTO 快照包含所有資料，上傳內容與快照一致", async () => {
    process.env.BACKUP_BUCKET = "history-backup-bucket";
    const db = connection.getDb();
    db.exec("CREATE TABLE IF NOT EXISTS backup_probe(id TEXT PRIMARY KEY, note TEXT)");
    db.prepare("INSERT OR REPLACE INTO backup_probe(id, note) VALUES (?, ?)").run("p1", "測試資料");

    const stub = createStorageStub();
    await backup.backupNow({ fetchImpl: stub.fetchImpl, tokenProvider });

    expect(stub.uploads).toHaveLength(1);
    expect(stub.uploads[0].name).toBe("history/data/app.db");
    expect(stub.uploads[0].authorization).toBe("Bearer stub-token");

    // 上傳的內容是一個可用的 SQLite 資料庫，且包含剛才寫入的資料
    const restoredPath = path.join(os.tmpdir(), `hist-test-backup-restored-${process.pid}.db`);
    fs.rmSync(restoredPath, { force: true });
    fs.writeFileSync(restoredPath, stub.uploads[0].body);
    const restored = connection.createDatabase(restoredPath);
    const row = restored.prepare("SELECT note FROM backup_probe WHERE id = ?").get("p1") as
      | { note: string }
      | undefined;
    expect(row?.note).toBe("測試資料");
    restored.close();
    fs.rmSync(restoredPath, { force: true });

    const status = backup.getBackupStatus();
    expect(status.uploads).toBe(1);
    expect(status.lastSuccessAt).not.toBeNull();
    expect(status.lastError).toBeNull();
    expect(JSON.stringify(status)).not.toContain("token");
    // 快照暫存檔已清理
    expect(fs.existsSync(`${databasePath}.backup`)).toBe(false);
  });

  it("上傳失敗只記錄錯誤，不會拋出例外（網站仍可運作）", async () => {
    process.env.BACKUP_BUCKET = "history-backup-bucket";
    connection.getDb().exec("CREATE TABLE IF NOT EXISTS backup_probe2(id TEXT)");
    const failing = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    await expect(
      backup.backupNow({ fetchImpl: failing, tokenProvider }),
    ).resolves.toBeUndefined();
    expect(backup.getBackupStatus().lastError).toContain("HTTP 500");
  });

  it("未建立資料庫時不會備份（避免上傳空檔案）", async () => {
    process.env.BACKUP_BUCKET = "history-backup-bucket";
    connection.closeDefaultDatabase();
    fs.rmSync(databasePath, { force: true });
    const stub = createStorageStub();
    await backup.backupNow({ fetchImpl: stub.fetchImpl, tokenProvider });
    expect(stub.uploads).toHaveLength(0);
  });
});

describe("還原", () => {
  it("本機沒有資料庫時由雲端還原", async () => {
    process.env.BACKUP_BUCKET = "history-backup-bucket";
    // 先在暫存位置建立來源資料庫，再以它的快照作為雲端備份
    const sourcePath = path.join(os.tmpdir(), `hist-test-backup-source-${process.pid}.db`);
    fs.rmSync(sourcePath, { force: true });
    const source = connection.createDatabase(sourcePath);
    source.exec("CREATE TABLE restore_probe(id TEXT PRIMARY KEY, note TEXT)");
    source.prepare("INSERT INTO restore_probe(id, note) VALUES (?, ?)").run("r1", "雲端資料");
    const snapshotPath = path.join(os.tmpdir(), `hist-test-backup-snapshot-${process.pid}.db`);
    source.prepare("VACUUM INTO ?").run(snapshotPath);
    source.close();
    const snapshot = fs.readFileSync(snapshotPath);

    const stub = createStorageStub(snapshot);
    connection.closeDefaultDatabase();
    fs.rmSync(databasePath, { force: true });

    const outcome = await backup.restoreOnStartup({ fetchImpl: stub.fetchImpl, tokenProvider });
    expect(outcome).toBe("restored");
    expect(stub.downloads[0]).toBe("history-backup-bucket/history/data/app.db");

    connection.closeDefaultDatabase();
    const restored = connection.getDb();
    const row = restored.prepare("SELECT note FROM restore_probe WHERE id = ?").get("r1") as
      | { note: string }
      | undefined;
    expect(row?.note).toBe("雲端資料");

    for (const file of [sourcePath, snapshotPath]) fs.rmSync(file, { force: true });
  });

  it("本機已有資料庫時預設不覆蓋（保護本機開發資料）", async () => {
    process.env.BACKUP_BUCKET = "history-backup-bucket";
    connection.getDb().exec("CREATE TABLE IF NOT EXISTS local_only(id TEXT)");
    const stub = createStorageStub(Buffer.from("not-a-db"));
    const outcome = await backup.restoreOnStartup({ fetchImpl: stub.fetchImpl, tokenProvider });
    expect(outcome).toBe("skipped");
    expect(stub.downloads).toHaveLength(0);
  });

  it("BACKUP_PREFER_CLOUD=true 時以雲端版本為準並清除舊的 WAL", async () => {
    process.env.BACKUP_BUCKET = "history-backup-bucket";
    process.env.BACKUP_PREFER_CLOUD = "true";
    connection.getDb().exec("CREATE TABLE IF NOT EXISTS stale(id TEXT)");
    fs.writeFileSync(`${databasePath}-wal`, "stale-wal");
    connection.closeDefaultDatabase();

    const sourcePath = path.join(os.tmpdir(), `hist-test-backup-source2-${process.pid}.db`);
    fs.rmSync(sourcePath, { force: true });
    const source = connection.createDatabase(sourcePath);
    source.exec("CREATE TABLE cloud_probe(id TEXT PRIMARY KEY)");
    source.prepare("INSERT INTO cloud_probe(id) VALUES (?)").run("cloud-only");
    const snapshotPath = `${sourcePath}.snap`;
    source.prepare("VACUUM INTO ?").run(snapshotPath);
    source.close();

    const stub = createStorageStub(fs.readFileSync(snapshotPath));
    const outcome = await backup.restoreOnStartup({ fetchImpl: stub.fetchImpl, tokenProvider });
    expect(outcome).toBe("restored");
    expect(fs.existsSync(`${databasePath}-wal`)).toBe(false);

    connection.closeDefaultDatabase();
    const restored = connection.getDb();
    expect(
      restored.prepare("SELECT COUNT(*) AS c FROM cloud_probe").get() as { c: number },
    ).toEqual({ c: 1 });

    for (const file of [sourcePath, snapshotPath]) fs.rmSync(file, { force: true });
  });

  it("雲端沒有備份時視為全新資料庫", async () => {
    process.env.BACKUP_BUCKET = "history-backup-bucket";
    connection.closeDefaultDatabase();
    fs.rmSync(databasePath, { force: true });
    const stub = createStorageStub();
    const outcome = await backup.restoreOnStartup({ fetchImpl: stub.fetchImpl, tokenProvider });
    expect(outcome).toBe("skipped");
    expect(backup.getBackupStatus().restoreMessage).toContain("全新資料庫");
  });

  it("還原失敗時不會阻止服務啟動（只記錄狀態）", async () => {
    process.env.BACKUP_BUCKET = "history-backup-bucket";
    connection.closeDefaultDatabase();
    fs.rmSync(databasePath, { force: true });
    const failing = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    const outcome = await backup.restoreOnStartup({ fetchImpl: failing, tokenProvider });
    expect(outcome).toBe("failed");
    expect(backup.getBackupStatus().restoreMessage).toContain("HTTP 500");
  });

  it("下載遇到網絡錯誤時會重試（一次抖動不會令還原失敗）", async () => {
    process.env.BACKUP_BUCKET = "history-backup-bucket";
    process.env.BACKUP_PREFER_CLOUD = "true";
    connection.closeDefaultDatabase();
    fs.rmSync(databasePath, { force: true });
    const stub = createStorageStub(Buffer.from("cloud-backup"));

    let attempts = 0;
    const flaky = (async (input: RequestInfo | URL, init?: RequestInit) => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("fetch failed");
      return stub.fetchImpl(input, init);
    }) as unknown as typeof fetch;

    const outcome = await backup.restoreOnStartup({ fetchImpl: flaky, tokenProvider });
    expect(outcome).toBe("restored");
    expect(attempts).toBe(2);
  });

  it("還原失敗後不會上載備份（避免以空白資料庫覆蓋雲端唯一備份）", async () => {
    process.env.BACKUP_BUCKET = "history-backup-bucket";
    process.env.BACKUP_PREFER_CLOUD = "true";
    connection.closeDefaultDatabase();
    fs.rmSync(databasePath, { force: true });
    const failingRestore = (async () => {
      throw new TypeError("The operation was aborted due to timeout");
    }) as unknown as typeof fetch;
    expect(await backup.restoreOnStartup({ fetchImpl: failingRestore, tokenProvider })).toBe("failed");

    // 執行個體之後建立了新的（空白）資料庫，到期備份仍不可上載
    connection.getDb().exec("CREATE TABLE IF NOT EXISTS fresh_probe(id TEXT)");
    const stub = createStorageStub(Buffer.from("cloud-backup"));
    await backup.backupNow({ fetchImpl: stub.fetchImpl, tokenProvider });

    expect(stub.uploads).toHaveLength(0);
    expect(backup.getBackupStatus().lastError).toContain("暫停上載備份");
  });
});

describe("到期備份（在請求週期內執行，避免 Cloud Run CPU 節流）", () => {
  it("未設定 bucket 或間隔為 0 時不會到期", async () => {
    expect(backup.backupDue()).toBe(false);

    process.env.BACKUP_BUCKET = "history-backup-bucket";
    process.env.BACKUP_INTERVAL_SECONDS = "0";
    expect(backup.backupDue()).toBe(false);
  });

  it("資料未變更時即使超過最短間隔也不會重複備份", async () => {
    process.env.BACKUP_BUCKET = "history-backup-bucket";
    process.env.BACKUP_INTERVAL_SECONDS = "300";
    process.env.BACKUP_MIN_SPACING_SECONDS = "1";
    const stub = createStorageStub();
    connection.getDb().exec("CREATE TABLE IF NOT EXISTS spacing_probe(id TEXT)");

    await backup.backupIfDue({ fetchImpl: stub.fetchImpl, tokenProvider });
    expect(stub.uploads).toHaveLength(1);

    // 已超過最短間隔（1 秒），但資料庫自上次備份後沒有變更 → 不應再上載
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(backup.backupDue()).toBe(false);
    await backup.backupIfDue({ fetchImpl: stub.fetchImpl, tokenProvider });
    expect(stub.uploads).toHaveLength(1);
  });

  it("資料變更後會縮短間隔再備份（縮小資料遺失窗口）", async () => {
    process.env.BACKUP_BUCKET = "history-backup-bucket";
    process.env.BACKUP_INTERVAL_SECONDS = "3600";
    process.env.BACKUP_MIN_SPACING_SECONDS = "1";
    const db = connection.getDb();
    const stub = createStorageStub();

    await backup.backupIfDue({ fetchImpl: stub.fetchImpl, tokenProvider });
    expect(stub.uploads).toHaveLength(1);

    // 寫入新資料 → 檔案時間改變 → 即使未到 3600 秒間隔也應備份
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    db.exec("CREATE TABLE IF NOT EXISTS change_probe(id TEXT)");
    db.prepare("INSERT INTO change_probe(id) VALUES (?)").run("c1");
    expect(backup.backupDue()).toBe(true);
    await backup.backupIfDue({ fetchImpl: stub.fetchImpl, tokenProvider });
    expect(stub.uploads).toHaveLength(2);
  });

  it("到期時才上載，未到期不會重複上載", async () => {
    process.env.BACKUP_BUCKET = "history-backup-bucket";
    process.env.BACKUP_INTERVAL_SECONDS = "300";
    connection.getDb().exec("CREATE TABLE IF NOT EXISTS due_probe(id TEXT)");
    const stub = createStorageStub();

    expect(backup.backupDue()).toBe(true);
    await backup.backupIfDue({ fetchImpl: stub.fetchImpl, tokenProvider });
    expect(stub.uploads).toHaveLength(1);
    expect(backup.getBackupStatus().uploads).toBe(1);

    // 剛完成備份 → 未到期
    expect(backup.backupDue()).toBe(false);
    await backup.backupIfDue({ fetchImpl: stub.fetchImpl, tokenProvider });
    expect(stub.uploads).toHaveLength(1);

    // 模擬經過一個間隔後 → 再次到期
    expect(backup.backupDue(Date.now() + 301_000)).toBe(true);
  });
});

describe("狀態共用（啟動掛勾與 API 各自載入模組時仍一致）", () => {
  it("重新載入模組後仍可讀到同一份備份狀態", async () => {
    process.env.BACKUP_BUCKET = "history-backup-bucket";
    connection.closeDefaultDatabase();
    fs.rmSync(databasePath, { force: true });

    const stub = createStorageStub();
    await backup.restoreOnStartup({ fetchImpl: stub.fetchImpl, tokenProvider });
    expect(backup.getBackupStatus().restore).toBe("skipped");

    // 模擬 Next.js 的 instrumentation 與 route handler 使用不同模組實例
    const { vi } = await import("vitest");
    vi.resetModules();
    const reloaded: BackupModule = await import("@/server/db/backup");
    expect(reloaded.getBackupStatus().restore).toBe("skipped");
    expect(reloaded.getBackupStatus().restoreMessage).toContain("全新資料庫");
  });
});
