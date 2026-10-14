import { describe, expect, it } from "vitest";

import { normalizeForMatch } from "@/server/materials/text-utils";
import { findUnverifiedNames, validateLlmQuestions } from "@/server/llm/validation";
import type { MaterialUnit } from "@/server/llm/provider";

const UNITS: MaterialUnit[] = [
  {
    blockId: "blk_1",
    sourceLocation: "教材 DOCX · 第 1 段（清單）",
    text: "1517年10月，德意志神學家馬丁路德發表《九十五條論證》，批評教會濫用贖罪券。",
  },
  {
    blockId: "blk_2",
    sourceLocation: "教材 DOCX · 第 2 段（清單）",
    text: "社會契約：君主權力來自人民授予，雙方訂立契約以界定權責。",
  },
];

function context() {
  return {
    topicId: "topic-5",
    sectionId: "topic-5-reformation",
    questionTypes: ["mc", "fill", "short"] as ("mc" | "fill" | "short")[],
    difficulty: "basic" as const,
    origin: "material-ai" as const,
    units: UNITS,
    now: "2026-01-01T00:00:00.000Z",
    idFor: (index: number) => `q-${index}`,
  };
}

describe("LLM 輸出驗證", () => {
  it("接受格式正確且有教材依據的題目", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "mc",
            difficulty: "basic",
            question: "誰在1517年發表《九十五條論證》？",
            options: ["馬丁路德", "加爾文", "亨利八世", "但丁"],
            correctAnswerIndex: 0,
            correctAnswer: "馬丁路德",
            explanation: "馬丁路德在1517年發表《九十五條論證》。",
            knowledgePoint: "宗教改革的展開",
            sourceExcerpt: "德意志神學家馬丁路德發表《九十五條論證》",
            sourceBlockIds: ["blk_1"],
            gradingPoints: [],
          },
        ],
      },
      { ...context(), questionTypes: ["mc"] },
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].correctAnswer).toBe("馬丁路德");
    expect(result.accepted[0].sourceVerified).toBe(true);
    expect(result.accepted[0].status).toBe("draft");
  });

  it("丟棄沒有教材依據的題目", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "mc",
            difficulty: "basic",
            question: "工業革命在何時開始？",
            options: ["十八世紀中葉", "十六世紀", "二十世紀"],
            correctAnswer: "十八世紀中葉",
            explanation: "解釋",
            knowledgePoint: "工業革命",
            sourceExcerpt: "工業革命在十八世紀中葉於英國展開",
            sourceBlockIds: ["blk_1"],
            gradingPoints: [],
          },
        ],
      },
      context(),
    );

    expect(result.accepted).toHaveLength(0);
    expect(result.discardedReasons[0]).toContain("教材依據");
  });

  it("丟棄引用不存在段落的題目", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "fill",
            difficulty: "basic",
            question: "＿＿＿發表《九十五條論證》。",
            options: [],
            correctAnswer: "馬丁路德",
            explanation: "解釋",
            knowledgePoint: "宗教改革",
            sourceExcerpt: "德意志神學家馬丁路德發表《九十五條論證》",
            sourceBlockIds: ["blk_missing"],
            gradingPoints: [],
          },
        ],
      },
      context(),
    );

    expect(result.accepted).toHaveLength(0);
    expect(result.discardedReasons[0]).toContain("不存在");
  });

  it("丟棄標準答案不在選項內的選擇題", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "mc",
            difficulty: "basic",
            question: "誰發表了《九十五條論證》？",
            options: ["加爾文", "亨利八世"],
            correctAnswer: "馬丁路德",
            explanation: "解釋",
            knowledgePoint: "宗教改革",
            sourceExcerpt: "德意志神學家馬丁路德發表《九十五條論證》",
            sourceBlockIds: ["blk_1"],
            gradingPoints: [],
          },
        ],
      },
      context(),
    );

    expect(result.accepted).toHaveLength(0);
    expect(result.discardedReasons[0]).toContain("標準答案");
  });

  it("丟棄格式不符的項目，但保留其他合規題目", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          { questionType: "mc" },
          {
            questionType: "short",
            difficulty: "advanced",
            question: "試說明社會契約的內容。",
            options: [],
            correctAnswer: "君主權力來自人民授予，雙方訂立契約以界定權責。",
            explanation: "解釋",
            knowledgePoint: "啟蒙思想：社會契約",
            sourceExcerpt: "社會契約：君主權力來自人民授予",
            sourceBlockIds: ["blk_2"],
            gradingPoints: ["君主權力來自人民授予"],
          },
        ],
      },
      context(),
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.discardedReasons).toHaveLength(1);
  });

  it("移除題目中的「根據教材」等提示語", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "fill",
            difficulty: "basic",
            question: "根據教材，＿＿＿發表《九十五條論證》。",
            options: [],
            correctAnswer: "馬丁路德",
            explanation: "解釋",
            knowledgePoint: "宗教改革",
            sourceExcerpt: "德意志神學家馬丁路德發表《九十五條論證》",
            sourceBlockIds: ["blk_1"],
            gradingPoints: [],
          },
        ],
      },
      context(),
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].question).not.toContain("根據教材");
    expect(normalizeForMatch(result.accepted[0].question)).toContain("＿＿＿發表");
  });

  it("移除題目開頭的「綜合教材所述」引導語", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "short",
            difficulty: "challenge",
            question: "綜合教材所述，社會契約如何界定君主與人民的權責？",
            options: [],
            correctAnswer: "君主權力來自人民授予，雙方訂立契約以界定權責。",
            explanation: "解釋",
            knowledgePoint: "社會契約",
            sourceExcerpt: "社會契約：君主權力來自人民授予，雙方訂立契約以界定權責。",
            sourceBlockIds: ["blk_2"],
            gradingPoints: ["君主權力來自人民授予"],
          },
        ],
      },
      context(),
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].question).toBe("社會契約如何界定君主與人民的權責？");
  });

  it("丟棄要求學生參考教材／標題的題目（學生作答時不會看到教材）", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "mc",
            difficulty: "basic",
            question: "以下哪一項是教材中提及的課題內容？",
            options: [
              "古代文明的興起",
              "新石器時代的農業革命",
              "不同地區的舊石器時代人類",
              "人類需要的演變",
            ],
            correctAnswerIndex: 2,
            correctAnswer: "不同地區的舊石器時代人類",
            explanation: "解釋",
            knowledgePoint: "舊石器時代",
            sourceExcerpt: "德意志神學家馬丁路德發表《九十五條論證》",
            sourceBlockIds: ["blk_1"],
            gradingPoints: [],
          },
          {
            questionType: "mc",
            difficulty: "advanced",
            question: "以下哪一項是「不同地區的舊石器時代人類」這個標題所涵蓋的說明？",
            options: [
              "比較不同地區的舊石器時代人類",
              "只討論新石器時代人類",
              "只集中敘述某一地區的舊石器時代人類",
              "只介紹舊石器時代之後的人類",
            ],
            correctAnswerIndex: 0,
            correctAnswer: "比較不同地區的舊石器時代人類",
            explanation: "解釋",
            knowledgePoint: "舊石器時代",
            sourceExcerpt: "德意志神學家馬丁路德發表《九十五條論證》",
            sourceBlockIds: ["blk_1"],
            gradingPoints: [],
          },
        ],
      },
      { ...context(), questionTypes: ["mc"] },
    );

    expect(result.accepted).toHaveLength(0);
    expect(result.discardedReasons).toHaveLength(2);
    expect(result.discardedReasons[0]).toContain("不會看到教材");
  });

  it("丟棄選項提及教材的選擇題", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "mc",
            difficulty: "basic",
            question: "以下哪一項是社會契約的說明？",
            options: [
              "君主權力來自人民授予，雙方訂立契約以界定權責。",
              "教材中提及的內容",
              "國王擁有絕對權力",
            ],
            correctAnswerIndex: 0,
            correctAnswer: "君主權力來自人民授予，雙方訂立契約以界定權責。",
            explanation: "解釋",
            knowledgePoint: "社會契約",
            sourceExcerpt: "社會契約：君主權力來自人民授予，雙方訂立契約以界定權責。",
            sourceBlockIds: ["blk_2"],
            gradingPoints: [],
          },
        ],
      },
      { ...context(), questionTypes: ["mc"] },
    );

    expect(result.accepted).toHaveLength(0);
    expect(result.discardedReasons[0]).toContain("選項");
  });

  it("丟棄短答題沒有得分要點的題目", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "short",
            difficulty: "advanced",
            question: "試說明社會契約的內容。",
            options: [],
            correctAnswer: "君主權力來自人民授予。",
            explanation: "解釋",
            knowledgePoint: "啟蒙思想",
            sourceExcerpt: "社會契約：君主權力來自人民授予",
            sourceBlockIds: ["blk_2"],
            gradingPoints: [],
          },
        ],
      },
      context(),
    );

    expect(result.accepted).toHaveLength(0);
    expect(result.discardedReasons[0]).toContain("得分要點");
  });

  it("短答題的 correctAnswer 留空時，以得分要點組成參考答案而不丟棄題目", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "short",
            difficulty: "advanced",
            question: "試說明社會契約的內容。",
            options: [],
            correctAnswer: "",
            explanation: "解釋",
            knowledgePoint: "啟蒙思想",
            sourceExcerpt: "社會契約：君主權力來自人民授予",
            sourceBlockIds: ["blk_2"],
            gradingPoints: ["君主權力來自人民授予", "雙方訂立契約界定權責"],
          },
        ],
      },
      context(),
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].correctAnswer).toContain("君主權力來自人民授予");
    expect(result.accepted[0].gradingPoints).toHaveLength(2);
  });

  it("移除題目、選項、解釋及得分要點中的標題／Markdown 符號", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "mc",
            difficulty: "basic",
            question: "## 馬丁路德在哪一年發表《九十五條論證》？",
            options: ["**1517 年**", "1519 年", "1521 年", "1525 年"],
            correctAnswerIndex: 0,
            correctAnswer: "1517 年",
            explanation: "- 他在 1517 年發表。",
            knowledgePoint: "宗教改革#背景",
            sourceExcerpt: "德意志神學家馬丁路德發表《九十五條論證》",
            sourceBlockIds: ["blk_1"],
            gradingPoints: [],
          },
        ],
      },
      context(),
    );

    expect(result.accepted).toHaveLength(1);
    const question = result.accepted[0];
    expect(question.question).toBe("馬丁路德在哪一年發表《九十五條論證》？");
    expect(question.options[0]).toBe("1517 年");
    expect(question.explanation).toBe("他在 1517 年發表。");
    expect(question.knowledgePoint).toBe("宗教改革背景");
  });

  it("錯誤選項的年份不必見於教材（錯誤選項本來就是錯誤答案）", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "mc",
            difficulty: "basic",
            question: "馬丁路德在哪一年發表《九十五條論證》？",
            options: ["1517 年", "1519 年", "1521 年", "1525 年"],
            correctAnswerIndex: 0,
            correctAnswer: "1517 年",
            explanation: "馬丁路德在 1517 年發表《九十五條論證》。",
            knowledgePoint: "宗教改革的展開",
            sourceExcerpt: "德意志神學家馬丁路德發表《九十五條論證》",
            sourceBlockIds: ["blk_1"],
            gradingPoints: [],
          },
        ],
      },
      { ...context(), questionTypes: ["mc"] },
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.discardedReasons).toEqual([]);
    // 錯誤選項的人物同樣不必見於教材（錯誤選項本來就不是教材內容）
    expect(result.accepted[0].qualityWarnings).toEqual([]);
  });

  it("接受題目及答案中教材交代過的年份", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "fill",
            difficulty: "basic",
            question: "＿＿＿，德意志神學家馬丁路德發表《九十五條論證》。",
            options: [],
            correctAnswer: "1517年10月",
            explanation: "教材記載馬丁路德於 1517年 發表《九十五條論證》。",
            knowledgePoint: "宗教改革的展開",
            sourceExcerpt: "德意志神學家馬丁路德發表《九十五條論證》",
            sourceBlockIds: ["blk_1"],
            gradingPoints: [],
          },
        ],
      },
      { ...context(), questionTypes: ["fill"] },
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.discardedReasons).toEqual([]);
  });

  it("丟棄題目出現教材沒有交代的年份（疑似杜撰史實）", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "mc",
            difficulty: "basic",
            question: "馬丁路德在1521年發表《九十五條論證》，對嗎？",
            options: ["對", "錯"],
            correctAnswerIndex: 1,
            correctAnswer: "錯",
            explanation: "《九十五條論證》在 1517 年發表。",
            knowledgePoint: "宗教改革的展開",
            sourceExcerpt: "德意志神學家馬丁路德發表《九十五條論證》",
            sourceBlockIds: ["blk_1"],
            gradingPoints: [],
          },
        ],
      },
      { ...context(), questionTypes: ["mc"] },
    );

    expect(result.accepted).toHaveLength(0);
    expect(result.discardedReasons[0]).toContain("1521年");
    expect(result.discardedReasons[0]).toContain("杜撰");
  });

  it("丟棄解釋出現教材沒有交代的年份的題目", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "short",
            difficulty: "advanced",
            question: "試說明《九十五條論證》的內容。",
            options: [],
            correctAnswer: "馬丁路德批評教會濫用贖罪券。",
            explanation: "他在1521年發表這份文件。",
            knowledgePoint: "宗教改革的展開",
            sourceExcerpt: "德意志神學家馬丁路德發表《九十五條論證》",
            sourceBlockIds: ["blk_1"],
            gradingPoints: ["批評教會濫用贖罪券"],
          },
        ],
      },
      context(),
    );

    expect(result.accepted).toHaveLength(0);
    expect(result.discardedReasons[0]).toContain("1521年");
  });

  it("丟棄得分要點出現教材沒有交代的年份的題目", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "short",
            difficulty: "advanced",
            question: "試說明「社會契約」的內容。",
            options: [],
            correctAnswer: "君主權力來自人民授予，雙方訂立契約以界定權責。",
            explanation: "社會契約論述君主與人民的權責。",
            knowledgePoint: "啟蒙思想：社會契約",
            sourceExcerpt: "社會契約：君主權力來自人民授予，雙方訂立契約以界定權責。",
            sourceBlockIds: ["blk_2"],
            gradingPoints: ["1688年後君主權力來自人民授予"],
          },
        ],
      },
      context(),
    );

    expect(result.accepted).toHaveLength(0);
    expect(result.discardedReasons[0]).toContain("1688年");
  });

  it("人名及條約名未見於教材時只記錄品質警告，題目仍會保留", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "fill",
            difficulty: "basic",
            question: "宗教改革期間，喀爾文提出以《基督教要義》闡述其主張。",
            options: [],
            correctAnswer: "喀爾文",
            explanation: "喀爾文在日內瓦推行宗教改革。",
            knowledgePoint: "宗教改革的發展",
            sourceExcerpt: "德意志神學家馬丁路德發表《九十五條論證》",
            sourceBlockIds: ["blk_1"],
            gradingPoints: [],
          },
        ],
      },
      { ...context(), questionTypes: ["fill"] },
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.discardedReasons).toEqual([]);
    const warnings = result.accepted[0].qualityWarnings.join(" ");
    expect(warnings).toContain("喀爾文");
    expect(warnings).toContain("《基督教要義》");
    expect(warnings).toContain("請核對教材後才發布");
  });

  it("人名及條約名見於教材時不會產生品質警告", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "fill",
            difficulty: "basic",
            question: "德意志神學家馬丁路德提出《九十五條論證》，批評教會濫用贖罪券。",
            options: [],
            correctAnswer: "馬丁路德",
            explanation: "馬丁路德在《九十五條論證》中批評教會濫用贖罪券。",
            knowledgePoint: "宗教改革的展開",
            sourceExcerpt: "德意志神學家馬丁路德發表《九十五條論證》",
            sourceBlockIds: ["blk_1"],
            gradingPoints: [],
          },
        ],
      },
      { ...context(), questionTypes: ["fill"] },
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].qualityWarnings).toEqual([]);
  });

  it("以生卒年標示的人名同樣會與教材核對", () => {
    const names = findUnverifiedNames(
      "邱吉爾（1874-1965）與羅斯福（1882-1945）同屬戰時領袖。",
      "邱吉爾（1874-1965）是英國首相。",
    );

    expect(names.persons).toContain("羅斯福");
    expect(names.persons).not.toContain("邱吉爾");
  });

  it("沒有《》的條約名亦會核對，但「簽訂條約」這類片段不會誤報", () => {
    const names = findUnverifiedNames(
      "凡爾賽條約規定德國須負擔賠款。簽訂條約的程序亦須遵守。",
      "第一次世界大戰後，戰勝國與德國簽訂和約。",
    );

    expect(names.documents).toEqual(["凡爾賽條約"]);
    expect(names.persons).toEqual([]);
  });
});
