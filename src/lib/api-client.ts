"use client";

/**
 * 前端呼叫自家 API 的小工具。
 * 學習者 ID 是隨機 UUID，只存放在瀏覽器 localStorage，不含任何個人資料。
 */
import { ApiError } from "@/lib/api-errors";
import { LEARNER_STORAGE_KEY } from "@/lib/types";

export { ApiError };

/** 私密瀏覽或封鎖儲存空間時，`localStorage` 可能一存取就拋錯（舊版 Safari 會如此） */
function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 儲存空間不可用時的後備：只在本次瀏覽有效，不足以辨識學習者時仍可完成練習 */
let inMemoryLearnerId: string | null = null;

export function getLearnerId(): string {
  if (typeof window === "undefined") return "";
  const storage = safeStorage();
  const existing = storage?.getItem(LEARNER_STORAGE_KEY) ?? null;
  if (existing !== null && existing.length > 0) return existing;

  const generated =
    inMemoryLearnerId ??
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `learner-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);
  inMemoryLearnerId = generated;
  try {
    storage?.setItem(LEARNER_STORAGE_KEY, generated);
  } catch {
    // 私密瀏覽／儲存空間已滿：保留記憶體中的 ID，避免整頁因為寫入失敗而崩潰。
  }
  return generated;
}

export function forgetLearner(): void {
  if (typeof window === "undefined") return;
  inMemoryLearnerId = null;
  try {
    safeStorage()?.removeItem(LEARNER_STORAGE_KEY);
  } catch {
    // 同上：清除失敗不應令介面崩潰。
  }
}

/**
 * Cloud Run 邊緣層中止請求時的簽名。
 *
 * `min-instances=0` 時，請求若在執行個體仍冷啟動（由 Cloud Storage 還原約 34 MB 資料庫）
 * 期間到達，Cloud Run 會直接回 `429 The request was aborted because there was no available
 * instance`（或 `503`）並以純文字回應；這些回應**未到達應用程式**，所以重試不會重複寫入。
 * 我們的 API 一律回傳 JSON，因此「非 JSON 的 429／503」可以安全地視為邊緣層中止。
 */
function isEdgeAbort(status: number, text: string): boolean {
  if (status !== 429 && status !== 503) return false;
  const trimmed = text.trim();
  return trimmed.length === 0 || !(trimmed.startsWith("{") || trimmed.startsWith("["));
}

/** 冷啟動中止後的重試間隔；兩次合共最多 9 秒，足夠等一個剛啟動的執行個體接手 */
const EDGE_ABORT_RETRY_DELAYS_MS = [3_000, 6_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 一次請求；`edgeAbort` 表示邊緣層中止（見 {@link isEdgeAbort}），交由呼叫端決定是否重試 */
async function requestOnce<T>(
  path: string,
  init: RequestInit | undefined,
  options: { timeoutMs?: number },
): Promise<{ value: T } | { edgeAbort: ApiError }> {
  // 只有明確指定 `timeoutMs` 的呼叫才會設時限（練習載入、提交答案）。
  const controller =
    options.timeoutMs !== undefined && typeof AbortController !== "undefined"
      ? new AbortController()
      : null;
  const timer =
    controller !== null && options.timeoutMs !== undefined
      ? setTimeout(() => controller.abort(), options.timeoutMs)
      : null;

  try {
    const response = await fetch(path, {
      ...init,
      ...(controller !== null ? { signal: controller.signal } : {}),
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });

    const text = await response.text();

    if (!response.ok && isEdgeAbort(response.status, text)) {
      // 邊緣層中止：回應不是應用程式產生，因此不上拋「格式不正確」這種誤導訊息。
      return {
        edgeAbort: new ApiError(
          "伺服器正在啟動，暫時未能接納請求。",
          response.status,
          [],
          "unavailable",
        ),
      };
    }

    const payload = parseResponsePayload(text, response.status);

    if (!response.ok) {
      const record = (payload ?? {}) as { error?: string; details?: string[] };
      throw new ApiError(
        record.error ?? `請求失敗（HTTP ${response.status}）`,
        response.status,
        record.details ?? [],
      );
    }

    return { value: payload as T };
  } catch (error) {
    if (controller !== null && controller.signal.aborted) {
      throw new ApiError(
        `伺服器在 ${Math.round((options.timeoutMs ?? 0) / 1000)} 秒內沒有回應，請重試。`,
        0,
        [],
        "timeout",
      );
    }
    throw error;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  let last: ApiError | null = null;
  for (let attempt = 0; attempt <= EDGE_ABORT_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await sleep(EDGE_ABORT_RETRY_DELAYS_MS[attempt - 1]);
    const outcome = await requestOnce<T>(path, init, options);
    if ("value" in outcome) return outcome.value;
    last = outcome.edgeAbort;
  }
  // 重試後仍是邊緣層中止：顯示可行動的中文說明，而不是英文原文或「格式不正確」。
  throw last ?? new ApiError("伺服器暫時無法使用，請稍後再試。", 503, [], "unavailable");
}

export const api = {
  get: <T,>(path: string, options?: { timeoutMs?: number }) => request<T>(path, undefined, options),
  post: <T,>(path: string, body: unknown, options?: { timeoutMs?: number }) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }, options),
  patch: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T,>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: async <T,>(path: string, formData: FormData): Promise<T> => {
    const response = await fetch(path, { method: "POST", body: formData });
    const text = await response.text();
    const payload = parseResponsePayload(text, response.status);
    if (!response.ok) {
      const record = (payload ?? {}) as { error?: string; details?: string[] };
      throw new ApiError(
        record.error ?? `上載失敗（HTTP ${response.status}）`,
        response.status,
        record.details ?? [],
      );
    }
    return payload as T;
  },
};

function parseResponsePayload(text: string, status: number): unknown {
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    // `format`：HTTP 成功但內容不是 JSON（代理錯誤頁、被截斷的回應）。呼叫端可據此
    // 顯示「回應格式不正確」而不是「沒有題目」。
    throw new ApiError(
      `伺服器回應格式不正確（HTTP ${status}），請重試。`,
      status,
      [],
      "format",
    );
  }
}
