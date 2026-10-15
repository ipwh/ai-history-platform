/**
 * 測試輔助：把教材切換到「已由管理員確認可向學生發布」的狀態。
 *
 * 為甚麼需要這個輔助函式：學生端能否看到教材，取決於**兩個**條件——
 * `material_documents.student_distribution = 1`（管理員想開放）**以及**遷移 0017 的治理紀錄
 * （版權確認 `rights_confirmed_at`；教師版文件另需內容覆核 `content_reviewed_at`）。
 * 只設定前者不會令文件對學生可見（見 `listStudentDistributableDocumentIds` 與
 * tests/document-governance-legacy.test.ts）。
 *
 * 因此測試不能用 `setDocumentStudentDistribution(id, true)` 模擬「已開放」，而要走與
 * `PATCH /api/admin/materials/[documentId]` 相同的順序：先記錄確認，再設定發行權。
 * 這不是假造授權——只是把測試環境帶到「管理員已確認」的狀態；測試不會替任何人判斷版權。
 */
import { looksLikeTeacherEdition } from "@/server/materials/teacher-content";

type MaterialsRepo = typeof import("@/server/repositories/materials");

const TEST_ACTOR = "test-admin@example.com";

/** 以「已確認版權（教師版另加內容覆核）」的方式開放一份文件給學生 */
export function openDocumentForStudents(
  materials: MaterialsRepo,
  documentId: string,
): void {
  const document = materials.getDocument(documentId);
  if (!document) throw new Error(`找不到教材文件：${documentId}`);
  const at = new Date().toISOString();
  materials.recordDocumentGovernance({
    documentId,
    rights: { confirmedBy: TEST_ACTOR, at },
    ...(looksLikeTeacherEdition(document.fileName)
      ? { contentSafety: { reviewedBy: TEST_ACTOR, at } }
      : {}),
  });
  materials.setDocumentStudentDistribution(documentId, true);
}

/** 撤銷學生閱讀權限（不需要任何確認，且立即生效） */
export function closeDocumentForStudents(
  materials: MaterialsRepo,
  documentId: string,
): void {
  materials.setDocumentStudentDistribution(documentId, false);
}
