/**
 * 教師端「學習者」清單的班級與排序規則。
 *
 * 驗證：
 *   1. 班別（`1A`）可取出班級（`1`），未列入名冊者為 null。
 *   2. 選單按班級 → 班別 → 班號排列；班號以數值比較（10 不會排在 9 之前）。
 *   3. 沒有班別的學習者排在最後，不會混在班別之間。
 */
import { describe, expect, it } from "vitest";

import { compareLearnersByClass, formLevelLabel, formLevelOf } from "@/lib/learner-ordering";
import type { PracticeRecordLearner } from "@/lib/types";

function learner(
  partial: Partial<PracticeRecordLearner> & { learnerId: string },
): PracticeRecordLearner {
  return {
    lastAt: "",
    sessions: 0,
    answeredQuestions: 0,
    correctCount: 0,
    accuracy: null,
    name: null,
    className: null,
    studentNumber: null,
    email: null,
    ...partial,
  };
}

describe("班級（form level）", () => {
  it("由班別取出班級", () => {
    expect(formLevelOf("1A")).toBe("1");
    expect(formLevelOf(" 6D ")).toBe("6");
    expect(formLevelOf("")).toBeNull();
    expect(formLevelOf(null)).toBeNull();
  });

  it("班級顯示為中一至中六", () => {
    expect(formLevelLabel("1")).toBe("中一");
    expect(formLevelLabel("6")).toBe("中六");
    expect(formLevelLabel("7")).toBe("7 級");
  });
});

describe("學習者選單的排序", () => {
  it("先班級、再班別、再以數值比較班號", () => {
    const learners = [
      learner({ learnerId: "b", className: "2A", studentNumber: "03", name: "乙" }),
      learner({ learnerId: "c", className: "1B", studentNumber: "02", name: "丙" }),
      learner({ learnerId: "d", className: "1A", studentNumber: "10", name: "丁" }),
      learner({ learnerId: "e", className: "1A", studentNumber: "9", name: "戊" }),
      learner({ learnerId: "a", className: "1A", studentNumber: "01", name: "甲" }),
    ];

    const order = learners.sort(compareLearnersByClass).map((item) => item.learnerId);

    expect(order).toEqual(["a", "e", "d", "c", "b"]);
  });

  it("沒有班別的學習者排在最後", () => {
    const learners = [
      learner({ learnerId: "unlisted", name: "匿名", email: "x@pochiu.edu.hk" }),
      learner({ learnerId: "in-class", className: "3C", studentNumber: "05", name: "陳大文" }),
    ];

    expect(learners.sort(compareLearnersByClass).map((item) => item.learnerId)).toEqual([
      "in-class",
      "unlisted",
    ]);
  });

  it("同班同號時以顯示名稱排序，排序結果不會因輸入次序而改變", () => {
    const learners = [
      learner({ learnerId: "y", className: "1A", studentNumber: "07", name: "黃" }),
      learner({ learnerId: "z", className: "1A", studentNumber: "07", name: "張" }),
    ];

    const forward = learners.map((item) => item.learnerId);
    const backward = [...learners].reverse().map((item) => item.learnerId);
    expect([...learners].sort(compareLearnersByClass).map((item) => item.learnerId)).toEqual(
      [...[...learners].reverse()].sort(compareLearnersByClass).map((item) => item.learnerId),
    );
    expect(forward).not.toEqual(backward);
  });
});
