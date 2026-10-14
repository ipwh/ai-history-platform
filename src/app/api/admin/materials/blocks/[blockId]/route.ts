import { z } from "zod";

import { handleRoute, jsonOk, parseJsonBody } from "@/server/http";
import { editBlock } from "@/server/services/material-service";
import { requireAdmin } from "@/server/auth/guards";

export const runtime = "nodejs";

const blockUpdateSchema = z.object({
  text: z.string().max(4000).optional(),
  sectionId: z.string().min(1).nullable().optional(),
  topicId: z.string().min(1).nullable().optional(),
});

/** 管理員修改教材段落內容或改派分節 */
export async function PATCH(request: Request, context: { params: Promise<{ blockId: string }> }) {
  return handleRoute(async () => {
    await requireAdmin(request);
    const { blockId } = await context.params;
    const body = await parseJsonBody(request, blockUpdateSchema);
    const block = editBlock(blockId, body);
    return jsonOk({ block });
  });
}
