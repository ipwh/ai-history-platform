/**
 * 教材自動開放給學生（2026-10-21 擁有者政策）。
 *
 * 背景：平台的教材版權閘門原本要求管理員**逐份**確認「有權向學生發布」（`confirmRights`），
 * 教師版另需內容安全覆核。實測發現正式環境的教材從未匯入，而匯入功能本身亦有 bug，
 * 結果學生端每個課題都顯示「尚未匯入教材」，AI 即時出題完全不能用。
 * 擁有者因此指示：**往後自動開放所有教材**，令學生可直接以課本內容自學。
 *
 * 這裡的做法與界線（必須如實保留）：
 *   1. **記錄如實**：`rights_confirmed_by` 寫入 `owner-policy:auto-open-all-materials`，
 *      不是假裝某位教師逐份確認；`distribution_audit` 同樣記錄為政策自動執行。
 *   2. **不開放校內試題檔**（`kind = 'question-bank'`）：那些是題目與答案，
 *      永遠不會成為學生讀物或出題依據。
 *   3. **不代為完成「內容安全覆核」**：檔名標示教師版／答案的材料仍要求管理員人手確認，
 *      因為那一項是「已逐段核對答案沒有外洩」，由機器代答就是偽造紀錄（fail-closed）。
 *   4. 段落層的教師專用內容仍由 `isTeacherOnlyBlockText` 在**讀取時**過濾。
 */
import { getServerConfig } from "../config";
import {
  documentIsStudentVisible,
  getDocument,
  listDocuments,
  recordDistributionChange,
  recordDocumentGovernance,
  setDocumentStudentDistribution,
} from "../repositories/materials";
import { looksLikeTeacherEdition } from "../materials/teacher-content";

/** 開放紀錄的確認者（政策自動執行；不是任何個人的逐份確認） */
export const AUTO_OPEN_ACTOR = "owner-policy:auto-open-all-materials";
export const AUTO_OPEN_ACTOR_ROLE = "owner-policy";

export function autoOpenPolicyEnabled(): boolean {
  return getServerConfig().materialAutoOpenPolicy === "lesson-content";
}

export interface AutoOpenOutcome {
  documentId: string;
  fileName: string;
  /** `opened`＝今次已開放；`already-open`＝原本已可向學生顯示 */
  status: "opened" | "already-open" | "skipped-question-bank" | "needs-teacher-edition-review";
  reason: string | null;
}

/**
 * 依政策開放單一文件。
 *
 * 只會處理「課文／筆記」類文件（非校內試題、非教師版檔名）；其餘一律回報原因，
 * 不會靜默跳過，令管理員知道哪一份仍需要人手處理。
 */
export function autoOpenDocument(documentId: string): AutoOpenOutcome | null {
  const document = getDocument(documentId);
  if (!document) return null;

  if (document.kind === "question-bank") {
    return {
      documentId,
      fileName: document.fileName,
      status: "skipped-question-bank",
      reason: "校內試題檔（題目與答案）永遠不會開放給學生。",
    };
  }

  if (documentIsStudentVisible(document)) {
    return { documentId, fileName: document.fileName, status: "already-open", reason: null };
  }

  if (looksLikeTeacherEdition(document.fileName)) {
    return {
      documentId,
      fileName: document.fileName,
      status: "needs-teacher-edition-review",
      reason:
        "檔名標示為教師版／答案材料；自動開放不會代為確認「已逐段核對內容」，請在教材管理逐份確認。",
    };
  }

  const at = new Date().toISOString();
  recordDocumentGovernance({
    documentId,
    rights: { confirmedBy: AUTO_OPEN_ACTOR, at },
  });
  if (!document.studentDistribution) {
    setDocumentStudentDistribution(documentId, true);
    recordDistributionChange({
      documentId,
      allowed: true,
      actorEmail: AUTO_OPEN_ACTOR,
      actorRole: AUTO_OPEN_ACTOR_ROLE,
    });
  }
  return { documentId, fileName: document.fileName, status: "opened", reason: null };
}

/**
 * 依政策開放**所有**現有課文／筆記文件（供匯入後或管理員按鈕使用）。
 * 政策關閉時不做任何事，並回報 `policy-disabled`。
 */
export function autoOpenAllLessonDocuments(): {
  policyEnabled: boolean;
  opened: number;
  alreadyOpen: number;
  skipped: number;
  outcomes: AutoOpenOutcome[];
} {
  if (!autoOpenPolicyEnabled()) {
    return { policyEnabled: false, opened: 0, alreadyOpen: 0, skipped: 0, outcomes: [] };
  }
  const outcomes: AutoOpenOutcome[] = [];
  for (const document of listDocuments()) {
    const outcome = autoOpenDocument(document.id);
    if (outcome) outcomes.push(outcome);
  }
  return {
    policyEnabled: true,
    opened: outcomes.filter((entry) => entry.status === "opened").length,
    alreadyOpen: outcomes.filter((entry) => entry.status === "already-open").length,
    skipped: outcomes.filter(
      (entry) =>
        entry.status === "skipped-question-bank" || entry.status === "needs-teacher-edition-review",
    ).length,
    outcomes,
  };
}
