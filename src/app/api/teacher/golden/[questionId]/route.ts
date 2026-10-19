import { z } from "zod";

import { ApiRouteError, handleRoute, jsonOk, parseJsonBody } from "@/server/http";
import { requireTeacher } from "@/server/auth/guards";
import {
  GoldenApprovalError,
  goldenFixtureContentSchema,
  recordGoldenFixtureDecision,
} from "@/server/services/golden-approval";

export const runtime = "nodejs";

const goldenDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected", "revision_requested"]),
  reason: z.string().min(5).max(500),
  /** 教師實際審閱的題目版本；題目已被修改時回 409 */
  expectedRevision: z.number().int().positive(),
  /** 只在 approved 時必填：人工確認的評估內容（category、reasoning、預期 grading 等） */
  fixture: goldenFixtureContentSchema.optional(),
});

/**
 * 教師端：逐題核准／拒絕／要求修訂 Golden fixture 候選。
 *
 * 審核者身分只取自伺服器端工作階段；裁決寫入 `golden_fixture_reviews`（只新增），
 * 綁定題目版本及內容指紋。題目內容改變後舊裁決自動失效。
 * 這個操作**不會**改變題目的發布狀態。
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ questionId: string }> },
) {
  return handleRoute(async () => {
    const reviewer = await requireTeacher(request);
    if (!reviewer) {
      throw new ApiRouteError("需要教師或管理員登入才可裁決 Golden fixture", 401);
    }
    const { questionId } = await context.params;
    const body = await parseJsonBody(request, goldenDecisionSchema);
    try {
      const result = recordGoldenFixtureDecision({
        questionId,
        decision: body.decision,
        reason: body.reason,
        expectedRevision: body.expectedRevision,
        actor: { email: reviewer.email, role: reviewer.role },
        fixture: body.fixture,
      });
      return jsonOk({ review: result.review, candidate: result.candidate, created: result.created });
    } catch (error) {
      if (error instanceof GoldenApprovalError) throw new ApiRouteError(error.message, error.status);
      throw error;
    }
  });
}
