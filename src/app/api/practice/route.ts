import { handleRoute, jsonOk, parseJsonBody } from "@/server/http";
import { requireSignInBeforeBody, resolveLearnerId } from "@/server/auth/guards";
import { practiceSetupSchema } from "@/lib/types";
import { createPractice } from "@/server/services/practice-service";

export const runtime = "nodejs";

/**
 * 建立練習：回傳這次練習的題目（不含答案）。
 * 出題方式：bank（題庫優先，不足時即時生成）或 ai（依所選分節即時生成）。
 * 已登入時一律使用帳戶對應的學習者 ID，前端傳來的 learnerId 會被忽略。
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    await requireSignInBeforeBody(request);
    const setup = await parseJsonBody(request, practiceSetupSchema);
    const learnerId = await resolveLearnerId(request, setup.learnerId);
    const practice = await createPractice({ ...setup, learnerId });
    return jsonOk(practice, 201);
  });
}
