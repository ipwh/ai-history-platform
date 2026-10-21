/**
 * 題目內容修正（題幹錯字／答案明顯有誤）的界線。
 *
 * 背景：2026-10-21 逐題核對時發現三處內容錯誤（兩處題幹錯字、一處答案與史實不符）。
 * 這類修正會改動 `question` 或 `correct_answer`，因此必須 fail-closed：
 *   1. 現值與紀錄不符即拒絕（不覆蓋其他人的修改）；
 *   2. 修正後仍不可作答即拒絕；
 *   3. 可重複執行（已修正的題目回報「已是最新」）。
 */
import { describe, expect, it } from "vitest";

import { planQuestionContentFix } from "@/server/services/question-content-fix";
import type { Question } from "@/lib/types";

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "qb-test-1",
    topicId: "topic-5",
    sectionId: "section-1",
    questionType: "fill",
    difficulty: "basic",
    question: "＿＿＿在「九十五條論證」批評教會出售贖罪券，抨擊教會及教士的腐章運動。",
    options: [],
    correctAnswer: "馬丁路德",
    acceptedAnswers: [],
    explanation: "馬丁路德於1517年提出九十五條論證，抨擊教會出售贖罪券及教士腐敗，促成宗教改革。",
    knowledgePoint: "宗教改革",
    sourceExcerpt: "",
    sourceLocation: "",
    sourceBlockIds: [],
    gradingPoints: [],
    origin: "school-paper",
    status: "published",
    sourceVerified: false,
    qualityWarnings: [],
    skill: null,
    revision: 5,
    autoValidatedAt: null,
    autoValidatedRevision: null,
    autoValidatedFingerprint: null,
    teacherConfirmationRequired: false,
    createdAt: "2026-10-20T00:00:00.000Z",
    ...overrides,
  };
}

const STEM_FIX = {
  from: "＿＿＿在「九十五條論證」批評教會出售贖罪券，抨擊教會及教士的腐章運動。",
  to: "＿＿＿在「九十五條論證」批評教會出售贖罪券，抨擊教會及教士的腐敗。",
};

describe("planQuestionContentFix", () => {
  it("修正題幹錯字", () => {
    const plan = planQuestionContentFix(makeQuestion(), {
      questionId: "qb-test-1",
      reason: "「腐章運動」為匯入時的漏字黏連，原意為「腐敗」。",
      question: STEM_FIX,
    });
    expect(plan.status).toBe("planned");
    expect(plan.newQuestion).toBe(STEM_FIX.to);
  });

  it("現值與紀錄不符時拒絕（不覆蓋其他人的修改）", () => {
    const plan = planQuestionContentFix(makeQuestion({ question: "已經被別人改過的題幹" }), {
      questionId: "qb-test-1",
      reason: "「腐章運動」為匯入時的漏字黏連，原意為「腐敗」。",
      question: STEM_FIX,
    });
    expect(plan.status).toBe("conflict");
    expect(plan.newQuestion).toBeNull();
  });

  it("答案現值與紀錄不符時拒絕", () => {
    const plan = planQuestionContentFix(makeQuestion(), {
      questionId: "qb-test-1",
      reason: "區域市政局1986年才成立，1983年的答案應只有市政局。",
      correctAnswer: { from: "市政局與區域市政局", to: "市政局" },
    });
    expect(plan.status).toBe("conflict");
  });

  it("修正答案為單一空格後仍可作答", () => {
    const plan = planQuestionContentFix(
      makeQuestion({
        question: "1983年，＿＿＿舉行首次分區直接選舉，選民資格與區議會相同。",
        correctAnswer: "市政局與區域市政局",
      }),
      {
        questionId: "qb-test-1",
        reason: "區域市政局1986年才成立，1983年的答案應只有市政局。",
        correctAnswer: { from: "市政局與區域市政局", to: "市政局" },
      },
    );
    expect(plan.status).toBe("planned");
    expect(plan.newCorrectAnswer).toBe("市政局");
  });

  it("修正會令題目不可作答時拒絕", () => {
    const plan = planQuestionContentFix(makeQuestion(), {
      questionId: "qb-test-1",
      reason: "測試：把答案改成充滿空格標記的字串。",
      correctAnswer: { from: "馬丁路德", to: "＿＿＿" },
    });
    expect(plan.status).toBe("unservable");
  });

  it("已經修正過的題目回報已是最新（可重複執行）", () => {
    const plan = planQuestionContentFix(makeQuestion({ question: STEM_FIX.to }), {
      questionId: "qb-test-1",
      reason: "「腐章運動」為匯入時的漏字黏連，原意為「腐敗」。",
      question: STEM_FIX,
    });
    expect(plan.status).toBe("already-applied");
  });

  it("沒有理由時拒絕", () => {
    const plan = planQuestionContentFix(makeQuestion(), {
      questionId: "qb-test-1",
      reason: "改",
      question: STEM_FIX,
    });
    expect(plan.status).toBe("conflict");
  });

  it("找不到題目時拒絕", () => {
    const plan = planQuestionContentFix(null, {
      questionId: "qb-missing",
      reason: "「腐章運動」為匯入時的漏字黏連，原意為「腐敗」。",
      question: STEM_FIX,
    });
    expect(plan.status).toBe("missing");
  });

  it("修正與答案矛盾的選項", () => {
    const plan = planQuestionContentFix(
      makeQuestion({
        questionType: "mc",
        question: "下列哪項是有關冷戰的正確描述？",
        options: ["冷戰期間，美國與蘇聯爆發了軍事衝突。", "冷戰期間，美國與蘇聯結成同盟。"],
        correctAnswer: "冷戰期間，美國與蘇聯結成同盟。",
        sourceExcerpt: "",
      }),
      {
        questionId: "qb-test-1",
        reason: "教材指美蘇各自組成敵對陣營，選項「結成同盟」與教材矛盾，改為錯誤敘述後答案才唯一。",
        options: {
          from: ["冷戰期間，美國與蘇聯爆發了軍事衝突。", "冷戰期間，美國與蘇聯結成同盟。"],
          to: ["冷戰期間，美國與蘇聯爆發了軍事衝突。", "冷戰期間，美國與蘇聯各自組成聯盟並主導國際政治。"],
        },
        correctAnswer: {
          from: "冷戰期間，美國與蘇聯結成同盟。",
          to: "冷戰期間，美國與蘇聯各自組成聯盟並主導國際政治。",
        },
      },
    );
    expect(plan.status).toBe("planned");
    expect(plan.newOptions?.[1]).toContain("各自組成聯盟");
    expect(plan.newCorrectAnswer).toContain("各自組成聯盟");
  });

  it("修正後答案不在選項中即拒絕", () => {
    const plan = planQuestionContentFix(
      makeQuestion({
        questionType: "mc",
        question: "下列哪項正確？",
        options: ["甲", "乙"],
        correctAnswer: "甲",
      }),
      {
        questionId: "qb-test-1",
        reason: "測試：把答案改成不在選項中的文字，必須被拒絕。",
        correctAnswer: { from: "甲", to: "丙" },
      },
    );
    expect(plan.status).toBe("unservable");
  });

  it("修正可接受答案及解釋", () => {
    const plan = planQuestionContentFix(
      makeQuestion({ acceptedAnswers: [], explanation: "舊解釋。" }),
      {
        questionId: "qb-test-1",
        reason: "教材作「加百列」，基伯爾是同名異譯；解釋改為教材用語。",
        acceptedAnswers: { from: [], to: ["基伯爾"] },
        explanation: { from: "舊解釋。", to: "天使加百列向穆罕默德顯現，傳遞真主阿拉的啟示。" },
      },
    );
    expect(plan.status).toBe("planned");
    expect(plan.newAcceptedAnswers).toEqual(["基伯爾"]);
    expect(plan.newExplanation).toContain("加百列");
  });

  it("解釋不可改為空白", () => {
    const plan = planQuestionContentFix(makeQuestion({ explanation: "舊解釋。" }), {
      questionId: "qb-test-1",
      reason: "測試：把解釋清空必須被拒絕，避免發布沒有解釋的題目。",
      explanation: { from: "舊解釋。", to: "   " },
    });
    expect(plan.status).toBe("conflict");
  });

  it("全部欄位已是修正值時回報已是最新", () => {
    const plan = planQuestionContentFix(
      makeQuestion({ acceptedAnswers: ["基伯爾"], explanation: "新解釋。" }),
      {
        questionId: "qb-test-1",
        reason: "重複執行同一修正清單時應為 no-op。",
        acceptedAnswers: { from: [], to: ["基伯爾"] },
        explanation: { from: "舊解釋。", to: "新解釋。" },
      },
    );
    expect(plan.status).toBe("already-applied");
  });
});
