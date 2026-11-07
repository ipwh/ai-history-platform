/**
 * 短追問回歸（規格 3.2、8.3）。
 *
 * 學生最常用的追問就是「點解？」這一類。它在真實對話中是最有效的學習行為：學生
 * 已經讀過一段分析，只想深入其中一點。若這些寫法被當成離題，學習流程就會中斷在最
 * 需要幫助的一刻——2026-11-06 實測正是如此（「即係點解？」「你講的第二點點解？」
 * 「Why?」全部收到「只能討論歷史科」）。
 */
import { describe, expect, it } from "vitest";

import { isShortHistoryFollowUp } from "@/server/services/tutor";
import { resolveTutorReplyDepth } from "@/server/services/tutor-depth";

const CANONICAL_FOLLOW_UPS: readonly string[] = [
  // 規格 3.2 明列
  "點解？",
  "為甚麼？",
  "Why?",
  "Can you explain?",
  "即係點解？",
  "你講的第二點點解？",
  "咁又係點解？",
  // 規格 8.3 明列
  "可否舉例？",
  "再深入一點。",
  "用簡單方法解釋。",
  "有甚麼證據？",
  "這是否最重要原因？",
  // 學生實際常用
  "點樣？",
  "然後呢？",
  "第二點呢？",
  "可否再解釋？",
  "咁呢？",
  "有冇記錯？",
  "我理解得啱唔啱？",
  "How so?",
  "What do you mean?",
  "Am I right?",
  "Did I get this right?",
  "Is that correct?",
];

describe("短追問辨識（規格 3.2／8.3）", () => {
  it("規格明列及學生常用的短追問全部辨識得到", () => {
    for (const query of CANONICAL_FOLLOW_UPS) {
      expect(isShortHistoryFollowUp(query), query).toBe(true);
    }
  });

  it("含有相同字樣的完整提問不會被當成短追問", () => {
    const fullQuestions = [
      "點解英國要向北美殖民地加稅？",
      "為甚麼美國革命會影響法國？",
      "點樣比較美國革命與法國大革命？",
      "Why did Britain tax the American colonies?",
      "Can you explain why the American Revolution happened?",
    ];
    for (const query of fullQuestions) {
      expect(isShortHistoryFollowUp(query), query).toBe(false);
    }
  });

  it("空白或過長輸入不會被當成短追問", () => {
    expect(isShortHistoryFollowUp("")).toBe(false);
    expect(isShortHistoryFollowUp("   ")).toBe(false);
    expect(
      isShortHistoryFollowUp("點解".repeat(20)),
    ).toBe(false);
  });

  it("短追問沿用上一輪深度（不會由進階／挑戰掉回精簡）", () => {
    for (const query of CANONICAL_FOLLOW_UPS) {
      expect(resolveTutorReplyDepth("auto", query, "advanced"), query).toBe("advanced");
      expect(resolveTutorReplyDepth("auto", query, "challenge"), query).toBe("challenge");
    }
  });

  it("沒有上一輪深度時，短追問用精簡深度", () => {
    expect(resolveTutorReplyDepth("auto", "點解？", null)).toBe("standard");
    expect(resolveTutorReplyDepth("auto", "Why?", null)).toBe("standard");
  });

  it("學生自行選擇深度時優先於短追問的沿用", () => {
    expect(resolveTutorReplyDepth("challenge", "點解？", "standard")).toBe("challenge");
    expect(resolveTutorReplyDepth("standard", "點解？", "challenge")).toBe("standard");
  });
});
