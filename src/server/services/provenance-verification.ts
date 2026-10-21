/**
 * Provenance（課本依據）逐題核對紀錄（純函式）。
 *
 * 背景：`docs/quality/provenance-risk-2026-10-19.json` 列出 623 題「自動修復改動過題幹或選項」的
 * 題目，教師工作台的「需核對課本依據的題目」佇列直接由這份清單產生。清單本身只說明「改動了
 * 甚麼」，不代表已有人核對過。
 *
 * 這裡定義一份**逐題核對紀錄**（ledger）：每筆紀錄綁定**當時的 revision 及 fingerprint**。
 * 只有當題目之後沒有再被修改時，紀錄才繼續有效；題目一旦再改動，該題會自動回到佇列，
 * 不會因為「以前核對過」而永遠消失。
 *
 * 界線：
 *   - 紀錄只由核對者提供**逐題理由**，不可批次填同一句（理由長度及不可重複性由 CLI 檢查）。
 *   - 核對結果不會寫入 `question_reviews`，不代表教師覆核；教師端仍顯示「已發布（未經人工覆核）」。
 *   - `needs-teacher` 的題目**不會**從佇列移除。
 */
import { createHash } from "node:crypto";

export const PROVENANCE_VERDICTS = [
  /** 改動只是把其餘空格的答案填回題幹／整理格式；考核的空格與答案不變，經核對後與教材及史實一致 */
  "verified-meaning-preserved",
  /** 改動改變了題幹措辭，但逐題核對後認定答案正確、題意清楚、無答案外洩 */
  "verified-reworded",
  /** 核對後發現錯誤，已就地修正（修正內容見紀錄的 correction 欄） */
  "corrected",
  /** 仍有疑慮，保留在佇列等待教師決定 */
  "needs-teacher",
] as const;

export type ProvenanceVerdict = (typeof PROVENANCE_VERDICTS)[number];

/**
 * 核對方式：
 *   - `manual-review`：逐題閱讀題幹、答案及史實後作判斷（理由必須逐題撰寫，不可共用同一句）。
 *   - `automated-diff`：以程式比對「正規化後與原卷完全相同」（只移除空白、空格標記及選項
 *     項目符號），並逐題記錄檢查項目；這類改動機械可驗，容許共用同一句理由。
 */
export type ProvenanceVerificationMethod = "manual-review" | "automated-diff";

/** 只有這兩種結果會把題目移出佇列。 */
const CLEARING_VERDICTS: ReadonlySet<ProvenanceVerdict> = new Set([
  "verified-meaning-preserved",
  "verified-reworded",
  "corrected",
]);

export interface ProvenanceVerificationEntry {
  questionId: string;
  /** 核對時題目的版本；必須與現時版本相同才有效 */
  revision: number;
  /** 核對時題目的內容指紋；必須與現時指紋相同才有效 */
  fingerprint: string;
  verdict: ProvenanceVerdict;
  /** 核對方式；省略時視為 `manual-review` */
  method?: ProvenanceVerificationMethod;
  /** `automated-diff` 的檢查項目（例如 normalised-equal、answer-unchanged） */
  checks?: string[];
  /** 逐題理由（繁中，至少 12 字） */
  basis: string;
  verifiedBy: string;
  verifiedAt: string;
  /** `corrected` 時記錄修正內容 */
  correction?: { field: string; from: string; to: string };
}

export interface ProvenanceVerificationLedger {
  notice: string;
  entries: ProvenanceVerificationEntry[];
}

const MIN_BASIS_LENGTH = 12;

/** 同一句手寫理由最多可重複使用多少次（避免「一批題目共用同一句」的假核對）。 */
const MAX_IDENTICAL_MANUAL_BASIS = 6;

export type ProvenanceLedgerStatus =
  | "cleared"
  | "stale"
  | "needs-teacher"
  | "unverified";

export interface ProvenanceLedgerState {
  questionId: string;
  status: ProvenanceLedgerStatus;
  entry: ProvenanceVerificationEntry | null;
  /** `stale` 時說明為甚麼紀錄失效 */
  reason: string;
}

export interface CurrentQuestionIdentity {
  revision: number;
  fingerprint: string;
}

/**
 * 檢查核對紀錄是否仍適用於現時的題目版本。
 *
 * 任何一項不符（找不到紀錄、版本不同、指紋不同）都會令該題**留在**佇列——
 * 這是刻意的 fail-closed：寧可多問一次，不可用舊核對結果掩蓋後來的改動。
 */
export function resolveLedgerState(
  questionId: string,
  current: CurrentQuestionIdentity | null,
  ledger: ProvenanceVerificationLedger,
): ProvenanceLedgerState {
  const entry = ledger.entries.find((item) => item.questionId === questionId) ?? null;
  if (!entry) return { questionId, status: "unverified", entry: null, reason: "尚未核對" };
  if (!CLEARING_VERDICTS.has(entry.verdict)) {
    return { questionId, status: "needs-teacher", entry, reason: "核對後仍需教師決定" };
  }
  if (!current) {
    return { questionId, status: "stale", entry, reason: "資料庫內找不到此題目" };
  }
  if (entry.revision !== current.revision) {
    return {
      questionId,
      status: "stale",
      entry,
      reason: `核對時為第 ${entry.revision} 版，現時為第 ${current.revision} 版`,
    };
  }
  if (entry.fingerprint !== current.fingerprint) {
    return {
      questionId,
      status: "stale",
      entry,
      reason: "核對後題目內容再被修改（指紋不同）",
    };
  }
  return { questionId, status: "cleared", entry, reason: "已按現時版本核對" };
}

export interface LedgerValidationIssue {
  questionId: string;
  message: string;
}

/**
 * 驗證一批新的核對結果，回傳錯誤清單（空陣列代表可以寫入）。
 *
 * 檢查項目：理由長度、理由不可大量重複、verdict 必須是允許值、`corrected` 必須有修正內容、
 * 同一題不可有兩筆不同結果。
 */
export function validateVerificationEntries(
  entries: ProvenanceVerificationEntry[],
): LedgerValidationIssue[] {
  const issues: LedgerValidationIssue[] = [];
  const seen = new Map<string, ProvenanceVerdict>();
  const basisCounts = new Map<string, number>();

  for (const entry of entries) {
    if (!(PROVENANCE_VERDICTS as readonly string[]).includes(entry.verdict)) {
      issues.push({ questionId: entry.questionId, message: `不接受的核對結果：${entry.verdict}` });
    }
    const basis = (entry.basis ?? "").trim();
    if (basis.length < MIN_BASIS_LENGTH) {
      issues.push({
        questionId: entry.questionId,
        message: `理由只有 ${basis.length} 字（最少 ${MIN_BASIS_LENGTH} 字）`,
      });
    }
    if (entry.verdict === "corrected" && !entry.correction) {
      issues.push({ questionId: entry.questionId, message: "corrected 必須記錄修正內容" });
    }
    if (!Number.isInteger(entry.revision) || entry.revision < 1) {
      issues.push({ questionId: entry.questionId, message: "缺少有效的 revision" });
    }
    if (!/^[0-9a-f]{16,}$/i.test(entry.fingerprint ?? "")) {
      issues.push({ questionId: entry.questionId, message: "缺少有效的 fingerprint" });
    }
    if (!entry.verifiedBy?.trim()) {
      issues.push({ questionId: entry.questionId, message: "缺少核對者身分" });
    }
    const previous = seen.get(entry.questionId);
    if (previous !== undefined && previous !== entry.verdict) {
      issues.push({ questionId: entry.questionId, message: "同一題有兩個不同的核對結果" });
    }
    seen.set(entry.questionId, entry.verdict);
    const method = entry.method ?? "manual-review";
    if (method === "automated-diff") {
      if (!Array.isArray(entry.checks) || entry.checks.length === 0) {
        issues.push({
          questionId: entry.questionId,
          message: "automated-diff 必須記錄檢查項目（checks）",
        });
      }
      continue;
    }
    basisCounts.set(basis, (basisCounts.get(basis) ?? 0) + 1);
  }

  for (const [basis, count] of basisCounts) {
    if (count > MAX_IDENTICAL_MANUAL_BASIS) {
      issues.push({
        questionId: "*",
        message: `同一句理由被用於 ${count} 題（手寫核對上限 ${MAX_IDENTICAL_MANUAL_BASIS}）：${basis.slice(0, 40)}`,
      });
    }
  }
  return issues;
}

/** 合併新核對結果（同一題以最新一筆為準，保留歷史）。 */
export function mergeVerificationEntries(
  ledger: ProvenanceVerificationLedger,
  incoming: ProvenanceVerificationEntry[],
): ProvenanceVerificationLedger {
  const byId = new Map(ledger.entries.map((entry) => [entry.questionId, entry]));
  for (const entry of incoming) byId.set(entry.questionId, entry);
  return {
    ...ledger,
    entries: [...byId.values()].sort((left, right) => left.questionId.localeCompare(right.questionId)),
  };
}

/** 產生穩定摘要，方便把紀錄檔寫入授權紀錄及在測試中比對。 */
export function ledgerDigest(ledger: ProvenanceVerificationLedger): string {
  const lines = ledger.entries
    .map((entry) => `${entry.questionId}|${entry.revision}|${entry.fingerprint}|${entry.verdict}`)
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}
