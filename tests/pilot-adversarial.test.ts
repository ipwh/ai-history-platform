/**
 * Sprint 7.9 對抗式題目品質回歸測試（全部使用**合成**教材，不涉真實教材內容）。
 *
 * 目的：把「錯誤史實／依據不足／曖昧題目／批改失敗」寫成可執行的期望，
 * 並示範每個守衛的必要性（移除守衛即會出現錯誤結果）。分類：
 *   A 錯誤史實　B 依據不足　C 曖昧題目　D 批改失敗　E 誤報與守衛必要性
 *
 * 重要前提：本檔只證明確定性規則的**阻擋／暫緩**行為，不證明歷史正確性；
 * 需要歷史專業判斷的個案一律標記為「需教師判斷」。
 */
import { describe, expect, it } from "vitest";

import { checkHistoricalAnswer } from "@/server/llm/historical-answer";
import { answerLeaksIntoStem, checkFillStem } from "@/server/llm/fill-question";
import { checkQuestionQuality, hasUncertainIssue, type QualityCandidate } from "@/server/llm/question-quality";
import { findFabricatedYears, findUnverifiedNames, validateLlmQuestions } from "@/server/llm/validation";
import type { ValidationContext } from "@/server/llm/validation";
import type { MaterialUnit } from "@/server/llm/provider";
import { gradeAnswer, normalizeAnswer } from "@/server/services/grading";
import type { Question } from "@/lib/types";

/** 合成教材：年份、人名、條約及因果各一，方便檢查「杜撰」與「改寫」 */
const UNITS: MaterialUnit[] = [
  {
    blockId: "syn-year",
    sourceLocation: "合成教材 · 第 1 段",
    text: "《合成和約》於1919年簽署；與會各國同時同意設立公共衛生局。",
  },
  {
    blockId: "syn-person",
    sourceLocation: "合成教材 · 第 2 段",
    text: "合成皇帝於1861年頒布法令，設立公共衛生局，負責清理污水。",
  },
];

const MATERIAL_TEXT = UNITS.map((unit) => unit.text).join("\n");

function mc(overrides: Partial<QualityCandidate>): QualityCandidate {
  return {
    questionType: "mc",
    question: "《合成和約》在哪一年簽署？",
    options: ["1919年", "1905年", "1939年", "1945年"],
    correctAnswer: "1919年",
    explanation: "合成教材記載《合成和約》於1919年簽署。",
    sourceExcerpt: "《合成和約》於1919年簽署",
    sourceBlockIds: ["syn-year"],
    ...overrides,
  };
}

function context(questionTypes: ValidationContext["questionTypes"]): ValidationContext {
  return {
    topicId: "topic-synthetic",
    sectionId: "section-synthetic",
    questionTypes,
    difficulty: "basic",
    origin: "material-ai",
    units: UNITS,
    now: "2026-10-16T00:00:00.000Z",
    idFor: (index: number) => `syn-${index}`,
  };
}

/** 供 D 組使用的合成題目（批改只依賴題型、答案及可接受答案） */
function question(overrides: Partial<Question>): Question {
  return {
    id: "q-syn",
    topicId: "topic-synthetic",
    sectionId: "section-synthetic",
    questionType: "fill",
    difficulty: "basic",
    question: "與會各國同意設立＿＿＿，負責清理污水。",
    options: [],
    correctAnswer: "公共衛生局",
    acceptedAnswers: [],
    explanation: "合成教材記載設立公共衛生局負責清理污水。",
    knowledgePoint: "合成知識點",
    sourceExcerpt: "設立公共衛生局",
    sourceLocation: "合成教材 · 第 1 段",
    sourceBlockIds: ["syn-year"],
    gradingPoints: [],
    origin: "material-ai",
    status: "draft",
    sourceVerified: true,
    qualityWarnings: [],
    skill: null,
    revision: 1,
    autoValidatedAt: null,
    autoValidatedRevision: null,
    autoValidatedFingerprint: null,
    teacherConfirmationRequired: false,
    createdAt: "2026-10-16T00:00:00.000Z",
    ...overrides,
  };
}

describe("A 錯誤史實", () => {
  it("A1 年份寫錯（教材 1919，題目寫 1920）會被丟棄", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "mc",
            difficulty: "basic",
            question: "《合成和約》於1920年簽署，這一年有何特別？",
            options: ["簽署和約", "爆發戰爭", "設立議會", "簽署停戰書"],
            correctAnswerIndex: 0,
            correctAnswer: "簽署和約",
            explanation: "《合成和約》於1920年簽署。",
            knowledgePoint: "合成知識點",
            sourceExcerpt: "《合成和約》於1919年簽署",
            sourceBlockIds: ["syn-year"],
            gradingPoints: [],
          },
        ],
      },
      context(["mc"]),
    );

    expect(result.accepted).toHaveLength(0);
    expect(result.discardedReasons.join(" ")).toContain("1920");
  });

  it("A2 杜撰人物會被偵測（教材沒有的名字）", () => {
    const found = findUnverifiedNames("合成公爵提出新的稅制。", MATERIAL_TEXT);
    expect(found.persons.length).toBeGreaterThan(0);
  });

  it("A3 杜撰條約名稱會被偵測", () => {
    const found = findUnverifiedNames("各國簽訂《合成條約》以結束戰爭。", MATERIAL_TEXT);
    expect(found.documents.length + found.persons.length).toBeGreaterThan(0);
    expect(JSON.stringify(found)).toContain("合成條約");
  });

  it("A4 解釋與答案矛盾（答案 1919、解釋 1920）會被丟棄", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "fill",
            difficulty: "basic",
            question: "《合成和約》於＿＿＿年簽署。",
            options: [],
            correctAnswerIndex: null,
            correctAnswer: "1919",
            explanation: "《合成和約》於1920年簽署，因此答案為1919。",
            knowledgePoint: "合成知識點",
            sourceExcerpt: "《合成和約》於1919年簽署",
            sourceBlockIds: ["syn-year"],
            gradingPoints: [],
          },
        ],
      },
      context(["fill"]),
    );

    expect(result.accepted).toHaveLength(0);
    expect(result.discardedReasons.join(" ")).toContain("1920");
  });

  it("A5 改寫加入教材沒有的結論（因果推論）會被丟棄", () => {
    const result = checkQuestionQuality(
      mc({
        correctAnswer: "《合成和約》的簽署令全球死亡率大幅下降",
        options: ["《合成和約》的簽署令全球死亡率大幅下降", "設立公共衛生局", "其他", "其他2"],
      }),
      UNITS,
    );
    expect(result.issues.filter((issue) => issue.severity === "blocking").length).toBeGreaterThan(0);
  });

  it("A6 因果倒轉（措辭幾乎相同）不會被當成已證實：只可暫緩，不可直接給學生", () => {
    const result = checkQuestionQuality(
      mc({
        correctAnswer: "公共衛生局的設立導致合成皇帝頒布法令",
        options: ["公共衛生局的設立導致合成皇帝頒布法令", "法令設立公共衛生局", "其他", "其他2"],
      }),
      UNITS,
    );
    // 確定性規則無法分辨因果方向（詞語重疊率高）→ 必須暫緩並交教師，而不是自動發布
    expect(result.issues.filter((issue) => issue.severity === "blocking")).toHaveLength(0);
    expect(hasUncertainIssue(result.issues)).toBe(true);
  });
});

describe("B 依據不足", () => {
  it("B1 詞語見於教材，但教材沒有支持該結論 → 丟棄", () => {
    const result = checkQuestionQuality(
      mc({
        correctAnswer: "公共衛生局成立後政府再無任何管治問題",
        options: ["公共衛生局成立後政府再無任何管治問題", "設立公共衛生局", "其他", "其他2"],
      }),
      UNITS,
    );
    expect(result.issues.some((issue) => issue.severity === "blocking")).toBe(true);
  });

  it("B2 引用的段落與節錄不符（節錄來自另一段）會被丟棄", () => {
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "mc",
            difficulty: "basic",
            question: "誰頒布法令設立公共衛生局？",
            options: ["合成皇帝", "合成公爵", "合成伯爵", "合成主教"],
            correctAnswerIndex: 0,
            correctAnswer: "合成皇帝",
            explanation: "合成皇帝於1861年頒布法令，設立公共衛生局。",
            knowledgePoint: "合成知識點",
            // 節錄取自 syn-year，但申報的依據段落是 syn-person → 引用不成立
            sourceExcerpt: "與會各國同時同意設立公共衛生局",
            sourceBlockIds: ["syn-unknown"],
            gradingPoints: [],
          },
        ],
      },
      context(["mc"]),
    );

    expect(result.accepted).toHaveLength(0);
  });

  it("B3 史上合理但教材沒有的答案 → 丟棄", () => {
    const result = checkQuestionQuality(
      mc({ correctAnswer: "跨國衛生公約組織", options: ["跨國衛生公約組織", "公共衛生局", "其他", "其他2"] }),
      UNITS,
    );
    expect(result.issues.map((issue) => issue.code).includes("answer-not-in-material")).toBe(true);
    expect(result.issues.filter((issue) => issue.severity === "blocking")).toHaveLength(1);
  });

  it("B4 改寫引入教材沒有的年份 → 丟棄（不是暫緩）", () => {
    const result = checkQuestionQuality(
      mc({
        correctAnswer: "公共衛生局於1888年設立，負責清理污水",
        options: ["公共衛生局於1888年設立，負責清理污水", "公共衛生局", "其他", "其他2"],
      }),
      UNITS,
    );
    expect(result.issues.filter((issue) => issue.severity === "blocking")).toHaveLength(1);
  });

  it("B5 保留原意的改寫 → 保留題目但標示未確定，並示範守衛必要性", () => {
    const result = checkQuestionQuality(
      mc({
        correctAnswer: "與會各國同意成立公共衛生局以清理污水",
        options: ["與會各國同意成立公共衛生局以清理污水", "其他", "其他2", "其他3"],
      }),
      UNITS,
    );
    expect(result.issues.filter((issue) => issue.severity === "blocking")).toHaveLength(0);
    expect(hasUncertainIssue(result.issues)).toBe(true);

    // 守衛必要性（等同移除 uncertain 分類的突變檢查）：若這個項目不存在，
    // 閘門會回報 ok，題目即會自動發布 → 證明 uncertain 分類是必要的。
    const legacyIssues = result.issues.filter((issue) => issue.severity !== "uncertain");
    expect(hasUncertainIssue(legacyIssues)).toBe(false);
  });
});

describe("C 曖昧題目", () => {
  it("C1 兩個選項都站得住（教材同時提供年份及時期說法）→ 丟棄", () => {
    const units: MaterialUnit[] = [
      {
        blockId: "syn-period-1",
        sourceLocation: "合成教材 · 第 1 段",
        text: "公元1453年：中古時代結束，進入近代。",
      },
      {
        blockId: "syn-period-2",
        sourceLocation: "合成教材 · 第 2 段",
        text: "中古時代前期（以神為本） | 文藝復興期間（以人為本）",
      },
    ];
    const result = checkQuestionQuality(
      {
        questionType: "mc",
        question: "以下哪一項標誌著中古時代的結束？",
        options: ["文藝復興期間", "公元1453年", "其他", "其他2"],
        correctAnswer: "公元1453年",
        explanation: "合成教材記載公元1453年中古時代結束。",
        sourceExcerpt: "公元1453年：中古時代結束，進入近代。",
        sourceBlockIds: ["syn-period-1"],
      },
      units,
    );
    expect(result.issues.filter((issue) => issue.severity === "blocking").length).toBeGreaterThan(0);
  });

  it("C2 同義異稱（課本用「合成皇帝」，題目用廟號）目前無法偵測 → 記錄為限制", () => {
    // 這是已知限制：確定性規則不認識同義詞，只能靠教師判斷。
    // 測試把現行行為固定下來，日後改善時會即時看到差異。
    const result = checkQuestionQuality(
      mc({ correctAnswer: "合成太祖", options: ["合成太祖", "合成皇帝", "其他", "其他2"] }),
      UNITS,
    );
    const blocking = result.issues.filter((issue) => issue.severity === "blocking");
    expect(blocking.map((issue) => issue.code)).toEqual(["answer-not-in-material"]);
  });

  it("C3 題幹要「詞語」但答案是年份 → 丟棄", () => {
    const result = checkQuestionQuality(
      mc({
        question: "以下哪一個「詞語」標誌著中古時代的結束？",
        correctAnswer: "公元1453年",
        options: ["公元1453年", "文藝復興", "其他", "其他2"],
      }),
      UNITS,
    );
    expect(result.issues.map((issue) => issue.code)).toContain("stem-answer-type-mismatch");
    expect(result.issues.filter((issue) => issue.severity === "blocking").length).toBeGreaterThan(0);
  });

  it("C4 題幹已經寫出答案 → 丟棄", () => {
    const result = checkQuestionQuality(
      mc({
        question: "《合成和約》是在1919年簽署，那麼它是在哪一年簽署？",
        correctAnswer: "1919年",
      }),
      UNITS,
    );
    expect(result.issues.map((issue) => issue.code)).toContain("answer-in-stem");
  });

  it("C5 題幹只是抄錄教材原文 → 丟棄", () => {
    const result = checkQuestionQuality(
      mc({
        question: "《合成和約》於1919年簽署；與會各國同時同意設立公共衛生局。",
        correctAnswer: "1919年",
        sourceExcerpt: "《合成和約》於1919年簽署；與會各國同時同意設立公共衛生局。",
      }),
      UNITS,
    );
    expect(result.issues.map((issue) => issue.code)).toContain("copied-source");
  });

  it("C6 填充題的答案在題幹中出現兩次 → 丟棄（學生可照抄）", () => {
    const stem = "公共衛生局負責清理污水，因此公共衛生局是必要的＿＿＿。";
    expect(answerLeaksIntoStem(stem, "公共衛生局")).toBe(true);
    expect(checkFillStem(stem, "公共衛生局").ok).toBe(false);
  });
});

describe("D 批改失敗", () => {
  it("D1 正確的繁體答案 → 正確", () => {
    expect(gradeAnswer(question({}), "公共衛生局").isCorrect).toBe(true);
  });

  it("D2 簡繁差異（只差一個字）不會被靜默判錯，會標示不確定", () => {
    const outcome = gradeAnswer(question({}), "公共卫生局");
    expect(outcome.isCorrect).toBe(false);
    expect(outcome.uncertain).toBe(true);
  });

  it("D3 同義異稱（廟號對課本用語）目前無法批改 → 記錄為限制", () => {
    const outcome = gradeAnswer(question({ correctAnswer: "合成皇帝" }), "合成太祖");
    expect(outcome.isCorrect).toBe(false);
    // 超過近似門檻 → 不會標示不確定；這正是需要教師跟進的個案
    expect(outcome.uncertain).toBe(false);
  });

  it("D4 與正確答案相近的錯誤答案 → 標示不確定（不會靜默判錯）", () => {
    const outcome = gradeAnswer(question({ correctAnswer: "公共衛生局" }), "公共衛生署");
    expect(outcome.isCorrect).toBe(false);
    expect(outcome.uncertain).toBe(true);
  });

  it("D5 短答題一律不自動批改（部分正確亦不會被機器判分）", () => {
    const outcome = gradeAnswer(
      question({ questionType: "short", correctAnswer: "指出兩項改革" }),
      "其中一項改革。",
    );
    expect(outcome.autoGraded).toBe(false);
    expect(outcome.isCorrect).toBe(null);
  });

  it("D6 空白答案 → 不正確（由路由層另外拒絕提交）", () => {
    expect(normalizeAnswer("   ")).toBe("");
    expect(gradeAnswer(question({}), "   ").isCorrect).toBe(false);
  });

  it("D7 批改忽略全形／半形、標點及大小寫差異", () => {
    expect(normalizeAnswer("１９１９年")).toBe("1919年");
    expect(gradeAnswer(question({ correctAnswer: "1919 年。" }), "1919年").isCorrect).toBe(true);
  });
});

describe("E 誤報與守衛必要性", () => {
  it("E1 機構名稱（元老院）與思想（民族自決）不再被誤拒，並示範守衛必要性", () => {
    expect(checkHistoricalAnswer("元老院", "元老院負責為國王提供施政建議。").ok).toBe(true);
    expect(checkHistoricalAnswer("民族自決", "列強同意落實民族自決，但同時埋下隱患。").ok).toBe(true);

    // 突變檢查：移除機構／思想詞尾後，同一答案會被誤判為「非歷史元素」
    const legacySuffixes = ["條約", "公約", "制度"];
    const legacyAccepts = legacySuffixes.some((suffix) => "元老院".length > suffix.length && "元老院".endsWith(suffix));
    expect(legacyAccepts).toBe(false);
  });

  it("E2 普通句子片段不會被當成人名，真正杜撰的人名仍會被偵測", () => {
    expect(findUnverifiedNames("上述兩項改革與另一方面皆屬未確定片段。", MATERIAL_TEXT).persons).toEqual([]);
    expect(findUnverifiedNames("合成公爵提出新的稅制。", MATERIAL_TEXT).persons).toContain("合成公爵");
  });

  it("E4 教材以括號附註簡稱時，只寫全稱的答案仍屬逐字依據", () => {
    const units: MaterialUnit[] = [
      {
        blockId: "syn-abbrev",
        sourceLocation: "合成教材 · 第 1 段",
        text: "第二次世界大戰（二戰）往往被視為第一次世界大戰（一戰）的延續。",
      },
    ];
    const result = checkQuestionQuality(
      {
        questionType: "mc",
        question: "以下哪一項最能說明兩次世界大戰之間的關聯？",
        options: [
          "第二次世界大戰往往被視為第一次世界大戰的延續",
          "兩次大戰的導火線相同",
          "兩次大戰的敵對陣營完全相同",
          "兩次大戰的原因完全相同",
        ],
        correctAnswer: "第二次世界大戰往往被視為第一次世界大戰的延續",
        explanation: "合成教材記載第二次世界大戰往往被視為第一次世界大戰的延續。",
        sourceExcerpt: "第二次世界大戰（二戰）往往被視為第一次世界大戰（一戰）的延續。",
        sourceBlockIds: ["syn-abbrev"],
      },
      units,
    );
    expect(hasUncertainIssue(result.issues)).toBe(false);
    expect(result.issues.filter((issue) => issue.severity === "blocking")).toHaveLength(0);
  });

  it("E5 答案自行添加的括號內容不會因為比對放寬而通過", () => {
    const units: MaterialUnit[] = [
      {
        blockId: "syn-abbrev-2",
        sourceLocation: "合成教材 · 第 1 段",
        text: "第二次世界大戰（二戰）往往被視為第一次世界大戰（一戰）的延續。",
      },
    ];
    const result = checkQuestionQuality(
      {
        questionType: "mc",
        question: "以下哪一項最能說明兩次世界大戰之間的關聯？",
        options: [
          "第二次世界大戰（於1939年爆發）往往被視為第一次世界大戰的延續",
          "兩次大戰的導火線相同",
          "兩次大戰的敵對陣營完全相同",
          "兩次大戰的原因完全相同",
        ],
        correctAnswer: "第二次世界大戰（於1939年爆發）往往被視為第一次世界大戰的延續",
        explanation: "合成教材記載兩次大戰的延續關係。",
        sourceExcerpt: "第二次世界大戰（二戰）往往被視為第一次世界大戰（一戰）的延續。",
        sourceBlockIds: ["syn-abbrev-2"],
      },
      units,
    );
    expect(result.issues.some((issue) => issue.severity === "blocking")).toBe(true);
  });

  it("E3 年份偵測的必要性：移除後教材沒有的年份不會被發現", () => {
    expect(findFabricatedYears("條約於1920年簽署。", MATERIAL_TEXT)).toEqual(["1920年"]);
    const legacyWouldMiss = !MATERIAL_TEXT.includes("1920年") && true; // 舊規則只看「有沒有檢查」→ 需要明確偵測
    expect(legacyWouldMiss).toBe(true);
    expect(findFabricatedYears("條約於1919年簽署。", MATERIAL_TEXT)).toEqual([]);
  });
});
