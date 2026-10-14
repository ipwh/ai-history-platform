/**
 * 由教材段落建立傳給 LLM 的最小單位。
 * 只會抽取與選定分節相關的段落，清單項目及表格列會逐項拆開，
 * 令模型引用教材時可以精確指出來源。
 *
 * 圖片段落若有 OCR 辨識文字，也會納入生成素材（並標示來源為 OCR）。
 */
import type { MaterialBlock, TableCell } from "../../lib/types";
import { listGroundingBlocksForSections, listGroundingBlocksByTopic } from "../repositories/materials";
import { stripPageReferences, truncate, joinTableRow } from "../materials/text-utils";
import { stripOcrAnnotation } from "./ocr-text";
import type { MaterialUnit } from "../llm/provider";

const MAX_UNITS = 120;
const MAX_UNIT_LENGTH = 400;

function pushUnit(units: MaterialUnit[], block: MaterialBlock, text: string, note?: string) {
  const trimmed = text.trim();
  if (trimmed.length < 8) return;
  // 圖片的 OCR 文字已在來源位置標示，避免重複加上「OCR 擷取」
  const alreadyLabelled = block.sourceLocation.includes("OCR");
  const ocrNote = block.extractionMethod === "ocr" && !alreadyLabelled ? "OCR 擷取" : null;
  const labels = [ocrNote, note].filter(
    (label): label is string => typeof label === "string" && label.length > 0,
  );
  units.push({
    blockId: block.id,
    sourceLocation:
      labels.length > 0 ? `${block.sourceLocation}（${labels.join("、")}）` : block.sourceLocation,
    text: truncate(trimmed, MAX_UNIT_LENGTH),
    ...(block.extractionMethod === "ocr" ? { fromOcr: true } : {}),
  });
}

export function buildMaterialUnits(topicId: string, sectionIds: string[]): MaterialUnit[] {
  let blocks = listGroundingBlocksForSections(topicId, sectionIds);

  // 分節沒有直接對應的段落時（例如新增分節或教材未細分），
  // 回退使用整個課題的教材，確保仍可生成有依據的題目。
  if (blocks.length === 0) {
    blocks = listGroundingBlocksByTopic(topicId);
  }

  const units: MaterialUnit[] = [];

  for (const block of blocks) {
    if (units.length >= MAX_UNITS) break;
    // 沒有 OCR 文字的圖片沒有任何可用內容，略過
    if (block.type === "image" && block.extractionMethod !== "ocr") continue;
    // 標題只是結構，本身沒有可作答的內容；若把標題交給模型，
    // 會得出「以下哪一項是教材中提及的主題？」這類學生無法作答的題目
    if (block.type === "heading") continue;

    if (block.type === "table" && block.table) {
      block.table.forEach((row: TableCell[], rowIndex) => {
        const text = joinTableRow(row.map((cell) => stripOcrAnnotation(cell.text.trim())));
        pushUnit(units, block, text, `表格第 ${rowIndex + 1} 列`);
      });
      continue;
    }

    if (block.type === "list") {
      const items = block.text
        .split("\n")
        .map((item) => stripOcrAnnotation(item))
        .filter((item) => item.trim().length > 0);
      items.forEach((item, itemIndex) => {
        pushUnit(units, block, item, `第 ${itemIndex + 1} 項`);
      });
      continue;
    }

    // 圖片的 OCR 文字：移除「以上文字由 OCR…」的說明行，只保留內容
    pushUnit(units, block, stripOcrAnnotation(stripPageReferences(block.text)));
  }

  return units;
}
