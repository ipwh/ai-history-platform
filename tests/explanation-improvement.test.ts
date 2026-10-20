/**
 * 解釋改進建議及技能建議規則（純函式）測試。
 *
 * 驗證的契約：
 *   1. 建議**不假裝有依據**：試卷題幹不會被當成課文原文；
 *   2. 佔位解釋仍要指出「缺了甚麼」（概念定義／因果），而不是一律「交教師決定」；
 *   3. 技能建議只會取自 `HISTORY_SKILLS`，並按信心排序；
 *   4. 填充題陳述句中的「反映」「先後」不會被當成技能線索（避免假陽性）。
 */
import { describe, expect, it } from "vitest";

import { HISTORY_SKILLS } from "@/lib/types";
import {
  looksLikeSourcePassage,
  suggestExplanationImprovement,
  suggestSkills,
  summariseStem,
  type SkillSuggestionInput,
} from "@/server/quality/explanation-improvement";

function improvement(
  explanationClass: Parameters<typeof suggestExplanationImprovement>[0]["explanationClass"],
  overrides: Partial<Parameters<typeof suggestExplanationImprovement>[0]> = {},
) {
  return suggestExplanationImprovement({
    explanationClass,
    questionType: "fill",
    question: "＿＿＿是文字出現前，沒有文字紀錄的時期。",
    explanation: "答案依校內試題檔的評卷參考。",
    correctAnswer: "史前時期",
    sourceExcerpt: "＿＿＿是文字出現前，沒有文字紀錄的時期。",
    knowledgePoint: "A. 石器時代的演進",
    ...overrides,
  });
}

describe("looksLikeSourcePassage", () => {
  it("不把與題幹相同的試卷原句當成課文原文", () => {
    const stem = "最早的人類在甚麼時候出現？";
    expect(looksLikeSourcePassage(stem, stem)).toBe(false);
  });

  it("不把含空格標記的填充句子當成課文原文", () => {
    const stem = "＿＿＿是文字出現前，沒有文字紀錄的時期。";
    const excerpt = "_______________是文字出現前，沒有文字紀錄的時期。";
    expect(looksLikeSourcePassage(excerpt, stem)).toBe(false);
  });

  it("不把「題幹＋選項清單」的版面重排當成課文原文", () => {
    const stem = "下列哪些屬於一手資料？ i. 日記 ii. 錄像 iii. 事件發生時的報章報道 iv. 學術論文";
    const excerpt = "下列哪些屬於一手資料？ 日記 錄像 事件發生時的報章報道 學術論文";
    const options = ["i. 日記", "ii. 錄像", "iii. 事件發生時的報章報道", "iv. 學術論文"];
    expect(looksLikeSourcePassage(excerpt, stem, options)).toBe(false);
  });

  it("不把含 v／vi 陳述的題幹重排當成課文原文", () => {
    const stem = "以下哪些國家是軸心國的成員？ i. 日本 ii. 中國 iii. 意大利 iv. 德國 v. 蘇聯";
    const excerpt = "以下哪些國家是軸心國的成員？ 日本 中國 意大利 德國 蘇聯";
    expect(looksLikeSourcePassage(excerpt, stem, ["i、ii及iii", "ii、iii及iv"])).toBe(false);
  });

  it("接受真正的課文段落（無空格、較長、與題幹不同）", () => {
    const stem = "文藝復興最早在哪個城市開始？";
    const excerpt =
      "文藝復興最早在意大利的佛羅倫斯開始，當地富裕的商業家族資助藝術家，令文學與藝術蓬勃發展。";
    expect(looksLikeSourcePassage(excerpt, stem)).toBe(true);
  });

  it("課文只提及一個選項詞語時仍視為可用原文", () => {
    const stem = "文藝復興最早在哪個地區開始？";
    const excerpt =
      "文藝復興最早在意大利的佛羅倫斯開始，當地富裕的商業家族資助藝術家，令文學與藝術蓬勃發展。";
    expect(looksLikeSourcePassage(excerpt, stem, ["意大利", "英國", "法國", "德國"])).toBe(true);
  });
});

describe("suggestExplanationImprovement", () => {
  it("佔位解釋（填充題）建議補概念定義，並保留因果作為次選", () => {
    const result = improvement("placeholder");
    expect(result.primary).toBe("add_concept_definition");
    expect(result.alsoConsider).toContain("add_causal_reasoning");
    expect(result.rationale).toContain("需教師按課本補寫");
  });

  it("佔位解釋會指出可查哪一節課本", () => {
    expect(improvement("placeholder").rationale).toContain("A. 石器時代的演進");
  });

  it("選擇題問原因時建議補因果", () => {
    const result = improvement("placeholder", {
      questionType: "mc",
      question: "冷戰爆發的主要原因是甚麼？",
      knowledgePoint: "校內試題",
    });
    expect(result.primary).toBe("add_causal_reasoning");
    expect(result.rationale).not.toContain("可先查課本");
  });

  it("有課文原文可據時，建議按原文改寫而不是交教師裁決", () => {
    const result = improvement("placeholder", {
      questionType: "mc",
      question: "文藝復興最早在哪個城市開始？",
      sourceExcerpt:
        "文藝復興最早在意大利的佛羅倫斯開始，當地富裕的商業家族資助藝術家，令文學與藝術蓬勃發展。",
    });
    expect(result.primary).toBe("rewrite_from_source_wording");
  });

  it("只列答案的解釋建議補因果（填充題另加概念定義）", () => {
    const result = improvement("answer_only", {
      explanation: "填充題答案（依空格次序）：(1) 史前時期、(2) 信史時期",
    });
    expect(result.primary).toBe("add_causal_reasoning");
    expect(result.alsoConsider).toContain("add_concept_definition");
  });

  it("解釋與答案矛盾時要求教師裁決，不建議自動改寫", () => {
    const result = improvement("potentially_inconsistent");
    expect(result.primary).toBe("teacher_adjudication");
    expect(result.alsoConsider).toHaveLength(0);
  });

  it("沒有明顯模板時不強行分類", () => {
    expect(improvement("not_assessed").primary).toBe("teacher_adjudication");
  });
});

describe("suggestSkills", () => {
  function suggest(overrides: Partial<SkillSuggestionInput> = {}) {
    return suggestSkills({
      questionType: "fill",
      question: "＿＿＿是文字出現前，沒有文字紀錄的時期。",
      explanation: "答案依校內試題檔的評卷參考。",
      correctAnswer: "史前時期",
      knowledgePoint: "A. 石器時代的演進",
      ...overrides,
    });
  }

  it("填充題短答案建議「正確地使用歷史辭彙」（中等信心）", () => {
    const [first] = suggest();
    expect(first.skill).toBe("正確地使用歷史辭彙");
    expect(first.confidence).toBe("medium");
  });

  it("所有建議都取自官方 HISTORY_SKILLS 清單", () => {
    const allowed = new Set<string>(HISTORY_SKILLS);
    for (const suggestion of suggest({ questionType: "mc", question: "下列哪項是對的？" })) {
      expect(allowed.has(suggestion.skill)).toBe(true);
    }
  });

  it("關鍵詞明確時給予較高信心", () => {
    const suggestions = suggest({
      questionType: "mc",
      question: "下列事件的正確先後次序是甚麼？",
      correctAnswer: "乙甲丙",
    });
    expect(suggestions[0].skill).toBe("準確排列歷史事件的次序");
    expect(suggestions[0].confidence).toBe("high");
  });

  it("填充題陳述句中的「反映」不會被當成推論技能（避免假陽性）", () => {
    const suggestions = suggest({
      question: "1902年，日本與______________結成同盟，反映日本已被西方列強視為世界強國。",
    });
    expect(suggestions.some((item) => item.skill === "從歷史資料中作出歸納和推論")).toBe(false);
  });

  it("沒有任何線索時給低信心推測，而不是空白", () => {
    const suggestions = suggest({
      questionType: "mc",
      question: "最早的人類在甚麼時候出現？",
      correctAnswer: "約七百萬年前",
    });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].confidence).toBe("low");
    expect(suggestions[0].reason).toContain("需教師確認");
  });

  it("建議按信心排序（高→中→低）", () => {
    const suggestions = suggest({
      questionType: "mc",
      question: "下列關於可信性的說法中，正確的先後次序是甚麼？",
      correctAnswer: "甲乙",
    });
    const order = { high: 0, medium: 1, low: 2 } as const;
    const ranks = suggestions.map((item) => order[item.confidence]);
    expect([...ranks].sort((left, right) => left - right)).toEqual(ranks);
  });
});

describe("summariseStem", () => {
  it("超過長度時截短並加上省略號", () => {
    const summary = summariseStem("歷".repeat(100), 10);
    expect(summary).toHaveLength(11);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("短題幹原樣保留（連續空白壓成一個）", () => {
    expect(summariseStem("最早的        人類")).toBe("最早的 人類");
  });
});
