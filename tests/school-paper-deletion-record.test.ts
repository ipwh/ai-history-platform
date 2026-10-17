/**
 * 校內試卷題目刪除及題目停用紀錄（Sprint 8.8）。
 *
 * 這一組測試鎖定「紀錄如實反映平台上的操作」：
 *   - 11 條被刪題目全部列出，且刪除前都是 0 作答／0 回報／0 覆核（沒有損失學習紀錄）；
 *   - 被刪題目的來源備份位置有明確寫出（可還原）；
 *   - 停用題目只有 1 條，並記錄了擁有者的決定；
 *   - 紀錄明確聲明沒有新增任何覆核紀錄、也沒有代程式作出決定。
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const FILE = path.join("docs", "teacher-review", "school-paper-deletions-2026-10-17.json");

interface DeletionRecord {
  version: number;
  date: string;
  status: string;
  note: string;
  evidenceSource: string[];
  deleted: {
    count: number;
    allHadNoStudentHistory: boolean;
    recoverableFrom: string;
    questions: {
      questionId: string;
      topicId: string;
      questionType: string;
      stemPreview: string;
      attemptsBeforeDeletion: number;
      reportsBeforeDeletion: number;
      reviewsBeforeDeletion: number;
    }[];
  };
  disabled: { questionId: string; questionType: string; correctAnswer: string; reason: string }[];
  baselineImpact: Record<string, string>;
  notDone: string[];
}

const record = JSON.parse(fs.readFileSync(FILE, "utf8")) as DeletionRecord;

describe("校內試卷題目刪除及停用紀錄", () => {
  it("如實記錄 11 條刪除，全部沒有作答／回報／覆核紀錄", () => {
    expect(record.version).toBe(1);
    expect(record.date).toBe("2026-10-17");
    expect(record.status).toBe("confirmed-by-owner-kept");
    expect(record.deleted.count).toBe(record.deleted.questions.length);
    expect(record.deleted.count).toBe(11);
    expect(record.deleted.allHadNoStudentHistory).toBe(true);
    for (const question of record.deleted.questions) {
      expect(question.questionId.startsWith("qb-")).toBe(true);
      expect(question.topicId).toBe("topic-1");
      expect(question.attemptsBeforeDeletion).toBe(0);
      expect(question.reportsBeforeDeletion).toBe(0);
      expect(question.reviewsBeforeDeletion).toBe(0);
      expect(question.stemPreview.length).toBeGreaterThan(5);
    }
  });

  it("記錄可還原的備份來源，及被停用的題目", () => {
    expect(record.deleted.recoverableFrom).toContain("data/exports/");
    expect(record.evidenceSource.some((line) => line.includes("data/app.db"))).toBe(true);
    expect(record.disabled).toHaveLength(1);
    expect(record.disabled[0]!.questionId).toBe("q_df1fd4c05d594891");
    expect(record.disabled[0]!.reason).toContain("刻意停用");
  });

  it("聲明沒有新增覆核紀錄，也沒有代程式作出決定", () => {
    expect(record.note).toContain("由教師／擁有者");
    expect(record.note).toContain("不代表程式代為作出任何決定");
    expect(record.baselineImpact.questionReviews).toContain("沒有新增覆核紀錄");
    expect(record.notDone.join(" ")).toContain("沒有為任何題目建立覆核紀錄");
  });
});
