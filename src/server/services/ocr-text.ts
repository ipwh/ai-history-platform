/**
 * OCR 文字的工具函式。
 * OCR 文字會附帶一行來源說明（方便教師辨識），但這行說明不應成為題目素材，
 * 因此建立教材單位前會先移除。
 *
 * 「無法辨識的雜訊」判斷（`isGarbledOcrText`）已移至
 * [materials/text-utils.ts](../materials/text-utils.ts)：閱讀模式、出題素材及資料層
 * 都需要同一個判斷，而它們不可依賴 services 層。
 */

const OCR_ANNOTATION_PATTERN = /\n?（以上文字由 OCR 從圖片擷取：[^）]*）\s*$/;

/** 移除 OCR 段落末尾的來源說明行 */
export function stripOcrAnnotation(text: string): string {
  return text.replace(OCR_ANNOTATION_PATTERN, "").trim();
}

/** 取出 OCR 段落中的來源說明（沒有時回傳 null） */
export function extractOcrAnnotation(text: string): string | null {
  const match = OCR_ANNOTATION_PATTERN.exec(text);
  if (!match) return null;
  return match[0].replace(/[\n（）]/g, "").replace("以上文字由 OCR 從圖片擷取：", "").trim();
}

/** 判斷段落文字是否來自 OCR（用於介面標示） */
export function looksLikeOcrText(text: string): boolean {
  return OCR_ANNOTATION_PATTERN.test(text);
}
