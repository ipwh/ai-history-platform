import { describe, expect, it } from "vitest";

import { DEEPSEEK_FLASH_PRICING, pricingForModel } from "../scripts/lib/provider-pricing";
import { buildCaseSpecs } from "../scripts/tutor-live-eval";
import { computeCeilingUsd } from "../scripts/tutor-live-eval";
import { LIVE_EVAL_DATASET } from "./fixtures/tutor-live-eval-dataset";

/**
 * Sprint 33：定價與預算上限的契約測試。
 *
 * 目的：把「12 條案例的成本上限」固定在測試裡，令任何改動（模型、token 上限、
 * 匯率假設、價格）都會立即被發現，而不是在下一次執行時才超支。
 */
describe("供應商定價記錄", () => {
  it("附有官方來源及查證日期", () => {
    expect(DEEPSEEK_FLASH_PRICING.sourceUrl).toBe(
      "https://api-docs.deepseek.com/quick_start/pricing",
    );
    expect(DEEPSEEK_FLASH_PRICING.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(DEEPSEEK_FLASH_PRICING.notes.length).toBeGreaterThan(0);
  });

  it("美元價格由官方人民幣價格按記錄的匯率換算（可重算）", () => {
    const { official, cnyPerUsd } = DEEPSEEK_FLASH_PRICING;
    expect(DEEPSEEK_FLASH_PRICING.inputUsdPerMillion).toBeCloseTo(
      official.inputCacheMissPerMillion / cnyPerUsd,
      10,
    );
    expect(DEEPSEEK_FLASH_PRICING.outputUsdPerMillion).toBeCloseTo(
      official.outputPerMillion / cnyPerUsd,
      10,
    );
  });

  it("採用高峰時段（較貴）價格，而非離峰", () => {
    // 離峰是高峰的一半；若誤用離峰，輸出價會是 4 元而不是 8 元
    expect(DEEPSEEK_FLASH_PRICING.official.outputPerMillion).toBe(8);
    expect(DEEPSEEK_FLASH_PRICING.official.inputCacheMissPerMillion).toBe(2);
  });

  it("未查證的模型一律拋錯（不可用猜測價格）", () => {
    expect(() => pricingForModel("deepseek-v4-pro")).toThrowError(/沒有已查證的官方定價/);
    expect(pricingForModel("deepseek-flash")).toBe(DEEPSEEK_FLASH_PRICING);
  });
});

describe("12 條案例的成本上限（Sprint 33 批准的 US$0.10）", () => {
  const APPROVED_BUDGET_USD = 0.1;

  it("輸入與輸出 token 上限都已計入", () => {
    const specs = buildCaseSpecs(LIVE_EVAL_DATASET.length, 6_000);
    const totalOutput = specs.reduce((sum, spec) => sum + spec.maxOutputTokens, 0);
    const totalInput = specs.reduce((sum, spec) => sum + spec.estimatedInputTokens, 0);
    expect(specs).toHaveLength(12);
    expect(totalOutput).toBe(17_000);
    expect(totalInput).toBe(72_000);
  });

  it("保守上限不超過批准的 US$0.10", () => {
    const specs = buildCaseSpecs(LIVE_EVAL_DATASET.length, 6_000);
    const ceiling = computeCeilingUsd(specs, {
      inputUsdPerMillion: DEEPSEEK_FLASH_PRICING.inputUsdPerMillion,
      outputUsdPerMillion: DEEPSEEK_FLASH_PRICING.outputUsdPerMillion,
      source: DEEPSEEK_FLASH_PRICING.sourceUrl,
    });
    // 記錄實際數字，令日後改動一眼看到影響
    expect(ceiling).toBeGreaterThan(0.03);
    expect(ceiling).toBeLessThanOrEqual(APPROVED_BUDGET_USD);
    expect(ceiling).toBeCloseTo(0.0431, 3);
  });

  it("最壞情況（全部標準差 1 次重試）仍不超過上限的兩倍", () => {
    // 20 次 HTTP attempts 的硬上限：12 條 + 最多 8 次重試（引擎每案最多 2 次嘗試）
    const specs = buildCaseSpecs(LIVE_EVAL_DATASET.length, 6_000);
    const single = computeCeilingUsd(specs, {
      inputUsdPerMillion: DEEPSEEK_FLASH_PRICING.inputUsdPerMillion,
      outputUsdPerMillion: DEEPSEEK_FLASH_PRICING.outputUsdPerMillion,
      source: DEEPSEEK_FLASH_PRICING.sourceUrl,
    });
    expect(single * 2).toBeLessThan(APPROVED_BUDGET_USD);
  });
});
