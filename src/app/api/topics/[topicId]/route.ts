import { ApiRouteError, handleRoute, jsonOk } from "@/server/http";
import { resolveOptionalLearnerId } from "@/server/auth/guards";
import { getTopicDetail } from "@/server/services/topic-service";

export const runtime = "nodejs";

/** 單一課題的詳細資料（含分節樹及進度） */
export async function GET(request: Request, context: { params: Promise<{ topicId: string }> }) {
  return handleRoute(async () => {
    const { topicId } = await context.params;
    const learnerId = await resolveOptionalLearnerId(
      request,
      new URL(request.url).searchParams.get("learnerId"),
    );
    const topic = getTopicDetail(topicId, learnerId);
    if (!topic) throw new ApiRouteError("找不到指定的課題", 404);
    return jsonOk({ topic });
  });
}
