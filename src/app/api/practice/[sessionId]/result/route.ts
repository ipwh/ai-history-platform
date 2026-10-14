import { handleRoute, jsonOk } from "@/server/http";
import { resolveLearnerId } from "@/server/auth/guards";
import { getPracticeResult } from "@/server/services/practice-service";

export const runtime = "nodejs";

/** 練習結果：完成題數、答對題數、正確率、需要重溫的知識點及逐題回顧 */
export async function GET(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  return handleRoute(async () => {
    const { sessionId } = await context.params;
    const learnerId = await resolveLearnerId(request, new URL(request.url).searchParams.get("learnerId"));
    return jsonOk(getPracticeResult(sessionId, learnerId));
  });
}
