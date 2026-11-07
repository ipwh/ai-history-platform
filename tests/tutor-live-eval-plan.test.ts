import { describe, expect, it } from "vitest";

import { liveCallAuthorization, type LiveEvalPlan } from "../scripts/tutor-live-eval";

const PLAN: LiveEvalPlan = {
  promptVersion: "test",
  model: "test-model",
  provider: "deepseek",
  caseCount: 12,
  callsPerCase: 1,
  totalCalls: 12,
  maxOutputTokensPerCall: 900,
  maxTotalOutputTokens: 10_800,
  estimatedCostUsdCeiling: 0.03,
  costEstimateUnavailable: null,
  estimatedInputTokensPerCall: 6_000,
  pricingSource: "test",
  timeoutMs: 30_000,
  retryPolicy: "test",
  privacy: "test",
  authorizationRequired: [],
  cases: [],
};

describe("受控模型評估：授權閘門（fail closed）", () => {
  it("缺少任何一項授權條件都不會呼叫模型", () => {
    const noApply = liveCallAuthorization(
      { apply: false, allowance: "1", budgetUsd: 1 },
      PLAN,
    );
    expect(noApply.allowed).toBe(false);
    expect(noApply.missing).toContain("--apply");

    const noAllowance = liveCallAuthorization(
      { apply: true, allowance: null, budgetUsd: 1 },
      PLAN,
    );
    expect(noAllowance.allowed).toBe(false);
    expect(noAllowance.missing).toContain("TUTOR_EVAL_ALLOW_LIVE_CALLS=1");

    const noBudget = liveCallAuthorization(
      { apply: true, allowance: "1", budgetUsd: null },
      PLAN,
    );
    expect(noBudget.allowed).toBe(false);
    expect(noBudget.missing).toContain("--budget-usd");
  });

  it("預算低於計劃上限時拒絕執行", () => {
    const result = liveCallAuthorization(
      { apply: true, allowance: "1", budgetUsd: 0.01 },
      PLAN,
    );
    expect(result.allowed).toBe(false);
    expect(result.missing.join(" ")).toContain("不足");
  });

  it("三項條件齊備且預算足夠時才會放行", () => {
    const result = liveCallAuthorization(
      { apply: true, allowance: "1", budgetUsd: 0.05 },
      PLAN,
    );
    expect(result.allowed).toBe(true);
    expect(result.missing).toHaveLength(0);
  });
});
