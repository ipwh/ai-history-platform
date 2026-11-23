/**
 * 每日（或指定日期）匯出某級別學生的一般練習作答情況為 Excel。
 *
 * 用法：
 *   npm run export:grade-daily -- --form 4 --schedule --out "C:\\...\\OneDrive\\匯出"
 *   npm run export:grade-daily -- --form 4 --date 2026-11-19 --out <資料夾>
 *   npm run export:grade-daily -- --form 4 --from 2026-11-16 --to 2026-11-19 --out <資料夾>
 *   npm run export:grade-daily -- --database <本機快照> --date 2026-11-19 --out <資料夾>
 *
 * `--schedule` 是排程（逢星期一至五 07:45）使用的交付規則，由執行日決定統計期間：
 *   - 星期一：上一個工作週（上星期一至五）；
 *   - 星期二至五：前一日，以及本週一至前一日的累計。
 * 只給 `--date`／`--from`／`--to`／`--week` 時，則匯出單一自訂期間（手動或診斷用）。
 *
 * 預設由正式環境備份 bucket 以**服務帳戶金鑰**下載最新 SQLite 快照（不需要
 * `gcloud auth login`）；分析及寫檔後即刪除暫存快照。加 `--use-gcloud` 只為診斷用途。
 * 只讀取資料庫，不會修改任何練習、作答或名冊紀錄。
 *
 * 電郵派發（預設開啟）：收件人取自 `--email-to` 或 `secrets/export-mail.env` 的
 * `EXPORT_EMAIL_TO`；SMTP 設定取自同一環境檔（`EXPORT_SMTP_*`、`EXPORT_MAIL_FROM`）。
 * 兩者皆未設定時只寫本機檔案並如實說明，不會假裝已寄出。--no-email 可停用派發。
 * `--print-email` 會先把主旨及正文印到主控台（不會改變是否寄出），方便核對格式。
 *
 * 輸出：
 *   - 「說明」：交付規則、統計期間、口徑及產生時間；
 *   - 每個統計期間一張「總表」：全年級逐位學生（按班別、班號排序），沒有練習亦會列出 0 次；
 *   - 每個統計期間、每個班別一張工作表（例如「4A 前一日」）；
 *   - 「班別統計」：各期間的班別彙總。
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
  buildGradePracticeSections,
  formatPracticeDigest,
  hongKongDate,
  hongKongDateTime,
  hongKongWeekStart,
  practiceSectionSummary,
  PRACTICE_TABLE_COLUMNS,
  practiceTableRows,
  type GradePracticeExport,
  type GradePracticeRow,
} from "../src/server/services/grade-practice-export";
import { renderPracticeTableJpeg } from "./lib/table-image";
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

/** 交付的一個統計期間（`--schedule` 由執行日推導；手動模式只有一個） */
interface ExportSection {
  label: string;
  rangeLabel: string;
  from: string;
  to: string;
  report: GradePracticeExport;
}

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

const STUDENT_WIDTHS = [8, 8, 12, 30, 12, 10, 9, 9, 8, 8, 12, 18];

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
  // --week：本週一（香港時間）至今日的累計（手動或診斷用）
  const weekToDate = process.argv.includes("--week");
  // --schedule：排程交付規則（星期一＝上週一至五；星期二至五＝前一日＋本週累計）
  const scheduled = process.argv.includes("--schedule");
  // --now：只為診斷而模擬執行日（不可與 --date／--from／--to 同時使用）
  const nowArgument = argument("--now");
  const simulatedNow = nowArgument === null ? null : new Date(nowArgument);
  if (simulatedNow !== null && Number.isNaN(simulatedNow.getTime())) {
    fail("--now 必須是可解析的時間，例如 --now 2026-11-25T07:45:00+08:00");
  }
  if (simulatedNow !== null && !scheduled) {
    fail("--now 只可配合 --schedule 使用（模擬排程的執行日）。");
  }
  const runDate = simulatedNow === null ? today : hongKongDate(simulatedNow);
  const from = argument("--from") ?? date ?? (weekToDate ? hongKongWeekStart() : today);
  const to = argument("--to") ?? date ?? today;
  if (!isDate(from) || !isDate(to)) fail("--date／--from／--to 必須是 YYYY-MM-DD");
  if (from > to) fail("--from 不可晚於 --to");
  if (scheduled && (date !== null || argument("--from") !== null || argument("--to") !== null)) {
    fail("--schedule 會按執行日自動決定統計期間，不可同時指定 --date／--from／--to。");
  }

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
    let sections: ExportSection[];
    try {
      sections = scheduled
        ? buildGradePracticeSections(database, { formLevel, now: simulatedNow ?? undefined }).map(
            (section) => ({
            label: section.period.label,
            rangeLabel: section.period.rangeLabel,
            from: section.period.from,
            to: section.period.to,
            report: section.report,
          }))
        : [
            {
              label: weekToDate ? "本週累計" : "每日作答情況",
              rangeLabel: from === to ? from.slice(5) : `${from.slice(5)} 至 ${to.slice(5)}`,
              from,
              to,
              report: buildGradePracticeExport(database, { formLevel, from, to }),
            },
          ];
    } finally {
      database.close();
    }

    if (sections.some((section) => section.report.rows.length === 0)) {
      fail(`名冊沒有 ${formLevel} 年級（${formLevel}A–${formLevel}Z）的學生，未產生檔案。`);
    }

    // --json：印出結構化結果（供 Copilot 或教師逐項核對，不必解析 Excel）
    if (process.argv.includes("--json")) {
      console.log(
        JSON.stringify(
          {
            formLevel,
            generatedAt: new Date().toISOString(),
            sections: sections.map((section) => ({
              label: section.label,
              from: section.from,
              to: section.to,
              report: section.report,
            })),
          },
          null,
          2,
        ),
      );
    }

    const numeral = ["一", "二", "三", "四", "五", "六"][Number(formLevel) - 1];
    const multi = sections.length > 1;
    const summaryRows: CellValue[][] = [];
    for (const section of sections) {
      const { report } = section;
      const prefix: CellValue[] = multi ? [`${section.label}（${section.rangeLabel}）`] : [];
      for (const entry of report.classes) {
        summaryRows.push([
          ...prefix,
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
      }
      summaryRows.push([
        ...prefix,
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
    }

    const describeSection = (section: ExportSection): string =>
      `${section.label}：${
        section.from === section.to ? section.from : `${section.from} 至 ${section.to}`
      }`;

    const infoRows: CellValue[][] = [
      ["交付日（香港時間）", runDate],
      ["年級", `中${numeral}（${formLevel}A–${formLevel}Z）`],
      ["統計期間", sections.map(describeSection).join("；")],
      ...(scheduled
        ? [
            [
              "交付規則",
              "星期一：上星期一至五；星期二至五：前一日＋本週一至前一日的累計",
            ] as CellValue[],
          ]
        : []),
      ["口徑", "只計一般練習；重溫錯題（wrong-only）不計入練習次數、作答題數及準確率"],
      ...sections.flatMap((section) => [
        [
          `摘要：${section.label}（${section.rangeLabel}）`,
          practiceSectionSummary(section.report),
        ] as CellValue[],
      ]),
      ["產生時間（香港時間）", hongKongDateTime(new Date().toISOString())],
      ["資料來源", useProduction ? "正式環境備份（gs://pccss-ai-history-history-backup）" : databasePath],
      ["備註", "沒有練習的學生仍會列出（0 次），方便教師核對未提交的學生。"],
    ];

    const sheets: SheetSpec[] = [
      { name: "說明", columns: ["項目", "內容"], rows: infoRows, widths: [32, 96] },
      ...sections.map((section) => ({
        name: `${section.label} ${section.rangeLabel}`,
        columns: STUDENT_COLUMNS,
        rows: studentRows(section.report.rows),
        widths: STUDENT_WIDTHS,
      })),
      {
        name: "班別統計",
        columns: [
          ...(multi ? ["期間"] : []),
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
        widths: multi ? [26, 10, 10, 12, 14, 10, 9, 8, 8, 12] : [10, 10, 12, 14, 10, 9, 8, 8, 12],
      },
      ...sections.flatMap((section) =>
        section.report.classes.map((entry) => ({
          name: `${entry.className} ${section.label}`,
          columns: STUDENT_COLUMNS,
          rows: studentRows(section.report.rows.filter((row) => row.className === entry.className)),
          widths: STUDENT_WIDTHS,
        })),
      ),
    ];

    const workbookTitle = scheduled
      ? `中${numeral} 一般練習情況（${sections.map((section) => section.label).join("＋")}）`
      : `中${numeral} ${weekToDate ? "本週累計" : "每日作答情況"}`;
    const buffer = await buildXlsx(sheets, { title: workbookTitle });
    // 排程檔名與主旨維持不變（2026-11-23 使用者指示），變的是檔內的統計期間。
    const fileName = scheduled || weekToDate
      ? `中${numeral}_本週累計_${scheduled ? runDate : to}.xlsx`
      : `中${numeral}_每日作答_${from === to ? from : `${from}_至_${to}`}.xlsx`;
    const target = path.join(outDir, fileName);
    // 同一天重跑時覆寫（排程重試不應堆疊重複檔案）
    fs.writeFileSync(target, buffer);
    console.log(
      `已匯出 ${sections.length} 個統計期間（${sections
        .map(
          (section) =>
            `${section.label} ${section.report.totals.activeStudents}/${section.report.totals.students} 位有練習`,
        )
        .join("；")}）到 ${target}`,
    );

    // ── JPG（存檔及分享用；與電郵正文同一份表格）──────────────────────
    const jpgName = fileName.replace(/\.xlsx$/, ".jpg");
    const jpgPath = path.join(outDir, jpgName);
    let jpgBuffer: Buffer | null = null;
    let jpgError: string | null = null;
    if (!process.argv.includes("--no-jpg")) {
      try {
        await renderPracticeTableJpeg(
          {
            title: workbookTitle,
            subtitle: `交付日：${runDate}（香港時間）`,
            summary: [],
            heading: `${sections[0]!.label}（${sections[0]!.rangeLabel}）— ${practiceSectionSummary(
              sections[0]!.report,
            )}`,
            columns: [...PRACTICE_TABLE_COLUMNS],
            rows: practiceTableRows(sections[0]!.report.rows),
            extraTables: sections.slice(1).map((section) => ({
              heading: `${section.label}（${section.rangeLabel}）— ${practiceSectionSummary(section.report)}`,
              columns: [...PRACTICE_TABLE_COLUMNS],
              rows: practiceTableRows(section.report.rows),
            })),
            notes: [
              ...(multi
                ? sections.map(
                    (section, index) =>
                      `${index === 0 ? "第一段" : `第${index + 1}段`}＝${section.label}（${section.rangeLabel}）：${
                        section.report.totals.activeStudents
                      } 位有練習。`,
                  )
                : []),
              "只列有練習紀錄的學生；完整名冊（含 0 次）見附件 Excel。",
              "口徑：只計一般練習；重溫錯題不計入練習次數、作答題數及準確率。",
              `準確率低於 60% 以紅色顯示（共 ${sections.reduce(
                (sum, section) =>
                  sum +
                  section.report.rows.filter(
                    (row) => row.sessions > 0 && row.accuracy !== null && row.accuracy < 0.6,
                  ).length,
                0,
              )} 人次）。`,
            ],
          },
          jpgPath,
        );
        jpgBuffer = fs.readFileSync(jpgPath);
        console.log(`已產生 JPG：${jpgPath}`);
      } catch (error) {
        jpgError = error instanceof Error ? error.message : String(error);
        console.error(`警告：${jpgError}（Excel 已產生，電郵仍會派發 Excel）`);
      }
    }

    // ── 電郵派發 ────────────────────────────────────────────────────────
    // `--print-email` 只印正文（可配合 --no-email 核對格式而不寄出）。
    const printEmail = process.argv.includes("--print-email");
    if (!process.argv.includes("--no-email") || printEmail) {
      const envFile = path.resolve(argument("--env-file") ?? DEFAULT_ENV_FILE);
      const fileEnv = loadEnvFile(envFile);
      const lookup = (name: string): string | undefined =>
        process.env[name] ?? fileEnv[name] ?? undefined;

      const dateLabel = from === to ? from : `${from} 至 ${to}`;
      // 主旨維持不變：`中四 本週累計（<交付日>）`
      const subject =
        argument("--email-subject") ??
        lookup("EXPORT_MAIL_SUBJECT")?.replaceAll("{date}", scheduled ? runDate : dateLabel) ??
        `中${numeral} ${weekToDate || scheduled ? "本週累計" : "每日作答情況"}（${
          scheduled ? runDate : dateLabel
        }）`;
      const digest = formatPracticeDigest(
        sections.map((section) => ({ period: section, report: section.report })),
      );
      const body = [
        `中${numeral}一般練習情況（交付日 ${runDate}，香港時間）`,
        ...(scheduled
          ? ["交付規則：星期一為上星期一至五；星期二至五為前一日及本週一至前一日的累計。"]
          : []),
        "",
        digest,
        "",
        "口徑：只計一般練習；重溫錯題不計入練習次數、作答題數及準確率。",
      ].join("\r\n");

      if (printEmail) {
        console.log(`主旨：${subject}`);
        console.log(body);
      }

      const recipients = (argument("--email-to") ?? lookup("EXPORT_EMAIL_TO") ?? "")
        .split(/[;,]/)
        .map((value) => value.trim())
        .filter(Boolean);

      if (process.argv.includes("--no-email")) {
        console.log("（--no-email：只印正文，沒有寄出。）");
      } else if (recipients.length === 0) {
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

        await sendMail(config, {
          from: lookup("EXPORT_MAIL_FROM")!,
          to: recipients,
          subject,
          text: jpgError ? `${body}\r\n（注意：本次未能產生 JPG：${jpgError}）` : body,
          attachments: [
            {
              filename: fileName,
              contentType: contentTypeFor(fileName),
              content: buffer,
            },
            ...(jpgBuffer
              ? [
                  {
                    filename: jpgName,
                    contentType: "image/jpeg",
                    content: jpgBuffer,
                  },
                ]
              : []),
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
