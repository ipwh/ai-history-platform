import { ApiRouteError, handleRoute, jsonOk, parseJsonBody } from "@/server/http";
import { questionInputSchema, questionOriginSchema, questionStatusSchema } from "@/lib/types";
import {
  createManualQuestion,
  listTopicQuestions,
  questionReviewStatuses,
} from "@/server/services/question-service";
import { requireTeacher } from "@/server/auth/guards";

export const runtime = "nodejs";

/**
 * 題目清單（可按分節、狀態及來源篩選）。
 *
 * 除題目本身外，一併回傳每題的**人工覆核狀態**（誰在何時決定、是否已通過、
 * 是否在覆核後被修改），令教師不必逐題猜測哪一題可以發布。
 * 學生可見性仍然只由 `questions.status` 決定。
 */
export async function GET(request: Request) {
  return handleRoute(async () => {
    await requireTeacher(request);
    const params = new URL(request.url).searchParams;
    const topicId = params.get("topicId");
    if (!topicId) throw new ApiRouteError("請提供 topicId", 400);

    const sectionId = params.get("sectionId") ?? undefined;
    const statusParam = params.get("status");
    const statuses = statusParam ? [questionStatusSchema.parse(statusParam)] : undefined;
    // 來源篩選：校內試卷（school-paper）與 AI／教材生成分開列出，方便教師分批核對
    const originParam = params.get("origin");
    const origins = originParam ? [questionOriginSchema.parse(originParam)] : undefined;

    const questions = listTopicQuestions({ topicId, sectionId, statuses, origins });
    return jsonOk({ questions, reviews: questionReviewStatuses(questions) });
  });
}

/** 教師手動新增題目 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    await requireTeacher(request);
    const body = await parseJsonBody(request, questionInputSchema);
    const question = createManualQuestion(body);
    return jsonOk({ question }, 201);
  });
}
