import { z } from "zod";

import { ApiRouteError, handleRoute, jsonOk } from "@/server/http";
import { requireTeacher } from "@/server/auth/guards";
import {
  listReviewQueue,
  MAX_PAGE_SIZE,
  REVIEW_QUEUES,
  type ReviewQueue,
} from "@/server/services/review-queue";

export const runtime = "nodejs";

const querySchema = z.object({
  queue: z.enum(REVIEW_QUEUES),
  page: z.coerce.number().int().positive().max(1000).optional(),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).optional(),
});

/**
 * 教師審核工作台的分批佇列（唯讀）。
 *
 * 只允許教師／管理員讀取（`requireTeacher`）；學生 403、未登入 401。
 * 佇列內容來自既有稽核報告，不會改變任何題目或裁決狀態。
 */
export async function GET(request: Request) {
  return handleRoute(async () => {
    const viewer = await requireTeacher(request);
    if (!viewer) throw new ApiRouteError("需要教師或管理員登入才可查看審核佇列", 401);

    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      queue: url.searchParams.get("queue") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    if (!parsed.success) {
      throw new ApiRouteError(
        `查詢參數不正確：${parsed.error.issues.map((issue) => issue.path.join(".")).join("、")}`,
        400,
      );
    }

    return jsonOk(listReviewQueue(parsed.data.queue as ReviewQueue, parsed.data));
  });
}
