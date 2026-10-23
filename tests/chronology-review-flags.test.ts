/**
 * 待歷史科審核者決定的事項必須如實記錄（Sprint 20）。
 *
 * 2026-10-23 的時序題修正只刪去題幹年份，令題目**結構上**可作答；它沒有、也不能證明
 * 事件定義、時序、選項及標準答案在史實上成立。本檔鎖定那批待審核項目仍然「待審核」：
 * 若有人把狀態改成已核准、或把題目記成已發布，這個測試會失敗。
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const FLAGS_PATH = path.join(
  process.cwd(),
  "docs",
  "teacher-review",
  "chronology-review-flags-2026-10-23.json",
);

interface FlagFile {
  status: string;
  reviewer: string | null;
  notice: string;
  items: Array<{
    questionId: string;
    currentStatus: string;
    flag: string;
    concern: string;
    mustVerify: string[];
  }>;
}

function readFlags(): FlagFile {
  return JSON.parse(fs.readFileSync(FLAGS_PATH, "utf8")) as FlagFile;
}

describe("時序題修正的待審核紀錄", () => {
  it("仍然標示為待歷史科審核，而且沒有記成任何人的覆核", () => {
    const flags = readFlags();
    expect(flags.status).toBe("pending-history-review");
    expect(flags.reviewer).toBeNull();
    expect(flags.notice).toContain("不是覆核紀錄");
  });

  it("兩題都仍標示為草稿，並列明必須逐項核對的內容", () => {
    const flags = readFlags();
    const ids = flags.items.map((item) => item.questionId);
    expect(ids.sort()).toEqual(["q_2753d4272a1b4291", "q_6e575d744fa24f5a"]);
    for (const item of flags.items) {
      expect(item.currentStatus, `${item.questionId} 應仍為草稿`).toBe("draft");
      expect(item.mustVerify.length).toBeGreaterThan(0);
      expect(item.concern.length).toBeGreaterThan(0);
    }
  });

  it("世界大戰題目的疑慮有明確記錄（不得只靠自動檢查）", () => {
    const flags = readFlags();
    const wwii = flags.items.find((item) => item.questionId === "q_2753d4272a1b4291");
    expect(wwii?.flag).toBe("event-definition-conflation");
    // 具體疑慮：把「盟軍反攻」與「太平洋戰爭爆發」併為同一項事件
    expect(wwii?.concern).toContain("太平洋戰爭");
    expect(wwii?.concern).toContain("1941");
  });
});
