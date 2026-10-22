/**
 * 教師端「練習記錄」匯出（CSV／XLSX／DOCX／PDF）。
 *
 * 四個格式共用同一份紀錄內容，避免不同格式顯示不一致的欄位或結果用語：
 *   - CSV：沿用原有格式（每題一列），供試算表或程式處理。
 *   - XLSX：三張工作表（匯出說明、練習概況、逐題記錄），首列凍結並可篩選。
 *   - DOCX／PDF：每次練習一節，附逐題表格，適合列印或存檔。
 *
 * PDF／DOCX 會在記錄過多時只取最近若干次並在文件內註明，因為這兩種格式是給人閱讀的，
 * 過長的文件既難閱讀亦會令回應變大；需要完整資料請用 XLSX／CSV。
 */
import type { PracticeRecordQuestion, PracticeRecordSession } from "../../lib/types";
import { buildDocx, buildXlsx, type CellValue, type DocxBlock } from "../export/office";
import { buildPdf, type PdfBlock } from "../export/pdf";
import { ApiRouteError } from "../http";
import { buildRecordsCsv, RECORDS_ROW_HEADER, recordOutcomeLabel, recordRowValues } from "./practice-records";

export type RecordsExportFormat = "csv" | "xlsx" | "docx" | "pdf";

export const RECORDS_EXPORT_FORMATS: RecordsExportFormat[] = ["csv", "xlsx", "docx", "pdf"];

/** 教師端畫面顯示的名稱 */
export const RECORDS_EXPORT_LABELS: Record<RecordsExportFormat, string> = {
  csv: "CSV",
  xlsx: "Excel",
  docx: "Word",
  pdf: "PDF",
};

const CONTENT_TYPES: Record<RecordsExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

/** 需要給人閱讀的格式最多包含多少次練習 */
export const MAX_READABLE_SESSIONS = 120;

const HK_TIME = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Hong_Kong",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * ISO 時間 → 香港時間 `YYYY-MM-DD HH:mm`。
 *
 * 伺服器（Cloud Run）執行於 UTC，而 `zh-HK` 的日期次序是「日-月-年」，
 * 因此以 `formatToParts` 自行組合，確保檔名及文件顯示都是固定的 `YYYY-MM-DD`。
 */
export function hongKongDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Map(HK_TIME.formatToParts(date).map((part) => [part.type, part.value]));
  const day = parts.get("day") ?? "01";
  const month = parts.get("month") ?? "01";
  const year = parts.get("year") ?? "1970";
  const hour = parts.get("hour") ?? "00";
  const minute = parts.get("minute") ?? "00";
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

export function parseRecordsExportFormat(value: string | null | undefined): RecordsExportFormat {
  const normalized = (value ?? "").trim().toLowerCase() || "csv";
  if ((RECORDS_EXPORT_FORMATS as string[]).includes(normalized)) {
    return normalized as RecordsExportFormat;
  }
  throw new ApiRouteError(
    `不支援的匯出格式：${value}（可用：${RECORDS_EXPORT_FORMATS.join("、")}）`,
    400,
  );
}

export interface RecordsExportOptions {
  format: RecordsExportFormat;
  /** 目前篩選條件的說明（顯示在 DOCX／PDF 的開頭） */
  filterSummary?: string;
  generatedAt?: Date;
}

export interface RecordsExportResult {
  body: Buffer;
  contentType: string;
  filename: string;
  format: RecordsExportFormat;
}

function accuracyPercent(record: PracticeRecordSession): number | null {
  return record.accuracy === null ? null : Math.round(record.accuracy * 100);
}

function sessionHeading(record: PracticeRecordSession): string {
  const learner = record.learnerName || record.learnerEmail || record.learnerLabel;
  const details = [record.learnerClassName, record.learnerStudentNumber]
    .filter((value): value is string => Boolean(value))
    .join("・");
  return `${learner}${details ? `（${details}）` : ""}　${hongKongDateTime(record.createdAt)}　${record.topicTitle}`;
}

function sessionMeta(record: PracticeRecordSession): string {
  const parts = [
    `題型：${record.questionTypeLabels.join("、")}`,
    `難度：${record.difficultyLabel}`,
    `題數：${record.totalQuestions}`,
    `已作答：${record.answeredCount}`,
    `答對：${record.correctCount}`,
    `答錯：${record.wrongCount}`,
  ];
  const accuracy = accuracyPercent(record);
  parts.push(`準確率：${accuracy === null ? "未評分" : `${accuracy}%`}`);
  parts.push(`學習者：${record.learnerLabel}`);
  return parts.join("｜");
}

function questionText(row: PracticeRecordQuestion, index: number): string {
  const tags = [row.questionTypeLabel, row.sectionTitle].filter(Boolean).join("・");
  return `${index + 1}. ${tags ? `[${tags}] ` : ""}${row.question}`;
}

function answerText(value: string): string {
  return value.trim().length > 0 ? value : "（未作答）";
}

function totalAccuracy(records: PracticeRecordSession[]): string {
  const graded = records.reduce((sum, record) => sum + record.correctCount + record.wrongCount, 0);
  const correct = records.reduce((sum, record) => sum + record.correctCount, 0);
  return graded === 0 ? "未評分" : `${Math.round((correct / graded) * 100)}%`;
}

function summaryLines(records: PracticeRecordSession[], options: RecordsExportOptions): string[] {
  const generatedAt = options.generatedAt ?? new Date();
  return [
    `匯出時間：${hongKongDateTime(generatedAt.toISOString())}（香港時間）`,
    `篩選條件：${options.filterSummary?.trim() || "全部課題、全部學習者"}`,
    `記錄：${records.length} 次練習、${new Set(records.map((record) => record.learnerId)).size} 位學習者、` +
      `答對 ${records.reduce((sum, record) => sum + record.correctCount, 0)} 題、` +
      `答錯 ${records.reduce((sum, record) => sum + record.wrongCount, 0)} 題、` +
      `整體準確率 ${totalAccuracy(records)}`,
  ];
}

function readableSessions(records: PracticeRecordSession[]): {
  sessions: PracticeRecordSession[];
  truncatedNote: string | null;
} {
  if (records.length <= MAX_READABLE_SESSIONS) return { sessions: records, truncatedNote: null };
  return {
    sessions: records.slice(0, MAX_READABLE_SESSIONS),
    truncatedNote: `符合條件的記錄共 ${records.length} 次，本文件只包含最近 ${MAX_READABLE_SESSIONS} 次；如需完整資料請以 Excel（XLSX）或 CSV 匯出。`,
  };
}

function emptyNote(records: PracticeRecordSession[]): string | null {
  return records.length === 0 ? "目前沒有符合條件的練習記錄。" : null;
}

function buildXlsxBody(records: PracticeRecordSession[], options: RecordsExportOptions): Promise<Buffer> {
  const overviewColumns = [
    "作答日期",
    "學生姓名",
    "班別",
    "學號",
    "電郵",
    "學習者 ID",
    "課題",
    "題型",
    "難度",
    "題數",
    "已作答",
    "答對",
    "答錯",
    "準確率（%）",
    "練習編號",
  ];
  const overviewRows: CellValue[][] = records.map((record) => [
    hongKongDateTime(record.createdAt),
    record.learnerName ?? "",
    record.learnerClassName ?? "",
    record.learnerStudentNumber ?? "",
    record.learnerEmail ?? "",
    record.learnerId,
    record.topicTitle,
    record.questionTypeLabels.join("、"),
    record.difficultyLabel,
    record.totalQuestions,
    record.answeredCount,
    record.correctCount,
    record.wrongCount,
    accuracyPercent(record) ?? "",
    record.sessionId,
  ]);
  // 逐題記錄與 CSV 共用欄位，但「作答日期」改用香港時間（與概況工作表一致）
  const detailRows: CellValue[][] = records.flatMap((record) =>
    recordRowValues(record).map(([createdAt, ...rest]) => [
      hongKongDateTime(typeof createdAt === "string" ? createdAt : null),
      ...rest,
    ]),
  );

  return buildXlsx(
    [
      {
        name: "匯出說明",
        columns: ["說明"],
        rows: summaryLines(records, options).map((line) => [line]),
        widths: [90],
      },
      {
        name: "練習概況",
        columns: overviewColumns,
        rows: overviewRows,
        widths: [20, 12, 8, 8, 26, 28, 34, 16, 8, 8, 8, 8, 8, 12, 24],
      },
      {
        name: "逐題記錄",
        columns: [...RECORDS_ROW_HEADER],
        rows: detailRows,
        widths: [20, 12, 8, 8, 26, 28, 34, 20, 8, 8, 60, 30, 30, 12, 24],
      },
    ],
    { title: "學生練習記錄" },
  );
}

function buildDocxBody(records: PracticeRecordSession[], options: RecordsExportOptions): Promise<Buffer> {
  const { sessions, truncatedNote } = readableSessions(records);
  const blocks: DocxBlock[] = [
    { kind: "title", text: "學生練習記錄" },
    ...summaryLines(records, options).map((line): DocxBlock => ({ kind: "note", text: line })),
  ];
  if (truncatedNote) blocks.push({ kind: "note", text: truncatedNote });
  const empty = emptyNote(records);
  if (empty) blocks.push({ kind: "paragraph", text: empty });

  for (const record of sessions) {
    blocks.push({ kind: "heading", text: sessionHeading(record) });
    blocks.push({ kind: "paragraph", text: sessionMeta(record), muted: true });
    blocks.push({
      kind: "table",
      columns: ["題目", "學生答案", "正確答案", "結果"],
      widths: [4638, 2000, 2400, 600],
      rows: record.questions.map((row, index) => [
        questionText(row, index),
        answerText(row.studentAnswer),
        row.correctAnswer,
        recordOutcomeLabel(row),
      ]),
    });
  }

  return buildDocx(blocks, { title: "學生練習記錄" });
}

function buildPdfBody(records: PracticeRecordSession[], options: RecordsExportOptions): Promise<Buffer> {
  const { sessions, truncatedNote } = readableSessions(records);
  const blocks: PdfBlock[] = [
    { kind: "title", text: "學生練習記錄" },
    ...summaryLines(records, options).map((line): PdfBlock => ({ kind: "note", text: line })),
  ];
  if (truncatedNote) blocks.push({ kind: "note", text: truncatedNote });
  const empty = emptyNote(records);
  if (empty) blocks.push({ kind: "note", text: empty });

  for (const record of sessions) {
    blocks.push({ kind: "heading", text: sessionHeading(record) });
    blocks.push({ kind: "note", text: sessionMeta(record) });
    blocks.push({
      kind: "table",
      columns: [
        { header: "題目", width: 236 },
        { header: "學生答案", width: 110 },
        { header: "正確答案", width: 132 },
        { header: "結果", width: 45 },
      ],
      rows: record.questions.map((row, index) => [
        { text: questionText(row, index) },
        { text: answerText(row.studentAnswer) },
        { text: row.correctAnswer },
        { text: recordOutcomeLabel(row), muted: true },
      ]),
    });
  }

  return buildPdf(blocks, {
    title: "學生練習記錄",
    footer: `香港中學歷史科自學互動網站　${hongKongDateTime((options.generatedAt ?? new Date()).toISOString())}`,
  });
}

/** 產生匯出檔（回應內容、Content-Type 及檔名） */
export async function buildRecordsExport(
  records: PracticeRecordSession[],
  options: RecordsExportOptions,
): Promise<RecordsExportResult> {
  const generatedAt = options.generatedAt ?? new Date();
  const dateStamp = hongKongDateTime(generatedAt.toISOString()).slice(0, 10);
  const filename = `practice-records-${dateStamp}.${options.format}`;

  if (options.format === "csv") {
    return {
      body: Buffer.from(`\uFEFF${buildRecordsCsv(records)}`, "utf8"),
      contentType: CONTENT_TYPES.csv,
      filename,
      format: options.format,
    };
  }

  const body =
    options.format === "xlsx"
      ? await buildXlsxBody(records, { ...options, generatedAt })
      : options.format === "docx"
        ? await buildDocxBody(records, { ...options, generatedAt })
        : await buildPdfBody(records, { ...options, generatedAt });

  return { body, contentType: CONTENT_TYPES[options.format], filename, format: options.format };
}
