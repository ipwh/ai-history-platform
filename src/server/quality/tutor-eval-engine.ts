/**
 * 受控模型評估的執行引擎（Sprint 32）。
 *
 * ── 為甚麼要把它與 CLI 分開 ──────────────────────────────────────────
 * 「會不會超支、會不會重複付費、中斷後會不會重跑」這些問題必須能在**不呼叫模型**的
 * 情況下逐一測試。因此本模組只做決策與記帳：
 *   - 不 import 任何資料庫模組（不可能寫入 `data/app.db` 或學生紀錄）；
 *   - 不 import 任何 provider 或直接使用 `fetch`（不可能自行發出請求）；
 *   - 所有模型呼叫經由注入的 `TutorEvalTransport`，測試時注入 mock。
 *
 * 真正的 live transport **未有實作**，原因見 SPRINT 32 報告「執行路徑缺口」一節：
 * 學伴的串流呼叫目前內嵌在 `src/app/api/tutor/chat/route.ts`，沒有共用 client；
 * 依 Sprint 32 規格，不得為評估另寫一個 ad-hoc fetch provider。
 *
 * ── 為甚麼金額用整數 micro-USD ───────────────────────────────────────
 * 浮點累加 12 次後再比較預算會出現「看似剛好等於上限」的誤差；以 1e-6 美元為單位
 * 做整數運算，預算判斷才是精確的「不超過」。
 */

/** 1 美元 = 1,000,000 micro-USD */
export const MICRO_USD_PER_USD = 1_000_000;

export function usdToMicro(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) throw new Error(`不合理的美元金額：${usd}`);
  return Math.round(usd * MICRO_USD_PER_USD);
}

export function microToUsd(micro: number): number {
  return micro / MICRO_USD_PER_USD;
}

/**
 * 定價。**刻意沒有預設值**：不同模型、不同日期的價格不同，若在此硬編碼一個數字，
 * 預算上限就會建立在猜測之上。操作者必須按供應商當期公布價格填入，並在報告記錄來源。
 */
export interface TutorEvalPricing {
  /** 每百萬輸入 token 的美元價格 */
  inputUsdPerMillion: number;
  /** 每百萬輸出 token 的美元價格 */
  outputUsdPerMillion: number;
  /** 價格來源（例如「DeepSeek 官方定價頁，2026-11-07 查閱」） */
  source: string;
}

export interface TutorEvalCaseSpec {
  id: string;
  /** 該案實際會送出的 `max_tokens`（與路線封頂方式一致） */
  maxOutputTokens: number;
  /**
   * 保守輸入 token 上限（系統提示＋對話上文）。刻意用上限而非預估，
   * 因為輸入長度在組裝提示詞前無法準確得知。
   */
  estimatedInputTokens: number;
}

export type TutorEvalErrorCode =
  | "timeout"
  | "rate-limited"
  | "server-error"
  | "network"
  | "empty"
  | "invalid-response";

export interface TutorEvalCallUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface TutorEvalCallResult {
  ok: boolean;
  answer?: string | null;
  usage?: TutorEvalCallUsage | null;
  errorCode?: TutorEvalErrorCode;
  /** 供應商可能已處理請求，但本地沒有收到回覆（結果不確定） */
  outcomeUncertain?: boolean;
}

export interface TutorEvalCallRequest {
  caseId: string;
  maxOutputTokens: number;
  attempt: number;
}

/** 模型呼叫的注入點；測試注入 mock，正式執行由 live adapter 實作 */
export interface TutorEvalTransport {
  readonly name: string;
  readonly provider: string;
  readonly model: string;
  call(request: TutorEvalCallRequest): Promise<TutorEvalCallResult>;
}

export type TutorEvalCaseStatus = "ok" | "failed" | "not-run";

export type TutorEvalCostBasis = "actual-usage" | "conservative-ceiling" | "zero";

export interface TutorEvalCaseRecord {
  caseId: string;
  status: TutorEvalCaseStatus;
  attempts: number;
  answer: string | null;
  errorCode: TutorEvalErrorCode | null;
  outcomeUncertain: boolean;
  usage: TutorEvalCallUsage | null;
  costMicro: number;
  costBasis: TutorEvalCostBasis;
  /** 供應商沒有回報 token 用量 → 成本只能以上限估算 */
  costUnknown: boolean;
  startedAt: string;
  completedAt: string | null;
}

export type TutorEvalRunStatus =
  | "completed"
  | "stopped-budget"
  | "stopped-uncertain"
  | "refused";

export interface TutorEvalRunOptions {
  cases: readonly TutorEvalCaseSpec[];
  transport: TutorEvalTransport;
  pricing: TutorEvalPricing;
  /** 授權的美元上限 */
  budgetUsd: number;
  /** 上次執行留下的紀錄（用於 resume） */
  previous?: readonly TutorEvalCaseRecord[];
  /**
   * 上一次有不確定結果（供應商可能已收費）時，必須明確確認才可以繼續。
   * 預設 false：寧可停下來，也不要重複付費。
   */
  confirmUncertainResume?: boolean;
  /** 每完成一條即回呼（CLI 用於寫入 journal，令中斷後仍保留已完成案例） */
  onCaseComplete?: (record: TutorEvalCaseRecord) => void;
  /** 注入時鐘（測試用） */
  now?: () => string;
}

export interface TutorEvalRunResult {
  status: TutorEvalRunStatus;
  /** 拒絕執行的原因（`status === "refused"` 時） */
  refusalReason: string | null;
  records: TutorEvalCaseRecord[];
  /** 實際發出的呼叫次數（含重試） */
  calls: number;
  retries: number;
  spentMicro: number;
  budgetMicro: number;
  /** 供應商沒有回報用量、只能估上限的案例 */
  costUnknownCases: string[];
  /** 未執行（含因預算停止）的案例 */
  notRunCases: string[];
}

const MAX_ATTEMPTS_PER_CASE = 2;

/**
 * 供應商回報的 token 用量是否可信。
 *
 * 實測風險：某些代理／兼容實作會回傳 0、負數或明顯超過上限的數字。若照單全收，
 * 預算會被低估（0）或高估（超大值令整批停止）。不可信時一律以上限估算並標示
 * `costUnknown`，寧可保守。
 */
export function isUsagePlausible(
  usage: TutorEvalCallUsage | null | undefined,
  spec: TutorEvalCaseSpec,
): usage is TutorEvalCallUsage {
  if (usage === null || usage === undefined) return false;
  const { inputTokens, outputTokens } = usage;
  if (inputTokens === null || outputTokens === null) return false;
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return false;
  if (inputTokens < 0 || outputTokens < 0) return false;
  if (outputTokens === 0) return false;
  // 輸出不可能大幅超過請求的 max_tokens；輸入也不可能遠超保守上限。
  if (outputTokens > spec.maxOutputTokens * 2) return false;
  if (inputTokens > spec.estimatedInputTokens * 5) return false;
  return true;
}

/** 單次呼叫的保守成本上限：輸入上限＋輸出上限都按定價計算 */
export function conservativeCostMicro(
  spec: TutorEvalCaseSpec,
  pricing: TutorEvalPricing,
): number {
  const input = (spec.estimatedInputTokens / 1_000_000) * pricing.inputUsdPerMillion;
  const output = (spec.maxOutputTokens / 1_000_000) * pricing.outputUsdPerMillion;
  return Math.ceil(usdToMicro(input) + usdToMicro(output));
}

/** 依實際用量計費；用量不可信時回傳 null */
export function actualCostMicro(
  usage: TutorEvalCallUsage,
  pricing: TutorEvalPricing,
): number {
  const input = (usage.inputTokens ?? 0) / 1_000_000 * pricing.inputUsdPerMillion;
  const output = (usage.outputTokens ?? 0) / 1_000_000 * pricing.outputUsdPerMillion;
  return Math.ceil(usdToMicro(input) + usdToMicro(output));
}

function isRetryable(errorCode: TutorEvalErrorCode | undefined, uncertain: boolean): boolean {
  // 結果不確定（供應商可能已處理並收費）→ 不自動重試。
  if (uncertain) return false;
  return errorCode === "rate-limited" || errorCode === "server-error" || errorCode === "empty";
}

function defaultNow(): string {
  return new Date().toISOString();
}

/**
 * 執行（或重新執行）一批評估案例。
 *
 * 拒絕執行的情況（fail closed，不發出任何呼叫）：
 *   - 案例 ID 重複（會令結果無法對應教師矩陣）；
 *   - 定價缺來源或非正數；
 *   - 預算不足以支付第一條案例的保守上限；
 *   - 上次執行存在不確定結果而未有明確確認。
 */
export async function runTutorEvaluation(
  options: TutorEvalRunOptions,
): Promise<TutorEvalRunResult> {
  const now = options.now ?? defaultNow;
  const budgetMicro = usdToMicro(options.budgetUsd);
  const baseline: TutorEvalRunResult = {
    status: "refused",
    refusalReason: null,
    records: [],
    calls: 0,
    retries: 0,
    spentMicro: 0,
    budgetMicro,
    costUnknownCases: [],
    notRunCases: [],
  };

  // ── 前置檢查（任何一項失敗都不會發出呼叫）───────────────────────────
  if (options.cases.length === 0) {
    return { ...baseline, refusalReason: "沒有任何案例" };
  }
  const ids = options.cases.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) {
    return { ...baseline, refusalReason: "案例 ID 重複，結果無法對應教師矩陣" };
  }
  if (
    !Number.isFinite(options.pricing.inputUsdPerMillion) ||
    !Number.isFinite(options.pricing.outputUsdPerMillion) ||
    options.pricing.inputUsdPerMillion < 0 ||
    options.pricing.outputUsdPerMillion <= 0 ||
    options.pricing.source.trim().length === 0
  ) {
    return { ...baseline, refusalReason: "定價未設定或缺少來源，不可用猜測的價格作預算" };
  }

  const previous = options.previous ?? [];
  const uncertainPrevious = previous.filter((record) => record.outcomeUncertain);
  if (uncertainPrevious.length > 0 && options.confirmUncertainResume !== true) {
    return {
      ...baseline,
      refusalReason: `上次執行有 ${uncertainPrevious.length} 條結果不確定（供應商可能已收費），需明確確認才可繼續`,
    };
  }

  const previousByCase = new Map(previous.map((record) => [record.caseId, record]));
  const records: TutorEvalCaseRecord[] = [];
  let spentMicro = 0;
  let calls = 0;
  let retries = 0;
  const costUnknownCases: string[] = [];
  const notRunCases: string[] = [];
  let status: TutorEvalRunStatus = "completed";

  for (const spec of options.cases) {
    const prior = previousByCase.get(spec.id);
    // 已成功完成的案例不重跑，直接沿用上一次紀錄（避免重複付費）。
    if (prior !== undefined && prior.status === "ok") {
      records.push(prior);
      spentMicro += prior.costMicro;
      if (prior.costUnknown) costUnknownCases.push(spec.id);
      continue;
    }

    const projected = conservativeCostMicro(spec, options.pricing);
    // 每次呼叫**前**檢查剩餘預算（不是事後才算）。
    if (spentMicro + projected > budgetMicro) {
      notRunCases.push(spec.id);
      records.push({
        caseId: spec.id,
        status: "not-run",
        attempts: 0,
        answer: null,
        errorCode: null,
        outcomeUncertain: false,
        usage: null,
        costMicro: 0,
        costBasis: "zero",
        costUnknown: false,
        startedAt: now(),
        completedAt: null,
      });
      status = "stopped-budget";
      continue;
    }

    let attempt = 1;
    let result: TutorEvalCallResult = { ok: false, errorCode: "network" };
    let caseCost = 0;
    let caseCostBasis: TutorEvalCostBasis = "zero";
    let caseUnknown = false;

    while (true) {
      calls += 1;
      result = await options.transport.call({
        caseId: spec.id,
        maxOutputTokens: spec.maxOutputTokens,
        attempt,
      });

      const usage = result.usage ?? null;
      if (isUsagePlausible(usage, spec)) {
        caseCost = actualCostMicro(usage, options.pricing);
        caseCostBasis = "actual-usage";
        caseUnknown = false;
      } else {
        caseCost = conservativeCostMicro(spec, options.pricing);
        caseCostBasis = "conservative-ceiling";
        caseUnknown = true;
      }
      spentMicro += caseCost;

      const uncertain = result.outcomeUncertain === true;
      const canRetry =
        !result.ok &&
        attempt < MAX_ATTEMPTS_PER_CASE &&
        isRetryable(result.errorCode, uncertain);
      if (!canRetry) break;

      // 重試同樣要付費 → 先確認預算仍足夠才重試。
      const retryProjected = conservativeCostMicro(spec, options.pricing);
      if (spentMicro + retryProjected > budgetMicro) {
        status = "stopped-budget";
        break;
      }
      attempt += 1;
      retries += 1;
    }

    if (caseUnknown) costUnknownCases.push(spec.id);

    const record: TutorEvalCaseRecord = {
      caseId: spec.id,
      status: result.ok ? "ok" : "failed",
      attempts: attempt,
      answer: result.ok ? (result.answer ?? null) : null,
      errorCode: result.ok ? null : (result.errorCode ?? "invalid-response"),
      outcomeUncertain: result.outcomeUncertain === true,
      usage: result.usage ?? null,
      costMicro: caseCost,
      costBasis: caseCostBasis,
      costUnknown: caseUnknown,
      startedAt: now(),
      completedAt: now(),
    };
    records.push(record);
    options.onCaseComplete?.(record);

    // 結果不確定 → 立即停止整批，交由人工確認，避免重複付費。
    if (record.outcomeUncertain) {
      status = "stopped-uncertain";
      for (const remaining of options.cases.slice(records.length)) {
        notRunCases.push(remaining.id);
      }
      break;
    }
  }

  return {
    status,
    refusalReason: null,
    records,
    calls,
    retries,
    spentMicro,
    budgetMicro,
    costUnknownCases,
    notRunCases,
  };
}

/**
 * 從 journal（每完成一條即寫一行 JSON）還原已完成紀錄。
 *
 * 中斷後必須能分辨「已完成」、「失敗」及「完全沒有記錄」三種情況：
 * 沒有記錄的案例會重新執行，已完成的不會。不完整的行（程序被強制終止時寫到一半）
 * 一律忽略，並在 `truncatedLines` 計數，令操作者知道輸出檔曾不完整。
 */
export function parseJournal(text: string): {
  records: TutorEvalCaseRecord[];
  truncatedLines: number;
} {
  const records: TutorEvalCaseRecord[] = [];
  let truncatedLines = 0;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed) as TutorEvalCaseRecord;
      if (typeof parsed?.caseId === "string" && typeof parsed?.status === "string") {
        records.push(parsed);
      } else {
        truncatedLines += 1;
      }
    } catch {
      truncatedLines += 1;
    }
  }
  return { records, truncatedLines };
}
