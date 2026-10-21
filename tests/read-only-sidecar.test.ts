/**
 * Sprint 14：唯讀工具副作用驗收（WAL sidecar 政策）。
 *
 * 兩種政策必須分清：
 *   A. **Database-content read-only**：不得改變 schema 或資料，但允許 SQLite 為 WAL 模式
 *      建立／更新必要的 `-wal`、`-shm` sidecar。
 *   B. **Filesystem read-only**：資料庫旁不得出現任何新檔案。
 *
 * 本 Sprint 只證明 A（主檔雜湊、schema、資料列不變；sidecar 只可能是 `-wal`／`-shm`），
 * 並把 B 列為待負責人決定的政策（見 policy-decisions 第 11 項）。
 *
 * 另外驗收 Sprint 14 新增的三份唯讀報告（裁決工作清單、來源交叉分析、Golden 準備度）
 * 在隔離資料庫上不會改動資料庫。
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";

import { freshTestDatabasePath } from "./test-database";

type Connection = typeof import("@/server/db/connection");

let connection: Connection;
const TSX_CLI = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

function runScript(script: string, args: string[], databasePath: string) {
  return spawnSync(process.execPath, [TSX_CLI, script, "--database", databasePath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, APP_DATABASE_PATH: databasePath, LLM_PROVIDER: "mock", NODE_ENV: "test" },
  });
}

function quiesce(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  } finally {
    db.close();
  }
}

function hashMain(dbPath: string): string {
  if (fs.existsSync(`${dbPath}-wal`)) quiesce(dbPath);
  return crypto.createHash("sha256").update(fs.readFileSync(dbPath)).digest("hex");
}

interface Snapshot {
  tables: string[];
  migrations: string[];
  questions: number;
  goldenReviews: number;
  sidecars: string[];
}

function snapshot(dbPath: string): Snapshot {
  const db = connection.openReadOnlyDatabase(dbPath);
  try {
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as unknown as {
        name: string;
      }[]
    ).map((row) => row.name);
    const migrations = (
      db.prepare("SELECT id FROM schema_migrations ORDER BY id").all() as unknown as { id: string }[]
    ).map((row) => row.id);
    const questions = (db.prepare("SELECT COUNT(*) AS c FROM questions").get() as { c: number }).c;
    let goldenReviews = 0;
    if (tables.includes("golden_fixture_reviews")) {
      goldenReviews = (
        db.prepare("SELECT COUNT(*) AS c FROM golden_fixture_reviews").get() as { c: number }
      ).c;
    }
    return {
      tables,
      migrations,
      questions,
      goldenReviews,
      sidecars: ["-wal", "-shm"]
        .filter((suffix) => fs.existsSync(`${dbPath}${suffix}`))
        .map((suffix) => `${path.basename(dbPath)}${suffix}`),
    };
  } finally {
    db.close();
  }
}

function makeMigratedDatabase(withQuestion: boolean): string {
  const dbPath = path.join(
    path.dirname(freshTestDatabasePath("sidecar")),
    `hist-sidecar-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  const db = connection.createDatabase(dbPath);
  if (withQuestion) {
    db.prepare(
      `INSERT INTO topics (id, title, description, published, sort_order, created_at, updated_at)
       VALUES ('t-sidecar', '唯讀測試課題', '', 1, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO sections (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       VALUES ('s-sidecar', 't-sidecar', NULL, '唯讀測試分節', '', '[]', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO questions
         (id, topic_id, section_id, question_type, difficulty, question, correct_answer,
          explanation, knowledge_point, source_excerpt, source_location, origin, status, created_at)
       VALUES ('q-sidecar', 't-sidecar', 's-sidecar', 'mc', 'basic', '測試題目內容', '答案',
               '測試解釋', '測試知識點', '測試節錄', '測試位置', 'manual', 'draft', '2026-01-01T00:00:00.000Z')`,
    ).run();
  }
  db.close();
  quiesce(dbPath);
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });
  return dbPath;
}

beforeAll(async () => {
  connection = await import("@/server/db/connection");
  expect(fs.existsSync(TSX_CLI), "tsx CLI 存在").toBe(true);
});

describe("WAL sidecar 與資料庫內容唯讀（政策 A）", () => {
  it("golden:export --check 不改 schema／資料，只可能有 -wal／-shm sidecar", () => {
    const dbPath = makeMigratedDatabase(true);
    const before = snapshot(dbPath);
    const beforeHash = hashMain(dbPath);
    const beforeEntries = new Set(fs.readdirSync(path.dirname(dbPath)));

    const run = spawnSync(
      process.execPath,
      [TSX_CLI, path.join("scripts", "export-golden-fixtures.ts"), "--database", dbPath, "--check"],
      { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, LLM_PROVIDER: "mock" } },
    );
    expect(run.status).toBe(0);

    const after = snapshot(dbPath);
    const afterHash = hashMain(dbPath);
    expect(afterHash).toBe(beforeHash);
    expect(after.tables).toEqual(before.tables);
    expect(after.migrations).toEqual(before.migrations);
    expect(after.questions).toBe(before.questions);
    expect(after.goldenReviews).toBe(before.goldenReviews);

    // 政策 A：只允許 -wal／-shm 這類 SQLite sidecar；不得出現其他檔案
    const newEntries = fs
      .readdirSync(path.dirname(dbPath))
      .filter((entry) => !beforeEntries.has(entry))
      .filter((entry) => entry.startsWith(path.basename(dbPath)));
    for (const entry of newEntries) {
      expect([`${path.basename(dbPath)}-wal`, `${path.basename(dbPath)}-shm`]).toContain(entry);
    }
  });

  it("缺少 0022 時維持缺表：不建立 golden_fixture_reviews、不改 schema", () => {
    const dbPath = makeMigratedDatabase(true);
    const db = connection.createDatabase(dbPath);
    db.exec("DROP INDEX IF EXISTS idx_golden_fixture_reviews_question");
    db.exec("DROP TABLE IF EXISTS golden_fixture_reviews");
    db.prepare("DELETE FROM schema_migrations WHERE id = ?").run("0022-golden-fixture-reviews");
    db.close();
    quiesce(dbPath);
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });

    const before = snapshot(dbPath);
    const beforeHash = hashMain(dbPath);
    expect(before.tables).not.toContain("golden_fixture_reviews");

    const run = spawnSync(
      process.execPath,
      [TSX_CLI, path.join("scripts", "export-golden-fixtures.ts"), "--database", dbPath, "--check"],
      { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, LLM_PROVIDER: "mock" } },
    );
    expect(run.status).toBe(2);

    const after = snapshot(dbPath);
    expect(after.tables).not.toContain("golden_fixture_reviews");
    expect(after.tables).toEqual(before.tables);
    expect(after.migrations).toEqual(before.migrations);
    expect(hashMain(dbPath)).toBe(beforeHash);
  });
});

describe("Sprint 14 唯讀報告不寫資料庫", () => {
  it("裁決工作清單：產生報告，資料庫不變", () => {
    const dbPath = makeMigratedDatabase(true);
    const outBase = path.join(path.dirname(dbPath), "worklist");
    const before = snapshot(dbPath);
    const beforeHash = hashMain(dbPath);

    const run = runScript("scripts/audit-adjudication-worklist.ts", ["--out", outBase], dbPath);
    expect(run.status).toBe(0);
    expect(fs.existsSync(`${outBase}.json`)).toBe(true);
    expect(fs.existsSync(`${outBase}.md`)).toBe(true);

    const after = snapshot(dbPath);
    expect(after.tables).toEqual(before.tables);
    expect(after.migrations).toEqual(before.migrations);
    expect(after.questions).toBe(before.questions);
    expect(hashMain(dbPath)).toBe(beforeHash);
  });

  it("來源交叉分析：只讀報告，不建立資料庫連線", () => {
    const outBase = path.join(
      path.dirname(freshTestDatabasePath("crosswalk")),
      `crosswalk-${Date.now()}`,
    );
    const run = spawnSync(
      process.execPath,
      [TSX_CLI, path.join("scripts", "audit-source-provenance-crosswalk.ts"), "--out", outBase],
      { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, LLM_PROVIDER: "mock" } },
    );
    expect(run.status).toBe(0);
    expect(fs.existsSync(`${outBase}.json`)).toBe(true);
    const report = JSON.parse(fs.readFileSync(`${outBase}.json`, "utf8")) as {
      totals: { provenanceQuestions: number; sourcePendingQuestions: number };
    };
    expect(report.totals.provenanceQuestions).toBe(623);
    expect(report.totals.sourcePendingQuestions).toBe(1003);
  });

  it("Golden 準備度：產生報告，資料庫與裁決紀錄不變", () => {
    const dbPath = makeMigratedDatabase(true);
    const outBase = path.join(path.dirname(dbPath), "golden-readiness");
    const before = snapshot(dbPath);
    const beforeHash = hashMain(dbPath);

    const run = runScript("scripts/audit-golden-readiness.ts", ["--out", outBase], dbPath);
    expect(run.status).toBe(0);
    expect(fs.existsSync(`${outBase}.json`)).toBe(true);

    const after = snapshot(dbPath);
    expect(after.goldenReviews).toBe(0);
    expect(after.tables).toEqual(before.tables);
    expect(hashMain(dbPath)).toBe(beforeHash);
  });

  it("覆核優先次序 manifest：只列未核對的題目，且資料庫不變（Sprint 15／2026-10-21）", () => {
    const dbPath = makeMigratedDatabase(true);
    const outBase = path.join(path.dirname(dbPath), "review-manifest");
    const before = snapshot(dbPath);
    const beforeHash = hashMain(dbPath);

    const run = runScript("scripts/audit-review-priority-manifest.ts", ["--out", outBase], dbPath);
    expect(run.status).toBe(0);
    const report = JSON.parse(fs.readFileSync(`${outBase}.json`, "utf8")) as {
      totals: {
        sourceRows: number;
        clearedByVerification: number;
        notInDatabase: number;
        rows: number;
        uniqueQuestions: number;
        duplicateRows: number;
      };
    };
    // 2026-10-21：manifest 只列出**尚未按現時版本核對**的題目。
    // 測試資料庫是新鮮的示範題庫，不含來源清單內的校內試題，因此全部落在 notInDatabase，
    // 佇列為 0；已核對的題目不會重生（核對紀錄綁定 revision 及 fingerprint）。
    expect(report.totals.sourceRows).toBe(623);
    expect(report.totals.notInDatabase).toBe(623);
    expect(report.totals.clearedByVerification).toBe(0);
    expect(report.totals.rows).toBe(0);
    expect(report.totals.uniqueQuestions).toBe(0);
    expect(report.totals.duplicateRows).toBe(0);

    const after = snapshot(dbPath);
    expect(after.tables).toEqual(before.tables);
    expect(after.questions).toBe(before.questions);
    expect(hashMain(dbPath)).toBe(beforeHash);
  });
});
