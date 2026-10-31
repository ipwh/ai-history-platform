import { describe, expect, it } from "vitest";

import { parseTutorQuestionSuggestions } from "@/lib/tutor-question-suggestions";

describe("學伴的提問澄清方向", () => {
  it("只解析明確標記的兩至三個問題，並保留回答文字", () => {
    expect(
      parseTutorQuestionSuggestions(
        "我未能確定你想問哪方面。\n【可選提問方向】\n1. 文藝復興如何影響歐洲文化？\n2. 文藝復興藝術有甚麼特色？\n你也可以自行改寫問題。",
      ),
    ).toEqual({
      content: "我未能確定你想問哪方面。\n你也可以自行改寫問題。",
      suggestions: ["文藝復興如何影響歐洲文化？", "文藝復興藝術有甚麼特色？"],
    });
  });

  it("支援中文序號及最多三個方向", () => {
    expect(
      parseTutorQuestionSuggestions(
        "【可選提問方向】\n一、文藝復興的背景是甚麼？\n二、誰是文藝復興的重要藝術家？\n三、文藝復興如何傳播？\n四、這個不應顯示。",
      ).suggestions,
    ).toEqual([
      "文藝復興的背景是甚麼？",
      "誰是文藝復興的重要藝術家？",
      "文藝復興如何傳播？",
    ]);
  });

  it("沒有標記或不足兩項時不會轉成快捷按鈕", () => {
    expect(parseTutorQuestionSuggestions("1. 第一點\n2. 第二點").suggestions).toEqual([]);
    expect(
      parseTutorQuestionSuggestions("【可選提問方向】\n1. 只有一個問題？").suggestions,
    ).toEqual([]);
  });
});
