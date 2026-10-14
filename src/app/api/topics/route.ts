import { handleRoute, jsonOk } from "@/server/http";
import { resolveOptionalLearnerId } from "@/server/auth/guards";
import { listTopicOverviews } from "@/server/services/topic-service";

export const runtime = "nodejs";

/** 首頁：課題卡片（含分節、題目數及此學習者的進度） */
export async function GET(request: Request) {
  return handleRoute(async () => {
    const params = new URL(request.url).searchParams;
    const learnerId = await resolveOptionalLearnerId(request, params.get("learnerId"));
    const publishedOnly = params.get("publishedOnly") === "true";
    return jsonOk({ topics: listTopicOverviews(learnerId, { publishedOnly }) });
  });
}
