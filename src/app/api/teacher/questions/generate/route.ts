import { NextResponse } from "next/server";
import { z } from "zod";

import {
  handleRoute,
  jsonOk,
  parseJsonBody,
  privateResponseHeaders,
} from "@/server/http";
import { questionGenerationRequestSchema } from "@/lib/types";
import {
  QuestionServiceError,
  generateQuestions,
  type GenerateOptions,
  type GenerationResult,
} from "@/server/services/question-service";
import { requireTeacher } from "@/server/auth/guards";

export const runtime = "nodejs";

const generateSchema = questionGenerationRequestSchema.extend({
  allowMockFallback: z.boolean().optional(),
});

const encoder = new TextEncoder();

/** SSE 事件；格式與學伴（TutorView）使用的串流一致 */
function sseEvent(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** 串流心跳：長時間沒有位元組的連線會被代理層切斷（一次生成可能超過一分鐘） */
const HEARTBEAT_MS = 15_000;

/**
 * 介面是否要求逐步回報進度（`Accept: text/event-stream`）。
 *
 * 預設仍是單一 JSON 回應，令舊介面、指令碼及整合不受影響。
 */
function wantsProgressStream(request: Request): boolean {
  return (request.headers.get("accept") ?? "").toLowerCase().includes("text/event-stream");
}

/**
 * 以 SSE 回報生成進度，最後一個事件是完整結果或錯誤。
 *
 * 為甚麼需要：一次生成可能包含多輪模型呼叫（重寫教學品質不合格的題目、補足不足的題數），
 * 每輪都要數十秒。介面若只看到一個靜止的「正在生成…」，用家很自然會以為平台失敗
 * 而重新整理頁面，令該次生成白費。事件次序：
 *
 *   progress →（可重複多次）→ done ｜ error
 *
 * 客戶端離線（例如用家仍然重新整理了頁面）時**不會中止生成**：已開始的題目照常寫入
 * 題庫，用家重新載入後會在題目清單看到，毋須重新等待。
 */
function streamGeneration(body: GenerateOptions): NextResponse {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(sseEvent(event, data));
        } catch {
          // 客戶端已離開：繼續完成生成（題目仍會寫入題庫），只是不再推送
          closed = true;
        }
      };

      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          closed = true;
        }
      }, HEARTBEAT_MS);

      try {
        const result: GenerationResult = await generateQuestions({
          ...body,
          onProgress: (progress) => send("progress", progress),
        });
        send("done", result);
      } catch (error) {
        const status = error instanceof QuestionServiceError ? error.status : 500;
        const message =
          error instanceof QuestionServiceError
            ? error.message
            : "生成題目時發生錯誤，請稍後再試；若持續出現，請把這個畫面截圖交給管理員。";
        if (status >= 500 && !(error instanceof QuestionServiceError)) {
          console.error("[generate] 生成題目失敗", error);
        }
        send("error", { error: message, status });
      } finally {
        clearInterval(heartbeat);
        if (!closed) {
          try {
            controller.close();
          } catch {
            // 已經關閉
          }
        }
      }
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: privateResponseHeaders({
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "private, no-store, no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    }),
  });
}

/**
 * 教師用：生成題目。
 *
 * 生成結果會寫入題庫並附上教材依據及來源段落方便查核。**Sprint 7.8 起**：通過自動品質
 * 驗證的題目會即時發布供學生自學（`AUTO_PUBLISH_VALIDATED_QUESTIONS`，預設開啟），
 * 回應會帶 `autoValidatedAt` 及發布後的 `status`；未通過驗證的題目維持草稿。
 * 自動驗證**不會**建立任何人工覆核紀錄。
 *
 * **2026-11-24 起**：通過驗證的題目少於要求時，生成流程會自動補題（最多 2 輪），
 * 因此回應時間可能延長。介面可以要求 `Accept: text/event-stream`，以 SSE 取得
 * `progress` 事件並顯示進度，避免用家誤以為生成失敗。
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    await requireTeacher(request);
    const body = await parseJsonBody(request, generateSchema);
    if (!wantsProgressStream(request)) {
      const result = await generateQuestions(body);
      return jsonOk(result);
    }
    return streamGeneration(body);
  });
}
