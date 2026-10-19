import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PACKET_CATEGORIES,
  buildAdjudicationPacket,
  type WorklistReport,
} from "../src/server/quality/adjudication-packet";

function loadWorklist(): WorklistReport {
  const file = path.resolve(process.cwd(), "docs/quality/adjudication-worklist-2026-10-19.json");
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as WorklistReport;
}

describe("97 題裁決包（唯讀輸出）", () => {
  const report = loadWorklist();
  const packet = buildAdjudicationPacket(report);

  it("包含工作清單內全部題目，不多不少", () => {
    expect(packet.stats.rows).toBe(report.items.length);
    expect(packet.stats.rows).toBe(report.totals.questions);
  });

  it("CSV 每個題號只出現一次，且欄位數一致", () => {
    const lines = packet.csv.split("\r\n");
    const headerCount = lines[0].split(",").length;
    expect(lines).toHaveLength(report.items.length + 1);
    const ids = lines.slice(1).map((line) => line.slice(1, line.indexOf('","')));
    expect(new Set(ids).size).toBe(report.items.length);
    for (const line of lines) {
      expect(line.split('","').length).toBe(headerCount);
    }
  });

  it("保留版本、指紋及必須維持隔離的標記", () => {
    const lines = packet.csv.split("\r\n").slice(1);
    for (const line of lines) {
      expect(line).toContain('"是"');
      expect(line).toMatch(/"(\d+)","[0-9a-f]{8,}"/);
    }
    expect(packet.stats.mustStayQuarantined).toBe(report.items.length);
    // 本文件不判斷紀錄是否為教師裁決；只核對統計與來源 JSON 一致。
    expect(packet.stats.withReviewRecords).toBe(
      report.items.filter((item) => item.review.records > 0).length,
    );
  });

  it("HTML 不預先勾選任何裁決，並明確聲明不是核准", () => {
    expect(packet.html).not.toContain("checked");
    expect(packet.html).not.toContain("☑");
    expect(packet.html).toContain("不是核准");
    for (const item of report.items) {
      expect(packet.html).toContain(item.questionId);
    }
  });

  it("五個證據類別都有說明，且數量與工作清單一致", () => {
    for (const category of PACKET_CATEGORIES) {
      const expected = report.byEvidenceCategory[category];
      if (expected === undefined) continue;
      expect(packet.stats.byCategory[category]).toBe(expected);
      expect(packet.html).toContain(category);
    }
    const total = Object.values(packet.stats.byCategory).reduce((sum, value) => sum + value, 0);
    expect(total).toBe(report.items.length);
  });

  it("CSV 正確轉義引號及換行", () => {
    const base = report.items[0] ?? {
      questionId: "qb-TEST0000",
      revision: 1,
      fingerprint: "0".repeat(64),
      status: "published",
      teacherConfirmationRequired: false,
      issueCode: "MCQ_ROMAN_LABEL_MISSING",
      issueCategory: "other",
      structuralReason: "測試用",
      questionType: "mc",
      correctAnswer: "i",
      acceptedAnswers: [],
      gradingPoints: [],
      gradingMethod: "選擇題：選項完全比對",
      sourceLocation: null,
      sourceBlockIds: [],
      hasOriginalFile: false,
      evidenceStatus: null,
      evidenceCategory: "machine_undecidable",
      evidenceCategoryLabel: "其他無法由機器可靠判斷",
      evidenceLines: [],
      missingEvidence: [],
      provenance: null,
      review: {
        records: 0,
        currentHumanReview: false,
        latestDecision: null,
        latestReviewer: null,
        latestReviewedAt: null,
      },
      suggestedNextStep: "測試用",
      mustStayQuarantined: true,
      lastAuditedAt: new Date(0).toISOString(),
      dataSources: [],
    };
    const csv = buildAdjudicationPacket({
      ...report,
      items: [
        {
          ...base,
          structuralReason: '含有 "引號" 及\n換行的原因',
          questionId: "qb-TEST0001",
        },
      ],
    }).csv;
    expect(csv).toContain('""引號""');
    expect(csv).not.toContain("\n\n");
  });
});
