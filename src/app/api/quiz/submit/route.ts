import { handleRoute, jsonOk, parseJsonBody } from "@/server/http";
import { requireSignInBeforeBody, resolveLearnerId } from "@/server/auth/guards";
import { quizSubmissionSchema, submitQuizAnswer } from "@/server/services/quiz-submission-service";

export const runtime = "nodejs";

/**
 * 獨立批改端點：答案只在伺服器比對，批改後才把正確答案及解釋回傳。
 *
 * 提交格式：`{ questionId, studentAnswer }`（可選 `sessionId` 以記錄在練習之內）。
 * 已登入時一律使用工作階段對應的學習者 ID，前端傳來的 `learnerId` 會被忽略。
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    await requireSignInBeforeBody(request);
    const body = await parseJsonBody(request, quizSubmissionSchema);
    const learnerId = await resolveLearnerId(request, body.learnerId);
    return jsonOk(await submitQuizAnswer({ ...body, learnerId }));
  });
}
