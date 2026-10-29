/**
 * 資料庫備份與還原（把 SQLite 備份到 Cloud Storage）。
 *
 * 背景：Cloud Run 的容器檔案系統是暫時性的，重新部署或縮容後資料庫會消失。
 * 這個模組用最小的成本把資料保留在 Google Cloud 內：
 *   1. 啟動時（Next.js instrumentation）由 Cloud Storage 還原資料庫。
 *   2. 執行期間每隔 `BACKUP_INTERVAL_SECONDS` 以 `VACUUM INTO` 產生一致快照並上傳。
 *   3. 收到 SIGTERM／SIGINT（Cloud Run 部署或縮容時會收到）時立即做最後一次備份。
 *
 * 鎖定防護：備份**不會**直接複製主資料庫檔案。WAL 模式下主檔案本身不含最新交易日誌，
 * 直接複製（或在寫入途中讀取）會得到損毀或過期的資料；因此一律以
 * `VACUUM INTO` 在單一交易內匯出到暫存目錄，再把該快照上傳。
 *
 * 認證：使用執行環境的服務帳戶（Cloud Run 的 metadata server）取得存取權杖，
 * 不需要在映像檔或程式碼內放置任何金鑰；本機未設定 BACKUP_BUCKET 時完全不會啟用。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import { getServerConfig, type BackupConfig } from "../config";
import { getDb } from "./connection";

const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const STORAGE_API_BASE = "https://storage.googleapis.com";
const UPLOAD_BASE = "https://storage.googleapis.com/upload/storage/v1";
/** 舊版快照檔名後綴（與資料庫同目錄）；只在還原時清理殘留檔案，新版本改用暫存目錄 */
const SNAPSHOT_SUFFIX = ".backup";
/** 快照暫存目錄名稱（位於作業系統的暫存目錄下） */
const SNAPSHOT_DIR_NAME = "history-platform-backup";
/** 殘留快照的最長保留時間：逾時即清除，避免程序被強制終止後暫存檔不斷累積 */
const SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000;
/**
 * 上載逾時。
 *
 * 2026-10-28 正式環境日誌：一個 33 MB 快照上載會「停住約 108 秒」後才被對方關閉
 * （`fetch failed: other side closed (UND_ERR_SOCKET)`／`write EPIPE`），4 次重試
 * 合共 5 分 28 秒，全部發生在某一位學生的 API 請求之內，最後被 Cloud Run 的
 * 300 秒逾時切斷（手機顯示 `Load failed`）。因此這裡縮短至 30 秒並減少次數：
 * 寧可這次放棄，下一個到期請求再試，也不要拖死使用者請求。
 */
const UPLOAD_TIMEOUT_MS = 30_000;
/** 上載嘗試次數（含首次）；失敗就交由下一個到期請求重試 */
const UPLOAD_ATTEMPTS = 2;
/** 進行中的備份超過這個時間仍未結束，視為已失效（連線停住或執行個體被抽走 CPU） */
const BACKUP_STALE_MS = 120_000;
/** gzip 檔頭（`1f 8b`）；SQLite 檔頭是 `SQLite format 3`，兩者不會混淆 */
const GZIP_MAGIC = [0x1f, 0x8b] as const;

export interface BackupStatus {
  enabled: boolean;
  /** 最近一次成功備份時間（ISO 字串） */
  lastSuccessAt: string | null;
  /** 最近一次錯誤訊息（成功後會清空） */
  lastError: string | null;
  /** 已上傳次數 */
  uploads: number;
  /** 最近一次快照大小（bytes） */
  lastBytes: number | null;
  /** 還原結果：restored = 已由雲端還原、skipped = 未還原、failed = 還原失敗 */
  restore: "not-attempted" | "restored" | "skipped" | "failed";
  restoreMessage: string | null;
}

const status: BackupStatus = {
  enabled: false,
  lastSuccessAt: null,
  lastError: null,
  uploads: 0,
  lastBytes: null,
  restore: "not-attempted",
  restoreMessage: null,
};

interface BackupGlobal {
  __historyPlatformBackupStatus?: BackupStatus;
  __historyPlatformBackupTimer?: ReturnType<typeof setInterval> | null;
  __historyPlatformBackupShutdownRegistered?: boolean;
  /** 最近一次「嘗試」備份的時間（毫秒），用於判斷是否到期 */
  __historyPlatformBackupLastAttemptAt?: number;
  /** 是否有備份正在執行（避免重疊） */
  __historyPlatformBackupInFlight?: boolean;
  /** 進行中的備份開始時間（毫秒），用於判定是否已失效 */
  __historyPlatformBackupInFlightAt?: number;
}

/**
 * 狀態放在 `globalThis`，與資料庫連線相同做法。
 *
 * Next.js 的 `instrumentation.ts`（啟動還原及定期備份）與 API route handler
 * 各自有獨立的模組實例，若把狀態放在模組層變數，`/api/health` 會讀不到
 * 備份排程的實際情況。
 */
const globalRef = globalThis as unknown as BackupGlobal;

function statusRef(): BackupStatus {
  globalRef.__historyPlatformBackupStatus ??= { ...status };
  return globalRef.__historyPlatformBackupStatus;
}

export function getBackupStatus(): BackupStatus {
  return { ...statusRef(), enabled: getServerConfig().backup.enabled };
}

/** 物件名稱（例如 history/data/app.db） */
export function backupObjectName(config: BackupConfig): string {
  return `${config.prefix}/data/app.db`;
}

/** 讓測試可以注入 fetch（預設使用全域 fetch） */
export interface BackupIO {
  fetchImpl?: typeof fetch;
  /** 取得存取權杖（預設由 metadata server；測試可注入） */
  tokenProvider?: () => Promise<string>;
}

async function defaultTokenProvider(): Promise<string> {
  const response = await fetch(METADATA_TOKEN_URL, {
    headers: { "Metadata-Flavor": "Google" },
    // metadata server 偶爾會較慢；5 秒曾實測逾時，因此放寬至 15 秒
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`無法取得服務帳戶權杖（HTTP ${response.status}）`);
  }
  const payload = (await response.json()) as { access_token?: unknown };
  if (typeof payload.access_token !== "string" || payload.access_token.length === 0) {
    throw new Error("metadata server 未回傳存取權杖");
  }
  return payload.access_token;
}

async function getToken(io: BackupIO): Promise<string> {
  return (io.tokenProvider ?? defaultTokenProvider)();
}

function resolveFetch(io: BackupIO): typeof fetch {
  return io.fetchImpl ?? fetch;
}

/**
 * 把 fetch 的錯誤轉成可診斷的訊息。
 *
 * undici 對網絡層錯誤只會給 `TypeError: fetch failed`，真正的原因（DNS、TLS、
 * 連線被重設、逾時…）藏在 `cause`，沒有它幾乎無法判斷問題，因此這裡一併輸出。
 */
function describeFetchError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  if (!cause) return error.message;
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    const detail = [cause.message, typeof code === "string" ? `(${code})` : ""]
      .filter((part) => part.length > 0)
      .join(" ");
    return `${error.message}：${detail}`;
  }
  return `${error.message}：${String(cause)}`;
}

/** HTTP 4xx（權限、bucket 不存在等設定問題）重試沒有意義；408／429 屬暫時性，仍會重試 */
function isPermanentClientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const match = /（HTTP (\d{3})）/.exec(error.message);
  if (!match) return false;
  const status = Number(match[1]);
  if (status < 400 || status >= 500) return false;
  return status !== 408 && status !== 429;
}

/**
 * 上載／下載失敗時重試（網絡抖動或 Google 端 5xx 不應令備份失敗）。
 *
 * 採用**指數退避**（300ms、600ms、1200ms…，上限 30 秒）並加入 20% 隨機抖動：
 * 多個執行個體同時失敗時不會在同一刻一起重試，避免再次打爆對方。
 * 4xx（權限、bucket 不存在等）屬設定問題，重試沒有意義，會立即回報；
 * 408／429 屬暫時性，仍然重試。每次重試都會記錄原因，方便由日誌追查。
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  attempts = 4,
  baseDelayMs = 300,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (isPermanentClientError(error) || attempt === attempts) break;
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), 30_000);
      const jitter = Math.round(delay * 0.2 * Math.random());
      console.warn(
        `[backup] 第 ${attempt}/${attempts} 次嘗試失敗，${delay + jitter} 毫秒後重試：${describeFetchError(error)}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
    }
  }
  throw lastError;
}

/**
 * 下載雲端備份；回傳是否真的下載了內容。
 * 網絡層錯誤會轉成可診斷的訊息（見 describeFetchError）。
 */
export async function downloadBackup(
  config: BackupConfig,
  destination: string,
  io: BackupIO = {},
): Promise<{ downloaded: boolean; bytes: number }> {
  if (!config.bucket) return { downloaded: false, bytes: 0 };
  const token = await getToken(io);
  const objectName = backupObjectName(config);
  const url = `${STORAGE_API_BASE}/${config.bucket}/${encodeURI(objectName)}?alt=media`;

  let response: Response;
  try {
    // 冷啟動時下載 16–30 MB 曾實測逾時（2026-10-22 正式環境還原失敗），
    // 因此放寬至 300 秒並重試，避免一次網絡抖動就令執行個體以空白資料庫啟動。
    response = await withRetry(() =>
      resolveFetch(io)(url, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(300_000),
      }),
    );
  } catch (error) {
    throw new Error(describeFetchError(error));
  }

  if (response.status === 404) return { downloaded: false, bytes: 0 };
  if (!response.ok) {
    throw new Error(`下載資料庫備份失敗（HTTP ${response.status}）`);
  }

  const downloaded = Buffer.from(await response.arrayBuffer());
  // 新版本上載的是 gzip 過的快照（34 MB → 約 7 MB，實測壓縮比 0.2）；舊版備份仍是未壓縮的 SQLite。
  // 以檔頭判斷，兩種格式都讀得回來，還原不需要改動呼叫端。
  const buffer = isGzip(downloaded) ? gunzipSync(downloaded) : downloaded;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, buffer);
  return { downloaded: true, bytes: buffer.byteLength };
}

function isGzip(buffer: Buffer): boolean {
  return buffer.length > 2 && buffer[0] === GZIP_MAGIC[0] && buffer[1] === GZIP_MAGIC[1];
}

/** 上傳資料庫快照（網絡抖動由呼叫端的 withRetry 重試） */
export async function uploadBackup(
  config: BackupConfig,
  filePath: string,
  io: BackupIO = {},
): Promise<void> {
  if (!config.bucket) throw new Error("未設定 BACKUP_BUCKET，無法備份");
  const token = await getToken(io);
  const objectName = backupObjectName(config);
  const url = `${UPLOAD_BASE}/b/${config.bucket}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
  const snapshot = fs.readFileSync(filePath);
  // 上載 gzip 後的快照：34 MB 的 SQLite 大多是可壓縮的文字，實測壓縮比 0.2（約 7 MB），
  // 大幅降低連線中途停住的機會（見 UPLOAD_TIMEOUT_MS 的說明）。
  const body = gzipSync(snapshot);

  let response: Response;
  try {
    response = await resolveFetch(io)(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
      },
      body,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(describeFetchError(error));
  }

  if (!response.ok) {
    throw new Error(`上傳資料庫備份失敗（HTTP ${response.status}）`);
  }
}

/** 快照暫存目錄：使用作業系統的暫存目錄，避免在主資料庫旁邊產生大檔案並與 WAL 争用空間 */
function snapshotDirectory(): string {
  return path.join(os.tmpdir(), SNAPSHOT_DIR_NAME);
}

/** 每次備份使用獨立檔名，避免同一部機器上的多個執行個體互相覆寫快照 */
function nextSnapshotPath(): string {
  return path.join(snapshotDirectory(), `app-${process.pid}-${Date.now()}.db`);
}

/**
 * 清除殘留的快照（程序被強制終止時 `finally` 不會執行）。
 * 只在備份前順手清理，成本為一次資料夾讀取，失敗不影響備份。
 */
function pruneStaleSnapshots(now = Date.now()): void {
  const directory = snapshotDirectory();
  let entries: string[];
  try {
    entries = fs.readdirSync(directory);
  } catch {
    return;
  }
  for (const entry of entries) {
    const filePath = path.join(directory, entry);
    try {
      if (now - fs.statSync(filePath).mtimeMs > SNAPSHOT_MAX_AGE_MS) {
        fs.rmSync(filePath, { force: true });
      }
    } catch {
      // 個別檔案清理失敗不影響備份
    }
  }
}

/**
 * 產生一致的資料庫快照。
 *
 * 使用 SQLite 的 `VACUUM INTO`：它會在單一交易內把資料庫完整複製到新檔案，
 * 因此即使同時有寫入，備份內容仍然一致，亦**不會**直接讀取正在寫入的主資料庫
 * （WAL 模式下主檔案本身不含最新交易日誌，直接複製會得到過期或損毀的資料）。
 */
export async function snapshotDatabase(snapshotPath: string): Promise<number> {
  fs.rmSync(snapshotPath, { force: true });
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  getDb().prepare("VACUUM INTO ?").run(snapshotPath);
  return fs.statSync(snapshotPath).size;
}

/**
 * 產生快照並上傳到 Cloud Storage。
 */
export async function backupNow(io: BackupIO = {}, options: { force?: boolean } = {}): Promise<void> {
  const config = getServerConfig().backup;
  if (!config.enabled || !config.bucket) return;

  const status = statusRef();
  if (status.restore === "failed") {
    // 啟動還原失敗時，執行個體的資料庫可能只是剛建立的全新空白資料庫；
    // 把它上載會覆蓋雲端唯一有效的備份（2026-10-22 正式環境曾因此失去資料，
    // 需由人工重新上載）。寧可停止備份並在 /api/health 及日誌顯示原因。
    status.lastError = "啟動還原失敗，已暫停上載備份以免覆蓋雲端資料";
    console.warn("[backup] 暫停上載備份：啟動還原失敗，避免以空白資料庫覆蓋雲端備份");
    return;
  }

  const databasePath = getServerConfig().databasePath;
  if (!fs.existsSync(databasePath) && !options.force) {
    // 尚未建立資料庫（例如全新容器、未收到任何請求）→ 沒有需要備份的內容
    return;
  }

  pruneStaleSnapshots();
  const snapshotPath = nextSnapshotPath();
  try {
    const bytes = await snapshotDatabase(snapshotPath);
    // 網絡抖動不應令一次備份失敗，但重試次數必須有上限：每次嘗試都可能停住數十秒，
    // 而這段時間正卡在某一位使用者的請求之內（見 UPLOAD_TIMEOUT_MS）。
    await withRetry(() => uploadBackup(config, snapshotPath, io), UPLOAD_ATTEMPTS);
    status.lastSuccessAt = new Date().toISOString();
    status.lastError = null;
    status.uploads += 1;
    status.lastBytes = bytes;
  } catch (error) {
    status.lastError = describeFetchError(error);
    console.warn("[backup] 資料庫備份失敗：", status.lastError);
  } finally {
    try {
      fs.rmSync(snapshotPath, { force: true });
    } catch {
      // 暫存檔清理失敗不影響運作
    }
  }
}

/**
 * 啟動時還原資料庫。
 * 預設只在本機沒有資料庫時還原（避免覆蓋本機開發資料）；
 * 設 BACKUP_PREFER_CLOUD=true 時以雲端版本為準（雲端部署建議開啟）。
 */
export async function restoreOnStartup(io: BackupIO = {}): Promise<BackupStatus["restore"]> {
  const status = statusRef();
  const config = getServerConfig().backup;
  if (!config.enabled || !config.bucket || !config.restoreOnStart) {
    status.restore = "skipped";
    status.restoreMessage = config.enabled ? null : "未設定 BACKUP_BUCKET";
    return status.restore;
  }

  const databasePath = getServerConfig().databasePath;
  const exists = fs.existsSync(databasePath);
  if (exists && !config.preferCloud) {
    status.restore = "skipped";
    status.restoreMessage = "本機已有資料庫，略過還原";
    return status.restore;
  }

  try {
    const result = await downloadBackup(config, databasePath, io);
    if (result.downloaded) {
      // 舊的 WAL／SHM 必須一併清除，否則會與還原的資料庫不一致
      for (const suffix of ["-wal", "-shm", SNAPSHOT_SUFFIX]) {
        fs.rmSync(`${databasePath}${suffix}`, { force: true });
      }
      status.restore = "restored";
      status.restoreMessage = `已由雲端還原（${Math.round(result.bytes / 1024)} KB）`;
    } else {
      status.restore = "skipped";
      status.restoreMessage = "雲端沒有備份，視為全新資料庫";
    }
  } catch (error) {
    status.restore = "failed";
    status.restoreMessage = describeFetchError(error);
    console.warn("[backup] 還原資料庫失敗：", status.restoreMessage);
  }
  return status.restore;
}

/**
 * 啟動定期備份（重複呼叫只會保留一個計時器）。
 *
 * 注意：Cloud Run 只會在處理請求時分配 CPU，容器閒置時背景計時器會被節流
 * （實測會出現 `fetch failed`），Next.js 亦有自己的 SIGTERM 處理會令關機備份
 * 來不及完成，因此**可靠的做法是 `backupIfDue()`（在 API 請求週期內執行）**。
 * 這個計時器只在其餘情況「盡力而為」，兩者共用同一個「上次備份時間」。
 */
export function startBackupScheduler(io: BackupIO = {}): void {
  const config = getServerConfig().backup;
  if (!config.enabled) return;
  if (globalRef.__historyPlatformBackupTimer) return;

  registerShutdownBackup(io);
  const timer = setInterval(() => {
    void backupIfDue(io);
  }, config.intervalSeconds * 1000);
  // 不要讓備份計時器阻止程序結束
  timer.unref?.();
  globalRef.__historyPlatformBackupTimer = timer;
}

/**
 * 資料庫自上次成功備份後是否已變更。
 *
 * 以檔案時間判斷（含 WAL 檔，因為 WAL 模式下寫入不會即時反映在主要檔案），
 * 令「沒有變更」時可以完全跳過快照及上載（成本僅為兩次 stat）。
 */
function databaseChangedSinceLastBackup(): boolean {
  const status = statusRef();
  const since = status.lastSuccessAt ? Date.parse(status.lastSuccessAt) : 0;
  const { databasePath } = getServerConfig();
  for (const file of [databasePath, `${databasePath}-wal`]) {
    try {
      if (fs.statSync(file).mtimeMs > since) return true;
    } catch {
      // 檔案不存在（尚未建立資料庫）→ 沒有變更
    }
  }
  return false;
}

/** 距離上次嘗試備份已超過間隔（秒）時才回傳 true */
export function backupDue(now: number = Date.now()): boolean {
  const config = getServerConfig().backup;
  if (!config.enabled || config.intervalSeconds <= 0) return false;
  const lastAttempt = globalRef.__historyPlatformBackupLastAttemptAt ?? 0;
  if (now - lastAttempt >= config.intervalSeconds * 1000) return true;
  // 資料有變更時縮短間隔（至少相隔 minSpacingSeconds），令遺失窗口更小
  if (now - lastAttempt < config.minSpacingSeconds * 1000) return false;
  return databaseChangedSinceLastBackup();
}

/**
 * 到期才備份（在請求週期內呼叫，確保 Cloud Run 有分配 CPU）。
 *
 * 同一時間只會有一個備份在執行；失敗不會拋出例外（狀態記錄在 `getBackupStatus()`）。
 */
export async function backupIfDue(io: BackupIO = {}): Promise<void> {
  if (!backupDue()) return;
  if (globalRef.__historyPlatformBackupInFlight) {
    // 備份已不再阻塞使用者請求，因此可能有一個備份在執行個體失去 CPU 之後永遠不會完成。
    // 過了時限就視為失效並重新開始，否則「進行中」旗標會令此後所有備份都靜默跳過。
    const startedAt = globalRef.__historyPlatformBackupInFlightAt ?? 0;
    if (Date.now() - startedAt < BACKUP_STALE_MS) return;
    console.warn("[backup] 上一次備份超過時限仍未完成，視為失效並重新開始");
  }

  globalRef.__historyPlatformBackupLastAttemptAt = Date.now();
  globalRef.__historyPlatformBackupInFlight = true;
  globalRef.__historyPlatformBackupInFlightAt = Date.now();
  try {
    await backupNow(io);
  } finally {
    globalRef.__historyPlatformBackupInFlight = false;
    globalRef.__historyPlatformBackupInFlightAt = undefined;
  }
}

export function stopBackupScheduler(): void {
  const timer = globalRef.__historyPlatformBackupTimer;
  if (timer) {
    clearInterval(timer);
    globalRef.__historyPlatformBackupTimer = null;
  }
}

/** 收到終止訊號時做最後一次備份（Cloud Run 部署／縮容時會先送 SIGTERM） */
export function registerShutdownBackup(io: BackupIO = {}): void {
  if (globalRef.__historyPlatformBackupShutdownRegistered) return;
  globalRef.__historyPlatformBackupShutdownRegistered = true;
  const handler = (signal: NodeJS.Signals) => {
    void (async () => {
      try {
        await backupNow(io, { force: true });
      } finally {
        stopBackupScheduler();
        process.exit(signal === "SIGINT" ? 130 : 143);
      }
    })();
  };
  process.on("SIGTERM", handler);
  process.on("SIGINT", handler);
}

/** 供測試重置狀態 */
export function resetBackupStateForTest(): void {
  const status = statusRef();
  // 重設為「從未嘗試備份」，令到期判斷可以確定地測試
  globalRef.__historyPlatformBackupLastAttemptAt = 0;
  status.lastSuccessAt = null;
  status.lastError = null;
  status.uploads = 0;
  status.lastBytes = null;
  status.restore = "not-attempted";
  status.restoreMessage = null;
  stopBackupScheduler();
  globalRef.__historyPlatformBackupShutdownRegistered = false;
  globalRef.__historyPlatformBackupInFlight = false;
  globalRef.__historyPlatformBackupInFlightAt = undefined;
}
