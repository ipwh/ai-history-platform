import { handleRoute, jsonOk } from "@/server/http";
import { resolveOptionalLearnerId } from "@/server/auth/guards";
import { getTopic } from "@/server/repositories/topics";
import {
  getRecommendations,
  getReviewQueue,
  getSkillProgress,
  getTopicProgress,
  listProgressTopics,
  sectionTitles,
} from "@/server/services/learning-loop";

export const runtime = "nodejs";

/**
 * 學習進度、重溫佇列及下一步建議（學生端，單次請求回傳）。
 *
 * 學習者身分一律由伺服器端的工作階段推導（`resolveOptionalLearnerId` 會忽略前端傳來的值），
 * 因此不存在讀取其他學生進度的途徑；回傳內容只有該學生自己的統計數字，
 * 不含其他學生的任何資料。
 */
export async function GET(request: Request) {
  return handleRoute(async () => {
    const params = new URL(request.url).searchParams;
    const learnerId = await resolveOptionalLearnerId(request, params.get("learnerId"));

    // 未有學習者身分（例如尚未登入的示範模式）時只回傳空結構，不虛擬任何進度
    if (learnerId === null) {
      return jsonOk({
        topics: [],
        skills: [],
        review: { dueItems: [], dueCount: 0, dataIssues: 0 },
        recommendations: [],
      });
    }

    const requestedTopicId = params.get("topicId")?.trim() ?? "";
    const requestedTopic = requestedTopicId.length > 0 ? getTopic(requestedTopicId) : null;
    // 只提供已發布課題的進度；未發布或不存在的課題不會回傳任何內容
    const publishedTopic = requestedTopic !== null && requestedTopic.published ? requestedTopic : null;

    const topicSummaries = listProgressTopics().map((item) => ({
      ...getTopicProgress(learnerId, item.id),
      title: item.title,
    }));

    const skills =
      publishedTopic === null
        ? []
        : getSkillProgress(learnerId, publishedTopic.id).map((skill) => ({
            ...skill,
            topicTitle: publishedTopic.title,
          }));

    const queue = getReviewQueue(learnerId, {});
    const topicTitles = new Map(listProgressTopics().map((item) => [item.id, item.title]));
    const sectionCache = new Map<string, Map<string, string>>();
    const dueItems = queue.dueItems.slice(0, 50).map((item) => {
      if (!sectionCache.has(item.topicId)) {
        sectionCache.set(item.topicId, sectionTitles(item.topicId));
      }
      return {
        ...item,
        topicTitle: topicTitles.get(item.topicId) ?? "",
        sectionTitle: sectionCache.get(item.topicId)?.get(item.sectionId) ?? "",
      };
    });

    return jsonOk({
      topics: topicSummaries,
      skills,
      review: { dueItems, dueCount: queue.dueCount, dataIssues: queue.dataIssues },
      recommendations: getRecommendations(learnerId),
    });
  });
}
