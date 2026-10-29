/**
 * 備份的鎖定防護與重試測試。
 *
 * 驗證：
 *   1. 快照以 `VACUUM INTO` 寫入**暫存目錄**，不會在主資料庫旁邊留下檔案，
 *      亦不會直接複製正在寫入的主資料庫（WAL 下會得到過期或損毀的內容）。
 *   2. 5xx／網絡錯誤以指數退避重試（次數有上限），最終成功。
 *   3. 4xx（權限、bucket 不存在）屬設定問題，立即回報而不重試。
 *   4. 程序被強制終止後殘留的舊快照會被清理。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const databasePath = path.join(os.tmpdir(), `hist-test-backup-retry-${process.pid}.db`);
const snapshotDirectory = path.join(os.tmpdir(), "history-platform-backup");

type BackupModule = typeof import("@/server/db/backup");
type Connection = typeof import("@/server/db/connection");

let backup: BackupModule;
let connection: Connection;

interface StorageStub {
  fetchImpl: typeof fetch;
  attempts: number[];
  bodies: Buffer[];
}

/** 可設定首 N 次失敗的 Cloud Storage 上載 stub */
function createStorageStub(options: { failures?: number; status?: number } = {}): StorageStub {
  const failures = options.failures ?? 0;
  const status = options.status ?? 500;
  const attempts: number[] = [];
  const bodies: Buffer[] = [];

  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    attempts.push(Date.now());
    if (attempts.length <= failures) {
      return new Response("server error", { status });
    }
    if (init?.body) bodies.push(Buffer.from(init.body as Uint8Array));
    return new Response(JSON.stringify({ name: "history/data/app.db" }), { status: 200 });
  }) as unknown as typeof fetch;

  return { fetchImpl, attempts, bodies };
}

const tokenProvider = async () => "stub-token";

beforeEach(async () => {
  process.env.APP_DATABASE_PATH = databasePath;
  process.env.BACKUP_BUCKET = "history-backup-bucket";
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
  backup = await import("@/server/db/backup");
  connection = await import("@/server/db/connection");
  backup.resetBackupStateForTest();
});

afterEach(() => {
  connection.closeDefaultDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
  delete process.env.BACKUP_BUCKET;
});

function seedProbeRow(): void {
  const db = connection.getDb();
  db.exec("CREATE TABLE IF NOT EXISTS backup_probe(id TEXT PRIMARY KEY, note TEXT)");
  db.prepare("INSERT OR REPLACE INTO backup_probe(id, note) VALUES (?, ?)").run("p1", "測試資料");
}

describe("備份快照的鎖定防護", () => {
  it("快照寫入暫存目錄，主資料庫旁邊不會留下備份檔案", async () => {
    seedProbeRow();
    const stub = createStorageStub();

    await backup.backupNow({ fetchImpl: stub.fetchImpl, tokenProvider });

    const leftovers = fs
      .readdirSync(path.dirname(databasePath))
      .filter((name) => name.startsWith(path.basename(databasePath)) && name.endsWith(".backup"));
    expect(leftovers).toEqual([]);
    expect(stub.bodies).toHaveLength(1);
  });

  it("上載的內容解壓後是完整可用的 SQLite 資料庫", async () => {
    seedProbeRow();
    const stub = createStorageStub();

    await backup.backupNow({ fetchImpl: stub.fetchImpl, tokenProvider });

    const uploaded = stub.bodies[0]!;
    // 上載前會 gzip（34 MB → 約 7 MB，實測壓縮比 0.2），上載停住的風險因此大幅降低
    expect(uploaded.subarray(0, 2).toString("latin1")).toBe("\x1f\x8b");
    const restoredPath = path.join(os.tmpdir(), `hist-test-backup-retry-restored-${process.pid}.db`);
    fs.rmSync(restoredPath, { force: true });
    fs.writeFileSync(restoredPath, gunzipSync(uploaded));
    const restored = connection.createDatabase(restoredPath);
    try {
      const row = restored.prepare("SELECT note FROM backup_probe WHERE id = ?").get("p1") as
        | { note: string }
        | undefined;
      expect(row?.note).toBe("測試資料");
    } finally {
      restored.close();
      fs.rmSync(restoredPath, { force: true });
    }
  });

  it("程序被強制終止後殘留的舊快照會被清理", async () => {
    seedProbeRow();
    fs.mkdirSync(snapshotDirectory, { recursive: true });
    const stalePath = path.join(snapshotDirectory, `app-stale-${process.pid}.db`);
    fs.writeFileSync(stalePath, "stale");
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(stalePath, twoHoursAgo, twoHoursAgo);

    const stub = createStorageStub();
    await backup.backupNow({ fetchImpl: stub.fetchImpl, tokenProvider });

    expect(fs.existsSync(stalePath)).toBe(false);
  });
});

describe("上載失敗的重試", () => {
  it("5xx 以指數退避重試，最終成功", async () => {
    seedProbeRow();
    const stub = createStorageStub({ failures: 1, status: 503 });

    const startedAt = Date.now();
    await backup.backupNow({ fetchImpl: stub.fetchImpl, tokenProvider });
    const elapsed = Date.now() - startedAt;

    // 上載只重試一次（UPLOAD_ATTEMPTS=2）：每次嘗試都可能停住數十秒，
    // 而這段時間正卡在某一位使用者的請求之內。
    expect(stub.attempts).toHaveLength(2);
    // 首次失敗後等待 300ms（隨機抖動只會增加）
    expect(elapsed).toBeGreaterThanOrEqual(250);
    const status = backup.getBackupStatus();
    expect(status.lastSuccessAt).not.toBeNull();
    expect(status.lastError).toBeNull();
    expect(status.uploads).toBe(1);
  });

  it("連續失敗時重試次數有上限，不會無限拖延請求", async () => {
    seedProbeRow();
    const stub = createStorageStub({ failures: 10, status: 503 });

    await backup.backupNow({ fetchImpl: stub.fetchImpl, tokenProvider });

    expect(stub.attempts).toHaveLength(2);
    expect(backup.getBackupStatus().lastError).toContain("503");
  });

  it("4xx 屬設定問題，立即回報而不重試", async () => {
    seedProbeRow();
    const stub = createStorageStub({ failures: 10, status: 403 });

    await backup.backupNow({ fetchImpl: stub.fetchImpl, tokenProvider });

    expect(stub.attempts).toHaveLength(1);
    const status = backup.getBackupStatus();
    expect(status.lastSuccessAt).toBeNull();
    expect(status.lastError).toContain("403");
  });

  it("429 屬暫時性錯誤，仍然會重試", async () => {
    seedProbeRow();
    const stub = createStorageStub({ failures: 1, status: 429 });

    await backup.backupNow({ fetchImpl: stub.fetchImpl, tokenProvider });

    expect(stub.attempts).toHaveLength(2);
    expect(backup.getBackupStatus().lastSuccessAt).not.toBeNull();
  });
});
