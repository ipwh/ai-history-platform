/**
 * 擁有者的「風險接受」紀錄必須保持如實（2026-10-21）。
 *
 * 背景：擁有者閱覽 20 題隨機樣本後表示沒有問題，並決定不對 1,822 題逐條覆核、
 * 不對 1,293 題逐題核對教材依據、技能標籤繼續空白。
 *
 * 這個決定**不是**覆核紀錄。以下測試固定兩件事，避免日後有人把「擁有者接受」讀成
 * 「已通過覆核」，或令文件聲稱不存在的證據：
 *   1. 紀錄檔必須明示沒有建立任何覆核紀錄，並列出被拒絕的逐題工作；
 *   2. 相關文件必須連結此紀錄，不得改寫成「已逐題覆核」。
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const recordPath = path.resolve(
  process.cwd(),
  "docs/teacher-review/owner-acceptance-2026-10-21.json",
);
const decisionDocPath = path.resolve(
  process.cwd(),
  "docs/teacher-review/owner-decision-2026-10-21.md",
);
const readmePath = path.resolve(process.cwd(), "docs/teacher-review/README.md");

interface AcceptanceRecord {
  decision: string;
  decidedBy: string;
  declined?: { item?: string }[];
  reviewRecordsCreated?: number;
  whatThisDoesNotMean?: string[];
  note?: string;
}

function readRecord(): AcceptanceRecord {
  return JSON.parse(fs.readFileSync(recordPath, "utf8")) as AcceptanceRecord;
}

describe("擁有者風險接受紀錄", () => {
  it("明示沒有建立任何覆核紀錄", () => {
    const record = readRecord();
    expect(record.reviewRecordsCreated).toBe(0);
    expect(record.decision).toBe("owner-accepted-published-content-by-sampling");
    expect(record.decidedBy).toBe("ipwh@pochiu.edu.hk");
  });

  it("列出被拒絕的逐題工作（覆核及教材依據核對）", () => {
    const declined = (readRecord().declined ?? []).map((entry) => entry.item ?? "");
    expect(declined).toContain("per-question teacher review");
    expect(declined).toContain("per-question source traceability verification");
  });

  it("重申不代表已覆核、不代表閘門已通過", () => {
    const statements = readRecord().whatThisDoesNotMean ?? [];
    expect(statements.some((text) => text.includes("未經人工覆核"))).toBe(true);
    expect(statements.some((text) => text.includes("source_verified"))).toBe(true);
    expect(statements.some((text) => text.includes("NOT READY"))).toBe(true);
    expect(statements.some((text) => text.includes("question_reviews") || text.includes("覆核紀錄"))).toBe(
      true,
    );
  });

  it("相關文件連接到此紀錄，且沒有把樣本接受寫成逐題覆核", () => {
    const decisionDoc = fs.readFileSync(decisionDocPath, "utf8");
    const readme = fs.readFileSync(readmePath, "utf8");
    expect(decisionDoc).toContain("owner-acceptance-2026-10-21.json");
    expect(readme).toContain("owner-acceptance-2026-10-21.json");
    expect(decisionDoc).toContain("風險接受（accept by sampling）");
    expect(decisionDoc).not.toContain("1,822 題已逐題覆核");
  });
});
