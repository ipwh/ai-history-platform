import { systemStatusSchema } from "@/lib/types";
import { requireAdmin } from "@/server/auth/guards";
import { handleRoute, jsonOk } from "@/server/http";
import { getSystemStatusWithRoster } from "@/server/services/admin-dashboard";

export const runtime = "nodejs";

/**
 * 管理員端系統狀態：應用程式版本、資料庫連線、LLM／OCR provider、登入狀態、
 * 學生名冊狀態、部署提示（例如 Cloud Run 的暫時性儲存）及環境變數問題。
 * 不會回傳任何憑證、完整檔案路徑或學生資料。
 */
export async function GET(request: Request) {
  return handleRoute(async () => {
    await requireAdmin(request);
    return jsonOk(systemStatusSchema.parse(await getSystemStatusWithRoster()));
  });
}
