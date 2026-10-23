/**
 * Sprint 13：唯讀 CLI 契約測試（真實副作用，不是 mock 呼叫次數）。
 *
 * 驗證 `golden:export`：
 *   1. `--check` 在資料庫不存在時回 `INSUFFICIENT_EVIDENCE`（exit 2），**不建立**檔案。
 *   2. `--check` 在 migration 0022 未套用時回 exit 2，**不套用 migration**、不建表。
 *   3. `--check` 在 schema 完整時 exit 0，資料庫內容雜湊不變、不寫出檔案。
 *   4. 有 approved 裁決紀錄時，`--check` 不改動任何裁決列。
 *   5. 一般匯出只寫輸出檔，資料庫內容雜湊不變。
 *   6. 輸出路徑是目錄、或 schema 缺失時，錯誤訊息清楚且不寫入。
 *
 * 所有資料庫都是 `%TEMP%` 內的隔離檔案。
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";

import { freshTestDatabasePath } from "./test-database";
import { syntheticCandidates, writeGoldenCandidatesFile } from "./fixtures/golden-candidates";

type Connection = typeof import("@/server/db/connection");
type Migrations = typeof import("@/server/db/migrations");

let connection: Connection;
let migrations: Migrations;

const TSX_CLI = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const SCRIPT = path.join(process.cwd(), "scripts", "export-golden-fixtures.ts");

function runCli(args: string[], databasePath: string) {
  const result = spawnSync(process.execPath, [TSX_CLI, SCRIPT, "--database", databasePath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      APP_DATABASE_PATH: databasePath,
      LLM_PROVIDER: "mock",
      NODE_ENV: "test",
    },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** 移除 WAL／SHM 並將 WAL 內容併回主檔，令雜湊比較只反映資料內容 */
function quiesce(dbPath: string): void {
  // 用原始連線（不經 createDatabase）避免順便套用 migration，破壞測試前提
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  } finally {
    db.close();
  }
}

function hashDatabase(dbPath: string): string {
  quiesce(dbPath);
  return crypto.createHash("sha256").update(fs.readFileSync(dbPath)).digest("hex");
}

function makeMigratedDatabase(): string {
  const dbPath = freshTestDatabasePath("ro-migrated");
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
  const db = connection.createDatabase(dbPath);
  db.close();
  return dbPath;
}

/** 建立「0022 尚未套用」的資料庫，並保持沒有該表 */
function makePreMigrationDatabase(): string {
  const dbPath = makeMigratedDatabase();
  const db = connection.createDatabase(dbPath);
  db.exec("DROP INDEX IF EXISTS idx_golden_fixture_reviews_question");
  db.exec("DROP TABLE IF EXISTS golden_fixture_reviews");
  db.prepare("DELETE FROM schema_migrations WHERE id = ?").run("0022-golden-fixture-reviews");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  db.close();
  return dbPath;
}

function tableExists(dbPath: string, table: string): boolean {
  const db = connection.openReadOnlyDatabase(dbPath);
  try {
    return (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table) !==
      undefined
    );
  } finally {
    db.close();
  }
}

function rows(dbPath: string, sql: string): unknown[] {
  const db = connection.openReadOnlyDatabase(dbPath);
  try {
    return db.prepare(sql).all() as unknown[];
  } finally {
    db.close();
  }
}

beforeAll(async () => {
  connection = await import("@/server/db/connection");
  migrations = await import("@/server/db/migrations");
  expect(fs.existsSync(TSX_CLI), "tsx CLI 存在").toBe(true);
  expect(migrations.MIGRATIONS.length).toBeGreaterThan(0);
  // 候選清單是依版權政策不入庫的產生檔；以合成清單令 CLI 可以完成 schema 完整的路徑
  writeGoldenCandidatesFile(syntheticCandidates(1));
});

describe("golden:export --check 唯讀契約", () => {
  it("資料庫不存在：exit 2（INSUFFICIENT_EVIDENCE），且不建立檔案", () => {
    const dbPath = path.join(path.dirname(freshTestDatabasePath("ro-missing")), "does-not-exist.db");
    fs.rmSync(dbPath, { force: true });

    const run = runCli(["--check"], dbPath);

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("INSUFFICIENT_EVIDENCE");
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it("migration 0022 未套用：exit 2，不套用 migration、不建立表、資料庫雜湊不變", () => {
    const dbPath = makePreMigrationDatabase();
    const before = hashDatabase(dbPath);
    expect(tableExists(dbPath, "golden_fixture_reviews")).toBe(false);

    const run = runCli(["--check"], dbPath);

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("INSUFFICIENT_EVIDENCE");
    expect(run.stderr).toContain("0022");
    expect(tableExists(dbPath, "golden_fixture_reviews")).toBe(false);
    const applied = rows(dbPath, "SELECT id FROM schema_migrations WHERE id = '0022-golden-fixture-reviews'");
    expect(applied).toHaveLength(0);
    expect(hashDatabase(dbPath)).toBe(before);
  });

  it("schema 完整：exit 0，不寫檔、資料庫雜湊不變", () => {
    const dbPath = makeMigratedDatabase();
    const outPath = path.join(path.dirname(dbPath), "should-not-be-written.json");
    fs.rmSync(outPath, { force: true });
    const before = hashDatabase(dbPath);

    const run = runCli(["--check", "--out", outPath], dbPath);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('"mode": "check"');
    expect(run.stdout).toContain('"schemaAvailable": true');
    expect(run.stdout).toContain("--check：沒有寫入資料庫或檔案。");
    expect(fs.existsSync(outPath)).toBe(false);
    expect(hashDatabase(dbPath)).toBe(before);
  });

  it("有 approved 裁決紀錄時，--check 不改動任何裁決列", () => {
    const dbPath = makeMigratedDatabase();
    const db = connection.createDatabase(dbPath);
    db.prepare(
      `INSERT INTO topics (id, title, description, published, sort_order, created_at, updated_at)
       VALUES ('t-ro', '唯讀測試課題', '', 1, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO sections (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       VALUES ('s-ro', 't-ro', NULL, '唯讀測試分節', '', '[]', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO golden_fixture_reviews
         (id, question_id, revision, question_fingerprint, decision, reason,
          reviewer_email, reviewer_role, created_at, payload_json)
       VALUES ('golden-ro-1', 'q-ro', 1, 'fp', 'approved', '測試用裁決', 'teacher@example.com',
               'teacher', '2026-01-02T00:00:00.000Z', NULL)`,
    ).run();
    db.close();

    const before = rows(
      dbPath,
      "SELECT id, decision, revision, question_fingerprint, reviewer_email FROM golden_fixture_reviews",
    );
    expect(before).toHaveLength(1);

    const run = runCli(["--check"], dbPath);

    expect(run.status).toBe(0);
    const after = rows(
      dbPath,
      "SELECT id, decision, revision, question_fingerprint, reviewer_email FROM golden_fixture_reviews",
    );
    expect(after).toEqual(before);
  });
});

describe("golden:export 一般模式：只寫輸出檔", () => {
  it("schema 完整時寫出檔案，資料庫雜湊不變", () => {
    const dbPath = makeMigratedDatabase();
    const outPath = path.join(path.dirname(dbPath), "exported.json");
    fs.rmSync(outPath, { force: true });
    const before = hashDatabase(dbPath);

    const run = runCli(["--out", outPath], dbPath);

    expect(run.status).toBe(0);
    expect(fs.existsSync(outPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(outPath, "utf8")) as {
      version: number;
      questions: unknown[];
      reviewStatus: string;
    };
    expect(written.version).toBe(2);
    expect(written.questions).toEqual([]);
    expect(written.reviewStatus).toBe("pending-review");
    expect(hashDatabase(dbPath)).toBe(before);
  });

  it("schema 缺失時 exit 2，不寫出檔案", () => {
    const dbPath = makePreMigrationDatabase();
    const outPath = path.join(path.dirname(dbPath), "should-not-exist.json");
    fs.rmSync(outPath, { force: true });

    const run = runCli(["--out", outPath], dbPath);

    expect(run.status).toBe(2);
    expect(fs.existsSync(outPath)).toBe(false);
  });

  it("輸出路徑是目錄時錯誤清楚，且不改動資料庫", () => {
    const dbPath = makeMigratedDatabase();
    const outDir = path.join(path.dirname(dbPath), "out-is-a-directory");
    fs.mkdirSync(outDir, { recursive: true });
    const before = hashDatabase(dbPath);

    const run = runCli(["--out", outDir], dbPath);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("目錄");
    expect(hashDatabase(dbPath)).toBe(before);
  });
});
