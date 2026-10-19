/**
 * 發布就緒閘門 CLI（唯讀）。
 *
 * 用法：
 *   npx tsx scripts/release-gate.ts
 *   npx tsx scripts/release-gate.ts --fail-on-not-ready   # CI 用：NOT READY 時退出碼 1
 *
 * 只讀取資料庫及既有報告；不會修改題目、覆核、發布狀態或部署設定。
 */
import fs from "node:fs";
import path from "node:path";

import { runReleaseGate } from "../src/server/quality/release-gate";

function readArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

function main(): number {
  const repo = process.cwd();
  const argv = process.argv.slice(2);
  const databasePath = path.resolve(
    readArg(argv, "--database") ?? path.join(repo, "data", "app.db"),
  );
  const outJson = path.resolve(
    readArg(argv, "--out-json") ?? path.join(repo, "docs", "release-gate-2026-10-19.json"),
  );
  const outMd = path.resolve(
    readArg(argv, "--out-md") ?? path.join(repo, "docs", "release-gate-2026-10-19.md"),
  );
  const failOnNotReady = argv.includes("--fail-on-not-ready");

  if (!fs.existsSync(databasePath)) throw new Error(`找不到資料庫：${databasePath}`);

  const run = runReleaseGate({ repoRoot: repo, databasePath });
  const { report, audit, sources } = run;

  const payload = {
    generatedAt: new Date().toISOString(),
    notice:
      "唯讀發布閘門：沒有修改題目、覆核或發布狀態。未定義標準或沒有證據的項目不會當作通過。",
    verdict: report.verdict,
    scope: sources,
    auditSummary: {
      questions: audit.totals.questions,
      published: audit.totals.published,
      teacherConfirmationRequired: audit.totals.teacherConfirmationRequired,
      source: audit.source.counts,
      explanation: audit.explanation.counts,
      metadata: {
        skillMissing: audit.metadata.skillMissing,
        bySeverity: audit.metadata.bySeverity,
        difficulty: audit.metadata.difficulty,
      },
      policy: audit.policy,
      inputFingerprint: audit.inputFingerprint,
    },
    gates: report.gates,
    deltas: report.deltas,
  };

  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const statusLabel: Record<string, string> = {
    PASS: "✅ PASS",
    FAIL: "❌ FAIL",
    WARN: "⚠️ WARN",
    POLICY_PENDING: "⏳ POLICY_PENDING",
    INSUFFICIENT_EVIDENCE: "❔ INSUFFICIENT_EVIDENCE",
  };

  const lines: string[] = [];
  lines.push("# 發布就緒閘門（2026-10-19）");
  lines.push("");
  lines.push(`**結果：${report.verdict}**`);
  lines.push("");
  lines.push("> 唯讀檢查；未定義標準或沒有證據的項目不會當作通過。");
  lines.push("");
  lines.push("| 閘門 | 狀態 | 證據摘要 | 分子／分母 |");
  lines.push("| --- | --- | --- | --- |");
  for (const gate of report.gates) {
    lines.push(
      `| ${gate.title}（${gate.id}） | ${statusLabel[gate.status]} | ${gate.summary} | ${gate.numerator ?? "—"}／${gate.denominator ?? "—"} |`,
    );
  }
  lines.push("");
  lines.push("## 與上次報告比較");
  lines.push("");
  if (report.deltas.length === 0) {
    lines.push("沒有可比較的基準。");
  } else {
    lines.push("| 指標 | 上次 | 現在 | 變化 |");
    lines.push("| --- | --- | --- | --- |");
    for (const delta of report.deltas) {
      lines.push(`| ${delta.metric} | ${delta.previous} | ${delta.current} | ${delta.change >= 0 ? "+" : ""}${delta.change} |`);
    }
  }
  lines.push("");
  lines.push("## 建議與未決政策");
  lines.push("");
  for (const gate of report.gates) {
    if (gate.status === "PASS") continue;
    lines.push(`### ${gate.title}（${gate.status}）`);
    lines.push("");
    for (const recommendation of gate.recommendations) lines.push(`- ${recommendation}`);
    lines.push("");
  }
  lines.push("## 資料來源");
  lines.push("");
  for (const [key, value] of Object.entries(sources)) {
    lines.push(`- ${key}：${value ?? "（未提供）"}`);
  }
  lines.push("");

  fs.mkdirSync(path.dirname(outMd), { recursive: true });
  fs.writeFileSync(outMd, `${lines.join("\n")}\n`, "utf8");

  console.log(`結果：${report.verdict}`);
  for (const gate of report.gates) {
    console.log(
      `${gate.status.padEnd(22)} ${gate.id} — ${gate.summary}（${gate.numerator ?? "—"}／${gate.denominator ?? "—"}）`,
    );
  }
  console.log(`已寫入：${path.relative(repo, outJson)}`);
  console.log(`已寫入：${path.relative(repo, outMd)}`);

  if (failOnNotReady && report.verdict !== "READY") return 1;
  return 0;
}

process.exit(main());
