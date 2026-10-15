/**
 * 不考核內容的排除規則。
 *
 * 教育局課程涵蓋課題1「人類的需要：古與今」中的四大古代文明，但本校本課程
 * 只考核「古埃及文明（尼羅河流域）」，因此新月沃土、（黃河、長江流域）中華及
 * 印度河流域文明**不會**寫入資料庫、不會出現在學生端，亦不可成為題目內容。
 *
 * 用途：
 *   1. 匯入教材時略過相關段落（含其標題以下的整個子樹）。
 *   2. 匯入校內試題時略過相關題目（避免學生被考核範圍外的內容）。
 */
export interface ExcludedContent {
  /** 不寫入資料庫的分節 ID（由課程種子移除後仍可能存在於舊資料庫） */
  sectionIds: string[];
  /** 只要段落文字包含這些詞語就會被略過 */
  keywords: string[];
}

/** 各課題的排除規則（目前只有課題1） */
const EXCLUSIONS: Record<string, ExcludedContent> = {
  "topic-1": {
    sectionIds: [
      "topic-1-four-civilisations-mesopotamia",
      "topic-1-four-civilisations-indus",
      "topic-1-four-civilisations-yellow",
      // 教材只有標題、沒有任何內容的「不同地區的舊石器時代人類」已由課程種子移除
      // （見 migration 0018）；舊資料庫及舊教材匯入可能仍帶有此分節，因此一併排除。
      "topic-1-origins-regions",
    ],
    keywords: [
      // 已由課程種子移除的分節標題（教材只有標題、沒有任何內容，見 migration 0018）；
      // 匯入時略過該標題及其子樹，避免教材的標題段落被歸入其他分節。
      "不同地區的舊石器時代人類",
      // 三個不考核文明的通用名稱（含河流名稱，因為教材會以河名指稱該文明）
      "新月沃土",
      "黃河",
      "長江",
      "中華文明",
      "印度河",
      // 屬該三個文明的專有名詞（兩河流域／中華／印度河流域）
      "幼發拉底",
      "底格里斯",
      "蘇美爾",
      "巴比倫",
      "哈拉巴",
      "摩亨佐",
      "吾珥",
      "塔廟",
      "甲骨文",
    ],
  },
};

export function exclusionsForTopic(topicId: string | null | undefined): ExcludedContent | null {
  if (!topicId) return null;
  return EXCLUSIONS[topicId] ?? null;
}

/** 文字是否屬不考核內容（用於過濾教材段落及試題） */
export function isExcludedText(topicId: string | null | undefined, text: string): boolean {
  const exclusions = exclusionsForTopic(topicId);
  if (!exclusions) return false;
  return exclusions.keywords.some((keyword) => text.includes(keyword));
}

/**
 * 段落是否屬不考核內容。
 * 表格內容放在 `table` 而不是 `text`，因此必須一併檢查表格儲存格，
 * 否則配對題及資料題表格內的不考核內容會漏進資料庫。
 */
export function isExcludedBlock(
  topicId: string | null | undefined,
  block: { text: string; table?: unknown },
): boolean {
  if (isExcludedText(topicId, block.text)) return true;
  const table = block.table;
  if (!Array.isArray(table)) return false;
  for (const row of table) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      const value = (cell as { text?: unknown })?.text;
      if (typeof value === "string" && isExcludedText(topicId, value)) return true;
    }
  }
  return false;
}

export interface ExclusionFilterInput {
  topicId?: string | null;
  type: string;
  level: number | null;
  text: string;
  table?: unknown;
}

export interface ExclusionFilterResult<T extends ExclusionFilterInput> {
  kept: T[];
  /** 被略過的段落數（用於匯入報告） */
  skipped: number;
}

/**
 * 依序過濾段落：遇到屬排除範圍的標題時，會略過該標題及其後**層級較低**的內容，
 * 直到下一個層級更高的標題為止（即整個小節）。同時略過任何提及排除詞語的段落
 * （包括表格儲存格內容）。
 */
export function filterExcludedBlocks<T extends ExclusionFilterInput>(
  blocks: T[],
  topicId: string | null | undefined,
): ExclusionFilterResult<T> {
  const exclusions = exclusionsForTopic(topicId);
  if (!exclusions) return { kept: blocks, skipped: 0 };

  const kept: T[] = [];
  let skipped = 0;
  // 被略過的小節標題層級；null 表示不在被略過的小節內
  let excludedHeadingLevel: number | null = null;

  for (const block of blocks) {
    const isHeading = block.type === "heading";
    const headingLevel = block.level ?? 2;

    if (isHeading) {
      if (isExcludedText(topicId, block.text)) {
        excludedHeadingLevel = headingLevel;
        skipped += 1;
        continue;
      }
      // 只有層級更高的標題（例如由「黃河、長江流域文明」回到「四大古代文明的簡介」）
      // 才會結束略過範圍；同層或更低層的標題仍屬同一科不考核內容
      if (excludedHeadingLevel !== null && headingLevel < excludedHeadingLevel) {
        excludedHeadingLevel = null;
      }
    }

    if (excludedHeadingLevel !== null) {
      skipped += 1;
      continue;
    }
    if (isExcludedBlock(topicId, block)) {
      skipped += 1;
      continue;
    }
    kept.push(block);
  }

  return { kept, skipped };
}
