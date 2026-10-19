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
  __historyPlatformReadOnlyDb?: DatabaseSync;
  __historyPlatformReadOnlyDbPath?: string;
}

const globalRef = globalThis as unknown as DbGlobal;

let readOnlyMode = false;

/**
 * 切換為唯讀模式（Sprint 13）。
 *
 * 唯讀模式下 `getDb()`：
 *   - **不建立**資料庫檔案或目錄（檔案不存在即報錯）；
 *   - **不執行 migration**（缺表時查詢會失敗，由呼叫端如實回報）；
 *   - 以 `readOnly: true` 開啟，任何寫入都會被 SQLite 拒絕。
 *
 * 只供 audit／export／evaluation 等承諾唯讀的 CLI 在匯入服務模組**之前**呼叫。
 * 正常應用程式啟動不會呼叫它，migration 行為不變。
 */
export function enableReadOnlyDatabaseMode(): void {
  readOnlyMode = true;
}

export function isReadOnlyDatabaseMode(): boolean {
  return readOnlyMode;
}

export class ReadOnlyDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadOnlyDatabaseError";
  }
}

/** 以唯讀方式開啟既有資料庫（不會建立檔案、不會執行 migration） */
export function openReadOnlyDatabase(databasePath: string): DatabaseSync {
  if (!fs.existsSync(databasePath)) {
    throw new ReadOnlyDatabaseError(
      `找不到資料庫檔案：${databasePath}。唯讀模式不會建立新資料庫，也不會執行 migration。`,
    );
  }
  const db = new DatabaseSync(databasePath, { readOnly: true });
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}

function openDatabase(databasePath: string): DatabaseSync {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  // 兩個程序（例如備份腳本與伺服器，或同一磁碟上的兩個執行個體）同時啟動時，
  // migration 需要短暫的寫入鎖；沒有 busy_timeout 會立即以 SQLITE_BUSY 失敗。
  db.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(db);
  return db;
}

/** 取得（並在首次呼叫時建立）資料庫連線 */
export function getDb(): DatabaseSync {
  const { databasePath } = getServerConfig();
  if (readOnlyMode) {
    if (
      globalRef.__historyPlatformReadOnlyDb &&
      globalRef.__historyPlatformReadOnlyDbPath === databasePath
    ) {
      return globalRef.__historyPlatformReadOnlyDb;
    }
    const db = openReadOnlyDatabase(databasePath);
    globalRef.__historyPlatformReadOnlyDb = db;
    globalRef.__historyPlatformReadOnlyDbPath = databasePath;
    return db;
  }
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
  globalRef.__historyPlatformReadOnlyDb?.close();
  globalRef.__historyPlatformReadOnlyDb = undefined;
  globalRef.__historyPlatformReadOnlyDbPath = undefined;
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
