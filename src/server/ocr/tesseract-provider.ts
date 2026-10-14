/**
 * 本地 OCR（tesseract.js，WASM 版本）。
 *
 * 優點：不需要 API key、可離線執行（首次執行需下載語言資料）。
 * 首次執行時會由 OCR_LANG_PATH（如已設定）或 tesseract.js 預設來源取得
 * 繁體中文及英文語言資料，之後快取於 OCR_CACHE_PATH。
 */
import fs from "node:fs";
import path from "node:path";

import { createWorker, type Worker } from "tesseract.js";

import { OcrError, type OcrImageInput, type OcrImageResult, type OcrProvider } from "./provider";

export interface TesseractOptions {
  /** 語言包，例如 chi_tra+eng */
  languages: string;
  /** 語言資料快取目錄 */
  cachePath: string;
  /** 語言資料來源路徑（可指向本機 tessdata 目錄） */
  langPath?: string;
  timeoutMs: number;
  /** 版面分析模式（tesseract PSM）；教材多為散佈文字的圖表，預設 11（SPARSE_TEXT） */
  pageSegMode: string;
}

/**
 * 判斷 langPath 內的語言資料是壓縮還是未壓縮版本。
 *
 * tesseract.js 預設只找 `<語言>.traineddata.gz`；若目錄內只有未壓縮的
 * `chi_tra.traineddata`（例如從 tessdata 直接下載、或打包進容器映像檔時），
 * 必須明確設定 `gzip: false`，否則 OCR 會失敗並顯示 ENOENT。
 */
export function resolveLanguageSource(
  langPath: string | undefined,
  languages: string[],
): { langPath?: string; gzip?: boolean } {
  if (langPath === undefined || langPath.length === 0) return {};

  const hasGzip = languages.every((lang) => fs.existsSync(path.join(langPath, `${lang}.traineddata.gz`)));
  if (hasGzip) return { langPath };

  const hasPlain = languages.every((lang) => fs.existsSync(path.join(langPath, `${lang}.traineddata`)));
  if (hasPlain) return { langPath, gzip: false };

  // 兩者皆不存在：保留原設定，讓 tesseract.js 回報缺少語言資料
  return { langPath };
}

/**
 * 整理 OCR 輸出：移除多餘空白。
 * 中文辨識結果常在中文字之間加入空格（包括全角空格及不斷行空格），
 * 這裡會先把所有空白統一，再移除「中文之間」的空格。
 */
export function normalizeOcrText(raw: string): string {
  const collapsed = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u3000\u2007\u202f]/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");

  // 反覆取代，處理「字 字 字」這類連續交替的情況
  let text = collapsed;
  let previous = "";
  while (text !== previous) {
    previous = text;
    text = text.replace(/([\u4e00-\u9fff])[ \t]+([\u4e00-\u9fff])/g, "$1$2");
  }
  return text.trim();
}

/** 判斷 OCR 結果是否可用（太短或信心過低者視為沒有辨識到文字） */
export function isUsableOcrText(
  text: string,
  confidence: number | null,
  minimums: { minChars: number; minConfidence: number },
): boolean {
  const meaningful = text.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, "");
  if (meaningful.length < minimums.minChars) return false;
  if (confidence !== null && confidence < minimums.minConfidence) return false;
  return true;
}

export function createTesseractProvider(options: TesseractOptions): OcrProvider {
  let workerPromise: Promise<Worker> | null = null;

  async function getWorker(): Promise<Worker> {
    if (!workerPromise) {
      workerPromise = (async () => {
        try {
          // 用陣列傳入語言可避免 tesseract.js 在 Windows 上產生多餘的語言載入警告
          const langs = options.languages.split("+").filter((lang) => lang.length > 0);
          const worker = await createWorker(langs.length > 0 ? langs : ["chi_tra"], undefined, {
            cachePath: options.cachePath,
            ...resolveLanguageSource(options.langPath, langs.length > 0 ? langs : ["chi_tra"]),
            logger: () => {},
          });
          await worker.setParameters({
            tessedit_pageseg_mode: options.pageSegMode,
          } as Parameters<Worker["setParameters"]>[0]);
          return worker;
        } catch (error) {
          workerPromise = null;
          throw new OcrError(
            `無法啟動本機 OCR 引擎（tesseract.js）：${
              error instanceof Error ? error.message : String(error)
            }。首次執行需要下載語言資料，請確認網絡連線，或設定 OCR_LANG_PATH 指向本機 tessdata 目錄。`,
          );
        }
      })();
    }
    return workerPromise;
  }

  return {
    name: "tesseract",
    label: `本機 OCR（tesseract.js · ${options.languages}）`,

    async recognizeImage(input: OcrImageInput): Promise<OcrImageResult> {
      const worker = await getWorker();
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(new OcrError(`OCR 逾時（超過 ${options.timeoutMs} 毫秒）`, { retryable: true })),
          options.timeoutMs,
        );
      });

      try {
        const result = await Promise.race([worker.recognize(input.data), timeout]);
        const text = normalizeOcrText(result.data.text ?? "");
        return {
          label: input.label,
          text,
          confidence:
            typeof result.data.confidence === "number" ? result.data.confidence / 100 : null,
          note: text.length === 0 ? "圖片中沒有辨識到文字" : null,
        };
      } catch (error) {
        if (error instanceof OcrError) throw error;
        throw new OcrError(
          `OCR 辨識失敗（${input.label}）：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },

    async dispose() {
      if (!workerPromise) return;
      try {
        const worker = await workerPromise;
        await worker.terminate();
      } catch {
        // 忽略結束時的錯誤
      } finally {
        workerPromise = null;
      }
    },
  };
}
