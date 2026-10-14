import { z } from "zod";

import { handleRoute, jsonOk, parseJsonBody } from "@/server/http";
import { resolveLearnerId, requireSignInBeforeBody } from "@/server/auth/guards";
import { submitAnswer } from "@/server/services/practice-service";

export const runtime = "nodejs";

const submitSchema = z.object({
  learnerId: z.string().min(1),
  questionId: z.string().min(1),
  answer: z.string().max(2000),
});

/** 提交答案：即時回傳答案、解釋、知識點及教材來源 */
export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  return handleRoute(async () => {
    const { sessionId } = await context.params;
    await requireSignInBeforeBody(request);
    const body = await parseJsonBody(request, submitSchema);
    const learnerId = await resolveLearnerId(request, body.learnerId);
    const result = await submitAnswer(sessionId, learnerId, body.questionId, body.answer);
    return jsonOk(result);
  });
}
