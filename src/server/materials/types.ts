/**
 * 教材解析的中介資料型別。
 * 解析器（DOCX / PDF）只負責產生 ParsedBlock，寫入資料庫由 service 層處理。
 */
import type { MaterialBlockType, TableCell } from "../../lib/types";

export interface ParsedBlock {
  type: MaterialBlockType;
  /** 標題層級（1-6），非標題為 null */
  level: number | null;
  text: string;
  /** 清單項目（type = list 時使用） */
  items: string[];
  /** 表格資料（type = table 時使用） */
  table: TableCell[][] | null;
  /** 在文件中的次序 */
  order: number;
  /** 來源頁數（PDF 適用），其他格式為 null */
  page: number | null;
}

export interface ParseResult {
  blocks: ParsedBlock[];
  imageCount: number;
  /** 解析器的限制說明（例如 PDF 沒有可擷取文字） */
  limitationNote: string | null;
  /** 解析過程的警告，會顯示給教師參考 */
  warnings: string[];
  /** 文件類型對應的頁數等補充資訊 */
  pageCount: number | null;
}

export class MaterialParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaterialParseError";
  }
}

export function emptyParseResult(): ParseResult {
  return { blocks: [], imageCount: 0, limitationNote: null, warnings: [], pageCount: null };
}
