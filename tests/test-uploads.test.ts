/**
 * 測試上載目錄的隔離及清理測試。
 *
 * 驗證：
 *   1. 資料夾判定只認本套件的 `hist-test-uploads-<pid>`。
 *   2. `freshTestUploadsDir` 只在作業系統暫存目錄內建立／清空資料夾。
 *   3. 刪除工具只會刪除暫存目錄內的專用資料夾——傳入專案的 `data/uploads`、
 *      暫存目錄本身或其他名稱的資料夾一律不動。
 *   4. 清理工具只刪除超過 6 小時未更新的本套件資料夾（不影響近期及無關的資料夾）。
 *   5. **回歸測試**：測試執行期間的儲存層寫入暫存資料夾，專案的 `data/uploads`
 *      不會因此增加檔案（2026-10-16 實際缺陷：單日累積 463 個孤立副本、3,427 MB）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { freshTestDatabasePath } from "./test-database";
import { freshTestUploadsDir, isTestUploadsDir, removeTestUploadsDir } from "./test-uploads";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("uploads");

type GlobalSetup = typeof import("./global-setup");
type ConfigModule = typeof import("@/server/config");
type StorageModule = typeof import("@/server/storage");

let setup: GlobalSetup;
let configModule: ConfigModule;
let storageModule: StorageModule;

const projectUploadsDir = path.join(process.cwd(), "data", "uploads");

const HOUR = 60 * 60 * 1000;

/** 在作業系統暫存目錄內建立資料夾（清理工具掃描的是暫存目錄），並可設定更新時間 */
function makeDirInTmp(name: string, ageMs = 0): string {
  const full = path.join(os.tmpdir(), name);
  fs.mkdirSync(full, { recursive: true });
  if (ageMs > 0) {
    const when = new Date(Date.now() - ageMs);
    fs.utimesSync(full, when, when);
  }
  return full;
}

beforeAll(async () => {
  setup = await import("./global-setup");
  configModule = await import("@/server/config");
  storageModule = await import("@/server/storage");
});

describe("資料夾判定（只認自己的資料夾）", () => {
  it("接受本套件的暫存上載資料夾名稱", () => {
    expect(isTestUploadsDir("hist-test-uploads-1234")).toBe(true);
    expect(isTestUploadsDir("hist-test-uploads-1")).toBe(true);
  });

  it.each([
    "hist-test-uploads-",
    "hist-test-uploads",
    "hist-test-uploads-notes.txt",
    "hist-test-uploads-1234.db",
    "hist-test-uploads-abc",
    "my-hist-test-uploads-1",
    "hist-test-cleanup-sandbox-1",
    "uploads",
    "data-uploads-1",
  ])("拒絕無關資料夾名稱：%s", (name) => {
    expect(isTestUploadsDir(name)).toBe(false);
  });
});

describe("建立及刪除（不會碰別人的檔案）", () => {
  it("在作業系統暫存目錄內建立本程序專用的資料夾，並先清空舊內容", () => {
    const dir = freshTestUploadsDir();

    expect(path.resolve(path.dirname(dir))).toBe(path.resolve(os.tmpdir()));
    expect(isTestUploadsDir(path.basename(dir))).toBe(true);
    expect(fs.existsSync(dir)).toBe(true);

    // 模擬上一次執行留下的檔案（PID 被回收時的情況）：再次取得時必須已清空
    fs.writeFileSync(path.join(dir, "doc_old.docx"), "舊");
    const again = freshTestUploadsDir();
    expect(again).toBe(dir);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("不會刪除專案的 data/uploads、暫存目錄本身或其他名稱的資料夾", () => {
    const otherName = path.join(os.tmpdir(), `hist-test-uploads-not-ours-${process.pid}`);
    fs.mkdirSync(otherName, { recursive: true });
    fs.writeFileSync(path.join(otherName, "keep.txt"), "keep");

    // 乾淨 checkout 沒有 data/uploads（data/ 不入版本控制），因此不能假設它存在。
    // 契約是「不會被刪除」，也就是狀態不變：本來沒有就不應被建立，本來有就要保留。
    const projectDirExistedBefore = fs.existsSync(projectUploadsDir);

    try {
      removeTestUploadsDir(projectUploadsDir);
      removeTestUploadsDir(os.tmpdir());
      removeTestUploadsDir(otherName);

      expect(fs.existsSync(projectUploadsDir), "專案的 data/uploads 狀態必須不變").toBe(
        projectDirExistedBefore,
      );
      expect(fs.existsSync(os.tmpdir()), "暫存目錄本身必須保留").toBe(true);
      expect(fs.existsSync(path.join(otherName, "keep.txt")), "無關資料夾必須保留").toBe(true);
    } finally {
      fs.rmSync(otherName, { recursive: true, force: true });
    }
  });

  it("刪除本程序專用的資料夾", () => {
    const dir = freshTestUploadsDir();
    fs.writeFileSync(path.join(dir, "doc_tmp.docx"), "暫存");

    removeTestUploadsDir(dir);

    expect(fs.existsSync(dir)).toBe(false);
  });
});

describe("清理範圍", () => {
  it("只刪除過期的本套件資料夾，近期及無關資料夾都保留", () => {
    // 在真正的暫存目錄建立（清理工具掃描的是暫存目錄，不是沙盒）
    // 名稱只含數字（符合本套件的命名規則），並以 pid 為前綴避免與真實執行的資料夾衝突
    const token = process.pid * 1000;
    const stale = makeDirInTmp(`hist-test-uploads-${token}`, 24 * HOUR);
    const recent = makeDirInTmp(`hist-test-uploads-${token + 1}`, 0);
    const similar = makeDirInTmp(`hist-test-uploads-${token}-notes`, 24 * HOUR);
    const unrelated = makeDirInTmp(`hist-test-uploads-sandbox-${token}`, 24 * HOUR);

    try {
      const report = setup.cleanStaleTestUploadDirs();

      expect(report.removed).toBeGreaterThanOrEqual(1);
      expect(fs.existsSync(stale), "過期的本套件資料夾應被刪除").toBe(false);
      expect(fs.existsSync(recent), "近期資料夾必須保留（並行執行）").toBe(true);
      expect(fs.existsSync(similar), "名稱不符的資料夾必須保留").toBe(true);
      expect(fs.existsSync(unrelated), "無關資料夾必須保留").toBe(true);
    } finally {
      for (const dir of [stale, recent, similar, unrelated]) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});

describe("測試環境的上載目錄", () => {
  it("APP_UPLOADS_DIR 指向暫存資料夾，而不是專案的 data/uploads", () => {
    const { uploadsDir } = configModule.getServerConfig();

    expect(process.env.APP_UPLOADS_DIR).toBeTruthy();
    expect(uploadsDir).toBe(process.env.APP_UPLOADS_DIR);
    expect(path.resolve(path.dirname(uploadsDir))).toBe(path.resolve(os.tmpdir()));
    expect(uploadsDir).not.toBe(projectUploadsDir);
  });

  it("儲存層寫入的是暫存資料夾，專案的 data/uploads 不會增加檔案", async () => {
    const { uploadsDir } = configModule.getServerConfig();
    const before = fs.existsSync(projectUploadsDir) ? fs.readdirSync(projectUploadsDir) : [];

    const saved = await storageModule.resolveStorageProvider().save(
      "doc_test-uploads.docx",
      Buffer.from("教材內容", "utf8"),
    );

    expect(path.resolve(path.dirname(saved))).toBe(path.resolve(uploadsDir));
    expect(fs.readFileSync(saved, "utf8")).toBe("教材內容");

    const after = fs.existsSync(projectUploadsDir) ? fs.readdirSync(projectUploadsDir) : [];
    expect(after).toEqual(before);
  });
});
