/**
 * OCR provider 解析：依環境變數決定使用哪個 OCR 引擎。
 * 沒有可用 provider 時回傳 null，系統會停用 OCR 功能而不會出錯。
 */
import { getServerConfig, OCR_PROVIDER_LABELS } from "../config";
import { createGoogleVisionProvider } from "./google-vision-provider";
import { createTesseractProvider } from "./tesseract-provider";
import type { OcrProvider } from "./provider";

export interface ResolvedOcr {
  provider: OcrProvider | null;
  /** 停用 OCR 的原因（例如未設定憑證） */
  notice: string | null;
}

export function resolveOcrProvider(): ResolvedOcr {
  const { ocr } = getServerConfig();

  if (ocr.provider === "none") {
    return { provider: null, notice: null };
  }

  if (ocr.provider === "google-vision") {
    if (!ocr.apiKey) {
      return {
        provider: null,
        notice:
          "已設定 OCR_PROVIDER=google-vision，但缺少 OCR_API_KEY，暫時停用 OCR。請參考 README 設定，或改用本機 OCR（OCR_PROVIDER=tesseract）。",
      };
    }
    return {
      provider: createGoogleVisionProvider({
        apiKey: ocr.apiKey,
        baseUrl: ocr.baseUrl,
        timeoutMs: ocr.imageTimeoutMs,
      }),
      notice: null,
    };
  }

  return {
    provider: createTesseractProvider({
      languages: ocr.languages,
      cachePath: ocr.cachePath,
      langPath: ocr.langPath ?? undefined,
      timeoutMs: ocr.imageTimeoutMs,
      pageSegMode: ocr.pageSegMode,
    }),
    notice: null,
  };
}

export interface OcrStatusSummary {
  enabled: boolean;
  provider: string;
  providerLabel: string;
  languages: string;
  pageSegMode: string;
  maxImagesPerRun: number;
  minChars: number;
  notice: string | null;
}

export function describeOcr(): OcrStatusSummary {
  const { ocr } = getServerConfig();
  const resolved = resolveOcrProvider();
  return {
    enabled: resolved.provider !== null,
    provider: resolved.provider?.name ?? "none",
    providerLabel: resolved.provider?.label ?? OCR_PROVIDER_LABELS[ocr.provider],
    languages: ocr.languages,
    pageSegMode: ocr.pageSegMode,
    maxImagesPerRun: ocr.maxImagesPerRun,
    minChars: ocr.minChars,
    notice: resolved.notice,
  };
}

export type { OcrProvider };
export { OcrError } from "./provider";
