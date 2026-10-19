/**
 * 審核紀錄來源分類（純函式）。
 *
 * 問題背景：`question_reviews` 全部 3,168 筆的 `reviewer_role` 都是 `admin`，
 * 包括自動修復及批次授權。角色欄不能單獨證明是否人工覆核，因此必須按**理由的
 * 已知來源**分類，而不是憑角色或時間推測。
 *
 * 分類只描述「這筆紀錄由哪一種流程產生」，不代表題目內容正確或錯誤。
 * 原始紀錄不會被修改；本模組只用於報告。
 */
export type ReviewKind =
  | "teacher_adjudication"
  | "owner_batch"
  | "automation_repair"
  | "unknown";

export type ReviewProvenanceClass =
  | "verified_human_review"
  | "verified_automation"
  | "legacy_origin_uncertain"
  | "conflicting_evidence"
  | "not_enough_evidence";

export interface ReviewProvenanceInput {
  reviewerRole: string;
  reason: string | null;
  decision: string;
  /** 這筆紀錄的 revision／fingerprint 是否等於題目現行版本。 */
  appliesToCurrentRevision: boolean;
  /** 同一題同一版本同時找到人工及自動化證據（由報告層提供）。 */
  conflictingEvidence?: boolean;
}

export interface ReviewProvenanceResult {
  kind: ReviewKind;
  class: ReviewProvenanceClass;
  appliesToCurrentRevision: boolean;
  evidence: string[];
  /**
   * 這筆紀錄可否作為「目前版本已有人工裁決」的證據。
   * 批次授權可作為 owner 的人工決定，但不是逐題教師覆核。
   */
  countsAsCurrentHumanEvidence: boolean;
}

const AUTOMATION_PREFIXES = [
  "模擬學生使用後自動修復",
  "自動修復多空格填充題",
  "平台自動檢查",
];

/** 依理由的已知前綴判斷產生流程；不憑角色或時間推測。 */
export function classifyReviewKind(reviewerRole: string, reason: string | null): ReviewKind {
  const text = (reason ?? "").trim();
  if (text.startsWith("教師裁決")) return "teacher_adjudication";
  if (text.startsWith("擁有者指示")) return "owner_batch";
  if (AUTOMATION_PREFIXES.some((prefix) => text.startsWith(prefix))) return "automation_repair";
  if (reviewerRole.trim() === "automation") return "automation_repair";
  return "unknown";
}

export function classifyReviewProvenance(
  input: ReviewProvenanceInput,
): ReviewProvenanceResult {
  const kind = classifyReviewKind(input.reviewerRole, input.reason);
  const evidence: string[] = [];

  if (kind === "automation_repair") {
    evidence.push(
      input.reviewerRole === "automation"
        ? "reviewer_role = automation"
        : `reviewer_role 為「${input.reviewerRole}」，但理由屬已知自動修復流程（歷史紀錄）`,
    );
    return {
      kind,
      class: "verified_automation",
      appliesToCurrentRevision: input.appliesToCurrentRevision,
      evidence,
      countsAsCurrentHumanEvidence: false,
    };
  }

  if (kind === "teacher_adjudication") {
    evidence.push("理由以「教師裁決」開頭：逐題裁決紀錄");
    if (input.conflictingEvidence) {
      return {
        kind,
        class: "conflicting_evidence",
        appliesToCurrentRevision: input.appliesToCurrentRevision,
        evidence: [...evidence, "同一版本同時存在自動化及人工證據"],
        countsAsCurrentHumanEvidence: false,
      };
    }
    return {
      kind,
      class: "verified_human_review",
      appliesToCurrentRevision: input.appliesToCurrentRevision,
      evidence,
      countsAsCurrentHumanEvidence: input.appliesToCurrentRevision,
    };
  }

  if (kind === "owner_batch") {
    evidence.push("理由以「擁有者指示」開頭：批次授權，不是逐題教師覆核");
    if (input.conflictingEvidence) {
      return {
        kind,
        class: "conflicting_evidence",
        appliesToCurrentRevision: input.appliesToCurrentRevision,
        evidence: [...evidence, "同一版本同時存在自動化及人工證據"],
        countsAsCurrentHumanEvidence: false,
      };
    }
    return {
      kind,
      class: "verified_human_review",
      appliesToCurrentRevision: input.appliesToCurrentRevision,
      evidence,
      countsAsCurrentHumanEvidence: input.appliesToCurrentRevision,
    };
  }

  const hasReason = (input.reason ?? "").trim().length > 0;
  return {
    kind: "unknown",
    class: hasReason ? "legacy_origin_uncertain" : "not_enough_evidence",
    appliesToCurrentRevision: input.appliesToCurrentRevision,
    evidence: [
      hasReason
        ? "理由不屬任何已知流程，來源無法由現有紀錄判斷"
        : "沒有審核理由，無法判斷來源",
    ],
    countsAsCurrentHumanEvidence: false,
  };
}
