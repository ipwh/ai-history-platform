import { z } from "zod";

import { ApiRouteError, handleRoute, jsonOk, parseJsonBody } from "@/server/http";
import { requireTeacher } from "@/server/auth/guards";
import {
  recordServabilityDecision,
  SERVABILITY_DECISIONS,
} from "@/server/services/servability-adjudication";

export const runtime = "nodejs";

const servabilityDecisionSchema = z.object({
  decision: z.enum(SERVABILITY_DECISIONS),
  reason: z.string().min(5).max(500),
  /** 教師實際看到的版本；題目已被修改時回 409，不把裁決記到未看過的版本 */
  expectedRevision: z.number().int().positive(),
});

/**
 * 教師端：對結構不可作答的題目記錄裁決（退回／保留隔離／要求補充證據／不可用）。
 *
 * 需要真實的教師或管理員工作階段（不接受示範模式身分），
 * 裁決者與時間只取自伺服器端；學生一律 403。
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ questionId: string }> },
) {
  return handleRoute(async () => {
    const reviewer = await requireTeacher(request);
    if (!reviewer) {
      throw new ApiRouteError("需要教師或管理員登入才可記錄題目裁決", 401);
    }
    const { questionId } = await context.params;
    const body = await parseJsonBody(request, servabilityDecisionSchema);

    const view = recordServabilityDecision({
      questionId,
      decision: body.decision,
      reason: body.reason,
      expectedRevision: body.expectedRevision,
      actor: { email: reviewer.email, role: reviewer.role },
    });

    return jsonOk({ view });
  });
}
