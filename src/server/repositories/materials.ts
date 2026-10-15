/**
 * 教材文件及教材段落的資料存取。
 */
import { getDb, nowIso, newId } from "../db/connection";
import {
  materialBlockSchema,
  type ExtractionMethod,
  type MaterialBlock,
  type MaterialBlockType,
  type MaterialDocument,
  type DocumentKind,
  type DocumentStatus,
  type OcrStatus,
  type TableCell,
} from "../../lib/types";

interface DocumentRow {
  id: string;
  file_name: string;
  kind: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  error_message: string | null;
  limitation_note: string | null;
  block_count: number;
  image_count: number;
  topic_id: string | null;
  source_note: string | null;
  created_at: string;
  ocr_status: string | null;
  ocr_provider: string | null;
  ocr_message: string | null;
  ocr_recognized_count: number | null;
  ocr_skipped_count: number | null;
  ocr_updated_at: string | null;
  stored_path: string | null;
  student_distribution: number | null;
}

interface BlockRow {
  id: string;
  document_id: string;
  topic_id: string | null;
  section_id: string | null;
  sort_order: number;
  type: string;
  level: number | null;
  text: string;
  table_json: string | null;
  source_location: string;
  created_at: string;
  extraction_method: string | null;
  ocr_source: string | null;
}

function mapDocument(row: DocumentRow): MaterialDocument {
  return {
    id: row.id,
    fileName: row.file_name,
    kind: row.kind as DocumentKind,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    status: row.status as DocumentStatus,
    errorMessage: row.error_message,
    limitationNote: row.limitation_note,
    blockCount: row.block_count,
    imageCount: row.image_count,
    topicId: row.topic_id,
    ocrStatus: (row.ocr_status as OcrStatus) ?? "not-run",
    ocrProvider: row.ocr_provider,
    ocrMessage: row.ocr_message,
    ocrRecognizedCount: row.ocr_recognized_count ?? 0,
    ocrSkippedCount: row.ocr_skipped_count ?? 0,
    ocrUpdatedAt: row.ocr_updated_at,
    storedPath: row.stored_path,
    studentDistribution: row.student_distribution === 1,
    createdAt: row.created_at,
  };
}

function mapBlock(row: BlockRow): MaterialBlock {
  let table: TableCell[][] | null = null;
  if (row.table_json) {
    try {
      table = JSON.parse(row.table_json) as TableCell[][];
    } catch {
      table = null;
    }
  }
  return materialBlockSchema.parse({
    id: row.id,
    documentId: row.document_id,
    topicId: row.topic_id,
    sectionId: row.section_id,
    order: row.sort_order,
    type: row.type as MaterialBlockType,
    level: row.level,
    text: row.text,
    table,
    sourceLocation: row.source_location,
    extractionMethod: (row.extraction_method as ExtractionMethod) ?? "native",
    ocrSource: row.ocr_source,
    createdAt: row.created_at,
  });
}

export interface NewDocumentInput {
  fileName: string;
  kind: DocumentKind;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  errorMessage?: string | null;
  limitationNote?: string | null;
  imageCount?: number;
  topicId?: string | null;
  sourceNote?: string | null;
}

export function createDocument(input: NewDocumentInput): MaterialDocument {
  const id = newId("doc");
  getDb()
    .prepare(
      `INSERT INTO material_documents
       (id, file_name, kind, mime_type, size_bytes, status, error_message, limitation_note,
        block_count, image_count, topic_id, source_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.fileName,
      input.kind,
      input.mimeType,
      input.sizeBytes,
      input.status,
      input.errorMessage ?? null,
      input.limitationNote ?? null,
      0,
      input.imageCount ?? 0,
      input.topicId ?? null,
      input.sourceNote ?? null,
      nowIso(),
    );
  const created = getDocument(id);
  if (!created) throw new Error("教材文件建立失敗");
  return created;
}

export function getDocument(documentId: string): MaterialDocument | null {
  const row = getDb().prepare("SELECT * FROM material_documents WHERE id = ?").get(documentId) as
    | unknown as DocumentRow
    | undefined;
  return row ? mapDocument(row) : null;
}

export function listDocuments(): MaterialDocument[] {
  const rows = getDb()
    .prepare("SELECT * FROM material_documents ORDER BY created_at DESC")
    .all() as unknown as DocumentRow[];
  return rows.map(mapDocument);
}

export function deleteDocument(documentId: string): void {
  getDb().prepare("DELETE FROM material_documents WHERE id = ?").run(documentId);
}

/**
 * 刪除文件，並回傳原本儲存的檔案位置。
 * 資料庫層不直接存取檔案系統：呼叫者會把 locator 交給儲存層刪除，
 * 未來改用 Cloud Storage 時毋須改動此處。
 */
export function deleteDocumentWithFile(documentId: string): string | null {
  const document = getDocument(documentId);
  deleteDocument(documentId);
  return document?.storedPath ?? null;
}

/** 設定原始檔案位置（供 OCR 重新讀取；本機為絕對路徑，Cloud Storage 為 gs:// 位置） */
export function setDocumentStoredPath(documentId: string, storedPath: string | null): void {
  getDb()
    .prepare("UPDATE material_documents SET stored_path = ? WHERE id = ?")
    .run(storedPath, documentId);
}

export function deleteDocumentsByKind(kind: DocumentKind): void {
  getDb().prepare("DELETE FROM material_documents WHERE kind = ?").run(kind);
}

export interface NewBlockInput {
  documentId: string;
  topicId: string | null;
  sectionId: string | null;
  order: number;
  type: MaterialBlockType;
  level?: number | null;
  text: string;
  table?: TableCell[][] | null;
  sourceLocation: string;
  extractionMethod?: ExtractionMethod;
  ocrSource?: string | null;
}

export function insertBlocks(blocks: NewBlockInput[]): MaterialBlock[] {
  const db = getDb();
  const statement = db.prepare(
    `INSERT INTO material_blocks
     (id, document_id, topic_id, section_id, sort_order, type, level, text, table_json, source_location, created_at, extraction_method, ocr_source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const timestamp = nowIso();
  const createdIds: string[] = [];

  db.exec("BEGIN");
  try {
    for (const block of blocks) {
      const id = newId("blk");
      createdIds.push(id);
      statement.run(
        id,
        block.documentId,
        block.topicId,
        block.sectionId,
        block.order,
        block.type,
        block.level ?? null,
        block.text,
        block.table ? JSON.stringify(block.table) : null,
        block.sourceLocation,
        timestamp,
        block.extractionMethod ?? "native",
        block.ocrSource ?? null,
      );
    }
    db.prepare(
      "UPDATE material_documents SET block_count = (SELECT COUNT(*) FROM material_blocks WHERE document_id = ?) WHERE id = ?",
    ).run(blocks[0]?.documentId ?? "", blocks[0]?.documentId ?? "");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return listBlocksByDocument(blocks[0]?.documentId ?? "");
}

export function listBlocksByDocument(documentId: string): MaterialBlock[] {
  const rows = getDb()
    .prepare("SELECT * FROM material_blocks WHERE document_id = ? ORDER BY sort_order ASC")
    .all(documentId) as unknown as BlockRow[];
  return rows.map(mapBlock);
}

/** 取得某課題的所有教材段落（用於題目生成及教師預覽） */
export function listBlocksByTopic(topicId: string): MaterialBlock[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM material_blocks WHERE topic_id = ? ORDER BY document_id ASC, sort_order ASC`,
    )
    .all(topicId) as unknown as BlockRow[];
  return rows.map(mapBlock);
}

/**
 * 取得可用於 AI 出題的段落（不含校內試題檔）。
 *
 * 校內試題檔的內容是題目與答案，不適合作為出題依據（否則模型會以答案文字作來源），
 * 因此題目生成一律使用這兩個函式，教師端預覽則仍可看到全部段落。
 */
export function listGroundingBlocksByTopic(topicId: string): MaterialBlock[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM material_blocks
        WHERE topic_id = ?
          AND document_id IN (SELECT id FROM material_documents WHERE kind <> 'question-bank')
        ORDER BY document_id ASC, sort_order ASC`,
    )
    .all(topicId) as unknown as BlockRow[];
  return rows.map(mapBlock);
}

/** 取得指定分節可用於 AI 出題的段落（不含校內試題檔） */
export function listGroundingBlocksForSections(
  topicId: string,
  sectionIds: string[],
): MaterialBlock[] {
  if (sectionIds.length === 0) return listGroundingBlocksByTopic(topicId);
  const placeholders = sectionIds.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(
      `SELECT * FROM material_blocks
        WHERE topic_id = ? AND section_id IN (${placeholders})
          AND document_id IN (SELECT id FROM material_documents WHERE kind <> 'question-bank')
        ORDER BY document_id ASC, sort_order ASC`,
    )
    .all(topicId, ...sectionIds) as unknown as BlockRow[];
  return rows.map(mapBlock);
}

/** 取得指定分節的教材段落；若分節沒有直接對應段落，回退到整個課題 */
export function listBlocksForSections(topicId: string, sectionIds: string[]): MaterialBlock[] {
  if (sectionIds.length === 0) return listBlocksByTopic(topicId);
  const placeholders = sectionIds.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(
      `SELECT * FROM material_blocks WHERE topic_id = ? AND section_id IN (${placeholders})
       ORDER BY document_id ASC, sort_order ASC`,
    )
    .all(topicId, ...sectionIds) as unknown as BlockRow[];
  return rows.map(mapBlock);
}

export function getBlocksByIds(blockIds: string[]): MaterialBlock[] {
  if (blockIds.length === 0) return [];
  const placeholders = blockIds.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(`SELECT * FROM material_blocks WHERE id IN (${placeholders}) ORDER BY sort_order ASC`)
    .all(...blockIds) as unknown as BlockRow[];
  return rows.map(mapBlock);
}

export function updateBlock(
  blockId: string,
  changes: { text?: string; sectionId?: string | null; topicId?: string | null },
): MaterialBlock | null {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM material_blocks WHERE id = ?").get(blockId) as
    | unknown as BlockRow
    | undefined;
  if (!existing) return null;

  db.prepare(
    "UPDATE material_blocks SET text = ?, section_id = ?, topic_id = ? WHERE id = ?",
  ).run(
    changes.text ?? existing.text,
    changes.sectionId === undefined ? existing.section_id : changes.sectionId,
    changes.topicId === undefined ? existing.topic_id : changes.topicId,
    blockId,
  );
  const updated = db.prepare("SELECT * FROM material_blocks WHERE id = ?").get(blockId) as unknown as
    | BlockRow
    | undefined;
  return updated ? mapBlock(updated) : null;
}

export function countImages(documentId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS total FROM material_blocks WHERE document_id = ? AND type = 'image'")
    .get(documentId) as unknown as { total: number } | undefined;
  return row?.total ?? 0;
}

export function setDocumentStatus(
  documentId: string,
  status: DocumentStatus,
  options: { errorMessage?: string | null; limitationNote?: string | null; imageCount?: number } = {},
): void {
  const db = getDb();
  const existing = getDocument(documentId);
  if (!existing) return;
  db.prepare(
    `UPDATE material_documents SET status = ?, error_message = ?, limitation_note = ?,
     image_count = COALESCE(?, image_count),
     block_count = (SELECT COUNT(*) FROM material_blocks WHERE document_id = ?)
     WHERE id = ?`,
  ).run(
    status,
    options.errorMessage ?? null,
    options.limitationNote ?? existing.limitationNote,
    options.imageCount ?? null,
    documentId,
    documentId,
  );
}

export function documentHasBlocks(documentId: string): boolean {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS total FROM material_blocks WHERE document_id = ?")
    .get(documentId) as unknown as { total: number } | undefined;
  return (row?.total ?? 0) > 0;
}

/** 更新 OCR 狀態及統計 */
export function setDocumentOcr(
  documentId: string,
  update: {
    status: OcrStatus;
    provider?: string | null;
    message?: string | null;
    recognizedCount?: number;
    skippedCount?: number;
  },
): void {
  const db = getDb();
  const existing = getDocument(documentId);
  if (!existing) return;
  db.prepare(
    `UPDATE material_documents SET ocr_status = ?, ocr_provider = ?, ocr_message = ?,
     ocr_recognized_count = ?, ocr_skipped_count = ?, ocr_updated_at = ?,
     block_count = (SELECT COUNT(*) FROM material_blocks WHERE document_id = ?)
     WHERE id = ?`,
  ).run(
    update.status,
    update.provider === undefined ? existing.ocrProvider : update.provider,
    update.message ?? null,
    update.recognizedCount ?? existing.ocrRecognizedCount,
    update.skippedCount ?? existing.ocrSkippedCount,
    nowIso(),
    documentId,
    documentId,
  );
}

/** 把 OCR 文字寫回圖片段落（同時可更新分節指派），並在來源位置標示 OCR */
export function applyOcrText(
  blockId: string,
  text: string,
  ocrSource: string,
  sectionId?: string | null,
): MaterialBlock | null {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM material_blocks WHERE id = ?").get(blockId) as
    | unknown as BlockRow
    | undefined;
  if (!existing) return null;

  const sourceLocation = existing.source_location.includes("OCR")
    ? existing.source_location
    : `${existing.source_location} · OCR 擷取`;

  db.prepare(
    `UPDATE material_blocks SET text = ?, extraction_method = 'ocr', ocr_source = ?,
     section_id = ?, source_location = ? WHERE id = ?`,
  ).run(
    text,
    ocrSource,
    sectionId === undefined ? existing.section_id : sectionId,
    sourceLocation,
    blockId,
  );
  const updated = db.prepare("SELECT * FROM material_blocks WHERE id = ?").get(blockId) as unknown as
    | BlockRow
    | undefined;
  return updated ? mapBlock(updated) : null;
}

/** 取出某文件所有圖片段落（用於 OCR） */
export function listImageBlocks(documentId: string): MaterialBlock[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM material_blocks WHERE document_id = ? AND type = 'image' ORDER BY sort_order ASC",
    )
    .all(documentId) as unknown as BlockRow[];
  return rows.map(mapBlock);
}

/** 依 OCR 來源找出對應的圖片段落 */
export function findImageBlockByOcrSource(
  documentId: string,
  ocrSource: string,
): MaterialBlock | null {
  const row = getDb()
    .prepare("SELECT * FROM material_blocks WHERE document_id = ? AND ocr_source = ? LIMIT 1")
    .get(documentId, ocrSource) as unknown as BlockRow | undefined;
  return row ? mapBlock(row) : null;
}

export function countOcrBlocks(documentId: string): number {
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) AS total FROM material_blocks WHERE document_id = ? AND extraction_method = 'ocr'",
    )
    .get(documentId) as unknown as { total: number } | undefined;
  return row?.total ?? 0;
}

export function markDocumentKindUploaded(documentId: string): void {
  getDb().prepare("UPDATE material_documents SET kind = 'uploaded' WHERE id = ?").run(documentId);
}

export function setDocumentTopic(documentId: string, topicId: string | null): void {
  const db = getDb();
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE material_documents SET topic_id = ? WHERE id = ?").run(topicId, documentId);
    db.prepare("UPDATE material_blocks SET topic_id = ? WHERE document_id = ?").run(
      topicId,
      documentId,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * 設定學生可否在平台內閱讀這份教材的內容。
 *
 * 預設為不可（見 migration 0011）：教材可能受版權限制，而本專案沒有授權紀錄，
 * 因此必須由管理員明確確認後才開啟。關閉時立即生效（下次讀取即不再顯示）。
 */
export function setDocumentStudentDistribution(documentId: string, allowed: boolean): void {
  getDb()
    .prepare("UPDATE material_documents SET student_distribution = ? WHERE id = ?")
    .run(allowed ? 1 : 0, documentId);
}

/** 教材發行權的稽核記錄（誰在何時開啟或關閉向學生發布） */
export interface DistributionAuditEntry {
  id: string;
  documentId: string;
  allowed: boolean;
  actorEmail: string;
  actorRole: string;
  createdAt: string;
}

/**
 * 記錄一次「向學生發布」權限的變更。
 *
 * 由 API 層在**變更之後**呼叫，並帶入操作者的電郵及角色（來自已簽署的工作階段，
 * 不接受前端提供的值）；因此每筆記錄都可追溯到人，而不是只留下一個布林值。
 * 操作者為管理員權杖或示範模式時，`actorEmail` 會是相應代號（見 PATCH 路由）。
 */
export function recordDistributionChange(input: {
  documentId: string;
  allowed: boolean;
  actorEmail: string;
  actorRole: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO distribution_audit (id, document_id, allowed, actor_email, actor_role, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newId("dist"),
      input.documentId,
      input.allowed ? 1 : 0,
      input.actorEmail,
      input.actorRole,
      new Date().toISOString(),
    );
}

/** 某份教材（或全部教材）的發行權變更記錄，最新在前 */
export function listDistributionAudit(
  documentId?: string,
  limit = 50,
): DistributionAuditEntry[] {
  const rows = (
    documentId === undefined
      ? getDb()
          .prepare(
            `SELECT id, document_id, allowed, actor_email, actor_role, created_at
             FROM distribution_audit ORDER BY created_at DESC, rowid DESC LIMIT ?`,
          )
          .all(limit)
      : getDb()
          .prepare(
            `SELECT id, document_id, allowed, actor_email, actor_role, created_at
             FROM distribution_audit WHERE document_id = ?
             ORDER BY created_at DESC, rowid DESC LIMIT ?`,
          )
          .all(documentId, limit)
  ) as unknown as {
    id: string;
    document_id: string;
    allowed: number;
    actor_email: string;
    actor_role: string;
    created_at: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    allowed: row.allowed === 1,
    actorEmail: row.actor_email,
    actorRole: row.actor_role,
    createdAt: row.created_at,
  }));
}

/**
 * 可用於學生閱讀的教材文件 ID。
 *
 * 同時排除校內試題（`kind = 'question-bank'`）：那些文件是題目與答案，
 * 不適合同時作為出題依據及學生讀物。
 */
export function listStudentDistributableDocumentIds(): Set<string> {
  const rows = getDb()
    .prepare(
      "SELECT id FROM material_documents WHERE student_distribution = 1 AND kind <> 'question-bank'",
    )
    .all() as unknown as { id: string }[];
  return new Set(rows.map((row) => row.id));
}
