/**
 * Google Cloud Vision OCR provider（伺服器端）。
 *
 * 需要 OCR_API_KEY；適合大量或掃描品質較差的教材，
 * 未設定時系統會使用本機 OCR（tesseract）或停用 OCR。
 */
import { OcrError, type OcrImageInput, type OcrImageResult, type OcrProvider } from "./provider";

interface VisionResponse {
  responses?: {
    fullTextAnnotation?: { text?: string };
    textAnnotations?: { description?: string }[];
    error?: { message?: string };
  }[];
  error?: { message?: string };
}

export interface GoogleVisionOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
}

export function createGoogleVisionProvider(options: GoogleVisionOptions): OcrProvider {
  return {
    name: "google-vision",
    label: "Google Cloud Vision OCR",

    async recognizeImage(input: OcrImageInput): Promise<OcrImageResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);
      const url = `${options.baseUrl.replace(/\/$/, "")}/images:annotate?key=${encodeURIComponent(
        options.apiKey,
      )}`;

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requests: [
              {
                image: { content: input.data.toString("base64") },
                features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
                imageContext: { languageHints: ["zh-Hant", "en"] },
              },
            ],
          }),
          signal: controller.signal,
        });

        const payload = (await response.json()) as VisionResponse;
        if (!response.ok) {
          throw new OcrError(
            `Google Cloud Vision 回應錯誤：${payload.error?.message ?? `HTTP ${response.status}`}`,
            { retryable: response.status === 429 || response.status >= 500 },
          );
        }

        const annotation = payload.responses?.[0];
        if (annotation?.error?.message) {
          throw new OcrError(`Google Cloud Vision 無法辨識圖片：${annotation.error.message}`);
        }

        const text = (annotation?.fullTextAnnotation?.text ?? "").trim();
        return {
          label: input.label,
          text,
          confidence: null,
          note: text.length === 0 ? "圖片中沒有辨識到文字" : null,
        };
      } catch (error) {
        if (error instanceof OcrError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new OcrError("Google Cloud Vision 回應逾時，請稍後再試");
        }
        throw new OcrError(
          `呼叫 Google Cloud Vision 失敗：${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
