import { z } from "zod";

import { handleRoute, jsonOk, parseJsonBody } from "@/server/http";
import { resolveLearnerId, requireSignInBeforeBody } from "@/server/auth/guards";
import { completePractice } from "@/server/services/practice-service";

export const runtime = "nodejs";

/** 完成練習並取得成績 */
export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  return handleRoute(async () => {
    const { sessionId } = await context.params;
    await requireSignInBeforeBody(request);
    const body = await parseJsonBody(request, z.object({ learnerId: z.string().min(1) }));
    const learnerId = await resolveLearnerId(request, body.learnerId);
    return jsonOk(completePractice(sessionId, learnerId));
  });
}
