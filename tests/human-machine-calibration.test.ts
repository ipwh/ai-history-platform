/**
 * 機器判定與教師判斷的校準報告（Sprint 8.7 第三階段）。
 *
 * 這一組測試確保報告**不會**超出證據：沒有教師覆核時必須維持 awaiting-human-review、
 * 不得出現任何比率數字，分類只是待用標籤而不是已填結果。
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

interface CalibrationReport {
  version: number;
  status: string;
  calibrationStatus: string;
  accuracyClaim: null | number;
  sourcePackage: string;
  sampleSize: number;
  reviewedCount: number;
  pendingCount: number;
  categories: { id: string; label: string; kind: string; count: number }[];
  disagreementCounts: Record<string, number>;
  rows: {
    questionId: string;
    machineOutcome: string;
    machineCodes: string[];
    humanDecision: string;
    humanCategories: string[];
    disagreement: string | null;
  }[];
  limitations: string[];
  howToUse: string[];
}

interface PackageFile {
  items: {
    questionId: string;
    reviewerDecision: string;
    machineChecks: { gateRecomputedNow: { outcome: string; codes: string[] } };
  }[];
}

const DOCS = path.join("docs", "teacher-review");
const report = JSON.parse(
  fs.readFileSync(path.join(DOCS, "human-vs-machine-calibration-2026-10.json"), "utf8"),
) as CalibrationReport;
const pkg = JSON.parse(
  fs.readFileSync(path.join(DOCS, "generated-question-sample-2026-10.json"), "utf8"),
) as PackageFile;

describe("機器與教師判斷的校準報告", () => {
  it("與覆核套件逐題對應，機器結果不是另行估算", () => {
    expect(report.sampleSize).toBe(pkg.items.length);
    expect(report.rows.map((row) => row.questionId)).toEqual(
      pkg.items.map((item) => item.questionId),
    );
    for (const [index, row] of report.rows.entries()) {
      const item = pkg.items[index]!;
      expect(row.machineOutcome, row.questionId).toBe(item.machineChecks.gateRecomputedNow.outcome);
      expect(row.machineCodes, row.questionId).toEqual(
        item.machineChecks.gateRecomputedNow.codes,
      );
      expect(row.humanDecision, row.questionId).toBe(item.reviewerDecision);
    }
  });

  it("沒有教師覆核時一律維持待覆核，不會憑測試結果推論通過", () => {
    const pending = pkg.items.filter((item) => item.reviewerDecision === "pending-review").length;
    expect(report.pendingCount).toBe(pending);
    expect(report.reviewedCount).toBe(pkg.items.length - pending);
    if (pending === pkg.items.length) {
      expect(report.status).toBe("awaiting-human-review");
      // Sprint 8.8：沒有真實決定時，校準必須如實標示為未量度
      expect(report.calibrationStatus).toBe("unmeasured");
      expect(report.accuracyClaim).toBeNull();
      expect(report.rows.every((row) => row.disagreement === null)).toBe(true);
      expect(Object.values(report.disagreementCounts).every((count) => count === 0)).toBe(true);
    }
  });

  it("分類只是待填標籤：計數與每題標記一致，且未標記時為 0", () => {
    expect(report.categories.length).toBeGreaterThanOrEqual(8);
    for (const category of report.categories) {
      const counted = report.rows.filter((row) => row.humanCategories.includes(category.id)).length;
      expect(category.count, category.id).toBe(counted);
      expect(category.label.length).toBeGreaterThan(0);
    }
    const disagreementIds = report.categories
      .filter((category) => category.kind === "disagreement")
      .map((category) => category.id);
    expect(Object.keys(report.disagreementCounts).sort()).toEqual(disagreementIds.sort());
  });

  it("說明樣本限制，且不含任何準確率或比率宣稱", () => {
    expect(report.limitations.length).toBeGreaterThanOrEqual(3);
    expect(report.limitations.some((line) => line.includes("不代表整體題庫分佈"))).toBe(true);
    expect(report.limitations.some((line) => line.includes("不提供準確率"))).toBe(true);
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/\d+\s*%\s*(準確|正確|precision|accuracy)/);
    expect(text).not.toMatch(/accuracyK?Rate|precisionRate|「準確率：\d/);
  });
});
