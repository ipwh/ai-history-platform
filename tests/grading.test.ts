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

  it("空答案一律視為答錯", () => {
    const question = buildQuestion({});
    expect(gradeAnswer(question, "   ").isCorrect).toBe(false);
  });

  it("短答題不會自動評分", () => {
    const question = buildQuestion({
      questionType: "short",
      options: [],
      correctAnswer: "參考答案內容",
      gradingPoints: ["要點一"],
    });
    const outcome = gradeAnswer(question, "任何回答");
    expect(outcome.autoGraded).toBe(false);
    expect(outcome.isCorrect).toBeNull();
  });

  it("正確率只計可自動評分的題目", () => {
    expect(calculateAccuracy(3, 5)).toBe(0.6);
    expect(calculateAccuracy(0, 0)).toBeNull();
  });
});
