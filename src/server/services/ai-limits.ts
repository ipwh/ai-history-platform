/**
 * AI 用量上限（伺服器端強制）。
 *
 * 目的：避免個別帳戶或整體用量失控而產生無法預期的費用。所有需要呼叫模型的
 * 學生端操作都必須先通過這裡的檢查。
 *
 * 設計重點：
 *   1. **先保留、後呼叫**：每次操作在呼叫模型之前同步寫入一筆用量記錄，再以
 *      「已保留的用量」計數。因為寫入及計數都是同步進行，同一時間的並行請求
 *      不會同時通過檢查（單一程序 + 同步 SQLite 寫入）。
 *   2. **直接呼叫 API 亦受限制**：檢查在伺服器端進行，無法以繞過前端規避。
 *   3. **可設定**：上限由環境變數決定（見 README「AI 用量上限」）。預設值是保守的
 *      防濫用值，**不是**平台擁有者核准的預算。
 *   4. 超過上限回傳 429 及可理解的訊息，並提示何時可以再試。
 *   5. 記錄只有學習者 ID、類別及時間，不含題目內容或學生答案。
 */
import { getServerConfig } from "../config";
import { ApiRouteError } from "../http";
import {
  countOperationsSince,
  countRecentOperations,
  countRecentOperationsForLearner,
  countStoredOperations,
  recordAiOperation,
  type AiOperationKind,
} from "../repositories/ai-operations";
import { AI_RETENTION_DAYS, maintenanceStatus, runMaintenance } from "./maintenance";

/** 限制是否已達到（供測試及診斷使用，不會寫入任何記錄） */
export interface AiLimitStatus {
  kind: AiOperationKind;
  learnerUsed: number;
  learnerLimit: number;
  globalUsed: number;
  globalLimit: number;
  exceeded: boolean;
  /** 超額的來源：learner = 個人上限；global = 整體上限 */
  reason: "learner" | "global" | null;
}

const WINDOW_MINUTES_FALLBACK = 60;

function windowStartIso(now: Date = new Date()): string {
  const config = getServerConfig().aiLimits;
  const minutes =
    Number.isFinite(config.windowMinutes) && config.windowMinutes > 0
      ? config.windowMinutes
      : WINDOW_MINUTES_FALLBACK;
  return new Date(now.getTime() - minutes * 60 * 1000).toISOString();
}

/** 依類別取得設定的上限（0 = 不設限） */
function limitsFor(kind: AiOperationKind): { learner: number; global: number } {
  const config = getServerConfig().aiLimits;
  return kind === "generation"
    ? { learner: config.generationsPerLearner, global: config.generationsGlobal }
    : { learner: config.gradingsPerLearner, global: config.gradingsGlobal };
}

/** 查詢目前用量（不寫入記錄） */
export function describeAiLimit(learnerId: string, kind: AiOperationKind): AiLimitStatus {
  const since = windowStartIso();
  const { learner, global } = limitsFor(kind);
  const learnerUsed = countRecentOperationsForLearner(learnerId, kind, since);
  const globalUsed = countRecentOperations(kind, since);

  const learnerExceeded = learner > 0 && learnerUsed >= learner;
  const globalExceeded = global > 0 && globalUsed >= global;

  return {
    kind,
    learnerUsed,
    learnerLimit: learner,
    globalUsed,
    globalLimit: global,
    exceeded: learnerExceeded || globalExceeded,
    reason: learnerExceeded ? "learner" : globalExceeded ? "global" : null,
  };
}

/**
 * 保留一次 AI 用量。超過上限時拋出 429，呼叫端**不可**繼續呼叫模型。
 *
 * @throws ApiRouteError 已達到個人或整體上限時。
 */
export function reserveAiOperation(learnerId: string, kind: AiOperationKind): AiLimitStatus {
  const config = getServerConfig().aiLimits;

  // 未啟用時仍然記錄用量（供監控及日後啟用），但不拒絕請求
  if (!config.enabled) {
    recordAiOperation(learnerId, kind);
    runRetentionOpportunistically();
    return describeAiLimit(learnerId, kind);
  }

  const status = describeAiLimit(learnerId, kind);
  if (status.exceeded) {
    const scope = status.reason === "global" ? "本網站" : "你的帳戶";
    const limit =
      status.reason === "global" ? status.globalLimit : status.learnerLimit;
    throw new ApiRouteError(
      `${scope}在 ${config.windowMinutes} 分鐘內已達到 AI 使用上限（${limit} 次）。請稍後再試；` +
        `如經常遇到這個情況，請向歷史科教師反映。`,
      429,
    );
  }

  // 先寫入保留記錄，之後才呼叫模型
  recordAiOperation(learnerId, kind);
  runRetentionOpportunistically();
  return describeAiLimit(learnerId, kind);
}

/**
 * 用量記錄保留期（天）。
 *
 * 記錄只用作「次數」統計（上限檢查只看時間窗），因此不需要永久保留。
 * 保留 30 天足以觀察趨勢及追查異常，同時避免表格無限增長。
 *
 * 實際清理由 `maintenance.ts` 執行（程序啟動時強制執行一次，其後最多每小時一次），
 * 這裡只保留常數供介面顯示，避免兩處各自定義保留期而出現不一致。
 */
export const AI_OPERATION_RETENTION_DAYS = AI_RETENTION_DAYS;

/**
 * 順帶嘗試執行一次保留期清理（最多每小時一次，失敗不影響本次用量保留）。
 *
 * 之前清理只在這裡順帶執行，沒有執行保證；現在的程序啟動時（instrumentation）會
 * 強制執行一次，因此即使長時間沒有 AI 請求亦不會無限累積。
 */
function runRetentionOpportunistically(): void {
  runMaintenance("ai-operation-retention");
}

/** 目前設定的 AI 用量上限及最近的總用量（只有次數，不含任何個人資料） */
export interface AiUsageSummary {
  enabled: boolean;
  windowMinutes: number;
  retentionDays: number;
  generations: { globalUsed: number; globalLimit: number };
  gradings: { globalUsed: number; globalLimit: number };
  /** 最近 24 小時及 7 天的總次數（不分帳戶，因此無法識別個別學生） */
  totals: {
    last24Hours: { generations: number; gradings: number };
    last7Days: { generations: number; gradings: number };
  };
  /** 現時儲存的記錄筆數（超過保留期的會在下次保留用量時自動刪除） */
  storedRecords: number;
  /** 保留期清理的實際執行情況（沒有這個紀錄就無法證明保留期真的在運作） */
  retention: {
    days: number;
    lastRunAt: string | null;
    lastStatus: "running" | "ok" | "failed" | null;
    lastDetail: string | null;
    runs: number;
    failures: number;
  };
}

/**
 * 供管理員端顯示的用量摘要。
 *
 * 刻意**只**提供總數：不提供個別學習者的用量、也不提供任何可識別身分的資料，
 * 讓管理員可以監控成本而不會把用量儀表板變成監視學生的工具。
 */
export function describeAiUsage(now: Date = new Date()): AiUsageSummary {
  const config = getServerConfig().aiLimits;
  const since = windowStartIso(now);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  return {
    enabled: config.enabled,
    windowMinutes: config.windowMinutes,
    retentionDays: AI_OPERATION_RETENTION_DAYS,
    generations: {
      globalUsed: countRecentOperations("generation", since),
      globalLimit: config.generationsGlobal,
    },
    gradings: {
      globalUsed: countRecentOperations("grading", since),
      globalLimit: config.gradingsGlobal,
    },
    totals: {
      last24Hours: {
        generations: countOperationsSince("generation", dayAgo),
        gradings: countOperationsSince("grading", dayAgo),
      },
      last7Days: {
        generations: countOperationsSince("generation", weekAgo),
        gradings: countOperationsSince("grading", weekAgo),
      },
    },
    storedRecords: countStoredOperations(),
    retention: (() => {
      const status = maintenanceStatus().find((entry) => entry.kind === "ai-operation-retention");
      return {
        days: AI_OPERATION_RETENTION_DAYS,
        lastRunAt: status?.lastFinishedAt ?? status?.lastStartedAt ?? null,
        lastStatus: status?.lastStatus ?? null,
        lastDetail: status?.lastDetail ?? null,
        runs: status?.runs ?? 0,
        failures: status?.failures ?? 0,
      };
    })(),
  };
}
