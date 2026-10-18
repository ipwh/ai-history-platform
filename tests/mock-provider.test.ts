import { describe, expect, it } from "vitest";

import { checkHistoricalAnswer } from "@/server/llm/historical-answer";
import { generateQuestionsFromMaterial, isExplanatoryDefinition } from "@/server/llm/mock-provider";
import { validateLlmQuestions } from "@/server/llm/validation";
import { normalizeForMatch } from "@/server/materials/text-utils";
import type { MaterialUnit } from "@/server/llm/provider";

const UNITS: MaterialUnit[] = [
  {
    blockId: "blk_1",
    sourceLocation: "教材 · 第 1 段",
    text: "家庭手工業制度：在家中以人手及簡單工具進行生產，屬於小規模生產。",
  },
  {
    blockId: "blk_2",
    sourceLocation: "教材 · 第 2 段",
    text: "工廠制度：工人在工廠內操作機器進行生產，屬於大規模生產。",
  },
  {
    blockId: "blk_3",
    sourceLocation: "教材 · 第 3 段",
    text: "十八世紀，英國人瓦特改良了「蒸汽機」，使蒸汽成為穩定可靠的新能源。",
  },
  {
    blockId: "blk_4",
    sourceLocation: "教材 · 第 4 段",
    text: "珍妮紡紗機的發明（1764年）令紡織業的生產效率大幅提升。",
  },
  {
    blockId: "blk_5",
    sourceLocation: "教材 · 第 5 段",
    text: "城市化與工業化密切相關，工業革命期間城鎮人口持續上升。",
  },
  {
    blockId: "blk_6",
    sourceLocation: "教材 · 第 6 段",
    text: "權力分立：政府權力分為行政、立法與司法權，並由不同機關行使。",
  },
];

function baseInput(overrides: Partial<Parameters<typeof generateQuestionsFromMaterial>[0]> = {}) {
  return {
    topicTitle: "課題5：近代歐洲的興起",
    sectionTitle: "工業革命",
    questionTypes: ["mc", "fill"] as ("mc" | "fill")[],
    difficulty: "basic" as const,
    count: 6,
    materialUnits: UNITS,
    ...overrides,
  };
}

describe("本地示範生成（mock provider）", () => {
  it("會產生題目，且每題的教材節錄都真的出現在教材之中", () => {
    const questions = generateQuestionsFromMaterial(baseInput());
    expect(questions.length).toBeGreaterThan(0);

    const allText = UNITS.map((unit) => normalizeForMatch(unit.text)).join("|");
    for (const question of questions) {
      expect(allText).toContain(normalizeForMatch(question.sourceExcerpt));
      expect(question.sourceBlockIds.length).toBeGreaterThan(0);
    }
  });

  it("選擇題的標準答案必定是選項之一", () => {
    const questions = generateQuestionsFromMaterial(baseInput({ questionTypes: ["mc"] }));
    const mcQuestions = questions.filter((question) => question.questionType === "mc");
    expect(mcQuestions.length).toBeGreaterThan(0);
    for (const question of mcQuestions) {
      expect(question.options).toContain(question.correctAnswer);
      expect(question.options.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("題目文字不會出現「根據教材」等提示語", () => {
    const questions = generateQuestionsFromMaterial(baseInput());
    for (const question of questions) {
      expect(question.question).not.toMatch(/根據教材|根據上文|根據上載文件/);
    }
  });

  it("遵守題目數量上限", () => {
    const questions = generateQuestionsFromMaterial(baseInput({ count: 2 }));
    expect(questions.length).toBeLessThanOrEqual(2);
  });

  it("不會用寬表格的一整列出題（欄位並列無法問得通）", () => {
    const tableRow: MaterialUnit = {
      blockId: "blk_table",
      sourceLocation: "教材 · 第 7 段（表格）（表格第 2 列）",
      text: "能源 ｜ 人力、畜力、風力、水力與煤炭為主要能源 ｜ 大量燃燒煤炭，並廣泛使用蒸汽及電力",
    };
    const questions = generateQuestionsFromMaterial(
      baseInput({ materialUnits: [tableRow, ...UNITS], count: 3 }),
    );

    expect(questions.length).toBeGreaterThan(0);
    expect(questions.every((question) => question.sourceBlockIds[0] !== "blk_table")).toBe(true);
  });

  it("生成的題目全部通過驗證（可轉成內部題目格式）", () => {
    const questions = generateQuestionsFromMaterial(baseInput());
    const result = validateLlmQuestions(
      { questions },
      {
        topicId: "topic-5",
        sectionId: "topic-5-industrial",
        questionTypes: ["mc", "fill"],
        difficulty: "basic",
        origin: "material-mock",
        units: UNITS,
        now: "2026-01-01T00:00:00.000Z",
        idFor: (index) => `mock-${index}`,
      },
    );
    expect(result.discardedReasons).toEqual([]);
    expect(result.accepted).toHaveLength(questions.length);
  });

  it("不同難度採用不同的出題規則", () => {
    const units: MaterialUnit[] = [
      {
        blockId: "d1",
        sourceLocation: "教材 · 第 1 段",
        text: "家庭手工業制度：在家中以人手及簡單工具進行生產，屬於小規模生產。",
      },
      {
        blockId: "d2",
        sourceLocation: "教材 · 第 2 段",
        text: "工廠制度：工人在工廠內操作機器進行生產，屬於大規模生產。",
      },
      {
        blockId: "d3",
        sourceLocation: "教材 · 第 3 段",
        text: "權力分立：政府權力分為行政、立法與司法權，並由不同機關行使。",
      },
      {
        blockId: "y1",
        sourceLocation: "教材 · 第 4 段",
        text: "1764年，珍妮紡紗機的發明令紡織業的生產效率大幅提升。",
      },
      {
        blockId: "y2",
        sourceLocation: "教材 · 第 5 段",
        text: "1785年，英國人瓦特改良蒸汽機。",
      },
      {
        blockId: "y3",
        sourceLocation: "教材 · 第 6 段",
        text: "1840年，英國向中國發動鴉片戰爭。",
      },
    ];

    const build = (
      difficulty: "basic" | "advanced" | "challenge",
      questionTypes: ("mc" | "fill")[],
    ) =>
      generateQuestionsFromMaterial({
        ...baseInput(),
        difficulty,
        questionTypes,
        count: 1,
        materialUnits: units,
      })[0];

    // 基礎：直接辨認教材的關鍵詞語
    expect(build("basic", ["mc"]).question).toContain("是指以下哪一個詞語？");
    expect(build("basic", ["fill"]).correctAnswer).toBe("家庭手工業制度");

    // 進階：選出詞語的說明
    expect(build("advanced", ["mc"]).question).toContain("的說明？");

    // 挑戰：以年份（時序）挖空為主
    expect(build("challenge", ["mc"]).question).toContain("＿＿＿");
    expect(build("challenge", ["fill"]).correctAnswer).toMatch(/\d{3,4}年/);
  });

  it("填充題的答案一定是歷史元素，不會用教材欄位名稱作答", () => {
    const units: MaterialUnit[] = [
      {
        blockId: "label-1",
        sourceLocation: "教材 · 第 1 段",
        text: "展開時間：約公元前3,500年",
      },
      {
        blockId: "label-2",
        sourceLocation: "教材 · 第 2 段",
        text: "為生方法：主要以採摘野果及狩獵為生",
      },
      {
        blockId: "label-3",
        sourceLocation: "教材 · 第 3 段",
        text: "定居與建房：村落陸續出現，以村落為基礎的農耕社會形成",
      },
      {
        blockId: "term-1",
        sourceLocation: "教材 · 第 4 段",
        text: "封建制度：國王把土地分封給諸侯，諸侯須向國王效忠。",
      },
      {
        blockId: "year-1",
        sourceLocation: "教材 · 第 5 段",
        text: "1517年，馬丁路德發表《九十五條論證》，批評教會濫用贖罪券。",
      },
    ];
    const materialText = units.map((unit) => unit.text).join("\n");

    for (const difficulty of ["basic", "advanced", "challenge"] as const) {
      const questions = generateQuestionsFromMaterial({
        ...baseInput(),
        difficulty,
        questionTypes: ["fill"],
        count: 5,
        materialUnits: units,
      });
      expect(questions.length).toBeGreaterThan(0);
      for (const question of questions) {
        expect(
          checkHistoricalAnswer(question.correctAnswer, materialText).ok,
          `${difficulty}：「${question.correctAnswer}」`,
        ).toBe(true);
      }
      const answers = questions.map((question) => question.correctAnswer);
      for (const rejected of ["展開時間", "為生方法", "定居與建房", "約公元前3,500年"]) {
        expect(answers, difficulty).not.toContain(rejected);
      }
    }

    // 合格素材仍然會出題：制度名稱及年份
    const basic = generateQuestionsFromMaterial({
      ...baseInput(),
      difficulty: "basic",
      questionTypes: ["fill"],
      count: 5,
      materialUnits: units,
    }).map((question) => question.correctAnswer);
    expect(basic).toContain("封建制度");
  });

  it("不會把時間軸句式當成定義句（「約公元前3,200年」是指…）", () => {
    const units: MaterialUnit[] = [
      {
        blockId: "tl-1",
        sourceLocation: "教材 · 第 1 段",
        text: "約公元前3,200年：人類發明文字以作記錄及溝通之用",
      },
    ];
    const questions = generateQuestionsFromMaterial({
      ...baseInput(),
      difficulty: "basic",
      questionTypes: ["fill", "mc"],
      count: 3,
      materialUnits: units,
    });

    // 可以挖空年份出題（時序），但不可把年份當成被定義的「詞語」
    for (const question of questions) {
      if (question.question.includes("」是指")) {
        expect(question.correctAnswer, question.question).not.toMatch(/公元前/);
      }
    }
  });
});

/**
 * 「詞語：說明」的配對是否可用來出定義式題目。
 *
 * 學生回報（2026-10-16）：第 3 題「以下哪一項是「文藝復興期間」的說明？」的選項把
 * **教材標題詞**（「文藝復興與宗教改革」、「歐洲的新殖民擴張浪潮」）與**說明句**混在一起；
 * 第 4 題「以下哪一項是「從神本走向人本」的說明？」的標準答案更是標題詞本身
 * （教材原文：從神本走向人本：文藝復興與宗教改革）。學生無法判斷哪一項才算「說明」。
 */
describe("定義式題目：冒號後必須是說明句，不是標題詞", () => {
  it("辨認說明句與標題詞／名詞短語", () => {
    expect(isExplanatoryDefinition("學者發現教會翻譯的版本及其對自然的理解存在多處錯誤。")).toBe(
      true,
    );
    expect(isExplanatoryDefinition("歐洲的中古時代結束，進入近代")).toBe(true);
    expect(isExplanatoryDefinition("文藝復興與宗教改革")).toBe(false);
    expect(isExplanatoryDefinition("歐洲的新殖民擴張浪潮")).toBe(false);
  });

  it("教材混有標題詞配對時，標題詞不會當成標準答案或選項", () => {
    const units: MaterialUnit[] = [
      {
        blockId: "amb-1",
        sourceLocation: "教材 · 第 1 段",
        text: "文藝復興期間：學者發現教會翻譯的版本及其對自然的理解存在多處錯誤。",
      },
      {
        blockId: "amb-2",
        sourceLocation: "教材 · 第 2 段",
        text: "從神本走向人本：文藝復興與宗教改革",
      },
      {
        blockId: "amb-3",
        sourceLocation: "教材 · 第 3 段",
        text: "新帝國主義：歐洲的新殖民擴張浪潮",
      },
      {
        blockId: "amb-4",
        sourceLocation: "教材 · 第 4 段",
        text: "公元1453年：歐洲的中古時代結束，進入近代",
      },
      {
        blockId: "amb-5",
        sourceLocation: "教材 · 第 5 段",
        text: "家庭手工業制度：在家中以人手及簡單工具進行生產，屬於小規模生產。",
      },
      {
        blockId: "amb-6",
        sourceLocation: "教材 · 第 6 段",
        text: "工廠制度：工人在工廠內操作機器進行生產，屬於大規模生產。",
      },
      {
        blockId: "amb-7",
        sourceLocation: "教材 · 第 7 段",
        text: "權力分立：政府權力分為行政、立法與司法權，並由不同機關行使。",
      },
    ];
    const questions = generateQuestionsFromMaterial({
      ...baseInput(),
      difficulty: "advanced",
      questionTypes: ["mc"],
      count: 4,
      materialUnits: units,
    });
    const definitionQuestions = questions.filter((question) =>
      question.question.endsWith("的說明？"),
    );

    // 合格的說明句仍足夠出題（不是一律不出），但標題詞一律不可成為答案或選項
    expect(definitionQuestions.length).toBeGreaterThan(0);
    for (const question of questions) {
      expect(question.correctAnswer).not.toBe("文藝復興與宗教改革");
      expect(question.correctAnswer).not.toBe("歐洲的新殖民擴張浪潮");
      expect(question.options).not.toContain("文藝復興與宗教改革");
      expect(question.options).not.toContain("歐洲的新殖民擴張浪潮");
      // 「以下哪一項是「X」的說明？」的所有選項都必須是說明句，否則學生無從判斷
      if (question.question.endsWith("的說明？")) {
        for (const option of question.options) {
          expect(isExplanatoryDefinition(option), option).toBe(true);
        }
      }
    }
  });

  it("真正的說明句仍可出題（答案與選項都是說明句）", () => {
    const units: MaterialUnit[] = [
      {
        blockId: "ok-1",
        sourceLocation: "教材 · 第 1 段",
        text: "家庭手工業制度：在家中以人手及簡單工具進行生產，屬於小規模生產。",
      },
      {
        blockId: "ok-2",
        sourceLocation: "教材 · 第 2 段",
        text: "工廠制度：工人在工廠內操作機器進行生產，屬於大規模生產。",
      },
      {
        blockId: "ok-3",
        sourceLocation: "教材 · 第 3 段",
        text: "權力分立：政府權力分為行政、立法與司法權，並由不同機關行使。",
      },
      {
        blockId: "ok-4",
        sourceLocation: "教材 · 第 4 段",
        text: "蒸汽機：由瓦特改良，令蒸汽成為穩定可靠的新能源。",
      },
    ];
    const questions = generateQuestionsFromMaterial({
      ...baseInput(),
      difficulty: "advanced",
      questionTypes: ["mc"],
      count: 2,
      materialUnits: units,
    });
    const definitionQuestion = questions.find((question) => question.question.endsWith("的說明？"));

    expect(definitionQuestion).toBeDefined();
    expect(isExplanatoryDefinition(definitionQuestion!.correctAnswer)).toBe(true);
    expect(definitionQuestion!.options.length).toBeGreaterThanOrEqual(3);
    for (const option of definitionQuestion!.options) {
      expect(isExplanatoryDefinition(option), option).toBe(true);
    }
  });
});
