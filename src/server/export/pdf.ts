/**
 * PDF 產生器（A4 直向、可跨頁的表格）。
 *
 * 中文必須嵌入字型，否則大部分瀏覽器及 Acrobat 只會顯示方框或空白。
 * 字型為 Noto Sans TC（SIL OFL 1.1，見 assets/fonts/LICENSE-NotoSansTC.txt），
 * PDFKit 只嵌入實際用到的字形（subset），一份數十次練習的記錄通常少於 100 KB。
 *
 * 為何用 PDFKit 而非 pdf-lib：pdf-lib 1.17 的字型子集化在這種大型 CJK 字型上
 * 會漏掉部分字形（實測同一段中文只有部分字顯示，其餘空白，文字抽取卻正常），
 * 用 `subset: false` 則每份 PDF 都要內嵌整個 7 MB 字型。PDFKit 的子集化沒有此問題。
 */
import fs from "node:fs";
import path from "node:path";

import PDFDocument from "pdfkit";

import { ApiRouteError } from "../http";

const PAGE_MARGIN = 36;
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2;
const BODY_SIZE = 8.5;
const HEADER_SIZE = 9;
const CELL_PADDING = 4;
const LINE_GAP = 2;

export interface PdfTableColumn {
  header: string;
  width: number;
}

export interface PdfCell {
  text: string;
  size?: number;
  muted?: boolean;
}

export type PdfBlock =
  | { kind: "title"; text: string }
  | { kind: "note"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "table"; columns: PdfTableColumn[]; rows: PdfCell[][] };

/** 字型路徑（可用環境變數覆寫，方便部署到其他位置） */
export function pdfFontPath(): string {
  return (
    process.env.RECORDS_EXPORT_FONT_PATH?.trim() ||
    path.join(process.cwd(), "assets", "fonts", "NotoSansTC-Regular.ttf")
  );
}

function assertFontAvailable(): string {
  const fontPath = pdfFontPath();
  // turbopackIgnore：字型由映像檔提供，執行時才檢查，不需在建置時追蹤。
  if (!fs.existsSync(/*turbopackIgnore: true*/ fontPath)) {
    console.error("[export] 找不到 PDF 中文字型：", fontPath);
    throw new ApiRouteError(
      "伺服器未有可用的中文字型，暫時未能產生 PDF。請改用 Excel（XLSX）或 Word（DOCX）匯出，兩者同樣包含全部欄位。",
      500,
    );
  }
  return fontPath;
}

function normalize(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
}

/** 產生 PDF 檔（回傳完整檔案內容） */
export async function buildPdf(
  blocks: PdfBlock[],
  options: { title?: string; footer?: string } = {},
): Promise<Buffer> {
  const fontPath = assertFontAvailable();

  const document = new PDFDocument({
    size: "A4",
    margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
    bufferPages: true,
    info: {
      Title: options.title ?? "學生練習記錄",
      Author: "香港中學歷史科自學互動網站",
      Creator: "香港中學歷史科自學互動網站",
      Producer: "香港中學歷史科自學互動網站",
    },
  });

  const chunks: Buffer[] = [];
  const finished = new Promise<void>((resolve, reject) => {
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve());
    document.on("error", (error: Error) => reject(error));
  });

  document.font(fontPath).fillColor("#000000");
  const bottomLimit = () => document.page.height - document.page.margins.bottom;

  const text = (
    value: string,
    settings: { size: number; muted?: boolean; spaceBefore?: number; spaceAfter?: number },
  ): void => {
    if (settings.spaceBefore) {
      if (document.y + settings.spaceBefore < bottomLimit()) document.y += settings.spaceBefore;
      else document.addPage();
    }
    document
      .font(fontPath)
      .fontSize(settings.size)
      .fillColor(settings.muted ? "#595959" : "#000000")
      .text(normalize(value), PAGE_MARGIN, document.y, {
        width: CONTENT_WIDTH,
        lineGap: LINE_GAP,
      });
    if (settings.spaceAfter) document.y += settings.spaceAfter;
  };

  const table = (columns: PdfTableColumn[], rows: PdfCell[][]): void => {
    const drawHeader = (): void => {
      const height =
        document.font(fontPath).fontSize(HEADER_SIZE).heightOfString(columns[0]?.header ?? "", {
          width: (columns[0]?.width ?? 100) - CELL_PADDING * 2,
        }) +
        CELL_PADDING * 2;
      const top = document.y;
      document.save().rect(PAGE_MARGIN, top, CONTENT_WIDTH, height).fill("#EDF0F4").restore();
      let x = PAGE_MARGIN;
      for (const column of columns) {
        document
          .font(fontPath)
          .fontSize(HEADER_SIZE)
          .fillColor("#1A1A1A")
          .text(column.header, x + CELL_PADDING, top + CELL_PADDING, {
            width: column.width - CELL_PADDING * 2,
            lineGap: LINE_GAP,
          });
        x += column.width;
      }
      document.y = top + height;
      document
        .save()
        .moveTo(PAGE_MARGIN, document.y)
        .lineTo(PAGE_MARGIN + CONTENT_WIDTH, document.y)
        .lineWidth(0.4)
        .strokeColor("#D1D1D1")
        .stroke()
        .restore();
    };

    const startTable = (): void => {
      drawHeader();
    };

    const ensureSpace = (height: number): void => {
      if (document.y + height > bottomLimit()) {
        document.addPage();
        startTable();
      }
    };

    startTable();

    for (const row of rows) {
      const cellHeights = row.map((cell, index) => {
        const size = cell.size ?? BODY_SIZE;
        const width = (columns[index]?.width ?? 100) - CELL_PADDING * 2;
        return (
          document.font(fontPath).fontSize(size).heightOfString(normalize(cell.text ?? ""), {
            width,
            lineGap: LINE_GAP,
          }) + CELL_PADDING * 2
        );
      });
      const rowHeight = Math.max(...cellHeights);

      // 單列高於整頁（超長題目）時不預留空間，交由 PDFKit 自動分頁，寧可欄位對不齊也不要漏內容
      const fitsOnOnePage = rowHeight <= bottomLimit() - document.page.margins.top;
      if (fitsOnOnePage) ensureSpace(rowHeight);

      const top = document.y;
      let x = PAGE_MARGIN;
      row.forEach((cell, index) => {
        const column = columns[index];
        const size = cell.size ?? BODY_SIZE;
        document
          .font(fontPath)
          .fontSize(size)
          .fillColor(cell.muted ? "#666666" : "#000000")
          .text(normalize(cell.text ?? ""), x + CELL_PADDING, top + CELL_PADDING, {
            width: (column?.width ?? 100) - CELL_PADDING * 2,
            lineGap: LINE_GAP,
          });
        x += column?.width ?? 100;
      });
      document.y = fitsOnOnePage ? top + rowHeight : document.y + CELL_PADDING;
      document
        .save()
        .moveTo(PAGE_MARGIN, document.y)
        .lineTo(PAGE_MARGIN + CONTENT_WIDTH, document.y)
        .lineWidth(0.4)
        .strokeColor("#D1D1D1")
        .stroke()
        .restore();
    }
    document.y += 8;
  };

  for (const block of blocks) {
    switch (block.kind) {
      case "title":
        text(block.text, { size: 18, spaceAfter: 6 });
        break;
      case "note":
        text(block.text, { size: BODY_SIZE, muted: true });
        break;
      case "heading":
        text(block.text, { size: 11.5, spaceBefore: 12, spaceAfter: 2 });
        break;
      case "table":
        table(block.columns, block.rows);
        break;
    }
  }

  // 頁腳最後才寫，才能顯示總頁數（需要 bufferPages）
  if (options.footer) {
    const range = document.bufferedPageRange();
    for (let index = 0; index < range.count; index += 1) {
      document.switchToPage(range.start + index);
      // 頁腳畫在邊界內下方：先把下邊界設為 0，否則 PDFKit 會因為超出可用高度而再加一頁
      const bottomMargin = document.page.margins.bottom;
      document.page.margins.bottom = 0;
      document
        .font(fontPath)
        .fontSize(7.5)
        .fillColor("#737373")
        .text(
          `${options.footer}　第 ${index + 1} / ${range.count} 頁`,
          PAGE_MARGIN,
          document.page.height - PAGE_MARGIN + 12,
          { width: CONTENT_WIDTH, lineBreak: false },
        );
      document.page.margins.bottom = bottomMargin;
    }
  }

  document.end();
  await finished;
  return Buffer.concat(chunks);
}
