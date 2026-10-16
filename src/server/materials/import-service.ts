/**
 * 教材匯入流程：解析檔案 → 對應分節 → 寫入資料庫。
 * 上載（kind = uploaded）與內建示範教材（kind = demo）會清楚區分。
 *
 * 原始檔案會經儲存層另存（本機為 data/uploads），供日後執行 OCR 時重新讀取內嵌圖片。
 */
import path from "node:path";

import {
  MATERIAL_BLOCK_TYPE_LABELS,
  type DocumentKind,
  type MaterialBlock,
  type MaterialDocument,
  type Topic,
} from "../../lib/types";
import { getServerConfig } from "../config";
import {
  insertBlocks,
  createDocument,
  deleteDocumentWithFile,
  listDocuments,
  setDocumentStatus,
  setDocumentStoredPath,
  listBlocksByDocument,
  listBlocksByTopic,
} from "../repositories/materials";
import { listQuestions, updateQuestion } from "../repositories/questions";
import { listSections, listTopics } from "../repositories/topics";
import { listDocxImagesInDocumentOrder } from "./docx-images";
import { filterExcludedBlocks } from "./exclusions";
import { parseDocx } from "./docx";
import { parsePdf } from "./pdf";
import { mapBlocksToSections } from "./section-mapper";
import { truncate, joinTableRow, normalizeForMatch } from "./text-utils";
import { resolveStorageProvider, removeStoredFile } from "../storage";
import { MaterialParseError, type ParsedBlock, type ParseResult } from "./types";

export interface ImportOptions {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  buffer: Buffer;
  /** 指定課題；未指定時會嘗試由檔名自動判斷 */
  topicId?: string | null;
  kind: DocumentKind;
  sourceNote?: string | null;
}

export interface ImportOutcome {
  document: MaterialDocument;
  blocks: MaterialBlock[];
  /** 是否有任何警告（例如圖片未能擷取） */
  warnings: string[];
  /** 自動判斷出的課題（若有） */
  detectedTopic: Topic | null;
}

export class UnsupportedMaterialError extends Error {
  /** 令 API 層可以回傳 400 而不是 500 */
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "UnsupportedMaterialError";
  }
}

function extensionOf(fileName: string): string {
  return path.extname(fileName).toLowerCase();
}

/** 由檔名或內容推測課題，例如 HNC2A2E_T5_SN_TE.docx → 課題 5 */
export function detectTopicForFile(fileName: string, topics: Topic[]): Topic | null {
  const match = /[_-]T(\d+)[_-]/i.exec(fileName) ?? /課題\s*(\d+)/.exec(fileName);
  if (match) {
    const topicNumber = match[1];
    const byNumber = topics.find(
      (topic) => topic.id === `topic-${topicNumber}` || topic.title.includes(`課題${topicNumber}`),
    );
    if (byNumber) return byNumber;
  }
  for (const topic of topics) {
    const shortTitle = topic.title.replace(/^課題\s*\d+[：:\s]*/, "");
    if (shortTitle.length >= 2 && fileName.includes(shortTitle)) return topic;
  }
  return null;
}

async function parseByExtension(fileName: string, buffer: Buffer): Promise<ParseResult> {
  const extension = extensionOf(fileName);
  if (extension === ".docx") return parseDocx(buffer, fileName);
  if (extension === ".pdf") return parsePdf(buffer, fileName);
  if (extension === ".doc") {
    throw new UnsupportedMaterialError(
      "不支援舊版 .doc 格式。請在 Word 中另存為 .docx 後再上載。",
    );
  }
  throw new UnsupportedMaterialError(
    `不支援的檔案格式「${extension || "（沒有副檔名）"}」。目前只支援 .docx 及 .pdf。`,
  );
}

function buildSourceLocation(fileName: string, block: ParsedBlock, ordinal: number): string {
  const parts = [fileName];
  if (block.page !== null) parts.push(`第 ${block.page} 頁`);
  parts.push(`第 ${ordinal} 段（${MATERIAL_BLOCK_TYPE_LABELS[block.type]}）`);
  return parts.join(" · ");
}

/**
 * 把原始檔案另存到儲存層（本機為 data/uploads），
 * 方便日後執行 OCR 時重新讀取內嵌圖片。
 * 存檔失敗不會令匯入失敗，只會令 OCR 功能不可用。
 */
async function storeOriginalFile(
  documentId: string,
  fileName: string,
  buffer: Buffer,
): Promise<string | null> {
  const extension = path.extname(fileName).toLowerCase() || ".bin";
  try {
    return await resolveStorageProvider().save(`${documentId}${extension}`, buffer);
  } catch {
    return null;
  }
}

/**
 * 匯入教材內容。回傳的 document.status 會是 ready 或 failed；
 * 失敗時 errorMessage 會包含可理解的錯誤說明。
 */
export async function importMaterial(options: ImportOptions): Promise<ImportOutcome> {
  const config = getServerConfig();
  const topics = listTopics();

  // 同名教材視為重新匯入：先移除舊版本（連同段落及已儲存的原檔），
  // 避免教師重複匯入時產生重複教材。
  let replacedExisting = false;
  for (const existing of listDocuments()) {
    if (existing.fileName === options.fileName) {
      await removeStoredFile(deleteDocumentWithFile(existing.id));
      replacedExisting = true;
    }
  }

  const detectedTopic =
    (options.topicId ? topics.find((topic) => topic.id === options.topicId) ?? null : null) ??
    detectTopicForFile(options.fileName, topics);

  const document = createDocument({
    fileName: options.fileName,
    kind: options.kind,
    mimeType: options.mimeType,
    sizeBytes: options.sizeBytes,
    status: "ready",
    topicId: detectedTopic?.id ?? null,
    sourceNote: options.sourceNote ?? null,
  });

  const storedPath = await storeOriginalFile(document.id, options.fileName, options.buffer);
  if (storedPath) setDocumentStoredPath(document.id, storedPath);

  let parsed: ParseResult;
  try {
    parsed = await parseByExtension(options.fileName, options.buffer);
  } catch (error) {
    const message =
      error instanceof MaterialParseError || error instanceof UnsupportedMaterialError
        ? error.message
        : `解析教材時發生未預期的錯誤：${error instanceof Error ? error.message : String(error)}`;
    setDocumentStatus(document.id, "failed", { errorMessage: message });
    const failed = { ...document, status: "failed" as const, errorMessage: message };
    return { document: failed, blocks: [], warnings: [message], detectedTopic };
  }

  const warnings = [...parsed.warnings];
  const limited = parsed.blocks.slice(0, config.maxBlocksPerDocument);
  if (parsed.blocks.length > config.maxBlocksPerDocument) {
    warnings.push(
      `教材內容過長，只保留前 ${config.maxBlocksPerDocument} 段（原有 ${parsed.blocks.length} 段）。`,
    );
  }

  // 不考核的內容（例如課題1 的新月沃土／尼羅河／印度河流域文明）不會寫入資料庫
  const filtered = filterExcludedBlocks(limited, detectedTopic?.id ?? null);
  const blocks = filtered.kept;
  if (filtered.skipped > 0) {
    warnings.push(`已略過 ${filtered.skipped} 段不考核的內容（不寫入資料庫）。`);
  }

  const sections = detectedTopic ? listSections(detectedTopic.id) : [];
  const assignment = mapBlocksToSections(blocks, sections);

  // 圖片段落的 ocr_source 需與 OCR 服務抽出的媒體路徑一致（word/media/imageN.ext），
  // 這裡依 DOCX 內媒體檔名的排序對應，方便 OCR 完成後寫回正確段落。
  const imageSourceKeys =
    path.extname(options.fileName).toLowerCase() === ".docx"
      ? await listDocxMediaPaths(options.buffer)
      : [];
  let imageCursor = 0;

  insertBlocks(
    blocks.map((block, index) => {
      const isHeading = assignment.headingIndexes.includes(index) && block.type === "paragraph";
      let ocrSource: string | null = null;
      if (block.type === "image" && imageSourceKeys.length > 0) {
        ocrSource = imageSourceKeys[imageCursor] ?? null;
        imageCursor += 1;
      }
      return {
        documentId: document.id,
        topicId: detectedTopic?.id ?? null,
        sectionId: assignment.sectionIds[index] ?? null,
        order: block.order,
        // 被判定為分節標題的段落，統一標示為標題方便教師預覽
        type: isHeading ? "heading" : block.type,
        level: isHeading ? 2 : block.level,
        text: block.text,
        table: block.table,
        sourceLocation: buildSourceLocation(options.fileName, block, index + 1),
        extractionMethod: "native" as const,
        ocrSource,
      };
    }),
  );

  setDocumentStatus(document.id, "ready", {
    limitationNote: parsed.limitationNote,
    imageCount: parsed.imageCount,
  });

  if (parsed.limitationNote) warnings.push(parsed.limitationNote);
  if (detectedTopic === null) {
    warnings.push("未能自動判斷這份教材屬於哪個課題，請在管理介面指定課題。");
  } else if (assignment.matchedSectionIds.length === 0 && sections.length > 0) {
    warnings.push(
      `未能自動對應分節，教材內容已存入「${detectedTopic.title}」之下，請在管理介面手動指定分節。`,
    );
  }

  const savedDocument = { ...document, status: "ready" as const };
  const savedBlocks = listBlocksByDocument(document.id);

  if (replacedExisting) {
    reverifyQuestionsForDocument(options.fileName, savedBlocks);
  }
  // 即使不是重新匯入，也可能有「先前尚無教材依據」的題目（例如示範題庫在教材匯入前
  // 已建立，或題目的 sourceLocation 沒有記錄檔名），一併重新定位。
  if (savedDocument.topicId) {
    reverifyUnverifiedQuestions(savedDocument.topicId, listBlocksByTopic(savedDocument.topicId));
  }

  return {
    document: savedDocument,
    blocks: savedBlocks,
    warnings,
    detectedTopic,
  };
}

/**
 * 重新匯入同名教材後，題目的教材依據段落 ID 已經失效。
 * 這裡用題目的原文節錄在新段落中重新定位（表格列會以同一分隔符重組後比對）：
 *   找到 → 更新 sourceBlockIds 並保持「已核對」；
 *   找不到 → 標示為「未通過教材依據核對」，提醒教師重新檢查。
 */
function reverifyQuestionsForDocument(fileName: string, blocks: MaterialBlock[]): void {
  const affected = listQuestions().filter((question) =>
    question.sourceLocation.includes(fileName),
  );
  if (affected.length === 0) return;

  const searchable = blocks.map((block) => ({
    block,
    texts: blockSearchTexts(block).map((text) => normalizeForMatch(text)),
  }));

  for (const question of affected) {
    const alreadyValid =
      question.sourceBlockIds.length > 0 &&
      question.sourceBlockIds.every((blockId) => blocks.some((block) => block.id === blockId));
    if (alreadyValid) continue;

    const needle = normalizeForMatch(question.sourceExcerpt);
    const match =
      needle.length > 0
        ? searchable.find((entry) => entry.texts.some((text) => text.includes(needle)))
        : undefined;

    updateQuestion(question.id, {
      ...question,
      sourceBlockIds: match ? [match.block.id] : question.sourceBlockIds,
      sourceVerified: match !== undefined,
    });
  }
}

/**
 * 為課題內「尚未核對教材依據」的題目重新定位依據。
 *
 * 用於兩種情況：
 *   1. 示範題庫在教材尚未匯入時建立（`sourceExcerpt` 已保存原文，但當時找不到段落）。
 *   2. 題目的 `sourceLocation` 沒有記錄檔名，令 `reverifyQuestionsForDocument` 無法涵蓋。
 *
 * 比對方式與示範題庫一致：取「最短的相符段落」，避免一次抓到整段長文。
 *
 * **沒有來源位置的段落不可用作依據**（Sprint 7.7）：連結後學生端的「教材來源」會顯示
 * 題目的 `sourceLocation`，而匯入試題的來源位置正是**試題檔的檔名及題號**。若以
 * `best.sourceLocation || question.sourceLocation` 回退，等於把試題檔名保留下來當作
 * 學生可見的來源標註。因此：沒有可用來源位置的段落一律略過（不連結），題目維持
 * 「未通過教材依據核對」，學生端依 fail-closed 政策不顯示節錄及來源位置。
 */
function reverifyUnverifiedQuestions(topicId: string, blocks: MaterialBlock[]): void {
  const pending = listQuestions({ topicId }).filter((question) => !question.sourceVerified);
  if (pending.length === 0) return;

  const candidates: { blockId: string; sourceLocation: string; length: number; normalized: string }[] =
    [];
  for (const block of blocks) {
    if (block.type === "image") continue;
    const sourceLocation = block.sourceLocation.trim();
    if (sourceLocation.length === 0) continue;
    for (const text of blockSearchTexts(block)) {
      candidates.push({
        blockId: block.id,
        sourceLocation,
        length: text.length,
        normalized: normalizeForMatch(text),
      });
    }
  }
  if (candidates.length === 0) return;

  for (const question of pending) {
    const needle = normalizeForMatch(question.sourceExcerpt);
    if (needle.length === 0) continue;

    let best: (typeof candidates)[number] | null = null;
    for (const candidate of candidates) {
      if (!candidate.normalized.includes(needle)) continue;
      if (!best || candidate.length < best.length) best = candidate;
    }
    if (!best) continue;

    updateQuestion(question.id, {
      ...question,
      sourceBlockIds: [best.blockId],
      // 候選段落一律有非空白的來源位置，因此不需（也不可）回退到題目原有的來源標註
      sourceLocation: best.sourceLocation,
      sourceVerified: true,
    });
  }
}

/** 段落可用來比對原文的文字（表格列會重組成與生成題目時相同的文字） */
function blockSearchTexts(block: MaterialBlock): string[] {
  const texts = [block.text];
  if (block.type === "table" && block.table) {
    for (const row of block.table) {
      texts.push(joinTableRow(row.map((cell) => cell.text)));
    }
  }
  return texts.map((text) => text.trim()).filter((text) => text.length > 0);
}

/** 產生給教師快速預覽的文字摘要 */
export function summarizeBlock(block: MaterialBlock, maxLength = 160): string {
  if (block.type === "table" && block.table) {
    return truncate(
      block.table.map((row) => row.map((cell) => cell.text).join(" | ")).join(" ⏎ "),
      maxLength,
    );
  }
  return truncate(block.text.replace(/\n/g, " / "), maxLength);
}

/** 列出 DOCX 內圖片的文件出現次序（與 OCR 服務使用的識別碼一致） */
async function listDocxMediaPaths(buffer: Buffer): Promise<string[]> {
  try {
    return await listDocxImagesInDocumentOrder(buffer);
  } catch {
    return [];
  }
}
