import { describe, expect, it } from "vitest";

import { questionSchema, type Question } from "@/lib/types";
import { calculateAccuracy, gradeAnswer, normalizeAnswer } from "@/server/services/grading";

function buildQuestion(overrides: Partial<Question>): Question {
  return questionSchema.parse({
    id: "q1",
    topicId: "topic-5",
    sectionId: "topic-5-renaissance",
    questionType: "mc",
    difficulty: "basic",
    question: "測試題目內容",
    options: ["選項甲", "選項乙"],
    correctAnswer: "選項甲",
    explanation: "解釋",
    knowledgePoint: "知識點",
    sourceExcerpt: "教材節錄內容",
    sourceLocation: "測試位置",
    origin: "demo",
    status: "published",
    sourceVerified: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  });
}

describe("答案正規化", () => {
  it("忽略空白、標點及大小寫，並支援全角字元", () => {
    expect(normalizeAnswer("　因信稱義。 ")).toBe("因信稱義");
    expect(normalizeAnswer("ＡＢＣ")).toBe("abc");
  });
});

describe("自動評分", () => {
  it("選擇題只接受選項文字", () => {
    const question = buildQuestion({});
    expect(gradeAnswer(question, "選項甲").isCorrect).toBe(true);
    expect(gradeAnswer(question, "選項乙").isCorrect).toBe(false);
    expect(gradeAnswer(question, "甲").isCorrect).toBe(false);
  });

  it("填充題接受可替換寫法並忽略標點", () => {
    const question = buildQuestion({
      questionType: "fill",
      options: [],
      correctAnswer: "封建",
      acceptedAnswers: ["封建社會"],
      question: "＿＿＿社會逐漸瓦解",
    });
    expect(gradeAnswer(question, "封建").isCorrect).toBe(true);
    expect(gradeAnswer(question, "封建社會。").isCorrect).toBe(true);
    expect(gradeAnswer(question, "奴隸").isCorrect).toBe(false);
  });

  it("空白答案一律視為答錯", () => {
    const question = buildQuestion({});
    expect(gradeAnswer(question, "   ").isCorrect).toBe(false);
  });

  it("填充題接受標準答案內以「/」列出的同義寫法", () => {
    const question = buildQuestion({
      questionType: "fill",
      options: [],
      correctAnswer: "路德宗 / 信義宗",
      question: "宗教改革後，追隨馬丁路德的教會稱為＿＿＿。",
    });
    expect(gradeAnswer(question, "路德宗").isCorrect).toBe(true);
    expect(gradeAnswer(question, "信義宗").isCorrect).toBe(true);
    expect(gradeAnswer(question, "加爾文宗").isCorrect).toBe(false);
  });

  it("以一點領導符（․）排版的答案，學生以「·」輸入亦視為相同", () => {
    const question = buildQuestion({
      questionType: "fill",
      options: [],
      correctAnswer: "尤利烏斯․ 凱撒",
      question: "公元前60年，＿＿＿成功控制羅馬。",
    });
    expect(gradeAnswer(question, "尤利烏斯·凱撒").isCorrect).toBe(true);
    expect(gradeAnswer(question, "尤利烏斯凱撒").isCorrect).toBe(true);
    expect(gradeAnswer(question, "凱撒").isCorrect).toBe(false);
  });

  it("選擇題不會因為答案含「/」而被拆成多個正確選項", () => {
    const question = buildQuestion({
      options: ["X光 / 射線", "紅外線"],
      correctAnswer: "X光 / 射線",
    });
    expect(gradeAnswer(question, "X光 / 射線").isCorrect).toBe(true);
    expect(gradeAnswer(question, "X光").isCorrect).toBe(false);
  });

  it("正確率只計可自動評分的題目", () => {
    expect(calculateAccuracy(3, 5)).toBe(0.6);
    expect(calculateAccuracy(0, 0)).toBeNull();
  });
});

/**
 * 無法可靠判斷的填充題答案（可能是錯別字或未列出的可接受寫法）不應被當成錯誤，
 * 亦不可自動當成正確：分數不變，但標示為需要教師覆核。
 */
describe("填充題的近似答案標示為不確定", () => {
  const fill = (correctAnswer: string, acceptedAnswers: string[] = []) =>
    buildQuestion({
      questionType: "fill",
      options: [],
      correctAnswer,
      acceptedAnswers,
      question: "＿＿＿是文藝復興的核心思想。",
    });

  it("少一個字的答案標示為不確定，但不會當成正確", () => {
    const outcome = gradeAnswer(fill("九十五條論證"), "九十五論證");
    expect(outcome.isCorrect).toBe(false);
    expect(outcome.uncertain).toBe(true);
  });

  it("多一個字的答案同樣標示為不確定", () => {
    const outcome = gradeAnswer(fill("馬丁路德"), "馬丁路德氏");
    expect(outcome.isCorrect).toBe(false);
    expect(outcome.uncertain).toBe(true);
  });

  it("錯別字（同位置一字之差）標示為不確定", () => {
    const outcome = gradeAnswer(fill("文藝復興"), "文藝復與");
    expect(outcome.isCorrect).toBe(false);
    expect(outcome.uncertain).toBe(true);
  });

  it("真正錯誤的答案不會標示為不確定", () => {
    const outcome = gradeAnswer(fill("馬丁路德"), "加爾文");
    expect(outcome.isCorrect).toBe(false);
    expect(outcome.uncertain).toBe(false);
  });

  it("長度差距大的答案不會標示為不確定（避免把補充說明當成同一答案）", () => {
    const outcome = gradeAnswer(fill("馬丁路德"), "馬丁路德與加爾文同屬宗教改革人物");
    expect(outcome.uncertain).toBe(false);
  });

  it("正確答案及可接受寫法不受影響", () => {
    expect(gradeAnswer(fill("封建", ["封建社會"]), "封建").uncertain).toBeUndefined();
    expect(gradeAnswer(fill("封建", ["封建社會"]), "封建社會").uncertain).toBeUndefined();
  });

  it("選擇題不會標示為不確定", () => {
    const question = buildQuestion({});
    expect(gradeAnswer(question, "選項乙").uncertain).toBeUndefined();
  });
});
