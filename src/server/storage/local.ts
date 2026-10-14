/**
 * 本機檔案儲存（預設）。
 *
 * 檔案放在 data/uploads（可用 APP_UPLOADS_DIR 調整）。
 * 注意：容器檔案系統不是永久儲存，部署到 Cloud Run 時必須改用 Cloud Storage。
 */
import fs from "node:fs";
import path from "node:path";

import { StorageError, type StorageProvider } from "./provider";

export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";
  readonly label = "本機檔案系統（data/uploads）";
  readonly persistent = false;
  readonly implemented = true;

  constructor(private readonly baseDir: string) {}

  private resolve(locator: string): string {
    if (path.isAbsolute(locator)) return locator;
    const resolved = path.resolve(this.baseDir, locator);
    // 避免使用 ../ 跳出儲存目錄
    if (!resolved.startsWith(path.resolve(this.baseDir))) {
      throw new StorageError("檔案位置不正確，已拒絕存取");
    }
    return resolved;
  }

  async save(key: string, data: Buffer): Promise<string> {
    const target = this.resolve(key);
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
      return target;
    } catch (error) {
      throw new StorageError(
        `無法儲存教材檔案：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async read(locator: string): Promise<Buffer | null> {
    const target = this.resolve(locator);
    try {
      if (!fs.existsSync(target)) return null;
      return fs.readFileSync(target);
    } catch {
      return null;
    }
  }

  async exists(locator: string): Promise<boolean> {
    try {
      return fs.existsSync(this.resolve(locator));
    } catch {
      return false;
    }
  }

  async remove(locator: string): Promise<void> {
    try {
      fs.rmSync(this.resolve(locator), { force: true });
    } catch {
      // 刪除失敗不應令教材刪除失敗（檔案可能已被手動移除）
    }
  }
}
