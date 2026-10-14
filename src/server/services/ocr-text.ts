/**
 * OCR 文字的工具函式。
 * OCR 文字會附帶一行來源說明（方便教師辨識），但這行說明不應成為題目素材，
 * 因此建立教材單位前會先移除。
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

/**
 * 判斷 OCR 文字是否屬於「無法辨識的雜訊」。
 *
 * OCR 對圖表、地圖等圖片的辨識結果可能只是零散的單字（例如「俄國／德國／況／奧匈」），
 * 這些文字既不是完整句子，也不足以支持有依據的題目。
 * 規則式（本地示範）生成會略過這類文字，避免產生無意義的題目；
 * 使用真正 LLM 時仍會把原文交給模型判斷。
 *
 * 判斷方式：最長的連續中文字串少於 4 個字，且至少有 3 段中文字詞，
 * 代表整段文字都是短詞拼湊而非句子。
 */
export function isGarbledOcrText(text: string): boolean {
  const segments = text
    .split(/[\s，。、；：！？（）〈〉《》「」『』0-9A-Za-z.,;:!?()[\]{}"'\-—/\\|+]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length < 3) return false;
  const longestCjkRun = segments.reduce(
    (longest, segment) => Math.max(longest, segment.length),
    0,
  );
  return longestCjkRun < 4;
}
