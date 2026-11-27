/**
 * 匯出「上週欠交＋本週每日配額」的應補報告（Excel）。
 *
 * 用法：
 *   npm run report:grade-makeup -- --form 4 --out "C:\...\學習記錄匯出"
 *   npm run report:grade-makeup -- --now 2026-11-27T09:30:00+08:00 --include-today
 *   npm run report:grade-makeup -- --database data/app.db --json
 *
 * 口徑（2026-11-27 使用者決定）：
 *   - 上週（星期一至五）每人應完成 50 題，不足的差額 ×2；
 *   - 本週每工作日應完成 10 題，**星期一不計**；但學生在星期一的作答仍計入本週已做；
 *   - 本週已做先滿足本週應做，超出部分才抵銷上週雙計欠數；今日（未結束）預設不計。
 *
 * 資料來源：預設以服務帳戶金鑰下載正式備份快照（不需要 `gcloud auth login`），
 * 分析後刪除；`--database <檔案>` 可用本機資料庫。全程唯讀，不會修改任何紀錄。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { openReadOnlyDatabase } from "../src/server/db/connection";
import { buildXlsx, type CellValue, type SheetSpec } from "../src/server/export/office";
import {
  addHongKongDays,
  hongKongDate,
  hongKongDateTime,
  hongKongWeekStart,
} from "../src/server/services/grade-practice-export";
import { buildGradeMakeupReport } from "../src/server/services/grade-makeup-report";
import { downloadGcsObject } from "./lib/gcs-service-account";

const PRODUCTION_BACKUP = "gs://pccss-ai-history-history-backup/history/data/app.db";
const DEFAULT_KEY_FILE = path.join("secrets", "export-reader-service-account.json");

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : null;
}

function fail(message: string): never {
  throw new Error(message);
}

async function main(): Promise<void> {
  const formLevel = (argument("--form") ?? "4").trim();
  if (!/^[1-6]$/.test(formLevel)) fail("--form 必須是 1 至 6（例如 --form 4 代表中四）");

  const nowArgument = argument("--now");
  const now = nowArgument === null ? new Date() : new Date(nowArgument);
  if (Number.isNaN(now.getTime())) fail("--now 必須是可解析的時間，例如 2026-11-27T09:30:00+08:00");

  const includeToday = process.argv.includes("--include-today");
  const includeMonday = process.argv.includes("--include-monday");

  const today = hongKongDate(now);
  const weekStart = hongKongWeekStart(now);
  const mondayDate = includeMonday ? null : weekStart;

  // 上週＝上一個日曆週的星期一至五
  const lastWeekFrom = addHongKongDays(weekStart, -7);
  const lastWeekTo = addHongKongDays(lastWeekFrom, 4);

  // 本週每日配額的日子：星期二起（星期一不計），預設只計已完結的日子
  const weekDays = Array.from({ length: 7 }, (_, index) => addHongKongDays(weekStart, index));
  const countedDays = weekDays.filter((day) => {
    if (day === weekStart && !includeMonday) return false;
    return includeToday ? day <= today : day < today;
  });
  // 本週已做總數：由星期一（或本週第一天）至最後一個計入日
  const lastCounted = countedDays.at(-1) ?? addHongKongDays(weekStart, -1);
  const creditedDays = weekDays.filter((day) => day <= lastCounted);
  if (creditedDays.length === 0 && !includeToday) {
    // 星期一當日執行：本週還沒有任何已完結的日子，仍以星期一作抵銷來源
    creditedDays.push(weekStart);
  }

  const outDir = path.resolve(argument("--out") ?? path.join("data", "exports"));
  fs.mkdirSync(outDir, { recursive: true });

  const useProduction = !argument("--database");
  const keyFile = argument("--key-file") ?? process.env.GOOGLE_APPLICATION_CREDENTIALS ?? DEFAULT_KEY_FILE;
  const gcsUri = argument("--gcs-uri") ?? PRODUCTION_BACKUP;
  let temporaryDirectory: string | null = null;
  let databasePath = argument("--database") ? path.resolve(argument("--database")!) : "";

  if (useProduction) {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "history-makeup-"));
    const downloaded = path.join(temporaryDirectory, "app.db.download");
    databasePath = path.join(temporaryDirectory, "app.db");
    fs.writeFileSync(downloaded, await downloadGcsObject(gcsUri, path.resolve(keyFile)));
    const payload = fs.readFileSync(downloaded);
    const gzip = payload[0] === 0x1f && payload[1] === 0x8b;
    fs.writeFileSync(databasePath, gzip ? gunzipSync(payload) : payload);
    fs.rmSync(downloaded);
  }

  try {
    const database = openReadOnlyDatabase(databasePath);
    let report: ReturnType<typeof buildGradeMakeupReport>;
    try {
      report = buildGradeMakeupReport(database, {
        formLevel,
        lastWeekFrom,
        lastWeekTo,
        countedDays,
        creditedDays,
        mondayDate,
        activeOnly: !process.argv.includes("--all"),
      });
    } finally {
      database.close();
    }

    if (report.rows.length === 0) {
      fail(`名冊沒有 ${formLevel} 年級（${formLevel}A–${formLevel}Z）的學生，未產生檔案。`);
    }

    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
    }

    const numeral = ["一", "二", "三", "四", "五", "六"][Number(formLevel) - 1];
    const studentColumns = [
      "班別",
      "班號",
      "姓名",
      "上週獲派",
      "上週作答",
      "上週欠題",
      "上週欠數（×2）",
      ...creditedDays.map((day) => `${day.slice(5)} 作答`),
      "本週已做",
      "本週應做",
      "本週欠數",
      "可抵上週",
      "尚欠題數",
      "應補次數（每節10題）",
    ];
    const studentRows: CellValue[][] = report.rows.map((row) => [
      row.className,
      row.studentNumber,
      row.name,
      row.lastWeekAssigned,
      row.lastWeekAnswered,
      row.lastWeekShortfall,
      row.weeklyMakeup,
      ...row.dailyAnswered.map((entry) => entry.answered),
      row.currentWeekAnswered,
      row.currentWeekDue,
      row.currentWeekShortfall,
      row.creditedAgainstMakeup,
      row.remaining,
      row.remainingSessions,
    ]);

    const classNames = [...new Set(report.rows.map((row) => row.className))].sort((left, right) =>
      left.localeCompare(right, "zh-HK", { numeric: true }),
    );
    const classRows: CellValue[][] = classNames.map((className) => {
      const members = report.rows.filter((row) => row.className === className);
      return [
        className,
        members.length,
        members.filter((row) => row.weeklyMakeup > 0 || row.currentWeekAnswered > 0).length,
        members.filter((row) => row.remaining > 0).length,
        members.reduce((sum, row) => sum + row.weeklyMakeup, 0),
        members.reduce((sum, row) => sum + row.currentWeekShortfall, 0),
        members.reduce((sum, row) => sum + row.remaining, 0),
        members.reduce((sum, row) => sum + row.remainingSessions, 0),
      ];
    });
    classRows.push([
      "合計",
      report.totals.students,
      report.totals.studentsWithActivity,
      report.totals.studentsOwing,
      report.totals.weeklyMakeup,
      report.totals.currentWeekShortfall,
      report.totals.remaining,
      report.totals.remainingSessions,
    ]);

    const sheets: SheetSpec[] = [
      {
        name: "說明",
        columns: ["項目", "內容"],
        rows: [
          ["產生時間（香港時間）", hongKongDateTime(new Date().toISOString())],
          ["年級", `中${numeral}（${formLevel}A–${formLevel}Z）`],
          ["上週統計期間", `${report.lastWeek.from} 至 ${report.lastWeek.to}（星期一至五）`],
          ["上週配額", `每人 ${report.weeklyQuota} 題（星期一至五）；不足的差額 ×2 計`],
          [
            "本週計入配額的日子",
            report.countedDays.length === 0
              ? "（尚未有已完結的日子）"
              : report.countedDays.join("、"),
          ],
          [
            "本週每日配額",
            `每個計入日 ${report.dailyTarget} 題（共 ${report.countedDays.length * report.dailyTarget} 題）；星期一不計入配額，但星期一的作答仍計入本週已做總數`,
          ],
          ["抵銷規則", "本週已做先滿足本週應做，超出部分才抵銷上週雙計欠數；抵銷後多出的不累積"],
          ["應補次數", "尚欠題數 ÷ 10，向上取整（0 表示已清零）"],
          ["口徑", "只計一般練習；重溫錯題不計入；只計已作答（答案非空白）的題目"],
          [
            "資料來源",
            useProduction ? "正式環境備份（gs://pccss-ai-history-history-backup）" : databasePath,
          ],
          [
            "備註",
            `只列上週或本週有練習紀錄的學生（名冊共 ${report.totals.rosterStudents} 位，其餘 ` +
              `${report.totals.rosterStudents - report.totals.studentsWithActivity} 位本週及上週均無練習，未列入；` +
              "加 --all 可列出完整名冊）。上週獲派題目少於 50 題者，即使全部完成仍會顯示欠數——" +
              "這屬派題不足，不是學生欠交。",
          ],
        ],
        widths: [26, 96],
      },
      {
        name: "學生統計",
        columns: studentColumns,
        rows: studentRows,
        widths: [8, 8, 12, 10, 10, 10, 13, ...creditedDays.map(() => 11), 10, 10, 10, 10, 10, 14],
      },
      {
        name: "班別彙總",
        columns: [
          "班別",
          "名冊人數",
          "有練習人數",
          "尚欠人數",
          "上週雙計欠數",
          "本週欠數",
          "尚欠題數",
          "應補節數",
        ],
        rows: classRows,
        widths: [10, 11, 12, 11, 14, 11, 11, 11],
      },
    ];

    const buffer = await buildXlsx(sheets, { title: `中${numeral} 練習欠交及應補（${today}）` });
    const fileName = `中${numeral}_欠交統計_${today}.xlsx`;
    const target = path.join(outDir, fileName);
    fs.writeFileSync(target, buffer);
    console.log(
      `已匯出 ${report.totals.students} 位學生（有練習 ${report.totals.studentsWithActivity} 位、` +
        `尚欠 ${report.totals.studentsOwing} 位、合計 ${report.totals.remaining} 題／` +
        `${report.totals.remainingSessions} 節）到 ${target}`,
    );
  } finally {
    if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
