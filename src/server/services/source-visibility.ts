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
 *   3. 題目**沒有引用任何教材段落**時，只有**作者自行撰寫節錄**的來源（示範題庫、
 *      教師手動建立的題目）維持顯示；其餘來源一律不顯示（見下）。
 *   4. 引用段落若屬**非課文內容**（教師版教材的練習題目、評分參考及答案、圖片佔位標記、
 *      零散數字），節錄一律不顯示——同樣的判斷用於閱讀頁及出題素材
 *      （見 materials/content-policy.ts）。
 *   5. **匯入的校內試題（`origin = "school-paper"`）即使沒有引用段落亦不顯示節錄**
 *      （Sprint 7.5）：匯入時 `sourceExcerpt` 直接取自試題檔的題目文字，`sourceLocation`
 *      記錄原檔名及題號，兩者都是**試題檔的來源標註，不是教師撰寫的內容**。空白的
 *      `sourceBlockIds` 只代表「沒有對應的教材段落」，**不可**當成「來源可向學生發布」的
 *      證明。因此沒有可核對教材依據的題目一律 fail-closed，避免學生端看到試題檔的
 *      檔名及題號。
 *
 * 只影響節錄文字、來源位置及段落 ID；題目本身、答案、解釋及學習記錄不受影響。
 * 教師端仍然看得到完整節錄及來源位置（用於核對依據），只是會標示「學生看不到節錄」。
 */
import type { Question, StudentExcerptHiddenReason } from "@/lib/types";
import { getBlocksByIds, listStudentDistributableDocumentIds } from "../repositories/materials";
import { isTeacherOnlyBlockText } from "../materials/teacher-content";
import { isNonLessonContent } from "../materials/content-policy";
import { AUTHOR_WRITTEN_EXCERPT_ORIGINS } from "../materials/block-search";

/** 學生看不到節錄的原因（型別定義在 lib/types.ts，令教師端顯示的說明與此判定一致） */
export type { StudentExcerptHiddenReason };

/**
 * 沒有引用教材段落時，節錄仍可視為**作者自行撰寫**的來源（名單為下方匯入的
 * `AUTHOR_WRITTEN_EXCERPT_ORIGINS`；定義放在 [block-search.ts](../materials/block-search.ts)，
 * 因為「節錄可否作為自動連結的教材依據」的規則同樣需要它——兩處必須一致，否則同一個來源
 * 會在「可否自動連結」與「可否顯示」之間得到不同結論）：
 *
 *   - `demo`：內建示範題庫，節錄由作者撰寫（見 seed/index.ts）；
 *   - `manual`：教師在平台手動建立。
 *
 * 其餘來源（`school-paper` 匯入試題、`material-ai`／`material-mock` 由教材生成）
 * 的節錄一律來自教材或試題檔，沒有段落依據時無法核實，因此 fail-closed。
 * **任何未知來源亦不在名單內**，避免日後新增來源時默默變成可顯示。
 */
export function studentExcerptVisibility(question: Question): {
  visible: boolean;
  reason: StudentExcerptHiddenReason | null;
} {
  if (question.sourceBlockIds.length === 0) {
    // 空白的 sourceBlockIds 不是「來源可發布」的證明：只有作者自行撰寫的節錄可以顯示。
    if (!AUTHOR_WRITTEN_EXCERPT_ORIGINS.has(question.origin)) {
      return { visible: false, reason: "unverified-source" };
    }
    return { visible: true, reason: null };
  }

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
