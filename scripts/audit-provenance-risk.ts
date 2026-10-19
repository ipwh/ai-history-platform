/**
 * 只有自動化修復證據的題目：風險分級報告（唯讀、可重複執行）。
 *
 * 資料來源（全部唯讀）：
 *   1. `docs/quality/review-provenance-*.json` 的 `questionEvidence`（找出 `automationOnly` 題目）。
 *   2. `npm run audit:repair-provenance -- --full`（以 `materials/` 原始試題檔重建並比較）。
 *
 * 輸出：`docs/quality/provenance-risk-2026-10-19.json` / `.md`。
 *
 * 此命令**不會**修改題目、覆核紀錄或發布狀態；分級只是覆核排序，不代表自動核准。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  classifyProvenanceRisk,
  TIER_LABEL,
  TIER_ORDER,
  type ProvenanceRiskTier,
} from "../src/server/quality/provenance-risk";

interface ReviewProvenanceReport {
  questionEvidence: Array<{
    questionId: string;
    revision: number;
    status: string;
    automationOnly: boolean;
  }>;
}

interface RepairItem {
  id: string;
  topicId: string;
  questionType: string;
  revision: number;
  status: string;
  teacherConfirmationRequired: boolean;
  originalStem: string | null;
  currentStem: string;
  originalOptions: string[] | null;
  currentOptions: string[];
  originalCorrectAnswer: string | null;
  currentCorrectAnswer: string;
  blankCountOriginal: number | null;
  blankCountCurrent: number | null;
  assessedBlankIndexOriginal: number | null;
  assessedBlankIndexCurrent: number | null;
  classifications: string[];
  notes: string[];
}

function readArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

/** 執行現有修復來源稽核並讀回逐題比較結果（不重複實作比較邏輯）。 */
function loadRepairComparison(cwd: string): Map<string, RepairItem> {
  const outputPath = path.join(os.tmpdir(), `provenance-risk-repair-${process.pid}.json`);
  const run = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsx", "scripts/audit-repair-provenance.ts", "--full", "--out", outputPath],
    { cwd, encoding: "utf8", shell: process.platform === "win32" },
  );
  if (run.status !== 0) {
    throw new Error(`audit:repair-provenance 執行失敗：${run.stderr || run.stdout}`);
  }
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as { items?: RepairItem[] };
  fs.rmSync(outputPath, { force: true });
  const map = new Map<string, RepairItem>();
  for (const item of report.items ?? []) map.set(item.id, item);
  return map;
}

function main(): void {
  const cwd = process.cwd();
  const argv = process.argv.slice(2);
  const reviewPath = path.resolve(
    cwd,
    readArg(argv, "--review") ?? "docs/quality/review-provenance-2026-10-19.json",
  );
  const outBase = path.resolve(
    cwd,
    readArg(argv, "--out") ?? "docs/quality/provenance-risk-2026-10-19",
  );

  if (!fs.existsSync(reviewPath)) {
    throw new Error(`找不到覆核來源報告：${reviewPath}（先執行 npm run audit:review-provenance）`);
  }
  const review = JSON.parse(fs.readFileSync(reviewPath, "utf8")) as ReviewProvenanceReport;
  const automationOnly = review.questionEvidence
    .filter((item) => item.automationOnly)
    .map((item) => item.questionId)
    .sort();
  if (automationOnly.length === 0) {
    throw new Error("覆核來源報告沒有 automationOnly 題目，拒絕產生空報告");
  }

  const comparison = loadRepairComparison(cwd);

  const rows = automationOnly.map((questionId) => {
    const repair = comparison.get(questionId);
    if (!repair) {
      return {
        questionId,
        revision: null,
        topicId: null,
        questionType: null,
        tier: "P2" as ProvenanceRiskTier,
        riskClass: "insufficient_original_evidence" as const,
        basis: "修復來源稽核沒有這題的比較結果（找不到原始試題檔）",
        requiresTeacherReview: true,
        classifications: [] as string[],
        notes: [] as string[],
        originalStem: null as string | null,
        currentStem: null as string | null,
        originalCorrectAnswer: null as string | null,
        currentCorrectAnswer: null as string | null,
      };
    }
    const risk = classifyProvenanceRisk(repair);
    return {
      questionId,
      revision: repair.revision,
      topicId: repair.topicId,
      questionType: repair.questionType,
      tier: risk.tier,
      riskClass: risk.riskClass,
      basis: risk.basis,
      requiresTeacherReview: risk.requiresTeacherReview,
      classifications: repair.classifications,
      notes: repair.notes,
      originalStem: repair.originalStem,
      currentStem: repair.currentStem,
      originalCorrectAnswer: repair.originalCorrectAnswer,
      currentCorrectAnswer: repair.currentCorrectAnswer,
    };
  });

  const byTier = Object.fromEntries(TIER_ORDER.map((tier) => [tier, 0])) as Record<
    ProvenanceRiskTier,
    number
  >;
  const byClass: Record<string, number> = {};
  for (const row of rows) {
    byTier[row.tier] += 1;
    byClass[row.riskClass] = (byClass[row.riskClass] ?? 0) + 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    method:
      "加入 audit:review-provenance 的 automationOnly 題目清單與 audit:repair-provenance --full 的逐題比較結果；" +
      "分級只依可核實的 diff，不採信修復腳本文字。",
    limitations: [
      "修復來源稽核只覆蓋 materials/ 內仍存在的試題檔；找不到原檔的題目列為 P2。",
      "分級是覆核排序，不是核准：P3 仍未有教師確認，只是可較後覆核。",
      "資料庫沒有保存舊版本內容，比較基準是『由原始試題檔可重建的內容』。",
    ],
    totals: {
      automationOnlyQuestions: automationOnly.length,
      comparedWithOriginal: rows.filter((row) => row.tier !== "P2").length,
      requiresTeacherReview: rows.filter((row) => row.requiresTeacherReview).length,
    },
    byTier,
    byClass,
    rows,
  };

  fs.mkdirSync(path.dirname(outBase), { recursive: true });
  fs.writeFileSync(`${outBase}.json`, JSON.stringify(report, null, 1), "utf8");

  const lines: string[] = [];
  lines.push("# 只有自動化修復證據的題目：風險分級（Sprint 11）", "");
  lines.push(`產生時間：${report.generatedAt}`, "");
  lines.push("## 範圍與方法", "");
  lines.push(
    `- 題目來源：\`${path.relative(cwd, reviewPath).replace(/\\/g, "/")}\` 的 \`automationOnly\` 題目（${automationOnly.length} 題）。`,
  );
  lines.push("- 比較依據：`npm run audit:repair-provenance -- --full`（以 `materials/` 原始試題檔重建，唯讀）。");
  lines.push("- 分級是**覆核排序**，不是核准；P3 仍未有教師確認。", "");
  lines.push("## 分級結果", "");
  lines.push("| 等級 | 題數 | 說明 |", "| --- | --- | --- |");
  for (const tier of TIER_ORDER) {
    lines.push(`| ${tier} | ${byTier[tier]} | ${TIER_LABEL[tier]} |`);
  }
  lines.push("");
  lines.push("## 分類分布", "", "| 分類 | 題數 |", "| --- | --- |");
  for (const [name, count] of Object.entries(byClass).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${name} | ${count} |`);
  }
  lines.push("");
  for (const tier of TIER_ORDER) {
    const items = rows.filter((row) => row.tier === tier);
    lines.push(`## ${tier}（${items.length} 題）`, "");
    if (items.length === 0) {
      lines.push("沒有題目。", "");
      continue;
    }
    lines.push("| 題目 | 版本 | 分類 | 判準 |", "| --- | --- | --- | --- |");
    for (const row of items.slice(0, 60)) {
      lines.push(
        `| \`${row.questionId}\` | ${row.revision ?? "?"} | ${row.riskClass} | ${row.basis} |`,
      );
    }
    if (items.length > 60) lines.push("", `（其餘 ${items.length - 60} 題見 JSON 報告。）`);
    lines.push("");
  }
  lines.push("## 限制", "");
  for (const limitation of report.limitations) lines.push(`- ${limitation}`);
  lines.push("");
  fs.writeFileSync(`${outBase}.md`, lines.join("\n"), "utf8");

  console.log("byTier", byTier);
  console.log("byClass", byClass);
  console.log(`已寫入 ${path.relative(cwd, outBase)}.json 及 .md`);
  console.log("唯讀：沒有修改題目、覆核紀錄或發布狀態。");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
