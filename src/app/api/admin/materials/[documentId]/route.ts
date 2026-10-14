import { z } from "zod";

import { handleRoute, jsonOk, parseJsonBody } from "@/server/http";
import { assignTopic, getDocumentBlocks, removeDocument } from "@/server/services/material-service";
import { requireAdmin } from "@/server/auth/guards";
import { removeStoredFile } from "@/server/storage";

export const runtime = "nodejs";

/** 教材段落預覽（供管理員核對擷取結果） */
export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  return handleRoute(async () => {
    await requireAdmin(request);
    const { documentId } = await context.params;
    const { document, blocks } = getDocumentBlocks(documentId);
    return jsonOk({ document, blocks });
  });
}

const assignSchema = z.object({ topicId: z.string().min(1).nullable() });

/** 指定或解除教材所屬課題 */
export async function PATCH(request: Request, context: { params: Promise<{ documentId: string }> }) {
  return handleRoute(async () => {
    await requireAdmin(request);
    const { documentId } = await context.params;
    const body = await parseJsonBody(request, assignSchema);
    const document = assignTopic(documentId, body.topicId);
    return jsonOk({ document });
  });
}

/** 刪除教材（同時刪除已擷取的段落及儲存的原始檔案） */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  return handleRoute(async () => {
    await requireAdmin(request);
    const { documentId } = await context.params;
    await removeStoredFile(removeDocument(documentId));
    return jsonOk({ deleted: documentId });
  });
}
