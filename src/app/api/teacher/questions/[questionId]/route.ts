import { z } from "zod";

import { handleRoute, jsonOk, parseJsonBody } from "@/server/http";
import { questionInputSchema, questionStatusSchema } from "@/lib/types";
import {
  changeQuestionStatus,
  removeQuestion,
  updateManualQuestion,
} from "@/server/services/question-service";
import { requireTeacher } from "@/server/auth/guards";

export const runtime = "nodejs";

const updateSchema = z.union([
  z.object({ action: z.literal("status"), status: questionStatusSchema }),
  z.object({ action: z.literal("edit"), question: questionInputSchema }),
]);

/** 教師端：發布／停用題目，或修改題目內容 */
export async function PATCH(request: Request, context: { params: Promise<{ questionId: string }> }) {
  return handleRoute(async () => {
    await requireTeacher(request);
    const { questionId } = await context.params;
    const body = await parseJsonBody(request, updateSchema);
    const question =
      body.action === "status"
        ? changeQuestionStatus(questionId, body.status)
        : updateManualQuestion(questionId, body.question);
    return jsonOk({ question });
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ questionId: string }> },
) {
  return handleRoute(async () => {
    await requireTeacher(request);
    const { questionId } = await context.params;
    removeQuestion(questionId);
    return jsonOk({ deleted: questionId });
  });
}
