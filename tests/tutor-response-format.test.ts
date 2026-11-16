import { describe, expect, it } from "vitest";

import {
  buildTutorSelfCheckSubmission,
  parseTutorResponseSections,
} from "@/lib/tutor-response-format";

describe("學伴回覆學習區塊", () => {
  it("抽出核心知識及自我檢查題，正文保留其他內容", () => {
    const parsed = parseTutorResponseSections(
      [
        "【核心知識】",
        "冷戰是美蘇兩大陣營長期對抗，但沒有直接爆發全面戰爭。",
        "",
        "一、主要特徵",
        "雙方進行軍備及意識形態競爭。",
        "",
        "【自我檢查題】",
        "為甚麼冷戰期間仍會出現代理人戰爭？",
        "",
      ].join("\n"),
    );

    expect(parsed).toEqual({
      coreKnowledge: "冷戰是美蘇兩大陣營長期對抗，但沒有直接爆發全面戰爭。",
      selfCheckQuestion: "為甚麼冷戰期間仍會出現代理人戰爭？",
      content: "一、主要特徵\n雙方進行軍備及意識形態競爭。",
    });
  });

  it("標記格式不完整時保留原文，不隱藏模型內容", () => {
    const content = "【核心知識】\n\n模型仍有其他回覆。";
    expect(parseTutorResponseSections(content)).toEqual({
      content,
      coreKnowledge: null,
      selfCheckQuestion: null,
    });
  });

  it("組成可見、無分數承諾的自我檢查作答", () => {
    expect(buildTutorSelfCheckSubmission(" 題目？ ", " 我的答案 ")).toContain(
      "題目：題目？\n我的答案：我的答案",
    );
    expect(buildTutorSelfCheckSubmission("題目？", "  ")).toBe("");
  });
});
