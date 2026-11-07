/**
 * 供應商定價記錄（Sprint 33）。
 *
 * ── 為甚麼要寫成程式常數而不是命令行參數 ──────────────────────────────
 * Sprint 31／32 的教訓：把價格留給操作者輸入，結果兩次都用「假設價格」做預算，
 * 一次漏算輸入 token、一次把示例價格當成實際價格。這裡把**已查證的官方價格**
 * 固定下來，並附上來源及查證日期；如價格變動，必須更新此檔並重跑測試。
 *
 * ── 官方價格（DeepSeek API Docs「Models & Pricing」）──────────────────
 * 來源：https://api-docs.deepseek.com/quick_start/pricing
 * 查證日期：2026-11-07
 * 模型：`deepseek-flash`（由 DeepSeek-V4.1-Flash-1017 提供）
 *
 * | 類別 | 離峰（元／1M） | 高峰（元／1M） |
 * | --- | --- | --- |
 * | 輸入（快取命中） | 0.02 | 0.04 |
 * | 輸入（快取未命中） | 1 | 2 |
 * | 輸出 | 4 | 8 |
 *
 * 官方頁面以**人民幣（元）**計價，並註明「空閒時段價格為高峰時段價格的一半」。
 *
 * ── 為甚麼要換算成美元 ────────────────────────────────────────────────
 * 本專案的預算上限以美元表示。匯率屬外部假設，因此：
 *   - 使用 **6.5 元／美元**（比近期市場水平更強的人民幣），令換算出的美元成本**偏高**，
 *     即保守方向；
 *   - 一律採用**高峰時段**價格（較貴），並用**快取未命中**（較貴）的輸入價；
 *   - 不假設任何快取命中折扣。
 * 三項都偏向高估，因此實際帳單應低於本估算。
 */

export interface ProviderPricing {
  provider: string;
  model: string;
  /** 官方定價頁 */
  sourceUrl: string;
  /** 查證日期（ISO） */
  checkedAt: string;
  /** 官方原始貨幣 */
  currency: "CNY";
  /** 原始價格（元／百萬 token，高峰時段、快取未命中） */
  official: {
    inputCacheMissPerMillion: number;
    inputCacheHitPerMillion: number;
    outputPerMillion: number;
  };
  /** 換算用的匯率（1 美元 = N 元） */
  cnyPerUsd: number;
  /** 換算後的美元價格（每百萬 token），供 `tutor-eval-engine` 使用 */
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  notes: string[];
}

export const DEEPSEEK_FLASH_PRICING: ProviderPricing = {
  provider: "deepseek",
  model: "deepseek-flash",
  sourceUrl: "https://api-docs.deepseek.com/quick_start/pricing",
  checkedAt: "2026-11-07",
  currency: "CNY",
  official: {
    inputCacheMissPerMillion: 2,
    inputCacheHitPerMillion: 0.04,
    outputPerMillion: 8,
  },
  cnyPerUsd: 6.5,
  // 高峰時段、快取未命中（最貴情況）
  inputUsdPerMillion: 2 / 6.5,
  outputUsdPerMillion: 8 / 6.5,
  notes: [
    "官方價格以人民幣計，本檔以 1 美元 = 6.5 元保守換算（人民幣較強 → 美元成本高估）。",
    "採用高峰時段價格；離峰時段為一半。",
    "採用快取未命中輸入價；實際若有快取命中會更便宜。",
    "未計入 Search／Fetch API（每 1,000 次成功請求 US$0.75）：評估不使用該等工具。",
  ],
};

/** 依指定模型取得已查證的定價；不支援的模型一律拋錯（不可用猜測價格）。 */
export function pricingForModel(model: string): ProviderPricing {
  if (model === DEEPSEEK_FLASH_PRICING.model) return DEEPSEEK_FLASH_PRICING;
  throw new Error(
    `模型 ${model} 沒有已查證的官方定價記錄；請先更新 scripts/lib/provider-pricing.ts 並附上來源與查證日期。`,
  );
}
