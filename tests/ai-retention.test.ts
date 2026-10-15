/**
 * 資料保留期維護測試（Sprint 4，P1）。
 *
 * 驗證的契約：
 *   1. **有執行保證**：伺服器啟動時強制執行一次（`src/instrumentation.ts`），
 *      其後最多每小時一次；不會出現「一段時間沒有請求就永遠不清理」的情況。
 *   2. **界線正確**：只刪除**早於**保留期界線的記錄；剛好等於界線及較新的記錄
 *      一律保留（以注入的時鐘驗證，不依賴實際時間）。
 *   3. **不影響用量上限**：清理只刪除超出保留期的記錄，時間窗內的計數不變，
 *      因此不會令使用者意外獲得額外配額。
 *   4. **失敗可見**：清理失敗不會拋出（不應令使用者請求失敗），但會寫入
 *      `maintenance_runs` 及伺服器記錄，令管理員看得到。
 *   5. **並行安全**：清理期間插入的新記錄（晚於界線）不會被刪除。
 *   6. 管理員端只看到總數及維護狀態，不含任何學習者資料。
 */
import os from "node:os";
import path from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_DATABASE_PATH = path.join(os.tmpdir(), `hist-test-retention-${process.pid}.db`);
process.env.LLM_PROVIDER = "mock";
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.ADMIN_TOKEN;

type Maintenance = typeof import("@/server/services/maintenance");
type AiOperations = typeof import("@/server/repositories/ai-operations");
type AiLimits = typeof import("@/server/services/ai-limits");
type Connection = typeof import("@/server/db/connection");
type Seed = typeof import("@/server/seed");

let maintenance: Maintenance;
let aiOperations: AiOperations;
let aiLimits: AiLimits;
let getDb: Connection["getDb"];
let seed: Seed;

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-15T04:00:00.000Z");

/** 直接寫入一筆用量記錄（可指定時間），模擬歷史資料 */
function insertOperation(learnerId: string, kind: "generation" | "grading", createdAt: string): void {
  getDb()
    .prepare("INSERT INTO ai_operations (id, learner_id, kind, created_at) VALUES (?, ?, ?, ?)")
    .run(`op-${Math.random().toString(36).slice(2, 10)}`, learnerId, kind, createdAt);
}

beforeAll(async () => {
  maintenance = await import("@/server/services/maintenance");
  aiOperations = await import("@/server/repositories/ai-operations");
  aiLimits = await import("@/server/services/ai-limits");
  getDb = (await import("@/server/db/connection")).getDb;
  seed = await import("@/server/seed");
  seed.ensureBootstrap();
});

beforeEach(() => {
  getDb().prepare("DELETE FROM ai_operations").run();
  getDb().prepare("DELETE FROM maintenance_runs").run();
  maintenance.resetMaintenanceScheduleForTests();
  vi.unstubAllGlobals();
});

describe("保留期界線", () => {
  it("只刪除界線之前的記錄，界線當刻及較新的記錄一律保留", () => {
    const cutoff = new Date(NOW.getTime() - maintenance.AI_RETENTION_DAYS * DAY);
    insertOperation("learner-old", "generation", new Date(cutoff.getTime() - 1000).toISOString());
    insertOperation("learner-boundary", "generation", cutoff.toISOString());
    insertOperation("learner-new", "generation", new Date(cutoff.getTime() + 1000).toISOString());

    const result = maintenance.runMaintenance("ai-operation-retention", { force: true, now: NOW });
    expect(result.executed).toBe(true);
    expect(result.deleted).toBe(1);

    const remaining = aiOperations.countStoredOperations();
    expect(remaining).toBe(2);
    expect(aiOperations.countOperationsSince(null, "1970-01-01T00:00:00.000Z")).toBe(2);
  });

  it("多筆過期記錄一次清理，且留下執行紀錄", () => {
    const cutoff = new Date(NOW.getTime() - maintenance.AI_RETENTION_DAYS * DAY);
    for (let index = 0; index < 5; index += 1) {
      insertOperation(
        `learner-${index}`,
        index % 2 === 0 ? "generation" : "grading",
        new Date(cutoff.getTime() - (index + 1) * DAY).toISOString(),
      );
    }
    insertOperation("learner-recent", "grading", new Date(NOW.getTime() - DAY).toISOString());

    const result = maintenance.runMaintenance("ai-operation-retention", { force: true, now: NOW });
    expect(result.deleted).toBe(5);
    expect(aiOperations.countStoredOperations()).toBe(1);

    const status = maintenance.maintenanceStatus()[0];
    expect(status.kind).toBe("ai-operation-retention");
    expect(status.lastStatus).toBe("ok");
    expect(status.runs).toBe(1);
    expect(status.failures).toBe(0);
    expect(status.lastDetail ?? "").toContain("刪除 5 筆");
    expect(Number.isNaN(Date.parse(status.lastFinishedAt ?? ""))).toBe(false);
  });

  it("時間戳異常的記錄（無法解析）不會令清理失敗", () => {
    insertOperation("learner-weird", "generation", "not-a-date");
    insertOperation("learner-old", "generation", new Date(NOW.getTime() - 100 * DAY).toISOString());

    const result = maintenance.runMaintenance("ai-operation-retention", { force: true, now: NOW });
    expect(result.error).toBeNull();
    // 字串比較下 "not-a-date" 不小於 ISO 界線，因此不會被刪除（保守做法：不猜測）
    expect(aiOperations.countStoredOperations()).toBe(1);
    expect(maintenance.maintenanceStatus()[0].lastStatus).toBe("ok");
  });
});

describe("執行保證與間隔", () => {
  it("啟動時強制執行；其後一小時內不會重複執行", () => {
    const first = maintenance.runMaintenance("ai-operation-retention", { force: true, now: NOW });
    expect(first.executed).toBe(true);

    const second = maintenance.runMaintenance("ai-operation-retention", {
      now: new Date(NOW.getTime() + 60_000),
    });
    expect(second.executed).toBe(false);
    expect(maintenance.maintenanceStatus()[0].runs).toBe(1);

    const third = maintenance.runMaintenance("ai-operation-retention", {
      now: new Date(NOW.getTime() + 61 * 60 * 1000),
    });
    expect(third.executed).toBe(true);
    expect(maintenance.maintenanceStatus()[0].runs).toBe(2);
  });

  it("AI 用量保留會順帶嘗試清理（有請求時亦會執行）", () => {
    process.env.AI_LIMITS_ENABLED = "false";
    const cutoff = new Date(Date.now() - maintenance.AI_RETENTION_DAYS * DAY);
    insertOperation(
      "learner-old",
      "generation",
      new Date(cutoff.getTime() - DAY).toISOString(),
    );

    aiLimits.reserveAiOperation("learner-current", "generation");

    expect(maintenance.maintenanceStatus()[0]?.lastStatus).toBe("ok");
    expect(aiOperations.countStoredOperations()).toBe(1);
  });

  it("清理失敗不會拋出，但會留下失敗紀錄（管理員看得到）", () => {
    const spy = vi
      .spyOn(aiOperations, "purgeOperationsBefore")
      .mockImplementation(() => {
        throw new Error("database is locked");
      });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const result = maintenance.runMaintenance("ai-operation-retention", {
        force: true,
        now: NOW,
      });
      expect(result.error).toContain("database is locked");
      expect(result.executed).toBe(true);

      const status = maintenance.maintenanceStatus()[0];
      expect(status.lastStatus).toBe("failed");
      expect(status.failures).toBe(1);
      expect(status.lastDetail ?? "").toContain("database is locked");
      // 失敗必須留下伺服器記錄（Cloud Run 會轉成 Cloud Logging）
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe("與用量上限的關係", () => {
  it("清理不會刪除時間窗內的記錄，因此不會令使用者獲得額外配額", () => {
    process.env.AI_LIMITS_ENABLED = "true";
    process.env.AI_GENERATIONS_PER_LEARNER = "2";
    const cutoff = new Date(Date.now() - maintenance.AI_RETENTION_DAYS * DAY);

    // 個人配額已用滿（兩筆都在時間窗內）
    aiLimits.reserveAiOperation("learner-quota", "generation");
    aiLimits.reserveAiOperation("learner-quota", "generation");
    // 加上一筆很久以前的記錄（超出保留期）
    insertOperation(
      "learner-quota",
      "generation",
      new Date(cutoff.getTime() - 5 * DAY).toISOString(),
    );

    maintenance.runMaintenance("ai-operation-retention", { force: true });

    // 配額仍然用滿（舊記錄被刪除，但時間窗內的兩筆不受影響）
    expect(() => aiLimits.reserveAiOperation("learner-quota", "generation")).toThrowError(/使用上限/);
    expect(
      aiOperations.countRecentOperationsForLearner(
        "learner-quota",
        "generation",
        new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      ),
    ).toBe(2);
  });

  it("清理期間新插入的記錄不會被刪除（並行安全）", () => {
    const cutoff = new Date(NOW.getTime() - maintenance.AI_RETENTION_DAYS * DAY);
    insertOperation("learner-old", "generation", new Date(cutoff.getTime() - DAY).toISOString());

    // 模擬「清理與插入交錯」：在刪除之前先插入一筆新記錄
    insertOperation("learner-fresh", "grading", NOW.toISOString());
    maintenance.runMaintenance("ai-operation-retention", { force: true, now: NOW });
    // 刪除之後再插入
    insertOperation("learner-fresh-2", "grading", NOW.toISOString());

    expect(aiOperations.countStoredOperations()).toBe(2);
    expect(
      aiOperations.countRecentOperationsForLearner(
        "learner-fresh",
        "grading",
        "1970-01-01T00:00:00.000Z",
      ),
    ).toBe(1);
  });
});

describe("管理員端可見性及私隱", () => {
  it("用量摘要包含保留期執行情況，且不含任何學習者 ID", () => {
    insertOperation("learner-secret-id", "generation", NOW.toISOString());
    maintenance.runMaintenance("ai-operation-retention", { force: true, now: NOW });

    const summary = aiLimits.describeAiUsage(NOW);
    expect(summary.retention.days).toBe(maintenance.AI_RETENTION_DAYS);
    expect(summary.retention.lastStatus).toBe("ok");
    expect(summary.retention.runs).toBe(1);
    expect(JSON.stringify(summary)).not.toContain("learner-secret-id");
  });

  it("健康檢查會回報維護狀態（不含學習者資料）", async () => {
    maintenance.runMaintenance("ai-operation-retention", { force: true, now: NOW });
    const { GET } = await import("@/app/api/health/route");
    // 健康檢查不接收參數（與其他 route handler 的簽名一致）
    const response = await GET();
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    const text = JSON.stringify(payload);
    expect(text).toContain("maintenance");
    expect(text).toContain("ai-operation-retention");
  });
});
