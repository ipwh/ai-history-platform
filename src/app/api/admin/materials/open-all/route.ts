import { handleRoute, jsonOk } from "@/server/http";
import { requireAdmin } from "@/server/auth/guards";
import { autoOpenAllLessonDocuments } from "@/server/services/material-distribution";

export const runtime = "nodejs";

/**
 * 依擁有者政策，一次過把**所有課文／筆記**教材開放給學生使用（AI 即時出題）。
 *
 * 為甚麼需要這個端點：自動開放原本只在匯入時執行，若教材在政策生效前已匯入，
 * 或匯入後才需要補開放，就沒有渠道。管理員在教材管理按一次即可完成，並且：
 *   1. 只處理非校內試題、非教師版檔名的文件（其餘一律回報原因）；
 *   2. 確認者如實記錄為 `owner-policy:auto-open-all-materials`（不是假裝某位教師逐份確認）；
 *   3. 撤銷開放（逐份關閉）不受影響，隨時可以收回。
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    await requireAdmin(request);
    return jsonOk(autoOpenAllLessonDocuments());
  });
}
