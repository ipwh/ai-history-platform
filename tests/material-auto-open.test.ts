/**
 * 教材自動開放政策（2026-10-21 擁有者指示）。
 *
 * 背景：正式環境的教材從未匯入，而匯入功能本身有 bug，結果學生端每個課題都顯示
 * 「尚未匯入教材」，AI 即時出題完全不能用。擁有者因此指示：往後自動開放所有教材，
 * 令學生可直接以課本內容自學。
 *
 * 這裡守住四條界線，確保「自動」不等於「偽造紀錄」或「外洩答案」：
 *   1. 課文／筆記 → 自動完成版權確認並開放，確認者記錄為政策（不是某位教師）；
 *   2. 校內試題檔 → 永不開放（題目與答案）；
 *   3. 檔名標示教師版／答案的材料 → 仍要求人手確認內容（fail-closed）；
 *   4. 政策關閉（off）時不做任何事。
 */
import { beforeAll, describe, expect, it } from "vitest";

import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("material-auto-open");
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.LLM_PROVIDER = "mock";
delete process.env.MATERIAL_AUTO_OPEN_POLICY;
delete process.env.ADMIN_TOKEN;

type MaterialsModule = typeof import("@/server/repositories/materials");
type DistributionModule = typeof import("@/server/services/material-distribution");

let materials: MaterialsModule;
let distribution: DistributionModule;

const TOPIC = "topic-1";

function createDocument(fileName: string, kind: "demo" | "question-bank" | "uploaded") {
  return materials.createDocument({
    fileName,
    kind,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 1234,
    status: "ready",
    topicId: TOPIC,
    sourceNote: null,
  });
}

beforeAll(async () => {
  const { ensureBootstrap } = await import("@/server/seed");
  ensureBootstrap();
  materials = await import("@/server/repositories/materials");
  distribution = await import("@/server/services/material-distribution");
});

describe("教材自動開放", () => {
  it("課文／筆記會自動開放，並如實記錄為政策而非個人確認", () => {
    const document = createDocument("課題1 測試_課文.docx", "demo");
    expect(materials.documentIsStudentVisible(document)).toBe(false);

    const outcome = distribution.autoOpenDocument(document.id);
    expect(outcome?.status).toBe("opened");

    const updated = materials.getDocument(document.id);
    expect(updated?.studentDistribution).toBe(true);
    expect(materials.documentIsStudentVisible(updated!)).toBe(true);
    // 確認者必須是政策標記，不能假裝某位教師逐份確認
    const governance = materials.getDocumentGovernance(document.id);
    expect(governance.rightsConfirmedBy).toBe(distribution.AUTO_OPEN_ACTOR);
    expect(governance.rightsConfirmedBy).not.toContain("@");
  });

  it("已開放的文件再次處理時回報 already-open，不會重複寫入稽核紀錄", () => {
    const document = createDocument("課題1 測試2_筆記.docx", "demo");
    expect(distribution.autoOpenDocument(document.id)?.status).toBe("opened");
    expect(distribution.autoOpenDocument(document.id)?.status).toBe("already-open");
    const audit = materials.listDistributionAudit(document.id);
    expect(audit.filter((entry) => entry.allowed)).toHaveLength(1);
  });

  it("校內試題檔永不開放", () => {
    const document = createDocument("課題1 測試_MCQ.docx", "question-bank");
    const outcome = distribution.autoOpenDocument(document.id);
    expect(outcome?.status).toBe("skipped-question-bank");
    expect(materials.getDocument(document.id)?.studentDistribution).toBe(false);
  });

  it("檔名標示教師版／答案的材料不會自動完成內容覆核（fail-closed）", () => {
    const document = createDocument("課題1 測試_TE.docx", "demo");
    const outcome = distribution.autoOpenDocument(document.id);
    expect(outcome?.status).toBe("needs-teacher-edition-review");
    const updated = materials.getDocument(document.id);
    expect(updated?.studentDistribution).toBe(false);
    expect(materials.getDocumentGovernance(document.id).contentReviewedAt).toBeNull();
  });

  it("批次開放會處理全部文件並回報各份結果", () => {
    const lesson = createDocument("課題1 測試3_課文.docx", "demo");
    const bank = createDocument("課題1 測試_填充題.docx", "question-bank");
    const result = distribution.autoOpenAllLessonDocuments();
    expect(result.policyEnabled).toBe(true);
    expect(result.opened).toBeGreaterThanOrEqual(1);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(materials.documentIsStudentVisible(materials.getDocument(lesson.id)!)).toBe(true);
    expect(materials.getDocument(bank.id)?.studentDistribution).toBe(false);
  });
});
