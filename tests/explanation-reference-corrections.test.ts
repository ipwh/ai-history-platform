/**
 * 「解釋段號過時」建議修正清單（Sprint 8.6 第四階段）的結構測試。
 *
 * 這一組測試確保：
 *   - 7 條已知題目全部有核對紀錄，且分類只可以是四種已定義的結果；
 *   - 每一項都有現行教材證據（引用段落 + 原文），而「outdated-recoverable」必須有建議替代文字；
 *   - **沒有任何一項被套用**（applied === false），亦沒有假裝已取得授權；
 *   - 「still-accurate」的個案不得提出改寫（避免無故改動題目內容）。
 *
 * 修正的套用屬另一項需要擁有者及教師授權的工作，不在本 Sprint 範圍。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface CorrectionItem {
  questionId: string;
  classification: "still-accurate" | "outdated-recoverable" | "ambiguous" | "unsupported";
  existingExplanation: string;
  evidence: {
    blockId: string;
    blockSourceLocation: string;
    quote: string;
    excerptVerbatimInBlock: boolean;
  };
  verifiedCurrentReference: string;
  proposedReplacement: string | null;
  proposedSourceLocation?: string;
  applied: boolean;
  verifiedNow: {
    checkedOn: string;
    status: string;
    revision: number;
    storedSourceLocation: string;
    sourceVerified: boolean;
    explanationMatchesManifest: boolean;
  };
  changes: {
    field: string;
    oldValue: string;
    proposedValue: string;
    reason: string;
    confidence: { level: string; reason: string };
  }[];
  approvalRequired: {
    roles: string[];
    obtained: boolean;
    reason: string;
    effectIfApplied: string;
  };
}

interface CorrectionFile {
  version: number;
  status: string;
  authorisation: { required: string[]; obtained: boolean };
  method: string[];
  recheck: { date: string; stillUnapplied: boolean; result: string[] };
  items: CorrectionItem[];
  summary: Record<string, unknown>;
}

const FILE = path.join("docs", "teacher-review", "explanation-reference-corrections-2026-10.json");
const manifest = JSON.parse(fs.readFileSync(FILE, "utf8")) as CorrectionFile;

/** README 第 45 項列出的 7 條題目（保持與稽核紀錄一致） */
const KNOWN_IDS = [
  "q_cc6088757ff240f1",
  "q_9531dd6d6ad34d4a",
  "q_b87d77c973a140dc",
  "q_367c44de30bc4771",
  "q_10e7e20afbf14a17",
  "q_55f87a719efa41a2",
  "q_2ceed84d0a7a4bc7",
];

describe("解釋段號核對清單（建議，未套用）", () => {
  it("涵蓋全部 7 條已知題目，且沒有重複", () => {
    expect(manifest.version).toBe(2);
    expect(manifest.status).toBe("proposed-not-applied");
    expect(manifest.items.map((item) => item.questionId).sort()).toEqual([...KNOWN_IDS].sort());
    expect(manifest.method.length).toBeGreaterThanOrEqual(3);
  });

  it("每一項都有現行教材證據，分類限於四種已定義結果", () => {
    for (const item of manifest.items) {
      expect(
        ["still-accurate", "outdated-recoverable", "ambiguous", "unsupported"],
        item.questionId,
      ).toContain(item.classification);
      expect(item.evidence.blockId.startsWith("blk_"), item.questionId).toBe(true);
      expect(item.evidence.blockSourceLocation.length, item.questionId).toBeGreaterThan(10);
      expect(item.evidence.quote.length, item.questionId).toBeGreaterThan(5);
      // 證據必須是引用段落的逐字文字（核對時已驗證）
      expect(item.evidence.excerptVerbatimInBlock, item.questionId).toBe(true);
      expect(item.verifiedCurrentReference.length, item.questionId).toBeGreaterThan(3);
      expect(item.existingExplanation.length, item.questionId).toBeGreaterThan(10);
    }
  });

  it("需要修正的個案必須提出替代文字；仍然準確的個案不得改寫解釋", () => {
    for (const item of manifest.items) {
      if (item.classification === "outdated-recoverable") {
        expect(item.proposedReplacement, `${item.questionId} 需要建議替代文字`).not.toBeNull();
        expect(item.proposedReplacement!.length).toBeGreaterThan(10);
      }
      if (item.classification === "still-accurate") {
        expect(item.proposedReplacement, `${item.questionId} 的解釋仍然準確，不應改寫`).toBeNull();
      }
    }
  });

  it("沒有任何一項被套用，亦沒有假裝已取得授權", () => {
    expect(manifest.authorisation.obtained).toBe(false);
    expect(manifest.authorisation.required.length).toBeGreaterThanOrEqual(2);
    expect(manifest.recheck.stillUnapplied).toBe(true);
    expect(manifest.recheck.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(manifest.recheck.result.length).toBeGreaterThanOrEqual(3);
    for (const item of manifest.items) {
      expect(item.applied, item.questionId).toBe(false);
      expect(item.approvalRequired.obtained, item.questionId).toBe(false);
    }
  });

  it("每一項都有明確的舊值、建議值、理由、信心及所需授權（Sprint 8.7）", () => {
    for (const item of manifest.items) {
      expect(item.changes.length, item.questionId).toBeGreaterThan(0);
      for (const change of item.changes) {
        expect(["explanation", "sourceLocation"], item.questionId).toContain(change.field);
        expect(change.oldValue.length, item.questionId).toBeGreaterThan(10);
        expect(change.proposedValue.length, item.questionId).toBeGreaterThan(10);
        expect(change.oldValue, `${item.questionId} 的建議值與現值相同`).not.toBe(change.proposedValue);
        expect(change.reason.length, item.questionId).toBeGreaterThan(5);
        expect(["high", "medium", "low"], item.questionId).toContain(change.confidence.level);
        expect(change.confidence.reason.length, item.questionId).toBeGreaterThan(10);
      }
      expect(item.approvalRequired.roles.length, item.questionId).toBeGreaterThanOrEqual(2);
      expect(item.approvalRequired.effectIfApplied.length, item.questionId).toBeGreaterThan(10);
      // 重查紀錄：只在資料庫現況與提案一致時才成立
      expect(item.verifiedNow.explanationMatchesManifest, item.questionId).toBe(true);
      expect(item.verifiedNow.sourceVerified, item.questionId).toBe(true);
      expect(item.verifiedNow.checkedOn, item.questionId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(item.verifiedNow.storedSourceLocation.length, item.questionId).toBeGreaterThan(10);
    }
  });

  it("仍然準確的個案只修正來源位置字串，不改動解釋", () => {
    for (const item of manifest.items) {
      if (item.classification !== "still-accurate") continue;
      expect(item.changes).toHaveLength(1);
      expect(item.changes[0]!.field, item.questionId).toBe("sourceLocation");
      expect(item.changes[0]!.proposedValue, item.questionId).toBe(item.proposedSourceLocation);
      expect(item.changes[0]!.oldValue, item.questionId).toBe(item.verifiedNow.storedSourceLocation);
    }
    for (const item of manifest.items) {
      if (item.classification !== "outdated-recoverable") continue;
      expect(item.changes[0]!.field, item.questionId).toBe("explanation");
      expect(item.changes[0]!.proposedValue, item.questionId).toBe(item.proposedReplacement);
    }
  });

  it("統計數字與項目分類一致", () => {
    const count = (classification: string) =>
      manifest.items.filter((item) => item.classification === classification).length;
    expect(manifest.summary.total).toBe(manifest.items.length);
    expect(manifest.summary.stillAccurate).toBe(count("still-accurate"));
    expect(manifest.summary.outdatedRecoverable).toBe(count("outdated-recoverable"));
    expect(manifest.summary.ambiguous).toBe(count("ambiguous"));
    expect(manifest.summary.unsupported).toBe(count("unsupported"));
  });
});
