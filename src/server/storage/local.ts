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

  /**
   * 把 locator 轉成實際檔案路徑，一律限制在儲存目錄內。
   *
   * 資料庫儲存的是「寫入當時」的絕對路徑，因此專案被搬到其他位置（本機換硬碟、
   * 換資料夾）或容器的工作目錄改變後，該路徑就不再存在。這種情況下改用檔名
   * （`path.basename`，不含任何目錄分隔符）在儲存目錄內尋找同一個檔案，
   * 令教材仍然可以讀取，同時不會離開儲存目錄。
   */
  private resolve(locator: string): string {
    const root = path.resolve(this.baseDir);
    const insideRoot = (target: string): boolean =>
      target === root || target.startsWith(root + path.sep);

    if (path.isAbsolute(locator)) {
      const absolute = path.resolve(locator);
      if (insideRoot(absolute)) return absolute;
      // 儲存目錄以外的絕對路徑：以檔名在儲存目錄內尋找，不採用原本的路徑
      return path.join(root, path.basename(locator));
    }

    const resolved = path.resolve(root, locator);
    // 避免使用 ../ 跳出儲存目錄
    if (!insideRoot(resolved)) throw new StorageError("檔案位置不正確，已拒絕存取");
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
