/**
 * 從教材檔案抽出可以進行 OCR 的圖片。
 *
 * - DOCX：讀取 zip 內的 word/media/*，只取 PNG／JPEG 等可辨識格式；
 *   EMF／WMF／WDP 屬向量或特殊格式，會回報為不支援而不是猜測內容。
 * - PDF：若頁面沒有文字層（掃描檔），抽出該頁最大的圖片並轉成 PNG 再辨識。
 */
import JSZip from "jszip";
import { extractImages, getDocumentProxy, extractText } from "unpdf";

import { encodeRawImageToPng } from "./png-encoder";
import { isOcrSupportedMime, mimeTypeForFileName, OcrError } from "./provider";

export interface OcrCandidate {
  /** 穩定識別碼，會存回資料庫方便追蹤 */
  sourceKey: string;
  /** 顯示用的來源說明 */
  label: string;
  mimeType: string;
  data: Buffer;
}

export interface OcrSourceScan {
  /** 可以進行 OCR 的圖片 */
  candidates: OcrCandidate[];
  /** 格式不支援而無法 OCR 的圖片數量 */
  unsupportedCount: number;
  /** 不支援格式的說明（給教師看） */
  unsupportedExamples: string[];
  /** PDF 掃描頁的資訊 */
  scannedPageCount: number;
}

const MEDIA_PREFIX = "word/media/";

/** 抽出 DOCX 內可以 OCR 的圖片 */
export async function collectDocxOcrCandidates(
  buffer: Buffer,
  fileName: string,
  limit: number,
): Promise<OcrSourceScan> {
  const result: OcrSourceScan = {
    candidates: [],
    unsupportedCount: 0,
    unsupportedExamples: [],
    scannedPageCount: 0,
  };

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (error) {
    throw new OcrError(
      `無法讀取 DOCX 內容（${fileName}）：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const mediaFiles = Object.keys(zip.files)
    .filter((path) => path.startsWith(MEDIA_PREFIX) && !zip.files[path].dir)
    .sort();

  for (const mediaPath of mediaFiles) {
    const mimeType = mimeTypeForFileName(mediaPath);
    if (!isOcrSupportedMime(mimeType)) {
      result.unsupportedCount += 1;
      const extension = mediaPath.slice(mediaPath.lastIndexOf(".")).toUpperCase();
      if (!result.unsupportedExamples.includes(extension)) {
        result.unsupportedExamples.push(extension);
      }
      continue;
    }
    if (result.candidates.length >= limit) break;

    const data = await zip.files[mediaPath].async("nodebuffer");
    result.candidates.push({
      sourceKey: mediaPath,
      label: `${fileName} · ${mediaPath}`,
      mimeType,
      data,
    });
  }

  return result;
}

/**
 * 抽出「沒有文字層」的 PDF 頁面圖片。
 * 已含文字層的頁面不需要 OCR，會直接略過。
 */
export async function collectPdfOcrCandidates(
  buffer: Buffer,
  fileName: string,
  limit: number,
): Promise<OcrSourceScan> {
  const result: OcrSourceScan = {
    candidates: [],
    unsupportedCount: 0,
    unsupportedExamples: [],
    scannedPageCount: 0,
  };

  let document;
  try {
    document = await getDocumentProxy(new Uint8Array(buffer));
  } catch (error) {
    throw new OcrError(
      `無法讀取 PDF（${fileName}）：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const { text } = await extractText(document, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    if (result.candidates.length >= limit) break;

    const pageText = (pages[pageIndex] ?? "").replace(/\s/g, "");
    // 有足夠文字層的頁面不需要 OCR
    if (pageText.length >= 40) continue;

    result.scannedPageCount += 1;

    let images;
    try {
      images = await extractImages(document, pageIndex + 1);
    } catch (error) {
      throw new OcrError(
        `無法抽出第 ${pageIndex + 1} 頁的圖片：${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // 掃描頁通常只有一張大圖，取面積最大者
    const largest = images
      .filter((image) => image.width > 200 && image.height > 200)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!largest) continue;

    result.candidates.push({
      sourceKey: `page:${pageIndex + 1}`,
      label: `${fileName} · 第 ${pageIndex + 1} 頁（掃描圖片）`,
      mimeType: "image/png",
      data: encodeRawImageToPng({
        data: largest.data,
        width: largest.width,
        height: largest.height,
        channels: largest.channels,
      }),
    });
  }

  return result;
}

/** 依檔案類型抽出可 OCR 的圖片 */
export async function collectOcrCandidates(options: {
  fileName: string;
  buffer: Buffer;
  limit: number;
}): Promise<OcrSourceScan> {
  const extension = options.fileName.slice(options.fileName.lastIndexOf(".")).toLowerCase();
  if (extension === ".docx") {
    return collectDocxOcrCandidates(options.buffer, options.fileName, options.limit);
  }
  if (extension === ".pdf") {
    return collectPdfOcrCandidates(options.buffer, options.fileName, options.limit);
  }
  return { candidates: [], unsupportedCount: 0, unsupportedExamples: [], scannedPageCount: 0 };
}

/**
 * 為圖片建立「圖片文字（OCR 擷取）」段落文字。
 * 圖片本身不會載入資料庫，只儲存辨識出的文字及來源說明。
 */
export function buildOcrBlockText(label: string, text: string): string {
  return `${text}\n（以上文字由 OCR 從圖片擷取：${label}）`;
}
