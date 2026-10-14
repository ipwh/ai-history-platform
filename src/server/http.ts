/**
 * Route handler 共用的回應及錯誤處理。
 * 所有 API 都經由這裡回傳統一格式，錯誤訊息一律以繁體中文說明。
 */
import { NextResponse } from "next/server";
import { z } from "zod";

export class ApiRouteError extends Error {
  readonly status: number;
  readonly details: string[];

  constructor(message: string, status = 400, details: string[] = []) {
    super(message);
    this.name = "ApiRouteError";
    this.status = status;
    this.details = details;
  }
}

export function jsonOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function jsonError(message: string, status = 400, details: string[] = []): NextResponse {
  return NextResponse.json({ error: message, details }, { status });
}

interface ErrorWithStatus {
  status?: number;
  details?: string[];
  issues?: { path: (string | number)[]; message: string }[];
  name?: string;
}

/** 把各種錯誤轉成一致的 API 錯誤回應 */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiRouteError) {
    return jsonError(error.message, error.status, error.details);
  }

  if (error instanceof z.ZodError) {
    return jsonError(
      "提交的資料格式不正確",
      400,
      error.issues.map((issue) => `${issue.path.join(".")}：${issue.message}`),
    );
  }

  const candidate = error as ErrorWithStatus;
  if (typeof candidate?.status === "number") {
    return jsonError(
      error instanceof Error ? error.message : "發生錯誤",
      candidate.status,
      candidate.details ?? [],
    );
  }

  if (error instanceof Error && Array.isArray(candidate.issues)) {
    return jsonError(
      error.message,
      400,
      candidate.issues.map((issue) => `${issue.path.join(".")}：${issue.message}`),
    );
  }

  console.error("[api] 未預期的錯誤", error);
  return jsonError(
    `伺服器發生未預期的錯誤：${error instanceof Error ? error.message : String(error)}`,
    500,
  );
}

/** 包裝 route handler，統一捕捉錯誤 */
/**
 * 觸發「到期的備份」。
 *
 * 必須在請求週期內完成（`await`），因為 Cloud Run 只會在處理請求時分配 CPU：
 * 容器閒置時的背景計時器會被節流，實測會以 `fetch failed` 失敗。
 * 未到期時成本只是兩次 `stat`，因此對一般請求沒有影響。
 */
async function triggerDueBackup(): Promise<void> {
  try {
    const { backupIfDue } = await import("./db/backup");
    await backupIfDue();
  } catch (error) {
    // 備份失敗不應影響 API 回應（狀態會記錄在備份狀態中）
    console.warn("[backup] 請求期間備份失敗：", error instanceof Error ? error.message : error);
  }
}

export async function handleRoute(handler: () => Promise<NextResponse>): Promise<NextResponse> {
  let response: NextResponse;
  try {
    response = await handler();
  } catch (error) {
    response = toErrorResponse(error);
  }
  await triggerDueBackup();
  return response;
}

export async function parseJsonBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new ApiRouteError("請求內容必須是有效的 JSON", 400);
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiRouteError(
      "提交的資料格式不正確",
      400,
      parsed.error.issues.map((issue) => `${issue.path.join(".")}：${issue.message}`),
    );
  }
  return parsed.data;
}

/** 學習者 ID 由前端產生（UUID），必須存在才能讀寫學習記錄 */
export function requireParam(value: string | null | undefined, label: string): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    throw new ApiRouteError(`缺少必要的參數：${label}`, 400);
  }
  return trimmed;
}
