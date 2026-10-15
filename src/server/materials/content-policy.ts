/**
 * 教材內容政策：區分「課文」與「非課文內容」。
 *
 * ── 為甚麼需要這個模組 ────────────────────────────────────────────────
 * 課本檔案是**教師版**（`HNC*_TE.docx`），除課文外還夾附「資料題」練習**及其評分參考**
 * （例如「根據以下資料，回答相關問題。（12分）」、「資料線索：」、「個人所知：」），
 * 匯入時亦會在圖片位置插入佔位標記 `[[IMAGE_UNEXTRACTED]]`。
 *
 * 這些內容不屬課文，部分更是答案。實際觀察（2026-10-15，本機 12 個課題）：
 *   - 161 段含分數標記「（N分）」，其中包括評分參考的答案（例如「不能。（1分）」）；
 *   - 14 段含圖片佔位標記；45 段只有年份或數字（時間軸碎片，例如「約公元前3,500年」）。
 * 閱讀頁（學生端）原本會把它們當成課文顯示，學生會看到練習題目、答案及無意義文字。
 *
 * ── 使用方式 ─────────────────────────────────────────────────────────
 * 同一個判斷用於三處，避免「閱讀頁看不到、但 AI 仍會引用並顯示節錄」的不一致：
 *   1. **閱讀教材**（`services/lesson-service.ts`）：不顯示這些段落。
 *   2. **出題素材**（`services/material-units.ts`）：不會以這些段落出題。
 *   3. **題目來源節錄**（`services/source-visibility.ts`）：引用這些段落的節錄不顯示。
 *   4. **學生端可用性**（`repositories/materials.ts` 的 `studentMaterialBlockCounts`）：
 *      與出題素材使用同一套判斷，學生端才不會被承諾做不到的出題。
 *
 * ── 限制（必須如實說明）────────────────────────────────────────────────
 * 這是**模式比對，不是內容理解**：以其他方式書寫的練習題目或評分參考可能漏掉。
 * 它只會令顯示的內容及題目減少，不可當成「教材已完全去識別化」的證明；
 * 教師仍可在 `/admin/materials` 看到完整段落。
 */
import { IMAGE_MARKER } from "./html-to-blocks";
import { isGarbledOcrText } from "./text-utils";

/**
 * 練習題目及評分參考的辨識樣式。
 * 偏向精確，避免誤刪課文（只針對分數標記、評分參考的固定標籤及作答指令）。
 */
export const EXERCISE_TEXT_PATTERNS: RegExp[] = [
  // 分數標記：練習題目及評分參考都會寫「（3分）」、「(12分)」
  /[（(]\s*\d+\s*分\s*[）)]/,
  // 評分參考的來源標示：（資料A）、（資料A及個人所知）、（任選兩項，2分）
  /[（(]\s*資料\s*[A-Za-z一二三四五六\d]+[^）)]{0,12}[）)]/,
  // 評分參考的固定標籤：課文不會出現「個人所知：」「資料線索：」這種寫法
  /個人所知|資料線索/,
  // 填充練習的作答空位
  /＿{2,}|_{4,}/,
  // 作答指令（課文不會出現這些說法）
  /回答(?:以下|相關|下列|上述)?(?:各)?問題|試參考資料|試就你所知|並就你所知|援引[^。]{0,12}線索|加以解釋|把代表答案的[英中文字母]+填|下列方格|細閱[^。]{0,10}資料|閱讀[^。]{0,10}資料|試根據資料|根據資料\s*[A-Za-z一二三四五六]/,
];

/**
 * 只有年份或數字的段落：教材的時間軸及表格碎片（例如單獨一段「公元前3,500年」、「）」）。
 * 表格內的數字仍會隨表格保留（表格有欄位標題提供脈絡）。
 */
const STANDALONE_NUMBER_TEXT =
  /^[約（()）\s]*(?:公元前|公元)?[\d,，.萬千百年月日\s～~\-—～至及、（）()]+$/;

/** 段落是否屬練習題目或評分參考（含答案），不應顯示給學生或用作出題依據 */
export function isExerciseOrAnswerText(text: string): boolean {
  return EXERCISE_TEXT_PATTERNS.some((pattern) => pattern.test(text.trim()));
}

/** 移除匯入時插入的圖片佔位標記（學生不應看到這些標記文字） */
export function stripImageMarkers(text: string): string {
  return text.split(IMAGE_MARKER).join("").trim();
}

/** 移除圖片標記後，這段文字是否只剩年份或數字（沒有可讀內容） */
export function isStandaloneNumberText(text: string): boolean {
  const stripped = stripImageMarkers(text);
  return stripped.length > 0 && STANDALONE_NUMBER_TEXT.test(stripped);
}

/**
 * 段落是否屬「非課文內容」：練習題目／評分參考、無法辨識的 OCR 雜散文字，
 * 或移除圖片標記後只剩年份／數字。
 *
 * @param text 段落文字（表格請把儲存格文字一併傳入）
 * @param options.fromOcr 段落是否由 OCR 產生（只有 OCR 文字才需要判斷是否雜訊）
 */
export function isNonLessonContent(
  text: string,
  options: { fromOcr?: boolean } = {},
): boolean {
  if (isExerciseOrAnswerText(text)) return true;
  if (options.fromOcr === true && isGarbledOcrText(text)) return true;
  return isStandaloneNumberText(text);
}
