import { describe, expect, it, vi } from "vitest";

import {
  conservativeCostMicro,
  isUsagePlausible,
  parseJournal,
  runTutorEvaluation,
  usdToMicro,
  type TutorEvalCallResult,
  type TutorEvalCaseRecord,
  type TutorEvalCaseSpec,
  type TutorEvalPricing,
  type TutorEvalTransport,
} from "@/server/quality/tutor-eval-engine";

/**
 * Sprint 32 的成本安全審計：只用本機 mock transport，**不連接任何真實供應商**。
 *
 * 每個測試都核對：實際呼叫次數、重試次數、已花金額、已完成／失敗／未執行案例、
 * 以及「不會超支」。這些是引擎的決策證據，不是模型行為證據。
 */

const PRICING: TutorEvalPricing = {
  inputUsdPerMillion: 0.28,
  outputUsdPerMillion: 2.5,
  source: "測試用定價（非真實價格）",
};

function cases(count: number, overrides: Partial<TutorEvalCaseSpec> = {}): TutorEvalCaseSpec[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `live-${String(index + 1).padStart(2, "0")}`,
    maxOutputTokens: 2_000,
    estimatedInputTokens: 6_000,
    ...overrides,
  }));
}

function mockTransport(
  handler: (caseId: string, attempt: number) => TutorEvalCallResult,
): TutorEvalTransport & { calls: string[] } {
  const calls: string[] = [];
  return {
    name: "mock",
    provider: "deepseek",
    model: "deepseek-flash",
    calls,
    async call(request) {
      calls.push(`${request.caseId}#${request.attempt}`);
      return handler(request.caseId, request.attempt);
    },
  };
}

const OK: TutorEvalCallResult = {
  ok: true,
  answer: "模擬回覆。",
  usage: { inputTokens: 4_800, outputTokens: 900 },
};

const perCaseCostMicro = conservativeCostMicro(cases(1)[0]!, PRICING);

function budgetFor(caseCount: number, multiplier = 1.2): number {
  return (perCaseCostMicro * caseCount * multiplier) / 1_000_000;
}

describe("1. 正常完成 12 個案例", () => {
  it("12 次呼叫、0 次重試、全部成功、不超支", async () => {
    const transport = mockTransport(() => OK);
    const result = await runTutorEvaluation({
      cases: cases(12),
      transport,
      pricing: PRICING,
      budgetUsd: budgetFor(12),
    });

    expect(result.status).toBe("completed");
    expect(result.calls).toBe(12);
    expect(result.retries).toBe(0);
    expect(result.records.filter((record) => record.status === "ok")).toHaveLength(12);
    expect(result.notRunCases).toHaveLength(0);
    expect(result.spentMicro).toBeLessThanOrEqual(result.budgetMicro);
    expect(transport.calls).toHaveLength(12);
    // 用量可信 → 記為實際用量，不需標示 unknown
    expect(result.records.every((record) => record.costBasis === "actual-usage")).toBe(true);
    expect(result.costUnknownCases).toHaveLength(0);
  });
});

describe("2. 第 3 個案例失敗（不可重試錯誤）", () => {
  it("該案失敗、其餘繼續、呼叫次數正確", async () => {
    const transport = mockTransport((caseId) =>
      caseId === "live-03" ? { ok: false, errorCode: "invalid-response", usage: null } : OK,
    );
    const result = await runTutorEvaluation({
      cases: cases(5),
      transport,
      pricing: PRICING,
      budgetUsd: budgetFor(5),
    });

    expect(result.calls).toBe(5);
    expect(result.retries).toBe(0);
    expect(result.records.find((record) => record.caseId === "live-03")?.status).toBe("failed");
    expect(result.records.filter((record) => record.status === "ok")).toHaveLength(4);
    expect(result.status).toBe("completed");
  });
});

describe("3. 第 3 個案例 timeout", () => {
  it("timeout 視為結果不確定：不重試、立即停止整批（避免重複付費）", async () => {
    const transport = mockTransport((caseId) =>
      caseId === "live-03"
        ? { ok: false, errorCode: "timeout", outcomeUncertain: true, usage: null }
        : OK,
    );
    const result = await runTutorEvaluation({
      cases: cases(6),
      transport,
      pricing: PRICING,
      budgetUsd: budgetFor(6),
    });

    expect(result.status).toBe("stopped-uncertain");
    // 前兩條成功 + 第三條一次 → 共 3 次，第三條**沒有**重試
    expect(result.calls).toBe(3);
    expect(result.retries).toBe(0);
    expect(transport.calls.filter((call) => call.startsWith("live-03"))).toHaveLength(1);
    expect(result.records.find((record) => record.caseId === "live-03")?.outcomeUncertain).toBe(
      true,
    );
    // 其餘案例標為未執行，不會被當成成功
    expect(result.notRunCases).toEqual(["live-04", "live-05", "live-06"]);
  });
});

describe("4. 第 3 個案例返回 429", () => {
  it("429 可重試一次；重試成功後繼續", async () => {
    const transport = mockTransport((caseId, attempt) =>
      caseId === "live-03" && attempt === 1 ? { ok: false, errorCode: "rate-limited" } : OK,
    );
    const result = await runTutorEvaluation({
      cases: cases(4),
      transport,
      pricing: PRICING,
      budgetUsd: budgetFor(4, 1.6),
    });

    expect(result.calls).toBe(5);
    expect(result.retries).toBe(1);
    expect(result.records.find((record) => record.caseId === "live-03")?.status).toBe("ok");
    expect(result.records.find((record) => record.caseId === "live-03")?.attempts).toBe(2);
    expect(result.status).toBe("completed");
  });
});

describe("5. 第 3 個案例返回 500", () => {
  it("500 重試一次仍失敗 → 該案失敗，其餘繼續", async () => {
    const transport = mockTransport((caseId) =>
      caseId === "live-03" ? { ok: false, errorCode: "server-error" } : OK,
    );
    const result = await runTutorEvaluation({
      cases: cases(4),
      transport,
      pricing: PRICING,
      budgetUsd: budgetFor(4, 1.6),
    });

    expect(result.retries).toBe(1);
    expect(result.calls).toBe(5);
    const third = result.records.find((record) => record.caseId === "live-03");
    expect(third?.status).toBe("failed");
    expect(third?.attempts).toBe(2);
    expect(result.records.filter((record) => record.status === "ok")).toHaveLength(3);
  });
});

describe("6／7. retry 後成功與 retry 後仍失敗", () => {
  it("第 2 次嘗試成功：attempts=2、retries=1", async () => {
    const transport = mockTransport((_caseId, attempt) =>
      attempt === 1 ? { ok: false, errorCode: "server-error" } : OK,
    );
    const result = await runTutorEvaluation({
      cases: cases(2),
      transport,
      pricing: PRICING,
      budgetUsd: budgetFor(2, 2),
    });
    expect(result.records[0]?.status).toBe("ok");
    expect(result.records[0]?.attempts).toBe(2);
    expect(result.retries).toBe(2); // 兩條案例各重試一次
    expect(result.calls).toBe(4);
  });

  it("永不成功的重試不會無限循環（最多 2 次嘗試）", async () => {
    const transport = mockTransport(() => ({ ok: false, errorCode: "server-error" }));
    const result = await runTutorEvaluation({
      cases: cases(1),
      transport,
      pricing: PRICING,
      budgetUsd: budgetFor(1, 5),
    });
    expect(result.calls).toBe(2);
    expect(result.retries).toBe(1);
    expect(result.records[0]?.status).toBe("failed");
  });
});

describe("8. 預算在第 3 個案例後不足", () => {
  it("在第 4 條**呼叫前**停止，未超出預算", async () => {
    // 用「無用量」令每條成本等於保守上限，預算剛好夠 3 條（×1.05）。
    const budget = (perCaseCostMicro * 3 * 1.05) / 1_000_000;
    const transport = mockTransport(() => ({ ok: true, answer: "回覆", usage: null }));
    const result = await runTutorEvaluation({
      cases: cases(6),
      transport,
      pricing: PRICING,
      budgetUsd: budget,
    });

    expect(result.status).toBe("stopped-budget");
    expect(result.calls).toBe(3);
    expect(transport.calls).toHaveLength(3);
    expect(result.spentMicro).toBeLessThanOrEqual(result.budgetMicro);
    expect(result.notRunCases).toEqual(["live-04", "live-05", "live-06"]);
    expect(result.records.filter((record) => record.status === "not-run")).toHaveLength(3);
  });

  it("呼叫前的預算檢查以保守上限計算（實際用量較低時仍永不超支）", async () => {
    // 實際用量遠低於上限 → 可以跑多過「預算／上限」的條數，但總額仍不超過上限。
    const budget = (perCaseCostMicro * 3 * 1.05) / 1_000_000;
    const transport = mockTransport(() => OK);
    const result = await runTutorEvaluation({
      cases: cases(6),
      transport,
      pricing: PRICING,
      budgetUsd: budget,
    });
    expect(result.spentMicro).toBeLessThanOrEqual(result.budgetMicro);
    expect(result.calls).toBeGreaterThanOrEqual(3);
    // 每一條的實際成本都低於上限，且從未用「實際較低」去繞過上限檢查
    expect(result.records.every((record) => record.costMicro <= perCaseCostMicro)).toBe(true);
  });

  it("預算連第一條都不夠時完全不發出呼叫", async () => {
    const transport = mockTransport(() => OK);
    const result = await runTutorEvaluation({
      cases: cases(3),
      transport,
      pricing: PRICING,
      budgetUsd: 0.000001,
    });
    expect(result.calls).toBe(0);
    expect(transport.calls).toHaveLength(0);
    expect(result.notRunCases).toHaveLength(3);
  });
});

describe("9. token usage 缺失", () => {
  it("沒有用量 → 以上限估算並標示 costUnknown，不會當成零成本", async () => {
    const transport = mockTransport(() => ({ ok: true, answer: "回覆", usage: null }));
    const result = await runTutorEvaluation({
      cases: cases(2),
      transport,
      pricing: PRICING,
      budgetUsd: budgetFor(2),
    });

    expect(result.costUnknownCases).toEqual(["live-01", "live-02"]);
    expect(result.records.every((record) => record.costBasis === "conservative-ceiling")).toBe(true);
    expect(result.records.every((record) => record.costUnknown)).toBe(true);
    // 成本不是 0（否則預算就形同虛設）
    expect(result.spentMicro).toBeGreaterThan(0);
  });
});

describe("10. provider 回報異常 token usage", () => {
  it.each([
    ["負數", { inputTokens: -1, outputTokens: 100 }],
    ["零輸出", { inputTokens: 100, outputTokens: 0 }],
    ["超出上限兩倍", { inputTokens: 100, outputTokens: 99_999 }],
    ["輸入暴增", { inputTokens: 9_999_999, outputTokens: 100 }],
    ["null 欄位", { inputTokens: null, outputTokens: 100 }],
  ])("%s 的用量不可信 → 以上限估算", (_label, usage) => {
    const spec = cases(1)[0]!;
    expect(isUsagePlausible(usage as { inputTokens: number | null; outputTokens: number | null }, spec)).toBe(
      false,
    );
  });

  it("異常用量不會令記帳歸零或爆升", async () => {
    const transport = mockTransport(() => ({
      ok: true,
      answer: "回覆",
      usage: { inputTokens: 0, outputTokens: 0 },
    }));
    const result = await runTutorEvaluation({
      cases: cases(2),
      transport,
      pricing: PRICING,
      budgetUsd: budgetFor(2),
    });
    expect(result.spentMicro).toBe(perCaseCostMicro * 2);
    expect(result.costUnknownCases).toHaveLength(2);
  });
});

describe("11. 輸出檔已存在（journal 由呼叫端寫入，引擎只回呼）", () => {
  it("每完成一條即回呼一次，順序與案例一致", async () => {
    const written: string[] = [];
    const transport = mockTransport(() => OK);
    await runTutorEvaluation({
      cases: cases(3),
      transport,
      pricing: PRICING,
      budgetUsd: budgetFor(3),
      onCaseComplete: (record: TutorEvalCaseRecord) => written.push(record.caseId),
    });
    expect(written).toEqual(["live-01", "live-02", "live-03"]);
  });
});

describe("12. 執行中斷後重新啟動", () => {
  it("已完成的案例不會重跑，只補做未完成的", async () => {
    const previous: TutorEvalCaseRecord[] = [
      {
        caseId: "live-01",
        status: "ok",
        attempts: 1,
        answer: "已完成",
        errorCode: null,
        outcomeUncertain: false,
        usage: { inputTokens: 4_800, outputTokens: 900 },
        costMicro: 1_000,
        costBasis: "actual-usage",
        costUnknown: false,
        startedAt: "2026-11-07T00:00:00Z",
        completedAt: "2026-11-07T00:00:01Z",
      },
    ];
    const transport = mockTransport(() => OK);
    const result = await runTutorEvaluation({
      cases: cases(3),
      transport,
      pricing: PRICING,
      budgetUsd: budgetFor(3),
      previous,
    });

    // 只有 live-02 及 live-03 重新呼叫
    expect(transport.calls).toEqual(["live-02#1", "live-03#1"]);
    expect(result.calls).toBe(2);
    expect(result.records.filter((record) => record.status === "ok")).toHaveLength(3);
  });

  it("上次有未確定結果時，未經明確確認一律拒絕執行", async () => {
    const previous: TutorEvalCaseRecord[] = [
      {
        caseId: "live-01",
        status: "failed",
        attempts: 1,
        answer: null,
        errorCode: "timeout",
        outcomeUncertain: true,
        usage: null,
        costMicro: 500,
        costBasis: "conservative-ceiling",
        costUnknown: true,
        startedAt: "2026-11-07T00:00:00Z",
        completedAt: "2026-11-07T00:00:30Z",
      },
    ];
    const transport = mockTransport(() => OK);
    const refused = await runTutorEvaluation({
      cases: cases(2),
      transport,
      pricing: PRICING,
      budgetUsd: budgetFor(2),
      previous,
    });
    expect(refused.status).toBe("refused");
    expect(refused.refusalReason).toContain("不確定");
    expect(transport.calls).toHaveLength(0);

    const allowed = await runTutorEvaluation({
      cases: cases(2),
      transport,
      pricing: PRICING,
      budgetUsd: budgetFor(2),
      previous,
      confirmUncertainResume: true,
    });
    expect(allowed.status).toBe("completed");
    expect(transport.calls).toHaveLength(2);
  });
});

describe("13. 相同案例重複執行（journal 重複行）", () => {
  it("parseJournal 保留所有行，引擎以最後狀態為準時不會重複呼叫成功案例", async () => {
    const journal = [
      JSON.stringify({ caseId: "live-01", status: "failed", attempts: 2 }),
      JSON.stringify({ caseId: "live-01", status: "ok", attempts: 1 }),
      "{ 不完整的行",
    ].join("\n");
    const parsed = parseJournal(journal);
    expect(parsed.records).toHaveLength(2);
    expect(parsed.truncatedLines).toBe(1);
  });

  it("案例 ID 重複時拒絕執行（結果無法對應教師矩陣）", async () => {
    const transport = mockTransport(() => OK);
    const result = await runTutorEvaluation({
      cases: [
        { id: "live-01", maxOutputTokens: 1_000, estimatedInputTokens: 1_000 },
        { id: "live-01", maxOutputTokens: 1_000, estimatedInputTokens: 1_000 },
      ],
      transport,
      pricing: PRICING,
      budgetUsd: 1,
    });
    expect(result.status).toBe("refused");
    expect(result.refusalReason).toContain("重複");
    expect(transport.calls).toHaveLength(0);
  });
});

describe("14. 使用者指定超過 20 個案例", () => {
  it("硬上限由 clampCaseCount 施加（引擎只按收到的清單執行）", async () => {
    const { clampCaseCount } = await import("../scripts/tutor-live-eval");
    expect(clampCaseCount(500)).toBe(20);
    // 引擎本身不靜默截斷：超過上限必須在 CLI 層攔截，否則會超支
    const transport = mockTransport(() => OK);
    const result = await runTutorEvaluation({
      cases: cases(21),
      transport,
      pricing: PRICING,
      budgetUsd: budgetFor(21),
    });
    expect(result.calls).toBe(21);
  });
});

describe("15. 授權條件缺少其中一項", () => {
  it("既有授權閘門在缺條件時不放行（回歸）", async () => {
    const { liveCallAuthorization } = await import("../scripts/tutor-live-eval");
    const plan = {
      promptVersion: "test",
      model: "m",
      provider: "p",
      caseCount: 1,
      callsPerCase: 1,
      totalCalls: 1,
      maxOutputTokensPerCall: 1,
      maxTotalOutputTokens: 1,
      estimatedCostUsdCeiling: 0.01,
      costEstimateUnavailable: null,
      estimatedInputTokensPerCall: 6_000,
      pricingSource: "test",
      timeoutMs: 1,
      retryPolicy: "test",
      privacy: "test",
      authorizationRequired: [],
      cases: [],
    };
    expect(liveCallAuthorization({ apply: false, allowance: null, budgetUsd: null }, plan).allowed).toBe(
      false,
    );
  });

  it("定價缺少來源時引擎拒絕執行（不可用猜測價格作預算）", async () => {
    const transport = mockTransport(() => OK);
    const result = await runTutorEvaluation({
      cases: cases(1),
      transport,
      pricing: { ...PRICING, source: "   " },
      budgetUsd: 1,
    });
    expect(result.status).toBe("refused");
    expect(transport.calls).toHaveLength(0);
  });
});

describe("16. provider／model 與批准設定不一致", () => {
  it("transport 宣告的 provider／model 由呼叫端比對（引擎回傳實際值供核對）", async () => {
    const transport = mockTransport(() => OK);
    const approved = { provider: "deepseek", model: "deepseek-flash" };
    const actual = { provider: transport.provider, model: transport.model };
    expect(actual).toEqual(approved);

    const mismatched = mockTransport(() => OK);
    Object.defineProperty(mismatched, "model", { value: "other-model" });
    expect({ provider: mismatched.provider, model: mismatched.model }).not.toEqual(approved);
  });
});

describe("成本計算：輸入與輸出都計入", () => {
  it("保守上限包含輸入 token（不是只看輸出）", () => {
    const spec: TutorEvalCaseSpec = {
      id: "x",
      maxOutputTokens: 2_000,
      estimatedInputTokens: 6_000,
    };
    const inputOnly = (6_000 / 1_000_000) * PRICING.inputUsdPerMillion;
    const outputOnly = (2_000 / 1_000_000) * PRICING.outputUsdPerMillion;
    const total = conservativeCostMicro(spec, PRICING);
    expect(total).toBe(Math.ceil(usdToMicro(inputOnly) + usdToMicro(outputOnly)));
    expect(total).toBeGreaterThan(Math.ceil(usdToMicro(outputOnly)));
  });

  it("實際用量計費低於上限（正常情況）", async () => {
    const transport = mockTransport(() => OK);
    const result = await runTutorEvaluation({
      cases: cases(1),
      transport,
      pricing: PRICING,
      budgetUsd: budgetFor(1),
    });
    expect(result.records[0]?.costMicro).toBeLessThan(perCaseCostMicro);
    expect(result.spentMicro).toBe(result.records[0]?.costMicro);
  });

  it("浮點累加不會造成超出預算（整數 micro-USD）", async () => {
    const transport = mockTransport(() => ({ ok: true, answer: "x", usage: null }));
    const exactBudget = (perCaseCostMicro * 3) / 1_000_000;
    const result = await runTutorEvaluation({
      cases: cases(5),
      transport,
      pricing: PRICING,
      budgetUsd: exactBudget,
    });
    expect(result.spentMicro).toBeLessThanOrEqual(result.budgetMicro);
    expect(result.calls).toBe(3);
  });
});

describe("數據庫與私隱：引擎不可能寫入", () => {
  it("引擎模組不 import 資料庫或任何 provider 模組", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/server/quality/tutor-eval-engine.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/from ".*db\/connection"/);
    expect(source).not.toMatch(/from ".*repositories\//);
    expect(source).not.toMatch(/from ".*llm\//);
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/node:sqlite/);
  });

  it("引擎不會把答案寫入資料庫或學生對話（只回傳紀錄）", async () => {
    const transport = mockTransport(() => OK);
    const spy = vi.fn();
    const result = await runTutorEvaluation({
      cases: cases(1),
      transport,
      pricing: PRICING,
      budgetUsd: budgetFor(1),
      onCaseComplete: spy,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.records[0]?.answer).toBe("模擬回覆。");
  });
});
