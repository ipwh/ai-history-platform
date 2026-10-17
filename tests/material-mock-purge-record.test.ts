/**
 * 清除全部 material-mock（本地示範生成）題目的紀錄測試（2026-10-17）。
 *
 * 這是一次 171 條題目的破壞性操作，紀錄必須如實反映：
 *   - 全部題目逐條列出，並記錄刪除前的作答／回報／覆核數；
 *   - 只有 1 筆作答及 1 筆覆核受影響（其餘為 0），學生歷史沒有被刪除（只成為孤立紀錄）；
 *   - 有可還原快照；
 *   - 沒有改動其他來源的題目。
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const FILE = path.join("docs", "teacher-review", "material-mock-purge-2026-10-17.json");

interface MockPurgeRecord {
  version: number;
  date: string;
  status: string;
  requestedBy: string;
  scope: { condition: string; totalAtPurge: number; notAffected: string[] };
  deletion: {
    count: number;
    byType: Record<string, number>;
    withStudentHistory: number;
    totalAttemptsAffected: number;
    totalReportsAffected: number;
    totalReviewsAffected: number;
    questions: {
      questionId: string;
      questionType: string;
      statusBefore: string;
      stem: string;
      correctAnswer: string;
      attemptsBeforeDeletion: number;
      reportsBeforeDeletion: number;
      reviewsBeforeDeletion: number;
    }[];
  };
  backup: { path: string; sizeBytes: number; note: string };
  impact: {
    before: { questions: number; materialMock: number; reviews: number; attempts: number };
    after: { questions: number; materialMock: number; materialAi: number; reviews: number; attempts: number };
  };
  verification: { integrityCheck: string; orphanDelta: { attempts: number; reports: number } };
  notDone: string[];
}

const record = JSON.parse(fs.readFileSync(FILE, "utf8")) as MockPurgeRecord;

describe("material-mock 題目清除紀錄", () => {
  it("逐條記錄 171 條刪除，全部來自 material-mock 且狀態如實", () => {
    expect(record.version).toBe(1);
    expect(record.date).toBe("2026-10-17");
    expect(record.status).toBe("applied-local-only");
    expect(record.deletion.count).toBe(171);
    expect(record.deletion.questions).toHaveLength(171);
    expect(record.scope.totalAtPurge).toBe(171);
    expect(Object.values(record.deletion.byType).reduce((sum, n) => sum + n, 0)).toBe(171);
    for (const question of record.deletion.questions) {
      expect(question.questionId.startsWith("q_"), question.questionId).toBe(true);
      expect(["mc", "fill", "short"]).toContain(question.questionType);
      expect(question.stem.length, question.questionId).toBeGreaterThan(3);
      expect(question.statusBefore).toBe("published");
    }
  });

  it("記錄受影響的學生歷史：只有 1 筆作答、1 筆覆核", () => {
    expect(record.deletion.withStudentHistory).toBe(2);
    expect(record.deletion.totalAttemptsAffected).toBe(1);
    expect(record.deletion.totalReportsAffected).toBe(0);
    expect(record.deletion.totalReviewsAffected).toBe(1);
    expect(record.impact.before.attempts).toBe(record.impact.after.attempts);
    expect(record.impact.before.reviews).toBe(record.impact.after.reviews);
  });

  it("清除後題庫只剩其他來源，並有可還原快照", () => {
    expect(record.impact.after.materialMock).toBe(0);
    expect(record.impact.after.materialAi).toBeGreaterThan(0);
    expect(record.impact.before.questions - record.deletion.count).toBe(record.impact.after.questions);
    expect(record.backup.path).toMatch(/^data\/exports\/app\.db\.pre-mock-purge-.+\.db$/);
    expect(record.backup.sizeBytes).toBeGreaterThan(1_000_000);
  });

  it("完整性 ok，且孤立紀錄的增量等于原有的作答／回報數", () => {
    expect(record.verification.integrityCheck).toBe("ok");
    expect(record.verification.orphanDelta.attempts).toBe(record.deletion.totalAttemptsAffected);
    expect(record.verification.orphanDelta.reports).toBe(record.deletion.totalReportsAffected);
  });

  it("明確聲明沒有改動其他來源的題目或覆核紀錄", () => {
    expect(record.scope.notAffected).toContain("material-ai");
    expect(record.scope.notAffected).toContain("school-paper");
    expect(record.notDone.join(" ")).toContain("沒有改動 material-ai");
    expect(record.notDone.join(" ")).toContain("沒有建立或修改任何覆核紀錄");
  });
});
