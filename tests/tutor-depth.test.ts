import { describe, expect, it } from "vitest";

import {
  resolveTutorReplyDepth,
  tutorMaxSourcesForDepth,
} from "@/server/services/tutor-depth";

/**
 * 回覆深度（2026-11-06）。
 *
 * 起因：使用者回報「平台回覆太簡單，未能有效照顧高能力學生的需要」——兩個提問
 * （「英國如何對付美國革命？」「美國革命與法國大革命有哪些關係？」）都只得到同一個
 * 四段精簡結構。這裡鎖定自動判斷的規則，避免日後改動提示詞時又退回「一律精簡」。
 */
describe("resolveTutorReplyDepth", () => {
  it("比較／因果／關係類提問 → 進階分析", () => {
    expect(resolveTutorReplyDepth("auto", "美國革命與法國大革命有哪些關係？")).toBe("advanced");
    expect(resolveTutorReplyDepth("auto", "英國如何對付美國革命？")).toBe("advanced");
    expect(resolveTutorReplyDepth("auto", "工業革命為何先在英國出現？")).toBe("advanced");
  });

  it("評價／爭議類提問 → 挑戰・史觀", () => {
    expect(resolveTutorReplyDepth("auto", "你認為凡爾賽條約對德國人公平嗎？")).toBe("challenge");
    expect(resolveTutorReplyDepth("auto", "明治維新在多大程度上是一場成功的改革？")).toBe(
      "challenge",
    );
    // 實測發現：學生實際會打的「你同意嗎」原本沒有命中，被誤判為進階
    expect(
      resolveTutorReplyDepth("auto", "有人認為美國革命只是殖民地精英維護自身利益的運動，你同意嗎？"),
    ).toBe("challenge");
    expect(resolveTutorReplyDepth("auto", "你認為冷戰的結束是蘇聯內部崩潰的結果嗎？")).toBe(
      "challenge",
    );
  });

  it("因果提問提及「不同意」不會被當成評價題", () => {
    expect(resolveTutorReplyDepth("auto", "英國為何不同意殖民地自治的要求？")).toBe("advanced");
  });

  /**
   * 英文句式（2026-11-06）：正規化會去掉空格，中文規則比對不到英文句子，
   * 實測時所有英文提問都一律落到 `advanced`——低程度的 who/what/when 被過度加深，
   * 高程度的 "to what extent" 則永遠去不到 `challenge`。
   */
  it("英文低程度提問（who／what／when）→ 精簡", () => {
    expect(resolveTutorReplyDepth("auto", "Who was George Washington?")).toBe("standard");
    expect(resolveTutorReplyDepth("auto", "What was the Boston Tea Party?")).toBe("standard");
    expect(resolveTutorReplyDepth("auto", "When did the American Revolution begin?")).toBe(
      "standard",
    );
  });

  it("英文中程度提問（how／why／explain）→ 進階分析", () => {
    expect(resolveTutorReplyDepth("auto", "How did Britain respond to the American Revolution?")).toBe(
      "advanced",
    );
    expect(resolveTutorReplyDepth("auto", "Why did the American Revolution begin?")).toBe(
      "advanced",
    );
    expect(
      resolveTutorReplyDepth("auto", "Compare and contrast the causes of the American Revolution."),
    ).toBe("advanced");
  });

  it("英文高程度提問（to what extent／evaluate／discuss whether）→ 挑戰・史觀", () => {
    expect(
      resolveTutorReplyDepth(
        "auto",
        "To what extent was the American Revolution caused by economic factors?",
      ),
    ).toBe("challenge");
    expect(
      resolveTutorReplyDepth("auto", "Evaluate the impact of the Treaty of Versailles on Germany."),
    ).toBe("challenge");
    expect(
      resolveTutorReplyDepth(
        "auto",
        "Discuss whether the Treaty of Versailles was fair to Germany.",
      ),
    ).toBe("challenge");
  });

  it("只問是甚麼／哪一年的辨識型提問 → 精簡", () => {
    expect(resolveTutorReplyDepth("auto", "什麼是文藝復興？")).toBe("standard");
  });

  it("短追問沿用上一輪深度，避免深入討論突然中斷", () => {
    expect(resolveTutorReplyDepth("auto", "點解？", "advanced")).toBe("advanced");
    expect(resolveTutorReplyDepth("auto", "然後呢？", "challenge")).toBe("challenge");
    // 沒有上一輪紀錄時退回精簡，不會無故展開長篇分析
    expect(resolveTutorReplyDepth("auto", "點解？")).toBe("standard");
  });

  it("學生自行選擇的深度優先於自動判斷", () => {
    expect(resolveTutorReplyDepth("challenge", "什麼是文藝復興？")).toBe("challenge");
    expect(resolveTutorReplyDepth("standard", "美國革命與法國大革命有哪些關係？")).toBe("standard");
  });

  it("越深的分析會引用越多教材段落，但仍有上限", () => {
    expect(tutorMaxSourcesForDepth("standard")).toBe(3);
    expect(tutorMaxSourcesForDepth("advanced")).toBeGreaterThan(
      tutorMaxSourcesForDepth("standard"),
    );
    expect(tutorMaxSourcesForDepth("challenge")).toBeGreaterThan(
      tutorMaxSourcesForDepth("advanced"),
    );
    expect(tutorMaxSourcesForDepth("challenge")).toBeLessThanOrEqual(6);
  });
});
