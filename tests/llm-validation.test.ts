import { describe, expect, it } from "vitest";

import { normalizeForMatch } from "@/server/materials/text-utils";
import { findUnverifiedNames, validateLlmQuestions } from "@/server/llm/validation";
import type { ValidationContext } from "@/server/llm/validation";
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

/**
 * 技能標示：只接受教育局《歷史科課程指引》的固定技能清單。
 * 模型自創名稱會令技能統計失真，因此一律略過並記錄警告，而不是照抄寫入資料庫。
 */
describe("歷史技能標示", () => {
  function questionWith(skill: string | null) {
    return {
      questions: [
        {
          questionType: "fill",
          difficulty: "basic",
          question: "＿＿＿發表《九十五條論證》。",
          options: [],
          correctAnswer: "馬丁路德",
          explanation: "馬丁路德在1517年發表《九十五條論證》。",
          knowledgePoint: "宗教改革",
          sourceExcerpt: "德意志神學家馬丁路德發表《九十五條論證》",
          sourceBlockIds: ["blk_1"],
          gradingPoints: [],
          skill,
        },
      ],
    };
  }

  it("清單內的技能會寫入題目", () => {
    const result = validateLlmQuestions(
      questionWith("準確排列歷史事件的次序"),
      { ...context(), questionTypes: ["fill"] },
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].skill).toBe("準確排列歷史事件的次序");
  });

  it("自創的技能名稱會被略過並記錄警告（不會寫入資料庫）", () => {
    const result = validateLlmQuestions(
      questionWith("時序理解與分析"),
      { ...context(), questionTypes: ["fill"] },
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].skill).toBeNull();
    expect(result.accepted[0].qualityWarnings.join()).toContain("不在課程技能清單內");
  });

  it("未提供技能時為 null，不會被當成已標示", () => {
    const result = validateLlmQuestions(questionWith(null), {
      ...context(),
      questionTypes: ["fill"],
    });

    expect(result.accepted[0].skill).toBeNull();
  });
});

/**
 * 「只有一個正確答案」的檢查：選項互相包含或包含標準答案時，
 * 學生選該選項未必算錯。這類題目以品質警告交教師核對（不自動丟棄）。
 */
describe("選擇題的答案唯一性警告", () => {
  function mc(options: string[], correctAnswer: string) {
    return {
      questions: [
        {
          questionType: "mc",
          difficulty: "basic",
          question: "誰在1517年發表《九十五條論證》？",
          options,
          correctAnswerIndex: 0,
          correctAnswer,
          explanation: "馬丁路德在1517年發表《九十五條論證》。",
          knowledgePoint: "宗教改革",
          sourceExcerpt: "德意志神學家馬丁路德發表《九十五條論證》",
          sourceBlockIds: ["blk_1"],
          gradingPoints: [],
        },
      ],
    };
  }

  it("錯誤選項包含標準答案時提出警告，但保留題目供教師核對", () => {
    const result = validateLlmQuestions(mc(["馬丁路德", "馬丁路德與加爾文", "亨利八世"], "馬丁路德"), {
      ...context(),
      questionTypes: ["mc"],
    });

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].qualityWarnings.join()).toContain("包含標準答案");
  });

  it("兩個選項互相包含時提出警告", () => {
    const result = validateLlmQuestions(
      mc(["文藝復興", "文藝復興時期", "宗教改革"], "文藝復興"),
      { ...context(), questionTypes: ["mc"] },
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].qualityWarnings.join()).toContain("互相包含");
  });

  it("選項互不相關時沒有警告（正常題目不受影響）", () => {
    const result = validateLlmQuestions(
      mc(["馬丁路德", "加爾文", "亨利八世", "但丁"], "馬丁路德"),
      { ...context(), questionTypes: ["mc"] },
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].qualityWarnings).toEqual([]);
  });
});

/**
 * 教材依據必須成立於「這條題目引用的段落」。
 *
 * 背景：同一個教材段落（清單、表格）會拆成多個單位並共用同一個 blockId，
 * 因此引用的段落是「擁有該 blockId 的所有單位」；但節錄出現在其他段落不能算數。
 */
describe("教材依據的範圍", () => {
  const MULTI_UNIT: MaterialUnit[] = [
    // 同一段落拆成兩項（共用 blockId，模擬清單）
    {
      blockId: "blk_list",
      sectionId: "topic-5-industrial",
      sourceLocation: "教材 DOCX · 第 3 段（清單）第 1 項",
      text: "十八世紀中葉：工業革命率先在英國的紡織業展開。",
    },
    {
      blockId: "blk_list",
      sectionId: "topic-5-industrial",
      sourceLocation: "教材 DOCX · 第 3 段（清單）第 2 項",
      text: "十九世紀中葉：英國已成為全球領先的工業與經濟強國。",
    },
    // 另一個段落，用於測試「節錄出自其他段落」
    {
      blockId: "blk_other",
      sectionId: "topic-5-renaissance",
      sourceLocation: "教材 DOCX · 第 7 段",
      text: "文藝復興重視人文主義，強調人的價值與尊嚴。",
    },
  ];

  function groundContext(): ValidationContext {
    return {
      topicId: "topic-5",
      sectionId: "topic-5-industrial",
      sectionIds: ["topic-5-industrial", "topic-5-renaissance"],
      questionTypes: ["mc", "fill", "short"],
      difficulty: "basic",
      origin: "material-ai",
      units: MULTI_UNIT,
      now: "2026-01-01T00:00:00.000Z",
      idFor: (index) => `g-${index}`,
    };
  }

  it("節錄出自同一段落的另一項時仍然接受（清單共用 blockId）", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "fill",
            difficulty: "basic",
            question: "＿＿＿，英國已成為全球領先的工業與經濟強國。",
            options: [],
            correctAnswer: "十九世紀中葉",
            explanation: "教材指出十九世紀中葉英國成為工業強國。",
            knowledgePoint: "工業革命的發展",
            sourceExcerpt: "十九世紀中葉：英國已成為全球領先的工業與經濟強國。",
            sourceBlockIds: ["blk_list"],
            gradingPoints: [],
          },
        ],
      },
      groundContext(),
    );

    expect(result.discardedReasons).toEqual([]);
    expect(result.accepted).toHaveLength(1);
  });

  it("節錄只出現在其他段落時丟棄（不得以別處的教材通過依據檢查）", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "fill",
            difficulty: "basic",
            question: "＿＿＿重視人文主義。",
            options: [],
            correctAnswer: "文藝復興",
            explanation: "解釋",
            knowledgePoint: "文藝復興",
            // 這段文字來自 blk_other，並不在引用的 blk_list 之內
            sourceExcerpt: "文藝復興重視人文主義，強調人的價值與尊嚴。",
            sourceBlockIds: ["blk_list"],
            gradingPoints: [],
          },
        ],
      },
      groundContext(),
    );

    expect(result.accepted).toHaveLength(0);
    expect(result.discardedReasons[0]).toContain("教材依據");
  });

  it("題目歸入提供節錄的段落所屬分節", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "fill",
            difficulty: "basic",
            question: "＿＿＿重視人文主義。",
            options: [],
            correctAnswer: "文藝復興",
            explanation: "解釋",
            knowledgePoint: "文藝復興",
            sourceExcerpt: "文藝復興重視人文主義，強調人的價值與尊嚴。",
            sourceBlockIds: ["blk_other"],
            gradingPoints: [],
          },
        ],
      },
      groundContext(),
    );

    expect(result.accepted).toHaveLength(1);
    // context.sectionId 為 topic-5-industrial，但這題的依據來自文藝復興分節
    expect(result.accepted[0].sectionId).toBe("topic-5-renaissance");
  });

  it("提供節錄的段落不屬於本次要求的分節時，沿用呼叫端指定的分節", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "fill",
            difficulty: "basic",
            question: "＿＿＿重視人文主義。",
            options: [],
            correctAnswer: "文藝復興",
            explanation: "解釋",
            knowledgePoint: "文藝復興",
            sourceExcerpt: "文藝復興重視人文主義，強調人的價值與尊嚴。",
            sourceBlockIds: ["blk_other"],
            gradingPoints: [],
          },
        ],
      },
      { ...groundContext(), sectionId: "topic-5-industrial", sectionIds: ["topic-5-industrial"] },
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].sectionId).toBe("topic-5-industrial");
  });
});

/** correctAnswerIndex 與 correctAnswer 互相矛盾時不可靜默改寫答案 */
describe("選擇題答案一致性", () => {
  it("索引指向的選項與 correctAnswer 不同時丟棄整條題目", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "mc",
            difficulty: "basic",
            question: "誰在1517年發表《九十五條論證》？",
            options: ["馬丁路德", "加爾文", "亨利八世", "但丁"],
            correctAnswerIndex: 2,
            correctAnswer: "馬丁路德",
            explanation: "馬丁路德在1517年發表《九十五條論證》。",
            knowledgePoint: "宗教改革",
            sourceExcerpt: "德意志神學家馬丁路德發表《九十五條論證》",
            sourceBlockIds: ["blk_1"],
            gradingPoints: [],
          },
        ],
      },
      { ...context(), questionTypes: ["mc"] },
    );

    expect(result.accepted).toHaveLength(0);
    expect(result.discardedReasons[0]).toContain("不一致");
  });

  it("只差標點或空白視為同一個選項（等同答案），並記錄品質警告", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "mc",
            difficulty: "basic",
            question: "馬丁路德在1517年發表甚麼？",
            options: ["《九十五條論證》", "《九十五 條論證》", "《社會契約論》", "《人權宣言》"],
            correctAnswerIndex: 0,
            correctAnswer: "《九十五條論證》",
            explanation: "馬丁路德在1517年發表《九十五條論證》。",
            knowledgePoint: "宗教改革",
            sourceExcerpt: "德意志神學家馬丁路德發表《九十五條論證》",
            sourceBlockIds: ["blk_1"],
            gradingPoints: [],
          },
        ],
      },
      { ...context(), questionTypes: ["mc"] },
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].options).toHaveLength(3);
    // 等同選項被移除後，正確答案仍然是原本的選項文字
    expect(result.accepted[0].correctAnswer).toBe("《九十五條論證》");
    expect(result.accepted[0].qualityWarnings.join()).toContain("重複");
  });

  it("選項全部等同於正確答案時丟棄（無法作答）", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "mc",
            difficulty: "basic",
            question: "馬丁路德在1517年發表甚麼？",
            options: ["《九十五條論證》", "《九十五 條論證》"],
            correctAnswerIndex: 0,
            correctAnswer: "《九十五條論證》",
            explanation: "馬丁路德在1517年發表《九十五條論證》。",
            knowledgePoint: "宗教改革",
            sourceExcerpt: "德意志神學家馬丁路德發表《九十五條論證》",
            sourceBlockIds: ["blk_1"],
            gradingPoints: [],
          },
        ],
      },
      { ...context(), questionTypes: ["mc"] },
    );

    expect(result.accepted).toHaveLength(0);
    expect(result.discardedReasons[0]).toContain("選項重複");
  });
});
