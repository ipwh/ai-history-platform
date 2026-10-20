import { z } from "zod";

import { ApiRouteError, handleRoute, jsonOk, parseJsonBody } from "@/server/http";
import { getServerConfig, OCR_PROVIDER_LABELS } from "@/server/config";
import { collectMaterialFiles } from "@/server/materials/material-files";
import { isRetiredQuestionBankFileName } from "@/server/materials/question-bank";
import { describeOcr } from "@/server/ocr";
import { importMaterialFromDisk } from "@/server/services/material-service";
import { findTopicSeedByFile } from "@/server/seed/curriculum";
import { startOcrJob } from "@/server/services/ocr-service";
import { requireAdmin } from "@/server/auth/guards";

export const runtime = "nodejs";

const schema = z.object({
  /**
   * 要匯入的教材檔案名稱（可為相對路徑；必須存在於 materials 資料夾）；all = true 時可省略。
   *
   * `null` 一律視為「未提供」：「匯入全部課程教材」按鈕本來就會以 `fileName: null`
   * 呼叫此端點，若只寫 `.optional()` 會回 400（`expected string, received null`），
   * 令該功能在介面上完全不能用。
   */
  fileName: z
    .string()
    .nullable()
    .optional()
    // 空白字串亦視為「未提供」，交由下方的可行動錯誤訊息處理（而不是格式錯誤）
    .transform((value) => {
      const trimmed = (value ?? "").trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }),
  /** 匯入 materials 資料夾內全部教材（書本內容及校內試題） */
  all: z.boolean().default(false),
  /** 匯入後是否執行 OCR（背景執行） */
  runOcr: z.boolean().default(false),
});

/** 列出 materials 資料夾內的教材及對應課題（供管理員端批次匯入；含課題子資料夾） */
export async function GET(request: Request) {
  return handleRoute(async () => {
    await requireAdmin(request);
    const { materialsDir } = getServerConfig();

    const items = collectMaterialFiles(materialsDir).map((entry) => {
      const topic = findTopicSeedByFile(entry.relativePath);
      return {
        fileName: entry.relativePath,
        displayName: entry.fileName,
        topicId: topic?.id ?? entry.topicId,
        topicTitle: topic?.title ?? null,
        level: topic?.level ?? null,
      };
    });

    return jsonOk({
      materialsDir,
      items,
      ocr: describeOcr(),
    });
  });
}

/** 匯入 materials 資料夾內的教材（單一檔案或全部課程教材） */export async function POST(request: Request) {
  return handleRoute(async () => {
    await requireAdmin(request);
    const body = await parseJsonBody(request, schema);
    if (!body.all && !body.fileName) {
      throw new ApiRouteError("請提供要匯入的教材檔案名稱，或設定 all = true 匯入全部課程教材。", 400);
    }
    const targets = body.all
      ? // 匯入 materials 資料夾內全部教材：12 個課題的書本內容及校內試題（匯入題庫草稿）。
        // 以實際掃描結果為準（含課題子資料夾），
        // 不依賴課程種子記錄的檔名，避免新增檔案時漏匯。
        collectMaterialFiles(getServerConfig().materialsDir).map((entry) => entry.relativePath)
      : [body.fileName as string];

    const results: {
      fileName: string;
      topicId: string | null;
      status: string;
      blockCount: number;
      warnings: string[];
      errorMessage: string | null;
      /** 校內試題檔才會有的題庫匯入統計 */
      questionImport: {
        imported: number;
        excluded: number;
        excludedForImage: number;
        skipped: number;
        withQualityWarnings: number;
      } | null;
    }[] = [];

    for (const fileName of targets) {
      // 平台已移除資料題（DBQ）：明確告知不會匯入，而不是回報「找不到檔案」
      if (isRetiredQuestionBankFileName(fileName)) {
        results.push({
          fileName,
          topicId: null,
          status: "skipped",
          blockCount: 0,
          warnings: [],
          errorMessage: "平台已移除資料題（DBQ），此檔案不會匯入題庫或教材",
          questionImport: null,
        });
        continue;
      }

      const imported = await importMaterialFromDisk(fileName, { runOcr: false });
      if (!imported) {
        results.push({
          fileName,
          topicId: null,
          status: "failed",
          blockCount: 0,
          warnings: [],
          errorMessage: `找不到檔案：${fileName}（請確認已放在 materials 資料夾）`,
          questionImport: null,
        });
        continue;
      }

      results.push({
        fileName,
        topicId: imported.outcome.detectedTopic?.id ?? imported.topicId,
        status: imported.outcome.document.status,
        blockCount: imported.outcome.blocks.length,
        warnings: [
          ...imported.outcome.warnings,
          ...(imported.questionImport?.warnings ?? []),
        ],
        errorMessage: imported.outcome.document.errorMessage,
        questionImport: imported.questionImport
          ? {
              imported: imported.questionImport.imported,
              excluded: imported.questionImport.excluded,
              excludedForImage: imported.questionImport.excludedForImage,
              skipped: imported.questionImport.skipped.length,
              withQualityWarnings: imported.questionImport.withQualityWarnings,
            }
          : null,
      });

      if (body.runOcr && imported.outcome.document.status === "ready") {
        void startOcrJob(imported.outcome.document.id);
      }
    }

    const failed = results.filter((result) => result.status === "failed");
    const skippedRetired = results.filter((result) => result.status === "skipped").length;
    if (failed.length === results.length && results.length > 0) {
      throw new ApiRouteError(
        `所有教材匯入失敗：${failed[0].errorMessage ?? "未知原因"}`,
        400,
        failed.map((result) => `${result.fileName}：${result.errorMessage}`),
      );
    }

    return jsonOk({
      imported: results.length - failed.length - skippedRetired,
      failed: failed.length,
      skippedRetired,
      runOcr: body.runOcr,
      ocrProviderLabel: OCR_PROVIDER_LABELS[getServerConfig().ocr.provider],
      results,
    });
  });
}
