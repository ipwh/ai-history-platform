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

/**
 * 教師端：發布／停用題目，或修改題目內容。
 *
 * 發布（`status = published`）需要對應**目前版本**的人工覆核紀錄**或**自動品質驗證紀錄，
 * 否則回 409：單憑教材依據自動核對（`sourceVerified`）或舊資料都不會令題目通過這個關卡。
 * 修改已發布的題目會即時下架（回到草稿），必須重新覆核或重新執行自動品質驗證才可再次發布。
 */
export async function PATCH(request: Request, context: { params: Promise<{ questionId: string }> }) {
  return handleRoute(async () => {
    await requireTeacher(request);
    const { questionId } = await context.params;
    const body = await parseJsonBody(request, updateSchema);
    return jsonOk(
      body.action === "status"
        ? { view: changeQuestionStatus(questionId, body.status) }
        : { view: updateManualQuestion(questionId, body.question) },
    );
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
