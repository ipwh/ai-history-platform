/**
 * 教材管理的服務層：上載匯入、預覽、編輯及課題指派。
 */
import fs from "node:fs/promises";
import path from "node:path";

import {
  DOCUMENT_KIND_LABELS,
  OCR_STATUS_LABELS,
  type DocumentKind,
  type MaterialBlock,
  type MaterialDocument,
} from "../../lib/types";
import { getServerConfig } from "../config";
import {
  deleteDocumentWithFile,
  getDocument,
  listBlocksByDocument,
  listDocuments,
  setDocumentTopic,
  updateBlock,
} from "../repositories/materials";
import { getTopic, listSections } from "../repositories/topics";
import { importMaterial, repairQuestionsWithMissingBlocks, UnsupportedMaterialError } from "../materials/import-service";
import { detectTopicId, resolveMaterialPath } from "../materials/material-files";
import { extractQuestionBankText, isQuestionBankFileName, isRetiredQuestionBankFileName } from "../materials/question-bank";
import { CURRICULUM_TOPICS } from "../seed/curriculum";
import { importQuestionBank, type QuestionBankImportResult } from "./question-bank-import-service";
import { startOcrJob } from "./ocr-service";

export interface UploadInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  buffer: Buffer;
  topicId?: string | null;
  /** 匯入後是否立即執行 OCR（背景執行） */
  runOcr?: boolean;
}

function assertSupportedFile(fileName: string, sizeBytes: number): void {
  const extension = path.extname(fileName).toLowerCase();
  if (![".docx", ".pdf"].includes(extension)) {
    throw new UnsupportedMaterialError(
      `不支援的檔案格式「${extension || "（沒有副檔名）"}」。目前只支援 .docx 及 .pdf（舊版 .doc 請先另存為 .docx）。`,
    );
  }
  const { maxUploadBytes } = getServerConfig();
  if (sizeBytes > maxUploadBytes) {
    throw new UnsupportedMaterialError(
      `檔案過大（${(sizeBytes / 1024 / 1024).toFixed(1)} MB），上限為 ${(
        maxUploadBytes /
        1024 /
        1024
      ).toFixed(0)} MB。請先壓縮或分割教材。`,
    );
  }
}

/** 依檔名找出課程課題（支援「課題N …」資料夾與 HNC1A2E_T1_… 檔名） */
export function detectTopicIdForFile(fileName: string): string | null {
  return detectTopicId(fileName);
}

export async function importUploadedMaterial(input: UploadInput) {
  assertSupportedFile(input.fileName, input.sizeBytes);
  const outcome = await importMaterial({
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    buffer: input.buffer,
    topicId: input.topicId ?? detectTopicIdForFile(input.fileName),
    kind: "uploaded",
  });

  if (input.runOcr && outcome.document.status === "ready") {
    // OCR 以背景方式執行，上載請求不會被長時間阻塞
    void startOcrJob(outcome.document.id);
  }

  return outcome;
}

/** 觸發某份教材的 OCR（背景執行） */
export function triggerDocumentOcr(documentId: string): MaterialDocument {
  const document = getDocument(documentId);
  if (!document) throw new UnsupportedMaterialError("找不到指定的教材文件");
  if (document.status !== "ready") {
    throw new UnsupportedMaterialError("這份教材尚未成功擷取內容，無法執行 OCR。");
  }
  void startOcrJob(documentId);
  const updated = getDocument(documentId);
  return updated ?? document;
}

/**
 * 匯入 materials 資料夾內的指定教材（供教師在管理介面快速建立示範內容）。
 * 會依檔名自動對應課程課題；找不到檔案時回傳 null。
 *
 * 注意：materials/ 是「隨專案提供的唯讀來源資料夾」（可打包進容器映像），
 * 與教師上載後需要保存的檔案（經 storage provider 存入 data/uploads）不同，
 * 因此這裡直接讀取來源資料夾而不經儲存層。
 */
export async function importMaterialFromDisk(
  fileName: string,
  options: { runOcr?: boolean } = {},
): Promise<
  | {
      outcome: Awaited<ReturnType<typeof importMaterial>>;
      fileName: string;
      topicId: string | null;
      /** 校內試題檔匯入題庫的統計（非試題檔時為 null） */
      questionImport: QuestionBankImportResult | null;
    }
  | null
> {
  const { materialsDir } = getServerConfig();
  const resolved = resolveMaterialPath(materialsDir, fileName);
  if (!resolved) return null;
  const safeName = path.basename(resolved);
  // 平台已移除資料題（DBQ）：不會匯入題庫，亦不可當作課文教材
  if (isRetiredQuestionBankFileName(safeName)) return null;

  let buffer: Buffer;
  let stats: { size: number };
  try {
    buffer = await fs.readFile(resolved);
    stats = await fs.stat(resolved);
  } catch {
    return null;
  }

  const extension = path.extname(safeName).toLowerCase();
  const topicId = detectTopicIdForFile(safeName);
  const isQuestionBank = isQuestionBankFileName(safeName);

  const outcome = await importMaterial({
    fileName: safeName,
    mimeType:
      extension === ".pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: stats.size,
    buffer,
    topicId,
    kind: isQuestionBank ? "question-bank" : "demo",
    sourceNote: isQuestionBank ? "校內試題（題庫來源）" : "專案內附的課程教材",
  });

  // 校內試題檔：同時把題目匯入題庫（草稿，待教師審核）。
  // 這類文件不會作為 AI 出題依據（見 repositories/materials 的 grounding 查詢）。
  let questionImport: QuestionBankImportResult | null = null;
  if (isQuestionBank && topicId && outcome.document.status === "ready") {
    const text = await extractQuestionBankText(buffer);
    questionImport = importQuestionBank({ topicId, fileName: safeName, text });
  }

  if (options.runOcr && outcome.document.status === "ready") {
    void startOcrJob(outcome.document.id);
  }

  return { outcome, fileName: safeName, topicId, questionImport };
}

/** 匯入專案內附的試點教材（課題5 溫習筆記） */
export async function importPilotMaterialFromDisk(options: { runOcr?: boolean } = {}) {
  // 試點教材＝課題5 的書本內容（路徑來自課程種子，保持單一來源）
  const pilot = CURRICULUM_TOPICS.find((topic) => topic.id === "topic-5");
  const result = await importMaterialFromDisk(
    pilot?.materialFile ?? "課題5 近代歐洲的興起/課題5 近代歐洲的興起.docx",
    options,
  );
  return result;
}

export interface MaterialOverview {
  documents: (MaterialDocument & {
    kindLabel: string;
    ocrStatusLabel: string;
    /** 已辨識 OCR 的段落數 */
    ocrBlockCount: number;
    sectionCoverage: { sectionId: string; sectionTitle: string; blockCount: number }[];
  })[];
  totals: { documents: number; uploaded: number; demo: number; blocks: number; ocrBlocks: number };
}

export function listMaterials(): MaterialOverview {
  const documents = listDocuments();
  const enriched = documents.map((document) => {
    const blocks = listBlocksByDocument(document.id);
    const counts = new Map<string, number>();
    let ocrBlockCount = 0;
    for (const block of blocks) {
      if (block.extractionMethod === "ocr") ocrBlockCount += 1;
      if (!block.sectionId) continue;
      counts.set(block.sectionId, (counts.get(block.sectionId) ?? 0) + 1);
    }
    const sectionTitles = document.topicId
      ? new Map(listSections(document.topicId).map((section) => [section.id, section.title]))
      : new Map<string, string>();

    return {
      ...document,
      storedPath: null, // 本機路徑不會傳到前端
      kindLabel: DOCUMENT_KIND_LABELS[document.kind as DocumentKind],
      ocrStatusLabel: OCR_STATUS_LABELS[document.ocrStatus],
      ocrBlockCount,
      sectionCoverage: [...counts.entries()].map(([sectionId, blockCount]) => ({
        sectionId,
        sectionTitle: sectionTitles.get(sectionId) ?? "未對應分節",
        blockCount,
      })),
    };
  });

  return {
    documents: enriched,
    totals: {
      documents: documents.length,
      uploaded: documents.filter((document) => document.kind === "uploaded").length,
      demo: documents.filter((document) => document.kind === "demo").length,
      blocks: documents.reduce((total, document) => total + document.blockCount, 0),
      ocrBlocks: enriched.reduce((total, document) => total + document.ocrBlockCount, 0),
    },
  };
}

export function getDocumentBlocks(documentId: string): {
  document: MaterialDocument;
  blocks: MaterialBlock[];
} {
  const document = getDocument(documentId);
  if (!document) {
    throw new UnsupportedMaterialError("找不到指定的教材文件");
  }
  return { document, blocks: listBlocksByDocument(documentId) };
}

export function editBlock(
  blockId: string,
  changes: { text?: string; sectionId?: string | null; topicId?: string | null },
): MaterialBlock {
  const updated = updateBlock(blockId, changes);
  if (!updated) throw new UnsupportedMaterialError("找不到指定的教材段落");
  return updated;
}

export function assignTopic(documentId: string, topicId: string | null): MaterialDocument {
  const document = getDocument(documentId);
  if (!document) throw new UnsupportedMaterialError("找不到指定的教材文件");
  if (topicId !== null && !getTopic(topicId)) {
    throw new UnsupportedMaterialError("找不到指定的課題");
  }
  setDocumentTopic(documentId, topicId);
  const updated = getDocument(documentId);
  if (!updated) throw new UnsupportedMaterialError("教材課題更新失敗");
  return updated;
}

export interface RemoveDocumentOutcome {
  /** 被刪除的原始檔案（沒有保存原始檔案時為 null） */
  removedFile: string | null;
  /** 刪除後修復引用該文件段落的題目所得結果 */
  repair: { repointed: number; pruned: number; withheld: number };
}

/**
 * 刪除教材文件，並修復引用該文件段落的題目。
 *
 * 回報修復結果（重新定位／剔除失效引用／標示未通過核對的數目），供命令列退掉
 * 被取代的舊教材時記錄，讓教師看得出刪除對題目做了甚麼。
 */
export function removeDocumentDetailed(documentId: string): RemoveDocumentOutcome {
  const document = getDocument(documentId);
  if (!document) throw new UnsupportedMaterialError("找不到指定的教材文件");
  const removedFile = deleteDocumentWithFile(documentId);
  // 引用該文件段落的題目不會再找到依據：先嘗試按原文節錄重新定位到其他段落，
  // 找不到者標示為「未通過教材依據核對」，避免教師端仍顯示「已核對」但其實沒有依據。
  const repair = document.topicId
    ? repairQuestionsWithMissingBlocks(document.topicId)
    : { repointed: 0, pruned: 0, withheld: 0 };
  return { removedFile, repair };
}

export function removeDocument(documentId: string): string | null {
  return removeDocumentDetailed(documentId).removedFile;
}

export interface RetireMaterialOutcome {
  fileName: string;
  documentId: string | null;
  topicId: string | null;
  action: "planned" | "retired" | "not-found";
  repair: { repointed: number; pruned: number; withheld: number } | null;
}

/**
 * 退掉被取代的教材文件（以**檔名逐個指定**，不做任何模式比對）。
 *
 * 用途：2026-10 版教材以新檔名取代舊教師版文件後，舊文件仍是獨立的文件（不會被同名
 * 取代機制處理），需要在離線快照上逐份退掉（見 materials/README.md）。
 * 刪除路徑與管理介面相同（`deleteDocumentWithFile` → `repairQuestionsWithMissingBlocks`），
 * 因此題目的教材依據、學生端 fail-closed 行為與管理介面完全一致。
 *
 * `dryRun` 只列出將會刪除的文件，不寫入。
 */
export function retireMaterialsByFileName(
  fileNames: string[],
  options: { dryRun?: boolean } = {},
): RetireMaterialOutcome[] {
  const dryRun = options.dryRun ?? false;
  const outcomes: RetireMaterialOutcome[] = [];
  for (const fileName of fileNames) {
    const matches = listDocuments().filter((document) => document.fileName === fileName);
    if (matches.length === 0) {
      outcomes.push({
        fileName,
        documentId: null,
        topicId: null,
        action: "not-found",
        repair: null,
      });
      continue;
    }
    for (const document of matches) {
      if (dryRun) {
        outcomes.push({
          fileName,
          documentId: document.id,
          topicId: document.topicId,
          action: "planned",
          repair: null,
        });
        continue;
      }
      const { repair } = removeDocumentDetailed(document.id);
      outcomes.push({
        fileName,
        documentId: document.id,
        topicId: document.topicId,
        action: "retired",
        repair,
      });
    }
  }
  return outcomes;
}
