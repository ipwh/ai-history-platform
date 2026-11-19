/**
 * 每日（或指定日期）匯出某級別學生的一般練習作答情況為 Excel。
 *
 * 用法：
 *   npm run export:grade-daily -- --form 4 --date 2026-11-19 --out "C:\\...\\OneDrive\\匯出"
 *   npm run export:grade-daily -- --form 4 --from 2026-11-16 --to 2026-11-19 --out <資料夾>
 *   npm run export:grade-daily -- --database <本機快照> --date 2026-11-19 --out <資料夾>
 *
 * 預設由正式環境備份 bucket 下載最新 SQLite 快照（`--production`）；分析及寫檔後即刪除暫存
 * 快照。只讀取資料庫，不會修改任何練習、作答或名冊紀錄。
 *
 * 輸出：
 *   - 「總表」：全年級逐位學生（按班別、班號排序），當日沒有練習亦會列出 0 次；
 *   - 每個班別一張工作表（例如 4A、4B）；
 *   - 「說明」：統計日期、口徑及產生時間。
 *
 * 口徑：只計一般練習（`mode = 'standard'`），**不計重溫錯題**。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { openReadOnlyDatabase } from "../src/server/db/connection";
import { buildXlsx, type CellValue, type SheetSpec } from "../src/server/export/office";
import {
  buildGradePracticeExport,
  hongKongDate,
  hongKongDateTime,
  type GradePracticeRow,
} from "../src/server/services/grade-practice-export";

const PRODUCTION_BACKUP = "gs://pccss-ai-history-history-backup/history/data/app.db";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : null;
}

function fail(message: string): never {
  throw new Error(message);
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function percent(value: number | null): CellValue {
  return value === null ? "—" : Number((value * 100).toFixed(1));
}

const STUDENT_COLUMNS = [
  "班別",
  "班號",
  "姓名",
  "電郵",
  "一般練習次數",
  "獲派題目",
  "已作答",
  "未作答",
  "答對",
  "答錯",
  "準確率（%）",
  "最後練習時間",
];

function studentRows(rows: GradePracticeRow[]): CellValue[][] {
  return rows.map((row) => [
    row.className,
    row.studentNumber,
    row.name,
    row.email,
    row.sessions,
    row.assignedQuestions,
    row.answeredQuestions,
    Math.max(0, row.assignedQuestions - row.answeredQuestions),
    row.correct,
    row.wrong,
    percent(row.accuracy),
    hongKongDateTime(row.lastPractisedAt),
  ]);
}

async function main(): Promise<void> {
  const formLevel = (argument("--form") ?? "4").trim();
  if (!/^[1-6]$/.test(formLevel)) fail("--form 必須是 1 至 6（例如 --form 4 代表中四）");

  const today = hongKongDate();
  const date = argument("--date");
  const from = argument("--from") ?? date ?? today;
  const to = argument("--to") ?? date ?? today;
  if (!isDate(from) || !isDate(to)) fail("--date／--from／--to 必須是 YYYY-MM-DD");
  if (from > to) fail("--from 不可晚於 --to");

  const outDir = path.resolve(argument("--out") ?? path.join("data", "exports"));
  fs.mkdirSync(outDir, { recursive: true });

  const useProduction = !argument("--database");
  let temporaryDirectory: string | null = null;
  let databasePath = argument("--database")
    ? path.resolve(argument("--database")!)
    : "";

  if (useProduction) {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "history-grade-export-"));
    const downloaded = path.join(temporaryDirectory, "app.db.download");
    databasePath = path.join(temporaryDirectory, "app.db");
    const args =
      process.platform === "win32"
        ? [
            "/d",
            "/s",
            "/c",
            `gcloud.cmd storage cp --no-user-output-enabled ${PRODUCTION_BACKUP} ${downloaded}`,
          ]
        : ["storage", "cp", "--no-user-output-enabled", PRODUCTION_BACKUP, downloaded];
    execFileSync(process.platform === "win32" ? "cmd.exe" : "gcloud", args, {
      stdio: ["ignore", "ignore", "inherit"],
    });
    const payload = fs.readFileSync(downloaded);
    const gzip = payload[0] === 0x1f && payload[1] === 0x8b;
    fs.writeFileSync(databasePath, gzip ? gunzipSync(payload) : payload);
    fs.rmSync(downloaded);
  }

  try {
    const database = openReadOnlyDatabase(databasePath);
    let report: ReturnType<typeof buildGradePracticeExport>;
    try {
      report = buildGradePracticeExport(database, { formLevel, from, to });
    } finally {
      database.close();
    }

    if (report.rows.length === 0) {
      fail(`名冊沒有 ${formLevel} 年級（${formLevel}A–${formLevel}Z）的學生，未產生檔案。`);
    }

    const summaryRows: CellValue[][] = report.classes.map((entry) => [
      entry.className,
      entry.students,
      entry.activeStudents,
      entry.sessions,
      entry.assignedQuestions,
      entry.answeredQuestions,
      entry.correct,
      entry.wrong,
      percent(entry.accuracy),
    ]);
    summaryRows.push([
      "合計",
      report.totals.students,
      report.totals.activeStudents,
      report.totals.sessions,
      report.totals.assignedQuestions,
      report.totals.answeredQuestions,
      report.totals.correct,
      report.totals.wrong,
      percent(report.totals.accuracy),
    ]);

    const numeral = ["一", "二", "三", "四", "五", "六"][Number(formLevel) - 1];
    const sheets: SheetSpec[] = [
      {
        name: "說明",
        columns: ["項目", "內容"],
        rows: [
          ["統計日期（香港時間）", from === to ? from : `${from} 至 ${to}`],
          ["年級", `中${numeral}（${formLevel}A–${formLevel}Z）`],
          ["口徑", "只計一般練習；重溫錯題（wrong-only）不計入練習次數、作答題數及準確率"],
          ["學生人數", `${report.totals.students} 位（當日有練習 ${report.totals.activeStudents} 位）`],
          ["練習次數", report.totals.sessions],
          ["已作答題數", report.totals.answeredQuestions],
          ["準確率（%）", percent(report.totals.accuracy)],
          ["產生時間（香港時間）", hongKongDateTime(new Date().toISOString())],
          ["資料來源", useProduction ? "正式環境備份（gs://pccss-ai-history-history-backup）" : databasePath],
          ["備註", "當日沒有練習的學生仍會列出（0 次），方便教師核對未提交的學生。"],
        ],
        widths: [28, 90],
      },
      {
        name: "總表",
        columns: STUDENT_COLUMNS,
        rows: studentRows(report.rows),
        widths: [8, 8, 12, 30, 12, 10, 9, 9, 8, 8, 12, 18],
      },
      {
        name: "班別統計",
        columns: [
          "班別",
          "學生人數",
          "有練習人數",
          "一般練習次數",
          "獲派題目",
          "已作答",
          "答對",
          "答錯",
          "準確率（%）",
        ],
        rows: summaryRows,
        widths: [10, 10, 12, 14, 10, 9, 8, 8, 12],
      },
      ...report.classes.map((entry) => ({
        name: entry.className,
        columns: STUDENT_COLUMNS,
        rows: studentRows(report.rows.filter((row) => row.className === entry.className)),
        widths: [8, 8, 12, 30, 12, 10, 9, 9, 8, 8, 12, 18],
      })),
    ];

    const buffer = await buildXlsx(sheets, { title: `中${numeral} 每日作答情況` });
    const fileName = `中${numeral}_每日作答_${from === to ? from : `${from}_至_${to}`}.xlsx`;
    const target = path.join(outDir, fileName);
    // 同一天重跑時覆寫（排程重試不應堆疊重複檔案）
    fs.writeFileSync(target, buffer);
    console.log(
      `已匯出 ${report.rows.length} 位學生（${report.totals.activeStudents} 位有練習）到 ${target}`,
    );
  } finally {
    if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
