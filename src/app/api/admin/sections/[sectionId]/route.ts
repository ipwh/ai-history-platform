import { z } from "zod";

import { handleRoute, jsonOk, parseJsonBody } from "@/server/http";
import { updateSectionDetails } from "@/server/services/topic-service";
import { requireAdmin } from "@/server/auth/guards";

export const runtime = "nodejs";

const sectionUpdateSchema = z.object({
  title: z.string().min(1).max(80).optional(),
  summary: z.string().max(400).optional(),
  matchKeywords: z.array(z.string().min(1).max(40)).max(20).optional(),
});

/** 管理員端：修改分節名稱、說明及教材對應關鍵詞 */
export async function PATCH(request: Request, context: { params: Promise<{ sectionId: string }> }) {
  return handleRoute(async () => {
    await requireAdmin(request);
    const { sectionId } = await context.params;
    const body = await parseJsonBody(request, sectionUpdateSchema);
    const section = updateSectionDetails(sectionId, body);
    return jsonOk({ section });
  });
}
