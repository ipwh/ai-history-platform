/**
 * OCR 服務：把教材內的圖片文字辨識成可用的教材段落。
 *
 * 流程：
 *   1. 讀取原始教材檔（DOCX／PDF）。
 *   2. 抽出可辨識的圖片（DOCX：word/media；PDF：沒有文字層的掃描頁）。
 *   3. 逐張交給 OCR provider 辨識，並過濾雜訊（字數太少或信心過低者不使用）。
 *   4. 把辨識文字寫回對應的圖片段落，標記為 extraction_method = 'ocr'，
 *      並保留來源說明，方便教師核對。
 *
 * 設計原則：
 *   - 不支援的圖片格式（EMF／WMF／WDP）會如實回報，不會猜測內容。
 *   - OCR 是「抽取」而非「生成」，但可能有錯字，因此介面會明確標示需教師核對。
 *   - OCR 以背景工作方式執行，狀態儲存在資料庫，前端可輪詢進度。
 */
import {
  OCR_UNSUPPORTED_FORMAT_MESSAGE,
  type MaterialDocument,
  type OcrStatus,
} from "../../lib/types";
import { getServerConfig } from "../config";
import { resolveOcrProvider } from "../ocr";
import { OcrError } from "../ocr/provider";
import { isUsableOcrText } from "../ocr/tesseract-provider";
import { buildOcrBlockText, collectOcrCandidates } from "../ocr/sources";
import { readStoredFile } from "../storage";
import {
  applyOcrText,
  countOcrBlocks,
  findImageBlockByOcrSource,
  getDocument,
  insertBlocks,
  listBlocksForSections,
  listImageBlocks,
  setDocumentOcr,
} from "../repositories/materials";

export interface OcrRunSummary {
  documentId: string;
  status: OcrStatus;
  provider: string | null;
  /** 成功辨識出文字的圖片數 */
  recognized: number;
  /** 沒有文字或格式不支援而略過的圖片數 */
  skipped: number;
  message: string | null;
  durationMs: number;
}

/** 正在執行的 OCR 工作（同一時間每份文件只會執行一次） */
const runningJobs = new Map<string, Promise<OcrRunSummary>>();

export function isOcrRunning(documentId: string): boolean {
  return runningJobs.has(documentId);
}

export function listRunningOcrJobs(): string[] {
  return [...runningJobs.keys()];
}

/** 啟動 OCR（背景執行，立即回傳）；已有工作在執行時回傳現有工作 */
export function startOcrJob(documentId: string): Promise<OcrRunSummary> {
  const existing = runningJobs.get(documentId);
  if (existing) return existing;

  const job = runOcr(documentId)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setDocumentOcr(documentId, { status: "failed", message: `OCR 失敗：${message}` });
      return {
        documentId,
        status: "failed" as OcrStatus,
        provider: null,
        recognized: 0,
        skipped: 0,
        message,
        durationMs: 0,
      } satisfies OcrRunSummary;
    })
    .finally(() => {
      runningJobs.delete(documentId);
    });

  runningJobs.set(documentId, job);
  return job;
}

/**
 * 執行 OCR。若要等待結果（例如命令列匯入時），可直接 await 這個函式。
 */
export async function runOcr(documentId: string): Promise<OcrRunSummary> {
  const started = Date.now();
  const config = getServerConfig();
  const document = getDocument(documentId);
  if (!document) {
    throw new OcrError("找不到指定的教材文件", { retryable: false });
  }

  if (!document.storedPath || !(await readStoredFile(document.storedPath))) {
    const message =
      "找不到這份教材的原始檔案，無法執行 OCR。請重新上載教材（系統會自動保留原始檔案）。";
    setDocumentOcr(documentId, { status: "failed", message });
    return {
      documentId,
      status: "failed",
      provider: null,
      recognized: 0,
      skipped: 0,
      message,
      durationMs: Date.now() - started,
    };
  }

  const resolved = resolveOcrProvider();
  if (!resolved.provider) {
    const message =
      resolved.notice ??
      "OCR 已停用。請設定 OCR_PROVIDER=tesseract（本機 OCR）或 OCR_PROVIDER=google-vision 後再試。";
    setDocumentOcr(documentId, { status: "failed", message });
    return {
      documentId,
      status: "failed",
      provider: null,
      recognized: 0,
      skipped: 0,
      message,
      durationMs: Date.now() - started,
    };
  }

  const provider = resolved.provider;
  setDocumentOcr(documentId, {
    status: "running",
    provider: provider.name,
    message: "正在抽出圖片並辨識文字…",
  });

  try {
    const buffer = await readStoredFile(document.storedPath);
    if (!buffer) {
      throw new OcrError("找不到這份教材的原始檔案，無法執行 OCR。", { retryable: false });
    }
    const scan = await collectOcrCandidates({
      fileName: document.fileName,
      buffer,
      limit: config.ocr.maxImagesPerRun,
    });

    const messages: string[] = [];
    if (scan.unsupportedCount > 0) {
      messages.push(
        `${scan.unsupportedCount} 張圖片為不支援的格式（${scan.unsupportedExamples.join("、")}）：${OCR_UNSUPPORTED_FORMAT_MESSAGE}。`,
      );
    }
    if (scan.scannedPageCount > 0) {
      messages.push(`PDF 中有 ${scan.scannedPageCount} 頁沒有文字層，已改用 OCR 辨識圖片。`);
    }

    if (scan.candidates.length === 0) {
      const message =
        scan.unsupportedCount > 0
          ? `${messages.join(" ")}因此沒有可辨識的圖片。`
          : "這份教材沒有可進行 OCR 的圖片（或所有圖片已辨識過）。";
      const status: OcrStatus = scan.unsupportedCount > 0 ? "partial" : "done";
      setDocumentOcr(documentId, {
        status,
        provider: provider.name,
        message,
        recognizedCount: countOcrBlocks(documentId),
        skippedCount: scan.unsupportedCount,
      });
      return {
        documentId,
        status,
        provider: provider.name,
        recognized: 0,
        skipped: scan.unsupportedCount,
        message,
        durationMs: Date.now() - started,
      };
    }

    const imageBlocks = listImageBlocks(documentId);
    const fallbackSectionId = imageBlocks[0]?.sectionId ?? null;

    let recognized = 0;
    let skipped = scan.unsupportedCount;
    let timedOut = false;

    for (const candidate of scan.candidates) {
      if (Date.now() - started > config.ocr.runTimeoutMs) {
        timedOut = true;
        messages.push(
          `OCR 已達到執行時間上限（${Math.round(config.ocr.runTimeoutMs / 60000)} 分鐘），其餘圖片未處理。可再次執行 OCR 繼續。`,
        );
        break;
      }

      try {
        const result = await provider.recognizeImage({
          data: candidate.data,
          mimeType: candidate.mimeType,
          label: candidate.label,
        });

        // 過濾雜訊：字數太少或信心過低的結果不寫入教材
        const usable = isUsableOcrText(result.text, result.confidence, {
          minChars: config.ocr.minChars,
          minConfidence: config.ocr.minConfidence,
        });
        if (!usable) {
          skipped += 1;
          continue;
        }

        const target = findImageBlockByOcrSource(documentId, candidate.sourceKey);
        const blockText = buildOcrBlockText(candidate.label, result.text);
        if (target) {
          // 圖片段落本身保留，OCR 文字寫入同一段落（教師可在介面查看及修改）
          applyOcrText(
            target.id,
            blockText,
            candidate.sourceKey,
            target.sectionId ?? fallbackSectionId,
          );
        } else {
          // 找不到對應圖片段落時（例如 PDF 掃描頁），建立新的文字段落
          insertBlocks([
            {
              documentId,
              topicId: document.topicId,
              sectionId: fallbackSectionId,
              order: 10_000 + recognized,
              type: "paragraph",
              level: null,
              text: blockText,
              sourceLocation: `${candidate.label} · OCR 擷取`,
              extractionMethod: "ocr",
              ocrSource: candidate.sourceKey,
            },
          ]);
        }
        recognized += 1;
      } catch (error) {
        skipped += 1;
        const reason = error instanceof Error ? error.message : String(error);
        messages.push(`${candidate.label}：${reason}`);
        if (error instanceof OcrError && !error.retryable) break;
      }
    }

    const status: OcrStatus = timedOut || skipped > 0 ? "partial" : "done";
    if (recognized > 0) {
      messages.unshift(`已從 ${recognized} 張圖片辨識出文字，並加入教材內容（標示為 OCR 擷取，請教師核對）。`);
    }

    const message = messages.length > 0 ? messages.join(" ") : "OCR 完成。";
    setDocumentOcr(documentId, {
      status,
      provider: provider.name,
      message,
      // 以資料庫中實際帶有 OCR 文字的段落數為準，重複執行不會重複累計
      recognizedCount: countOcrBlocks(documentId),
      skippedCount: skipped,
    });

    return {
      documentId,
      status,
      provider: provider.name,
      recognized,
      skipped,
      message,
      durationMs: Date.now() - started,
    };
  } finally {
    // tesseract worker 佔用較多記憶體，完成後釋放；下次執行會重新建立
    await provider.dispose?.();
  }
}

/** 需要 OCR 的圖片段落（尚未辨識的圖片） */
export function countPendingOcrImages(documentId: string): number {
  return listImageBlocks(documentId).filter((block) => block.extractionMethod !== "ocr").length;
}

export interface OcrCoverage {
  /** 該分節中有多少段教材來自 OCR */
  ocrBlocks: number;
  totalBlocks: number;
}

/** 檢查某分節的教材是否包含 OCR 文字（用於題目來源提示） */
export function ocrCoverageForSections(topicId: string, sectionIds: string[]): OcrCoverage {
  const blocks = listBlocksForSections(topicId, sectionIds);
  return {
    ocrBlocks: blocks.filter((block) => block.extractionMethod === "ocr").length,
    totalBlocks: blocks.length,
  };
}

export async function ocrDocumentAndWait(documentId: string): Promise<OcrRunSummary> {
  return startOcrJob(documentId);
}

export function documentOcrSummary(document: MaterialDocument): string {
  if (document.ocrStatus === "not-run") return "未執行 OCR";
  const parts: string[] = [];
  if (document.ocrRecognizedCount > 0) parts.push(`已辨識 ${document.ocrRecognizedCount} 張圖片`);
  if (document.ocrSkippedCount > 0) parts.push(`略過 ${document.ocrSkippedCount} 張`);
  return parts.length > 0 ? parts.join("、") : "沒有可辨識的文字";
}
