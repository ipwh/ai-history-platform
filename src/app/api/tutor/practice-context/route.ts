import { ApiRouteError, handleRoute, jsonOk } from "@/server/http";
import { requireTutorLearnerId } from "@/server/services/tutor-request-access";
import { resolveTutorPracticeContext } from "@/server/services/tutor-practice-context";

export const runtime = "nodejs";

/**
 * 練習 → 學伴的安全上下文。
 *
 * `GET /api/tutor/practice-context?questionId=…[&sessionId=…]`
 *
 * 只回傳「學生本來就看得到」的欄位（課題、題型、技能標籤、題幹摘要、建議問題）；
 * **永不**回傳 `correctAnswer`、`acceptedAnswers`、`explanation`、`knowledgePoint`、
 * 選項對錯、教材節錄或任何評卷資料（見 services/tutor-practice-context.ts）。
 *
 * 錯誤處理刻意一致：找不到／未發布／未達派題要求一律回 **404** 及同一句訊息，
 * 令未發布題目無法被藉此探測；不是自己的練習則由 `getPracticeView` 回 **403**。
 */
export async function GET(request: Request) {
  return handleRoute(async () => {
    const learnerId = await requireTutorLearnerId(request);
    const url = new URL(request.url);
    const questionId = url.searchParams.get("questionId")?.trim() ?? "";
    if (questionId.length === 0) throw new ApiRouteError("缺少 questionId", 400);
    const sessionId = url.searchParams.get("sessionId")?.trim() ?? null;
    const practiceContext = resolveTutorPracticeContext({ questionId, sessionId, learnerId });
    return jsonOk({
      practiceContext,
      skillHint:
        practiceContext.skill === null || practiceContext.skill.trim().length === 0
          ? null
          : `這題較常練習：${practiceContext.skill.trim()}`,
    });
  });
}
