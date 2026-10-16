import { z } from "zod";

import { QUESTION_REPORT_STATUSES, questionReportStatusSchema } from "@/lib/types";
import { requireTeacher } from "@/server/auth/guards";
import { ApiRouteError, handleRoute, jsonOk, parseJsonBody } from "@/server/http";
import {
  listQuestionReports,
  resolveQuestionReport,
  revalidateQuestionFromReport,
  withdrawQuestionFromReport,
} from "@/server/services/question-report-service";

export const runtime = "nodejs";

/**
 * 處理回報：
 *   - `status`：只更新回報狀態（已處理／已略過／待覆核），不改動題目。
 *   - `action`（Sprint 7.8 教師補救流程）：
 *       `withdraw-question`   暫時把題目下架（status = disabled，可隨時重新發布）
 *       `revalidate-question` 重新執行自動品質驗證，通過即記錄（因此可以發布）
 *     執行的行動會記錄在回報的 resolution_action。
 */
const patchSchema = z.object({
  status: questionReportStatusSchema.optional(),
  action: z.enum(["withdraw-question", "revalidate-question"]).optional(),
});

/** 教師端：題目回報清單（可按狀態及課題篩選） */
export async function GET(request: Request) {
  return handleRoute(async () => {
    await requireTeacher(request);
    const params = new URL(request.url).searchParams;
    const status = questionReportStatusSchema.safeParse(params.get("status"));
    const limit = Number.parseInt(params.get("limit") ?? "50", 10);
    const reports = listQuestionReports({
      status: status.success ? status.data : null,
      topicId: params.get("topicId"),
      limit: Number.isFinite(limit) ? limit : 50,
    });
    return jsonOk({ reports });
  });
}

/** 教師端：處理回報（可一併下架題目或重新執行自動品質驗證） */
export async function PATCH(request: Request) {
  return handleRoute(async () => {
    const user = await requireTeacher(request);
    const reportId = new URL(request.url).searchParams.get("reportId")?.trim() ?? "";
    if (reportId.length === 0) throw new ApiRouteError("請提供 reportId", 400);

    const body = await parseJsonBody(request, patchSchema);
    const resolvedBy = user?.email ?? "admin-token";

    if (body.action === "withdraw-question") {
      const result = withdrawQuestionFromReport(reportId, resolvedBy);
      if (result.view === null && result.action === null) {
        throw new ApiRouteError("找不到指定的回報記錄", 404);
      }
      return jsonOk({ report: result.view, remediation: result });
    }
    if (body.action === "revalidate-question") {
      const result = revalidateQuestionFromReport(reportId, resolvedBy);
      if (result.view === null && result.action === null) {
        throw new ApiRouteError("找不到指定的回報記錄", 404);
      }
      return jsonOk({ report: result.view, remediation: result });
    }

    if (body.status === undefined) {
      throw new ApiRouteError("請提供 status 或 action", 400);
    }
    if (!QUESTION_REPORT_STATUSES.includes(body.status)) {
      throw new ApiRouteError("不支援的回報狀態", 400);
    }
    const updated = resolveQuestionReport(reportId, body.status, resolvedBy);
    if (!updated) throw new ApiRouteError("找不到指定的回報記錄", 404);
    return jsonOk({ report: updated });
  });
}
