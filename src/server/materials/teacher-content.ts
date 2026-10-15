/**
 * 教師專用內容（答案、評分參考、教師版材料）的識別。
 *
 * ── 為甚麼需要這個模組 ────────────────────────────────────────────────
 * 學生閱讀頁（`/learn/[topicId]`）原本只以**文件層級**的 `kind <> 'question-bank'`
 * 判斷內容是否適合學生閱讀。但匯入的課本檔案是**教師版**（檔名帶 `_TE`，即
 * Teacher's Edition），教師版除了學生用內容外，亦可能夾附答案、評分參考及教師
 * 註記。因此「不是校內試題檔」並不足以證明整份文件都適合學生閱讀。
 *
 * 這裡提供兩層控制：
 *   1. **檔名判斷**（決定性）：檔名標示為教師版／答案的文件，管理員必須額外明確
 *      確認才可開放給學生（見 `PATCH /api/admin/materials/[documentId]`）。
 *   2. **段落內容過濾**（啟發式，偏向不顯示）：無法確定為學生內容的段落一律不顯示，
 *      並回報被略過的段落數，讓管理員核對。
 *
 * ── 限制（必須如實說明）────────────────────────────────────────────────
 * 第 2 層是**模式比對，不是內容理解**：它可能漏掉以其他方式書寫的答案（例如直接
 * 寫出答案而不加標示），因此**不能**當作「已確認內容適合學生」的證明。真正的把關
 * 仍然是管理員在開放發行權前的確認；本模組只負責把明顯的教師專用內容擋住。
 */

/** 檔名標示為教師版／答案／評分材料的樣式（決定性判斷，不用於內容推斷） */
const TEACHER_EDITION_FILE_PATTERNS: RegExp[] = [
  /_TE(?![A-Za-z])/i,
  /teacher/i,
  /教師版|教師用|教師本|老師版/,
  /答案|評分參考|評分標準|題解|解析/,
  /marking|answer[_\s-]?key/i,
];

/**
 * 檔名是否標示為教師版或含答案的材料。
 *
 * 這是**決定性的字串判斷**（只看檔名標記），用於要求管理員額外確認；
 * 與下方的內容模式比對不同，不會因內容書寫方式而改變。
 */
export function looksLikeTeacherEdition(fileName: string): boolean {
  const name = fileName.trim();
  if (name.length === 0) return false;
  return TEACHER_EDITION_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * 教師專用內容的段落標記（偏向不顯示：false negative 會令答案外洩，
 * false positive 只會少顯示一段，因此寧可嚴格）。
 *
 * 刻意**不**包含單獨的「答案」二字：學生練習題亦會出現「把答案填在方格內」，
 * 過度比對會令正常內容消失並使教師失去信心。
 */
const TEACHER_ONLY_BLOCK_PATTERNS: RegExp[] = [
  /參考答案|建議答案|標準答案|答案分析|答案見|答案：|答案:/,
  /評分參考|評分標準|評分要點|得分要點|答題指引|試題分析|教師專用|教師版|教師指引/,
  /每個答案各佔|各佔\s*\d+\s*分|每題\s*\d+\s*分|全卷\s*\d+\s*分/,
  /accept\s+(?:any|other)\s+reasonable|marking\s+scheme/i,
];

/** 這段文字是否明顯屬教師專用內容（答案、評分參考） */
export function isTeacherOnlyBlockText(text: string): boolean {
  const value = text.trim();
  if (value.length === 0) return false;
  return TEACHER_ONLY_BLOCK_PATTERNS.some((pattern) => pattern.test(value));
}
