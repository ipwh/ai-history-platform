import { handleRoute, jsonOk } from "@/server/http";
import { requireTeacher } from "@/server/auth/guards";
import { getTeacherTutorStats } from "@/server/services/tutor-stats";

export const runtime = "nodejs";

/**
 * 教師端：學伴使用概況（**只有聚合數字**）。
 *
 * `GET /api/teacher/tutor-stats?days=7|30`
 *
 * 教師及管理員可讀取；學生一律 403（由 `requireTeacher` 處理）。
 * 回應**不含**任何對話正文、題幹或學生身分（見 services/tutor-stats.ts）；
 * `contentIncluded: false` 是契約的一部分，測試會檢查。
 */
export async function GET(request: Request) {
  return handleRoute(async () => {
    await requireTeacher(request);
    const raw = new URL(request.url).searchParams.get("days");
    const parsed = raw === null ? null : Number.parseInt(raw, 10);
    return jsonOk(getTeacherTutorStats({ days: Number.isFinite(parsed) ? parsed : null }));
  });
}
