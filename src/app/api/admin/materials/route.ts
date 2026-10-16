import { ApiRouteError, handleRoute, jsonOk } from "@/server/http";
import {
  importPilotMaterialFromDisk,
  importUploadedMaterial,
  listMaterials,
} from "@/server/services/material-service";
import { getServerConfig } from "@/server/config";
import { requireAdmin } from "@/server/auth/guards";
import { CURRICULUM_TOPICS } from "@/server/seed/curriculum";

export const runtime = "nodejs";

/** 教材清單（含處理狀態、錯誤訊息及分節覆蓋情況） */
export async function GET(request: Request) {
  return handleRoute(async () => {
    await requireAdmin(request);
    return jsonOk(listMaterials());
  });
}

/**
 * 上載教材（multipart/form-data，欄位名稱 file，可選 topicId）。
 * 亦可用 `source=pilot` 匯入專案內附的試點教材。
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    await requireAdmin(request);
    const config = getServerConfig();
    const contentType = request.headers.get("content-type") ?? "";

    if (!contentType.includes("multipart/form-data")) {
      throw new ApiRouteError("請以 multipart/form-data 上載檔案", 415);
    }

    // 先看 Content-Length 才讀取內容：request.formData() 會把整個請求載入記憶體，
    // 若等到讀完才檢查大小，超大上載已經佔用記憶體（可能令容器被中止）。
    // multipart 另有欄位標頭開銷（通常不足 1 KB），因此容許 64 KB 的額外空間。
    const declaredLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(declaredLength) && declaredLength > config.maxUploadBytes + 64 * 1024) {
      throw new ApiRouteError(
        `檔案過大（上限 ${Math.floor(config.maxUploadBytes / (1024 * 1024))} MB），請改用較小的檔案。`,
        413,
      );
    }

    const formData = await request.formData();
    const source = String(formData.get("source") ?? "upload");

    if (source === "pilot") {
      const imported = await importPilotMaterialFromDisk();
      if (!imported) {
        const pilotFileName =
          CURRICULUM_TOPICS.find((topic) => topic.id === "topic-5")?.materialFile ?? "課題5 …docx";
        throw new ApiRouteError(
          `找不到專案內的試點教材。請把課題5 的教材放在 ${config.materialsDir} 並命名為 ${pilotFileName}，或改用上載功能。`,
          404,
        );
      }
      return jsonOk({
        document: imported.outcome.document,
        detectedTopic: imported.outcome.detectedTopic,
        warnings: imported.outcome.warnings,
        blockCount: imported.outcome.blocks.length,
        fileName: imported.fileName,
      });
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new ApiRouteError("請選擇要上載的 .docx 或 .pdf 檔案", 400);
    }

    const topicIdRaw = formData.get("topicId");
    const topicId = typeof topicIdRaw === "string" && topicIdRaw.trim().length > 0 ? topicIdRaw : null;
    const runOcr = String(formData.get("runOcr") ?? "") === "true";
    const buffer = Buffer.from(await file.arrayBuffer());

    const outcome = await importUploadedMaterial({
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: buffer.byteLength,
      buffer,
      topicId,
      runOcr,
    });

    return jsonOk({
      document: outcome.document,
      detectedTopic: outcome.detectedTopic,
      warnings: outcome.warnings,
      blockCount: outcome.blocks.length,
    });
  });
}

