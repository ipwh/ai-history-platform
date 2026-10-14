import { z } from "zod";

import { questionReportStatusSchema } from "@/lib/types";
import { requireTeacher } from "@/server/auth/guards";
import { ApiRouteError, handleRoute, jsonOk, parseJsonBody } from "@/server/http";
import {
  listQuestionReports,
  resolveQuestionReport,
} from "@/server/services/question-report-service";

export const runtime = "nodejs";

const statusSchema = z.object({ status: questionReportStatusSchema });

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

/** 教師端：更新回報狀態（已處理／已略過／待覆核）；只影響回報記錄，不會改動題目 */
export async function PATCH(request: Request) {
  return handleRoute(async () => {
    const user = await requireTeacher(request);
    const reportId = new URL(request.url).searchParams.get("reportId")?.trim() ?? "";
    if (reportId.length === 0) throw new ApiRouteError("請提供 reportId", 400);

    const body = await parseJsonBody(request, statusSchema);
    const updated = resolveQuestionReport(reportId, body.status, user?.email ?? "admin-token");
    if (!updated) throw new ApiRouteError("找不到指定的回報記錄", 404);
    return jsonOk({ report: updated });
  });
}
