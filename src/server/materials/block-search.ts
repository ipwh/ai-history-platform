/**
 * 教材段落的「可搜尋文字」，以及「節錄可否作為教材依據」的共用規則。
 *
 * 題目的教材依據（`sourceExcerpt`）必須是段落文字或**表格整列**的逐字內容，
 * 因此核對依據時必須使用同一組文字：段落本文，加上以 `TABLE_CELL_SEPARATOR`
 * 重新接合後的每一列（與生成題目時相同，見 material-units.ts）。
 *
 * 這個規則同時用於：
 *   1. 匯入教材後重新定位題目依據（import-service.ts 的 `reverifyQuestionsForDocument`、
 *      `reverifyUnverifiedQuestions`）；
 *   2. 刪除教材文件後修復題目依據（import-service.ts 的 `repairQuestionsWithMissingBlocks`）；
 *   3. 版本控制的重新連結清單／題目修正清單套用前的前置驗證（reference-remapping.ts、
 *      question-queue-actions.ts）；
 *   4. 學生端「節錄可否顯示」的來源判定（services/source-visibility.ts 的
 *      「作者自行撰寫節錄」名單）。
 */
import type { QuestionOrigin } from "@/lib/types";
import { TABLE_CELL_SEPARATOR } from "./text-utils";

/**
 * 節錄可用作教材依據的最短長度。
 *
 * 太短的片段（例如「惡性循環」）會在無關段落中出現，以它連結等於給教師錯誤的
 * 「已核對」訊號；與 material-units.ts 的 `pushUnit` 最少 8 字規則、AI 生成題目的
 * 驗證規則（llm/validation.ts）一致。
 *
 * 適用範圍（2026-10-17 統一）：**任何由程式自動尋找段落的路徑**都必須遵守此下限
 * （重新匯入定位、刪除文件後修復、清單套用、AI 生成及驗證）。唯一例外是
 * 「作者自行撰寫節錄」的來源（見 `hasAuthorWrittenExcerpt`）——示範題庫的 `sourceAnchor`
 * 與教師手動建立的題目，其節錄本身就是作者提供的來源標註（例如「天賦權利」），
 * 程式只是把該標註定位到教材段落，並非從短片段推論依據。
 */
export const MIN_EXCERPT_LENGTH = 8;

/**
 * 節錄是否由**作者撰寫**（而非由教材或試題檔擷取）。
 *
 *   - `demo`：內建示範題庫，節錄取自作者撰寫的 `sourceAnchor`（見 seed/index.ts）；
 *   - `manual`：教師在平台手動建立／編輯，節錄與段落由教師親自指定。
 *
 * 這兩種來源的節錄是**作者提供的來源標註**，因此不受 `MIN_EXCERPT_LENGTH` 限制；
 * 其餘來源（`material-ai`／`material-mock`／`school-paper`）的節錄一律由教材或試題檔
 * 擷取，短片段不足以辨識依據。學生端「沒有引用段落時仍可顯示節錄」的判定
 * （services/source-visibility.ts）使用同一份名單，避免兩處的來源政策不一致。
 *
 * **任何未知來源都不在名單內**，令日後新增來源時預設為嚴格（fail-closed）。
 */
export const AUTHOR_WRITTEN_EXCERPT_ORIGINS: ReadonlySet<QuestionOrigin> =
  new Set<QuestionOrigin>(["demo", "manual"]);

export function hasAuthorWrittenExcerpt(origin: QuestionOrigin): boolean {
  return AUTHOR_WRITTEN_EXCERPT_ORIGINS.has(origin);
}

/**
 * 節錄是否**不該**用來自動連結段落。
 *
 * 作者撰寫的節錄不受最短長度限制（見上）；其餘來源短於 `MIN_EXCERPT_LENGTH` 時，
 * 一律不可由程式自動認定為教材依據。
 */
export function excerptTooShortToLink(excerpt: string, origin: QuestionOrigin): boolean {
  if (hasAuthorWrittenExcerpt(origin)) return false;
  return excerpt.trim().length < MIN_EXCERPT_LENGTH;
}

/** 只能描述形狀的最小介面（避免模組互相依賴整個段落型別） */
export interface BlockLike {
  text: string;
  type: string;
  table?: { text: string }[][] | null;
}

/** 段落可用來比對原文的文字（表格列會重組成與生成題目時相同的文字） */
export function blockSearchTexts(block: BlockLike): string[] {
  const texts = [block.text];
  if (block.type === "table" && block.table) {
    for (const row of block.table) {
      texts.push(
        row
          .map((cell) => cell.text.trim())
          .filter((cell) => cell.length > 0)
          .join(TABLE_CELL_SEPARATOR),
      );
    }
  }
  return texts.map((text) => text.trim()).filter((text) => text.length > 0);
}

/**
 * 節錄是否**逐字**出現在該段落之中（表格以整列為單位）。
 *
 * 這是「已核對」的唯一定義；不採用相似度或關鍵詞判斷，避免把無關段落當成依據。
 */
export function excerptAppearsInBlock(block: BlockLike, excerpt: string): boolean {
  const needle = excerpt.trim();
  if (needle.length === 0) return false;
  return blockSearchTexts(block).some((text) => text.includes(needle));
}
