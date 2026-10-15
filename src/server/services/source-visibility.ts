/**
 * 題目的「教材節錄是否可向學生顯示」政策（單一來源）。
 *
 * 為什麼要獨立成一個模組：學生端回饋（practice-service）與教師端覆核清單
 * （question-service）都需要同一個判定。若各自實作，兩邊很容易出現不一致——
 * 例如教師以為學生看得到節錄，實際上被閘門略去。
 *
 * 政策（Sprint 6 起，fail-closed）：
 *   1. 題目**有引用教材段落**時，只有當所有引用段落都屬於已確認可向學生發布
 *      （`documentIsStudentVisible`：已開放、已確認版權、教師版另需內容覆核紀錄）
 *      且非教師專用的文件時才顯示節錄。
 *   2. 任何一段查不到、不屬可發布文件，或判定過程出錯，一律不顯示。
 *   3. 題目**沒有引用任何教材段落**時（示範題庫的作者標註、教師手動建立的題目），
 *      節錄是作者自行撰寫的文字，因此維持顯示。
 *   4. 引用段落若屬**非課文內容**（教師版教材的練習題目、評分參考及答案、圖片佔位標記、
 *      零散數字），節錄一律不顯示——同樣的判斷用於閱讀頁及出題素材
 *      （見 materials/content-policy.ts）。
 *
 * 只影響節錄文字、來源位置及段落 ID；題目本身、答案、解釋及學習記錄不受影響。
 */
import type { Question, StudentExcerptHiddenReason } from "@/lib/types";
import { getBlocksByIds, listStudentDistributableDocumentIds } from "../repositories/materials";
import { isTeacherOnlyBlockText } from "../materials/teacher-content";
import { isNonLessonContent } from "../materials/content-policy";

/** 學生看不到節錄的原因（型別定義在 lib/types.ts，令教師端顯示的說明與此判定一致） */
export type { StudentExcerptHiddenReason };

export function studentExcerptVisibility(question: Question): {
  visible: boolean;
  reason: StudentExcerptHiddenReason | null;
} {
  if (question.sourceBlockIds.length === 0) return { visible: true, reason: null };

  try {
    const distributable = listStudentDistributableDocumentIds();
    const blocks = getBlocksByIds(question.sourceBlockIds);
    if (blocks.length !== question.sourceBlockIds.length) {
      return { visible: false, reason: "missing-source-blocks" };
    }
    let reason: StudentExcerptHiddenReason | null = null;
    for (const block of blocks) {
      if (!distributable.has(block.documentId)) {
        reason = "unconfirmed-material";
        break;
      }
      const text = [block.text, ...(block.table ?? []).flat().map((cell) => cell.text)].join("\n");
      if (isTeacherOnlyBlockText(text)) {
        reason = "teacher-edition";
        break;
      }
      if (isNonLessonContent(text, { fromOcr: block.extractionMethod === "ocr" })) {
        reason = "exercise-content";
        break;
      }
    }
    return { visible: reason === null, reason };
  } catch {
    return { visible: false, reason: "lookup-failed" };
  }
}

export function studentExcerptIsVisible(question: Question): boolean {
  return studentExcerptVisibility(question).visible;
}
