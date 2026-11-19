/**
 * 每日（或指定日期）匯出某級別學生的一般練習作答情況為 Excel。
 *
 * 用法：
 *   npm run export:grade-daily -- --form 4 --date 2026-11-19 --out "C:\\...\\OneDrive\\匯出"
 *   npm run export:grade-daily -- --form 4 --from 2026-11-16 --to 2026-11-19 --out <資料夾>
 *   npm run export:grade-daily -- --database <本機快照> --date 2026-11-19 --out <資料夾>
 *
 * 預設由正式環境備份 bucket 以**服務帳戶金鑰**下載最新 SQLite 快照（不需要
 * `gcloud auth login`）；分析及寫檔後即刪除暫存快照。加 `--use-gcloud` 只為診斷用途。
 * 只讀取資料庫，不會修改任何練習、作答或名冊紀錄。
 *
 * 電郵派發（預設開啟）：收件人取自 `--email-to` 或 `secrets/export-mail.env` 的
 * `EXPORT_EMAIL_TO`；SMTP 設定取自同一環境檔（`EXPORT_SMTP_*`、`EXPORT_MAIL_FROM`）。
 * 兩者皆未設定時只寫本機檔案並如實說明，不會假裝已寄出。--no-email 可停用派發。
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
import { downloadGcsObject } from "./lib/gcs-service-account";
import {
  contentTypeFor,
  loadEnvFile,
  sendMail,
  smtpConfigFromEnv,
  type SmtpConfig,
} from "./lib/smtp-mail";

const PRODUCTION_BACKUP = "gs://pccss-ai-history-history-backup/history/data/app.db";
const DEFAULT_KEY_FILE = path.join("secrets", "export-reader-service-account.json");
const DEFAULT_ENV_FILE = path.join("secrets", "export-mail.env");

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

  /**
   * 正式快照預設以服務帳戶金鑰下載（不需 `gcloud auth login`，憑證不會過期）。
   * `--use-gcloud` 只為過渡或診斷之用而保留。
   */
  const useGcloud = process.argv.includes("--use-gcloud");
  const keyFile = argument("--key-file")
    ?? process.env.GOOGLE_APPLICATION_CREDENTIALS
    ?? DEFAULT_KEY_FILE;
  const gcsUri = argument("--gcs-uri") ?? PRODUCTION_BACKUP;

  if (useProduction) {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "history-grade-export-"));
    const downloaded = path.join(temporaryDirectory, "app.db.download");
    databasePath = path.join(temporaryDirectory, "app.db");
    if (useGcloud) {
      const args =
        process.platform === "win32"
          ? [
              "/d",
              "/s",
              "/c",
              `gcloud.cmd storage cp --no-user-output-enabled ${gcsUri} ${downloaded}`,
            ]
          : ["storage", "cp", "--no-user-output-enabled", gcsUri, downloaded];
      execFileSync(process.platform === "win32" ? "cmd.exe" : "gcloud", args, {
        stdio: ["ignore", "ignore", "inherit"],
      });
    } else {
      fs.writeFileSync(downloaded, await downloadGcsObject(gcsUri, path.resolve(keyFile)));
    }

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

    // ── 電郵派發 ────────────────────────────────────────────────────────
    if (!process.argv.includes("--no-email")) {
      const envFile = path.resolve(argument("--env-file") ?? DEFAULT_ENV_FILE);
      const fileEnv = loadEnvFile(envFile);
      const lookup = (name: string): string | undefined =>
        process.env[name] ?? fileEnv[name] ?? undefined;

      const recipients = (argument("--email-to") ?? lookup("EXPORT_EMAIL_TO") ?? "")
        .split(/[;,]/)
        .map((value) => value.trim())
        .filter(Boolean);

      if (recipients.length === 0) {
        console.log("未設定收件人（--email-to 或 EXPORT_EMAIL_TO），已略過電郵派發。");
      } else {
        const resolved = smtpConfigFromEnv({
          EXPORT_SMTP_HOST: lookup("EXPORT_SMTP_HOST"),
          EXPORT_SMTP_PORT: lookup("EXPORT_SMTP_PORT"),
          EXPORT_SMTP_SECURE: lookup("EXPORT_SMTP_SECURE"),
          EXPORT_SMTP_USER: lookup("EXPORT_SMTP_USER"),
          EXPORT_SMTP_PASSWORD: lookup("EXPORT_SMTP_PASSWORD"),
          EXPORT_SMTP_ALLOW_PLAINTEXT: lookup("EXPORT_SMTP_ALLOW_PLAINTEXT"),
          EXPORT_MAIL_FROM: lookup("EXPORT_MAIL_FROM"),
        });
        if ("error" in resolved) {
          fail(`電郵設定不完整：${resolved.error}（設定檔：${envFile}）`);
        }
        const config: SmtpConfig = resolved.config;
        const dateLabel = from === to ? from : `${from} 至 ${to}`;
        const subject =
          argument("--email-subject") ??
          lookup("EXPORT_MAIL_SUBJECT")?.replaceAll("{date}", dateLabel) ??
          `中${numeral} 每日作答情況（${dateLabel}）`;
        const body = [
          `中${numeral}每日作答情況（${dateLabel}，香港時間）`,
          "",
          `名冊學生：${report.totals.students} 位（當日有一般練習 ${report.totals.activeStudents} 位）`,
          `一般練習：${report.totals.sessions} 次`,
          `作答題數：${report.totals.answeredQuestions}／${report.totals.assignedQuestions} 題`,
          `答對：${report.totals.correct} 題；答錯：${report.totals.wrong} 題`,
          `準確率：${report.totals.accuracy === null ? "—" : `${(report.totals.accuracy * 100).toFixed(1)}%`}`,
          "",
          "各班主任／教師可按附件「總表」或各班分表核對。",
          "口徑：只計一般練習；重溫錯題不計入練習次數、作答題數及準確率。",
        ].join("\r\n");

        await sendMail(config, {
          from: lookup("EXPORT_MAIL_FROM")!,
          to: recipients,
          subject,
          text: body,
          attachments: [
            {
              filename: fileName,
              contentType: contentTypeFor(fileName),
              content: buffer,
            },
          ],
        });
        console.log(`已以電郵派發給 ${recipients.length} 位收件人（${subject}）。`);
      }
    }
  } finally {
    if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
