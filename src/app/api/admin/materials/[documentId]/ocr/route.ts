import { ApiRouteError, handleRoute, jsonOk } from "@/server/http";
import { getDocument } from "@/server/repositories/materials";
import { countPendingOcrImages, isOcrRunning, runOcr, startOcrJob } from "@/server/services/ocr-service";
import { describeOcr } from "@/server/ocr";
import { requireAdmin } from "@/server/auth/guards";

export const runtime = "nodejs";

/** 查詢某份教材的 OCR 狀態（前端會輪詢這個端點顯示進度） */
export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  return handleRoute(async () => {
    await requireAdmin(request);
    const { documentId } = await context.params;
    const document = getDocument(documentId);
    if (!document) throw new ApiRouteError("找不到指定的教材文件", 404);

    return jsonOk({
      documentId,
      status: document.ocrStatus,
      provider: document.ocrProvider,
      message: document.ocrMessage,
      recognizedCount: document.ocrRecognizedCount,
      skippedCount: document.ocrSkippedCount,
      pendingImages: countPendingOcrImages(documentId),
      running: isOcrRunning(documentId),
      updatedAt: document.ocrUpdatedAt,
      ocrEngine: describeOcr(),
    });
  });
}

/**
 * 執行 OCR。
 * 預設以背景方式執行並立即回應（前端輪詢 GET 取得進度）；
 * 若帶 `?wait=1` 則等待完成後才回應（適合命令列或少量圖片）。
 */
export async function POST(request: Request, context: { params: Promise<{ documentId: string }> }) {
  return handleRoute(async () => {
    await requireAdmin(request);
    const { documentId } = await context.params;
    const document = getDocument(documentId);
    if (!document) throw new ApiRouteError("找不到指定的教材文件", 404);

    const engine = describeOcr();
    if (!engine.enabled) {
      throw new ApiRouteError(
        engine.notice ?? "OCR 已停用。請設定 OCR_PROVIDER=tesseract 或 OCR_PROVIDER=google-vision。",
        409,
      );
    }

    if (new URL(request.url).searchParams.get("wait") === "1") {
      const summary = await runOcr(documentId);
      return jsonOk({ started: true, waited: true, summary });
    }

    void startOcrJob(documentId);
    return jsonOk({ started: true, waited: false, status: "running" }, 202);
  });
}
