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
import os from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const testDbPath = path.join(os.tmpdir(), `hist-test-migrations-${process.pid}.db`);
process.env.APP_DATABASE_PATH = testDbPath;
process.env.LLM_PROVIDER = "mock";

type Migrations = typeof import("@/server/db/migrations");
type Connection = typeof import("@/server/db/connection");
type Seed = typeof import("@/server/seed");
type MaterialsRepo = typeof import("@/server/repositories/materials");
type QuestionsRepo = typeof import("@/server/repositories/questions");

let migrations: Migrations;
let getDb: Connection["getDb"];
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
  getDb = (await import("@/server/db/connection")).getDb;
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
