/**
 * 課程學習重點（教育局《歷史科學習目標》及《預期學習內容》精簡摘要）的測試。
 * 這些內容會寫入出題提示詞，必須覆蓋課程全部課題，並保留課程「不須強記」的要求。
 */
import { describe, expect, it } from "vitest";

import { HISTORY_SKILLS } from "@/lib/types";
import { CURRICULUM_TOPICS } from "@/server/seed/curriculum";
import {
  HISTORY_LEARNING_GOALS,
  TOPIC_LEARNING_FOCUS,
  historyLearningGoalsText,
  topicLearningFocusText,
} from "@/server/seed/curriculum-focus";

describe("課程學習重點（精簡摘要）", () => {
  it("課程的每個課題都有學習重點", () => {
    const numbered = CURRICULUM_TOPICS.filter((topic) => topic.topicNumber !== null);
    expect(numbered).toHaveLength(12);

    for (const topic of numbered) {
      const text = topicLearningFocusText(topic.topicNumber);
      expect(text).toContain(`課題${topic.topicNumber}`);
      expect(text).toContain("課程著重");
      expect(text.length).toBeGreaterThan(100);
      expect(TOPIC_LEARNING_FOCUS[topic.topicNumber as number].strands.length).toBeGreaterThan(0);
    }
  });

  it("沒有課題編號（未知課題）時不會產生學習重點", () => {
    expect(topicLearningFocusText(null)).toBe("");
    expect(topicLearningFocusText(undefined)).toBe("");
    expect(topicLearningFocusText(99)).toBe("");
  });

  it("保留課程「不須強記」的要求，避免考核課程不要求的細節", () => {
    const text = topicLearningFocusText(5);

    expect(text).toContain("避免學生強記人名及作品名稱");
    expect(text).toContain("不要求學生背誦事件的詳細經過");
    expect(text).toContain("工業革命");
    expect(text).toContain("法國大革命");
  });

  it("學習目標包括知識和理解、技能及態度和價值觀", () => {
    expect(HISTORY_LEARNING_GOALS.knowledge).toHaveLength(5);
    expect(HISTORY_LEARNING_GOALS.attitudes).toHaveLength(4);
    // 技能一項與 src/lib/types.ts 的 HISTORY_SKILLS 相同，不應出現兩種寫法
    expect(HISTORY_LEARNING_GOALS.skills).toEqual(HISTORY_SKILLS);

    const text = historyLearningGoalsText();
    expect(text).toContain("知識和理解：");
    expect(text).toContain("態度和價值觀：");
    expect(text).toContain("正確地使用歷史辭彙");
  });
});
