import { z } from "zod";

import { QUESTION_REPORT_REASONS } from "@/lib/types";
import { handleRoute, jsonOk, parseJsonBody } from "@/server/http";
import { resolveLearnerId, requireSignInBeforeBody } from "@/server/auth/guards";
import { submitQuestionReport } from "@/server/services/question-report-service";

export const runtime = "nodejs";

const reportSchema = z.object({
  /** 未登入時的匿名學習者 ID；已登入時會被忽略（一律使用工作階段身分） */
  learnerId: z.string().min(1),
  questionId: z.string().min(1),
  /** 作答中的練習（伺服器會核對回報者確實做過這題） */
  sessionId: z.string().min(1).nullable().default(null),
  /** 相關的作答記錄（伺服器會核對屬於這位學生、這次練習及這一題） */
  attemptId: z.string().min(1).nullable().default(null),
  reason: z.enum(QUESTION_REPORT_REASONS),
  detail: z.string().max(500).default(""),
});

/**
 * 學生回報題目（教師亦可使用，方便測試學生體驗）。
 *
 * 學習者 ID 一律由工作階段推導：已啟用登入時無法代替他人回報；
 * 未啟用登入（匿名示範模式）時才使用前端提供的匿名 ID。
 * 回報不會自動刪除或停用題目，只會在教師端標示「待覆核」，
 * 並記下當時的題目版本及相關作答。
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    await requireSignInBeforeBody(request);
    const body = await parseJsonBody(request, reportSchema);
    const learnerId = await resolveLearnerId(request, body.learnerId);
    return jsonOk(submitQuestionReport(learnerId, body), 201);
  });
}
