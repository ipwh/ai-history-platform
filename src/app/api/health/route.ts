import { healthSchema } from "@/lib/types";
import { handleRoute, jsonOk } from "@/server/http";
import { resolveOcrProvider } from "@/server/ocr";
import { requireTeacher } from "@/server/auth/guards";
import { countMaterialBlocks, listTopics } from "@/server/repositories/topics";
import { ensureBootstrap } from "@/server/seed";
import { getRosterStatus } from "@/server/roster";
import { getSystemStatus } from "@/server/services/admin-dashboard";

export const runtime = "nodejs";

/**
 * 健康檢查：回報版本、資料庫連線狀態、LLM／OCR provider、登入及後台保護狀態。
 * 只回報狀態（例如 sqlite / ok），**不會**回傳資料庫路徑、憑證或任何學生資料。
 */
export async function GET() {
  return handleRoute(async () => {
    ensureBootstrap();
    const status = await getSystemStatus();
    const roster = await getRosterStatus({ load: false });
    return jsonOk(
      healthSchema.parse({
        ok: status.ok,
        version: status.version,
        database: { driver: status.database.driver, status: status.database.status },
        llmProvider: status.llm.provider,
        llmProviderLabel: status.llm.providerLabel,
        llmConfigured: status.llm.configured,
        demoMode: status.llm.demoMode,
        aiGrading: status.llm.aiGrading,
        ocrProvider: status.ocr.provider,
        ocrEnabled: status.ocr.enabled,
        authEnabled: status.auth.enabled,
        staffApiOpen: status.auth.staffApiOpen,
        roster,
        // 資料持久化狀態（不包含 bucket 憑證或路徑以外的敏感資料）
        persistence: {
          backupEnabled: status.backup.enabled,
          lastSuccessAt: status.backup.lastSuccessAt,
          lastError: status.backup.lastError,
          backupsUploaded: status.backup.backupsUploaded,
          restore: status.backup.restore,
        },
      }),
    );
  });
}

/** 後台系統資訊：OCR 引擎及課程課題概況（只限教師及管理員） */
export async function POST(request: Request) {
  return handleRoute(async () => {
    await requireTeacher(request);
    ensureBootstrap();
    const status = await getSystemStatus();
    return jsonOk({
      ocr: {
        enabled: resolveOcrProvider().provider !== null,
        provider: status.ocr.provider,
        providerLabel: status.ocr.providerLabel,
      },
      topics: listTopics().map((topic) => ({
        id: topic.id,
        title: topic.title,
        level: topic.level,
        topicNumber: topic.topicNumber,
        published: topic.published,
        blockCount: countMaterialBlocks(topic.id),
      })),
    });
  });
}
