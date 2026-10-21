/**
 * 啟動時自動匯入教材（2026-10-21）。
 *
 * 為甚麼需要：教材檔隨 Docker 映像檔部署，但「匯入」（把內容寫入資料庫）原本是
 * 管理員在瀏覽器按的一步。正式環境資料庫是空教材，於是學生端每個課題都顯示
 * 「尚未匯入教材」，而每次重建容器都要人手重做一次——對只有一般電腦技能的老師
 * 並不合理。
 *
 * 這裡守住的條件：
 *   1. **只在沒有教材時執行**：已有教材（含使用者上載）不會被覆寫；
 *   2. **可重複呼叫**：第二次起直接回傳既有狀態，不會重複匯入；
 *   3. **不假裝成功**：狀態會列出成功／失敗數量及原因。
 *
 * 測試刻意指向一個**空的** materials 資料夾，令測試毫秒完成（不在單元測試內
 * 真的解析 36 份 DOCX）；真正的匯入使用同一支 `importMaterialFromDisk`，
 * 並在部署後以 `/api/health` 的 `materialsAutoImport` 核對。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { freshTestDatabasePath } from "./test-database";

const emptyMaterialsDir = path.join(os.tmpdir(), `empty-materials-${process.pid}`);

process.env.APP_DATABASE_PATH = freshTestDatabasePath("materials-auto-import");
process.env.APP_MATERIALS_DIR = emptyMaterialsDir;
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.LLM_PROVIDER = "mock";
delete process.env.ADMIN_TOKEN;
delete process.env.MATERIAL_AUTO_OPEN_POLICY;

type AutoImportModule = typeof import("@/server/materials/auto-import");
type MaterialsModule = typeof import("@/server/repositories/materials");

let autoImport: AutoImportModule;
let materials: MaterialsModule;

beforeAll(async () => {
  fs.mkdirSync(emptyMaterialsDir, { recursive: true });
  const { ensureBootstrap } = await import("@/server/seed");
  ensureBootstrap();
  autoImport = await import("@/server/materials/auto-import");
  materials = await import("@/server/repositories/materials");
});

describe("啟動時自動匯入教材", () => {
  it("沒有教材也沒有檔案時如實回報 skipped 及原因（不假裝成功）", async () => {
    expect(materials.listDocuments()).toHaveLength(0);
    const status = await autoImport.ensureMaterialsImported();
    expect(status.attempted).toBe(true);
    expect(status.state).toBe("skipped");
    expect(status.message ?? "").toContain("沒有教材檔案");
    expect(status.startedAt).not.toBeNull();
    expect(status.finishedAt).not.toBeNull();
  });

  it("可重複呼叫：第二次不會重新執行，狀態不變", async () => {
    const first = autoImport.materialsAutoImportStatus();
    const second = await autoImport.ensureMaterialsImported();
    expect(second.startedAt).toBe(first.startedAt);
    expect(second.finishedAt).toBe(first.finishedAt);
  });

  it("狀態包含可稽核的數量欄位", () => {
    const status = autoImport.materialsAutoImportStatus();
    expect(typeof status.ready).toBe("number");
    expect(typeof status.failed).toBe("number");
    expect(typeof status.openedForStudents).toBe("number");
    expect(status.documents).toBe(0);
  });

  it("既有教材不會被自動匯入取代（自動匯入只在完全沒有教材時執行）", async () => {
    const existing = materials.createDocument({
      fileName: "使用者上載_課文.docx",
      kind: "uploaded",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 100,
      status: "ready",
      topicId: "topic-1",
      sourceNote: null,
    });
    expect(materials.getDocument(existing.id)).not.toBeNull();
    expect(materials.listDocuments().some((doc) => doc.id === existing.id)).toBe(true);
  });
});
