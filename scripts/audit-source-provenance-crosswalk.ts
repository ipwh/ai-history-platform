/**
 * Provenance 風險 × 來源可追溯性 交叉分析（Sprint 14，唯讀）。
 *
 * 目的：回答「只有自動修復證據」與「來源待核實」兩份清單之間的關係，
 * 避免同一題在多份清單被重複計數，並找出「必須先補來源才可能有效覆核」的題目。
 * 2026-10-24 起所有題目都有擁有者指示的覆核證據，因此 provenance 清單為 0 題。
 *
 * 輸入（全部唯讀，不連資料庫）：
 *   - docs/quality/provenance-risk-2026-10-19.json（風險人口逐題分級）
 *   - docs/quality/content-audit-2026-10-19.json（來源／解釋／元數據快照）
 *   - docs/quality/review-provenance-2026-10-19.json（目前版本的審核證據來源）
 *
 * 輸出：docs/quality/source-provenance-crosswalk-2026-10-19.{json,md}
 */
import fs from "node:fs";
import path from "node:path";

interface ProvenanceRow {
  questionId: string;
  revision: number | null;
  tier: string;
  riskClass: string;
  classifications: string[];
  originalStem: string | null;
  currentStem: string | null;
}

interface AuditQuestion {
  id: string;
  revision: number;
  status: string;
  sourceStatus: "traceable" | "partial" | "unknown" | "pending_verification";
  canServe: boolean;
}

interface ReviewEvidence {
  questionId: string;
  hasCurrentHumanEvidence: boolean;
  hasCurrentTeacherAdjudication: boolean;
  automationOnly: boolean;
}

function readJson<T>(relativePath: string): T {
  const full = path.resolve(process.cwd(), relativePath);
  if (!fs.existsSync(full)) throw new Error(`找不到輸入報告：${relativePath}`);
  return JSON.parse(fs.readFileSync(full, "utf8")) as T;
}

function readArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

function main(): void {
  const repo = process.cwd();
  const argv = process.argv.slice(2);
  const provenance = readJson<{ generatedAt: string; rows: ProvenanceRow[] }>(
    "docs/quality/provenance-risk-2026-10-19.json",
  );
  const audit = readJson<{ generatedAt: string; questions: AuditQuestion[] }>(
    "docs/quality/content-audit-2026-10-19.json",
  );
  const reviews = readJson<{ generatedAt: string; questionEvidence: ReviewEvidence[] }>(
    "docs/quality/review-provenance-2026-10-19.json",
  );

  const auditById = new Map(audit.questions.map((question) => [question.id, question]));
  const reviewById = new Map(reviews.questionEvidence.map((row) => [row.questionId, row]));
  const provenanceIds = provenance.rows.map((row) => row.questionId);

  const duplicateIds = provenanceIds.filter(
    (id, index) => provenanceIds.indexOf(id) !== index,
  );
  const uniqueProvenanceIds = [...new Set(provenanceIds)];

  const sourcePendingIds = audit.questions
    .filter((question) => question.sourceStatus === "pending_verification")
    .map((question) => question.id);
  const sourcePendingSet = new Set(sourcePendingIds);

  const overlapIds = uniqueProvenanceIds.filter((id) => sourcePendingSet.has(id));
  const overlapByTier: Record<string, number> = {};
  const matrix: Record<string, Record<string, number>> = {};
  const needsSourceFirst: string[] = [];
  const hasDiffButNoTraceableSource: string[] = [];
  const noPreRepairSnapshot: string[] = [];

  for (const row of provenance.rows) {
    const question = auditById.get(row.questionId);
    const sourceStatus = question?.sourceStatus ?? "not_in_audit";
    matrix[sourceStatus] ??= {};
    matrix[sourceStatus][row.tier] = (matrix[sourceStatus][row.tier] ?? 0) + 1;
    if (overlapIds.includes(row.questionId)) {
      overlapByTier[row.tier] = (overlapByTier[row.tier] ?? 0) + 1;
    }
    if (sourceStatus !== "traceable" && (row.tier === "P1" || row.tier === "P0")) {
      hasDiffButNoTraceableSource.push(row.questionId);
      needsSourceFirst.push(row.questionId);
    }
    if (row.originalStem === null) noPreRepairSnapshot.push(row.questionId);
  }

  const automationOnlyOverlap = uniqueProvenanceIds.filter(
    (id) => reviewById.get(id)?.automationOnly === true,
  ).length;
  const teacherAdjudicatedOverlap = uniqueProvenanceIds.filter(
    (id) => reviewById.get(id)?.hasCurrentTeacherAdjudication === true,
  ).length;
  const humanEvidenceOverlap = uniqueProvenanceIds.filter(
    (id) => reviewById.get(id)?.hasCurrentHumanEvidence === true,
  ).length;

  const report = {
    generatedAt: new Date().toISOString(),
    notice:
      "唯讀交叉分析：只讀取既有報告，不連接資料庫、不改題目或審核紀錄。分類沿用各報告的定義。",
    inputs: {
      provenanceRisk: "docs/quality/provenance-risk-2026-10-19.json",
      contentAudit: "docs/quality/content-audit-2026-10-19.json",
      reviewProvenance: "docs/quality/review-provenance-2026-10-19.json",
      generatedAt: {
        provenanceRisk: provenance.generatedAt,
        contentAudit: audit.generatedAt,
        reviewProvenance: reviews.generatedAt,
      },
    },
    totals: {
      provenanceQuestions: provenance.rows.length,
      provenanceUniqueQuestions: uniqueProvenanceIds.length,
      provenanceDuplicateRows: duplicateIds.length,
      sourcePendingQuestions: sourcePendingIds.length,
      sourceTraceableQuestions: audit.questions.filter((q) => q.sourceStatus === "traceable").length,
      overlapProvenanceAndSourcePending: overlapIds.length,
      overlapByTier,
      automationOnlyWithinProvenance: automationOnlyOverlap,
      teacherAdjudicatedWithinProvenance: teacherAdjudicatedOverlap,
      humanEvidenceWithinProvenance: humanEvidenceOverlap,
      hasDiffButNoTraceableSource: hasDiffButNoTraceableSource.length,
      noPreRepairSnapshot: noPreRepairSnapshot.length,
      needsSourceFirst: needsSourceFirst.length,
    },
    matrixBySourceStatusAndTier: matrix,
    sampleIds: {
      overlap: overlapIds.slice(0, 20),
      hasDiffButNoTraceableSource: hasDiffButNoTraceableSource.slice(0, 20),
      needsSourceFirst: needsSourceFirst.slice(0, 20),
    },
    notes: [
      "「重疊」＝同一題同時屬於 provenance 風險清單與來源待核實清單；兩份清單定義不同，重疊不代表同一種缺陷。",
      "automationOnly 由 review provenance 報告判定（目前版本只有自動修復證據）。",
      "「有修復差異但來源不可追溯」＝P0／P1 且 sourceStatus ≠ traceable；這些題目需要先補來源才可能有有效覆核。",
    ],
  };

  const outBase = path.resolve(
    repo,
    readArg(argv, "--out") ?? "docs/quality/source-provenance-crosswalk-2026-10-19",
  );
  fs.writeFileSync(`${outBase}.json`, `${JSON.stringify(report, null, 1)}\n`, "utf8");

  const lines: string[] = [];
  lines.push("# Provenance 風險 × 來源可追溯性交叉分析（Sprint 14，唯讀）", "");
  lines.push(`產生時間：${report.generatedAt}`, "");
  lines.push("## 總數", "", "| 指標 | 數量 |", "| --- | --- |");
  for (const [key, value] of Object.entries(report.totals)) {
    if (typeof value === "number") lines.push(`| ${key} | ${value} |`);
  }
  lines.push("");
  lines.push("### 重疊題目的等級分布", "", "| 等級 | 題數 |", "| --- | --- |");
  for (const [tier, count] of Object.entries(overlapByTier)) lines.push(`| ${tier} | ${count} |`);
  lines.push("");
  lines.push("## 來源狀態 × provenance 等級", "", "| 來源狀態 | P0 | P1 | P2 | P3 |", "| --- | --- | --- | --- | --- |");
  for (const [status, tiers] of Object.entries(matrix)) {
    lines.push(
      `| ${status} | ${tiers.P0 ?? 0} | ${tiers.P1 ?? 0} | ${tiers.P2 ?? 0} | ${tiers.P3 ?? 0} |`,
    );
  }
  lines.push("");
  lines.push("## 解讀", "");
  lines.push(
    `- ${uniqueProvenanceIds.length} 題只有自動修復證據，其中 **${overlapIds.length}** 題同時屬於「來源待核實」。`,
  );
  lines.push(
    `- 其中 **${hasDiffButNoTraceableSource.length}** 題有修復前後差異但來源不可追溯：需要先補來源，才可能有有效覆核。`,
  );
  lines.push(
    `- 這 ${uniqueProvenanceIds.length} 題中沒有教師逐題裁決（${teacherAdjudicatedOverlap} 題）；P3 只代表排序較後。`,
  );
  lines.push(
    `- 沒有修復前可比較內容（originalStem 為 null）：${noPreRepairSnapshot.length} 題。`,
  );
  lines.push("");
  lines.push("## 限制", "");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  fs.writeFileSync(`${outBase}.md`, `${lines.join("\n")}\n`, "utf8");

  console.log("totals", report.totals);
  console.log(`已寫入 ${path.relative(repo, `${outBase}.json`)} 及 .md`);
  console.log("唯讀：沒有連接資料庫、沒有修改任何紀錄。");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
