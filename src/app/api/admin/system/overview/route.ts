import { aiUsageSummarySchema, observabilitySummarySchema, teacherOverviewSchema } from "@/lib/types";
import { requireAdmin } from "@/server/auth/guards";
import { handleRoute, jsonOk } from "@/server/http";
import {
  errorTypeStats,
  listRecentGradingLogs,
  listRecentLlmUsage,
  tokenTotals,
} from "@/server/repositories/llm-logs";
import { describeAiUsage } from "@/server/services/ai-limits";
import { getPlatformOverview } from "@/server/services/admin-dashboard";

export const runtime = "nodejs";

/** 管理員儀表板統計（課題、教材、題庫、回報及 AI 用量概況） */
export async function GET(request: Request) {
  return handleRoute(async () => {
    await requireAdmin(request);
    const days = 7;
    const overview = getPlatformOverview();
    const tokens = tokenTotals(days);

    return jsonOk({
      overview: teacherOverviewSchema.parse(overview),
      aiUsage: aiUsageSummarySchema.parse(describeAiUsage()),
      observability: observabilitySummarySchema.parse({
        days,
        llmRequests: overview.observability.llmRequests,
        llmFailures: overview.observability.llmFailures,
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens,
        grading: overview.observability.grading,
        recentLlm: listRecentLlmUsage(10, days),
        recentGrading: listRecentGradingLogs(10, days),
        errorTypes: errorTypeStats(days),
      }),
    });
  });
}
