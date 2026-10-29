/**
 * 前端錯誤分類（Sprint 23）。
 *
 * 為甚麼需要：學生在舊裝置或網絡不穩時，畫面只會顯示一句籠統的錯誤，甚至一直停在
 * 「正在載入題目…」。教師與學生都無法判斷是網絡、登入、伺服器、資料格式，還是
 * 瀏覽器本身不支援，因此無法自行處理（重試、重新登入、換裝置或通知學校）。
 *
 * 這裡把錯誤分成可操作的類別，並提供一致的標題、說明及是否值得重試。
 * 分類只用本機已有的資訊（HTTP 狀態碼、`ApiError.kind`、例外型別），不收集任何
 * 個人資料，亦不會把伺服器錯誤假裝成成功。
 */

/** 錯誤類別 */
export type ApiFailureKind =
  | "network"
  | "timeout"
  | "auth"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "rate-limited"
  | "client"
  | "server"
  | "format"
  | "empty"
  | "unknown";

/** 錯誤的來源類型；`http` 以外的值由呼叫端明確標示 */
export type ApiErrorKind = "http" | "format" | "timeout" | "empty" | "unavailable";

export class ApiError extends Error {
  readonly status: number;
  readonly details: string[];
  readonly kind: ApiErrorKind;

  constructor(message: string, status: number, details: string[] = [], kind: ApiErrorKind = "http") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
    this.kind = kind;
  }
}

export interface ApiFailure {
  kind: ApiFailureKind;
  /** 給使用者看的短標題（例如「未能連接伺服器」） */
  title: string;
  /** 具體說明（優先用伺服器／例外本身提供的訊息） */
  message: string;
  /** 建議的下一步；沒有合適建議時為 null */
  hint: string | null;
  retryable: boolean;
  status: number | null;
  details: string[];
}

const NETWORK_HINT = "請檢查 Wi-Fi／流動網絡連線後重試；若其他網站正常，可能是學校網絡封鎖了此網址。";
const SERVER_HINT = "這是伺服器端的問題，重試通常有效；若持續出現，請把這個畫面截圖交給老師。";
const AUTH_HINT = "請重新登入後再試；若仍看到這個訊息，請通知老師你的帳戶可能未被加入名單。";
const EMPTY_HINT = "這通常表示題目在載入期間被教師修改或移除了。請返回上一頁重新開始練習。";

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    ((error as { name?: unknown }).name === "AbortError" ||
      (error as { name?: unknown }).name === "TimeoutError")
  );
}

function isNetworkTypeError(error: unknown): boolean {
  // 瀏覽器在 `fetch()` 完全失敗（DNS、離線、TLS、CORS 被擋、連線被中途切斷）時拋出
  // TypeError，沒有 status 可用，因此只能以型別判別。
  if (error instanceof TypeError) return true;
  // iOS／Safari（WebKit）的訊息是 `Load failed`，Chromium 是 `Failed to fetch`；
  // 有些情況（例如回應主體被切斷、跨框架傳遞）拿到的不是 TypeError 實例，
  // 若只看型別就會掉進「未知」分支，把英文原文直接顯示給學生。
  return (
    error instanceof Error &&
    /load failed|failed to fetch|network ?error|networkrequestfailed|internet connection appears to be offline|network connection was lost/i.test(
      error.message,
    )
  );
}

/**
 * 把任何錯誤轉成可顯示、可行動的說明。
 *
 * 不會把失敗轉成成功，也不會吞掉伺服器提供的細節（`details` 會原樣帶到介面）。
 */
export function describeApiFailure(error: unknown): ApiFailure {
  if (error instanceof ApiError) {
    const base = {
      status: error.status,
      details: error.details,
      message: error.message,
    };
    if (error.kind === "format") {
      return {
        ...base,
        kind: "format",
        title: "伺服器回應格式不正確",
        hint: "這通常代表載入時被中斷或遇到代理伺服器錯誤頁。請重試；若持續出現，請通知老師。",
        retryable: true,
      };
    }
    if (error.kind === "timeout") {
      return {
        ...base,
        kind: "timeout",
        title: "載入逾時",
        hint: "伺服器在限定時間內沒有回應。請重試；如你正在使用學校網絡，繁忙時段可能較慢。",
        retryable: true,
      };
    }
    if (error.kind === "unavailable") {
      return {
        ...base,
        kind: "server",
        title: "伺服器正在啟動",
        hint:
          "網站閒置一段時間後會重新啟動，需要十數秒載入題庫。請等 10–20 秒後再按一次；" +
          "你的練習記錄不會因而遺失。",
        retryable: true,
      };
    }
    if (error.kind === "empty") {
      return {
        ...base,
        kind: "empty",
        title: "這次練習沒有可顯示的題目",
        hint: EMPTY_HINT,
        retryable: true,
      };
    }
    if (error.status === 401) {
      return { ...base, kind: "auth", title: "登入狀態已失效", hint: AUTH_HINT, retryable: false };
    }
    if (error.status === 403) {
      return {
        ...base,
        kind: "forbidden",
        title: "沒有權限",
        hint: AUTH_HINT,
        retryable: false,
      };
    }
    if (error.status === 404) {
      return {
        ...base,
        kind: "not-found",
        title: "找不到資料",
        hint: EMPTY_HINT,
        retryable: false,
      };
    }
    if (error.status === 409) {
      return {
        ...base,
        kind: "conflict",
        title: "資料已被更新",
        hint: "請重新載入以取得最新版本後再試。",
        retryable: true,
      };
    }
    if (error.status === 429) {
      return {
        ...base,
        kind: "rate-limited",
        title: "操作太頻繁",
        hint: "請等數十秒後再試。",
        retryable: true,
      };
    }
    if (error.status >= 500) {
      return { ...base, kind: "server", title: "伺服器暫時出錯", hint: SERVER_HINT, retryable: true };
    }
    return { ...base, kind: "client", title: "未能完成這個操作", hint: null, retryable: true };
  }

  if (isAbortError(error)) {
    return {
      kind: "timeout",
      title: "載入逾時",
      message: "請求在限定時間內沒有完成。",
      hint: "請重試；若你正在使用學校網絡，繁忙時段可能較慢。",
      retryable: true,
      status: null,
      details: [],
    };
  }

  if (isNetworkTypeError(error)) {
    return {
      kind: "network",
      title: "未能連接伺服器",
      message: "瀏覽器無法連上網站的伺服器（可能是離線、Wi-Fi 需要重新登入，或網址被封鎖）。",
      hint: NETWORK_HINT,
      retryable: true,
      status: null,
      details: [],
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    kind: "unknown",
    title: "發生問題",
    message,
    hint: null,
    retryable: true,
    status: null,
    details: [],
  };
}
