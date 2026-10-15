/**
 * 將教材段落對應到課題分節。
 *
 * 教材（例如溫習筆記）沒有使用 Word 標題樣式，分節標題往往只是短段落或清單項目，
 * 因此以「標題／關鍵詞比對 + 文件次序」推斷每個段落屬於哪個分節：
 *   1. 先用頂層分節的關鍵詞把文件切成幾個大區段。
 *   2. 再在每個大區段內比對該區段的子分節標題（避免「影響」等相同標題互相干擾）。
 * 教師可在管理介面手動修正結果。
 */
import type { Section } from "../../lib/types";
import { normalizeForMatch, stripPageReferences } from "./text-utils";
import type { ParsedBlock } from "./types";

export interface SectionAssignment {
  /** 每個段落對應的分節 ID；未對應者為 null */
  sectionIds: (string | null)[];
  /** 被判定為分節標題的段落索引 */
  headingIndexes: number[];
  /** 有對應到內容的分節 ID */
  matchedSectionIds: string[];
}

interface Matcher {
  section: Section;
  keys: { key: string; length: number }[];
}

function buildMatchers(sections: Section[]): Matcher[] {
  return sections
    .map((section) => {
      const keys = [section.title, ...section.matchKeywords]
        .map((value) => normalizeForMatch(stripPageReferences(value)))
        .filter((key) => key.length >= 2)
        .map((key) => ({ key, length: key.length }));
      return { section, keys };
    })
    .filter((matcher) => matcher.keys.length > 0);
}

/** 找出段落中最長命中的分節：標題需出現在段落開頭，或段落本身很短 */
function matchSection(blockText: string, matchers: Matcher[]): Section | null {
  const hit = matchSectionWithLength(blockText, matchers);
  return hit?.section ?? null;
}

/** 與 matchSection 相同，但同時回傳命中鍵的長度（用於比較哪個分節更貼切） */
function matchSectionWithLength(
  blockText: string,
  matchers: Matcher[],
): { section: Section; length: number } | null {
  const normalized = normalizeForMatch(blockText);
  if (normalized.length === 0) return null;

  let best: { section: Section; length: number } | null = null;
  for (const matcher of matchers) {
    for (const { key, length } of matcher.keys) {
      const isPrefix = normalized.startsWith(key);
      const isShortContaining = normalized.length <= length + 8 && normalized.includes(key);
      if (!isPrefix && !isShortContaining) continue;
      if (!best || length > best.length) best = { section: matcher.section, length };
    }
  }
  return best;
}

/** 課題大標題（例如「課題5　近代歐洲的興起」）不應歸入任何分節 */
function isChapterHeading(block: ParsedBlock): boolean {
  return /^課題\s*\d/.test(stripPageReferences(block.text));
}

export function mapBlocksToSections(blocks: ParsedBlock[], sections: Section[]): SectionAssignment {
  const sectionIds: (string | null)[] = new Array(blocks.length).fill(null);
  const headingIndexes: number[] = [];
  const matchedSectionIds: string[] = [];
  const markMatched = (sectionId: string) => {
    if (!matchedSectionIds.includes(sectionId)) matchedSectionIds.push(sectionId);
  };

  if (sections.length === 0) return { sectionIds, headingIndexes, matchedSectionIds };

  const parents = sections.filter((section) => section.parentId === null);
  const childrenByParent = new Map<string, Section[]>();
  for (const section of sections) {
    if (section.parentId === null) continue;
    const list = childrenByParent.get(section.parentId) ?? [];
    list.push(section);
    childrenByParent.set(section.parentId, list);
  }

  const childMatchers = new Map<string, Matcher[]>();
  for (const [parentId, list] of childrenByParent) {
    childMatchers.set(parentId, buildMatchers(list));
  }

  // 第一階段：以頂層分節關鍵詞切出大區段
  const parentMatchers = buildMatchers(parents);
  const parentOfBlock: (Section | null)[] = new Array(blocks.length).fill(null);
  let currentParent: Section | null = null;

  if (parentMatchers.length > 0) {
    blocks.forEach((block, index) => {
      if (isChapterHeading(block)) {
        currentParent = null;
        parentOfBlock[index] = null;
        return;
      }
      const matched = block.type === "image" ? null : matchSection(block.text, parentMatchers);
      if (matched) {
        currentParent = matched;
        headingIndexes.push(index);
        markMatched(matched.id);
      }
      parentOfBlock[index] = currentParent;
    });
  }

  // 第二階段：在每個大區段內比對子分節
  // 教材（例如溫習筆記）常在開頭有一個總結／目錄式的區段，
  // 之後才是各分節的詳細內容；因此當目前大區段內找不到對應子分節時，
  // 會回退到整份教材的所有子分節再比對一次，避免內容全部歸入總結分節。
  const allChildMatchers = buildMatchers([...childrenByParent.values()].flat());
  let currentSection: Section | null = null;
  let currentParentId: string | null = null;

  blocks.forEach((block, index) => {
    const parent = parentOfBlock[index];
    const parentId = parent?.id ?? null;

    if (parentId !== currentParentId) {
      currentSection = parent;
      currentParentId = parentId;
    }

    if (parent === null) {
      sectionIds[index] = null;
      return;
    }

    const localMatchers = childMatchers.get(parent.id) ?? [];
    const localMatch =
      block.type === "image" ? null : matchSectionWithLength(block.text, localMatchers);
    // 全部子分節的比對結果若更貼切（命中關鍵詞更長），優先採用，
    // 例如「新石器時代的農業」應歸入「新石器時代」而不是較短的「石器時代」。
    const globalMatch =
      block.type === "image" ? null : matchSectionWithLength(block.text, allChildMatchers);
    const matchedChild =
      globalMatch && (!localMatch || globalMatch.length > localMatch.length)
        ? globalMatch.section
        : (localMatch?.section ?? globalMatch?.section ?? null);

    if (matchedChild) {
      currentSection = matchedChild;
      headingIndexes.push(index);
      markMatched(matchedChild.id);
      sectionIds[index] = matchedChild.id;
      return;
    }

    sectionIds[index] = currentSection?.id ?? parent.id;
  });

  return {
    sectionIds,
    headingIndexes: [...new Set(headingIndexes)].sort((a, b) => a - b),
    matchedSectionIds,
  };
}
