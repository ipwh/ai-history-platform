/**
 * 題目重複判定的迴歸測試（2026-10-16 學生回報）。
 *
 * 實際回報（本機練習 sess_c1c25eb90c2c4f86）：5 條填充題當中有兩組「答案相同、
 * 教材依據相同、題幹只改寫了幾個字」的題目（「蒸汽時代」×2、「社會契約」×2），
 * 學生在同一次練習看到同一件史實被問兩次。舊的判定只比對「題幹字串完全相同」，
 * 因此改寫後的題目全部放行。
 *
 * 這裡鎖定兩層防線：
 *   1. 同一批生成（一次呼叫）內：validator 以「同一教材依據已用相同答案」判為重複。
 *   2. 整份練習組題（多次呼叫、多個分節）：組題時用同一套判定再次過濾，
 *      補題時並把已用過的答案交給生成器，令它改出其他史實。
 */
import { describe, expect, it } from "vitest";

import { createDuplicateTracker, questionBasisKey } from "@/server/llm/question-dedupe";
import { generateQuestionsFromMaterial } from "@/server/llm/mock-provider";
import { buildUserPrompt } from "@/server/llm/prompt";
import type { MaterialUnit } from "@/server/llm/provider";
import { validateLlmQuestions } from "@/server/llm/validation";

/** 同一段教材：答案「蒸汽時代」與答案「社會契約」各自出自自己的段落 */
const UNITS: MaterialUnit[] = [
  {
    blockId: "blk_steam",
    sectionId: "topic-5-industrial-development",
    sourceLocation: "教材 · 第 1 段",
    text: "工業革命前期，蒸汽被視為推動工業革命發展的重要動力，因此這一時期又被稱為「蒸汽時代」。",
  },
  {
    blockId: "blk_jenny",
    sectionId: "topic-5-industrial-features",
    sourceLocation: "教材 · 第 2 段",
    text: "珍妮紡紗機：1764年發明，大幅提升紡織業的生產效率。",
  },
  {
    // 同一詞語在書中另一段出現（實測可見「十八世紀中葉」等多段共用同一答案）
    blockId: "blk_steam_2",
    sectionId: "topic-5-industrial-development",
    sourceLocation: "教材 · 第 3 段",
    text: "「蒸汽時代」是工業革命前期的別稱，得名自蒸汽機的廣泛應用。",
  },
];

const STEAM_EXCERPT = UNITS[0].text;
const JENNY_EXCERPT = UNITS[1].text;
const STEAM_ELSEWHERE_EXCERPT = UNITS[2].text;

function context() {
  return {
    topicId: "topic-5",
    sectionId: "topic-5-industrial-development",
    questionTypes: ["fill"] as ("mc" | "fill" | "short")[],
    difficulty: "basic" as const,
    origin: "material-ai" as const,
    units: UNITS,
    now: "2026-01-01T00:00:00.000Z",
    idFor: (index: number) => `q-${index}`,
  };
}

/** 填充題候選：同一段教材、同一答案，題幹只改寫幾個字（＝回報的實際情況） */
function fillCandidate(options: { question: string; answer: string; excerpt: string; blockId: string }) {
  return {
    questionType: "fill" as const,
    difficulty: "basic" as const,
    question: options.question,
    options: [],
    correctAnswerIndex: null,
    correctAnswer: options.answer,
    explanation: "教材原文節錄。",
    knowledgePoint: "工業革命",
    sourceExcerpt: options.excerpt,
    sourceBlockIds: [options.blockId],
    gradingPoints: [],
  };
}

const STEAM_A = fillCandidate({
  question: "工業革命前期，蒸汽被視為推動工業革命發展的重要動力，因此這一時期又被稱為「＿＿＿」。",
  answer: "蒸汽時代",
  excerpt: STEAM_EXCERPT,
  blockId: "blk_steam",
});

const STEAM_B = fillCandidate({
  question: "工業革命前期，蒸汽被視為推動工業革命發展的重要動力，因此又被稱為＿＿＿。",
  answer: "蒸汽時代",
  excerpt: STEAM_EXCERPT,
  blockId: "blk_steam",
});

describe("重複判定：教材依據 + 答案", () => {
  it("同一教材依據、同一答案即屬重複（即使題幹改寫）", () => {
    const tracker = createDuplicateTracker();
    expect(tracker.isDuplicate(STEAM_A)).toBe(false);
    tracker.add(STEAM_A);
    expect(tracker.isDuplicate(STEAM_B)).toBe(true);
  });

  it("填充題在不同教材依據下重用同一答案仍屬重複（同一份練習不出兩條相同答案）", () => {
    const tracker = createDuplicateTracker();
    tracker.add(STEAM_A);
    // 書中不同段落可能都出現同一個詞語或年份（實測可見「十八世紀中葉」兩段），
    // 但學生在同一份填充題練習要輸入同一個答案兩次，等於同一件史實問了兩次。
    expect(
      tracker.isDuplicate({ ...STEAM_B, sourceBlockIds: ["blk_other"] }),
    ).toBe(true);
  });

  it("選擇題不受填充題的答案限制（同一份試卷不同題目共用同一正確答案屬正常）", () => {
    const tracker = createDuplicateTracker();
    tracker.add(STEAM_A);
    // 題幹不同、教材依據不同，只是答案同為「蒸汽時代」
    const mc = {
      ...STEAM_A,
      questionType: "mc" as const,
      question: "下列哪一項是工業革命前期的別稱？",
      sourceBlockIds: ["blk_steam_2"],
    };
    expect(tracker.isDuplicate(mc)).toBe(false);
  });

  it("沒有段落 ID 時以節錄全文作為依據", () => {
    const withBlocks = questionBasisKey({ ...STEAM_A, sourceBlockIds: ["blk_b", "blk_a"] });
    const reordered = questionBasisKey({ ...STEAM_A, sourceBlockIds: ["blk_a", "blk_b"] });
    expect(withBlocks).toBe(reordered);

    const noBlocks = questionBasisKey({ ...STEAM_A, sourceBlockIds: [] });
    expect(noBlocks).toBe(questionBasisKey({ ...STEAM_B, sourceBlockIds: [] }));
    expect(noBlocks).not.toBe(questionBasisKey({ ...STEAM_B, sourceExcerpt: JENNY_EXCERPT, sourceBlockIds: [] }));
  });

  it("usedAnswers 會回報已用過的答案（供補題時提示模型）", () => {
    const tracker = createDuplicateTracker();
    tracker.add(STEAM_A);
    tracker.add(STEAM_B); // 重複答案不應重複列出
    expect(tracker.usedAnswers()).toEqual(["蒸汽時代"]);
  });
});

describe("驗證器：同一批生成不可重複考核同一件史實", () => {
  it("丟棄改寫後的重複填充題，只保留一條", () => {
    const result = validateLlmQuestions({ questions: [STEAM_A, STEAM_B] }, context());

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].correctAnswer).toBe("蒸汽時代");
    expect(result.discardedReasons).toHaveLength(1);
    expect(result.discardedReasons[0]).toContain("重複");
    expect(result.discardedReasons[0]).toContain("蒸汽時代");
  });

  it("不同答案的填充題不受影響（正常情況仍然可以出多題）", () => {
    const jenny = fillCandidate({
      question: "十八世紀的＿＿＿在1764年發明，大幅提升紡織業的生產效率。",
      answer: "珍妮紡紗機",
      excerpt: JENNY_EXCERPT,
      blockId: "blk_jenny",
    });
    const result = validateLlmQuestions({ questions: [STEAM_A, jenny] }, {
      ...context(),
      sectionIds: ["topic-5-industrial-development", "topic-5-industrial-features"],
    });

    expect(result.accepted).toHaveLength(2);
    expect(result.discardedReasons).toEqual([]);
  });

  it("同一答案但取材自另一段教材的填充題亦會被丟棄（答案重複才是學生的實際感受）", () => {
    // 同一詞語在書中多段出現：答案相同、題幹不同、教材依據不同，舊寫法會全部放行
    const elsewhere = fillCandidate({
      question: "「＿＿＿」是工業革命前期的別稱，得名自蒸汽機的廣泛應用。",
      answer: "蒸汽時代",
      excerpt: STEAM_ELSEWHERE_EXCERPT,
      blockId: "blk_steam_2",
    });
    const result = validateLlmQuestions({ questions: [STEAM_A, elsewhere] }, context());

    expect(result.accepted).toHaveLength(1);
    expect(result.discardedReasons).toHaveLength(1);
    expect(result.discardedReasons[0]).toContain("蒸汽時代");
  });
});

describe("本地示範生成：避免重用已用過的答案", () => {
  const FILL_UNITS: MaterialUnit[] = [
    {
      blockId: "blk_a",
      sectionId: "topic-5-industrial",
      sourceLocation: "教材 · 第 1 段",
      text: "蒸汽機：由瓦特改良，令蒸汽成為穩定可靠的新能源。",
    },
    {
      blockId: "blk_b",
      sectionId: "topic-5-industrial",
      sourceLocation: "教材 · 第 2 段",
      text: "珍妮紡紗機：1764年發明，大幅提升紡織業的生產效率。",
    },
  ];

  function generate(avoidAnswers?: string[]) {
    return generateQuestionsFromMaterial({
      topicTitle: "課題5",
      sectionTitle: "工業革命",
      questionTypes: ["fill"],
      difficulty: "basic",
      count: 1,
      materialUnits: FILL_UNITS,
      avoidAnswers,
    });
  }

  it("未提供避免清單時會使用第一個可用素材", () => {
    const questions = generate();
    expect(questions).toHaveLength(1);
    expect(questions[0].correctAnswer).toBe("蒸汽機");
  });

  it("提供避免清單時改用其他素材，而不是重複同一答案", () => {
    const questions = generate(["蒸汽機"]);
    expect(questions).toHaveLength(1);
    expect(questions[0].correctAnswer).not.toBe("蒸汽機");
    expect(questions[0].correctAnswer).toBe("珍妮紡紗機");
  });
});

describe("提示語：補題時列出已用過的答案", () => {
  it("把已用答案寫入提示語，並要求不可只改寫同一史實", () => {
    const prompt = buildUserPrompt({
      topicTitle: "課題5",
      sectionTitle: "工業革命",
      questionTypes: ["fill"],
      difficulty: "basic",
      count: 1,
      materialUnits: UNITS,
      avoidAnswers: ["蒸汽時代"],
    });

    expect(prompt).toContain("蒸汽時代");
    expect(prompt).toContain("已用過的答案");
    expect(prompt).toContain("並不算新題目");
  });
});
