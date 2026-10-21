"use client";

/**
 * 前端呼叫自家 API 的小工具。
 * 學習者 ID 是隨機 UUID，只存放在瀏覽器 localStorage，不含任何個人資料。
 */
import { LEARNER_STORAGE_KEY } from "@/lib/types";

export class ApiError extends Error {
  readonly status: number;
  readonly details: string[];

  constructor(message: string, status: number, details: string[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export function getLearnerId(): string {
  if (typeof window === "undefined") return "";
  const existing = window.localStorage.getItem(LEARNER_STORAGE_KEY);
  if (existing && existing.length > 0) return existing;

  const generated =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `learner-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  window.localStorage.setItem(LEARNER_STORAGE_KEY, generated);
  return generated;
}

export function forgetLearner(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LEARNER_STORAGE_KEY);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
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
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
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
    throw new ApiError(
      `伺服器回應格式不正確（HTTP ${status}），請重試。`,
      status,
    );
  }
}
