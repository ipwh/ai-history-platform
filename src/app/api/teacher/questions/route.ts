import { ApiRouteError, handleRoute, jsonOk, parseJsonBody } from "@/server/http";
import { questionInputSchema, questionOriginSchema, questionStatusSchema } from "@/lib/types";
import { createManualQuestion, listTopicQuestions } from "@/server/services/question-service";
import { requireTeacher } from "@/server/auth/guards";

export const runtime = "nodejs";

/** 題目清單（可按分節、狀態及來源篩選） */
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
    return jsonOk({ questions });
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
