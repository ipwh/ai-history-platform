/**
 * 填充題品質契約的迴歸測試（Sprint 7.4）。
 *
 * 覆蓋四類要求：
 *   1. 歷史意義：答案必須**正面確認**為歷史元素，未能確認者一律丟棄（fail-closed）。
 *   2. 長度：題幹正規化後以 100 字為硬上限，目標 20–70 字。
 *   3. 空格與答案外洩：剛好一個空格，且答案不可在題幹其他位置再次出現。
 *   4. 整合：本地示範生成（mock-provider）只會產生權威驗證器接受的題目。
 *
 * 這些規則只適用於填充題；選擇題及短答題的行為不變（另見 llm-validation.test.ts）。
 */
import { describe, expect, it } from "vitest";

import {
  FILL_STEM_HARD_MAX,
  FILL_STEM_TARGET_MAX,
  buildBlankedStem,
  checkFillStem,
  countBlankMarkers,
} from "@/server/llm/fill-question";
import { checkHistoricalAnswer } from "@/server/llm/historical-answer";
import { generateQuestionsFromMaterial } from "@/server/llm/mock-provider";
import type { MaterialUnit } from "@/server/llm/provider";
import { validateLlmQuestions } from "@/server/llm/validation";

const MATERIAL = [
  "1453年，鄂圖曼帝國攻陷君士坦丁堡，東羅馬帝國滅亡。",
  "1517年，德意志神學家馬丁路德發表《九十五條論證》，批評教會濫用贖罪券。",
  "中古時代的歐洲實行封建制度，土地由領主授予封臣。",
  "工業革命期間，蒸汽機的發明改變了生產方式，工廠制度隨之普及。",
  "當時以石刻技術印刷文件。",
].join("\n");

const UNITS: MaterialUnit[] = MATERIAL.split("\n").map((text, index) => ({
  blockId: `blk_${index + 1}`,
  sourceLocation: `教材 · 第 ${index + 1} 段`,
  text,
}));

function context(overrides: { questionTypes?: ("mc" | "fill" | "short")[] } = {}) {
  return {
    topicId: "topic-5",
    sectionId: "topic-5-reformation",
    questionTypes: overrides.questionTypes ?? (["fill"] as ("mc" | "fill" | "short")[]),
    difficulty: "basic" as const,
    origin: "material-ai" as const,
    units: UNITS,
    now: "2026-01-01T00:00:00.000Z",
    idFor: (index: number) => `q-${index}`,
  };
}

function fillQuestion(options: { question: string; correctAnswer: string; sourceExcerpt?: string }) {
  return {
    questionType: "fill" as const,
    difficulty: "basic" as const,
    question: options.question,
    options: [],
    correctAnswerIndex: null,
    correctAnswer: options.correctAnswer,
    explanation: `教材原文：${options.sourceExcerpt ?? MATERIAL.split("\n")[1]}`,
    knowledgePoint: "宗教改革的展開",
    sourceExcerpt: options.sourceExcerpt ?? MATERIAL.split("\n")[1],
    sourceBlockIds: ["blk_2"],
    gradingPoints: [],
  };
}

describe("填充題的歷史意義（fail-closed）", () => {
  it("拒絕普通形容詞、通用名詞及教材欄位名稱", () => {
    for (const answer of [
      "重要",
      "背景",
      "生活方式",
      "展開時間",
      "為生方法",
      "定居與建房",
      "技術改良與文化發展",
    ]) {
      const result = checkHistoricalAnswer(answer, MATERIAL);
      expect(result.ok, answer).toBe(false);
      expect(result.support, answer).toBe("disallowed");
    }
  });

  it("拒絕教材大綱標題式的答案", () => {
    const result = checkHistoricalAnswer("技術改良與文化發展", "技術改良與文化發展：見課文");
    expect(result.ok).toBe(false);
    expect(result.definite).toBe(true);
  });

  it("未能正面確認屬歷史元素時一律拒絕（不確定亦不可保留）", () => {
    const result = checkHistoricalAnswer("石刻", MATERIAL);
    expect(result.ok).toBe(false);
    expect(result.support).toBe("uncertain");
  });

  it("教材以引號標示並不足夠：仍需正面證據", () => {
    // 「石刻」在教材中出現（甚至可能被引號標示），但教材沒有交代它的歷史意義
    expect(checkHistoricalAnswer("石刻", "教材以「石刻」技術印刷文件。").ok).toBe(false);
  });

  it("接受人物、年份、制度及文件名稱", () => {
    for (const answer of ["馬丁路德", "1517年", "封建制度", "《九十五條論證》"]) {
      const result = checkHistoricalAnswer(answer, MATERIAL);
      expect(result.ok, answer).toBe(true);
      expect(result.support, answer).toBe("supported");
    }
  });

  it("接受教材明確交代其歷史意義的技術與發明", () => {
    expect(checkHistoricalAnswer("蒸汽機", MATERIAL).ok).toBe(true);
  });

  it("教材只提及名稱、沒有交代歷史意義時，技術仍不可接受", () => {
    expect(checkHistoricalAnswer("蒸汽機", "倉庫內放置了一台蒸汽機。").ok).toBe(false);
  });

  it("只有教材節錄並不足夠：低價值答案仍然丟棄", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          fillQuestion({
            question: "中古時代歐洲的＿＿＿制度下，土地由領主授予封臣。",
            correctAnswer: "為生方法",
          }),
        ],
      },
      context(),
    );
    expect(result.accepted).toHaveLength(0);
    expect(result.discardedReasons.join(" ")).toContain("歷史元素");
  });
});

describe("填充題的題幹長度", () => {
  it("簡潔而完整的題幹可以通過", () => {
    const check = checkFillStem("＿＿＿年，馬丁路德發表《九十五條論證》。", "1517年");
    expect(check.ok).toBe(true);
  });

  it(`超過硬上限（${FILL_STEM_HARD_MAX} 字）的題幹一律丟棄，且不會自動截斷`, () => {
    const longStem = `${"中古時代歐洲的封建制度".repeat(9)}＿＿＿。`;
    const check = checkFillStem(longStem, "封建制度");
    expect(check.ok).toBe(false);
    expect(check.reason).toContain(String(FILL_STEM_HARD_MAX));
  });

  it("量度長度前會先正規化空白及換行", () => {
    const messy = `  1517年，\n\n德意志神學家\t馬丁路德發表\n《九十五條論證》。  `;
    const check = checkFillStem(`＿＿＿，德意志神學家馬丁路德發表《九十五條論證》。`, "1517年");
    expect(check.ok).toBe(true);
    // 同一內容加入大量空白後，長度不應因為空白而超標
    const padded = messy.replace("1517年", "＿＿＿");
    expect(checkFillStem(padded, "1517年").ok).toBe(true);
  });

  it("把教材整句抄成題幹（超過上限）會被丟棄", () => {
    // 重複抄錄教材句子令題幹超過硬上限；答案本身不在題幹內，因此只會觸發長度規則
    const longStem = `${"當時以石刻技術印刷文件。".repeat(8)}這種技術出現於＿＿＿。`;
    const result = validateLlmQuestions(
      { questions: [fillQuestion({ question: longStem, correctAnswer: "1517年" })] },
      context(),
    );
    expect(result.accepted).toHaveLength(0);
    expect(result.discardedReasons.join(" ")).toContain("上限");
  });

  it("本地示範生成不會把教材整句直接當成題幹", () => {
    const longUnit: MaterialUnit = {
      blockId: "blk_long",
      sourceLocation: "教材 · 第 9 段",
      text:
        "十八世紀的英國，瓦特改良蒸汽機之後，蒸汽成為穩定可靠的新能源，" +
        "並廣泛應用於紡織、採礦及交通運輸等行業，令工廠可以設立在遠離河流的地方，" +
        "生產規模因而大幅擴大。",
    };
    const questions = generateQuestionsFromMaterial({
      topicTitle: "課題5：近代歐洲的興起",
      sectionTitle: "工業革命",
      difficulty: "basic",
      questionTypes: ["fill"],
      count: 5,
      materialUnits: [longUnit],
    });
    for (const question of questions) {
      expect(question.question.replace(/\s/g, "").length).toBeLessThanOrEqual(FILL_STEM_HARD_MAX);
    }
  });
});

describe("填充題的空格完整性與答案外洩", () => {
  it("沒有空格或有多個空格的題目一律丟棄", () => {
    expect(checkFillStem("1517年，馬丁路德發表《九十五條論證》。", "1517年").ok).toBe(false);
    for (const stem of ["＿＿＿年，馬丁路德發表《＿＿＿》。", "＿＿＿年＿＿＿"]) {
      const check = checkFillStem(stem, "1517年");
      expect(check.ok, stem).toBe(false);
      expect(check.reason, stem).toContain("空格標記");
    }
  });

  it("空格標記的數量計算會把連續底線視為一個空格", () => {
    expect(countBlankMarkers("＿＿＿年，馬丁路德發表《九十五條論證》。")).toBe(1);
    expect(countBlankMarkers("________年，馬丁路德發表《九十五條論證》。")).toBe(1);
    expect(countBlankMarkers("＿＿＿＿＿＿")).toBe(1);
  });

  it("標準答案仍在題幹其他位置出現時丟棄", () => {
    const check = checkFillStem("《九十五條論證》的作者馬丁路德於＿＿＿年發表此文。", "馬丁路德");
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("仍然出現在題幹其他位置");
  });

  it("標點及空白差異不可繞過外洩檢查", () => {
    const check = checkFillStem("馬丁路德 於 ＿＿＿ 年發表《九十五條論證》。", "馬丁路德");
    expect(check.ok).toBe(false);
    const year = checkFillStem("1517 年，馬丁路德發表《九十五條論證》，即＿＿＿年。", "1517年");
    expect(year.ok).toBe(false);
  });

  it("多字繁體答案及年份都能正確判斷", () => {
    expect(checkFillStem("＿＿＿期間，蒸汽機的發明改變了生產方式。", "工業革命").ok).toBe(true);
    expect(checkFillStem("工業革命期間，＿＿＿的發明改變了生產方式。", "蒸汽機").ok).toBe(true);
    expect(checkFillStem("＿＿＿年，馬丁路德發表《九十五條論證》。", "1517年").ok).toBe(true);
  });

  it("答案在同一句出現兩次時，不可產生只有一個空格的題目", () => {
    const unit = "蒸汽機的發明改變了生產方式，蒸汽機其後廣泛應用。";
    expect(buildBlankedStem(unit, "蒸汽機")).toBeNull();
  });

  it("答案在同一句只出現一次時，會建立單一空格的題幹", () => {
    const blanked = buildBlankedStem(MATERIAL.split("\n")[3], "蒸汽機");
    expect(blanked).not.toBeNull();
    expect(countBlankMarkers(blanked?.stem ?? "")).toBe(1);
    expect((blanked?.stem ?? "").includes("蒸汽機")).toBe(false);
  });

  it("本地示範生成不會讓答案留在題幹內", () => {
    const units: MaterialUnit[] = [
      {
        blockId: "blk_dup",
        sourceLocation: "教材 · 第 1 段",
        text: "蒸汽機的發明改變了生產方式，蒸汽機其後廣泛應用。",
      },
    ];
    const questions = generateQuestionsFromMaterial({
      topicTitle: "課題5：近代歐洲的興起",
      sectionTitle: "工業革命",
      difficulty: "basic",
      questionTypes: ["fill", "mc"],
      count: 5,
      materialUnits: units,
    });
    for (const question of questions) {
      const answer = question.correctAnswer.trim();
      if (answer.length < 2) continue;
      const visible = question.question.replace(/[＿_]{2,}/g, " ");
      expect(visible, question.question).not.toContain(answer);
    }
  });
});

describe("本地示範生成與權威驗證器一致", () => {
  function validateMockQuestions(units: MaterialUnit[]) {
    const questions = generateQuestionsFromMaterial({
      topicTitle: "課題5：近代歐洲的興起",
      sectionTitle: "宗教改革",
      difficulty: "basic",
      questionTypes: ["fill", "mc", "short"],
      count: 6,
      materialUnits: units,
    });
    return {
      questions,
      result: validateLlmQuestions({ questions }, context({ questionTypes: ["fill", "mc", "short"] })),
    };
  }

  it("生成的填充題全部通過權威驗證器（沒有丟棄原因）", () => {
    const { result } = validateMockQuestions(UNITS);
    const fillDiscards = result.discardedReasons.filter((reason) => reason.length > 0);
    expect(fillDiscards).toEqual([]);
    const fills = result.accepted.filter((question) => question.questionType === "fill");
    expect(fills.length).toBeGreaterThan(0);
    for (const question of fills) {
      expect(countBlankMarkers(question.question)).toBe(1);
      expect(question.question.replace(/\s/g, "").length).toBeLessThanOrEqual(FILL_STEM_HARD_MAX);
      expect(question.question.replace(/\s/g, "").length).toBeGreaterThanOrEqual(1);
    }
  });

  it("教材不足以產生合格題目時會減少題目數量，而不是降低標準", () => {
    const insufficient: MaterialUnit[] = [
      {
        blockId: "blk_thin",
        sourceLocation: "教材 · 第 1 段",
        text: "為生方法：主要以採摘野果及狩獵為生。",
      },
    ];
    const { questions, result } = validateMockQuestions(insufficient);
    const fillQuestions = questions.filter((question) => question.questionType === "fill");
    expect(fillQuestions).toHaveLength(0);
    expect(result.accepted.every((question) => question.questionType !== "fill")).toBe(true);
  });

  it("丟棄原因會具體說明問題（供教師及開發者理解）", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          fillQuestion({
            question: "中古時代歐洲的＿＿＿制度下，土地由領主授予封臣。",
            correctAnswer: "展開時間",
          }),
        ],
      },
      context(),
    );
    expect(result.accepted).toHaveLength(0);
    expect(result.discardedReasons[0]).toContain("展開時間");
  });

  it("題幹長度的目標範圍只用於提示語，不會令合格題目被丟棄", () => {
    // 20–70 字為目標；低於目標的題目仍然合格（硬上限才是強制）
    const short = checkFillStem("＿＿＿年，馬丁路德發表《九十五條論證》。", "1517年");
    expect(short.ok).toBe(true);
    const atTarget = "＿＿＿期間，蒸汽機的發明改變了生產方式，工廠制度隨之普及。";
    expect(atTarget.replace(/\s/g, "").length).toBeLessThanOrEqual(FILL_STEM_TARGET_MAX + 10);
    expect(checkFillStem(atTarget, "工業革命").ok).toBe(true);
  });
});
