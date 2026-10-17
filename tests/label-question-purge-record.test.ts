/**
 * 機械式「列表標籤」題目清除紀錄（2026-10-17）。
 *
 * 這一組測試鎖定紀錄如實反映一次**破壞性**操作：
 *   - 101 條題目全部列出，且全部來自示範生成（material-mock）、刪除前 0 作答／0 回報／0 覆核；
 *   - 規則明確（R1 答案就是列標籤、R2 題幹引述列標籤），並記錄擁有者提供的例子；
 *   - 刪除前有可還原的資料庫快照；
 *   - 孤立作答／回報紀錄在刪除前後相同（本次操作沒有新增）；
 *   - 沒有建立任何覆核紀錄。
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const FILE = path.join("docs", "teacher-review", "label-question-purge-2026-10-17.json");

interface PurgeRecord {
  version: number;
  date: string;
  status: string;
  requestedBy: string;
  ownerExamples: string[];
  rule: { description: string; conditions: string[]; excluded: string };
  deletion: {
    count: number;
    byRule: Record<string, number>;
    byType: Record<string, number>;
    allFromMockGenerator: boolean;
    allHadNoStudentHistory: boolean;
    questions: {
      questionId: string;
      origin: string;
      questionType: string;
      statusBefore: string;
      rule: string;
      rowLabel: string;
      stem: string;
      correctAnswer: string;
      attemptsBeforeDeletion: number;
      reportsBeforeDeletion: number;
      reviewsBeforeDeletion: number;
    }[];
  };
  backup: { path: string; sizeBytes: number; note: string };
  impact: { before: Record<string, number>; after: Record<string, number>; currentTotals?: Record<string, number> };
  verification: {
    integrityCheck: string;
    orphanAttempts: number;
    orphanReports: number;
    preExistingOrphans: { attempts: number; reports: number; evidence: string };
    note: string;
  };
  notDone: string[];
}

const record = JSON.parse(fs.readFileSync(FILE, "utf8")) as PurgeRecord;

describe("列表標籤題目清除紀錄", () => {
  it("逐條記錄 101 條被刪題目，全部來自示範生成且沒有學生歷史", () => {
    expect(record.version).toBe(1);
    expect(record.date).toBe("2026-10-17");
    expect(record.status).toBe("applied-local-only");
    expect(record.deletion.count).toBe(record.deletion.questions.length);
    expect(record.deletion.count).toBe(101);
    expect(record.deletion.allFromMockGenerator).toBe(true);
    expect(record.deletion.allHadNoStudentHistory).toBe(true);
    expect(Object.values(record.deletion.byRule).reduce((sum, n) => sum + n, 0)).toBe(101);
    for (const question of record.deletion.questions) {
      expect(question.origin, question.questionId).toBe("material-mock");
      expect(["published", "draft", "disabled"], question.questionId).toContain(question.statusBefore);
      expect(["answer-is-row-label", "stem-quotes-row-label"], question.questionId).toContain(
        question.rule,
      );
      expect(question.rowLabel.length, question.questionId).toBeGreaterThan(0);
      expect(question.stem.length, question.questionId).toBeGreaterThan(4);
      expect(question.attemptsBeforeDeletion, question.questionId).toBe(0);
      expect(question.reportsBeforeDeletion, question.questionId).toBe(0);
      expect(question.reviewsBeforeDeletion, question.questionId).toBe(0);
    }
  });

  it("記錄擁有者提供的例子與明確規則", () => {
    expect(record.ownerExamples).toHaveLength(6);
    expect(record.ownerExamples.join(" ")).toContain("1948年");
    expect(record.ownerExamples.join(" ")).toContain("社會方面");
    expect(record.requestedBy).toContain("一併刪除");
    expect(record.rule.conditions.length).toBeGreaterThanOrEqual(3);
    expect(record.rule.excluded).toContain("demo");
  });

  it("提供可還原的刪除前快照", () => {
    expect(record.backup.path).toMatch(/^data\/exports\/app\.db\.pre-label-purge-.+\.db$/);
    expect(record.backup.sizeBytes).toBeGreaterThan(1_000_000);
    expect(record.backup.note).toContain("VACUUM INTO");
  });

  it("完整性 ok，且孤立紀錄數量與刪除前相同（不是本次造成）", () => {
    expect(record.verification.integrityCheck).toBe("ok");
    expect(record.verification.orphanAttempts).toBe(record.verification.preExistingOrphans.attempts);
    expect(record.verification.orphanReports).toBe(record.verification.preExistingOrphans.reports);
    expect(record.verification.preExistingOrphans.evidence).toContain("刪除前後");
    expect(record.impact.before.questions - record.deletion.count).toBe(record.impact.after.questions);
  });

  it("沒有建立任何覆核紀錄", () => {
    expect(record.impact.before.reviews).toBe(record.impact.after.reviews);
    expect(record.notDone.join(" ")).toContain("沒有建立或修改任何覆核紀錄");
  });
});
