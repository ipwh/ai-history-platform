/**
 * Google Cloud Storage provider（**尚未實作**，只預留介面）。
 *
 * 部署到 Cloud Run 時，教材原始檔必須改存 Cloud Storage，步驟見 README「部署準備」：
 *   1. 建立 bucket 及服務帳戶權限（roles/storage.objectAdmin）。
 *   2. 設定 STORAGE_PROVIDER=gcs 及 GCS_BUCKET。
 *   3. 完成本檔的 save / read / remove（可使用 @google-cloud/storage 或 JSON API）。
 *
 * 本階段（只在本機執行）不會呼叫這個 provider；若被誤用會拋出清楚的錯誤，
 * 提示需要完成的設定，而不會靜默失敗。
 */
import { StorageError, type StorageProvider } from "./provider";

export class GcsStorageProvider implements StorageProvider {
  readonly name = "gcs";
  readonly label = "Google Cloud Storage（尚未實作）";
  readonly persistent = true;
  readonly implemented = false;

  constructor(private readonly bucket: string | null) {}

  private notImplemented(detail: string): never {
    const bucket = this.bucket ? `bucket=${this.bucket}` : "未設定 GCS_BUCKET";
    throw new StorageError(
      `尚未實作 Google Cloud Storage 儲存（${bucket}；${detail}）。部署到 Cloud Run 前請完成 src/server/storage/gcs.ts，或先在本機使用 STORAGE_PROVIDER=local。`,
    );
  }

  async save(key: string, data: Buffer): Promise<string> {
    this.notImplemented(`寫入 ${key}（${data.byteLength} bytes）`);
  }

  async read(locator: string): Promise<Buffer | null> {
    this.notImplemented(`讀取 ${locator}`);
  }

  async exists(locator: string): Promise<boolean> {
    // 尚未實作：只記錄提示並回報 false，令健康檢查及系統狀態頁仍可正常顯示
    console.warn(
      `[storage] Google Cloud Storage provider 尚未實作，無法檢查檔案是否存在（${locator.length > 0 ? "已提供位置" : "沒有位置"}）。`,
    );
    return false;
  }

  async remove(locator: string): Promise<void> {
    this.notImplemented(`刪除 ${locator}`);
  }
}
