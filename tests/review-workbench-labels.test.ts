import { describe, expect, it } from "vitest";

import {
  ALL_SERVABILITY_DECISIONS,
  GOLDEN_CATEGORY_LABELS,
  GOLDEN_DECISIONS,
  QUEUE_META,
  REASON_CHIPS,
  SERVABILITY_DECISIONS,
  SERVABILITY_REASON_TEXT,
  SERVABILITY_SECONDARY_DECISIONS,
  composeReason,
  decisionMeta,
  servabilityReasonText,
} from "@/lib/review-workbench-labels";

/**
 * 這些測試守住「簡化版工作台」的兩條界線：
 * 1. 畫面文字不會洩漏內部術語（老師看不懂）；
 * 2. 按鈕背後的裁決值與既有 API 完全一致（不可以因為改 UI 而改變裁決含義）。
 */
const API_DECISION_VALUES = [
  "return_to_draft",
  "keep_quarantined",
  "request_more_evidence",
  "reject",
  "approve_after_verified_repair",
];

const ISSUE_CODES = [
  "MISSING_ANSWER",
  "FILL_NO_BLANK",
  "FILL_MULTI_BLANK",
  "FILL_ANSWER_TOO_LONG",
  "FILL_ANSWER_CONTAINS_BLANK",
  "FILL_ANSWER_SENTENCE",
  "FILL_ANSWER_LEAKS",
  "MCQ_TOO_FEW_OPTIONS",
  "MCQ_EMPTY_OPTION",
  "MCQ_DUPLICATE_OPTION",
  "MCQ_ANSWER_NOT_IN_OPTIONS",
  "MCQ_ROMAN_LABEL_MISSING",
  "MCQ_ANSWER_LEAKS",
  "UNKNOWN",
];

const JARGON = [/provenance/i, /servability/i, /fixture/i, /fingerprint/i, /payload/i, /api/i, /null/i];

function expectReadable(text: string) {
  expect(text.trim().length).toBeGreaterThan(1);
  for (const pattern of JARGON) {
    expect(pattern.test(text), `不應出現內部術語：${text}`).toBe(false);
  }
}

describe("工作台按鈕與 API 裁決值", () => {
  it("每個主要決定都是 API 接受的值", () => {
    for (const entry of ALL_SERVABILITY_DECISIONS) {
      expect(API_DECISION_VALUES).toContain(entry.value);
    }
  });

  it("主畫面只放三個決定，其餘收在「其他決定」", () => {
    expect(SERVABILITY_DECISIONS).toHaveLength(3);
    expect(SERVABILITY_SECONDARY_DECISIONS.length).toBeGreaterThan(0);
    for (const entry of SERVABILITY_SECONDARY_DECISIONS) {
      expect(entry.secondary).toBe(true);
    }
  });

  it("不會預設任何決定，亦沒有預設核准", () => {
    expect(decisionMeta("")).toBeNull();
    expect(SERVABILITY_DECISIONS[0].value).not.toBe("approve_after_verified_repair");
  });

  it("每個決定都有老師看得明的按鈕文字與後果說明", () => {
    for (const entry of ALL_SERVABILITY_DECISIONS) {
      expect(entry.label.length).toBeGreaterThanOrEqual(3);
      expect(entry.effect.length).toBeGreaterThan(10);
      expectReadable(entry.effect);
    }
  });
});

describe("不可作答原因的白話說明", () => {
  it("每個系統原因代碼都有白話句子", () => {
    for (const code of ISSUE_CODES) {
      expect(SERVABILITY_REASON_TEXT[code]).toBeTruthy();
      expectReadable(SERVABILITY_REASON_TEXT[code]);
    }
  });

  it("未知或空白代碼不會顯示英文代碼", () => {
    for (const code of [null, undefined, "", "SOMETHING_NEW"]) {
      const text = servabilityReasonText(code);
      expect(text).toBe(SERVABILITY_REASON_TEXT.UNKNOWN);
      expectReadable(text);
    }
  });
});

describe("理由快速選項", () => {
  it("每一句都符合伺服器最少 5 個字的要求", () => {
    for (const chip of REASON_CHIPS) {
      expect(chip.trim().length).toBeGreaterThanOrEqual(5);
    }
  });

  it("不需要打字也能組成合法理由", () => {
    expect(composeReason([REASON_CHIPS[0]], "").length).toBeGreaterThanOrEqual(5);
  });

  it("多選理由與自由輸入以分號連接，並忽略空白", () => {
    expect(composeReason([REASON_CHIPS[0], REASON_CHIPS[1]], "補充說明")).toBe(
      `${REASON_CHIPS[0]}；${REASON_CHIPS[1]}；補充說明`,
    );
    expect(composeReason([], "   ")).toBe("");
    expect(composeReason(["  ", REASON_CHIPS[2]], "")).toBe(REASON_CHIPS[2]);
  });
});

describe("評分示例題（Golden）", () => {
  it("三個決定都是既有 API 接受的值", () => {
    expect(GOLDEN_DECISIONS.map((entry) => entry.value).sort()).toEqual([
      "approved",
      "rejected",
      "revision_requested",
    ]);
  });

  it("每個評估類別都有中文說明，畫面不會顯示英文代碼", () => {
    expect(Object.keys(GOLDEN_CATEGORY_LABELS).sort()).toEqual([
      "cause-consequence",
      "chronology",
      "comparison",
      "people",
      "plausible-distractors",
      "significance",
      "treaty",
    ]);
    for (const label of Object.values(GOLDEN_CATEGORY_LABELS)) {
      expect(label).toMatch(/[\u4e00-\u9fff]/);
    }
  });
});

describe("清單名稱與說明", () => {
  it("三個清單都有白話名稱與說明，且不含內部術語", () => {
    expect(Object.keys(QUEUE_META).sort()).toEqual(["golden", "provenance", "servability"]);
    for (const meta of Object.values(QUEUE_META)) {
      expectReadable(meta.label);
      expectReadable(meta.hint);
    }
  });
});
