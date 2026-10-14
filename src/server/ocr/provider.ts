/**
 * OCR（光學文字辨識）provider 介面。
 *
 * 用途：把教材內的圖片文字轉成可搜尋、可供 AI 生成題目使用的文字。
 * 所有 OCR 都在伺服器端執行；未設定任何 OCR provider 時，
 * 系統仍可正常運作（圖片只會標示「圖片內容未能自動擷取」）。
 */
export interface OcrImageInput {
  /** 圖片二進位資料 */
  data: Buffer;
  /** MIME 類型，例如 image/png */
  mimeType: string;
  /** 來源說明，例如 "HNC2A2E_T5_SN_TE.docx · word/media/image12.png" 或 "第 3 頁" */
  label: string;
}

export interface OcrImageResult {
  label: string;
  /** 辨識出的文字；沒有文字時為空字串 */
  text: string;
  /** 平均信心度（0-1），供應商不提供時為 null */
  confidence: number | null;
  /** 未有辨識結果時的說明 */
  note: string | null;
}

export interface OcrProvider {
  /** 內部名稱，例如 tesseract / google-vision */
  readonly name: string;
  /** 顯示名稱 */
  readonly label: string;
  /** 辨識一張圖片 */
  recognizeImage(input: OcrImageInput): Promise<OcrImageResult>;
  /** 結束時釋放資源（例如關閉 tesseract worker） */
  dispose?(): Promise<void>;
}

export class OcrError extends Error {
  readonly retryable: boolean;

  constructor(message: string, options: { retryable?: boolean } = {}) {
    super(message);
    this.name = "OcrError";
    this.retryable = options.retryable ?? true;
  }
}

/** tesseract 支援的圖片格式（其餘格式如 EMF／WMF 需要先轉換） */
export const OCR_SUPPORTED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/bmp",
  "image/tiff",
  "image/webp",
  "image/gif",
]);

export function isOcrSupportedMime(mimeType: string): boolean {
  return OCR_SUPPORTED_MIME_TYPES.has(mimeType.toLowerCase());
}

/** 由檔名推斷 MIME 類型（DOCX 的 word/media 內的檔案） */
export function mimeTypeForFileName(fileName: string): string {
  const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  switch (extension) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".bmp":
      return "image/bmp";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".emf":
      return "image/emf";
    case ".wmf":
      return "image/wmf";
    case ".wdp":
      return "image/vnd.ms-photo";
    default:
      return "application/octet-stream";
  }
}
