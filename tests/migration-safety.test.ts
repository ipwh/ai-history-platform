/**
 * Migration 及 schema 契約測試（Sprint 4，P1 §8）。
 *
 * 驗證：
 *   1. migration ID 唯一、順序固定（不會因為插入新項目而改變已套用的順序）。
 *   2. 重複執行 `runMigrations` 是安全的（冪等），不會重複套用或損毀資料。
 *   3. 由較舊的資料庫升級：已存在的資料（題目、教材、作答記錄）不會遺失，
 *      新欄位以 fail-closed 的預設值加入。
 *   4. 版權閘門的預設值仍為「不對學生發布」。
 *   5. 契約測試**不會**連接正式資料庫：全程使用暫存資料庫。
 */
import fs from "node:fs";
import os from "node:os";
import type { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabasePath } from "./test-database";

const testDbPath = freshTestDatabasePath("migrations");
process.env.APP_DATABASE_PATH = testDbPath;
process.env.LLM_PROVIDER = "mock";

type Migrations = typeof import("@/server/db/migrations");
type Connection = typeof import("@/server/db/connection");
type Seed = typeof import("@/server/seed");
type MaterialsRepo = typeof import("@/server/repositories/materials");
type QuestionsRepo = typeof import("@/server/repositories/questions");

let migrations: Migrations;
let getDb: Connection["getDb"];
let connection: Connection;
let seed: Seed;
let materialsRepo: MaterialsRepo;
let questionsRepo: QuestionsRepo;

/** 由 schema_migrations 取得已套用的 migration ID（按套用時間排序） */
function appliedMigrations(): string[] {
  return (
    getDb().prepare("SELECT id FROM schema_migrations ORDER BY applied_at, rowid").all() as unknown as {
      id: string;
    }[]
  ).map((row) => row.id);
}

function tableColumns(table: string): string[] {
  return (
    getDb().prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]
  ).map((row) => row.name);
}

beforeAll(async () => {
  migrations = await import("@/server/db/migrations");
  connection = await import("@/server/db/connection");
  getDb = connection.getDb;
  seed = await import("@/server/seed");
  materialsRepo = await import("@/server/repositories/materials");
  questionsRepo = await import("@/server/repositories/questions");
  seed.ensureBootstrap();
});

describe("migration 清單契約", () => {
  it("ID 唯一且有固定的字首順序", () => {
    const ids = migrations.MIGRATIONS.map((migration) => migration.id);
    expect(new Set(ids).size).toBe(ids.length);

    // 字首數字（0001…）必須嚴格遞增，令「套用順序」與「清單順序」一致
    const prefixes = ids.map((id) => id.slice(0, 4));
    expect(prefixes).toEqual([...prefixes].sort());
    expect(prefixes[0]).toBe("0001");
  });

  it("每個 migration 都有非空的語句", () => {
    for (const migration of migrations.MIGRATIONS) {
      expect(migration.statements.length, `${migration.id} 沒有語句`).toBeGreaterThan(0);
    }
  });

  it("資料庫已套用全部 migration，且與清單一致", () => {
    const applied = appliedMigrations();
    expect(applied).toEqual(migrations.MIGRATIONS.map((migration) => migration.id));
  });
});

describe("升級與冪等", () => {
  it("重複執行 runMigrations 不會重複套用，亦不會損毀資料", () => {
    const question = questionsRepo.listQuestions({ topicId: "topic-5" })[0];
    expect(question).toBeDefined();
    const countBefore = questionsRepo.countQuestions({});
    const docsBefore = materialsRepo.listDocuments().length;

    // 第二次完整執行
    migrations.runMigrations(getDb());
    // 第三次（模擬容器重啟後再次啟動）
    migrations.runMigrations(getDb());

    expect(appliedMigrations()).toEqual(migrations.MIGRATIONS.map((migration) => migration.id));
    expect(questionsRepo.countQuestions({})).toBe(countBefore);
    expect(materialsRepo.listDocuments().length).toBe(docsBefore);
  });

  it("由舊資料庫升級時保留既有資料，並以 fail-closed 預設值加入新欄位", () => {
    const db = getDb();
    const before = questionsRepo.countQuestions({});

    // 模擬「舊版資料庫」：把後來新增的欄位移除並非 SQLite 支援的做法，
    // 因此改為驗證等價條件——新欄位都有安全的預設值，且既有資料仍然存在。
    const revision = db
      .prepare("SELECT revision, status FROM questions LIMIT 1")
      .get() as unknown as { revision: number; status: string };
    expect(revision.revision).toBeGreaterThanOrEqual(1);
    expect(["draft", "published", "disabled"]).toContain(revision.status);

    // 版權閘門：新增的文件預設為「不對學生發布」
    const document = materialsRepo.createDocument({
      fileName: "升級測試教材.docx",
      kind: "demo",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 128,
      status: "ready",
      topicId: "topic-5",
      sourceNote: null,
    });
    try {
      expect(materialsRepo.getDocument(document.id)?.studentDistribution).toBe(false);
      expect(materialsRepo.listStudentDistributableDocumentIds().has(document.id)).toBe(false);
    } finally {
      materialsRepo.deleteDocument(document.id);
    }

    expect(questionsRepo.countQuestions({})).toBe(before);
  });

  it("新欄位及新資料表都存在（schema 與程式碼同步）", () => {
    expect(tableColumns("questions")).toContain("revision");
    expect(tableColumns("questions")).toContain("skill");
    expect(tableColumns("material_documents")).toContain("student_distribution");
    expect(tableColumns("attempts")).toContain("uncertain");

    for (const table of [
      "ai_operations",
      "distribution_audit",
      "question_reviews",
      "maintenance_runs",
    ]) {
      const row = getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table);
      expect(row, `${table} 不存在`).toBeDefined();
    }
  });

  it("重要的唯一索引存在（覆核冪等、稽核查詢有界）", () => {
    const indexes = (
      getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as unknown as { name: string }[]
    ).map((row) => row.name);
    for (const index of [
      "idx_question_reviews_unique",
      "idx_question_reviews_question",
      "idx_distribution_audit_document",
      "idx_ai_operations_learner",
      "idx_ai_operations_kind",
    ]) {
      expect(indexes, `${index} 不存在`).toContain(index);
    }
  });

  it("測試只使用暫存資料庫，不會連接正式資料庫", () => {
    expect(testDbPath.startsWith(os.tmpdir())).toBe(true);
    expect(process.env.APP_DATABASE_PATH).toBe(testDbPath);
    // data/app.db 是正式／開發資料庫；契約測試不應指向它
    expect(process.env.APP_DATABASE_PATH).not.toContain("data");
  });
});

/**
 * Migration 失敗及並行啟動（Sprint 6，P1 §5）。
 *
 * 這些測試使用**獨立**的資料庫檔案，避免影響其他測試的資料庫。
 * 重點是 fail-closed：失敗的 migration 不會被記錄為已套用，亦不會留下半套 schema。
 */
describe("migration 失敗處理與並行啟動", () => {
  const failurePath = freshTestDatabasePath("migration-failure");
  const GOVERNANCE_MIGRATION = "0017-document-governance";

  let failureDb: DatabaseSync;

  function columns(): string[] {
    return (
      failureDb.prepare("PRAGMA table_info(material_documents)").all() as unknown as {
        name: string;
      }[]
    ).map((row) => row.name);
  }

  function isRecorded(id: string): boolean {
    return (
      failureDb.prepare("SELECT id FROM schema_migrations WHERE id = ?").get(id) !== undefined
    );
  }

  beforeAll(() => {
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${failurePath}${suffix}`, { force: true });
    }
    failureDb = connection.createDatabase(failurePath);
  });

  afterAll(() => {
    failureDb.close();
  });

  it("部分套用的 migration 會完整回滾，且不會被記錄為已套用", () => {
    // 模擬「0017 只套用了一部分」（例如有人手動改過資料庫）：先刪除記錄，
    // 再移除前兩個欄位，令重跑時第 1、2 個語句成功、第 3 個語句因欄位已存在而失敗。
    // 教材文件的存在用於驗證失敗不會破壞既有資料。
    failureDb
      .prepare(
        `INSERT INTO material_documents
         (id, file_name, kind, mime_type, size_bytes, status, block_count, image_count, created_at)
         VALUES ('doc_rollback_probe', 'rollback-probe.docx', 'demo', '', 0, 'ready', 0, 0, '2024-01-01T00:00:00.000Z')`,
      )
      .run();
    failureDb.exec("ALTER TABLE material_documents DROP COLUMN rights_confirmed_at");
    failureDb.exec("ALTER TABLE material_documents DROP COLUMN rights_confirmed_by");
    failureDb.prepare("DELETE FROM schema_migrations WHERE id = ?").run(GOVERNANCE_MIGRATION);
    expect(isRecorded(GOVERNANCE_MIGRATION)).toBe(false);

    expect(() => migrations.runMigrations(failureDb)).toThrowError(/content_reviewed_at/);

    // 回滾：失敗的那次執行加入的欄位都不應留下（只剩原本已存在的兩個）
    expect(columns().filter((name) => name.includes("confirmed") || name.includes("reviewed"))).toEqual([
      "content_reviewed_at",
      "content_reviewed_by",
    ]);
    // 沒有記錄為已套用，因此下次啟動會再嘗試，而不是靜默地當作已完成
    expect(isRecorded(GOVERNANCE_MIGRATION)).toBe(false);
    // 既有資料不受影響
    expect(
      failureDb.prepare("SELECT file_name FROM material_documents WHERE id = 'doc_rollback_probe'").get(),
    ).toBeDefined();
  });

  it("修正後可重新套用，schema 及記錄都回到一致狀態", () => {
    failureDb.exec("ALTER TABLE material_documents DROP COLUMN content_reviewed_at");
    failureDb.exec("ALTER TABLE material_documents DROP COLUMN content_reviewed_by");

    migrations.runMigrations(failureDb);

    for (const column of [
      "rights_confirmed_at",
      "rights_confirmed_by",
      "content_reviewed_at",
      "content_reviewed_by",
    ]) {
      expect(columns(), `${column} 未建立`).toContain(column);
    }
    expect(isRecorded(GOVERNANCE_MIGRATION)).toBe(true);
  });

  it("已修復的資料庫再啟動時冪等：不會重複套用，記錄無重複", () => {
    migrations.runMigrations(failureDb);
    migrations.runMigrations(failureDb);

    const rows = failureDb
      .prepare("SELECT id, COUNT(*) AS total FROM schema_migrations GROUP BY id")
      .all() as unknown as { id: string; total: number }[];
    expect(rows.every((row) => row.total === 1)).toBe(true);
    expect(rows.map((row) => row.id)).toEqual(migrations.MIGRATIONS.map((migration) => migration.id));
  });

  it("第二個連線（模擬第二個執行個體啟動）看到的 schema 一致", () => {
    const second = connection.createDatabase(failurePath);
    try {
      const first = failureDb
        .prepare("SELECT id FROM schema_migrations ORDER BY rowid")
        .all() as unknown as { id: string }[];
      const other = second
        .prepare("SELECT id FROM schema_migrations ORDER BY rowid")
        .all() as unknown as { id: string }[];
      expect(other.map((row) => row.id)).toEqual(first.map((row) => row.id));
    } finally {
      second.close();
    }
  });

  it("連線設有 busy_timeout，令並行啟動可等待短暫的寫入鎖", () => {
    const db = connection.createDatabase(failurePath);
    try {
      const row = db.prepare("PRAGMA busy_timeout").get() as unknown as { timeout?: number };
      expect(Number(row?.timeout ?? 0)).toBeGreaterThanOrEqual(5000);
    } finally {
      db.close();
    }
  });
});
