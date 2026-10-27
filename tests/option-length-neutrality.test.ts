/**
 * 「正確答案不可以是最長的那一項」的可執行契約（2026-10-27）。
 *
 * 背景：Sprint 22 的唯讀審核證實 AI 生成的選擇題有可被利用的表面線索——正確選項
 * 「唯一最長」佔 59.8%，學生若一律選最長那項，命中率 72.5%（隨機基準 25%）。
 * 打亂選項次序沒有幫助，因為線索是長度本身。
 *
 * 這一層是**派題前的最後安全網**（`checkOptionLengthNeutral` ／ `checkQuestionDeliverable`）：
 * 它同時涵蓋已在題庫的舊題目，以及即時生成的題目；生成流程另外會要求重寫一次，
 * 重寫後仍然不對稱者不會寫入題庫（見 question-service）。
 *
 * 這裡刻意不測試「怎樣才算寫得好」——長度只是風險訊號，不是史實正確性的證據。
 */
import { describe, expect, it } from "vitest";

import {
  analyseOptionQuality,
  isSevereLengthAsymmetry,
  optionTextLength,
} from "@/server/quality/option-quality";
import {
  checkOptionLengthNeutral,
  checkQuestionDeliverable,
} from "@/server/services/question-servability";
import { buildSystemPrompt, buildUserPrompt } from "@/server/llm/prompt";
import type { QuestionGenerationInput } from "@/server/llm/provider";

function mc(options: string[], correctAnswer = options[0]) {
  return { questionType: "mc" as const, question: "以下哪一項最符合題意？", options, correctAnswer };
}

describe("isSevereLengthAsymmetry", () => {
  it("正確選項唯一最長而且明顯較長 → 嚴重", () => {
    const options = [
      "工業革命期間大量農村人口遷入城市居住及工作",
      "人口減少",
      "農業消失",
      "城市縮小",
    ];
    const metrics = analyseOptionQuality({
      questionType: "mc",
      options,
      correctAnswer: options[0],
    }).metrics;
    expect(metrics?.uniquelyLongest).toBe(true);
    expect(isSevereLengthAsymmetry(metrics)).toBe(true);
  });

  it("四個選項長度相若 → 不嚴重", () => {
    const options = ["人口大量增加", "人口大幅減少", "農業急劇萎縮", "城市迅速擴大"];
    const metrics = analyseOptionQuality({
      questionType: "mc",
      options,
      correctAnswer: options[0],
    }).metrics;
    expect(isSevereLengthAsymmetry(metrics)).toBe(false);
  });

  it("只比其他選項長少許（比例未達 1.5）→ 不嚴重", () => {
    const options = ["工業革命促進城市發展", "農業技術大幅改良", "海外貿易迅速擴張", "人口統計出現變化"];
    // 正確項 10 字，最長干擾項 9 字：差距 1 字、比例 1.11
    expect(optionTextLength(options[0])).toBe(10);
    const metrics = analyseOptionQuality({
      questionType: "mc",
      options,
      correctAnswer: options[0],
    }).metrics;
    expect(metrics?.uniquelyLongest).toBe(true);
    expect(isSevereLengthAsymmetry(metrics)).toBe(false);
  });

  it("比例懸殊但只多一兩個字（短選項）→ 不嚴重", () => {
    // 「城市」2 字 vs「人」1 字：比例 2，但差距只有 1 字，屬短標籤而非可利用線索
    const options = ["城市", "人", "農", "工"];
    const metrics = analyseOptionQuality({
      questionType: "mc",
      options,
      correctAnswer: options[0],
    }).metrics;
    expect(metrics?.uniquelyLongest).toBe(true);
    expect(isSevereLengthAsymmetry(metrics)).toBe(false);
  });

  it("沒有可用度量（找不到正確選項）時不判為嚴重", () => {
    expect(isSevereLengthAsymmetry(null)).toBe(false);
  });
});

describe("派題前的長度檢查", () => {
  it("正確選項明顯最長的選擇題不可派給學生，並說明原因", () => {
    const check = checkOptionLengthNeutral(
      mc(["工業革命期間大量農村人口遷入城市居住及工作", "人口減少", "農業消失", "城市縮小"]),
    );
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("明顯長於");
    expect(check.reason).toContain("最長");
  });

  it("長度相若的選擇題照常派發", () => {
    expect(
      checkOptionLengthNeutral(mc(["人口大量增加", "人口大幅減少", "農業急劇萎縮", "城市迅速擴大"]))
        .ok,
    ).toBe(true);
  });

  it("填充題不受影響（沒有選項）", () => {
    expect(
      checkOptionLengthNeutral({
        questionType: "fill",
        options: [],
        correctAnswer: "工業革命",
      }).ok,
    ).toBe(true);
  });

  it("checkQuestionDeliverable 同時套用結構檢查與長度檢查", () => {
    // 結構上不可作答（答案已印在題幹）
    const leaky = {
      questionType: "mc" as const,
      question: "工業革命期間大量農村人口遷入城市居住及工作，這現象稱為甚麼？",
      options: ["工業革命期間大量農村人口遷入城市居住及工作", "甲", "乙", "丙"],
      correctAnswer: "工業革命期間大量農村人口遷入城市居住及工作",
    };
    const structural = checkQuestionDeliverable(leaky);
    expect(structural.ok).toBe(false);
    expect(structural.reason).toContain("題幹");

    // 結構正常但長度洩露答案
    const asymmetric = checkQuestionDeliverable(
      mc(["工業革命期間大量農村人口遷入城市居住及工作", "人口減少", "農業消失", "城市縮小"]),
    );
    expect(asymmetric.ok).toBe(false);
    expect(asymmetric.reason).toContain("最長");

    expect(
      checkQuestionDeliverable(
        mc(["人口大量增加", "人口大幅減少", "農業急劇萎縮", "城市迅速擴大"]),
      ).ok,
    ).toBe(true);
  });
});

describe("出題提示詞要求選項長度對稱", () => {
  it("系統提示明確要求四個選項字數相若、句式一致", () => {
    const prompt = buildSystemPrompt("junior");
    expect(prompt).toContain("字數相若");
    expect(prompt).toContain("句式一致");
    expect(prompt).toContain("把正確答案寫得最詳細");
  });

  it("使用者提示在 JSON 格式提醒中重申同一要求", () => {
    const input = {
      topicTitle: "課題",
      sectionTitle: "分節",
      questionTypes: ["mc"],
      difficulty: "basic",
      count: 1,
      materialUnits: [{ blockId: "b1", sourceLocation: "位置", text: "教材內容" }],
    } as unknown as QuestionGenerationInput;
    expect(buildUserPrompt(input)).toContain("字數相若");
  });
});
