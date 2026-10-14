import { handleRoute, jsonOk } from "@/server/http";
import { resolveLearnerId } from "@/server/auth/guards";
import { getPracticeView } from "@/server/services/practice-service";

export const runtime = "nodejs";

/** 取得這次練習的題目（學生作答時使用，不包含答案） */
export async function GET(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  return handleRoute(async () => {
    const { sessionId } = await context.params;
    const learnerId = await resolveLearnerId(request, new URL(request.url).searchParams.get("learnerId"));
    return jsonOk(getPracticeView(sessionId, learnerId));
  });
}
