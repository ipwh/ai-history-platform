import { describe, expect, it } from "vitest";

import { validateLlmQuestions } from "@/server/llm/validation";
import { HISTORY_SKILLS } from "@/lib/types";

/**
 * 生成流程的整合測試（Sprint 23）。
 *
 * 目的：證明表面線索警告真的會經過**生成流程的驗證閘門**寫入題目的
 * `qualityWarnings`，而不只是 `checkQuestionQuality` 的單元測試。
 *
 * 這裡直接呼叫 `validateLlmQuestions`（`generateQuestions` 對每一輪 provider 回應
 * 都會呼叫它，包括重寫、重試及 mock／fallback 路徑），因此同一段程式碼就是三條
 * 路徑共用的閘門。內容全部是合成的佔位文字，不含任何史實或版權內容。
 */
const LONG_STATEMENT =
  "這是一段刻意寫得較長的說明文字，用來模擬 AI 生成題目中過度詳細的正確選項";

const UNIT_TEXT = `在合成測試樣本中，甲城位於河谷，乙城位於海旁，丙城位於山區。${LONG_STATEMENT}。`;

const UNITS = [
  {
    blockId: "block-1",
    sectionId: "topic-5-renaissance",
    sourceLocation: "合成測試段落",
    text: UNIT_TEXT,
  },
  {
    blockId: "block-2",
    sectionId: "topic-5-reformation",
    sourceLocation: "合成測試段落 2",
    text: "另一個合成段落，用於提供同類的錯誤選項來源：丁城、戊城、己城。",
  },
];

const CONTEXT = {
  topicId: "topic-5",
  sectionId: "topic-5-renaissance",
  sectionIds: ["topic-5-renaissance"],
  questionTypes: ["mc"] as const,
  difficulty: "basic" as const,
  origin: "material-ai" as const,
  units: UNITS,
  now: "2026-10-23T00:00:00.000Z",
  idFor: () => "q-synthetic-option-warning",
};

describe("生成流程會寫入表面線索警告", () => {
  it("過長的正確選項在驗證階段被標示，而且不會被丟棄", () => {
    const raw = {
      questions: [
        {
          questionType: "mc",
          difficulty: "basic",
          question: "在合成測試樣本中，哪一項最能說明河谷的情況？",
          options: [LONG_STATEMENT, "甲城", "乙城", "丙城"],
          correctAnswerIndex: 0,
          correctAnswer: LONG_STATEMENT,
          explanation: "因為樣本刻意把正確選項寫得更長，用來測試品質警告會否出現在生成流程。",
          knowledgePoint: "合成測試",
          sourceExcerpt: LONG_STATEMENT,
          sourceBlockIds: ["block-1"],
          skill: HISTORY_SKILLS[0],
        },
      ],
    };

    const result = validateLlmQuestions(raw, { ...CONTEXT, questionTypes: ["mc"] });

    expect(result.discardedReasons, JSON.stringify(result.discardedReasons)).toEqual([]);
    expect(result.accepted).toHaveLength(1);
    const warnings = result.accepted[0].qualityWarnings.join("\n");
    expect(warnings).toContain("正確選項");
    expect(warnings).toContain("最長");
    // 只是警告：題目仍然保留，自動發布政策不變（未有未確定項目）
    expect(result.accepted[0].teacherConfirmationRequired).toBe(false);
  });

  it("平衡的選項不會被標示（避免把所有 AI 題目都當成有問題）", () => {
    const raw = {
      questions: [
        {
          questionType: "mc",
          difficulty: "basic",
          question: "在合成測試樣本中，哪一項是河谷所在的城市？",
          options: ["甲城", "乙城", "丙城", "丁城"],
          correctAnswerIndex: 0,
          correctAnswer: "甲城",
          explanation: "合成樣本把甲城寫成位於河谷的城市，因此答案是甲城。",
          knowledgePoint: "合成測試",
          sourceExcerpt: "甲城位於河谷，乙城位於海旁，丙城位於山區",
          sourceBlockIds: ["block-1"],
          skill: HISTORY_SKILLS[0],
        },
      ],
    };

    const result = validateLlmQuestions(raw, { ...CONTEXT, questionTypes: ["mc"] });
    expect(result.discardedReasons, JSON.stringify(result.discardedReasons)).toEqual([]);
    expect(result.accepted).toHaveLength(1);
    const warnings = result.accepted[0].qualityWarnings.join("\n");
    expect(warnings).not.toContain("明顯長於");
  });
});
