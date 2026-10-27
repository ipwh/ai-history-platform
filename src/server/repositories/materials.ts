/**
 * 教材文件及教材段落的資料存取。
 */
import { getDb, nowIso, newId } from "../db/connection";
import { isTeacherOnlyBlockText, looksLikeTeacherEdition } from "../materials/teacher-content";
import { isNonLessonContent } from "../materials/content-policy";
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
  rights_confirmed_at?: string | null;
  content_reviewed_at?: string | null;
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
    rightsConfirmedAt: row.rights_confirmed_at ?? null,
    contentReviewedAt: row.content_reviewed_at ?? null,
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

/**
 * 把多個教材段落改掛到另一個分節（主題）。
 *
 * 與題目一樣，只改分類、不改內容；用於把過粗的主題按時期拆分。
 */
export function moveBlocksToSection(blockIds: string[], sectionId: string): number {
  if (blockIds.length === 0) return 0;
  const placeholders = blockIds.map(() => "?").join(", ");
  const result = getDb()
    .prepare(`UPDATE material_blocks SET section_id = ? WHERE id IN (${placeholders})`)
    .run(sectionId, ...blockIds);
  return Number(result.changes);
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

/**
 * 學伴檢索用的教材段落（只取回答所需的欄位）。
 *
 * 與 `listGroundingBlocksByTopic` 的分別：
 *   - 以文件為單位篩走校內試題檔（`kind = 'question-bank'`），並只在
 *     `student_distribution = 1` 的文件中找——學伴引用的內容一律要經得起
 *     「學生真的看得到這份教材」的檢查；
 *   - **不**剖析整份 `MaterialBlock`（`table_json` 的 zod 驗證對上萬段教材而言是多餘開銷），
 *     只回傳比對及顯示所需的欄位。
 *
 * 版權確認、教師版內容覆核等其餘可見性規則由呼叫端以
 * `listStudentDistributableDocumentIds()` 再篩一次（見 services/tutor-grounding.ts）。
 */
export interface TutorCandidateBlock {
  id: string;
  documentId: string;
  documentFileName: string;
  topicId: string | null;
  sectionId: string | null;
  order: number;
  type: string;
  text: string;
  table: TableCell[][] | null;
  sourceLocation: string;
  extractionMethod: ExtractionMethod;
}

interface TutorCandidateRow {
  id: string;
  document_id: string;
  file_name: string;
  topic_id: string | null;
  section_id: string | null;
  sort_order: number;
  type: string;
  text: string;
  table_json: string | null;
  source_location: string;
  extraction_method: string | null;
}

export function listTutorCandidateBlocks(topicId: string): TutorCandidateBlock[] {
  const rows = getDb()
    .prepare(
      `SELECT blocks.id, blocks.document_id, documents.file_name, blocks.topic_id,
              blocks.section_id, blocks.sort_order, blocks.type, blocks.text,
              blocks.table_json, blocks.source_location, blocks.extraction_method
         FROM material_blocks AS blocks
         INNER JOIN material_documents AS documents ON documents.id = blocks.document_id
        WHERE blocks.topic_id = ?
          AND documents.kind <> 'question-bank'
          AND documents.student_distribution = 1
        ORDER BY blocks.document_id ASC, blocks.sort_order ASC`,
    )
    .all(topicId) as unknown as TutorCandidateRow[];
  return rows.map((row) => {
    let table: TableCell[][] | null = null;
    if (row.table_json) {
      try {
        table = JSON.parse(row.table_json) as TableCell[][];
      } catch {
        table = null;
      }
    }
    return {
      id: row.id,
      documentId: row.document_id,
      documentFileName: row.file_name,
      topicId: row.topic_id,
      sectionId: row.section_id,
      order: row.sort_order,
      type: row.type,
      text: row.text,
      table,
      sourceLocation: row.source_location,
      extractionMethod: (row.extraction_method as ExtractionMethod) ?? "native",
    };
  });
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

/**
 * 記錄教材發布所需的兩項確認（Sprint 5）。
 *
 * `rights`（版權／發行權）與 `contentSafety`（內容安全覆核）是**不同**的問題，
 * 必須分開記錄：有發行權不等於內容安全（教師版文件兩者兼有），內容安全亦不等於
 * 有發行權。兩者都保存「誰在何時確認」，令「這份文件為何可以給學生看」可以逐項
 * 回答，而不是只看一個布林值。
 *
 * 傳入 null 代表「不更新該項」（例如只作內容覆核）；傳入 undefined 則保留原值。
 */
export function recordDocumentGovernance(input: {
  documentId: string;
  rights?: { confirmedBy: string; at: string } | null;
  contentSafety?: { reviewedBy: string; at: string } | null;
}): void {
  const db = getDb();
  if (input.rights !== undefined) {
    db.prepare(
      "UPDATE material_documents SET rights_confirmed_at = ?, rights_confirmed_by = ? WHERE id = ?",
    ).run(input.rights?.at ?? null, input.rights?.confirmedBy ?? null, input.documentId);
  }
  if (input.contentSafety !== undefined) {
    db.prepare(
      "UPDATE material_documents SET content_reviewed_at = ?, content_reviewed_by = ? WHERE id = ?",
    ).run(
      input.contentSafety?.at ?? null,
      input.contentSafety?.reviewedBy ?? null,
      input.documentId,
    );
  }
}

/** 某份教材的發布治理狀態（兩項確認是否已完成、由誰及何時） */
export interface DocumentGovernance {
  rightsConfirmedAt: string | null;
  rightsConfirmedBy: string | null;
  contentReviewedAt: string | null;
  contentReviewedBy: string | null;
}

export function getDocumentGovernance(documentId: string): DocumentGovernance {
  const row = getDb()
    .prepare(
      `SELECT rights_confirmed_at, rights_confirmed_by, content_reviewed_at, content_reviewed_by
       FROM material_documents WHERE id = ?`,
    )
    .get(documentId) as unknown as
    | {
        rights_confirmed_at: string | null;
        rights_confirmed_by: string | null;
        content_reviewed_at: string | null;
        content_reviewed_by: string | null;
      }
    | undefined;

  return {
    rightsConfirmedAt: row?.rights_confirmed_at ?? null,
    rightsConfirmedBy: row?.rights_confirmed_by ?? null,
    contentReviewedAt: row?.content_reviewed_at ?? null,
    contentReviewedBy: row?.content_reviewed_by ?? null,
  };
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
/** 教材能否向學生顯示所需的欄位（學生端唯一的判定依據，見 documentIsStudentVisible） */
interface StudentVisibilityFields {
  kind: string;
  fileName: string;
  studentDistribution: boolean;
  rightsConfirmedAt: string | null;
  contentReviewedAt: string | null;
}

/**
 * 一份文件是否符合「可向學生顯示」的**全部**條件。
 *
 * 四個條件缺一不可：
 *   1. 不是校內試題文件（`kind = 'question-bank'`：題目與答案，永不列為學生讀物）；
 *   2. 管理員已把 `student_distribution` 設為 1（想開放）；
 *   3. 留有版權／發行權確認（`rights_confirmed_at`，遷移 0017）；
 *   4. 教師版文件（檔名標示）另需內容安全覆核（`content_reviewed_at`）。
 *
 * 第 3、4 項在**讀取時**同樣檢查，因此 0017 之前已開啟、或繞過 API 直接寫入、
 * 或由舊備份還原的文件不會因為一個布林值而對學生可見。
 */
function isStudentVisible(fields: StudentVisibilityFields): boolean {
  if (fields.kind === "question-bank") return false;
  if (!fields.studentDistribution) return false;
  if (fields.rightsConfirmedAt === null) return false;
  if (looksLikeTeacherEdition(fields.fileName) && fields.contentReviewedAt === null) return false;
  return true;
}

/** 這份文件現時是否真的會顯示給學生（供管理員介面說明「已標示開放但學生仍看不到」） */
export function documentIsStudentVisible(document: MaterialDocument): boolean {
  return isStudentVisible({
    kind: document.kind,
    fileName: document.fileName,
    studentDistribution: document.studentDistribution,
    rightsConfirmedAt: document.rightsConfirmedAt,
    contentReviewedAt: document.contentReviewedAt,
  });
}

/**
 * 教材庫概況（只有數量）。
 *
 * 用途是診斷「為甚麼學生端顯示沒有教材」：`documents`／`blocks` 為 0 即代表此資料庫
 * 從未匯入教材；`studentVisibleDocuments` 為 0 則代表已匯入但未開放給學生
 * （未確認版權，或教師版文件未完成內容覆核）。不含檔名、內容或任何使用者資料。
 */
export function materialLibrarySummary(): {
  documents: number;
  blocks: number;
  studentVisibleDocuments: number;
} {
  const db = getDb();
  const documents = db.prepare("SELECT COUNT(*) AS total FROM material_documents").get() as
    | { total: number }
    | undefined;
  const blocks = db.prepare("SELECT COUNT(*) AS total FROM material_blocks").get() as
    | { total: number }
    | undefined;
  return {
    documents: documents?.total ?? 0,
    blocks: blocks?.total ?? 0,
    studentVisibleDocuments: listStudentDistributableDocumentIds().size,
  };
}

/**
 * 可向學生顯示的文件 ID（學生端唯一的來源判斷）。
 *
 * 只設定 `student_distribution = 1` 而**沒有**留下版權確認（教師版文件另需內容覆核）
 * 的文件不會列入；見 documentIsStudentVisible 的說明。
 */
export function listStudentDistributableDocumentIds(): Set<string> {
  const rows = getDb()
    .prepare(
      `SELECT id, kind, file_name, student_distribution, rights_confirmed_at, content_reviewed_at
         FROM material_documents
        WHERE student_distribution = 1`,
    )
    .all() as unknown as {
    id: string;
    kind: string;
    file_name: string;
    student_distribution: number;
    rights_confirmed_at: string | null;
    content_reviewed_at: string | null;
  }[];

  return new Set(
    rows
      .filter((row) =>
        isStudentVisible({
          kind: row.kind,
          fileName: row.file_name,
          studentDistribution: row.student_distribution === 1,
          rightsConfirmedAt: row.rights_confirmed_at,
          contentReviewedAt: row.content_reviewed_at,
        }),
      )
      .map((row) => row.id),
  );
}

/** 判斷分節可用性時需要的段落欄位（連同所屬文件的發布治理狀態） */
interface StudentMaterialRow {
  section_id: string | null;
  type: string;
  text: string;
  table_json: string | null;
  extraction_method: string | null;
  kind: string;
  file_name: string;
  student_distribution: number | null;
  rights_confirmed_at: string | null;
  content_reviewed_at: string | null;
}

/** 表格段落的儲存格文字（與 buildMaterialUnits 讀取 table 的方式一致） */
function tableCellTexts(tableJson: string | null): string[] {
  if (!tableJson) return [];
  try {
    const table = JSON.parse(tableJson) as TableCell[][];
    return table.flat().map((cell) => cell.text ?? "");
  } catch {
    return [];
  }
}

/**
 * 每個分節「學生實際可用來出題」的教材段落數。
 *
 * 與 [buildMaterialUnits](../services/material-units.ts) 的 `audience: "student"` 使用同一套條件：
 * 文件須符合 `isStudentVisible`（已開放、已確認版權，教師版另需內容覆核）、非標題、
 * 圖片須有 OCR 文字、段落不含教師專用字樣，亦不可屬非課文內容（練習題目、評分參考、
 * 圖片佔位標記、零散數字，見 [content-policy](../materials/content-policy.ts)）。
 *
 * 學生選了沒有任何可用段落的主題時，即時出題**必定**被版權閘門擋下（409）。因此學生端
 * 介面必須用這個數字判斷「可不可以選」，而**不是** `materialBlockCount`——後者包含校內
 * 試題檔（`kind = 'question-bank'`，永不作為學生讀物或用作出題依據）及尚未開放的教材。
 */
export function studentMaterialBlockCounts(topicId: string): Map<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT b.section_id, b.type, b.text, b.table_json, b.extraction_method,
              d.kind, d.file_name, d.student_distribution, d.rights_confirmed_at, d.content_reviewed_at
         FROM material_blocks b
         JOIN material_documents d ON d.id = b.document_id
        WHERE b.topic_id = ? AND b.section_id IS NOT NULL AND b.type <> 'heading'`,
    )
    .all(topicId) as unknown as StudentMaterialRow[];

  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.section_id === null) continue;
    if (
      !isStudentVisible({
        kind: row.kind,
        fileName: row.file_name,
        studentDistribution: row.student_distribution === 1,
        rightsConfirmedAt: row.rights_confirmed_at,
        contentReviewedAt: row.content_reviewed_at,
      })
    ) {
      continue;
    }
    // 沒有 OCR 文字的圖片沒有任何可用內容
    if (row.type === "image" && row.extraction_method !== "ocr") continue;

    const cells = row.type === "table" ? tableCellTexts(row.table_json) : [];
    // 與 buildMaterialUnits 相同：整段（含表格）只要帶有教師專用字樣即整段略去
    const blockText = [row.text, ...cells].join("\n");
    if (isTeacherOnlyBlockText(blockText)) continue;
    // 非課文內容（練習題目、評分參考及答案、圖片佔位標記、零散數字）不會用作出題依據，
    // 因此亦不計入「學生可用教材」，否則介面會承諾做不到的出題（見 materials/content-policy.ts）
    if (isNonLessonContent(blockText, { fromOcr: row.extraction_method === "ocr" })) continue;

    const parts = row.type === "table" ? cells : row.type === "list" ? row.text.split("\n") : [row.text];
    // 段落太短的內容不會成為出題單位（與 pushUnit 的長度門檻一致）
    if (!parts.some((part) => part.trim().length >= 8)) continue;

    counts.set(row.section_id, (counts.get(row.section_id) ?? 0) + 1);
  }
  return counts;
}
