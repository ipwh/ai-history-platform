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
 * 教師用：生成題目預覽。
 * 生成結果會以草稿狀態寫入題庫，並附上教材依據及來源段落方便查核。
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    await requireTeacher(request);
    const body = await parseJsonBody(request, generateSchema);
    const result = await generateQuestions(body);
    return jsonOk(result);
  });
}
