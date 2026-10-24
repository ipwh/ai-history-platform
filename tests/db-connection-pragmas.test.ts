/**
 * SQLite 並發加固測試（WAL + busy_timeout + synchronous=NORMAL）。
 *
 * 這些 PRAGMA 是資料持久性與並發穩定性的基礎：
 *   - `journal_mode = WAL`：讀取不會被寫入鎖阻塞，備份／匯出可在服務運作時進行；
 *   - `busy_timeout = 5000`：另一個程序持有寫入鎖時會等待而不是立即以 SQLITE_BUSY 失敗；
 *   - `synchronous = NORMAL`：WAL 下仍可保證崩潰後資料庫不損毀，同時避免每次交易強制 fsync。
 */
import fs from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { freshTestDatabasePath } from "./test-database";

const databasePath = freshTestDatabasePath("pragmas");
process.env.APP_DATABASE_PATH = databasePath;

type Connection = typeof import("@/server/db/connection");

let connection: Connection;

beforeAll(async () => {
  connection = await import("@/server/db/connection");
});

afterAll(() => {
  connection.closeDefaultDatabase();
});

describe("資料庫連線設定", () => {
  it("啟用 WAL 模式", () => {
    const row = connection.getDb().prepare("PRAGMA journal_mode").get() as unknown as {
      journal_mode: string;
    };
    expect(row.journal_mode.toLowerCase()).toBe("wal");
  });

  it("設定 busy_timeout 為 5000 毫秒", () => {
    const row = connection.getDb().prepare("PRAGMA busy_timeout").get() as unknown as {
      timeout: number;
    };
    expect(Number(row.timeout)).toBe(5000);
  });

  it("設定 synchronous 為 NORMAL", () => {
    const row = connection.getDb().prepare("PRAGMA synchronous").get() as unknown as {
      synchronous: number;
    };
    // 0 = OFF、1 = NORMAL、2 = FULL、3 = EXTRA
    expect(Number(row.synchronous)).toBe(1);
  });

  it("寫入後會產生 WAL 檔（確認確實以 WAL 模式運作）", () => {
    connection.getDb().exec("CREATE TABLE IF NOT EXISTS pragma_probe(id TEXT PRIMARY KEY)");
    connection
      .getDb()
      .prepare("INSERT OR REPLACE INTO pragma_probe(id) VALUES (?)")
      .run("probe-1");
    expect(fs.existsSync(`${databasePath}-wal`)).toBe(true);
  });

  it("第二個連線（例如備份腳本）同樣套用相同的並發設定", () => {
    const second = connection.createDatabase(databasePath);
    try {
      const journal = second.prepare("PRAGMA journal_mode").get() as unknown as {
        journal_mode: string;
      };
      const busy = second.prepare("PRAGMA busy_timeout").get() as unknown as { timeout: number };
      expect(journal.journal_mode.toLowerCase()).toBe("wal");
      expect(Number(busy.timeout)).toBe(5000);
    } finally {
      second.close();
    }
  });
});
