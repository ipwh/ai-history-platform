import { z } from "zod";

import { handleRoute, jsonOk, parseJsonBody } from "@/server/http";
import { resolveLearnerId, requireSignInBeforeBody } from "@/server/auth/guards";
import { setSelfAssessment } from "@/server/services/practice-service";

export const runtime = "nodejs";

const selfAssessmentSchema = z.object({
  learnerId: z.string().min(1),
  questionId: z.string().min(1),
  selfAssessment: z.enum(["understood", "needs-review"]),
});

/** 短答題自我檢查結果（不是正式評分，只用於決定是否需要重溫） */
export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  return handleRoute(async () => {
    const { sessionId } = await context.params;
    await requireSignInBeforeBody(request);
    const body = await parseJsonBody(request, selfAssessmentSchema);
    const learnerId = await resolveLearnerId(request, body.learnerId);
    const feedback = setSelfAssessment(sessionId, learnerId, body.questionId, body.selfAssessment);
    return jsonOk({ feedback });
  });
}
