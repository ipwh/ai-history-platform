/**
 * PDF 教材解析。
 *
 * 注意：PDF 只能擷取「文字層」。如果 PDF 是掃描圖片（沒有文字層），
 * 系統不會進行 OCR，會回報限制說明而不會自行猜測內容。
 */
import { extractText, getDocumentProxy } from "unpdf";

import { isLikelyHeading, looksLikeBullet, stripBulletPrefix, stripPageReferences } from "./text-utils";
import { MaterialParseError, type ParsedBlock, type ParseResult } from "./types";

/** 平均每頁最少字元數，低於此數視為掃描檔或文字層有問題 */
const MIN_CHARS_PER_PAGE = 40;

interface DraftBlock {
  type: "heading" | "paragraph" | "list";
  text: string;
  items: string[];
}

function linesToDraftBlocks(lines: string[]): DraftBlock[] {
  const drafts: DraftBlock[] = [];
  let bulletBuffer: string[] = [];
  let paragraphBuffer: string[] = [];

  const flushBullets = () => {
    if (bulletBuffer.length > 0) {
      drafts.push({ type: "list", text: bulletBuffer.join("\n"), items: [...bulletBuffer] });
      bulletBuffer = [];
    }
  };
  const flushParagraph = () => {
    if (paragraphBuffer.length > 0) {
      const text = stripPageReferences(paragraphBuffer.join(""));
      if (text.length > 0) {
        drafts.push({
          type: isLikelyHeading(text) ? "heading" : "paragraph",
          text,
          items: [],
        });
      }
      paragraphBuffer = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      flushBullets();
      flushParagraph();
      continue;
    }

    if (looksLikeBullet(line)) {
      flushParagraph();
      const item = stripBulletPrefix(line);
      if (item.length > 0) bulletBuffer.push(item);
      continue;
    }

    flushBullets();
    // 中文字行通常沒有空格分隔，行尾未完結時接續成同一段
    paragraphBuffer.push(line);
    if (/[。！？；：]$/.test(line)) {
      flushParagraph();
    }
  }

  flushBullets();
  flushParagraph();
  return drafts;
}

export async function parsePdf(buffer: Buffer, fileName: string): Promise<ParseResult> {
  let totalPages = 0;
  let pages: string[] = [];

  try {
    const document = await getDocumentProxy(new Uint8Array(buffer));
    const extracted = await extractText(document, { mergePages: false });
    totalPages = extracted.totalPages;
    pages = extracted.text;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new MaterialParseError(
      `無法解析 PDF 檔案（${fileName}）：${reason}。如果檔案有密碼保護，請先解除保護再上載。`,
    );
  }

  const allText = pages.join("\n");
  const charCount = allText.replace(/\s/g, "").length;
  const blocks: ParsedBlock[] = [];

  pages.forEach((pageText, pageIndex) => {
    const drafts = linesToDraftBlocks(pageText.split(/\r?\n/));
    for (const draft of drafts) {
      blocks.push({
        type: draft.type,
        level: draft.type === "heading" ? 3 : null,
        text: draft.text,
        items: draft.items,
        table: null,
        order: blocks.length,
        page: pageIndex + 1,
      });
    }
  });

  const warnings: string[] = [];
  let limitationNote: string | null = null;

  if (charCount === 0) {
    limitationNote = `此 PDF（共 ${totalPages} 頁）沒有可擷取的文字層，可能是掃描圖片檔。系統不會進行 OCR，亦不會推測內容，請改用 DOCX 或文字版 PDF。`;
  } else if (totalPages > 0 && charCount / totalPages < MIN_CHARS_PER_PAGE) {
    limitationNote = `此 PDF 每頁平均只有 ${Math.round(charCount / totalPages)} 個字元，可能大部分內容是圖片。已擷取到的文字可能不完整。`;
    warnings.push("PDF 擷取文字偏少，請檢查預覽內容是否完整。");
  } else {
    limitationNote = "PDF 只能擷取文字層，圖片及圖表內容未能自動擷取。";
  }

  return { blocks, imageCount: 0, limitationNote, warnings, pageCount: totalPages };
}
