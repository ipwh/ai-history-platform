import { z } from "zod";

import { handleRoute, jsonOk, parseJsonBody } from "@/server/http";
import { questionGenerationRequestSchema } from "@/lib/types";
import { generateQuestions } from "@/server/services/question-service";
import { requireTeacher } from "@/server/auth/guards";

export const runtime = "nodejs";

const generateSchema = questionGenerationRequestSchema.extend({
  allowMockFallback: z.boolean().optional(),
});

/**
 * 教師用：生成題目。
 *
 * 生成結果會寫入題庫並附上教材依據及來源段落方便查核。**Sprint 7.8 起**：
 * 通過自動品質驗證的題目會即時發布供學生自學（`AUTO_PUBLISH_VALIDATED_QUESTIONS`，
 * 預設開啟），回應會帶 `autoValidatedAt` 及發布後的 `status`；未通過驗證的題目
 * 維持草稿。自動驗證**不會**建立任何人工覆核紀錄。
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    await requireTeacher(request);
    const body = await parseJsonBody(request, generateSchema);
    const result = await generateQuestions(body);
    return jsonOk(result);
  });
}
