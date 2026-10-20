/**
 * 「解釋未達標可選擇暫緩派發」政策測試。
 *
 * 驗證的契約：
 *   1. 預設 **off**：行為完全維持現狀（不影響任何題目）。
 *   2. `placeholder`：只暫緩解釋為空白／佔位文字的題目。
 *   3. `placeholder-or-answer-only`：佔位及只列答案都暫緩。
 *   4. 無效設定回退 `off`，並產生 error 級設定警示（打錯字不會令題目意外全部停止派發）。
 *   5. 政策是產品決定，不是品質判斷：分類本身不會改動任何題目。
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { questionSchema, type Question } from "@/lib/types";

import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("explanation-hold");
delete process.env.K_SERVICE;
delete process.env.EXPLANATION_HOLD_POLICY;

type PracticeService = typeof import("@/server/services/practice-service");
type Config = typeof import("@/server/config");
type Diagnostics = typeof import("@/server/config-diagnostics");

let practice: PracticeService;
let config: Config;
let diagnostics: Diagnostics;

beforeAll(async () => {
  practice = await import("@/server/services/practice-service");
  config = await import("@/server/config");
  diagnostics = await import("@/server/config-diagnostics");
});

afterEach(() => {
  delete process.env.EXPLANATION_HOLD_POLICY;
});

function question(
  id: string,
  explanation: string,
  overrides: Partial<{ correctAnswer: string }> = {},
): Question {
  return questionSchema.parse({
    id,
    topicId: "topic-1",
    sectionId: "topic-1-paleolithic",
    questionType: "fill",
    difficulty: "basic",
    question: "＿＿＿是文字出現前，沒有文字紀錄的時期。",
    options: [],
    correctAnswer: overrides.correctAnswer ?? "史前時期",
    acceptedAnswers: [],
    explanation,
    knowledgePoint: "A. 石器時代的演進",
    sourceExcerpt: "＿＿＿是文字出現前，沒有文字紀錄的時期。",
    sourceLocation: "校內試題 · 第 1 題",
    sourceBlockIds: [],
    gradingPoints: [],
    origin: "school-paper",
    status: "published",
    sourceVerified: false,
    qualityWarnings: [],
    skill: null,
    revision: 1,
    createdAt: new Date().toISOString(),
  });
}

const PLACEHOLDER = question("q-placeholder", "答案依校內試題檔的評卷參考。");
const ANSWER_ONLY = question("q-answer-only", "史前時期");
const GOOD = question(
  "q-good",
  "因為史前時期沒有人類文字紀錄，所以歷史學家稱這段時期為史前時期。",
);

describe("EXPLANATION_HOLD_POLICY 設定", () => {
  it("未設定時預設為 off", () => {
    expect(config.getServerConfig().explanationHoldPolicy).toBe("off");
  });

  it("接受合法的政策值", () => {
    process.env.EXPLANATION_HOLD_POLICY = "placeholder";
    expect(config.getServerConfig().explanationHoldPolicy).toBe("placeholder");
    process.env.EXPLANATION_HOLD_POLICY = "placeholder-or-answer-only";
    expect(config.getServerConfig().explanationHoldPolicy).toBe(
      "placeholder-or-answer-only",
    );
  });

  it("無效值回退 off，並產生 error 級設定警示", () => {
    process.env.EXPLANATION_HOLD_POLICY = "placeholder-typo";
    expect(config.getServerConfig().explanationHoldPolicy).toBe("off");
    const issue = diagnostics
      .describeConfigIssues()
      .find((item) => item.code === "explanation-hold-policy-invalid");
    expect(issue?.level).toBe("error");
  });

  it("啟用政策時產生 warning 級設定警示（說明影響範圍）", () => {
    process.env.EXPLANATION_HOLD_POLICY = "placeholder-or-answer-only";
    const issue = diagnostics
      .describeConfigIssues()
      .find((item) => item.code === "explanation-hold-policy-active");
    expect(issue?.level).toBe("warning");
    expect(issue?.message).toContain("沒有題目可練習");
  });
});

describe("filterByExplanationPolicy", () => {
  it("off 時完全不影響題目（維持現行行為）", () => {
    const result = practice.filterByExplanationPolicy([PLACEHOLDER, ANSWER_ONLY, GOOD], "off");
    expect(result).toHaveLength(3);
  });

  it("placeholder 只暫緩佔位解釋", () => {
    const result = practice.filterByExplanationPolicy([PLACEHOLDER, ANSWER_ONLY, GOOD], "placeholder");
    expect(result.map((item) => item.id)).toEqual(["q-answer-only", "q-good"]);
  });

  it("placeholder-or-answer-only 同時暫緩佔位及只列答案", () => {
    const result = practice.filterByExplanationPolicy(
      [PLACEHOLDER, ANSWER_ONLY, GOOD],
      "placeholder-or-answer-only",
    );
    expect(result.map((item) => item.id)).toEqual(["q-good"]);
  });

  it("不會改動題目內容（只回傳過濾後的陣列）", () => {
    const input = [PLACEHOLDER, ANSWER_ONLY, GOOD];
    const snapshot = JSON.parse(JSON.stringify(input)) as unknown;
    practice.filterByExplanationPolicy(input, "placeholder-or-answer-only");
    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
  });
});
