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

async function request<T>(
  path: string,
  init?: RequestInit,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  // 只有明確指定 `timeoutMs` 的呼叫才會設時限（練習載入）。提交答案可能包含伺服器端
  // AI 批改，耗時較長，因此不設預設逾時，免得把正常的慢回應變成失敗。
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
    const payload = parseResponsePayload(text, response.status);

    if (!response.ok) {
      const record = (payload ?? {}) as { error?: string; details?: string[] };
      throw new ApiError(
        record.error ?? `請求失敗（HTTP ${response.status}）`,
        response.status,
        record.details ?? [],
      );
    }

    return payload as T;
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

export const api = {
  get: <T,>(path: string, options?: { timeoutMs?: number }) => request<T>(path, undefined, options),
  post: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
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
