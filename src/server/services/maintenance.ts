/**
 * 定期維護（資料保留期清理）。
 *
 * ── 為甚麼要有這個模組 ────────────────────────────────────────────────
 * 之前 AI 用量記錄的清理只在「剛好有 AI 操作」時順帶執行，因此無法回答
 * 「如果一段時間沒有任何 AI 請求，保留期還會生效嗎？」。本模組把清理變成
 * **有明確執行保證**的維護工作：
 *
 *   1. **程序啟動時執行一次**（`src/instrumentation.ts` 的 `register()`）：
 *      Next.js 於每個伺服器實例啟動時呼叫，因此每次部署、重新啟動或 Cloud Run
 *      冷啟動都會執行一次；這是本平台（單一實例、無外部排程器）最可靠的做法，
 *      毋須新增任何付費服務。
 *   2. **最多每小時一次**：任何 AI 用量保留（`reserveAiOperation`）或健康檢查
 *      （`GET /api/health`）都會順帶嘗試執行，令長時間運行的實例亦不會無限累積。
 *
 * ── 失敗處理 ─────────────────────────────────────────────────────────
 * 清理失敗（例如資料庫暫時鎖定）**不會**影響任何使用者請求：錯誤會被記錄到
 * `maintenance_runs` 及伺服器記錄（Cloud Run 會轉成 Cloud Logging），下次執行會
 * 再試。每次執行都留下 `last_status`／`last_detail`，讓管理員可以在儀表板看到
 * 「上次何時執行、成功或失敗」，而不是只能相信文件。
 *
 * ── 正確性邊界 ───────────────────────────────────────────────────────
 * 只刪除「早於保留期界線」的記錄；界線以當下時間計算，因此不可能刪除較新的記錄。
 * 單一程序 + 同步 SQLite 寫入意味着清理與插入不會交錯執行（與用量上限的計數
 * 採用同一套同步模型）。
 */
import { getDb, nowIso } from "../db/connection";
import { purgeOperationsBefore } from "../repositories/ai-operations";

export type MaintenanceKind = "ai-operation-retention";

/** AI 用量記錄的保留期（天）。單一定義處，避免多處不一致。 */
export const AI_RETENTION_DAYS = 30;

export interface MaintenanceStatus {
  kind: MaintenanceKind;
  lastStartedAt: string;
  lastFinishedAt: string | null;
  lastStatus: "running" | "ok" | "failed";
  lastDetail: string | null;
  runs: number;
  failures: number;
}

/** 各類維護的最小執行間隔（毫秒）。啟動時會強制執行一次（force = true）。 */
const MIN_INTERVAL_MS: Record<MaintenanceKind, number> = {
  "ai-operation-retention": 60 * 60 * 1000,
};

/** 程序內記憶的上次執行時間，避免每個請求都查一次資料庫 */
const lastRunAt = new Map<MaintenanceKind, number>();

function readStatus(kind: MaintenanceKind): MaintenanceStatus | null {
  const row = getDb()
    .prepare("SELECT * FROM maintenance_runs WHERE kind = ?")
    .get(kind) as unknown as
    | {
        kind: string;
        last_started_at: string;
        last_finished_at: string | null;
        last_status: string;
        last_detail: string | null;
        runs: number;
        failures: number;
      }
    | undefined;
  if (!row) return null;
  return {
    kind: row.kind as MaintenanceKind,
    lastStartedAt: row.last_started_at,
    lastFinishedAt: row.last_finished_at,
    lastStatus: row.last_status as MaintenanceStatus["lastStatus"],
    lastDetail: row.last_detail,
    runs: row.runs,
    failures: row.failures,
  };
}

function writeRun(
  kind: MaintenanceKind,
  values: { startedAt: string; finishedAt: string | null; status: MaintenanceStatus["lastStatus"]; detail: string | null },
): void {
  const existing = readStatus(kind);
  if (existing === null) {
    getDb()
      .prepare(
        `INSERT INTO maintenance_runs
         (kind, last_started_at, last_finished_at, last_status, last_detail, runs, failures)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(kind, values.startedAt, values.finishedAt, values.status, values.detail, values.status === "failed" ? 1 : 0);
    return;
  }
  getDb()
    .prepare(
      `UPDATE maintenance_runs SET last_started_at = ?, last_finished_at = ?, last_status = ?,
        last_detail = ?, runs = runs + 1, failures = failures + ? WHERE kind = ?`,
    )
    .run(
      values.startedAt,
      values.finishedAt,
      values.status,
      values.detail,
      values.status === "failed" ? 1 : 0,
      kind,
    );
}

export interface MaintenanceResult {
  kind: MaintenanceKind;
  executed: boolean;
  deleted: number;
  status: MaintenanceStatus | null;
  error: string | null;
}

/**
 * 執行一項維護工作。
 *
 * @param options.force 忽略最小間隔（程序啟動時使用）。
 * @param options.now 注入的時鐘（測試用；預設為現在）。
 */
export function runMaintenance(
  kind: MaintenanceKind,
  options: { force?: boolean; now?: Date } = {},
): MaintenanceResult {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const previous = lastRunAt.get(kind);
  if (options.force !== true && previous !== undefined && nowMs - previous < MIN_INTERVAL_MS[kind]) {
    return { kind, executed: false, deleted: 0, status: readStatus(kind), error: null };
  }
  lastRunAt.set(kind, nowMs);

  const startedAt = now.toISOString();
  try {
    const cutoff = new Date(nowMs - AI_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const deleted = purgeOperationsBefore(cutoff);
    writeRun(kind, {
      startedAt,
      finishedAt: nowIso(),
      status: "ok",
      detail: `刪除 ${deleted} 筆早於 ${cutoff} 的用量記錄`,
    });
    return { kind, executed: true, deleted, status: readStatus(kind), error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 失敗不會拋出：維護工作不應令使用者請求失敗；但必須留下可見的紀錄
    console.error(`[maintenance] ${kind} 執行失敗：${message}`);
    try {
      writeRun(kind, { startedAt, finishedAt: nowIso(), status: "failed", detail: message });
    } catch (secondary) {
      // 連紀錄都寫不進去（例如資料庫完全無法使用）時，只保留伺服器記錄
      console.error(`[maintenance] 無法寫入維護紀錄：${String(secondary)}`);
    }
    return { kind, executed: true, deleted: 0, status: readStatus(kind), error: message };
  }
}

/** AI 用量記錄的保留期（天）。與 ai-limits 共用同一個常數，避免兩處不一致。 */
export const AI_RETENTION_DAYS_REF = AI_RETENTION_DAYS;

/** 所有維護工作的狀態（供管理員儀表板及健康檢查顯示） */
export function maintenanceStatus(): MaintenanceStatus[] {
  return (["ai-operation-retention"] as MaintenanceKind[]).flatMap((kind) => {
    const status = readStatus(kind);
    return status === null ? [] : [status];
  });
}

/** 只供測試使用：重設程序內的最小間隔記憶 */
export function resetMaintenanceScheduleForTests(): void {
  lastRunAt.clear();
}
