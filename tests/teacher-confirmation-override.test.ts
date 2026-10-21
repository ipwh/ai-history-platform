/**
 * 擁有者授權解除「待教師確認」標記（2026-10-21）。
 *
 * 背景：18 題校內試題草稿因「原題多個空格、平台只有一個輸入框」被品質閘門暫緩，
 * 擁有者指示全部發布。這裡守住三條界線：
 *   1. 沒有理由 → 拒絕（決定必須可追溯）；
 *   2. 不可作答（例如答案黏連了下一題文字）→ 拒絕，不會因為決定檔而變成可派發；
 *   3. 答案修正必須與決定檔記錄的現值一致，否則拒絕（避免覆蓋其他人的修改）。
 */
import { describe, expect, it } from "vitest";

import {
  overrideResolutionNote,
  planTeacherConfirmationOverride,
} from "@/server/services/teacher-confirmation-override";
import type { Question } from "@/lib/types";

const DECIDED_ON = "2026-10-21";

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "qb-test-1",
    topicId: "topic-9",
    sectionId: "section-1",
    questionType: "fill",
    difficulty: "basic",
    question: "擁有軍事優勢的國家變得＿＿＿，傾向以戰爭解決紛爭。",
    options: [],
    correctAnswer: "好戰",
    acceptedAnswers: [],
    explanation: "軍備競賽加深列強敵意，自恃軍力的國家更傾向以武力解決爭端，令戰爭風險上升。",
    knowledgePoint: "軍備競賽",
    sourceExcerpt: "",
    sourceLocation: "",
    sourceBlockIds: [],
    gradingPoints: [],
    origin: "school-paper",
    status: "draft",
    sourceVerified: false,
    qualityWarnings: ["原題有 2 個空格；考核空格由第 1 個改為第 2 個。"],
    skill: null,
    revision: 3,
    autoValidatedAt: null,
    autoValidatedRevision: null,
    autoValidatedFingerprint: null,
    teacherConfirmationRequired: true,
    createdAt: "2026-10-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("planTeacherConfirmationOverride", () => {
  it("解除標記時保留原暫緩理由並附上決定紀錄", () => {
    const question = makeQuestion();
    const plan = planTeacherConfirmationOverride(
      question,
      { questionId: question.id, reason: "題幹只有一個空格，答案與題幹一致且歷史正確。" },
      DECIDED_ON,
    );

    expect(plan.status).toBe("planned");
    expect(plan.clearHold).toBe(true);
    expect(plan.updateWarnings).toBe(true);
    expect(plan.newCorrectAnswer).toBeNull();
    expect(plan.warnings).toHaveLength(2);
    expect(plan.warnings[0]).toBe(question.qualityWarnings[0]);
    expect(plan.warnings[1]).toBe(
      overrideResolutionNote(DECIDED_ON, "題幹只有一個空格，答案與題幹一致且歷史正確。"),
    );
  });

  it("重複執行為幂等（已是最新狀態）", () => {
    const reason = "題幹只有一個空格，答案與題幹一致。";
    const first = planTeacherConfirmationOverride(
      makeQuestion(),
      { questionId: "qb-test-1", reason },
      DECIDED_ON,
    );
    const second = planTeacherConfirmationOverride(
      makeQuestion({
        qualityWarnings: first.warnings,
        teacherConfirmationRequired: false,
      }),
      { questionId: "qb-test-1", reason },
      DECIDED_ON,
    );

    expect(first.status).toBe("planned");
    expect(second.status).toBe("already-applied");
    expect(second.clearHold).toBe(false);
    expect(second.updateWarnings).toBe(false);
  });

  it("沒有足夠理由時拒絕", () => {
    const plan = planTeacherConfirmationOverride(
      makeQuestion(),
      { questionId: "qb-test-1", reason: "好" },
      DECIDED_ON,
    );
    expect(plan.status).toBe("conflict");
    expect(plan.detail).toContain("理由");
  });

  it("找不到題目時拒絕", () => {
    const plan = planTeacherConfirmationOverride(
      null,
      { questionId: "qb-missing", reason: "題幹只有一個空格，答案與題幹一致。" },
      DECIDED_ON,
    );
    expect(plan.status).toBe("missing");
  });

  it("答案黏連令題目不可作答時拒絕，且不會寫入答案", () => {
    const plan = planTeacherConfirmationOverride(
      makeQuestion({
        question: "法國極端民族主義鼓吹報復德國，奪回在普法戰爭中失去的＿＿＿。",
        correctAnswer:
          "阿爾薩斯—洛林 1919年，第一次世界大戰的戰勝國召開______________，並與德國簽訂《______________條約》。 巴黎和會",
      }),
      {
        questionId: "qb-test-1",
        reason: "匯入時答案黏連了下一題的文字。",
      },
      DECIDED_ON,
    );
    expect(plan.status).toBe("unservable");
    expect(plan.newCorrectAnswer).toBeNull();
    expect(plan.clearHold).toBe(false);
  });

  it("修正破損答案後可通過可作答性檢查", () => {
    const plan = planTeacherConfirmationOverride(
      makeQuestion({
        question: "法國極端民族主義鼓吹報復德國，奪回在普法戰爭中失去的＿＿＿。",
        correctAnswer: "阿爾薩斯—洛林 1919年，第一次世界大戰的戰勝國召開______________",
      }),
      {
        questionId: "qb-test-1",
        reason: "匯入時答案黏連了下一題的文字。",
        correctAnswer: {
          from: "阿爾薩斯—洛林 1919年，第一次世界大戰的戰勝國召開______________",
          to: "阿爾薩斯—洛林",
        },
      },
      DECIDED_ON,
    );
    expect(plan.status).toBe("planned");
    expect(plan.newCorrectAnswer).toBe("阿爾薩斯—洛林");
    expect(plan.clearHold).toBe(true);
  });

  it("答案現值與決定檔記錄不同時拒絕（不覆蓋其他人的修改）", () => {
    const plan = planTeacherConfirmationOverride(
      makeQuestion({ correctAnswer: "好戰份子" }),
      {
        questionId: "qb-test-1",
        reason: "匯入時答案黏連了下一題的文字。",
        correctAnswer: { from: "好戰", to: "好戰" },
      },
      DECIDED_ON,
    );
    expect(plan.status).toBe("conflict");
    expect(plan.newCorrectAnswer).toBeNull();
  });

  it("沒有品質警告時不需改寫警告欄位", () => {
    const plan = planTeacherConfirmationOverride(
      makeQuestion({ qualityWarnings: [] }),
      { questionId: "qb-test-1", reason: "題幹只有一個空格，答案與題幹一致。" },
      DECIDED_ON,
    );
    expect(plan.status).toBe("planned");
    expect(plan.updateWarnings).toBe(false);
    expect(plan.clearHold).toBe(true);
  });
});
