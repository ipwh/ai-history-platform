import { ApiRouteError, handleRoute, jsonOk } from "@/server/http";
import { requireTeacher } from "@/server/auth/guards";
import { listGoldenCandidateViews } from "@/server/services/golden-approval";

export const runtime = "nodejs";

/**
 * 教師端：Golden Dataset v2 候選清單（唯讀）。
 *
 * 只顯示候選、目前題目版本／指紋、既有裁決及是否仍然有效；
 * 未經教師核准的候選一律為 `pending-review`。
 */
export async function GET(request: Request) {
  return handleRoute(async () => {
    const viewer = await requireTeacher(request);
    if (!viewer) throw new ApiRouteError("需要教師或管理員登入才可查看 Golden 候選", 401);
    try {
      return jsonOk({ candidates: listGoldenCandidateViews() });
    } catch (error) {
      throw new ApiRouteError(
        error instanceof Error ? error.message : "無法讀取 Golden 候選清單",
        500,
      );
    }
  });
}
