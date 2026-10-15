import { z } from "zod";

import { ApiRouteError, handleRoute, jsonOk, parseJsonBody } from "@/server/http";
import { questionReviewDecisionSchema } from "@/lib/types";
import { getQuestion } from "@/server/repositories/questions";
import { recordQuestionReview, teacherQuestionView } from "@/server/services/question-service";
import { requireTeacher } from "@/server/auth/guards";

export const runtime = "nodejs";

const reviewSchema = z.object({
  decision: questionReviewDecisionSchema,
  /** 退回或標示不可用時必須提供原因（服務層會驗證） */
  reason: z.string().max(500).optional(),
});

/** 教師端：查閱單一題目的覆核狀態及紀錄 */
export async function GET(request: Request, context: { params: Promise<{ questionId: string }> }) {
  return handleRoute(async () => {
    await requireTeacher(request);
    const { questionId } = await context.params;
    const question = getQuestion(questionId);
    if (!question) throw new ApiRouteError("找不到指定的題目", 404);
    return jsonOk({ view: teacherQuestionView(question) });
  });
}

/**
 * 教師端：記錄一次人工覆核決定（通過／退回修改／不可用）。
 *
 * 只有教師及管理員可以呼叫（`requireTeacher`）；學生一律 403。
 * 覆核者身分**只**取自伺服器端的工作階段，前端傳來的值不會被採用。
 * 覆核綁定題目目前的版本及內容指紋，因此覆核後再修改內容會令覆核立即失效；
 * 重複提交相同決定不會產生重複紀錄（`created: false`）。
 */
export async function POST(request: Request, context: { params: Promise<{ questionId: string }> }) {
  return handleRoute(async () => {
    const reviewer = await requireTeacher(request);
    const { questionId } = await context.params;
    const body = await parseJsonBody(request, reviewSchema);

    const result = recordQuestionReview({
      questionId,
      decision: body.decision,
      reason: body.reason ?? null,
      actor: {
        // 示範模式（未啟用登入）下沒有帳戶可記錄，如實標示而不是假裝有教師身分
        email: reviewer?.email ?? "（示範模式：未登入）",
        role: reviewer?.role ?? "unauthenticated-demo",
      },
    });

    return jsonOk({ view: result.view, created: result.created });
  });
}
