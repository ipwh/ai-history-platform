/**
 * 完整題目品質閘門測試（Sprint 7.8）。
 *
 * 背景：學生自學不再等待教師逐題預先批准，因此「機器可以判斷的品質問題」必須在生成階段
 * 就擋住。這裡鎖定 Sprint 要求的個案，特別是學生回報過的
 * 「「歐洲的中古時代結束，進入近代」是指以下哪一個詞語？」——教材同時以年份
 * （公元1453年）及時期（文藝復興期間）說明中古時代的終結，學生無法判斷要答哪一種。
 *
 * 逐字斷言：
 *   1. 有多個可辯解答案（日期 vs 時期，而教材把兩者連繫到同一件事）→ 丟棄。
 *   2. 精確版本（教材只把年份連繫到該事件）→ 保留。
 *   3. 兩個選項只差修飾語（文藝復興／文藝復興時期）→ 丟棄。
 *   4. 挖空式選擇題有第二個選項見於引用教材 → 丟棄。
 *   5. 題幹問「說明」但選項是標題詞 → 丟棄。
 *   6. 標準答案未見於教材（選擇題／填充題）→ 丟棄；短答題只作提示。
 *   7. 解釋空白或只是重複題幹 → 丟棄。
 *   8. 非挖空題幹整句抄錄教材 → 丟棄。
 */
import { describe, expect, it } from "vitest";

import { checkQuestionQuality, type QualityCandidate } from "@/server/llm/question-quality";
import { validateLlmQuestions } from "@/server/llm/validation";
import type { MaterialUnit } from "@/server/llm/provider";

/** 教材：年份與時期都被連繫到「中古時代結束」（正是回報的實際情況） */
const MEDIEVAL_UNITS: MaterialUnit[] = [
  {
    blockId: "blk_1453",
    sourceLocation: "教材 · 中古時代的終結",
    text: "公元1453年：歐洲的中古時代結束，進入近代",
  },
  {
    blockId: "blk_renaissance_row",
    sourceLocation: "教材 · 比較表",
    text: "中古時代前期（以神為本） | 文藝復興期間（以人為本）",
  },
  {
    blockId: "blk_renaissance_def",
    sourceLocation: "教材 · 文藝復興",
    text: "文藝復興（十四至十七世紀）：中古時代後期發生的歐洲文化與思想革新運動，在意大利率先展開。",
  },
];

function candidate(overrides: Partial<QualityCandidate> = {}): QualityCandidate {
  return {
    questionType: "mc",
    question: "「歐洲的中古時代結束，進入近代」是指以下哪一個詞語？",
    options: ["公元1453年", "文藝復興期間", "英國", "羅馬"],
    correctAnswer: "公元1453年",
    explanation: "教材原文：公元1453年：歐洲的中古時代結束，進入近代。",
    sourceExcerpt: "公元1453年：歐洲的中古時代結束，進入近代",
    sourceBlockIds: ["blk_1453"],
    ...overrides,
  };
}

describe("題目品質閘門：答案是否唯一", () => {
  it("學生回報的 1453 題（日期與時期都被教材連繫到同一件事）會被丟棄", () => {
    const result = checkQuestionQuality(candidate(), MEDIEVAL_UNITS);

    expect(result.ok).toBe(false);
    const blocking = result.issues.filter((issue) => issue.severity === "blocking");
    expect(blocking.map((issue) => issue.code)).toContain("ambiguous-options");
    expect(blocking.map((issue) => issue.message).join(" ")).toContain("文藝復興期間");
  });

  it("精確版本（明確問年份，教材只以年份說明該事件）可以保留", () => {
    // 沒有效法「問詞語」的缺陷寫法：題幹明確問年份，選項全部是同類的年份
    const result = checkQuestionQuality(
      candidate({
        question: "歐洲的中古時代在哪一年結束？",
        options: ["公元1453年", "公元476年", "公元800年", "公元1492年"],
      }),
      [MEDIEVAL_UNITS[0]],
    );

    expect(result.issues.filter((issue) => issue.severity === "blocking")).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("兩個選項只差修飾語即屬同一答案，會被丟棄", () => {
    const result = checkQuestionQuality(
      candidate({
        question: "「中古時代後期發生的歐洲文化與思想革新運動」是指以下哪一個詞語？",
        options: ["文藝復興", "文藝復興時期", "宗教改革", "工業革命"],
        correctAnswer: "文藝復興",
        sourceExcerpt: "文藝復興（十四至十七世紀）：中古時代後期發生的歐洲文化與思想革新運動，在意大利率先展開。",
        sourceBlockIds: ["blk_renaissance_def"],
      }),
      MEDIEVAL_UNITS,
    );

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.message).join(" ")).toContain("只差修飾語");
  });

  it("挖空式選擇題中，另一個選項也見於引用教材時會被丟棄", () => {
    const result = checkQuestionQuality(
      candidate({
        question: "＿＿＿：歐洲的中古時代結束，進入近代",
        options: ["公元1453年", "進入近代", "中古時代", "十四至十七世紀"],
        correctAnswer: "公元1453年",
      }),
      MEDIEVAL_UNITS,
    );

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.message).join(" ")).toContain("也可以填");
  });

  it("題幹問「說明」但選項是標題詞時會被丟棄", () => {
    const result = checkQuestionQuality(
      candidate({
        question: "以下哪一項是「文藝復興期間」的說明？",
        options: [
          "學者發現教會翻譯的版本及其對自然的理解存在多處錯誤。",
          "文藝復興與宗教改革",
          "歐洲的新殖民擴張浪潮",
          "歐洲的中古時代結束，進入近代",
        ],
        correctAnswer: "學者發現教會翻譯的版本及其對自然的理解存在多處錯誤。",
      }),
      MEDIEVAL_UNITS,
    );

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.message).join(" ")).toContain("只是標題或名詞短語");
  });
});

describe("生成流程真的會套用品質閘門", () => {
  it("驗證器（生成流程的唯一入口）會丟棄 1453 題，並保留精確版本", () => {
    const ambiguous = candidate();
    const context = {
      topicId: "topic-5",
      sectionId: "topic-5-renaissance-impact",
      questionTypes: ["mc"] as ("mc" | "fill")[],
      difficulty: "basic" as const,
      origin: "material-ai" as const,
      units: MEDIEVAL_UNITS,
      now: "2026-01-01T00:00:00.000Z",
      idFor: (index: number) => `quality-${index}`,
    };

    const rejected = validateLlmQuestions(
      {
        questions: [
          {
            questionType: ambiguous.questionType,
            difficulty: "basic",
            question: ambiguous.question,
            options: ambiguous.options,
            correctAnswerIndex: 0,
            correctAnswer: ambiguous.correctAnswer,
            explanation: ambiguous.explanation,
            knowledgePoint: "中古時代的終結",
            sourceExcerpt: ambiguous.sourceExcerpt,
            sourceBlockIds: ambiguous.sourceBlockIds,
            gradingPoints: [],
          },
        ],
      },
      context,
    );
    expect(rejected.accepted).toHaveLength(0);
    expect(rejected.discardedReasons.join(" ")).toContain("品質檢查");

    // 精確版本（改寫成明確問年份）仍然可以通過，證明不是一律拒絕時序題
    const precise = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "mc",
            difficulty: "basic",
            question: "歐洲的中古時代在哪一年結束？",
            options: ["公元1453年", "公元476年", "公元800年", "公元1492年"],
            correctAnswerIndex: 0,
            correctAnswer: "公元1453年",
            explanation: ambiguous.explanation,
            knowledgePoint: "中古時代的終結",
            sourceExcerpt: ambiguous.sourceExcerpt,
            sourceBlockIds: ambiguous.sourceBlockIds,
            gradingPoints: [],
          },
        ],
      },
      { ...context, units: [MEDIEVAL_UNITS[0]] },
    );
    expect(precise.accepted).toHaveLength(1);
  });
});

describe("題目品質閘門：教材依據與解釋", () => {
  it("選擇題／填充題的標準答案未見於教材時 fail-closed", () => {
    const result = checkQuestionQuality(
      candidate({
        questionType: "fill",
        question: "＿＿＿年被視為中古時代終結的象徵。",
        options: [],
        correctAnswer: "1453",
        sourceExcerpt: "公元1453年：歐洲的中古時代結束，進入近代",
      }),
      [MEDIEVAL_UNITS[2]],
    );

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("answer-not-in-material");
  });

  it("沒有解釋或解釋只是重複題幹時會被丟棄", () => {
    const empty = checkQuestionQuality(candidate({ explanation: "   " }), MEDIEVAL_UNITS);
    expect(empty.ok).toBe(false);
    expect(empty.issues.map((issue) => issue.code)).toContain("explanation-unsupported");

    const repeated = checkQuestionQuality(
      candidate({ explanation: "「歐洲的中古時代結束，進入近代」是指以下哪一個詞語？" }),
      MEDIEVAL_UNITS,
    );
    expect(repeated.ok).toBe(false);
  });

  it("非挖空題幹整句抄錄教材時會被丟棄", () => {
    const result = checkQuestionQuality(
      candidate({
        questionType: "mc",
        question: "公元1453年歐洲的中古時代結束進入近代",
        options: ["中古時代結束", "文藝復興", "工業革命", "宗教改革"],
        correctAnswer: "中古時代結束",
        explanation: "教材原文：公元1453年：歐洲的中古時代結束，進入近代。",
        sourceExcerpt: "公元1453年：歐洲的中古時代結束，進入近代",
      }),
      MEDIEVAL_UNITS,
    );

    expect(result.issues.map((issue) => issue.code)).toContain("copied-source");
  });
});
