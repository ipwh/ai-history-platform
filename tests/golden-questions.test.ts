/**
 * 黃金題庫（人工覆核紀錄）的格式驗證。
 *
 * 這一組測試刻意**不**驗證任何歷史內容：系統無法判斷史實是否正確，只有教師可以。
 * 它能保證的是：
 *   1. 紀錄格式完整（課程層級、來源、解釋、錯誤選項說明等欄位齊全）。
 *   2. 沒有任何一筆紀錄可以在缺少覆核者及覆核日期的情況下標示為「已覆核」
 *      —— 避免以程式產生或複製的內容冒充教師覆核。
 *   3. 覆蓋統計與實際紀錄一致（不可謊報某一類別已有題目）。
 *
 * 覆核流程見 docs/teacher-review/README.md。
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const REVIEW_CATEGORIES = [
  "chronology",
  "cause-consequence",
  "significance",
  "comparison",
  "people",
  "treaty",
  "plausible-distractors",
] as const;

const reviewedQuestionSchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().positive(),
    curriculum: z.object({
      level: z.number().int(),
      topicId: z.string().min(1),
      topicTitle: z.string().min(1),
      sectionId: z.string().min(1),
      sectionTitle: z.string().min(1),
    }),
    stem: z.string().min(4),
    options: z.array(z.string().min(1)),
    approvedAnswer: z.string().min(1),
    acceptedAlternatives: z.array(z.string()),
    gradingRubric: z.array(z.string()),
    evidence: z.object({
      sourceExcerpt: z.string().min(8),
      sourceLocation: z.string().min(1),
      sourceBlockIds: z.array(z.string()),
      /** 教材以外的權威來源；沒有就必須明確填 null，不可留空假裝有依據 */
      reference: z.string().nullable(),
    }),
    reasoning: z.string().min(8),
    distractorNotes: z.array(z.object({ option: z.string().min(1), why: z.string().min(4) })),
    category: z.enum(REVIEW_CATEGORIES),
    /** 主要考核的歷史技能（HISTORY_SKILLS 之一；未標示為 null） */
    skill: z.string().nullable().default(null),
    reviewStatus: z.enum(["pending-review", "approved"]),
    reviewer: z.string().nullable(),
    reviewedAt: z.string().nullable(),
  })
  .superRefine((question, context) => {
    if (question.reviewStatus === "approved") {
      if (question.reviewer === null || question.reviewer.trim().length === 0) {
        context.addIssue({
          code: "custom",
          message: "標示為已覆核的紀錄必須填寫 reviewer（不得偽造教師覆核）",
        });
      }
      if (question.reviewedAt === null || Number.isNaN(Date.parse(question.reviewedAt))) {
        context.addIssue({
          code: "custom",
          message: "標示為已覆核的紀錄必須填寫有效的 reviewedAt 日期",
        });
      }
    } else if (question.reviewer !== null || question.reviewedAt !== null) {
      context.addIssue({
        code: "custom",
        message: "尚未覆核的紀錄不可填寫 reviewer 或 reviewedAt（避免假裝已覆核）",
      });
    }

    // 選擇題的答案必須在選項之內，並且要為每個錯誤選項說明原因
    if (question.options.length > 0) {
      if (!question.options.includes(question.approvedAnswer)) {
        context.addIssue({ code: "custom", message: "選擇題的 approvedAnswer 必須是其中一個選項" });
      }
      const expected = question.options.length - 1;
      if (question.distractorNotes.length !== expected) {
        context.addIssue({
          code: "custom",
          message: `錯誤選項說明數量不符（應為 ${expected} 項，實際 ${question.distractorNotes.length} 項）`,
        });
      }
    }
  });

const goldenSetSchema = z.object({
  version: z.number().int().positive(),
  reviewStatus: z.enum(["pending-review", "approved"]),
  reviewerRequired: z.literal(true),
  coverage: z.record(z.enum(REVIEW_CATEGORIES), z.number().int().nonnegative()),
  targetPerCategory: z.number().int().positive(),
  questions: z.array(reviewedQuestionSchema),
});

const datasetPath = path.resolve(process.cwd(), "docs/teacher-review/golden-questions.v1.json");

function loadDataset(): z.infer<typeof goldenSetSchema> {
  return goldenSetSchema.parse(JSON.parse(fs.readFileSync(datasetPath, "utf8")) as unknown);
}

describe("黃金題庫（人工覆核）", () => {
  it("紀錄格式完整且沒有偽造的教師覆核", () => {
    const dataset = loadDataset();
    expect(dataset.version).toBe(1);
    // 每一筆已覆核紀錄都必須有覆核者及日期（由 schema 的 superRefine 保證）
    for (const question of dataset.questions) {
      if (question.reviewStatus === "approved") {
        expect(question.reviewer).not.toBeNull();
        expect(question.reviewedAt).not.toBeNull();
      }
    }
  });

  it("拒絕缺少覆核者的「已覆核」紀錄", () => {
    const forged = {
      id: "golden-999",
      version: 1,
      curriculum: {
        level: 2,
        topicId: "topic-5",
        topicTitle: "課題5",
        sectionId: "topic-5-science-enlightenment",
        sectionTitle: "科學與啟蒙",
      },
      stem: "誰在1517年發表《九十五條論證》？",
      options: ["馬丁路德", "加爾文"],
      approvedAnswer: "馬丁路德",
      acceptedAlternatives: [],
      gradingRubric: [],
      evidence: {
        sourceExcerpt: "德意志神學家馬丁路德發表《九十五條論證》",
        sourceLocation: "教材 DOCX · 第 1 段",
        sourceBlockIds: ["blk_1"],
        reference: null,
      },
      reasoning: "馬丁路德於1517年發表《九十五條論證》，批評教會濫用贖罪券。",
      distractorNotes: [{ option: "加爾文", why: "加爾文在日內瓦推動改革，並非發表九十五條論證的人。" }],
      category: "people",
      // 沒有覆核者就宣稱已覆核 → 必須被拒絕
      reviewStatus: "approved",
      reviewer: null,
      reviewedAt: null,
    };

    const result = reviewedQuestionSchema.safeParse(forged);
    expect(result.success).toBe(false);
  });

  it("覆蓋統計與實際已覆核題目一致（不得謊報覆蓋範圍）", () => {
    const dataset = loadDataset();
    const approved = dataset.questions.filter((question) => question.reviewStatus === "approved");

    for (const category of REVIEW_CATEGORIES) {
      const actual = approved.filter((question) => question.category === category).length;
      expect(dataset.coverage[category], `${category} 的覆蓋統計`).toBe(actual);
    }
  });

  it("在沒有教師覆核者前，整體狀態維持 pending（不得宣稱已完成人工覆核）", () => {
    const dataset = loadDataset();
    const approved = dataset.questions.filter((question) => question.reviewStatus === "approved");
    if (approved.length === 0) {
      expect(dataset.reviewStatus).toBe("pending-review");
    } else {
      // 一旦有已覆核題目，整體狀態必須同步為 approved，且每類都應達到目標題數
      expect(dataset.reviewStatus).toBe("approved");
      for (const category of REVIEW_CATEGORIES) {
        expect(dataset.coverage[category]).toBeGreaterThanOrEqual(dataset.targetPerCategory);
      }
    }
  });
});
