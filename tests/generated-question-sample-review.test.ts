/**
 * 教師覆核套件（Sprint 8.6 第一階段）的完整性測試。
 *
 * 套件由 `npm run review:package -- --write`（scripts/build-review-package.ts）以**唯讀**
 * 方式從資料庫產生。這裡只驗證結構與**不得偽造覆核**的規則：
 *   - 每一項決定都必須是 pending-review，覆核者及日期必須留空；
 *   - 一旦有人填了決定，就必須同時填寫覆核者及日期；
 *   - 每個項目都要有出處、逐字節錄、答案、解釋、機器檢查結果及七項審題準則；
 *   - 節錄只在教師／管理員可見的 docs/ 內，不經學生端路由提供（學生端由 source-visibility 決定）。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface SampleItem {
  questionId: string;
  provenance: {
    topicId: string;
    origin: string;
    status: string;
    questionType: string;
    difficulty: string;
    revision: number;
    sourceLocation: string;
    sourceBlockIds: string[];
    sourceExcerpt: string;
    sourceExcerptLength: number;
    sourceContext: {
      blockId: string;
      sourceLocation: string;
      type: string;
      textLength: number;
      text: string;
    }[];
    sourceVerified: boolean;
  };
  learningObjective: { knowledgePoint: string; skill: string | null; intendedDifficulty: string };
  content: {
    question: string;
    options: string[];
    correctAnswer: string;
    acceptedAnswers: string[];
    gradingPoints: string[];
    explanation: string;
  };
  machineChecks: {
    gateAtGeneration: { teacherConfirmationRequired: boolean; qualityWarnings: string[] };
    gateRecomputedNow: { outcome: string; codes: string[]; notes: string[] };
  };
  reviewChecklist: Record<string, string | null>;
  reviewComments: string | null;
  reviewerDecision: string;
  reviewer: string | null;
  reviewedAt: string | null;
  outstandingConcerns: unknown[];
}

interface SampleFile {
  version: number;
  reviewStatus: string;
  reviewCriteria: { id: string; label: string }[];
  howToUse: string[];
  disclaimer: string[];
  items: SampleItem[];
}

const FILE = path.join("docs", "teacher-review", "generated-question-sample-2026-10.json");
const sample = JSON.parse(fs.readFileSync(FILE, "utf8")) as SampleFile;

describe("真實生成題目的教師覆核套件（待覆核，不得由程式代填）", () => {
  it("涵蓋代表性的來源、題型及難度，並提供七項審題準則", () => {
    expect(sample.version).toBe(3);
    // 2026-10-17：擁有者指示清除全部 material-mock 示範題，抽樣因此只餘 material-ai（5 題）
    expect(sample.items.length).toBeGreaterThanOrEqual(5);
    expect(sample.reviewCriteria.length).toBe(7);
    expect(sample.howToUse.length).toBeGreaterThanOrEqual(4);
    expect(sample.disclaimer.length).toBeGreaterThanOrEqual(3);
    expect(new Set(sample.items.map((item) => item.provenance.origin)).size).toBeGreaterThanOrEqual(1);
    expect(new Set(sample.items.map((item) => item.provenance.questionType)).size).toBe(3);
    expect(new Set(sample.items.map((item) => item.provenance.difficulty)).size).toBeGreaterThanOrEqual(2);
    expect(new Set(sample.items.map((item) => item.questionId)).size).toBe(sample.items.length);
    // 審題準則的 id 必須與每題的 checklist 欄位一致（教師不會看到無法填寫的欄位）
    const criteriaIds = sample.reviewCriteria.map((criterion) => criterion.id).sort();
    for (const item of sample.items) {
      expect(Object.keys(item.reviewChecklist).sort(), item.questionId).toEqual(criteriaIds);
    }
  });

  it("每一項都仍待覆核：沒有覆核者、沒有決定、審題欄位一律空白", () => {
    expect(sample.reviewStatus).toBe("pending-review");
    for (const item of sample.items) {
      expect(item.reviewerDecision, item.questionId).toBe("pending-review");
      expect(item.reviewer, item.questionId).toBeNull();
      expect(item.reviewedAt, item.questionId).toBeNull();
      expect(item.reviewComments, item.questionId).toBeNull();
      expect(item.outstandingConcerns, item.questionId).toEqual([]);
      for (const [key, value] of Object.entries(item.reviewChecklist)) {
        expect(value, `${item.questionId} 的 ${key} 應留空由教師填寫`).toBeNull();
      }
    }
  });

  it("若有人填了決定，必須同時有覆核者及日期（不得偽造覆核）", () => {
    for (const item of sample.items) {
      if (item.reviewerDecision === "pending-review") continue;
      expect(
        typeof item.reviewer === "string" && item.reviewer.trim().length > 0,
        `${item.questionId} 填了決定但沒有覆核者`,
      ).toBe(true);
      expect(
        typeof item.reviewedAt === "string" && item.reviewedAt.length >= 10,
        `${item.questionId} 填了決定但沒有覆核日期`,
      ).toBe(true);
    }
  });

  it("每題都提供審題所需的完整資料（題幹、選項、答案、得分要點、解釋、逐字節錄、機器檢查）", () => {
    for (const item of sample.items) {
      expect(item.questionId.startsWith("q_"), item.questionId).toBe(true);
      expect(item.provenance.topicId.length).toBeGreaterThan(0);
      expect(item.provenance.sourceLocation.length).toBeGreaterThan(0);
      expect(item.provenance.sourceBlockIds.length).toBeGreaterThan(0);
      expect(item.provenance.revision).toBeGreaterThanOrEqual(1);
      expect(["material-ai", "material-mock"]).toContain(item.provenance.origin);
      expect(item.provenance.sourceExcerpt.length).toBe(item.provenance.sourceExcerptLength);
      // 節錄必須是完整原文（不截短），教師才可對照課本判斷史實；平台最短節錄規則為 8 字
      expect(item.provenance.sourceExcerpt.length).toBeGreaterThanOrEqual(8);
      expect(item.provenance.sourceExcerpt.trim().endsWith("…")).toBe(false);

      // Sprint 8.7：附上引用段落原文，讓教師判斷節錄是否被斷章取義（每段有上限）
      expect(item.provenance.sourceContext.length).toBeGreaterThan(0);
      for (const context of item.provenance.sourceContext) {
        expect(item.provenance.sourceBlockIds, item.questionId).toContain(context.blockId);
        expect(context.sourceLocation.trim().length).toBeGreaterThan(0);
        expect(context.text.trim().length).toBeGreaterThan(0);
        expect(context.textLength).toBeGreaterThanOrEqual(context.text.length - 1);
        expect(context.text.length).toBeLessThanOrEqual(401);
      }

      expect(item.content.question.trim().length).toBeGreaterThan(0);
      expect(item.content.correctAnswer.trim().length).toBeGreaterThan(0);
      expect(item.content.explanation.trim().length).toBeGreaterThan(0);
      if (item.provenance.questionType === "mc") {
        expect(item.content.options.length).toBeGreaterThanOrEqual(3);
        expect(item.content.options).toContain(item.content.correctAnswer);
      } else {
        expect(item.content.options).toEqual([]);
      }

      expect(item.learningObjective.knowledgePoint.length).toBeGreaterThan(0);
      expect(["pass", "revise", "reject"]).toContain(item.machineChecks.gateRecomputedNow.outcome);
      expect(Array.isArray(item.machineChecks.gateRecomputedNow.codes)).toBe(true);
      expect(Array.isArray(item.machineChecks.gateAtGeneration.qualityWarnings)).toBe(true);
    }
  });

  it("套件位於 docs/（不在 public/），不會經學生端路由提供", () => {
    const publicDir = path.join("public");
    if (!fs.existsSync(publicDir)) return;
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
      });
    const leaked = walk(publicDir).filter((file) =>
      file.endsWith("generated-question-sample-2026-10.json"),
    );
    expect(leaked).toEqual([]);
  });
});
