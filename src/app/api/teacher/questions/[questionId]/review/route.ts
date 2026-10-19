import { z } from "zod";

import { ApiRouteError, handleRoute, jsonOk, parseJsonBody } from "@/server/http";
import { questionReviewDecisionSchema } from "@/lib/types";
import { getQuestion } from "@/server/repositories/questions";
import { listQuestionReviews } from "@/server/repositories/questions";
import { recordQuestionReview, teacherQuestionView } from "@/server/services/question-service";
import { checkQuestionServable } from "@/server/services/question-servability";
import { requireTeacher } from "@/server/auth/guards";
import { isProductionRuntime } from "@/server/config";

export const runtime = "nodejs";

const reviewSchema = z.object({
  decision: questionReviewDecisionSchema,
  /** 退回或標示不可用時必須提供原因（服務層會驗證） */
  reason: z.string().max(500).optional(),
  /**
   * 教師實際審閱的版本（Sprint 8.7 樂觀鎖）。
   * 若提交前題目已被修改，服務層會回 409，避免把覆核記到教師沒有看過的版本上。
   */
  expectedRevision: z.number().int().positive(),
});

/** 教師端：查閱單一題目的覆核狀態及紀錄 */
export async function GET(request: Request, context: { params: Promise<{ questionId: string }> }) {
  return handleRoute(async () => {
    await requireTeacher(request);
    const { questionId } = await context.params;
    const question = getQuestion(questionId);
    if (!question) throw new ApiRouteError("找不到指定的題目", 404);
    // 審核工作台需要可作答性判定及既有覆核歷史；兩者都取自伺服器端，
    // 前端不得自行推測題目是否可派發。
    return jsonOk({
      view: teacherQuestionView(question),
      servability: checkQuestionServable(question),
      reviews: listQuestionReviews(question.id, 20),
    });
  });
}

/**
 * 是否本機請求（loopback）。本機示範模式（`next start` 也是 NODE_ENV=production）需要
 * 可以記錄覆核，否則文件記載的本機教師測試流程及端對端測試都無法運作；
 * 但**部署到任何真實主機**時，不得以「示範模式」身分寫入覆核紀錄。
 */
function isLocalRequest(request: Request): boolean {
  try {
    const host = new URL(request.url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

/**
 * 教師端：記錄一次人工覆核決定（通過／退回修改／不可用）。
 *
 * 只有教師及管理員可以呼叫（`requireTeacher`）；學生一律 403。
 * 覆核者身分**只**取自伺服器端的工作階段，前端傳來的值不會被採用。
 * 覆核綁定題目目前的版本及內容指紋，因此覆核後再修改內容會令覆核立即失效；
 * 重複提交相同決定不會產生重複紀錄（`created: false`）。
 *
 * Sprint 8.6：覆核是「人的決定」，因此**部署環境必須有真實工作階段**。即使有人設定了
 * 不安全示範開關（`HISTORY_ALLOW_UNSAFE_DEMO_MODE`），部署環境也不會寫入以
 * 「（示範模式：未登入）」為覆核者的紀錄——那種紀錄看上去像覆核，其實沒有人負責。
 * 本機（loopback）的示範／端對端流程不受影響，但紀錄會如實標示為示範身分。
 */
export async function POST(request: Request, context: { params: Promise<{ questionId: string }> }) {
  return handleRoute(async () => {
    const reviewer = await requireTeacher(request);
    if (!reviewer && isProductionRuntime() && !isLocalRequest(request)) {
      throw new ApiRouteError(
        "部署環境必須以教師或管理員帳戶登入才可記錄覆核；不會以「示範模式」身分寫入覆核紀錄。",
        403,
      );
    }
    const { questionId } = await context.params;
    const body = await parseJsonBody(request, reviewSchema);

    const result = recordQuestionReview({
      questionId,
      decision: body.decision,
      reason: body.reason ?? null,
      expectedRevision: body.expectedRevision,
      actor: {
        // 示範模式（未登入、本機）下沒有帳戶可記錄，如實標示而不是假裝有教師身分
        email: reviewer?.email ?? "（示範模式：未登入）",
        role: reviewer?.role ?? "unauthenticated-demo",
      },
    });

    return jsonOk({ view: result.view, created: result.created });
  });
}
