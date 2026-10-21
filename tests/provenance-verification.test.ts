/**
 * 「需核對課本依據」逐題核對紀錄（2026-10-21）。
 *
 * 背景：教師工作台的 provenance 佇列原本列出 623 題「自動修復改動過題幹或選項」的題目，
 * 擁有者指示由 AI 依教材及歷史知識逐題核對，不再由人手核對。這裡守住四條界線：
 *   1. 紀錄**綁定版本**：題目再被修改（revision 或 fingerprint 改變）即自動失效並重回佇列；
 *   2. `needs-teacher` 的題目**不會**移出佇列；
 *   3. 手寫理由必須逐題撰寫（同一句不可大量重複），自動比對類另設檢查項目；
 *   4. 紀錄不是覆核紀錄，不會令題目變成「已覆核」。
 */
import { describe, expect, it } from "vitest";

import {
  ledgerDigest,
  mergeVerificationEntries,
  resolveLedgerState,
  validateVerificationEntries,
  type ProvenanceVerificationEntry,
  type ProvenanceVerificationLedger,
} from "@/server/services/provenance-verification";

function entry(overrides: Partial<ProvenanceVerificationEntry> = {}): ProvenanceVerificationEntry {
  return {
    questionId: "qb-test-1",
    revision: 4,
    fingerprint: "a".repeat(64),
    verdict: "verified-meaning-preserved",
    basis: "填回「信史時期」後題意完整，考核「史前時期」正確",
    verifiedBy: "ai-textbook-verification",
    verifiedAt: "2026-10-21T02:00:00.000Z",
    ...overrides,
  };
}

function ledger(entries: ProvenanceVerificationEntry[]): ProvenanceVerificationLedger {
  return { notice: "test", entries };
}

const current = { revision: 4, fingerprint: "a".repeat(64) };

describe("resolveLedgerState", () => {
  it("版本及指紋相符時移出佇列", () => {
    const state = resolveLedgerState("qb-test-1", current, ledger([entry()]));
    expect(state.status).toBe("cleared");
  });

  it("沒有紀錄時留在佇列", () => {
    const state = resolveLedgerState("qb-test-1", current, ledger([]));
    expect(state.status).toBe("unverified");
  });

  it("題目 revision 改變後紀錄失效並重回佇列", () => {
    const state = resolveLedgerState(
      "qb-test-1",
      { revision: 5, fingerprint: "a".repeat(64) },
      ledger([entry()]),
    );
    expect(state.status).toBe("stale");
    expect(state.reason).toContain("第 4 版");
  });

  it("題目內容改變（指紋不同）後紀錄失效並重回佇列", () => {
    const state = resolveLedgerState(
      "qb-test-1",
      { revision: 4, fingerprint: "b".repeat(64) },
      ledger([entry()]),
    );
    expect(state.status).toBe("stale");
    expect(state.reason).toContain("指紋");
  });

  it("needs-teacher 的題目不會被移出佇列", () => {
    const state = resolveLedgerState(
      "qb-test-1",
      current,
      ledger([entry({ verdict: "needs-teacher", basis: "1935 年入侵的地點仍待教師按原卷確認" })]),
    );
    expect(state.status).toBe("needs-teacher");
  });

  it("資料庫內找不到題目時回報 stale（不以紀錄當作已處理）", () => {
    const state = resolveLedgerState("qb-test-1", null, ledger([entry()]));
    expect(state.status).toBe("stale");
    expect(state.reason).toContain("找不到");
  });
});

describe("validateVerificationEntries", () => {
  it("接受有足夠理由的紀錄", () => {
    expect(validateVerificationEntries([entry()])).toEqual([]);
  });

  it("拒絕過短的理由", () => {
    const issues = validateVerificationEntries([entry({ basis: "正確" })]);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("理由");
  });

  it("拒絕沒有修正內容的 corrected", () => {
    const issues = validateVerificationEntries([entry({ verdict: "corrected" })]);
    expect(issues.some((issue) => issue.message.includes("corrected"))).toBe(true);
  });

  it("拒絕同一句手寫理由大量重複（假核對）", () => {
    const entries = Array.from({ length: 7 }, (_, index) =>
      entry({ questionId: `qb-test-${index}`, basis: "整批題目都沒有問題，可以核對通過" }),
    );
    const issues = validateVerificationEntries(entries);
    expect(issues.some((issue) => issue.message.includes("同一句理由"))).toBe(true);
  });

  it("自動比對類（automated-diff）容許共用理由，但必須有檢查項目", () => {
    const shared = {
      verdict: "verified-meaning-preserved" as const,
      method: "automated-diff" as const,
      basis: "格式修復：移除項目符號及空格標記後，題幹與標準答案與原卷完全相同",
    };
    const entries = Array.from({ length: 70 }, (_, index) =>
      entry({ questionId: `qb-test-${index}`, checks: ["normalised-stem-equal"], ...shared }),
    );
    expect(validateVerificationEntries(entries)).toEqual([]);

    const withoutChecks = Array.from({ length: 2 }, (_, index) =>
      entry({ questionId: `qb-test-${index}`, ...shared }),
    );
    expect(
      validateVerificationEntries(withoutChecks).some((issue) => issue.message.includes("檢查項目")),
    ).toBe(true);
  });

  it("拒絕同一題有兩個不同結果", () => {
    const issues = validateVerificationEntries([
      entry(),
      entry({ verdict: "needs-teacher", basis: "仍要教師按原卷確認空格位置及答案" }),
    ]);
    expect(issues.some((issue) => issue.message.includes("兩個不同的核對結果"))).toBe(true);
  });
});

describe("mergeVerificationEntries / ledgerDigest", () => {
  it("同一題以最新一筆為準，並可重複執行", () => {
    const first = mergeVerificationEntries(ledger([]), [entry()]);
    const second = mergeVerificationEntries(first, [entry({ verdict: "verified-reworded" })]);
    expect(second.entries).toHaveLength(1);
    expect(second.entries[0].verdict).toBe("verified-reworded");
  });

  it("摘要穩定（同一內容得出同一摘要）", () => {
    const a = ledger([entry(), entry({ questionId: "qb-test-2" })]);
    const b = ledger([entry({ questionId: "qb-test-2" }), entry()]);
    expect(ledgerDigest(a)).toBe(ledgerDigest(b));
  });
});
