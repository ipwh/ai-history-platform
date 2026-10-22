import { describe, expect, it } from "vitest";

import {
  learnerAccuracyLabel,
  practiceAccuracy,
  practiceTopicLabel,
  topicBadge,
} from "../src/lib/practice-summary";

describe("練習累計答對比率", () => {
  it("完全沒有作答時為 null（介面顯示「—」）", () => {
    expect(practiceAccuracy([])).toBeNull();
    expect(practiceAccuracy([{ answeredQuestions: 0, correctAnswers: 0 }])).toBeNull();
  });

  it("以所有練習作答計算，包括題庫以外的 AI 即時生成題目", () => {
    // 只練習 AI 即時生成的題目時，題庫進度為 0，但答對比率仍有數值。
    expect(practiceAccuracy([{ answeredQuestions: 3, correctAnswers: 2 }])).toBe(67);
    expect(
      practiceAccuracy([
        { answeredQuestions: 2, correctAnswers: 1 },
        { answeredQuestions: 2, correctAnswers: 2 },
      ]),
    ).toBe(75);
  });
});

describe("課題卡狀態標示", () => {
  it("未作答時顯示「尚未開始」", () => {
    const badge = topicBadge("not-started", 0);
    expect(badge.label).toBe("尚未開始");
    expect(badge.tone).toBe("muted");
  });

  it("已作答但題庫進度為 0 時顯示「練習中」，不會誤標為尚未開始", () => {
    const badge = topicBadge("not-started", 35);
    expect(badge.label).toBe("練習中");
    expect(badge.tone).toBe("accent");
    expect(badge.hint).toContain("AI 即時生成");
  });

  it("其餘狀態沿用學習進度的標示", () => {
    expect(topicBadge("in-progress", 2).label).toBe("進行中");
    expect(topicBadge("needs-review", 2).tone).toBe("warning");
    expect(topicBadge("repeatedly-demonstrated", 2).label).toBe("已多次答對");
  });
});

describe("課題顯示名稱", () => {
  it("高中課題加上主題，避免與初中同名課題混淆", () => {
    expect(
      practiceTopicLabel({ title: "課題1：香港的現代化與蛻變", level: 4, curriculumTheme: "A" }),
    ).toBe("高中・主題甲｜課題1：香港的現代化與蛻變");
    expect(
      practiceTopicLabel({ title: "課題4：主要衝突與和平的訴求", level: 4, curriculumTheme: "B" }),
    ).toContain("主題乙");
    expect(
      practiceTopicLabel({ title: "課題1：人類的需要：古與今", level: 1, curriculumTheme: null }),
    ).toBe("課題1：人類的需要：古與今");
  });
});

describe("教師端答對比率欄位", () => {
  it("未作答時顯示「未作答」而不是「—」", () => {
    expect(learnerAccuracyLabel({ answeredQuestions: 0, accuracy: null })).toBe("未作答");
  });

  it("已作答但沒有可評分答案時顯示「未評分」", () => {
    expect(learnerAccuracyLabel({ answeredQuestions: 1, accuracy: null })).toBe("未評分");
  });

  it("有數值時顯示百分比", () => {
    expect(learnerAccuracyLabel({ answeredQuestions: 3, accuracy: 0.6667 })).toBe("67%");
  });
});
