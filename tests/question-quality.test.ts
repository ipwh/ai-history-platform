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
      sectionId: "topic-5-renaissance-reformation",
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

describe("題目品質閘門：選項不可只是指代詞", () => {
  it("「這些進步」這類只有指代詞的選項會被丟棄（2026-10-20 實際缺陷）", () => {
    const result = checkQuestionQuality(
      candidate({
        questionType: "mc",
        question: "人類的哪些進步促成了古代文明的出現？",
        options: ["城市的建立", "農業的發明", "這些進步", "文字的出現"],
        correctAnswer: "城市的建立",
        explanation: "教材指出城市的建立、農業的發明與文字的出現促成了古代文明的出現。",
        sourceExcerpt: "這些進步促成了古代文明的出現",
      }),
      [
        {
          blockId: "blk_progress",
          sourceLocation: "教材 · 古與今",
          text: "這些進步促成了古代文明的出現。城市的建立、農業的發明與文字的出現改變了人類的生活。",
        },
      ],
    );

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("option-vague");
    expect(result.issues.map((issue) => issue.message).join(" ")).toContain("這些進步");
  });

  it("「以上皆是」「以上皆非」等考試慣用選項仍然可用", () => {
    const result = checkQuestionQuality(
      candidate({
        questionType: "mc",
        question: "下列哪一項是促成古代文明出現的進步？",
        options: ["城市的建立", "農業的發明", "文字的出現", "以上皆是"],
        correctAnswer: "以上皆是",
        explanation: "教材指出城市的建立、農業的發明與文字的出現都促成了古代文明的出現。",
        sourceExcerpt: "這些進步促成了古代文明的出現",
      }),
      [
        {
          blockId: "blk_progress",
          sourceLocation: "教材 · 古與今",
          text: "這些進步促成了古代文明的出現。城市的建立、農業的發明與文字的出現改變了人類的生活。",
        },
      ],
    );

    expect(result.issues.map((issue) => issue.code)).not.toContain("option-vague");
  });
});

describe("題目品質閘門：時序題不可把年份印在題幹", () => {
  const CHRONOLOGY_UNITS: MaterialUnit[] = [
    {
      blockId: "blk_hk_postwar",
      sourceLocation: "教材 · 戰後的政治及行政轉變",
      text:
        "1946年，港督楊慕琦提出政制改革方案。1966年及1967年，香港先後發生大規模暴動。" +
        "1984年，中英兩國簽署《中英聯合聲明》。",
    },
  ];

  it("題幹已列出各事件年份的時序題會被丟棄（2026-10-22 用家回報）", () => {
    const result = checkQuestionQuality(
      {
        questionType: "mc",
        question:
          "以下三項事件均與香港政治及行政轉變有關：1946年楊慕琦提出政制改革方案、" +
          "1966年及1967年的暴動、1984年簽署《中英聯合聲明》。試按時序排列這三項事件，並選出正確的次序。",
        options: [
          "楊慕琦提出政制改革方案 → 1966年及1967年的暴動 → 簽署《中英聯合聲明》",
          "楊慕琦提出政制改革方案 → 簽署《中英聯合聲明》 → 1966年及1967年的暴動",
          "1966年及1967年的暴動 → 楊慕琦提出政制改革方案 → 簽署《中英聯合聲明》",
          "簽署《中英聯合聲明》 → 楊慕琦提出政制改革方案 → 1966年及1967年的暴動",
        ],
        correctAnswer: "楊慕琦提出政制改革方案 → 1966年及1967年的暴動 → 簽署《中英聯合聲明》",
        explanation:
          "1946年楊慕琦提出方案，1966年及1967年發生暴動，1984年簽署《中英聯合聲明》，故按年份先後排列如上。",
        sourceExcerpt: "1946年，港督楊慕琦提出政制改革方案。1966年及1967年，香港先後發生大規模暴動。",
        sourceBlockIds: ["blk_hk_postwar"],
      },
      CHRONOLOGY_UNITS,
    );

    const blocking = result.issues.filter((issue) => issue.severity === "blocking");
    expect(blocking.map((issue) => issue.code)).toContain("chronology-given-away");
    expect(result.outcome).toBe("reject");
  });

  it("題幹沒有寫出年份的時序題仍然可以保留", () => {
    const units: MaterialUnit[] = [
      {
        blockId: "blk_crusade",
        sourceLocation: "教材 · 十字軍東征",
        text: "穆罕默德和平重返麥加後，阿拉伯帝國先後征服波斯帝國，其後十字軍東征。",
      },
    ];
    const result = checkQuestionQuality(
      {
        questionType: "mc",
        question:
          "以下三項事件：阿拉伯帝國征服波斯帝國、穆罕默德和平重返麥加、十字軍東征。若按時間先後排列，正確的次序是：",
        options: [
          "穆罕默德和平重返麥加 → 阿拉伯帝國征服波斯帝國 → 十字軍東征",
          "十字軍東征 → 阿拉伯帝國征服波斯帝國 → 穆罕默德和平重返麥加",
          "阿拉伯帝國征服波斯帝國 → 十字軍東征 → 穆罕默德和平重返麥加",
          "十字軍東征 → 穆罕默德和平重返麥加 → 阿拉伯帝國征服波斯帝國",
        ],
        correctAnswer: "穆罕默德和平重返麥加 → 阿拉伯帝國征服波斯帝國 → 十字軍東征",
        explanation:
          "教材先寫穆罕默德和平重返麥加，再寫阿拉伯帝國征服波斯帝國，十字軍東征在其後，故次序如上。",
        sourceExcerpt: "穆罕默德和平重返麥加後，阿拉伯帝國先後征服波斯帝國，其後十字軍東征。",
        sourceBlockIds: ["blk_crusade"],
      },
      units,
    );

    expect(result.issues.map((issue) => issue.code)).not.toContain("chronology-given-away");
  });

  it("考核公元／公元前先後的「排列年份」題目不受影響", () => {
    const result = checkQuestionQuality(
      {
        questionType: "mc",
        question: "按年代順序排列以下的年份。 i. 公元850年 ii. 公元前800年 iii. 公元前95年 iv. 公元15年",
        options: ["i，ii，iii，iv", "ii，iii，iv，i", "iii，ii，iv，i", "iv，iii，ii，i"],
        correctAnswer: "ii，iii，iv，i",
        explanation: "公元前95年最早，其次是公元前800年，然後是公元15年及公元850年。",
        sourceExcerpt: "公元前後的年份次序",
        sourceBlockIds: ["blk_years"],
      },
      [
        {
          blockId: "blk_years",
          sourceLocation: "教材 · 計算年代",
          text: "公元前後的年份次序：公元前95年、公元前800年、公元15年、公元850年。",
        },
      ],
    );

    expect(result.issues.map((issue) => issue.code)).not.toContain("chronology-given-away");
  });
});
