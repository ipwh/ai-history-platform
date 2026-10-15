import { z } from "zod";

import { ApiRouteError, handleRoute, jsonOk, parseJsonBody } from "@/server/http";
import { assignTopic, getDocumentBlocks, removeDocument } from "@/server/services/material-service";
import {
  getDocument,
  listDistributionAudit,
  recordDistributionChange,
  setDocumentStudentDistribution,
} from "@/server/repositories/materials";
import { requireAdmin } from "@/server/auth/guards";
import { removeStoredFile } from "@/server/storage";
import { isTeacherOnlyBlockText, looksLikeTeacherEdition } from "@/server/materials/teacher-content";

export const runtime = "nodejs";

/** 教材段落預覽（供管理員核對擷取結果）及發行權變更記錄 */
export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  return handleRoute(async () => {
    await requireAdmin(request);
    const { documentId } = await context.params;
    const { document, blocks } = getDocumentBlocks(documentId);
    const teacherOnlyBlocks = blocks.filter((block) =>
      isTeacherOnlyBlockText(
        [block.text, ...(block.table ?? []).flat().map((cell) => cell.text)].join("\n"),
      ),
    ).length;
    return jsonOk({
      document,
      blocks,
      distributionAudit: listDistributionAudit(documentId),
      // 供管理員核對：這份文件有多少段落被判定為教師專用內容而不會顯示給學生
      teacherOnlyBlockCount: teacherOnlyBlocks,
      looksLikeTeacherEdition: looksLikeTeacherEdition(document.fileName),
    });
  });
}

const updateDocumentSchema = z
  .object({
    /** 指定或解除教材所屬課題 */
    topicId: z.string().min(1).nullable().optional(),
    /**
     * 學生可否在平台內閱讀這份教材（版權閘門）。
     * 只有確認擁有在平台向學生發布該內容的權利時才可設為 true；
     * 未確認的文件對學生完全不顯示（見 README「教材版權與學生閱讀範圍」）。
     */
    studentDistribution: z.boolean().optional(),
    /**
     * 額外確認：檔名標示為「教師版／答案」的文件必須明確帶上這個旗標才可開放，
     * 避免管理員在清單上誤按即等同把教師版教材（可能含答案）發布給學生。
     */
    confirmTeacherEdition: z.boolean().optional(),
  })
  .refine(
    (value) => value.topicId !== undefined || value.studentDistribution !== undefined,
    { message: "請提供要更新的欄位（topicId 或 studentDistribution）" },
  );

/** 指定／解除教材所屬課題，或設定學生閱讀權限（後者會留下稽核記錄） */
export async function PATCH(request: Request, context: { params: Promise<{ documentId: string }> }) {
  return handleRoute(async () => {
    const admin = await requireAdmin(request);
    const { documentId } = await context.params;
    const body = await parseJsonBody(request, updateDocumentSchema);

    let document = getDocument(documentId);
    if (!document) throw new ApiRouteError("找不到指定的教材文件", 404);

    if (body.topicId !== undefined) {
      document = assignTopic(documentId, body.topicId);
    }
    if (
      body.studentDistribution === true &&
      looksLikeTeacherEdition(document.fileName) &&
      body.confirmTeacherEdition !== true
    ) {
      // 教師版教材可能夾附答案、評分參考及教師註記；檔名已明確標示，
      // 因此要求額外確認，而不是讓「開放學生閱讀」一個按鈕就等於發布教師版內容。
      throw new ApiRouteError(
        `「${document.fileName}」的檔名標示為教師版／答案材料，可能包含不適合學生閱讀的內容。` +
          "確認已核對內容後，請帶同 confirmTeacherEdition: true 再次提交。",
        409,
      );
    }
    if (body.studentDistribution !== undefined) {
      // 重複設定相同值不會留下重複的稽核記錄（避免紀錄被無意義的操作淹沒）
      const changed = document.studentDistribution !== body.studentDistribution;
      if (changed) {
        setDocumentStudentDistribution(documentId, body.studentDistribution);
        // 操作者一律取自伺服器端身分；以管理員權杖或示範模式操作時另作標示，
        // 不會因為沒有帳戶就失去記錄，亦不會接受前端提供的操作者名稱。
        recordDistributionChange({
          documentId,
          allowed: body.studentDistribution,
          actorEmail: admin?.email ?? "（管理員權杖或示範模式）",
          actorRole: admin?.role ?? "admin-token-or-demo",
        });
      }
      document = getDocument(documentId);
    }

    return jsonOk({
      document,
      changed: body.studentDistribution === undefined ? null : document?.studentDistribution ?? null,
      distributionAudit: listDistributionAudit(documentId),
    });
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
