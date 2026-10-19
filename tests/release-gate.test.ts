/**
 * 發布閘門的單元測試。
 *
 * 重點：未定義標準或沒有證據的項目不可當作通過；任何 FAIL／POLICY_PENDING／
 * INSUFFICIENT_EVIDENCE 都必須令結果為 NOT READY。
 */
import { describe, expect, it } from "vitest";

import type { ContentAuditPayload } from "@/server/quality/content-audit";
import {
  evaluateReleaseGates,
  type ReleaseGateInput,
} from "@/server/quality/release-gates";

function auditFixture(overrides: Partial<ContentAuditPayload> = {}): ContentAuditPayload {
  const base: ContentAuditPayload = {
    generatedAt: "2026-10-19T00:00:00.000Z",
    inputFingerprint: "fixture",
    totals: {
      questions: 10,
      published: 10,
      teacherConfirmationRequired: 0,
      notServable: 0,
      releasable: 10,
      canServe: 10,
    },
    source: {
      counts: { traceable: 10, partial: 0, unknown: 0, pending_verification: 0 },
      missingDocumentRecord: 0,
      missingQuestionNumber: 0,
      missingSourceHash: 0,
      hasImportBatch: 0,
      staleBlockReferences: 0,
      byOrigin: { "school-paper": { traceable: 10, partial: 0, unknown: 0, pending_verification: 0 } },
    },
    explanation: {
      counts: {
        placeholder: 0,
        answer_only: 0,
        insufficient: 0,
        potentially_inconsistent: 0,
        not_assessed: 10,
      },
      reviewedButLowQuality: 0,
      automationApprovalsRecordedAsHuman: 0,
      byTopic: {},
    },
    metadata: {
      byCode: {},
      bySeverity: { blocking: 0, needs_review: 0, warning: 0 },
      skillMissing: 0,
      difficulty: { basic: 10 },
      blockingReferences: 0,
    },
    policy: {
      byCategory: { hard_block: 0, teacher_review: 0, warning: 0, policy_pending: 0 },
      questionsWithHardBlock: 0,
      questionsWithTeacherReview: 0,
      questionsReleasable: 10,
    },
    questions: [],
  };
  return {
    ...base,
    ...overrides,
    totals: { ...base.totals, ...(overrides.totals ?? {}) },
    source: { ...base.source, ...(overrides.source ?? {}) },
    explanation: { ...base.explanation, ...(overrides.explanation ?? {}) },
    metadata: { ...base.metadata, ...(overrides.metadata ?? {}) },
    policy: { ...base.policy, ...(overrides.policy ?? {}) },
  };
}

function inputFixture(overrides: Partial<ReleaseGateInput> = {}): ReleaseGateInput {
  return {
    audit: auditFixture(),
    answerProvenance: { affected: 18, unresolved: 0, reportFound: true },
    teacherDecisions: { pendingCurrentRevision: 0, openReports: 0 },
    copyright: {
      documents: 10,
      distributable: 10,
      rightsRecorded: 10,
      ownerAttestation: true,
    },
    golden: { questions: 5, reviewed: 5 },
    tests: { evidenceProvided: true, failures: 0, skipped: 0, commands: ["npm test"] },
    deployment: { evidenceProvided: true, notes: [] },
    previous: null,
    ...overrides,
  };
}

function gateStatus(input: ReleaseGateInput, id: string): string {
  return evaluateReleaseGates(input).gates.find((gate) => gate.id === id)?.status ?? "MISSING";
}

describe("發布閘門判定", () => {
  it("全部證據齊備且符合標準 → READY", () => {
    const report = evaluateReleaseGates(inputFixture());
    expect(report.verdict).toBe("READY");
    expect(report.gates.every((gate) => gate.status === "PASS")).toBe(true);
  });

  it("Golden dataset 為空 → 證據不足（不是零錯誤）", () => {
    const input = inputFixture({ golden: { questions: 0, reviewed: 0 } });
    expect(gateStatus(input, "golden-evaluation")).toBe("INSUFFICIENT_EVIDENCE");
    expect(evaluateReleaseGates(input).verdict).toBe("NOT READY");
  });

  it("仍有待教師確認題目 → FAIL", () => {
    const input = inputFixture({
      audit: auditFixture({
        totals: {
          questions: 10,
          published: 9,
          teacherConfirmationRequired: 1,
          notServable: 0,
          releasable: 0,
          canServe: 9,
        },
      }),
    });
    expect(gateStatus(input, "question-isolation")).toBe("FAIL");
    expect(evaluateReleaseGates(input).verdict).toBe("NOT READY");
  });

  it("已發布但不可作答 → FAIL", () => {
    const input = inputFixture({
      audit: auditFixture({
        questions: [
          {
            id: "q1",
            revision: 1,
            topicId: "topic-1",
            sectionId: "section-1",
            status: "published",
            teacherConfirmationRequired: false,
            servable: false,
            servabilityReason: "多個空格",
            source: {} as never,
            explanation: {} as never,
            metadata: {} as never,
            policy: {} as never,
          },
        ],
      }),
    });
    expect(gateStatus(input, "question-servability")).toBe("FAIL");
  });

  it("佔位解釋 → POLICY_PENDING，不能當作通過", () => {
    const input = inputFixture({
      audit: auditFixture({
        explanation: {
          counts: {
            placeholder: 10,
            answer_only: 0,
            insufficient: 0,
            potentially_inconsistent: 0,
            not_assessed: 0,
          },
          reviewedButLowQuality: 10,
          automationApprovalsRecordedAsHuman: 0,
          byTopic: {},
        },
      }),
    });
    expect(gateStatus(input, "explanation-quality")).toBe("POLICY_PENDING");
    expect(evaluateReleaseGates(input).verdict).toBe("NOT READY");
  });

  it("來源只有文字位置 → POLICY_PENDING", () => {
    const input = inputFixture({
      audit: auditFixture({
        source: {
          counts: { traceable: 0, partial: 0, unknown: 0, pending_verification: 10 },
          missingDocumentRecord: 10,
          missingQuestionNumber: 0,
          missingSourceHash: 10,
          hasImportBatch: 0,
          staleBlockReferences: 0,
          byOrigin: {},
        },
      }),
    });
    expect(gateStatus(input, "source-traceability")).toBe("POLICY_PENDING");
  });

  it("沒有擁有者版權確認 → POLICY_PENDING；有確認但逐份紀錄不足 → WARN", () => {
    expect(
      gateStatus(
        inputFixture({
          copyright: { documents: 10, distributable: 10, rightsRecorded: 0, ownerAttestation: false },
        }),
        "copyright",
      ),
    ).toBe("POLICY_PENDING");
    expect(
      gateStatus(
        inputFixture({
          copyright: { documents: 10, distributable: 10, rightsRecorded: 5, ownerAttestation: true },
        }),
        "copyright",
      ),
    ).toBe("WARN");
  });

  it("缺少測試證據或部署證據 → INSUFFICIENT_EVIDENCE", () => {
    const noTests = inputFixture({
      tests: { evidenceProvided: false, failures: 0, skipped: 0, commands: [] },
    });
    expect(gateStatus(noTests, "tests")).toBe("INSUFFICIENT_EVIDENCE");
    const noDeployment = inputFixture({ deployment: { evidenceProvided: false, notes: [] } });
    expect(gateStatus(noDeployment, "deployment")).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("測試有失敗 → FAIL", () => {
    const input = inputFixture({
      tests: { evidenceProvided: true, failures: 1, skipped: 0, commands: ["npm test"] },
    });
    expect(gateStatus(input, "tests")).toBe("FAIL");
  });

  it("技能標籤缺失只令閘門 WARN；其他全部通過時結果為 READY WITH LIMITATIONS", () => {
    const input = inputFixture({
      audit: auditFixture({
        metadata: {
          byCode: { SKILL_MISSING: 10 },
          bySeverity: { blocking: 0, needs_review: 0, warning: 10 },
          skillMissing: 10,
          difficulty: { basic: 10 },
          blockingReferences: 0,
        },
      }),
    });
    expect(gateStatus(input, "metadata")).toBe("WARN");
    expect(evaluateReleaseGates(input).verdict).toBe("READY WITH LIMITATIONS");
  });

  it("與上次報告比較會列出數量變化", () => {
    const report = evaluateReleaseGates(
      inputFixture({
        previous: {
          label: "previous",
          placeholderExplanations: 20,
          answerOnlyExplanations: 10,
          skillMissing: 12,
          sourceUnknown: 2,
        },
      }),
    );
    expect(report.deltas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metric: "佔位解釋", previous: 20, current: 0, change: -20 }),
        expect.objectContaining({ metric: "來源無法追溯", previous: 2, current: 0, change: -2 }),
      ]),
    );
  });
});
