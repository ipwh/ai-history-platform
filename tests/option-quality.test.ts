import { describe, expect, it } from "vitest";

import {
  ABSOLUTE_TERMS,
  LENGTH_ASYMMETRY_MIN_DELTA,
  LENGTH_ASYMMETRY_RATIO,
  analyseOptionQuality,
  looksLikeStatement,
  optionTextLength,
} from "@/server/quality/option-quality";
import {
  checkQuestionQuality,
  hasUncertainIssue,
  isExplanatoryDefinition,
  isMachineRevisable,
  qualityOutcome,
} from "@/server/llm/question-quality";
import { OPTION_BIAS_SAMPLES } from "./fixtures/option-bias-samples";

const LONG_STATEMENT =
  "這是一段刻意寫得較長的說明文字，用來模擬 AI 生成題目中過度詳細的正確選項";

describe("長度度量（全站唯一）", () => {
  it("中文一字算 1，空白不計", () => {
    expect(optionTextLength("甲城")).toBe(2);
    expect(optionTextLength("甲 城")).toBe(2);
    expect(optionTextLength("甲　城")).toBe(2); // 全形空格
    expect(optionTextLength(" 甲城 ")).toBe(2);
    expect(optionTextLength("甲\n城\t乙")).toBe(3);
  });

  it("全形標點各計 1 字", () => {
    expect(optionTextLength("甲城。")).toBe(3);
    expect(optionTextLength("甲城，乙城；丙城。")).toBe(9);
  });

  it("英文、數字按字元計（不是按詞或 token 計）", () => {
    expect(optionTextLength("Treaty of Paris")).toBe(13);
    expect(optionTextLength("1919年")).toBe(5);
  });

  it("空值不會拋錯", () => {
    expect(optionTextLength("")).toBe(0);
    expect(optionTextLength(null)).toBe(0);
    expect(optionTextLength(undefined)).toBe(0);
  });
});

describe("句式判定與既有閘門一致", () => {
  it("與 question-quality 的 isExplanatoryDefinition 結果相同", () => {
    const samples = [
      "甲城。",
      "這是較短的說明句。",
      "甲城，乙城",
      "甲城",
      "一九一九年，甲乙兩城簽訂條約，結束戰爭。",
      "甲乙兩城",
      "長度超過十個字但沒有任何標點的句子內容",
      "甲、乙",
    ];
    for (const sample of samples) {
      expect(looksLikeStatement(sample), sample).toBe(isExplanatoryDefinition(sample));
    }
  });
});

describe("選擇題表面線索的判定", () => {
  it("每個合成樣本都只發出預期的問題代碼", () => {
    for (const sample of OPTION_BIAS_SAMPLES) {
      const result = analyseOptionQuality({
        questionType: "mc",
        options: sample.options,
        correctAnswer: sample.correctAnswer,
      });
      expect(result.applicable, sample.id).toBe(true);
      expect(
        result.findings.map((finding) => finding.code),
        sample.id,
      ).toEqual(sample.expectedCodes);
    }
  });

  it("長度不對稱：正確項 ≥1.5 倍最長干擾項且多出至少 4 字才發出警告", () => {
    const justBelow = analyseOptionQuality({
      questionType: "mc",
      options: ["甲甲乙乙丙丙丁丁戊戊己己", "甲甲乙乙丙丙丁丁", "甲甲乙乙", "甲甲乙丙"],
      correctAnswer: "甲甲乙乙丙丙丁丁戊戊己己",
    });
    // 12 字 vs 8 字：比例 1.5，多出 4 字（剛好符合下限）
    expect(optionTextLength("甲甲乙乙丙丙丁丁戊戊己己")).toBe(12);
    expect(justBelow.metrics?.ratioToLongestDistractor).toBe(LENGTH_ASYMMETRY_RATIO);
    expect(12 - (justBelow.metrics?.longestDistractorLength ?? 0)).toBe(
      LENGTH_ASYMMETRY_MIN_DELTA,
    );
    expect(justBelow.findings.map((finding) => finding.code)).toContain("option-length-asymmetry");

    const belowDelta = analyseOptionQuality({
      questionType: "mc",
      options: ["甲甲乙乙丙丙丁", "甲甲乙乙丙丙", "甲甲乙乙", "甲甲乙丙"],
      correctAnswer: "甲甲乙乙丙丙丁",
    });
    // 7 字 vs 6 字：只多 1 字，未達 LENGTH_ASYMMETRY_MIN_DELTA
    expect(optionTextLength("甲甲乙乙丙丙丁") - optionTextLength("甲甲乙乙丙丙")).toBe(1);
    expect(belowDelta.findings.map((finding) => finding.code)).not.toContain(
      "option-length-asymmetry",
    );
  });

  it("短的選項不會因為比例放大而被誤報", () => {
    const result = analyseOptionQuality({
      questionType: "mc",
      options: ["甲城", "乙城丙", "丁", "戊"],
      correctAnswer: "乙城丙",
    });
    // 3 字 vs 2 字：比例 1.5，但只多 1 字
    expect(result.findings.map((finding) => finding.code)).not.toContain(
      "option-length-asymmetry",
    );
  });

  it("正確項不是最長時不發出長度警告（即使它很長）", () => {
    const result = analyseOptionQuality({
      questionType: "mc",
      options: ["甲城", LONG_STATEMENT, `${LONG_STATEMENT}，而且更長。`, "丁城"],
      correctAnswer: LONG_STATEMENT,
    });
    expect(result.metrics?.uniquelyLongest).toBe(false);
    expect(result.findings.map((finding) => finding.code)).not.toContain(
      "option-length-asymmetry",
    );
  });

  it("乾擾項使用絕對化用語而正確答案沒有時發出警告", () => {
    for (const term of ABSOLUTE_TERMS) {
      const result = analyseOptionQuality({
        questionType: "mc",
        options: [`甲${term}如此`, "乙城", "丙城", "視情況而定"],
        correctAnswer: "視情況而定",
      });
      expect(result.findings.map((finding) => finding.code), term).toContain(
        "option-absolutist-distractor",
      );
    }
  });

  it("正確答案本身含絕對化用語時不發出該警告（避免把正確答案當成干擾項）", () => {
    const result = analyseOptionQuality({
      questionType: "mc",
      options: ["一定如此", "必然如此", "所有情況皆如此", "一定視情況而定"],
      correctAnswer: "一定視情況而定",
    });
    expect(result.findings.map((finding) => finding.code)).not.toContain(
      "option-absolutist-distractor",
    );
  });

  it("正規化後重複的選項會單獨發出警告", () => {
    const result = analyseOptionQuality({
      questionType: "mc",
      options: ["甲城", "甲城 ", "乙城", "丙城"],
      correctAnswer: "乙城",
    });
    expect(result.findings.map((finding) => finding.code)).toEqual(["option-duplicate"]);
  });

  it("填充題或無法定位正確答案時不適用（不誤報）", () => {
    expect(
      analyseOptionQuality({
        questionType: "fill",
        options: ["甲", "乙"],
        correctAnswer: "甲",
      }).applicable,
    ).toBe(false);
    expect(
      analyseOptionQuality({
        questionType: "mc",
        options: ["甲城", "乙城"],
        correctAnswer: "丙城",
      }).applicable,
    ).toBe(false);
    expect(
      analyseOptionQuality({
        questionType: "mc",
        options: ["甲城"],
        correctAnswer: "甲城",
      }).applicable,
    ).toBe(false);
  });

  it("不會改動輸入（可安全地在寫入前後各呼叫一次比對）", () => {
    const options = ["甲城", LONG_STATEMENT, "乙城", "丙城"];
    const snapshot = JSON.stringify(options);
    const result = analyseOptionQuality({
      questionType: "mc",
      options,
      correctAnswer: LONG_STATEMENT,
    });
    expect(result.findings.length).toBeGreaterThan(0);
    expect(JSON.stringify(options)).toBe(snapshot);
  });

  it("判定與正確答案的位置無關（旋轉選項次序結果不變）", () => {
    for (const sample of OPTION_BIAS_SAMPLES) {
      const expected = analyseOptionQuality({
        questionType: "mc",
        options: sample.options,
        correctAnswer: sample.correctAnswer,
      }).findings.map((finding) => finding.code);
      for (let rotation = 1; rotation < sample.options.length; rotation += 1) {
        const rotated = [
          ...sample.options.slice(rotation),
          ...sample.options.slice(0, rotation),
        ];
        const actual = analyseOptionQuality({
          questionType: "mc",
          options: rotated,
          correctAnswer: sample.correctAnswer,
        }).findings.map((finding) => finding.code);
        expect(actual, `${sample.id} rotation=${rotation}`).toEqual(expected);
      }
    }
  });
});

describe("與既有品質閘門的整合（發布政策不變）", () => {
  const units = [
    {
      blockId: "block-1",
      sourceLocation: "測試段落",
      text: `${LONG_STATEMENT}。甲城、乙城及丙城均是測試用的佔位名稱。`,
    },
  ];

  const candidate = {
    questionType: "mc" as const,
    question: "（合成樣本）下列哪一項最能說明這個情況？",
    options: [LONG_STATEMENT, "甲城", "乙城", "丙城"],
    correctAnswer: LONG_STATEMENT,
    explanation: "因為測試樣本刻意把正確選項寫得最長，用來驗證警告是否發出。",
    sourceExcerpt: LONG_STATEMENT,
    sourceBlockIds: ["block-1"],
    gradingPoints: [],
  };

  it("表面線索只產生 warning，不改變判定、不觸發重寫、不暫緩發布", () => {
    const result = checkQuestionQuality(candidate, units);
    const optionCodes = new Set([
      "option-length-asymmetry",
      "option-form-mismatch",
      "option-absolutist-distractor",
      "option-duplicate",
    ]);
    const optionIssues = result.issues.filter((issue) => optionCodes.has(issue.code));
    const otherIssues = result.issues.filter((issue) => !optionCodes.has(issue.code));

    expect(optionIssues.map((issue) => issue.code)).toEqual([
      "option-length-asymmetry",
      "option-form-mismatch",
    ]);
    expect(optionIssues.every((issue) => issue.severity === "warning")).toBe(true);

    // 發布政策不變：加入這些警告後，判定、是否需教師確認、是否觸發重寫，全部與
    // 「沒有這些警告時」相同——即新增檢查不會暫緩自動發布，也不會改動題目內容。
    expect(result.outcome).toBe(qualityOutcome(otherIssues));
    expect(hasUncertainIssue(result.issues)).toBe(hasUncertainIssue(otherIssues));
    expect(isMachineRevisable(result.issues)).toBe(isMachineRevisable(otherIssues));
  });

  it("既有阻擋條件不受影響（無解釋仍然 reject，警告不會把 blocking 降級）", () => {
    const result = checkQuestionQuality({ ...candidate, explanation: "" }, units);
    expect(result.outcome).toBe("reject");
    expect(result.issues.some((issue) => issue.severity === "blocking")).toBe(true);
    // 新增的表面線索警告仍然只是 warning
    expect(
      result.issues
        .filter((issue) => issue.code.startsWith("option-"))
        .every((issue) => issue.severity === "warning"),
    ).toBe(true);
  });
});
