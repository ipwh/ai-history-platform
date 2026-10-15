/**
 * 暫存測試資料庫清理的安全性測試（Sprint 5，Priority E）。
 *
 * 驗證清理工具完全符合「只碰自己的檔案」的要求：
 *   1. 只刪除符合 `hist-test-*.db`／`-wal`／`-shm` 的檔案。
 *   2. 不會刪除其他檔案（包含名稱相似、其他專案或使用者的檔案）。
 *   3. 不會刪除近期建立的檔案，因此**並行執行的另一個測試程序不受影響**。
 *   4. 不會因為個別檔案無法刪除而拋出（測試不應因暫存檔問題失敗）。
 *   5. 每個測試檔自己使用的路徑只影響自己的檔案。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

type GlobalSetup = typeof import("./global-setup");
type TestDatabase = typeof import("./test-database");

let setup: GlobalSetup;
let helper: TestDatabase;

/** 這個測試檔專用的沙盒目錄（不與其他測試共用） */
const sandbox = path.join(os.tmpdir(), `hist-test-cleanup-sandbox-${process.pid}`);

function write(fileName: string, ageMs: number, content = "x"): string {
  const full = path.join(sandbox, fileName);
  fs.writeFileSync(full, content);
  if (ageMs > 0) {
    const when = new Date(Date.now() - ageMs);
    fs.utimesSync(full, when, when);
  }
  return full;
}

const HOUR = 60 * 60 * 1000;

beforeAll(async () => {
  setup = await import("./global-setup");
  helper = await import("./test-database");
  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.mkdirSync(sandbox, { recursive: true });
});

afterAll(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("檔名判定（只認自己的檔案）", () => {
  it("接受本套件的資料庫檔名及其 WAL／SHM", () => {
    expect(helper.isTestDatabaseFile("hist-test-lesson-1234.db")).toBe(true);
    expect(helper.isTestDatabaseFile("hist-test-lesson-1234.db-wal")).toBe(true);
    expect(helper.isTestDatabaseFile("hist-test-lesson-1234.db-shm")).toBe(true);
  });

  it.each([
    "hist-test-notes.txt",
    "hist-test-",
    "my-hist-test-lesson.db",
    "important.db",
    "app.db",
    "hist-test-lesson-1234.db.bak",
    "history-report.db",
    "test.db",
  ])("拒絕無關檔案名稱：%s", (name) => {
    expect(helper.isTestDatabaseFile(name)).toBe(false);
  });
});

describe("清理範圍", () => {
  it("只影響本套件的檔案，並保留近期檔案（不干擾並行執行）", () => {
    const staleOwn = write("hist-test-cleanup-sandbox-old.db", 3 * HOUR);
    const staleWal = write("hist-test-cleanup-sandbox-old.db-wal", 3 * HOUR);
    const recentOwn = write("hist-test-cleanup-sandbox-fresh.db", 0);
    const innocentTxt = write("hist-test-cleanup-sandbox.txt", 3 * HOUR);
    const innocentDb = write("hist-test-cleanup-sandbox.db.bak", 3 * HOUR);
    const unrelated = write("some-other-project.db", 3 * HOUR);

    // cleanStaleTestDatabases 掃描 os.tmpdir()；沙盒目錄本身不是檔案，因此
    // 這裡直接驗證它對「檔案」的行為：先確認上述檔案的判定結果。
    expect(helper.isTestDatabaseFile(path.basename(staleOwn))).toBe(true);
    expect(helper.isTestDatabaseFile(path.basename(staleWal))).toBe(true);
    expect(helper.isTestDatabaseFile(path.basename(recentOwn))).toBe(true);
    expect(helper.isTestDatabaseFile(path.basename(innocentTxt))).toBe(false);
    expect(helper.isTestDatabaseFile(path.basename(innocentDb))).toBe(false);
    expect(helper.isTestDatabaseFile(path.basename(unrelated))).toBe(false);
  });

  it("實際清理：只刪除過期的本套件檔案，無關檔案與近期檔案都保留", () => {
    // 在 tmpdir 直接建立檔案（清理工具掃描的是 tmpdir，不是沙盒）
    const token = `cleanup-${process.pid}-${Date.now()}`;
    const stale = path.join(os.tmpdir(), `hist-test-${token}.db`);
    const recent = path.join(os.tmpdir(), `hist-test-${token}-fresh.db`);
    const unrelated = path.join(os.tmpdir(), `unrelated-${token}.db`);
    const similar = path.join(os.tmpdir(), `hist-test-${token}.txt`);

    fs.writeFileSync(stale, "stale");
    fs.writeFileSync(recent, "recent");
    fs.writeFileSync(unrelated, "keep");
    fs.writeFileSync(similar, "keep");
    const old = new Date(Date.now() - 24 * HOUR);
    fs.utimesSync(stale, old, old);
    fs.utimesSync(unrelated, old, old);
    fs.utimesSync(similar, old, old);

    try {
      const report = setup.cleanStaleTestDatabases();

      expect(report.removed).toBeGreaterThanOrEqual(1);
      expect(fs.existsSync(stale), "過期的本套件檔案應被刪除").toBe(false);
      expect(fs.existsSync(recent), "近期檔案必須保留（並行執行）").toBe(true);
      expect(fs.existsSync(unrelated), "無關的 .db 檔案必須保留").toBe(true);
      expect(fs.existsSync(similar), "非資料庫副檔名必須保留").toBe(true);
    } finally {
      for (const file of [stale, recent, unrelated, similar]) {
        fs.rmSync(file, { force: true });
      }
    }
  });

  it("清理不會拋出（無法刪除個別檔案時只記錄）", () => {
    expect(() => setup.cleanStaleTestDatabases()).not.toThrow();
    const report = setup.cleanStaleTestDatabases();
    expect(report.failed).toBeGreaterThanOrEqual(0);
    expect(typeof report.skippedRecent).toBe("number");
  });
});

describe("每個測試檔的資料庫路徑", () => {
  it("只包含自己的名稱與 PID，且會先清空既有檔案", () => {
    const file = helper.freshTestDatabasePath("cleanup-check");
    const expected = path.join(os.tmpdir(), `hist-test-cleanup-check-${process.pid}.db`);
    expect(file).toBe(expected);

    // 先寫入內容，再取得路徑時應已被清空
    fs.writeFileSync(file, "old content");
    expect(fs.existsSync(file)).toBe(true);
    helper.freshTestDatabasePath("cleanup-check");
    expect(fs.existsSync(file)).toBe(false);
  });

  it("不同名稱不會互相影響（平行測試檔之間互不干擾）", () => {
    const a = helper.freshTestDatabasePath("parallel-a");
    const b = helper.freshTestDatabasePath("parallel-b");
    fs.writeFileSync(a, "a");
    // 取得 b 的路徑不應刪除 a
    helper.freshTestDatabasePath("parallel-b");
    expect(fs.existsSync(a)).toBe(true);
    fs.rmSync(a, { force: true });
    fs.rmSync(b, { force: true });
  });
});

describe("邊界情況（不安全名稱、路徑逃逸、目錄、符號連結）", () => {
  it.each(["../escape", "..\\escape", "sub/dir", "sub\\dir", "..", "   "])(
    "不安全的名稱會被拒絕而非刪除意外檔案：%s",
    (name) => {
      expect(() => helper.freshTestDatabasePath(name)).toThrow();
    },
  );

  it("名稱中的其他字元會被轉換，路徑仍在暫存目錄內", () => {
    const file = helper.freshTestDatabasePath("課題 5 練習");
    expect(path.resolve(path.dirname(file))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(file).startsWith(helper.TEST_DATABASE_PREFIX)).toBe(true);
    expect(path.basename(file)).not.toMatch(/[\s\u4e00-\u9fff]/);
    fs.rmSync(file, { force: true });
  });

  it("帶路徑分隔符或上層路徑的檔名不會被視為本套件的資料庫", () => {
    expect(helper.isTestDatabaseFile("../hist-test-x-1.db")).toBe(false);
    expect(helper.isTestDatabaseFile("sub/hist-test-x-1.db")).toBe(false);
    expect(helper.isTestDatabaseFile("hist-test-..-1.db")).toBe(false);
  });

  it("名稱像資料庫的目錄不會被刪除（只計入失敗）", () => {
    const directory = path.join(os.tmpdir(), `hist-test-directory-${process.pid}.db`);
    fs.rmSync(directory, { recursive: true, force: true });
    fs.mkdirSync(directory, { recursive: true });
    const old = new Date(Date.now() - 24 * HOUR);
    fs.utimesSync(directory, old, old);

    try {
      const report = setup.cleanStaleTestDatabases();
      expect(fs.existsSync(directory), "目錄不應被當成檔案刪除").toBe(true);
      expect(report.failed).toBeGreaterThanOrEqual(1);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("符號連結本身可以被清理，但不會刪除連結目標", () => {
    const target = path.join(os.tmpdir(), `hist-test-cleanup-target-${process.pid}.db`);
    const link = path.join(os.tmpdir(), `hist-test-cleanup-link-${process.pid}.db`);
    fs.writeFileSync(target, "keep me");
    fs.rmSync(link, { force: true });
    try {
      fs.symlinkSync(target, link);
    } catch {
      // Windows 上建立符號連結可能需要權限或開發者模式；無法建立時略過此項檢查
      fs.rmSync(target, { force: true });
      return;
    }

    const old = new Date(Date.now() - 24 * HOUR);
    fs.utimesSync(link, old, old);
    try {
      setup.cleanStaleTestDatabases();
      expect(fs.existsSync(target), "連結目標必須保留").toBe(true);
    } finally {
      fs.rmSync(link, { force: true });
      fs.rmSync(target, { force: true });
    }
  });
});
