/**
 * 檔案儲存抽象層。
 *
 * 目的：教材原始檔、OCR 暫存檔等檔案一律經由這個介面存取，
 * 令業務邏輯不會寫死本機路徑。本機開發使用 LocalStorageProvider（data/uploads），
 * 未來部署到 Cloud Run 時可換成 GcsStorageProvider（Google Cloud Storage），
 * 屆時只需設定 STORAGE_PROVIDER=gcs 及對應的 bucket／憑證。
 *
 * locator 是「不透明的檔案位置字串」：
 *   - 本機：絕對路徑（向後相容既有資料庫記錄）
 *   - Cloud Storage：gs://bucket/object
 * 呼叫者不會解析 locator，只會交回儲存層讀取或刪除。
 */
export interface StorageProvider {
  /** 內部名稱：local / gcs */
  readonly name: string;
  /** 顯示名稱（不含任何憑證） */
  readonly label: string;
  /** 是否為永久儲存（本機磁碟在容器中不是永久，Cloud Storage 是） */
  readonly persistent: boolean;
  /** 是否已完成實作（未實作的 provider 會拋出清楚的錯誤） */
  readonly implemented: boolean;
  /** 寫入檔案並回傳 locator */
  save(key: string, data: Buffer): Promise<string>;
  /** 讀取檔案內容；不存在時回傳 null */
  read(locator: string): Promise<Buffer | null>;
  exists(locator: string): Promise<boolean>;
  /** 刪除檔案；檔案不存在時不會拋出錯誤 */
  remove(locator: string): Promise<void>;
}

export class StorageError extends Error {
  readonly status = 500;
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}
