/**
 * 題目來源可追溯性的分類規則（純函式，不接觸資料庫）。
 *
 * 界線：
 *   - `traceable` 只代表「可以定位到具體來源文件／段落」，不代表歷史內容正確；
 *   - 也不代表已取得版權許可。三項必須分開判斷（見 question-policy.ts）。
 *   - 不以題目文字相似度推斷來源；只使用實際存在的識別碼及位置欄位。
 */
export const SOURCE_TRACEABILITY_STATUSES = [
  "traceable",
  "partial",
  "unknown",
  "pending_verification",
] as const;

export type SourceTraceabilityStatus = (typeof SOURCE_TRACEABILITY_STATUSES)[number];

export type SourceTraceabilityCode =
  | "SOURCE_BLOCKS_RESOLVED"
  | "SOURCE_BLOCK_MISSING"
  | "SOURCE_BLOCK_DOCUMENT_MISSING"
  | "SOURCE_BLOCK_UNVERIFIED"
  | "SOURCE_LOCATION_UNVERIFIED"
  | "SOURCE_LOCATION_INCOMPLETE"
  | "SOURCE_DOCUMENT_RECORD_MISSING"
  | "SOURCE_HASH_MISSING"
  | "SOURCE_MISSING";

export interface SourceBlockResolution {
  blockId: string;
  blockExists: boolean;
  documentExists: boolean;
}

export interface SourceTraceabilityInput {
  origin: string;
  sourceLocation: string;
  sourceBlockIds: string[];
  sourceVerified: boolean;
  blockResolutions: SourceBlockResolution[];
}

export interface SourceTraceabilityResult {
  status: SourceTraceabilityStatus;
  codes: SourceTraceabilityCode[];
  reasons: string[];
  evidence: {
    hasBlockLinks: boolean;
    hasDocumentRecord: boolean;
    hasQuestionNumber: boolean;
    hasFileReference: boolean;
    /** 平台現時沒有匯入批次表；此欄固定 false，屬 schema 層面的已知缺口。 */
    hasImportBatch: false;
    hasSourceHash: boolean;
  };
}

const FILE_REFERENCE = /\.(docx?|pdf|txt|csv|xlsx?)\b/i;
const QUESTION_NUMBER = /第\s*\d+\s*題/;
const PARAGRAPH_NUMBER = /第\s*\d+\s*段/;

/** 非 `traceable` 即為來源可追溯性缺口 */
export function isSourceTraceabilityGap(status: SourceTraceabilityStatus): boolean {
  return status !== "traceable";
}

export function classifySourceTraceability(
  input: SourceTraceabilityInput,
): SourceTraceabilityResult {
  const sourceLocation = input.sourceLocation.trim();
  const hasBlockLinks = input.sourceBlockIds.length > 0;
  const hasFileReference = FILE_REFERENCE.test(sourceLocation);
  const hasQuestionNumber = QUESTION_NUMBER.test(sourceLocation);
  const hasParagraphNumber = PARAGRAPH_NUMBER.test(sourceLocation);
  const hasDocumentRecord = input.blockResolutions.some((resolution) => resolution.documentExists);
  const hasSourceHash = hasBlockLinks;

  const evidence = {
    hasBlockLinks,
    hasDocumentRecord,
    hasQuestionNumber,
    hasFileReference,
    hasImportBatch: false as const,
    hasSourceHash,
  };

  if (hasBlockLinks) {
    const missingBlocks = input.blockResolutions.filter((resolution) => !resolution.blockExists);
    if (missingBlocks.length > 0) {
      return {
        status: "partial",
        codes: ["SOURCE_BLOCK_MISSING"],
        reasons: [
          `有 ${missingBlocks.length} 個來源段落 ID 已不存在（例如 ${missingBlocks[0]?.blockId}）`,
        ],
        evidence,
      };
    }
    const missingDocuments = input.blockResolutions.filter(
      (resolution) => !resolution.documentExists,
    );
    if (missingDocuments.length > 0) {
      return {
        status: "partial",
        codes: ["SOURCE_BLOCK_DOCUMENT_MISSING"],
        reasons: ["來源段落存在，但所屬教材文件已不存在"],
        evidence,
      };
    }
    if (!input.sourceVerified) {
      return {
        status: "pending_verification",
        codes: ["SOURCE_BLOCK_UNVERIFIED"],
        reasons: ["有來源段落連結，但未記錄教材依據核實"],
        evidence,
      };
    }
    return {
      status: "traceable",
      codes: ["SOURCE_BLOCKS_RESOLVED"],
      reasons: ["可定位至現存教材段落及文件"],
      evidence,
    };
  }

  if (hasFileReference && hasQuestionNumber) {
    return {
      status: "pending_verification",
      codes: ["SOURCE_LOCATION_UNVERIFIED", "SOURCE_DOCUMENT_RECORD_MISSING", "SOURCE_HASH_MISSING"],
      reasons: [
        "有來源檔名及題號，但平台沒有該文件的紀錄、雜湊或匯入批次，無法由系統核實",
      ],
      evidence,
    };
  }

  if (sourceLocation.length > 0) {
    const codes: SourceTraceabilityCode[] = ["SOURCE_LOCATION_INCOMPLETE"];
    if (!hasDocumentRecord) codes.push("SOURCE_DOCUMENT_RECORD_MISSING");
    if (!hasSourceHash) codes.push("SOURCE_HASH_MISSING");
    return {
      status: "partial",
      codes,
      reasons: [
        hasParagraphNumber
          ? "只有段落位置，沒有文件紀錄或題號"
          : "只有來源描述文字，缺少檔名、題號或文件識別碼",
      ],
      evidence,
    };
  }

  return {
    status: "unknown",
    codes: ["SOURCE_MISSING", "SOURCE_DOCUMENT_RECORD_MISSING", "SOURCE_HASH_MISSING"],
    reasons: ["沒有任何來源段落、檔名、題號或位置"],
    evidence,
  };
}
