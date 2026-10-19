/**
 * Golden evaluation dataset 的 schema（v2）及唯讀評估器。
 *
 * 設計界線：
 *   - `approved` fixture 必須有教師身分、審核時間、題目版本／內容指紋及來源證據；
 *   - 沒有教師確認時只可維持 `draft`／`pending-review`，不得偽造；
 *   - 題目內容一改（revision／fingerprint 不同）即令 fixture 失效；
 *   - dataset 為空或沒有 approved fixture 時，評估結果為 `INSUFFICIENT_EVIDENCE`，
 *     不是「零錯誤」。
 */
import { z } from "zod";

import type { Question } from "../../lib/types";
import { gradeAnswer } from "../services/grading";

export const GOLDEN_CATEGORIES = [
  "chronology",
  "cause-consequence",
  "significance",
  "comparison",
  "people",
  "treaty",
  "plausible-distractors",
] as const;

export const GOLDEN_STATUSES = [
  "draft",
  "pending-review",
  "approved",
  "rejected",
  "superseded",
] as const;

export type GoldenStatus = (typeof GOLDEN_STATUSES)[number];

const evidenceSchema = z.object({
  sourceExcerpt: z.string().min(8),
  sourceLocation: z.string().min(1),
  sourceBlockIds: z.array(z.string()),
  /** 教材以外的權威來源；沒有就必須明確填 null。 */
  reference: z.string().nullable(),
});

export const goldenFixtureSchema = z
  .object({
    fixtureId: z.string().min(1),
    datasetVersion: z.string().min(1),
    source: z.object({
      questionId: z.string().min(1).nullable(),
      revision: z.number().int().positive().nullable(),
      fingerprint: z.string().min(1).nullable(),
    }),
    curriculum: z.object({
      level: z.number().int(),
      topicId: z.string().min(1),
      topicTitle: z.string().min(1),
      sectionId: z.string().min(1),
      sectionTitle: z.string().min(1),
    }),
    questionType: z.enum(["mc", "fill"]),
    difficulty: z.string().min(1),
    stem: z.string().min(4),
    options: z.array(z.string().min(1)),
    correctAnswer: z.string().min(1),
    acceptedAnswers: z.array(z.string()),
    gradingPoints: z.array(z.string()),
    explanation: z.string().min(1),
    evidence: evidenceSchema,
    reasoning: z.string().min(8),
    distractorNotes: z.array(z.object({ option: z.string().min(1), why: z.string().min(4) })),
    category: z.enum(GOLDEN_CATEGORIES),
    skill: z.string().nullable(),
    reviewStatus: z.enum(GOLDEN_STATUSES),
    reviewer: z.string().nullable(),
    reviewedAt: z.string().nullable(),
    reviewNote: z.string().nullable(),
    knownEdgeCases: z.array(z.string()),
    expected: z.object({
      servable: z.boolean(),
      grading: z.array(z.object({ answer: z.string().min(1), correct: z.boolean() })),
    }),
    supersededBy: z.string().nullable(),
  })
  .superRefine((fixture, context) => {
    const requiresHumanDecision =
      fixture.reviewStatus === "approved" || fixture.reviewStatus === "rejected";
    if (requiresHumanDecision) {
      if (!fixture.reviewer || fixture.reviewer.trim().length === 0) {
        context.addIssue({
          code: "custom",
          path: ["reviewer"],
          message: "approved／rejected fixture 必須填寫 reviewer（不得偽造教師裁決）",
        });
      }
      if (!fixture.reviewedAt || Number.isNaN(Date.parse(fixture.reviewedAt))) {
        context.addIssue({
          code: "custom",
          path: ["reviewedAt"],
          message: "approved／rejected fixture 必須填寫有效的 reviewedAt",
        });
      }
    } else if (fixture.reviewer !== null || fixture.reviewedAt !== null) {
      context.addIssue({
        code: "custom",
        path: ["reviewer"],
        message: "未裁決的 fixture 不可填寫 reviewer／reviewedAt",
      });
    }

    if (fixture.reviewStatus === "superseded" && !fixture.supersededBy) {
      context.addIssue({
        code: "custom",
        path: ["supersededBy"],
        message: "superseded fixture 必須說明被甚麼取代（supersededBy）",
      });
    }

    if (fixture.reviewStatus === "approved") {
      if (
        fixture.source.questionId === null ||
        fixture.source.revision === null ||
        fixture.source.fingerprint === null
      ) {
        context.addIssue({
          code: "custom",
          path: ["source"],
          message: "approved fixture 必須綁定題目 ID、版本及內容指紋",
        });
      }
      if (fixture.evidence.sourceBlockIds.length === 0 && !fixture.evidence.reference) {
        context.addIssue({
          code: "custom",
          path: ["evidence"],
          message: "approved fixture 必須有教材段落或具名權威來源",
        });
      }
    }

    if (fixture.questionType === "mc") {
      if (fixture.options.length < 2) {
        context.addIssue({
          code: "custom",
          path: ["options"],
          message: "選擇題至少要有 2 個選項",
        });
      }
      if (!fixture.options.includes(fixture.correctAnswer)) {
        context.addIssue({
          code: "custom",
          path: ["correctAnswer"],
          message: "選擇題的 correctAnswer 必須是其中一個選項",
        });
      }
      if (fixture.distractorNotes.length !== fixture.options.length - 1) {
        context.addIssue({
          code: "custom",
          path: ["distractorNotes"],
          message: `錯誤選項說明數量應為 ${fixture.options.length - 1}`,
        });
      }
    } else if (fixture.options.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "填充題不應有選項",
      });
    }
  });

export type GoldenFixture = z.infer<typeof goldenFixtureSchema>;

export const goldenDatasetSchema = z.object({
  version: z.number().int().positive(),
  datasetVersion: z.string().min(1),
  reviewStatus: z.enum(GOLDEN_STATUSES),
  reviewerRequired: z.literal(true),
  targetPerCategory: z.number().int().positive(),
  coverage: z.record(z.enum(GOLDEN_CATEGORIES), z.number().int().nonnegative()),
  notes: z.array(z.string()),
  questions: z.array(goldenFixtureSchema),
});

export type GoldenDataset = z.infer<typeof goldenDatasetSchema>;

export interface GoldenQuestionSnapshot {
  id: string;
  revision: number;
  fingerprint: string;
  servable: boolean;
  question: Question;
}

export type GoldenOutcome = "pass" | "fail" | "skipped";

export interface GoldenFixtureResult {
  fixtureId: string;
  reviewStatus: GoldenStatus;
  outcome: GoldenOutcome;
  codes: string[];
  detail: string;
}

export interface GoldenEvaluationResult {
  datasetVersion: string;
  totals: {
    fixtures: number;
    approved: number;
    pending: number;
    rejected: number;
    superseded: number;
    draft: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  evidenceSufficient: boolean;
  status: "PASS" | "FAIL" | "INSUFFICIENT_EVIDENCE";
  results: GoldenFixtureResult[];
}

export function evaluateGoldenDataset(
  dataset: GoldenDataset,
  lookup: Map<string, GoldenQuestionSnapshot>,
): GoldenEvaluationResult {
  const counts = {
    approved: 0,
    pending: 0,
    rejected: 0,
    superseded: 0,
    draft: 0,
  };
  const seenFixtureIds = new Set<string>();
  const results: GoldenFixtureResult[] = [];

  for (const fixture of dataset.questions) {
    if (fixture.reviewStatus === "approved") counts.approved += 1;
    else if (fixture.reviewStatus === "pending-review") counts.pending += 1;
    else if (fixture.reviewStatus === "rejected") counts.rejected += 1;
    else if (fixture.reviewStatus === "superseded") counts.superseded += 1;
    else counts.draft += 1;

    if (fixture.reviewStatus !== "approved") {
      results.push({
        fixtureId: fixture.fixtureId,
        reviewStatus: fixture.reviewStatus,
        outcome: "skipped",
        codes: ["FIXTURE_NOT_APPROVED"],
        detail: "未經教師核准的 fixture 不會被當作正式評估結果",
      });
      continue;
    }

    if (seenFixtureIds.has(fixture.fixtureId)) {
      results.push({
        fixtureId: fixture.fixtureId,
        reviewStatus: fixture.reviewStatus,
        outcome: "fail",
        codes: ["DUPLICATE_FIXTURE_ID"],
        detail: "fixtureId 重複",
      });
      continue;
    }
    seenFixtureIds.add(fixture.fixtureId);

    const snapshot = fixture.source.questionId
      ? lookup.get(fixture.source.questionId)
      : undefined;
    if (!snapshot) {
      results.push({
        fixtureId: fixture.fixtureId,
        reviewStatus: fixture.reviewStatus,
        outcome: "fail",
        codes: ["SOURCE_QUESTION_MISSING"],
        detail: "題庫找不到 fixture 指定的題目",
      });
      continue;
    }
    if (
      snapshot.revision !== fixture.source.revision ||
      snapshot.fingerprint !== fixture.source.fingerprint
    ) {
      results.push({
        fixtureId: fixture.fixtureId,
        reviewStatus: fixture.reviewStatus,
        outcome: "fail",
        codes: ["FIXTURE_STALE"],
        detail: `題目現為第 ${snapshot.revision} 版；fixture 綁定第 ${fixture.source.revision} 版`,
      });
      continue;
    }

    const codes: string[] = [];
    if (snapshot.servable !== fixture.expected.servable) {
      codes.push("SERVABILITY_MISMATCH");
    }
    if (fixture.questionType === "mc" && !fixture.options.includes(fixture.correctAnswer)) {
      codes.push("ANSWER_NOT_IN_OPTIONS");
    }
    for (const expectation of fixture.expected.grading) {
      const outcome = gradeAnswer(snapshot.question, expectation.answer);
      if (outcome.isCorrect !== expectation.correct) {
        codes.push("GRADING_MISMATCH");
        break;
      }
    }

    results.push({
      fixtureId: fixture.fixtureId,
      reviewStatus: fixture.reviewStatus,
      outcome: codes.length === 0 ? "pass" : "fail",
      codes,
      detail:
        codes.length === 0
          ? "結構、版本、答案及評分行為符合 fixture 預期"
          : "fixture 預期與現況不符",
    });
  }

  const totals = {
    fixtures: dataset.questions.length,
    ...counts,
    passed: results.filter((result) => result.outcome === "pass").length,
    failed: results.filter((result) => result.outcome === "fail").length,
    skipped: results.filter((result) => result.outcome === "skipped").length,
  };
  const evidenceSufficient = totals.approved > 0;
  return {
    datasetVersion: dataset.datasetVersion,
    totals,
    evidenceSufficient,
    status: !evidenceSufficient
      ? "INSUFFICIENT_EVIDENCE"
      : totals.failed > 0
        ? "FAIL"
        : "PASS",
    results,
  };
}
