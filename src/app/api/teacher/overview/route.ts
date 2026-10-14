import { handleRoute, jsonOk } from "@/server/http";
import { requireTeacher } from "@/server/auth/guards";
import { getTeacherQuestionOverview } from "@/server/services/teacher-overview";

export const runtime = "nodejs";

/**
 * 教師端首頁統計：題庫狀態、待覆核回報及學生練習記錄數量。
 * 教師及管理員皆可讀取；教材、OCR 及系統狀態不在這裡回傳（屬管理員職能）。
 */
export async function GET(request: Request) {
  return handleRoute(async () => {
    await requireTeacher(request);
    return jsonOk(getTeacherQuestionOverview());
  });
}
