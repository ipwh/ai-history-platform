/**
 * 只有自動化修復證據的題目：風險分級（Sprint 11 P1）。
 *
 * 分類**只**採用可核實的比較結果（`audit:repair-provenance` 以 `materials/` 原始
 * 試題檔重建的內容對比現時題目），不採信修復腳本自己的文字說明。沒有任何可比較
 * 的原始證據時一律列為 `insufficient_original_evidence`（P2），不會假設「沒有變化」。
 */
export type ProvenanceRiskTier = "P0" | "P1" | "P2" | "P3";

export type ProvenanceRiskClass =
  | "answer_mapping_changed"
  | "grading_semantics_changed"
  | "stem_or_option_meaning_changed"
  | "formatting_only"
  | "no_semantic_change_confirmed"
  | "insufficient_original_evidence"
  | "conflicting_review_evidence";

export interface RepairComparisonLike {
  classifications: string[];
  originalStem: string | null;
  currentStem: string;
  originalOptions: string[] | null;
  currentOptions: string[];
  originalCorrectAnswer: string | null;
  currentCorrectAnswer: string;
  blankCountOriginal: number | null;
  blankCountCurrent: number | null;
  assessedBlankIndexOriginal: number | null;
  assessedBlankIndexCurrent: number | null;
}

export interface ProvenanceRisk {
  tier: ProvenanceRiskTier;
  riskClass: ProvenanceRiskClass;
  /** 人類可讀的判準說明（寫入報告，方便覆核者理解為何是這個等級） */
  basis: string;
  requiresTeacherReview: boolean;
}

const norm = (value: string | null | undefined): string =>
  (value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();

/**
 * 分級原則（Sprint 11 §5.2）：
 *   P0 — 可能改變答案映射、評分含義或題目正確性。
 *   P1 — 題幹或選項改變，可能影響考核含義，但可重建的證據顯示考核答案不變。
 *   P2 — 原始證據不足／互相矛盾，無法確認修復前後的語義。
 *   P3 — 有可靠證據支持的純格式修復，或比較結果顯示內容完全相同。
 */
export function classifyProvenanceRisk(item: RepairComparisonLike): ProvenanceRisk {
  const labels = new Set(item.classifications);

  if (labels.has("ANSWER_MAPPING_CHANGED")) {
    return {
      tier: "P0",
      riskClass: "answer_mapping_changed",
      basis: `考核空格由第 ${item.assessedBlankIndexOriginal ?? "?"} 個改為第 ${item.assessedBlankIndexCurrent ?? "?"} 個`,
      requiresTeacherReview: true,
    };
  }
  if (labels.has("QUESTION_MEANING_CHANGED")) {
    return {
      tier: "P0",
      riskClass: "stem_or_option_meaning_changed",
      basis: "現時題幹、選項或答案與由原始來源重建的內容不同",
      requiresTeacherReview: true,
    };
  }
  if (labels.has("INSUFFICIENT_ORIGINAL_EVIDENCE") || labels.size === 0) {
    return {
      tier: "P2",
      riskClass: "insufficient_original_evidence",
      basis: "找不到可比較的原始試題檔內容，無法證明修復前後的語義",
      requiresTeacherReview: true,
    };
  }

  const unchanged =
    item.originalStem !== null &&
    norm(item.originalStem) === norm(item.currentStem) &&
    norm(item.originalCorrectAnswer) === norm(item.currentCorrectAnswer) &&
    (item.originalOptions ?? []).length === item.currentOptions.length &&
    (item.originalOptions ?? []).every(
      (option, index) => norm(option) === norm(item.currentOptions[index]),
    );

  if (labels.has("FORMATTING_CHANGE_ONLY") && unchanged) {
    return {
      tier: "P3",
      riskClass: "formatting_only",
      basis: "只移除選項開頭殘留的項目符號，題幹、選項文字及答案相同",
      requiresTeacherReview: false,
    };
  }
  if (unchanged) {
    return {
      tier: "P3",
      riskClass: "no_semantic_change_confirmed",
      basis: "與原始來源逐字比較，題幹、選項及答案相同",
      requiresTeacherReview: false,
    };
  }
  if (labels.has("FORMATTING_CHANGE_ONLY")) {
    return {
      tier: "P3",
      riskClass: "formatting_only",
      basis: "比較結果為純格式差異（項目符號），答案相同",
      requiresTeacherReview: false,
    };
  }
  return {
    tier: "P1",
    riskClass: "stem_or_option_meaning_changed",
    basis:
      "題幹或選項與原始來源不同（例如補回其餘空格的答案），但可重建的證據顯示考核答案不變",
    requiresTeacherReview: true,
  };
}

export const TIER_ORDER: ProvenanceRiskTier[] = ["P0", "P1", "P2", "P3"];

export const TIER_LABEL: Record<ProvenanceRiskTier, string> = {
  P0: "可能改變答案／評分含義（最高優先）",
  P1: "題幹或選項改變但考核答案不變",
  P2: "原始證據不足，無法確認語義",
  P3: "有可靠證據的純格式修復或內容相同（可排後覆核）",
};
