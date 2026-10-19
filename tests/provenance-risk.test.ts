/**
 * Provenance 風險分級（Sprint 11 §5）的純函式測試。
 *
 * 契約：
 *   - 只有可核實的 diff 分類才可得出 P0／P1／P3；沒有原始證據一律 P2。
 *   - 不會因為修復腳本說「答案不變」就當成已證明。
 *   - 相同輸入產生相同結果（可重複）。
 */
import { describe, expect, it } from "vitest";

import { classifyProvenanceRisk, type RepairComparisonLike } from "@/server/quality/provenance-risk";

function item(overrides: Partial<RepairComparisonLike> = {}): RepairComparisonLike {
  return {
    classifications: ["NO_SEMANTIC_CHANGE_CONFIRMED"],
    originalStem: "文藝復興的核心思想是甚麼？",
    currentStem: "文藝復興的核心思想是甚麼？",
    originalOptions: ["人文主義", "重商主義"],
    currentOptions: ["人文主義", "重商主義"],
    originalCorrectAnswer: "人文主義",
    currentCorrectAnswer: "人文主義",
    blankCountOriginal: 0,
    blankCountCurrent: 0,
    assessedBlankIndexOriginal: null,
    assessedBlankIndexCurrent: null,
    ...overrides,
  };
}

describe("provenance 風險分級", () => {
  it("答案映射改變 → P0，必須教師覆核", () => {
    const risk = classifyProvenanceRisk(
      item({
        classifications: ["ANSWER_MAPPING_CHANGED", "REQUIRES_HISTORY_TEACHER_REVIEW"],
        assessedBlankIndexOriginal: 1,
        assessedBlankIndexCurrent: 2,
        originalCorrectAnswer: "文字",
        currentCorrectAnswer: "史前時期",
      }),
    );
    expect(risk.tier).toBe("P0");
    expect(risk.riskClass).toBe("answer_mapping_changed");
    expect(risk.requiresTeacherReview).toBe(true);
  });

  it("題目含義與來源不同 → P0", () => {
    const risk = classifyProvenanceRisk(
      item({ classifications: ["QUESTION_MEANING_CHANGED"], originalStem: "甲", currentStem: "乙" }),
    );
    expect(risk.tier).toBe("P0");
    expect(risk.riskClass).toBe("stem_or_option_meaning_changed");
  });

  it("沒有比較結果或原始證據不足 → P2，不會假設沒有變化", () => {
    expect(classifyProvenanceRisk(item({ classifications: [] })).tier).toBe("P2");
    expect(
      classifyProvenanceRisk(item({ classifications: ["INSUFFICIENT_ORIGINAL_EVIDENCE"] })).tier,
    ).toBe("P2");
  });

  it("補回其餘空格但考核答案不變 → P1（題幹已改變）", () => {
    const risk = classifyProvenanceRisk(
      item({
        originalStem: "＿＿＿是文字出現前的時期。＿＿＿是文字出現後的時期。",
        currentStem: "＿＿＿是文字出現前的時期。信史時期是文字出現後的時期。",
        blankCountOriginal: 2,
        blankCountCurrent: 1,
        assessedBlankIndexOriginal: 1,
        assessedBlankIndexCurrent: 1,
      }),
    );
    expect(risk.tier).toBe("P1");
    expect(risk.requiresTeacherReview).toBe(true);
  });

  it("純格式修復（只移除項目符號）→ P3", () => {
    const risk = classifyProvenanceRisk(
      item({
        classifications: ["FORMATTING_CHANGE_ONLY"],
        originalStem: "問題",
        currentStem: "問題",
      }),
    );
    expect(risk.tier).toBe("P3");
    expect(risk.riskClass).toBe("formatting_only");
    expect(risk.requiresTeacherReview).toBe(false);
  });

  it("與來源完全相同 → P3，但仍不是教師核准", () => {
    const risk = classifyProvenanceRisk(item());
    expect(risk.tier).toBe("P3");
    expect(risk.riskClass).toBe("no_semantic_change_confirmed");
    expect(risk.requiresTeacherReview).toBe(false);
  });

  it("相同輸入產生相同結果", () => {
    const input = item({ classifications: ["FORMATTING_CHANGE_ONLY"] });
    expect(classifyProvenanceRisk(input)).toEqual(classifyProvenanceRisk(input));
  });
});
