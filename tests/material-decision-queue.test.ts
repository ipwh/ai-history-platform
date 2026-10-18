/**
 * 「36 條待教師決定題目隊列」的檔案檢查（Sprint 8.2）。
 *
 * 只讀取檔案（不連接資料庫）：確認隊列仍然覆蓋那 36 條、每條都有問題描述、現行教材證據、
 * 建議行動及影響評估，而且沒有把「需要教師判斷」的事情寫成自動處理。
 *
 * 隊列與資料庫的一致性由產生時的交叉核對保證（產生器會比對「引用不存在段落的未核對題目」
 * 是否正好等於隊列內的 36 條，否則中止），本測試則固定住交付的內容。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const QUEUE_PATH = path.join(
  "docs",
  "teacher-review",
  "material-decision-queue-2026-10.json",
);

const EXPECTED_IDS = [
  // A. 答案或歷史解釋與新教材矛盾
  "q_6bfd31fd0e474404",
  "q_aac7a714deaf4e39",
  "q_7de1f4d6f91242ff",
  "q_401ca2e500034b90",
  // B. 答案鍵用詞與新版不符
  "q_9531dd6d6ad34d4a",
  "q_b87d77c973a140dc",
  "q_10e7e20afbf14a17",
  "q_367c44de30bc4771",
  "q_5cad8ee22c1e40ef",
  "q_6fa63925fcda4780",
  "q_cc6088757ff240f1",
  // C. 舊教師版資料題標籤
  "q_b236dc0ccf3c4e0d",
  "q_bb48a9e1547a417e",
  "q_d309b521e6554723",
  "q_8d788c6209e14004",
  "q_320d50660ed04361",
  "q_332eb48af69b42c9",
  "q_35c49b48d3044613",
  "q_f9722f18360144ef",
  "q_316ed0ea39f340fe",
  "q_ee9dfe073a754b91",
  "q_53877c3e5d384e99",
  // D. 新教材已刪去內容或題幹破損
  "q_b97234f5f1cd4086",
  "q_b8d6ecfb9c2142e8",
  "q_c6fc8cd15ce64a54",
  "q_b0579928bff84e53",
  "q_59a6ec63802c4523",
  "q_88fc4367278b4546",
  "q_f320342907b640c8",
  "q_d893eba3b65b4e49",
  "q_44e1838369244a50",
  "q_8fc2332cb98a4c11",
  "q_50e0d5bc27e3422a",
  "q_e4031ed7b25b4a18",
  "q_05d22484343240d5",
  "q_aef95458fecc49a7",
];

interface QueueEntry {
  questionId: string;
  topicId: string;
  sectionId: string;
  questionType: string;
  status: string;
  group: string;
  groupLabel: string;
  issue: string;
  currentTextbookEvidence: string;
  recommendedAction: string;
  actionDetail: string;
  suggestion: { suggestion: string; proposedQuestion?: string; proposedAnswer?: string };
  resolution?: {
    status: "rewritten" | "deleted";
    appliedAt: string;
    manifest: string;
    revision?: number;
    note: string;
  };
  requiresHistoryTeacher: boolean;
  state: { sourceVerified: boolean; revision: number; referencedBlocksExist: boolean };
  impact: { attempts: number; reviewApprovals: number; note: string };
}

interface Queue {
  version: number;
  title: string;
  purpose: string;
  entries: QueueEntry[];
}

const GROUPS = [
  "answer-or-interpretation",
  "answer-key-terminology",
  "legacy-data-labels",
  "content-removed-or-damaged",
];

const ACTIONS = ["correct-answer", "rewrite", "disable", "teacher-decision"];

describe("36 條待教師決定題目隊列", () => {
  const queue = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8")) as Queue;

  it("覆蓋 36 條題目且 ID 不重複", () => {
    expect(queue.version).toBe(1);
    expect(queue.entries).toHaveLength(36);
    const ids = queue.entries.map((entry) => entry.questionId);
    expect([...ids].sort()).toEqual([...EXPECTED_IDS].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每條都有問題描述、現行教材證據、建議行動及影響評估", () => {
    for (const entry of queue.entries) {
      expect(entry.topicId).toMatch(/^topic-\d+$/);
      expect(entry.sectionId.length).toBeGreaterThan(0);
      expect(["mc", "fill", "short"]).toContain(entry.questionType);
      expect(["published", "draft", "disabled"]).toContain(entry.status);
      expect(GROUPS).toContain(entry.group);
      expect(entry.groupLabel.length).toBeGreaterThan(0);
      expect(entry.issue.length).toBeGreaterThan(10);
      expect(entry.currentTextbookEvidence.length).toBeGreaterThan(10);
      expect(ACTIONS).toContain(entry.recommendedAction);
      expect(entry.actionDetail.length).toBeGreaterThanOrEqual(4);
      // 每條都有具體建議（教師可照著做）；建議改寫者必須附建議題目及答案文字
      expect(entry.suggestion.suggestion.length).toBeGreaterThan(10);
      if (entry.recommendedAction === "rewrite") {
        expect((entry.suggestion.proposedQuestion ?? "").length).toBeGreaterThan(5);
        expect((entry.suggestion.proposedAnswer ?? "").length).toBeGreaterThan(1);
      }
      if (entry.recommendedAction === "correct-answer") {
        expect((entry.suggestion.proposedAnswer ?? "").length).toBeGreaterThan(1);
      }
      // 學生端必須維持 fail-closed：引用欄位仍然指向已刪除的段落
      expect(entry.state.sourceVerified).toBe(false);
      expect(entry.state.referencedBlocksExist).toBe(false);
      expect(entry.impact.attempts).toBeGreaterThanOrEqual(0);
      expect(entry.impact.reviewApprovals).toBeGreaterThanOrEqual(0);
      expect(entry.impact.note.length).toBeGreaterThan(0);
    }
  });

  it("36 條已全部處理：31 條改寫（附新版本號）、5 條刪除", () => {
    const resolutions = queue.entries.map((entry) => entry.resolution);
    for (const resolution of resolutions) {
      expect(resolution).toBeDefined();
      expect(["rewritten", "deleted"]).toContain(resolution!.status);
      expect(resolution!.appliedAt).toBe("2026-10-16");
      expect(resolution!.manifest.length).toBeGreaterThan(0);
      expect(resolution!.note.length).toBeGreaterThan(5);
    }
    const rewritten = queue.entries.filter((entry) => entry.resolution!.status === "rewritten");
    const deleted = queue.entries.filter((entry) => entry.resolution!.status === "deleted");
    expect(rewritten).toHaveLength(31);
    expect(deleted).toHaveLength(5);
    for (const entry of rewritten) {
      // 改寫會令題目版本 +1（舊覆核紀錄依既有規則失效）
      expect(entry.resolution!.revision).toBe(entry.state.revision + 1);
    }
    for (const entry of deleted) {
      expect(entry.resolution!.revision).toBeUndefined();
    }
  });

  it("按建議行動分成四類：4／7／11／14 條，且停用／改寫比例與報告一致", () => {
    const counts = new Map<string, number>();
    const actions = new Map<string, number>();
    for (const entry of queue.entries) {
      counts.set(entry.group, (counts.get(entry.group) ?? 0) + 1);
      actions.set(entry.recommendedAction, (actions.get(entry.recommendedAction) ?? 0) + 1);
    }
    expect(counts.get("answer-or-interpretation")).toBe(4);
    expect(counts.get("answer-key-terminology")).toBe(7);
    expect(counts.get("legacy-data-labels")).toBe(11);
    expect(counts.get("content-removed-or-damaged")).toBe(14);
    // 建議行動分佈（與隊列檔一致）：停用 10、改寫 16、更正答案 7、教師決定 3
    expect(actions.get("disable")).toBe(10);
    expect(actions.get("rewrite")).toBe(16);
    expect(actions.get("correct-answer")).toBe(7);
    expect(actions.get("teacher-decision")).toBe(3);
    // 只有「答案或歷史解釋與新教材矛盾」一類需要歷史科教師作史實判斷
    for (const entry of queue.entries) {
      expect(entry.requiresHistoryTeacher).toBe(entry.group === "answer-or-interpretation");
    }
  });
});

describe("課題1 校內試題：仍未能核對教材依據的紀錄（原 25 條，2026-10-17 後現存 16 條）", () => {
  const RECORD_PATH = path.join(
    "docs",
    "teacher-review",
    "school-paper-unverified-2026-10.json",
  );

  interface RecordEntry {
    questionId: string;
    topicId: string;
    questionType: string;
    status: string;
    paperFileName: string;
    sourceLocation: string;
    excerptLineCount: number;
    excerptVerbatimLinesFound: number;
    excerptMissingLines: string[];
    excerptHeadBlock: { sourceLocation: string; matchedPrefixLength: number } | null;
    singleBlockEvidence: boolean;
    recommendation: string;
    removedOn?: string;
  }

  const record = JSON.parse(fs.readFileSync(RECORD_PATH, "utf8")) as {
    version: number;
    title: string;
    purpose: string;
    sourceMaterials: string;
    platformRule: string;
    teacherDecisions: {
      recordedAt: string;
      deletedQuestionIds: string[];
      deletedCount: number;
      remainingCount: number;
    };
    entries: RecordEntry[];
  };

  it("保留原 25 條記錄，並如實標示教師已刪除的 9 條（Sprint 8.8）", () => {
    expect(record.version).toBe(2);
    expect(record.entries).toHaveLength(25);
    const removed = record.entries.filter((entry) => entry.removedOn !== undefined);
    expect(removed).toHaveLength(9);
    for (const entry of removed) expect(entry.removedOn).toBe("2026-10-17");
    expect(record.teacherDecisions.deletedCount).toBe(9);
    expect(record.teacherDecisions.remainingCount).toBe(16);
    expect(record.teacherDecisions.deletedQuestionIds.sort()).toEqual(
      removed.map((entry) => entry.questionId).sort(),
    );
    expect(record.title).toContain("現存 16 條");
  });

  it("所有記錄（包括已刪除者）都沒有單一段落依據，且每條都有原因與證據統計", () => {
    const ids = record.entries.map((entry) => entry.questionId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of record.entries) {
      expect(entry.questionId.startsWith("qb-JTH2ndEd")).toBe(true);
      expect(entry.topicId).toBe("topic-1");
      expect(["mc", "fill", "short"]).toContain(entry.questionType);
      expect(entry.paperFileName.endsWith(".docx")).toBe(true);
      // 關鍵保護：不得聲稱已有單一段落依據（否則應改為連結，而不是列在這裡）
      expect(entry.singleBlockEvidence).toBe(false);
      expect(entry.recommendation).toContain("未通過核對");
      expect(entry.excerptLineCount).toBeGreaterThanOrEqual(1);
      expect(entry.excerptVerbatimLinesFound).toBeGreaterThanOrEqual(0);
      expect(entry.excerptVerbatimLinesFound).toBeLessThanOrEqual(entry.excerptLineCount);
      expect(entry.recommendation.length).toBeGreaterThan(10);
    }
  });

  it("紀錄說明平台核對規則，並指出節錄由多段文字組成", () => {
    expect(record.platformRule).toContain("單一");
    expect(record.purpose).toContain("單一段落");
    expect(record.sourceMaterials).toContain("materials/");
    // 有部分題目連節錄開頭都找不到逐字相符的段落（資料標題等未以文字匯入）
    expect(record.entries.filter((entry) => entry.excerptHeadBlock === null)).toHaveLength(0);
  });
});
