import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { openReadOnlyDatabase } from "../src/server/db/connection";
import {
  buildPlatformUsageReport,
  type PlatformUsageReport,
} from "../src/server/services/platform-usage-report";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] && !process.argv[index + 1]!.startsWith("--")
    ? process.argv[index + 1]!
    : null;
}

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function printHuman(report: PlatformUsageReport): void {
  console.log("AI History Platform 使用情況");
  console.log(
    `範圍：${report.filters.from ?? report.databaseRange.from ?? "最早"} 至 ` +
      `${report.filters.to ?? report.databaseRange.to ?? "最新"}（香港時間）`,
  );
  console.log(
    `練習 ${report.overall.sessions} 次｜學生 ${report.overall.learners} 位｜` +
      `作答 ${report.overall.answeredQuestions}／${report.overall.assignedQuestions} 題｜` +
      `準確率 ${percent(report.overall.accuracy)}`,
  );
  console.log("");
  console.log("練習類型");
  for (const row of report.byMode) {
    console.log(
      `  ${row.label}：${row.sessions} 次、${row.answeredQuestions} 題、準確率 ${percent(row.accuracy)}`,
    );
  }
  console.log("");
  console.log("題目來源");
  for (const row of report.byOrigin) {
    console.log(
      `  ${row.label}：${row.sessions} 次、${row.answeredQuestions} 題、準確率 ${percent(row.accuracy)}`,
    );
  }
  console.log("");
  console.log("學生");
  for (const row of report.byStudent) {
    const identity = [row.className, row.studentNumber].filter(Boolean).join("・");
    console.log(
      `  ${row.name || row.learnerId}${identity ? `（${identity}）` : ""}：` +
        `${row.sessions} 次、${row.answeredQuestions} 題、準確率 ${percent(row.accuracy)}`,
    );
  }
  console.log("");
  console.log("錯題重溫成效");
  console.log(
    `  重溫 ${report.reviewEffectiveness.answeredQuestions} 題，正確 ` +
      `${report.reviewEffectiveness.correct} 題，準確率 ` +
      `${percent(report.reviewEffectiveness.accuracy)}；可配對原錯題 ` +
      `${report.reviewEffectiveness.improvedQuestions}／` +
      `${report.reviewEffectiveness.matchedPriorQuestions} 題改善`,
  );
  console.log("");
  console.log("完整班別、課題及每日數據請加 --json，供 Copilot 直接分析。");
}

async function main(): Promise<void> {
  const production = process.argv.includes("--production");
  const productionBackup = "gs://pccss-ai-history-history-backup/history/data/app.db";
  let temporaryDirectory: string | null = null;
  let databasePath = path.resolve(argument("--database") ?? "data/app.db");
  if (production && argument("--database")) {
    throw new Error("--production 不可與 --database 同時使用");
  }
  if (production) {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "history-usage-report-"));
    const downloaded = path.join(temporaryDirectory, "app.db.download");
    databasePath = path.join(temporaryDirectory, "app.db");
    const downloadArgs =
      process.platform === "win32"
        ? [
            "/d",
            "/s",
            "/c",
            `gcloud.cmd storage cp ${productionBackup} ${downloaded}`,
          ]
        : ["storage", "cp", productionBackup, downloaded];
    execFileSync(process.platform === "win32" ? "cmd.exe" : "gcloud", downloadArgs, {
      stdio: ["ignore", "ignore", "inherit"],
    });
    const payload = fs.readFileSync(downloaded);
    const isGzip = payload[0] === 0x1f && payload[1] === 0x8b;
    fs.writeFileSync(databasePath, isGzip ? gunzipSync(payload) : payload);
    fs.rmSync(downloaded);
  }
  const from = argument("--from");
  const to = argument("--to");
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("--from 必須是 YYYY-MM-DD");
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error("--to 必須是 YYYY-MM-DD");
  if (from && to && from > to) throw new Error("--from 不可晚於 --to");

  try {
    const database = openReadOnlyDatabase(databasePath);
    try {
      const report = buildPlatformUsageReport(database, { from, to });
      if (process.argv.includes("--json")) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printHuman(report);
      }
    } finally {
      database.close();
    }
  } finally {
    if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
