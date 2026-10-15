/**
 * Cloud Run 相容設定、儲存抽象及健康檢查測試。
 *
 * 驗證：
 *   1. 環境變數驗證會提出清楚的問題說明（缺少憑證、未啟用登入、OCR 設定等）。
 *   2. 本機儲存 provider 可寫入／讀取／刪除，並拒絕跳出儲存目錄的路徑。
 *   3. Cloud Storage provider 尚未實作時會回報清楚的錯誤，而不是靜默失敗。
 *   4. 健康檢查不洩漏資料庫路徑、憑證或任何敏感設定值。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hist-test-storage-"));
process.env.APP_DATABASE_PATH = path.join(tempRoot, "app.db");
process.env.APP_UPLOADS_DIR = path.join(tempRoot, "uploads");
process.env.LLM_PROVIDER = "mock";
delete process.env.ADMIN_TOKEN;

type StorageModule = typeof import("@/server/storage");
type StorageLocalModule = typeof import("@/server/storage/local");
type StorageGcsModule = typeof import("@/server/storage/gcs");
type ConfigDiagnosticsModule = typeof import("@/server/config-diagnostics");

let storageModule: StorageModule;
let localModule: StorageLocalModule;
let gcsModule: StorageGcsModule;
let diagnostics: ConfigDiagnosticsModule;

const originalEnv: Record<string, string | undefined> = {};

function setEnv(name: string, value: string | undefined): void {
  if (!(name in originalEnv)) originalEnv[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeAll(async () => {
  storageModule = await import("@/server/storage");
  localModule = await import("@/server/storage/local");
  gcsModule = await import("@/server/storage/gcs");
  diagnostics = await import("@/server/config-diagnostics");
});

afterEach(() => {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("儲存抽象", () => {
  it("本機 provider 可寫入、讀取及刪除檔案", async () => {
    const provider = new localModule.LocalStorageProvider(path.join(tempRoot, "uploads"));

    const locator = await provider.save("doc_test.docx", Buffer.from("教材內容", "utf8"));
    expect(await provider.exists(locator)).toBe(true);

    const loaded = await provider.read(locator);
    expect(loaded?.toString("utf8")).toBe("教材內容");

    await provider.remove(locator);
    expect(await provider.exists(locator)).toBe(false);
    expect(await provider.read(locator)).toBeNull();
  });

  it("拒絕跳出儲存目錄的路徑，避免任意檔案存取", async () => {
    const provider = new localModule.LocalStorageProvider(path.join(tempRoot, "uploads"));
    await expect(provider.save("../evil.txt", Buffer.from("x"))).rejects.toThrowError(/檔案位置不正確/);
    // 讀取同樣不會離開儲存目錄（既有行為：直接拒絕，而不是回傳 null）
    await expect(provider.read("../../evil.txt")).rejects.toThrowError(/檔案位置不正確/);
  });

  it("資料庫記錄的絕對路徑已失效時，改用檔名在儲存目錄內尋找（專案被搬動後仍可讀取）", async () => {
    const uploadsDir = path.join(tempRoot, "uploads");
    const provider = new localModule.LocalStorageProvider(uploadsDir);
    await provider.save("doc_moved.docx", Buffer.from("教材內容", "utf8"));

    const stalePath = path.join(tempRoot, "old-drive", "uploads", "doc_moved.docx");
    expect(path.isAbsolute(stalePath)).toBe(true);
    expect(await provider.exists(stalePath)).toBe(true);
    expect((await provider.read(stalePath))?.toString("utf8")).toBe("教材內容");
  });

  it("失效的絕對路徑不會令儲存層離開儲存目錄", async () => {
    const uploadsDir = path.join(tempRoot, "uploads");
    const outside = path.join(tempRoot, "outside-secret.txt");
    fs.writeFileSync(outside, "機密");
    const provider = new localModule.LocalStorageProvider(uploadsDir);

    // 儲存目錄以外的檔案不會被讀取（只會以檔名在儲存目錄內尋找）
    expect(await provider.read(outside)).toBeNull();
    expect(await provider.exists(outside)).toBe(false);
  });

  it("未實作 Cloud Storage 時會回報清楚的錯誤並標示未完成", async () => {
    const provider = new gcsModule.GcsStorageProvider("my-bucket");
    expect(provider.implemented).toBe(false);
    expect(provider.persistent).toBe(true);

    await expect(provider.save("doc.docx", Buffer.from("x"))).rejects.toThrowError(
      /尚未實作 Google Cloud Storage/,
    );
    await expect(provider.save("doc.docx", Buffer.from("x"))).rejects.toThrowError(/my-bucket/);
    await expect(provider.save("doc.docx", Buffer.from("x"))).rejects.toThrowError(
      /STORAGE_PROVIDER=local/,
    );
    // exists 只用於健康檢查，未實作時回報 false 而不拋出錯誤
    await expect(provider.exists("gs://my-bucket/doc.docx")).resolves.toBe(false);
  });

  it("依 STORAGE_PROVIDER 解析儲存 provider（預設為本機）", () => {
    setEnv("STORAGE_PROVIDER", undefined);
    expect(storageModule.describeStorage()).toMatchObject({
      provider: "local",
      persistent: false,
      implemented: true,
    });

    setEnv("STORAGE_PROVIDER", "gcs");
    setEnv("GCS_BUCKET", "hist-bucket");
    expect(storageModule.describeStorage()).toMatchObject({
      provider: "gcs",
      persistent: true,
      implemented: false,
    });
  });

  it("removeStoredFile 與 readStoredFile 可安全處理 null", async () => {
    await expect(storageModule.removeStoredFile(null)).resolves.toBeUndefined();
    await expect(storageModule.readStoredFile(null)).resolves.toBeNull();
  });
});

describe("設定驗證", () => {
  it("已設定真實 provider 但缺少 API key 時提出警告", () => {
    setEnv("LLM_PROVIDER", "deepseek");
    setEnv("DEEPSEEK_API_KEY", undefined);
    setEnv("LLM_API_KEY", undefined);

    const issues = diagnostics.describeConfigIssues();
    expect(issues.some((issue) => issue.code === "llm-missing-credentials")).toBe(true);
  });

  it("設定 google-vision 但缺少 OCR_API_KEY 時提出警告", () => {
    setEnv("LLM_PROVIDER", "mock");
    setEnv("OCR_PROVIDER", "google-vision");
    setEnv("OCR_API_KEY", undefined);

    const issues = diagnostics.describeConfigIssues();
    expect(issues.some((issue) => issue.code === "ocr-missing-key")).toBe(true);
  });

  it("未啟用登入時提醒教師端完全開放；本機環境會標示為非永久儲存", () => {
    setEnv("GOOGLE_CLIENT_ID", undefined);
    setEnv("GOOGLE_CLIENT_SECRET", undefined);
    // 使用預設（專案內）路徑，模擬本機開發的實際情況
    setEnv("APP_DATABASE_PATH", undefined);
    setEnv("APP_UPLOADS_DIR", undefined);

    const issues = diagnostics.describeConfigIssues();
    expect(issues.some((issue) => issue.code === "auth-disabled")).toBe(true);

    const deployment = diagnostics.describeDeployment();
    expect(deployment.platform).toBe("local");
    expect(deployment.ephemeralStorage).toBe(true);
  });

  it("偵測 Cloud Run 時會提示需要持久化儲存", () => {
    setEnv("K_SERVICE", "hist-platform");
    try {
      const deployment = diagnostics.describeDeployment();
      expect(deployment.platform).toBe("cloud-run");
      expect(deployment.notes.join(" ")).toContain("Cloud Run");
    } finally {
      setEnv("K_SERVICE", undefined);
    }
  });

  it("應用程式版本來自 package.json", () => {
    expect(diagnostics.appVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("部署目錄沒有教材檔案時提出警告（映像檔可能建置成功但沒有內容）", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "hist-materials-empty-"));
    const withBundle = fs.mkdtempSync(path.join(os.tmpdir(), "hist-materials-bundle-"));
    try {
      // 只有說明檔（等於 Git 內的情況）→ 提出警告
      fs.writeFileSync(path.join(emptyDir, "README.md"), "materials");
      setEnv("APP_MATERIALS_DIR", emptyDir);
      const missing = diagnostics.describeConfigIssues();
      expect(missing.some((issue) => issue.code === "materials-bundle-missing")).toBe(true);

      // 有教材檔案（不顯示檔名）→ 不再警告
      fs.mkdirSync(path.join(withBundle, "課題5 近代歐洲的興起"));
      fs.writeFileSync(path.join(withBundle, "課題5 近代歐洲的興起", "教材.docx"), "x");
      setEnv("APP_MATERIALS_DIR", withBundle);
      const present = diagnostics.describeConfigIssues();
      expect(present.some((issue) => issue.code === "materials-bundle-missing")).toBe(false);
    } finally {
      setEnv("APP_MATERIALS_DIR", undefined);
      fs.rmSync(emptyDir, { recursive: true, force: true });
      fs.rmSync(withBundle, { recursive: true, force: true });
    }
  });
});

describe("健康檢查", () => {
  it("回報狀態但不洩漏資料庫路徑或憑證", async () => {
    setEnv("GOOGLE_CLIENT_ID", undefined);
    setEnv("GOOGLE_CLIENT_SECRET", undefined);
    process.env.DEEPSEEK_API_KEY = "sk-secret-should-not-leak";

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    expect(response.status).toBe(200);

    const text = await response.text();
    const payload = JSON.parse(text) as {
      ok: boolean;
      version: string;
      database: { driver: string; status: string };
      llmProvider: string;
      authEnabled: boolean;
      staffApiOpen: boolean;
    };

    expect(payload.ok).toBe(true);
    expect(payload.database.driver).toBe("sqlite");
    expect(payload.database.status).toBe("ok");
    expect(payload.llmProvider).toBe("mock");
    expect(payload.authEnabled).toBe(false);
    expect(payload.staffApiOpen).toBe(true);

    // 不可洩漏資料庫路徑、上載目錄、API key 或密鑰
    expect(text).not.toContain(tempRoot);
    expect(text).not.toContain("app.db");
    expect(text).not.toContain("sk-secret-should-not-leak");
    expect(text).not.toContain("uploads");
  });

  it("缺少憑證時提供可理解的 provider 說明", async () => {
    setEnv("LLM_PROVIDER", "deepseek");
    setEnv("DEEPSEEK_API_KEY", undefined);
    setEnv("LLM_API_KEY", undefined);

    const { resolveProvider } = await import("@/server/llm");
    const resolved = resolveProvider();
    expect(resolved.provider.name).toBe("mock");
    expect(resolved.demoMode).toBe(true);
    expect(resolved.notice).toContain("缺少 API key");
  });
});

describe("清單型環境變數的分隔符號", () => {
  it("名冊班別範圍可使用分號、逗號或空白分隔（Cloud Run 的 --set-env-vars 以逗號分隔變數）", async () => {
    const { getServerConfig } = await import("@/server/config");
    for (const value of ["1;2;3", "1,2,3", "1 2 3", " 1 ; 2 ; 3 "]) {
      process.env.STUDENT_ROSTER_CLASS_PREFIXES = value;
      const scope = getServerConfig().roster.scope;
      expect(scope.classPrefixes).toEqual(["1", "2", "3"]);
      expect(scope.classes).toEqual([]);
    }
    delete process.env.STUDENT_ROSTER_CLASS_PREFIXES;
  });

  it("未設定時不設班別限制", async () => {
    const { getServerConfig } = await import("@/server/config");
    const scope = getServerConfig().roster.scope;
    expect(scope.classPrefixes).toEqual([]);
    expect(scope.classes).toEqual([]);
  });
});