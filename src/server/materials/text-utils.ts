/**
 * 文字處理工具：正規化、比對用字串、標題判斷、相鄰重複去除。
 */

/** 移除 HTML 標籤並還原常見實體 */
export function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u3000]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** 比對用的正規化：移除空白、標點及頁碼標示，方便比對教材原文 */
export function normalizeForMatch(value: string): string {
  return value
    .replace(/\((?:p|P)\.?\s*\d+(?:\s*[-–~]\s*\d+)?\)/g, "")
    .replace(/[\s\u00a0\u3000]/g, "")
    .replace(
      /[，。、；：？！「」『』（）()《》〈〉〔〕［］\[\]【】"'’‘“”,.;:!?—－・·\-–~～…⋯＊*＊｜|]/g,
      "",
    )
    .toLowerCase();
}

/** 移除頁碼標示，保留可讀文字 */
export function stripPageReferences(value: string): string {
  return value
    .replace(/\((?:p|P)\.?\s*\d+(?:\s*[-–~]\s*\d+)?\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 判斷段落是否像標題：
 * - 文字較短
 * - 不以句號完結
 * - 沒有長句結構
 * 教材沒有使用 Word 標題樣式，因此需要內容判斷。
 */
export function isLikelyHeading(text: string): boolean {
  const cleaned = stripPageReferences(text).trim();
  if (cleaned.length === 0 || cleaned.length > 24) return false;
  if (/[。！？；]$/.test(cleaned)) return false;
  if (/^\d+[.、]/.test(cleaned)) return false;
  return true;
}

/** 判斷一行是否為清單項目符號開頭 */
export function looksLikeBullet(text: string): boolean {
  return /^\s*(?:[•·▪◦※\-\*\u2022\u25cf]|\(\d+\)|（\d+）|\d+[.)、])\s*/.test(text);
}

export function stripBulletPrefix(text: string): string {
  return text.replace(/^\s*(?:[•·▪◦※\-\*\u2022\u25cf]|\(\d+\)|（\d+）|\d+[.)、])\s*/, "").trim();
}

/** 移除相鄰重複的項目（DOCX 文字方塊會令同一段出現兩次） */
export function dedupeAdjacent<T>(items: T[], keyFn: (item: T) => string): T[] {
  const result: T[] = [];
  let lastKey: string | null = null;
  for (const item of items) {
    const key = keyFn(item);
    if (key.length === 0) continue;
    if (key === lastKey) continue;
    result.push(item);
    lastKey = key;
  }
  return result;
}

export function truncate(value: string, maxLength: number): string {
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength)}…`;
}

/**
 * 移除模型輸出中夾雜的 Markdown／標題符號。
 *
 * 模型有時會在句中或行首加入「##」、「**」、「- 」等記號，中文歷史題目並不需要，
 * 而且會破壞閱讀（例如「文藝復興##主要特點」）。這裡只移除格式記號，不改動文字內容。
 * 注意：教材原文節錄（sourceExcerpt）必須逐字對應教材，不可套用此清理。
 */
export function stripMarkdownArtifacts(value: string): string {
  return value
    // 行首標題記號（#、## 等）
    .replace(/^[ \t]*#{1,6}[ \t]*/gm, "")
    // 行首引號及清單符號
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .replace(/^[ \t]*[-*+•·][ \t]+/gm, "")
    // 粗體／斜體／刪除線／行內程式碼記號（只處理同一行內的成對記號，避免誤刪內容）
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    // 句中殘留的標題記號（例如「文藝復興##主要特點」）
    .replace(/#{1,6}/g, "")
    .replace(/\*+/g, "")
    // 清理後可能出現多餘空白
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

/**
 * 表格列轉成教材單位文字時的欄位分隔符。
 * 生成題目及核對題目教材依據時必須使用同一個分隔符，才可正確比對原文。
 */
export const TABLE_CELL_SEPARATOR = " ｜ ";

/** 把表格的一列接成一段文字（空欄位會被略過） */
export function joinTableRow(cells: string[]): string {
  return cells
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0)
    .join(TABLE_CELL_SEPARATOR);
}

/** 句子切分（用於從段落建立填充題） */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？；])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/** 常見雜訊詞，避免成為填充題答案 */
const STOP_WORDS = new Set([
  "歐洲",
  "世紀",
  "發展",
  "影響",
  "原因",
  "背景",
  "特點",
  "革命",
  "教會",
  "國家",
  "政府",
  "人民",
  "重要",
  "出現",
]);

/** 從文字中抽出候選關鍵詞（用於本地示範生成） */
export function extractKeyTerms(text: string, limit = 8): string[] {
  const cleaned = stripPageReferences(text);
  const candidates = cleaned.match(/[\u4e00-\u9fff]{2,8}/g) ?? [];
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    if (STOP_WORDS.has(candidate)) continue;
    counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit)
    .map(([term]) => term);
}

/**
 * 抽出一段文字中的年份，例如 1517年、3,500年。
 *
 * 只接受 3 至 4 位數字的年份，並要求數字完整：教材寫成「約公元前3,500年」時，
 * 不可只抽出被千位分隔符切斷的「500年」（否則填充題會挖出「約公元前3,＿＿＿」這種題目）。
 */
export function extractYears(text: string): string[] {
  const years = new Set<string>();
  for (const match of text.matchAll(/\d[\d,，]*\s*年/g)) {
    const digits = match[0].replace(/[^\d]/g, "");
    if (digits.length < 3 || digits.length > 4) continue;
    years.add(match[0].replace(/\s+/g, ""));
  }
  return [...years];
}

/**
 * 判斷 OCR 文字是否屬於「無法辨識的雜訊」。
 *
 * OCR 對圖表、地圖等圖片的辨識結果可能只是零散的單字（例如「俄國／德國／況／奧匈」），
 * 這些文字既不是完整句子，也不足以支持有依據的題目。
 * 規則式（本地示範）生成會略過這類文字；學生閱讀頁亦不顯示（沒有閱讀價值）。
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
