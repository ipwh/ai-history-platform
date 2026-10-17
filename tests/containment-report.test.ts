/**
 * Sprint 8.8 風險報告與可稽核性文件的結構測試。
 *
 * 這一組測試確保報告不會超出證據：
 *   - 兩條題目的判定有明確分類，且沒有被描述成「已處理」；
 *   - 建議必須列明「未下架、未改寫」；
 *   - 系統性發現（讀取路徑沒有驗證條件）如實記錄，不被淡化；
 *   - 可稽核性文件比較三個方案、給出建議，但明確標示未實作任何 migration。
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const DOCS = path.join("docs", "teacher-review");

interface ContainmentReport {
  version: number;
  status: string;
  questions: {
    questionId: string;
    provenance: { status: string };
    content: { stem: string; options: string[]; correctAnswer: string; explanation: string };
    materialEvidence: { citedBlockId: string; excerptVerbatimInCitedBlock: boolean };
    humanActivity: { reviews: number; reports: number; attempts: number };
    machineFinding: { outcome: string; code: string; reproducedOnCopy: boolean };
    assessment: { classification: string; reachability: string };
    recommendation: { severity: string; notDoneHere: string };
  }[];
  containment: {
    supportedMechanisms: string[];
    verified: { steps: string[]; result: string };
    whatAnAuthorisedOperatorMustDo: string;
  };
  systemicFindings: {
    id: string;
    severity: string;
    finding: string;
    evidence?: string;
    recommendation: string;
  }[];
  notDoneDeliberately: string[];
}

const report = JSON.parse(
  fs.readFileSync(path.join(DOCS, "published-question-containment-2026-10.json"), "utf8"),
) as ContainmentReport;

const auditability = fs.readFileSync(
  path.join(DOCS, "review-auditability-options-2026-10.md"),
  "utf8",
);

describe("已發布題目風險報告（Sprint 8.8）", () => {
  it("涵蓋兩條已核實的題目，內容與狀態如實記錄", () => {
    expect(report.version).toBe(1);
    expect(report.questions.map((item) => item.questionId).sort()).toEqual([
      "q_058eda0378394d0f",
      "q_062fdfd516314f3d",
    ]);
    const published = report.questions.find((item) => item.questionId === "q_058eda0378394d0f")!;
    expect(published.provenance.status).toBe("published");
    expect(published.content.stem).toContain("詞語");
    expect(published.content.options.length).toBe(4);
    expect(published.machineFinding.code).toBe("stem-answer-type-mismatch");
    expect(published.machineFinding.reproducedOnCopy).toBe(true);
    expect(published.materialEvidence.citedBlockId.startsWith("blk_")).toBe(true);
    expect(published.materialEvidence.excerptVerbatimInCitedBlock).toBe(true);

    const draft = report.questions.find((item) => item.questionId === "q_062fdfd516314f3d")!;
    expect(draft.provenance.status).toBe("draft");
    expect(draft.machineFinding.code).toBe("answer-in-stem");
    expect(draft.assessment.reachability).toContain("draft");
  });

  it("判定為實際缺陷而非誤報，並記錄沒有人工活動", () => {
    for (const item of report.questions) {
      expect(item.machineFinding.outcome, item.questionId).toBe("reject");
      expect(item.assessment.classification, item.questionId).toBe(
        "genuinely-defective-not-false-positive",
      );
      expect(item.humanActivity.reviews, item.questionId).toBe(0);
      expect(item.humanActivity.reports, item.questionId).toBe(0);
    }
  });

  it("建議沒有被執行：明確記錄未下架、未改寫，並列出實測步驟", () => {
    for (const item of report.questions) {
      expect(item.recommendation.notDoneHere, item.questionId).toContain("沒有");
      expect(item.recommendation.severity, item.questionId).toMatch(/^P\d/);
    }
    expect(report.containment.verified.steps.length).toBeGreaterThanOrEqual(5);
    expect(report.containment.whatAnAuthorisedOperatorMustDo).toContain("具名");
    expect(report.containment.supportedMechanisms.length).toBeGreaterThanOrEqual(2);
    expect(report.notDoneDeliberately.length).toBeGreaterThanOrEqual(3);
    // 沒有把「已下架」寫成已完成
    expect(report.notDoneDeliberately.join(" ")).toContain("沒有下架");
  });

  it("系統性發現如實記錄（讀取路徑與發布關卡的差異）", () => {
    const finding = report.systemicFindings.find(
      (item) => item.id === "read-time-gate-vs-publish-time-gate",
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toMatch(/^P\d/);
    expect(`${finding!.finding}${finding!.evidence ?? ""}`).toContain("788");
    expect(finding!.recommendation.length).toBeGreaterThan(20);
  });
});

describe("覆核可稽核性選項文件（Sprint 8.8）", () => {
  it("比較三個方案並給出單一建議", () => {
    expect(auditability).toContain("選項 1");
    expect(auditability).toContain("選項 2");
    expect(auditability).toContain("選項 3");
    expect(auditability).toContain("建議採用選項 1");
  });

  it("涵蓋要求的六個評估面向", () => {
    for (const dimension of [
      "資料完整性",
      "Migration 風險",
      "Backfill 風險",
      "私隱",
      "儲存影響",
      "並發與過時批准",
    ]) {
      expect(auditability, dimension).toContain(dimension);
    }
  });

  it("明確標示未實作任何 migration", () => {
    expect(auditability).toContain("建議，未實作");
    expect(auditability).toContain("不會新增任何 schema migration");
  });
});
