/**
 * 儲存 provider 解析：依環境變數決定使用哪一種檔案儲存。
 * 未設定時使用本機檔案系統（data/uploads），維持原本的行為。
 */
import { getServerConfig } from "../config";
import { GcsStorageProvider } from "./gcs";
import { LocalStorageProvider } from "./local";
import type { StorageProvider } from "./provider";

let cached: StorageProvider | null = null;
let cachedKey = "";

function providerKey(): string {
  const config = getServerConfig();
  return `${config.storage.provider}|${config.uploadsDir}|${config.storage.gcsBucket ?? ""}`;
}

export function resolveStorageProvider(): StorageProvider {
  const key = providerKey();
  if (cached && cachedKey === key) return cached;

  const config = getServerConfig();
  cached =
    config.storage.provider === "gcs"
      ? new GcsStorageProvider(config.storage.gcsBucket)
      : new LocalStorageProvider(config.uploadsDir);
  cachedKey = key;
  return cached;
}

/** 供健康檢查／系統狀態顯示的儲存摘要（不含完整路徑或憑證） */
export function describeStorage(): {
  provider: string;
  label: string;
  persistent: boolean;
  implemented: boolean;
} {
  const provider = resolveStorageProvider();
  return {
    provider: provider.name,
    label: provider.label,
    persistent: provider.persistent,
    implemented: provider.implemented,
  };
}

/**
 * 讀取已儲存的檔案（經儲存層，不直接存取本機路徑）。
 * 找不到時回傳 null。
 */
export async function readStoredFile(locator: string | null): Promise<Buffer | null> {
  if (!locator) return null;
  return resolveStorageProvider().read(locator);
}

/** 刪除已儲存的檔案（經儲存層）；locator 為 null 時不做任何事 */
export async function removeStoredFile(locator: string | null): Promise<void> {
  if (!locator) return;
  await resolveStorageProvider().remove(locator);
}

export type { StorageProvider };
export { StorageError } from "./provider";
