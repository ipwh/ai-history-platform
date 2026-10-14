/**
 * SQLite 連線（使用 Node.js 內建 node:sqlite，無需額外原生依賴）。
 *
 * 所有資料庫存取都集中在 src/server/repositories 及 src/server/db，
 * 其他層（API、服務）不會直接寫 SQL；日後若要改用 Cloud SQL / Firestore，
 * 只需替換這一層。
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

import { getServerConfig } from "../config";
import { runMigrations } from "./migrations";

interface DbGlobal {
  __historyPlatformDb?: DatabaseSync;
  __historyPlatformDbPath?: string;
}

const globalRef = globalThis as unknown as DbGlobal;

function openDatabase(databasePath: string): DatabaseSync {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  runMigrations(db);
  return db;
}

/** 取得（並在首次呼叫時建立）資料庫連線 */
export function getDb(): DatabaseSync {
  const { databasePath } = getServerConfig();
  if (globalRef.__historyPlatformDb && globalRef.__historyPlatformDbPath === databasePath) {
    return globalRef.__historyPlatformDb;
  }
  const db = openDatabase(databasePath);
  globalRef.__historyPlatformDb = db;
  globalRef.__historyPlatformDbPath = databasePath;
  return db;
}

/** 供測試使用的獨立連線（不會影響應用程式的預設連線） */
export function createDatabase(databasePath: string): DatabaseSync {
  return openDatabase(databasePath);
}

/**
 * 資料庫連線狀態（供健康檢查使用）。
 * 只回報驅動名稱及狀態，不會回傳實際檔案路徑，避免洩漏部署資訊。
 */
export function databaseStatus(): { driver: "sqlite"; status: "ok" | "unavailable"; message: string | null } {
  try {
    const row = getDb().prepare("SELECT COUNT(*) AS total FROM topics").get() as unknown as
      | { total: number }
      | undefined;
    return {
      driver: "sqlite",
      status: "ok",
      message: typeof row?.total === "number" ? `${row.total} 個課題` : null,
    };
  } catch (error) {
    return {
      driver: "sqlite",
      status: "unavailable",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function closeDefaultDatabase(): void {
  globalRef.__historyPlatformDb?.close();
  globalRef.__historyPlatformDb = undefined;
  globalRef.__historyPlatformDbPath = undefined;
}

/** node:sqlite 只接受 number / bigint / string / Uint8Array / null */
export function toSqlBool(value: boolean): number {
  return value ? 1 : 0;
}

export function fromSqlBool(value: unknown): boolean {
  return value === 1 || value === true;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** 執行一段交易；發生錯誤時回滾 */
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
