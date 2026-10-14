/**
 * 將 mammoth 產生的 HTML 轉成有結構的教材段落。
 * 保留標題（h1-h6）、段落、清單（含巢狀）及表格（含 colspan）。
 */
import { HTMLElement, parse } from "node-html-parser";

import { IMAGE_PLACEHOLDER_MESSAGE, type TableCell } from "../../lib/types";
import {
  dedupeAdjacent,
  isLikelyHeading,
  stripHtml,
  stripPageReferences,
} from "./text-utils";
import type { ParsedBlock } from "./types";

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const LIST_TAGS = new Set(["ul", "ol"]);

/** HTML 中的圖片會在轉換階段替換成此標記 */
export const IMAGE_MARKER = "[[IMAGE_UNEXTRACTED]]";

/** 圖片段落在介面上顯示的文字（不會推測圖片內容） */
export const IMAGE_BLOCK_TEXT = IMAGE_PLACEHOLDER_MESSAGE;

function collectListItems(element: HTMLElement, depth = 0): string[] {
  const items: string[] = [];
  for (const child of element.childNodes) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.rawTagName === "li") {
      // 巢狀清單的文字會併入同一項目，避免遺失內容
      const nestedLists = child.childNodes.filter(
        (node): node is HTMLElement => node instanceof HTMLElement && LIST_TAGS.has(node.rawTagName),
      );
      const ownText = child.childNodes
        .filter((node) => !(node instanceof HTMLElement && LIST_TAGS.has(node.rawTagName)))
        .map((node) => node.text)
        .join(" ");
      const text = stripHtml(ownText);
      if (text.length > 0) items.push(depth > 0 ? `　${text}` : text);
      for (const nested of nestedLists) {
        items.push(...collectListItems(nested, depth + 1));
      }
    }
  }
  return items;
}

function collectTable(element: HTMLElement): TableCell[][] {
  const rows: TableCell[][] = [];
  const rowElements = element.querySelectorAll("tr");
  for (const row of rowElements) {
    const cells: TableCell[] = [];
    for (const cell of row.querySelectorAll("td, th")) {
      const rawColSpan = cell.getAttribute("colspan");
      const colSpan = rawColSpan ? Number.parseInt(rawColSpan, 10) : 1;
      cells.push({
        colSpan: Number.isFinite(colSpan) && colSpan > 0 ? colSpan : 1,
        text: stripHtml(cell.innerHTML.replace(/<br\s*\/?>/gi, " / ")),
      });
    }
    if (cells.some((cell) => cell.text.length > 0)) rows.push(cells);
  }
  return rows;
}

export function htmlToBlocks(html: string): { blocks: ParsedBlock[]; imageCount: number } {
  const imageMatches = html.match(/<img\b/g) ?? [];
  const withoutImages = html.replace(/<img\b[^>]*>/g, `<p>${IMAGE_MARKER}</p>`);
  const root = parse(withoutImages, { blockTextElements: { p: true, li: true, td: true, th: true } });

  const raw: Omit<ParsedBlock, "order">[] = [];

  for (const node of root.childNodes) {
    if (!(node instanceof HTMLElement)) continue;
    const tag = node.rawTagName;

    if (HEADING_TAGS.has(tag)) {
      const text = stripPageReferences(stripHtml(node.text));
      if (text.length > 0) {
        raw.push({
          type: "heading",
          level: Number(tag.slice(1)),
          text,
          items: [],
          table: null,
          page: null,
        });
      }
      continue;
    }

    if (tag === "p") {
      const text = stripPageReferences(stripHtml(node.text));
      if (text.length === 0) continue;
      if (text === IMAGE_MARKER) {
        raw.push({
          type: "image",
          level: null,
          text: IMAGE_PLACEHOLDER_MESSAGE,
          items: [],
          table: null,
          page: null,
        });
        continue;
      }
      // 此教材沒有使用 Word 標題樣式，稍後用「下一段是否為清單／表格」判斷小標題
      raw.push({ type: "paragraph", level: null, text, items: [], table: null, page: null });
      continue;
    }

    if (LIST_TAGS.has(tag)) {
      const items = collectListItems(node);
      if (items.length > 0) {
        raw.push({ type: "list", level: null, text: items.join("\n"), items, table: null, page: null });
      }
      continue;
    }

    if (tag === "table") {
      const table = collectTable(node);
      if (table.length > 0) {
        raw.push({
          type: "table",
          level: null,
          text: table.flat().map((cell) => cell.text).join(" | "),
          items: [],
          table,
          page: null,
        });
      }
      continue;
    }

    // 其他容器（例如 div）逐個子元素處理，避免遺漏內容
    for (const child of node.childNodes) {
      if (!(child instanceof HTMLElement)) continue;
      const text = stripHtml(child.text);
      if (text.length === 0) continue;
      raw.push({ type: "paragraph", level: null, text, items: [], table: null, page: null });
    }
  }

  const deduped = dedupeAdjacent(
    raw,
    (block) => `${block.type}|${block.level ?? ""}|${block.text}`,
  );

  return {
    blocks: promoteLikelyHeadings(deduped).map((block, index) => ({ ...block, order: index })),
    imageCount: imageMatches.length,
  };
}
/**
 * 短段落若緊接清單或表格（中間可能隔著圖片），
 * 通常代表它是該部分的小標題。
 */
function promoteLikelyHeadings(blocks: Omit<ParsedBlock, "order">[]): Omit<ParsedBlock, "order">[] {
  return blocks.map((block, index) => {
    if (block.type !== "paragraph" || !isLikelyHeading(block.text)) return block;
    for (let cursor = index + 1; cursor < blocks.length; cursor += 1) {
      const next = blocks[cursor];
      if (next.type === "image") continue;
      if (next.type === "list" || next.type === "table") {
        return { ...block, type: "heading" as const, level: 3 };
      }
      break;
    }
    return block;
  });
}


