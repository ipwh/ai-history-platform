/**
 * Golden dataset schema 及評估器測試。
 */
import { describe, expect, it } from "vitest";

import type { Question } from "@/lib/types";
import {
  evaluateGoldenDataset,
  goldenDatasetSchema,
  type GoldenFixture,
  type GoldenQuestionSnapshot,
} from "@/server/quality/golden-dataset";

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: "q1",
    topicId: "topic-5",
    sectionId: "topic-5-renaissance-reformation",
    questionType: "mc",
    difficulty: "basic",
    question: "誰在1517年發表《九十五條論證》？",
    options: ["馬丁路德", "加爾文"],
    correctAnswer: "馬丁路德",
    acceptedAnswers: [],
    explanation: "馬丁路德於1517年發表《九十五條論證》。",
    knowledgePoint: "宗教改革",
    sourceExcerpt: "馬丁路德發表《九十五條論證》",
    sourceLocation: "教材 · 第 1 段",
    sourceBlockIds: ["blk-1"],
    gradingPoints: [],
    origin: "school-paper",
    status: "published",
    sourceVerified: true,
    qualityWarnings: [],
    skill: null,
    revision: 1,
    autoValidatedAt: null,
    autoValidatedRevision: null,
    autoValidatedFingerprint: null,
    teacherConfirmationRequired: false,
    createdAt: "2026-10-19T00:00:00.000Z",
    ...overrides,
  } as Question;
}

function fixture(overrides: Partial<GoldenFixture> = {}): GoldenFixture {
  return {
    fixtureId: "fx-1",
    datasetVersion: "test.1",
    source: { questionId: "q1", revision: 1, fingerprint: "fp-1" },
    curriculum: {
      level: 2,
      topicId: "topic-5",
      topicTitle: "近代歐洲的興起",
      sectionId: "topic-5-renaissance-reformation",
      sectionTitle: "文藝復興",
    },
    questionType: "mc",
    difficulty: "basic",
    stem: "誰在1517年發表《九十五條論證》？",
    options: ["馬丁路德", "加爾文"],
    correctAnswer: "馬丁路德",
    acceptedAnswers: [],
    gradingPoints: [],
    explanation: "馬丁路德於1517年發表《九十五條論證》。",
    evidence: {
      sourceExcerpt: "馬丁路德發表《九十五條論證》",
      sourceLocation: "教材 · 第 1 段",
      sourceBlockIds: ["blk-1"],
      reference: null,
    },
    reasoning: "馬丁路德提出九十五條論證，批評贖罪券。",
    distractorNotes: [{ option: "加爾文", why: "加爾文在日內瓦改革，並非1517年。" }],
    category: "people",
    skill: null,
    reviewStatus: "approved",
    reviewer: "history-teacher@school.edu.hk",
    reviewedAt: "2026-10-19T00:00:00.000Z",
    reviewNote: null,
    knownEdgeCases: [],
    expected: {
      servable: true,
      grading: [
        { answer: "馬丁路德", correct: true },
        { answer: "加爾文", correct: false },
      ],
    },
    supersededBy: null,
    ...overrides,
  };
}

function datasetInput(questions: GoldenFixture[]) {
  return {
    version: 2,
    datasetVersion: "test.1",
    reviewStatus: "pending-review" as const,
    reviewerRequired: true as const,
    targetPerCategory: 2,
    coverage: {
      chronology: 0,
      "cause-consequence": 0,
      significance: 0,
      comparison: 0,
      people: 0,
      treaty: 0,
      "plausible-distractors": 0,
    },
    notes: [],
    questions,
  };
}

function dataset(questions: GoldenFixture[]) {
  return goldenDatasetSchema.parse(datasetInput(questions));
}

const snapshot: GoldenQuestionSnapshot = {
  id: "q1",
  revision: 1,
  fingerprint: "fp-1",
  servable: true,
  question: question(),
};

describe("Golden dataset schema", () => {
  it("approved fixture 缺少覆核者或來源指紋時被拒絕", () => {
    expect(
      goldenDatasetSchema.safeParse(datasetInput([{ ...fixture(), reviewer: null }])).success,
    ).toBe(false);
    expect(
      goldenDatasetSchema.safeParse(
        datasetInput([
          { ...fixture(), source: { questionId: "q1", revision: null, fingerprint: null } },
        ]),
      ).success,
    ).toBe(false);
  });

  it("pending fixture 不可預先填寫 reviewer／reviewedAt", () => {
    expect(
      goldenDatasetSchema.safeParse(
        datasetInput([
          {
            ...fixture(),
            reviewStatus: "pending-review",
            reviewer: "someone",
            reviewedAt: "2026-10-19T00:00:00.000Z",
          },
        ]),
      ).success,
    ).toBe(false);
  });

  it("superseded fixture 必須說明被甚麼取代", () => {
    expect(
      goldenDatasetSchema.safeParse(
        datasetInput([
          {
            ...fixture(),
            reviewStatus: "superseded",
            reviewer: null,
            reviewedAt: null,
            supersededBy: null,
          },
        ]),
      ).success,
    ).toBe(false);
  });
});

describe("Golden evaluation", () => {
  it("沒有 approved fixture → INSUFFICIENT_EVIDENCE（不是零錯誤）", () => {
    const result = evaluateGoldenDataset(dataset([]), new Map());
    expect(result.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.evidenceSufficient).toBe(false);
  });

  it("pending fixture 不會被當作正式結果", () => {
    const result = evaluateGoldenDataset(
      dataset([
        {
          ...fixture(),
          reviewStatus: "pending-review",
          reviewer: null,
          reviewedAt: null,
        },
      ]),
      new Map([["q1", snapshot]]),
    );
    expect(result.totals.pending).toBe(1);
    expect(result.totals.approved).toBe(0);
    expect(result.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.results[0]?.codes).toContain("FIXTURE_NOT_APPROVED");
  });

  it("approved 且版本、答案及評分行為符合預期 → PASS", () => {
    const result = evaluateGoldenDataset(
      dataset([fixture()]),
      new Map([["q1", snapshot]]),
    );
    expect(result.status).toBe("PASS");
    expect(result.results[0]?.outcome).toBe("pass");
  });

  it("題目內容指紋改變 → fixture 失效", () => {
    const result = evaluateGoldenDataset(
      dataset([fixture()]),
      new Map([["q1", { ...snapshot, fingerprint: "fp-changed" }]]),
    );
    expect(result.status).toBe("FAIL");
    expect(result.results[0]?.codes).toContain("FIXTURE_STALE");
  });

  it("可作答性與 fixture 預期不符 → FAIL", () => {
    const result = evaluateGoldenDataset(
      dataset([fixture()]),
      new Map([["q1", { ...snapshot, servable: false }]]),
    );
    expect(result.results[0]?.codes).toContain("SERVABILITY_MISMATCH");
  });

  it("評分結果與 fixture 預期不符 → FAIL（可偵測答案映射錯誤）", () => {
    const result = evaluateGoldenDataset(
      dataset([
        {
          ...fixture(),
          expected: {
            servable: true,
            grading: [
              { answer: "馬丁路德", correct: true },
              { answer: "加爾文", correct: true },
            ],
          },
        },
      ]),
      new Map([["q1", snapshot]]),
    );
    expect(result.results[0]?.codes).toContain("GRADING_MISMATCH");
  });

  it("fixtureId 重複 → FAIL", () => {
    const result = evaluateGoldenDataset(
      dataset([fixture(), fixture()]),
      new Map([["q1", snapshot]]),
    );
    expect(result.results.some((item) => item.codes.includes("DUPLICATE_FIXTURE_ID"))).toBe(true);
  });
});
