import { describe, expect, it } from "vitest";

import {
  OPTION_QUALITY_CODES,
  OPTION_QUALITY_RULE_VERSION,
  analyseOptionQuality,
  isOptionQualityWarning,
  mergeOptionQualityWarnings,
  optionQualityWarningTag,
  parseOptionQualityWarning,
  summariseOptionQualityWarnings,
} from "@/server/quality/option-quality";
import { checkQuestionQuality } from "@/server/llm/question-quality";
import { validateLlmQuestions } from "@/server/llm/validation";
import { HISTORY_SKILLS } from "@/lib/types";

/**
 * 表面線索警告的可追溯性（Sprint 24）。
 *
 * 目的：令寫入資料庫或練習快照的警告可以回答三個問題：
 *   1. 這是哪一項檢查產生的？（代碼）
 *   2. 由哪一版規則產生？（版本）
 *   3. 屬於哪一題？（警告存放在該題的 `qualityWarnings`，題目 ID 是鍵）
 *
 * 全部內容為合成樣本，不含史實或版權材料。
 */
const LONG_STATEMENT =
  "這是一段刻意寫得較長的說明文字，用來模擬 AI 生成題目中過度詳細的正確選項";

describe("警告格式與解析", () => {
  it("四種檢查的警告都帶有版本及代碼標記", () => {
    const samples: { options: string[]; correctAnswer: string }[] = [
      { options: [LONG_STATEMENT, "甲城", "乙城", "丙城"], correctAnswer: LONG_STATEMENT },
      { options: ["甲城", "一定如此", "乙城", "丙城"], correctAnswer: "甲城" },
      { options: ["甲城", "甲城。", "乙城", "丙城"], correctAnswer: "乙城" },
      {
        options: [LONG_STATEMENT, "這是較短的說明句。", "這也是較短的說明句。", "這同樣是較短的說明句。"],
        correctAnswer: LONG_STATEMENT,
      },
    ];

    const seen = new Set<string>();
    for (const sample of samples) {
      const result = analyseOptionQuality({ questionType: "mc", ...sample });
      expect(result.findings.length).toBeGreaterThan(0);
      for (const finding of result.findings) {
        expect(finding.message).toContain(optionQualityWarningTag(finding.code));
        const parsed = parseOptionQualityWarning(finding.message);
        expect(parsed).toEqual({ code: finding.code, version: OPTION_QUALITY_RULE_VERSION });
        seen.add(finding.code);
      }
    }
    expect([...seen].sort()).toEqual([...OPTION_QUALITY_CODES].sort());
  });

  it("解析容忍前後空白，並且不會誤認其他品質警告", () => {
    const tagged = `品質檢查提示：某項提示${optionQualityWarningTag("option-duplicate")}`;
    expect(parseOptionQualityWarning(`  ${tagged}  `)).toEqual({
      code: "option-duplicate",
      version: OPTION_QUALITY_RULE_VERSION,
    });
    expect(parseOptionQualityWarning("品質檢查提示：解釋太短，未能說明答案的依據")).toBeNull();
    expect(parseOptionQualityWarning("品質檢查提示：某項提示（規則 option-quality/v9 · not-a-code）")).toBeNull();
    expect(isOptionQualityWarning("")).toBe(false);
  });
});

describe("取代與匯總", () => {
  const ours = [
    `品質檢查提示：長度提示${optionQualityWarningTag("option-length-asymmetry")}`,
  ];
  const other = "品質檢查提示：解釋太短，未能說明答案的依據";

  it("只替換本模組產生的警告，其他品質警告保持原樣", () => {
    const merged = mergeOptionQualityWarnings([other, ...ours], ours);
    expect(merged).toEqual([other, ...ours]);
  });

  it("重複套用同一批結果不會累積重複警告（冪等）", () => {
    const once = mergeOptionQualityWarnings([other], ours);
    const twice = mergeOptionQualityWarnings(once, ours);
    expect(twice).toEqual(once);
  });

  it("新一版結果取代舊一版（不會同時留下兩個版本的同一代碼）", () => {
    const legacy = ["品質檢查提示：舊版提示（規則 option-quality/v0 · option-length-asymmetry）"];
    const merged = mergeOptionQualityWarnings([other, ...legacy], ours);
    expect(merged).toEqual([other, ...ours]);
    expect(merged.some((warning) => warning.includes("option-quality/v0"))).toBe(false);
  });

  it("匯總報告代碼、版本、有警告題數及分母", () => {
    const summary = summariseOptionQualityWarnings([
      ours,
      [other],
      [
        `品質檢查提示：句式提示${optionQualityWarningTag("option-form-mismatch")}`,
        `品質檢查提示：絕對化提示${optionQualityWarningTag("option-absolutist-distractor")}`,
      ],
    ]);
    expect(summary.questionsTotal).toBe(3);
    expect(summary.questionsFlagged).toBe(2);
    expect(summary.byCode["option-length-asymmetry"]).toBe(1);
    expect(summary.byCode["option-form-mismatch"]).toBe(1);
    expect(summary.byCode["option-absolutist-distractor"]).toBe(1);
    expect(summary.byCode["option-duplicate"]).toBe(0);
    expect(summary.byVersion[OPTION_QUALITY_RULE_VERSION]).toBe(3);
  });

  it("混用版本時可以分辨（避免把不同規則的結果相加而不自知）", () => {
    const summary = summariseOptionQualityWarnings([
      ours,
      ["品質檢查提示：舊版（規則 option-quality/v0 · option-length-asymmetry）"],
    ]);
    expect(summary.byVersion).toEqual({ [OPTION_QUALITY_RULE_VERSION]: 1, "option-quality/v0": 1 });
  });
});

describe("警告不會改動題目內容", () => {
  it("分析是純函式：輸入的選項與答案物件不被改動", () => {
    const input = {
      questionType: "mc" as const,
      options: [LONG_STATEMENT, "甲城", "乙城", "丙城"],
      correctAnswer: LONG_STATEMENT,
    };
    const snapshot = JSON.stringify(input);
    const result = analyseOptionQuality(input);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("品質閘門只加警告：題幹、選項、正確答案、判定都不變", () => {
    const candidate = {
      questionType: "mc" as const,
      question: "（合成樣本）下列哪一項最能說明這個情況？",
      options: [LONG_STATEMENT, "甲城", "乙城", "丙城"],
      correctAnswer: LONG_STATEMENT,
      explanation: "因為樣本刻意把正確選項寫得最長，用來驗證警告的內容與格式。",
      sourceExcerpt: LONG_STATEMENT,
      sourceBlockIds: ["block-1"],
      gradingPoints: [],
    };
    const before = JSON.stringify(candidate);
    const units = [
      {
        blockId: "block-1",
        sourceLocation: "合成測試段落",
        text: `${LONG_STATEMENT}。甲城、乙城及丙城均是佔位名稱。`,
      },
    ];

    const result = checkQuestionQuality(candidate, units);
    expect(result.issues.some((issue) => issue.code === "option-length-asymmetry")).toBe(true);
    expect(JSON.stringify(candidate)).toBe(before);
  });

  it("生成流程寫入警告後，題目內容與版本仍與輸入相同", () => {
    const unitText = `在合成測試樣本中，甲城位於河谷，乙城位於海旁。${LONG_STATEMENT}。`;
    const raw = {
      questions: [
        {
          questionType: "mc",
          difficulty: "basic",
          question: "在合成測試樣本中，哪一項最能說明河谷的情況？",
          options: [LONG_STATEMENT, "甲城", "乙城", "丙城"],
          correctAnswerIndex: 0,
          correctAnswer: LONG_STATEMENT,
          explanation: "因為樣本刻意把正確選項寫得更長，用來測試警告的內容與格式。",
          knowledgePoint: "合成測試",
          sourceExcerpt: LONG_STATEMENT,
          sourceBlockIds: ["block-1"],
          skill: HISTORY_SKILLS[0],
        },
      ],
    };
    const rawBefore = JSON.stringify(raw);

    const result = validateLlmQuestions(raw, {
      topicId: "topic-5",
      sectionId: "topic-5-renaissance",
      sectionIds: ["topic-5-renaissance"],
      questionTypes: ["mc"],
      difficulty: "basic",
      origin: "material-ai",
      units: [{ blockId: "block-1", sourceLocation: "合成測試段落", text: unitText }],
      now: "2026-10-23T00:00:00.000Z",
      idFor: () => "q-synthetic-traceability",
    });

    expect(result.discardedReasons, JSON.stringify(result.discardedReasons)).toEqual([]);
    const accepted = result.accepted[0];
    expect(accepted.question).toBe(raw.questions[0].question);
    expect(accepted.options).toEqual(raw.questions[0].options);
    expect(accepted.correctAnswer).toBe(raw.questions[0].correctAnswer);
    expect(accepted.revision).toBe(1);
    expect(accepted.teacherConfirmationRequired).toBe(false);
    // 輸入物件沒有被就地修改
    expect(JSON.stringify(raw)).toBe(rawBefore);

    const summary = summariseOptionQualityWarnings([accepted.qualityWarnings]);
    expect(summary.questionsFlagged).toBe(1);
    expect(summary.byVersion[OPTION_QUALITY_RULE_VERSION]).toBeGreaterThan(0);
  });
});
