import { z } from "zod";

import { ApiRouteError, handleRoute, jsonOk, parseJsonBody } from "@/server/http";
import { publishTopic } from "@/server/services/topic-service";
import { requireAdmin } from "@/server/auth/guards";

export const runtime = "nodejs";

const publishSchema = z.object({ published: z.boolean() });

/** 管理員端：發布或取消發布課題 */
export async function PATCH(request: Request, context: { params: Promise<{ topicId: string }> }) {
  return handleRoute(async () => {
    await requireAdmin(request);
    const { topicId } = await context.params;
    const body = await parseJsonBody(request, publishSchema);
    const topic = publishTopic(topicId, body.published);
    if (!topic) throw new ApiRouteError("找不到指定的課題", 404);
    return jsonOk({ topic });
  });
}
