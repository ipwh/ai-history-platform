import { NextResponse } from "next/server";
import { z } from "zod";

import { requireStudentOrTeacher } from "@/server/auth/guards";
import { getServerConfig } from "@/server/config";
import { parseTutorQuestionSuggestions } from "@/lib/tutor-question-suggestions";
import {
  createTutorSession,
  countTutorMessages,
  getTutorMessages,
  getTutorSessionLearnerId,
  saveTutorMessage,
  isTutorSessionLastTurnOnTopic,
  setTutorSessionLastTurnOnTopic,
  TUTOR_MESSAGE_WINDOW,
  type TutorMessage,
} from "@/server/repositories/tutor";
import { describeAiLimit, reserveAiOperation } from "@/server/services/ai-limits";
import {
  answeredTurnsOnly,
  hongKongTimestamp,
  isHistoryTopicPrompt,
  isShortHistoryFollowUp,
  TUTOR_DAILY_LIMIT,
  TUTOR_OFF_TOPIC_REPLY,
  tutorDailyUsage,
  tutorTurnsForContext,
} from "@/server/services/tutor";
import {
  answerDeclaresNotCovered,
  buildTutorGlossary,
  buildTutorSystemPrompt,
  detectTermMismatches,
  findTutorGrounding,
  loadTutorCurriculumIndex,
  matchesCurriculumTerms,
} from "@/server/services/tutor-grounding";
import { ApiRouteError, handleRoute, jsonOk, parseJsonBody, privateResponseHeaders } from "@/server/http";

export const runtime = "nodejs";

/**
 * 學伴提問目前與「AI 出題」共用 `generation` 配額（MVP 決定，見 README「AI 用量上限」）。
 * 若日後要分開統計，應在 AiOperationKind 新增 `tutor` 並加設專屬上限，
 * 而不是在這裡自行寫入用量記錄（那會繞過全域時間窗檢查）。
 */
const TUTOR_OPERATION_KIND = "generation" as const;

const chatRequestSchema = z.object({
  message: z.string().trim().min(1, "請輸入問題").max(2000, "問題不可多於 2,000 字"),
  sessionId: z.string().trim().min(1).max(128).optional(),
});

/**
 * 學伴存取守衛。
 *
 * - 未登入 → 401。
 * - 教師／管理員 → 放行，供科組測試（2026-10-27 擁有者指示）。其對話記錄在
 *   `teacher:`／`admin:` learnerId 之下，與學生完全分開；每日 15 次及
 *   `generation` 時間窗配額與學生相同，毋須另設例外。
 * - 學生 → 必須已在名冊核對，否則 403（未核對即無法確認是本校學生）。
 */
async function requireTutorAccess(request: Request): Promise<string> {
  const actor = await requireStudentOrTeacher(request);
  if (!actor.user) throw new ApiRouteError("請先以學校 Google 帳戶登入", 401);
  if (actor.user.role === "student" && !actor.user.rosterVerified) {
    throw new ApiRouteError(
      "你的帳戶尚未完成學生名冊核對，暫不可使用學伴；請聯絡歷史科老師。",
      403,
    );
  }
  if (actor.learnerId === null) {
    throw new ApiRouteError("登入工作階段缺少有效的學生身分", 401);
  }
  return actor.learnerId;
}

function buildDeepSeekEndpoint(baseUrl: string): string {
  return new URL("chat/completions", `${baseUrl.replace(/\/+$/, "")}/`).toString();
}

function extractDelta(data: string): string | null {
  if (data === "[DONE]") return null;
  const payload: unknown = JSON.parse(data);
  if (typeof payload !== "object" || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || typeof choices[0] !== "object" || choices[0] === null) {
    return null;
  }
  const delta = (choices[0] as { delta?: unknown }).delta;
  if (typeof delta !== "object" || delta === null) return null;
  const content = (delta as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

function sseEvent(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(request: Request) {
  return handleRoute(async () => {
    const learnerId = await requireTutorAccess(request);
    const sessionId = new URL(request.url).searchParams.get("sessionId");
    if (sessionId !== null && sessionId.length > 0) {
      if (getTutorSessionLearnerId(sessionId) !== learnerId) {
        throw new ApiRouteError("找不到指定的學伴對話", 404);
      }
    }
    const usage = tutorDailyUsage(learnerId);
    const windowLimitReached =
      getServerConfig().aiLimits.enabled && describeAiLimit(learnerId, "generation").exceeded;
    // 只回最近 TUTOR_MESSAGE_WINDOW 則，並如實告知是否被截斷（決策 5）
    const messages: TutorMessage[] = sessionId ? getTutorMessages(sessionId) : [];
    const messageCount = sessionId ? countTutorMessages(sessionId) : 0;
    return jsonOk({
      sessionId,
      messages,
      messageLimit: TUTOR_MESSAGE_WINDOW,
      messageCount,
      truncated: messageCount > messages.length,
      dailyLimit: TUTOR_DAILY_LIMIT,
      windowLimitReached,
      ...usage,
    });
  });
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const learnerId = await requireTutorAccess(request);
    const body = await parseJsonBody(request, chatRequestSchema);
    let sessionId = body.sessionId ?? null;
    let history: ReturnType<typeof getTutorMessages> = [];

    if (sessionId !== null) {
      if (getTutorSessionLearnerId(sessionId) !== learnerId) {
        throw new ApiRouteError("找不到指定的學伴對話", 404);
      }
      history = getTutorMessages(sessionId, 20);
    }

    // 課程索引（已發布課題及分節）：主題硬閘及教材依據共用，只需讀取一次。
    const curriculum = loadTutorCurriculumIndex();
    const isOnTopic =
      isHistoryTopicPrompt(body.message) ||
      matchesCurriculumTerms(curriculum, body.message) ||
      (history.length > 0 &&
        sessionId !== null &&
        isTutorSessionLastTurnOnTopic(sessionId) &&
        isShortHistoryFollowUp(body.message));
    if (!isOnTopic) {
      // 離題也要留痕（決策 2）：學生重新載入後仍看到自己問過甚麼及平台的引導句。
      // assistant 訊息標記 `off-topic`，因此不計每日額度，亦不會成為下一輪的模型上文。
      const createdAt = hongKongTimestamp();
      if (sessionId === null) sessionId = createTutorSession(learnerId, createdAt);
      setTutorSessionLastTurnOnTopic(sessionId, false);
      saveTutorMessage(sessionId, "user", body.message, createdAt);
      saveTutorMessage(sessionId, "assistant", TUTOR_OFF_TOPIC_REPLY, createdAt, 0, {
        groundingStatus: "off-topic",
      });
      return jsonOk({
        onTopic: false,
        reply: TUTOR_OFF_TOPIC_REPLY,
        sessionId,
        ...tutorDailyUsage(learnerId),
        dailyLimit: TUTOR_DAILY_LIMIT,
      });
    }

    const llm = getServerConfig().llm;
    if (
      llm.provider !== "deepseek" ||
      llm.apiKey === null ||
      llm.baseUrl === null ||
      llm.model === null
    ) {
      throw new ApiRouteError(
        "DeepSeek 服務尚未完成設定，請聯絡平台管理員（TUTOR_LLM_NOT_CONFIGURED）",
        503,
      );
    }
    let endpoint: string;
    try {
      endpoint = buildDeepSeekEndpoint(llm.baseUrl);
    } catch {
      throw new ApiRouteError(
        "DeepSeek 服務設定不完整，請聯絡平台管理員（TUTOR_LLM_NOT_CONFIGURED）",
        503,
      );
    }

    const usage = tutorDailyUsage(learnerId);
    if (usage.remaining <= 0) {
      if (sessionId !== null) setTutorSessionLastTurnOnTopic(sessionId, false);
      throw new ApiRouteError("你今日已達到歷史自學學伴提問上限（15 次），請於明日再試。", 429);
    }

    try {
      reserveAiOperation(learnerId, TUTOR_OPERATION_KIND);
    } catch (error) {
      if (sessionId !== null && error instanceof ApiRouteError && error.status === 429) {
        setTutorSessionLastTurnOnTopic(sessionId, false);
      }
      throw error;
    }
    const createdAt = hongKongTimestamp();
    if (sessionId === null) sessionId = createTutorSession(learnerId, createdAt);
    setTutorSessionLastTurnOnTopic(sessionId, true);
    saveTutorMessage(sessionId, "user", body.message, createdAt);

    // 教材依據：只使用已開放給學生的教材段落（見 services/tutor-grounding.ts）。
    // 找不到時仍會回答，但提示詞要求模型先說「我在教材片段中找不到這部分」，
    // 並禁止斷言課本「沒有提及」（模型只看得到片段，看不到整本課本）。
    // 上下文只包含「有回覆」的提問：失敗的提問不可令模型在下一輪一併回答（見 answeredTurnsOnly）。
    const promptHistory = answeredTurnsOnly(tutorTurnsForContext(history));
    const grounding = findTutorGrounding(
      body.message,
      promptHistory.filter((message) => message.role === "user").map((message) => message.content),
      curriculum,
    );
    const glossary = buildTutorGlossary(
      grounding.topicId,
      [body.message, ...grounding.passages.map((passage) => passage.promptText)].join("\n"),
    );

    const messages = [
      { role: "system", content: buildTutorSystemPrompt({ grounding, glossary }) },
      ...promptHistory,
      { role: "user", content: body.message },
    ];

    // 與 llm/chat-client.ts 一致的參數處理：思考模式不支援 temperature；DeepSeek 預設
    // 停用思考模式，若不傳送 thinking，API 會用預設值，思考用掉的 token 會佔盡
    // max_tokens，令回覆內容變成空白（TUTOR_LLM_EMPTY_RESPONSE）。
    const completionBody: Record<string, unknown> = {
      model: llm.model,
      messages,
      stream: true,
      max_tokens: Math.min(llm.maxTokens ?? 800, 1000),
    };
    if (llm.thinking !== "enabled") completionBody.temperature = 0.4;
    if (llm.thinking !== null) {
      completionBody.thinking = { type: llm.thinking };
      if (llm.thinking === "enabled" && llm.reasoningEffort !== null) {
        completionBody.reasoning_effort = llm.reasoningEffort;
      }
    }

    const openUpstream = async (): Promise<Response> => {
      try {
        return await fetch(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${llm.apiKey}`,
            "content-type": "application/json",
            accept: "text/event-stream",
          },
          body: JSON.stringify(completionBody),
          signal: AbortSignal.timeout(llm.requestTimeoutMs),
        });
      } catch {
        throw new ApiRouteError(
          "DeepSeek 服務暫時無法連線，請稍後再試（TUTOR_LLM_UNAVAILABLE）",
          503,
        );
      }
    };

    let upstream = await openUpstream();

    if (!upstream.ok || upstream.body === null) {
      throw new ApiRouteError(
        "DeepSeek 暫時未能處理你的問題，請稍後再試（TUTOR_LLM_UPSTREAM_ERROR）",
        503,
      );
    }

    const activeSessionId = sessionId;
    let streamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let cancelled = false;
    // 空白回應重試次數（沿用 LLM_EMPTY_RETRIES，與題目生成一致）
    const maxAttempts = 1 + Math.max(0, llm.emptyContentRetries ?? 0);
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // 先送出教材依據，令介面可以在文字陸續到達前顯示出處標示。
        if (!cancelled) {
          controller.enqueue(
            sseEvent("meta", {
              grounding: grounding.status,
              topicTitle: grounding.topicTitle,
              sources: grounding.sources,
            }),
          );
        }

        let completeAnswer = "";
        let sentAnyText = false;
        let failureMessage: string | null = null;

        /** 讀取一次上游串流；回傳 null 代表串流中斷或格式不正確 */
        const relay = async (response: Response): Promise<string | null> => {
          const reader = response.body!.getReader();
          streamReader = reader;
          const decoder = new TextDecoder();
          let pending = "";
          let streamFailed = false;
          let answer = "";

          const handleLine = (line: string) => {
            if (!line.startsWith("data:")) return;
            const data = line.slice(5).trim();
            if (data === "[DONE]") return;
            try {
              const delta = extractDelta(data);
              if (delta === null) return;
              answer += delta;
              if (delta.trim().length > 0) sentAnyText = true;
              if (!cancelled) controller.enqueue(sseEvent("delta", { text: delta }));
            } catch {
              streamFailed = true;
            }
          };

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              pending += decoder.decode(value, { stream: true });
              const lines = pending.split(/\r?\n/);
              pending = lines.pop() ?? "";
              for (const line of lines) handleLine(line);
              if (streamFailed) throw new Error("Invalid DeepSeek stream event");
            }
            pending += decoder.decode();
            if (pending.length > 0) handleLine(pending);
            if (streamFailed) throw new Error("Invalid DeepSeek stream event");
            return answer;
          } catch {
            return null;
          } finally {
            reader.releaseLock();
            streamReader = null;
          }
        };

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          const answer = await relay(upstream);
          if (answer === null) {
            failureMessage = "DeepSeek 串流中斷或格式不正確，請稍後重試（TUTOR_LLM_STREAM_ERROR）";
            break;
          }
          completeAnswer = answer;
          if (answer.trim().length > 0) break;

          // 空白回應：只有在完全沒有送出任何文字時才可重試（否則客戶端已看到部分內容）
          if (sentAnyText || attempt >= maxAttempts || cancelled) {
            failureMessage = "DeepSeek 回傳了空白回應，請稍後重試（TUTOR_LLM_EMPTY_RESPONSE）";
            break;
          }
          try {
            const retry = await openUpstream();
            if (!retry.ok || retry.body === null) {
              failureMessage =
                "DeepSeek 暫時未能處理你的問題，請稍後再試（TUTOR_LLM_UPSTREAM_ERROR）";
              break;
            }
            upstream = retry;
          } catch {
            failureMessage = "DeepSeek 服務暫時無法連線，請稍後再試（TUTOR_LLM_UNAVAILABLE）";
            break;
          }
        }

        if (failureMessage !== null) {
          if (!cancelled) controller.enqueue(sseEvent("error", { error: failureMessage }));
        } else {
          const termNotes = detectTermMismatches(completeAnswer);
          const hasQuestionSuggestions =
            parseTutorQuestionSuggestions(completeAnswer).suggestions.length >= 2;
          // 模型自己說「找不到教材依據」時，標示必須一致：不可同時顯示「已對照課本教材」。
          const declaresNotCovered = answerDeclaresNotCovered(completeAnswer);
          const finalStatus =
            hasQuestionSuggestions || declaresNotCovered ? "not-covered" : grounding.status;
          const finalSources =
            hasQuestionSuggestions || declaresNotCovered ? [] : grounding.sources;
          saveTutorMessage(activeSessionId, "assistant", completeAnswer, hongKongTimestamp(), 0, {
            sources: finalSources,
            groundingStatus: finalStatus,
            termNotes,
          });
          if (!cancelled) {
            controller.enqueue(
              sseEvent("done", {
                remaining: tutorDailyUsage(learnerId).remaining,
                termNotes,
                // 最終標示以回覆內容為準，令介面不會與答案自相矛盾
                grounding: finalStatus,
                sources: finalSources,
                topicTitle: finalStatus === "not-covered" ? null : grounding.topicTitle,
              }),
            );
          }
        }

        if (!cancelled) controller.close();
      },
      async cancel() {
        cancelled = true;
        await streamReader?.cancel();
      },
    });

    return new NextResponse(stream, {
      status: 200,
      headers: privateResponseHeaders({
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "private, no-store, no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        "x-tutor-session-id": activeSessionId,
        // 回覆完成前無法知道成敗，因此這裡只報「本次提問前」的剩餘；權威數字在 done 事件
        // 與 GET（每日 15 次只計已成功取得回覆的提問，見 tutorDailyUsage）。
        "x-tutor-remaining": String(Math.max(0, usage.remaining)),
      }),
    });
  });
}
