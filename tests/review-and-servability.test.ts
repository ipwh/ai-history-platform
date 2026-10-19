/**
 * 可作答性分類及審核來源分類的單元測試。
 */
import { describe, expect, it } from "vitest";

import {
  categoryForIssue,
  classifyServabilityIssue,
  recommendRemediation,
} from "@/server/quality/servability-remediation";
import {
  classifyReviewKind,
  classifyReviewProvenance,
} from "@/server/quality/review-provenance";

describe("結構不可作答：issue code 與建議", () => {
  const cases: [string, string][] = [
    ["題目沒有標準答案，學生無法得知對錯", "MISSING_ANSWER"],
    ["填充題的題幹沒有空格標記，學生無從得知要填寫甚麼", "FILL_NO_BLANK"],
    ["填充題的題幹有 3 個空格，但只記錄了 1 個答案，其餘空格沒有答案可對", "FILL_MULTI_BLANK"],
    ["填充題的標準答案長達 72 字，已接近整句或整段，學生無法在單一空格重現", "FILL_ANSWER_TOO_LONG"],
    ["填充題的標準答案仍包含空格標記，學生無法作答", "FILL_ANSWER_CONTAINS_BLANK"],
    ["填充題的標準答案包含完整句子（句末標點），答案欄位已混入其他內容", "FILL_ANSWER_SENTENCE"],
    ["填充題的標準答案「甲」仍出現在題幹其他位置，學生可直接抄寫", "FILL_ANSWER_LEAKS"],
    ["選擇題只有 1 個選項，無法作答", "MCQ_TOO_FEW_OPTIONS"],
    ["選擇題有空白的選項", "MCQ_EMPTY_OPTION"],
    ["選擇題有重複的選項，學生無法分辨", "MCQ_DUPLICATE_OPTION"],
    ["選擇題的標準答案「甲」不在選項之內", "MCQ_ANSWER_NOT_IN_OPTIONS"],
    ["選項以羅馬數字（i、ii）指涉題幹的陳述，但題幹沒有 i、ii 的標示，學生無法對應哪一句是哪一項", "MCQ_ROMAN_LABEL_MISSING"],
    ["選擇題的標準答案「甲」已出現在題幹中，答案直接外洩", "MCQ_ANSWER_LEAKS"],
  ];

  it("每一種實際 reason 都對應穩定 issue code", () => {
    for (const [reason, code] of cases) {
      expect(classifyServabilityIssue(reason), reason).toBe(code);
    }
  });

  it("未知 reason 不會被猜成已知類別", () => {
    expect(classifyServabilityIssue("其他問題")).toBe("UNKNOWN");
    expect(categoryForIssue("UNKNOWN")).toBe("other");
    expect(
      recommendRemediation({
        issueCode: "UNKNOWN",
        attempts: 0,
        snapshots: 0,
        hasSourceDocument: false,
      }),
    ).toBe("investigation_required");
  });

  it("現階段沒有任何原因符合自動修復條件", () => {
    for (const [, code] of cases) {
      const recommendation = recommendRemediation({
        issueCode: code as never,
        attempts: 0,
        snapshots: 0,
        hasSourceDocument: true,
      });
      expect(recommendation, code).not.toBe("safe_automatic_repair_candidate");
    }
  });

  it("缺答案 → quarantine candidate；沒有空格 → 退回草稿候選", () => {
    expect(
      recommendRemediation({
        issueCode: "MISSING_ANSWER",
        attempts: 0,
        snapshots: 0,
        hasSourceDocument: false,
      }),
    ).toBe("quarantine_candidate");
    expect(
      recommendRemediation({
        issueCode: "FILL_NO_BLANK",
        attempts: 0,
        snapshots: 0,
        hasSourceDocument: false,
      }),
    ).toBe("return_to_draft_candidate");
  });
});

describe("審核紀錄來源分類", () => {
  it("以理由前綴辨識三種已知流程（不靠角色）", () => {
    expect(classifyReviewKind("admin", "教師裁決：核准第 6 版")).toBe("teacher_adjudication");
    expect(classifyReviewKind("admin", "擁有者指示：本 session 上載的校內題庫題目一律覆核通過並發布")).toBe(
      "owner_batch",
    );
    expect(classifyReviewKind("admin", "模擬學生使用後自動修復：只把多餘空格的答案填入題幹")).toBe(
      "automation_repair",
    );
    expect(classifyReviewKind("admin", "自動修復多空格填充題：只把其餘空格的答案填入題幹")).toBe(
      "automation_repair",
    );
  });

  it("教師裁決理由提到「自動修復」不會被誤判為自動化紀錄", () => {
    expect(
      classifyReviewKind(
        "admin",
        "教師裁決（自動修復改變考核答案）：核對原卷後核准現行版本。教師備註：通過審核",
      ),
    ).toBe("teacher_adjudication");
  });

  it("角色 admin + 自動修復理由 → verified_automation，不計作人工證據", () => {
    const result = classifyReviewProvenance({
      reviewerRole: "admin",
      reason: "模擬學生使用後自動修復：只把多餘空格的答案填入題幹",
      decision: "approved",
      appliesToCurrentRevision: true,
    });
    expect(result.class).toBe("verified_automation");
    expect(result.countsAsCurrentHumanEvidence).toBe(false);
    expect(result.evidence.join()).toContain("admin");
  });

  it("教師裁決只有套用於目前版本時才計作人工證據", () => {
    const current = classifyReviewProvenance({
      reviewerRole: "admin",
      reason: "教師裁決：核准第 6 版",
      decision: "approved",
      appliesToCurrentRevision: true,
    });
    expect(current.class).toBe("verified_human_review");
    expect(current.countsAsCurrentHumanEvidence).toBe(true);

    const stale = classifyReviewProvenance({
      reviewerRole: "admin",
      reason: "教師裁決：核准第 6 版",
      decision: "approved",
      appliesToCurrentRevision: false,
    });
    expect(stale.class).toBe("verified_human_review");
    expect(stale.countsAsCurrentHumanEvidence).toBe(false);
  });

  it("來源不明的紀錄保留為 legacy_origin_uncertain，不會被當成人工審核", () => {
    const result = classifyReviewProvenance({
      reviewerRole: "admin",
      reason: "系統匯入時自動記錄",
      decision: "approved",
      appliesToCurrentRevision: true,
    });
    expect(result.class).toBe("legacy_origin_uncertain");
    expect(result.countsAsCurrentHumanEvidence).toBe(false);
  });

  it("同一版本同時有人工及自動證據 → conflicting_evidence", () => {
    const result = classifyReviewProvenance({
      reviewerRole: "admin",
      reason: "擁有者指示：批次發布",
      decision: "approved",
      appliesToCurrentRevision: true,
      conflictingEvidence: true,
    });
    expect(result.class).toBe("conflicting_evidence");
    expect(result.countsAsCurrentHumanEvidence).toBe(false);
  });
});
