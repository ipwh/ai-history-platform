import { handleRoute, jsonOk } from "@/server/http";
import { resolveOptionalLearnerId } from "@/server/auth/guards";
import { getLessonView } from "@/server/services/lesson-service";
import { expandSectionIds } from "@/server/repositories/topics";

export const runtime = "nodejs";

/**
 * 學生閱讀教材：回傳已發布課題的教材內容（可指定分節）。
 *
 * 只回傳可用於出題的教材段落（校內試題及答案不會出現），內容原樣取自教材，
 * 不經 AI 改寫。未發布的課題一律回 404。
 */
export async function GET(request: Request, context: { params: Promise<{ topicId: string }> }) {
  return handleRoute(async () => {
    const { topicId } = await context.params;
    const params = new URL(request.url).searchParams;

    // 與其他學生端 API 一致：需要時要求登入，示範模式下使用匿名學習者
    await resolveOptionalLearnerId(request, params.get("learnerId"));

    const requested = params.get("sectionId");
    // 展開父分節以包含其子分節（與練習設定一致）
    const sectionIds =
      requested === null || requested.trim().length === 0
        ? []
        : expandSectionIds(topicId, [requested.trim()]);

    return jsonOk(getLessonView(topicId, sectionIds));
  });
}
