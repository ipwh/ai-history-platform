/**
 * DOCX 教材解析。
 * 使用 mammoth 將 DOCX 轉成 HTML（保留清單、表格及合併儲存格），
 * 再由 html-to-blocks 轉成結構化段落。
 * 圖片不會被上載或推斷內容，只會標示為「圖片內容未能自動擷取」。
 */
import mammoth from "mammoth";

import { htmlToBlocks, IMAGE_BLOCK_TEXT } from "./html-to-blocks";
import { MaterialParseError, type ParseResult } from "./types";

/** 常見中英文清單段落樣式，統一當作一般段落處理，清單結構交由 numbering 產生 */
const STYLE_MAP = [
  "p[style-name='清單文字'] => p:fresh",
  "p[style-name='List Paragraph'] => p:fresh",
  "p[style-name='清單段落'] => p:fresh",
];

function summarizeWarnings(messages: { type: string; message: string }[]): string[] {
  const seen = new Set<string>();
  const summary: string[] = [];
  for (const message of messages) {
    if (message.type === "error") {
      summary.push(`解析時發生問題：${message.message}`);
      continue;
    }
    // 圖片格式及樣式對應的技術警告對教師沒有實際作用
    if (/image|drawing|shape|v:|w:pict|Unrecognised paragraph style/i.test(message.message)) {
      continue;
    }
    if (seen.has(message.message)) continue;
    seen.add(message.message);
    summary.push(message.message);
  }
  return summary.slice(0, 8);
}

export async function parseDocx(buffer: Buffer, fileName: string): Promise<ParseResult> {
  let converted: { value: string; messages: { type: string; message: string }[] };
  try {
    converted = await mammoth.convertToHtml(
      { buffer },
      {
        includeDefaultStyleMap: true,
        includeEmbeddedStyleMap: true,
        ignoreEmptyParagraphs: true,
        styleMap: STYLE_MAP,
        // 不讀取圖片資料（避免檔案過大），只保留圖片位置的標記
        convertImage: mammoth.images.imgElement(async () => ({ src: "unavailable" })),
      },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new MaterialParseError(
      `無法解析 DOCX 檔案（${fileName}）：${reason}。請確認檔案是有效的 .docx（不支援舊版 .doc）。`,
    );
  }

  const { blocks, imageCount } = htmlToBlocks(converted.value);
  const textBlocks = blocks.filter((block) => block.type !== "image");
  const warnings = summarizeWarnings(converted.messages);

  let limitationNote: string | null = null;
  if (textBlocks.length === 0) {
    limitationNote =
      imageCount > 0
        ? `文件中只有圖片（共 ${imageCount} 張），未能擷取任何文字。圖片內容未能自動擷取，請改用文字版教材或改以手動輸入課題內容。`
        : "未能從此 DOCX 擷取任何文字內容，請確認檔案內容並非空白。";
  } else if (imageCount > 0) {
    limitationNote = `文件中有 ${imageCount} 張圖片，圖片內容未能自動擷取，只會顯示圖片位置標示。`;
  }

  return {
    blocks,
    imageCount,
    limitationNote,
    warnings,
    pageCount: null,
  };
}

export { IMAGE_BLOCK_TEXT };
