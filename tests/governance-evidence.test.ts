import { describe, expect, it } from "vitest";

import { buildGovernanceRows } from "../scripts/audit-governance-evidence";
import { questionFingerprint } from "@/server/quality/question-fingerprint";

/**
 * 治理證據分類的單元測試（Sprint 26）。
 *
 * 這一組測試固定「甚麼算證據」的定義，因為它直接影響 release gate 的判讀：
 *   - 現行 revision 的 approved 覆核 → 教師批准；
 *   - 現行 revision 的自動驗證 → 機器檢查（**不是**教師批准）；
 *   - 只有舊 revision 的批准 → 證據缺口（不可當成已批准）；
 *   - 兩者都沒有 → 證據缺口；
 *   - `teacher_confirmation_required` → 先歸類為待教師確認。
 *
 * 全部使用合成資料，不讀取資料庫、不接觸正式環境。
 */
function question(overrides: Record<string, unknown> = {}) {
  return {
    id: "q-test",
    topic_id: "topic-5",
    section_id: "topic-5-renaissance",
    question_type: "mc",
    origin: "material-ai",
    status: "published",
    revision: 2,
    auto_validated_at: null,
    auto_validated_revision: null,
    teacher_confirmation_required: 0,
    source_block_ids_json: '["block-1"]',
    source_excerpt: "合成節錄",
    source_verified: 1,
    quality_warnings_json: "[]",
    created_at: "2026-10-23T00:00:00.000Z",
    ...overrides,
  } as unknown as Parameters<typeof buildGovernanceRows>[0][number];
}

function review(overrides: Record<string, unknown> = {}) {
  return {
    id: "rev-1",
    question_id: "q-test",
    revision: 2,
    decision: "approved",
    reviewer_email: "reviewer@example.test",
    reviewer_role: "reviewer",
    question_fingerprint: "fp",
    created_at: "2026-10-23T01:00:00.000Z",
    ...overrides,
  } as unknown as Parameters<typeof buildGovernanceRows>[1][number];
}

describe("已發布題目的證據分類", () => {
  it("現行 revision 的 approved 覆核 → 教師批准", () => {
    const [row] = buildGovernanceRows([question()], [review()]);
    expect(row?.state).toBe("approved-at-current-revision");
    expect(row?.approvedReviewAtCurrentRevision).toContain("reviewer@example.test");
    expect(row?.staleApprovedRevisions).toEqual([]);
  });

  it("現行 revision 的自動驗證 → 機器檢查（不是教師批准）", () => {
    const [row] = buildGovernanceRows(
      [question({ auto_validated_revision: 2, auto_validated_at: "2026-10-23T02:00:00.000Z" })],
      [],
    );
    expect(row?.state).toBe("auto-validated-at-current-revision");
    expect(row?.approvedReviewAtCurrentRevision).toBeNull();
  });

  it("只有舊 revision 的批准 → 證據缺口，並列出舊版本", () => {
    const [row] = buildGovernanceRows(
      [question({ revision: 3 })],
      [review({ revision: 2 }), review({ id: "rev-0", revision: 1 })],
    );
    expect(row?.state).toBe("stale-approval-only");
    expect(row?.staleApprovedRevisions).toEqual([1, 2]);
  });

  it("舊版批准但現行版本有自動驗證 → 算有現行版本證據（仍非教師批准）", () => {
    const [row] = buildGovernanceRows(
      [question({ revision: 3, auto_validated_revision: 3 })],
      [review({ revision: 2 })],
    );
    expect(row?.state).toBe("auto-validated-at-current-revision");
  });

  it("兩者都沒有 → no-current-evidence", () => {
    const [row] = buildGovernanceRows([question()], []);
    expect(row?.state).toBe("no-current-evidence");
  });

  it("待教師確認優先歸類（即使有舊版批准）", () => {
    const [row] = buildGovernanceRows(
      [question({ status: "draft", teacher_confirmation_required: 1 })],
      [review({ revision: 1 })],
    );
    expect(row?.state).toBe("held-for-teacher-confirmation");
    expect(row?.teacherConfirmationRequired).toBe(true);
  });

  it("rejected／returned 覆核不算批准", () => {
    const [row] = buildGovernanceRows([question()], [review({ decision: "returned" })]);
    expect(row?.state).toBe("no-current-evidence");
  });

  it("記錄來源追溯欄位（不會因此把缺口當成已解決）", () => {
    const [withSource] = buildGovernanceRows([question()], []);
    expect(withSource?.hasSourceBlocks).toBe(true);
    expect(withSource?.hasSourceExcerpt).toBe(true);
    const [withoutSource] = buildGovernanceRows(
      [question({ source_block_ids_json: "[]", source_excerpt: "", source_verified: 0 })],
      [],
    );
    expect(withoutSource?.hasSourceBlocks).toBe(false);
    expect(withoutSource?.hasSourceExcerpt).toBe(false);
    expect(withoutSource?.state).toBe("no-current-evidence");
  });

  it("暫緩原因取自第一項品質警告（供教師介面顯示，不含題目內容）", () => {
    const [row] = buildGovernanceRows(
      [
        question({
          teacher_confirmation_required: 1,
          status: "draft",
          quality_warnings_json: '["品質檢查提示：解釋使用了「唯一」這種排他寫法","第二項"]',
        }),
      ],
      [],
    );
    expect(row?.primaryReason).toContain("唯一");
    expect(row?.primaryReason).not.toContain("第二項");
  });

  it("可以判定現行內容是否與最後一次批准完全相同（事實比對，不是批准判斷）", () => {
    const base = question();
    const sameFingerprint = questionFingerprint({
      topicId: "topic-5",
      sectionId: "topic-5-renaissance",
      questionType: "mc",
      difficulty: "basic",
      question: "（合成）題幹",
      options: ["甲", "乙", "丙", "丁"],
      correctAnswer: "甲",
      acceptedAnswers: [],
      explanation: "解釋",
      knowledgePoint: "知識點",
      gradingPoints: [],
      skill: null,
    } as unknown as Parameters<typeof questionFingerprint>[0]);

    const [identical] = buildGovernanceRows(
      [
        question({
          revision: 3,
          question: "（合成）題幹",
          options_json: '["甲","乙","丙","丁"]',
          correct_answer: "甲",
          accepted_answers_json: "[]",
          explanation: "解釋",
          knowledge_point: "知識點",
          grading_points_json: "[]",
          skill: null,
          topic_id: "topic-5",
          section_id: "topic-5-renaissance",
          difficulty: "basic",
          question_type: "mc",
        }),
      ],
      [review({ revision: 2, question_fingerprint: sameFingerprint })],
    );
    // 內容指紋與批准時相同 → 事實比對為「未改動」；但狀態仍是 stale-approval-only，
    // 因為「舊版批准可否覆蓋」屬政策決定，工具不代為判定。
    expect(identical?.contentMatchesApproved).toBe(true);
    expect(identical?.state).toBe("stale-approval-only");

    const [changed] = buildGovernanceRows([base], [review({ revision: 2, question_fingerprint: "different" })]);
    expect(changed?.contentMatchesApproved).toBe(false);

    const [neverApproved] = buildGovernanceRows([base], []);
    expect(neverApproved?.contentMatchesApproved).toBeNull();
  });
});
