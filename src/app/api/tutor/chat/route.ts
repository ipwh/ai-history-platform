import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerConfig } from "@/server/config";
import {
  parseTutorQuestionSuggestions,
  type TutorQuestionCandidate,
} from "@/lib/tutor-question-suggestions";
import {
  createTutorSession,
  countTutorMessages,
  getTutorMessages,
  getTutorSessionContext,
  getTutorSessionLearnerId,
  saveTutorMessage,
  setTutorSessionPracticeContext,
  setTutorSessionTopicId,
  isTutorSessionLastTurnOnTopic,
  setTutorSessionLastTurnOnTopic,
  TUTOR_MESSAGE_WINDOW,
  type TutorMessage,
} from "@/server/repositories/tutor";
import { describeAiLimit, reserveAiOperation } from "@/server/services/ai-limits";
import {
  openChatStream,
  type OpenedChatStream,
  type StreamChatMessage,
} from "@/server/llm/stream-chat-completion";
import {
  answeredTurnsOnly,
  hongKongTimestamp,
  TUTOR_DAILY_LIMIT,
  TUTOR_OFF_TOPIC_REPLY,
  tutorDailyUsage,
  tutorTurnsForContext,
} from "@/server/services/tutor";
import {
  buildClarifyCandidates,
  isUnclearTutorQuery,
  normalizeTutorQuery,
  tutorQueryWasRewritten,
  TUTOR_QUERY_CLARIFY_REPLY,
} from "@/server/services/tutor-query";
import {
  answerDeclaresNotCovered,
  buildTutorGlossary,
  buildTutorSystemPrompt,
  detectTermMismatches,
  findTutorGrounding,
  loadTutorCurriculumIndex,
} from "@/server/services/tutor-grounding";
import { classifyTutorAnswerability } from "@/server/services/tutor-answerability";
import {
  collectTutorWebSupplement,
  type TutorWebSupplementResult,
} from "@/server/services/tutor-web-supplement";
import { expandTutorQuery } from "@/server/services/tutor-query-expansion";
import {
  describeTutorPracticeContextForPrompt,
  resolveTutorPracticeContext,
} from "@/server/services/tutor-practice-context";
import { recordTutorQueryEvent } from "@/server/repositories/tutor-events";
import { getTopic } from "@/server/repositories/topics";
import { getTutorTopicCard } from "@/server/services/tutor-topic-cards";
import { requireTutorLearnerId } from "@/server/services/tutor-request-access";
import {
  resolveTutorReplyDepth,
  tutorMaxSourcesForDepth,
} from "@/server/services/tutor-depth";
import {
  tutorDepthPreferenceSchema,
  type TutorPracticeContext,
  type TutorReplyDepth,
  type TutorWebSupplementStatus,
} from "@/lib/types";
import { ApiRouteError, handleRoute, jsonOk, parseJsonBody, privateResponseHeaders } from "@/server/http";

export const runtime = "nodejs";

/**
 * 學伴提問目前與「AI 出題」共用 `generation` 配額（MVP 決定，見 README「AI 用量上限」）。
 * 若日後要分開統計，應在 AiOperationKind 新增 `tutor` 並加設專屬上限，
 * 而不是在這裡自行寫入用量記錄（那會繞過全域時間窗檢查）。
 */
const TUTOR_OPERATION_KIND = "generation" as const;

/**
 * 提問請求。
 *
 * `practiceQuestionId`／`practiceSessionId` 只作**關聯**用途：伺服器會用它們
 * （配合工作階段推導的 learnerId）**重新**組裝學生安全上下文，
 * 並完全忽略前端可能夾帶的任何答案欄位（例如 correctAnswer、explanation）。
 * `goalTopicId` 是學生自選的溫習課題（soft prior），同樣會先驗證為已發布課題。
 */
const chatRequestSchema = z.object({
  message: z.string().trim().min(1, "請輸入問題").max(2000, "問題不可多於 2,000 字"),
  sessionId: z.string().trim().min(1).max(128).optional(),
  practiceQuestionId: z.string().trim().min(1).max(128).optional(),
  practiceSessionId: z.string().trim().min(1).max(128).optional(),
  goalTopicId: z.string().trim().min(1).max(128).nullable().optional(),
  /**
   * 學生自選的回覆深度（`auto` = 由平台按提問判斷）。
   *
   * 只影響提示詞結構及 token 上限，不影響教材依據、額度或安全規則；
   * 前端傳送無效值時一律當作 `auto`（舊版頁面或不正常請求不應因此無法提問）。
   */
  depth: tutorDepthPreferenceSchema.optional().catch("auto"),
});

/**
 * 各深度的回應長度上限。
 *
 * 精簡沿用原本的 1,000；進階／挑戰需要多段分析，若仍封頂在 1,000 會被中途截斷。
 * 仍然以 `LLM_MAX_TOKENS`（環境設定）為上限，避免超出服務商或成本設定。
 */
const MAX_TOKENS_BY_DEPTH: Record<TutorReplyDepth, number> = {
  standard: 1_000,
  advanced: 1_500,
  challenge: 2_000,
};

/**
 * 學伴存取守衛（已移至 `services/tutor-request-access.ts`，供所有學伴路由共用）。
 *
 * - 未登入 → 401。
 * - 教師／管理員 → 放行，供科組測試（2026-10-27 擁有者指示）。其對話記錄在
 *   `teacher:`／`admin:` learnerId 之下，與學生完全分開；每日 15 次及
 *   `generation` 時間窗配額與學生相同，毋須另設例外。
 * - 學生 → 必須已在名冊核對，否則 403（未核對即無法確認是本校學生）。
 */
const requireTutorAccess = requireTutorLearnerId;

function buildDeepSeekEndpoint(baseUrl: string): string {
  return new URL("chat/completions", `${baseUrl.replace(/\/+$/, "")}/`).toString();
}

function sseEvent(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * 澄清／離題等「不會呼叫主回答模型」的分支不做任何外網抓取（產品規則 P0），
 * 但仍要在回應中如實交代補充狀態，令介面及測試可以分辨「為甚麼沒有外部參考」。
 */
function webSupplementStatusWithoutFetch(): TutorWebSupplementStatus {
  const { webSupplement } = getServerConfig();
  return webSupplement.enabled && webSupplement.mode !== "off" ? "not-used" : "disabled";
}

/**
 * 記錄匿名事件（澄清／離題／正規化）。
 *
 * 永不影響請求：任何寫入錯誤都吞掉。記錄與每日額度及 AI 用量完全無關
 * （見 `repositories/tutor-events.ts` 的私隱設計說明）。
 */
function safeRecordTutorQueryEvent(input: {
  eventType: "reject" | "clarify" | "normalize";
  raw: string;
  normalized?: string | null;
  hadSession: boolean;
}): void {
  try {
    recordTutorQueryEvent(input);
  } catch {
    // 事件記錄是輔助資料，不可令學伴回覆失敗
  }
}

/**
 * 解析練習上下文；不可用時回傳 null 而不是拋錯。
 *
 * 學生可能是從練習頁按「問學伴」進來，該題亦可能已被下架；此時學伴應繼續正常
 * 回答（只是沒有練習上下文），而不是 404 令學生無法提問。
 */
function resolvePracticeContextSafely(input: {
  questionId: string;
  practiceSessionId?: string | null;
  learnerId: string;
}): TutorPracticeContext | null {
  try {
    return resolveTutorPracticeContext({
      questionId: input.questionId,
      sessionId: input.practiceSessionId ?? null,
      learnerId: input.learnerId,
    });
  } catch {
    return null;
  }
}

/** 練習上下文帶出的技能提示（M3）；沒有技能標籤就不顯示 */
function practiceSkillHint(context: TutorPracticeContext | null): string | null {
  if (context === null || context.skill === null || context.skill.trim().length === 0) return null;
  return `這題較常練習：${context.skill.trim()}`;
}

/**
 * 把課題卡的建議問題優先加入澄清候選（M2）。
 *
 * 卡片由科組預先撰寫，貼近學生實際困惑，因此排在自動產生的候選之前；
 * 只保留 4 個，避免把對話框變成選單。
 */
function withTopicCardQuestions(
  candidates: TutorQuestionCandidate[],
  topicId: string | null,
): TutorQuestionCandidate[] {
  const card = getTutorTopicCard(topicId);
  if (card === null || card.suggestedQuestions.length === 0) return candidates;
  const existing = new Set(candidates.map((candidate) => candidate.suggestedQuestion));
  const cardCandidates: TutorQuestionCandidate[] = [];
  card.suggestedQuestions.forEach((question, index) => {
    if (existing.has(question)) return;
    cardCandidates.push({
      id: `card-${card.topicId}-${index + 1}`,
      label: question.replace(/？$/, "").slice(0, 40),
      suggestedQuestion: question,
    });
  });
  if (cardCandidates.length === 0) return candidates;
  return [...cardCandidates, ...candidates].slice(0, 4);
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
    // 學習目標課題及練習上下文：用於重新載入後重建開場引導（只含學生安全欄位）
    const sessionContext = sessionId ? getTutorSessionContext(sessionId) : { topicId: null, practiceContext: null };
    return jsonOk({
      sessionId,
      messages,
      messageLimit: TUTOR_MESSAGE_WINDOW,
      messageCount,
      truncated: messageCount > messages.length,
      dailyLimit: TUTOR_DAILY_LIMIT,
      windowLimitReached,
      topicId: sessionContext.topicId,
      practiceContext: sessionContext.practiceContext,
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
    const normalizedMessage = normalizeTutorQuery(body.message);
    const hasValidHistoryContext =
      history.length > 0 &&
      sessionId !== null &&
      isTutorSessionLastTurnOnTopic(sessionId);

    // 傳入**原文**：`isUnclearTutorQuery` 內部會自行正規化，而英文疑問詞
    // （"Who was Hitler?"）需要原文的空格才判斷得到（正規化會把空格去掉，
    // 變成無法分詞的 "whowashitler"）。中文的判斷結果不受影響（2026-11-02）。
    const unclear = isUnclearTutorQuery(
      body.message,
      curriculum,
      hasValidHistoryContext,
    );
    const promptHistory = answeredTurnsOnly(tutorTurnsForContext(history));
    const groundingContext = promptHistory
      .filter((message) => message.role === "user")
      .map((message) => normalizeTutorQuery(message.content));

    // 回覆深度（2026-11-06）：`auto` 按提問的認知要求判斷，短追問則沿用上一輪深度，
    // 免得學生剛開始的深入討論因為一句「點解？」而掉回精簡結構。
    const previousReplyDepth =
      [...history].reverse().find((message) => message.role === "assistant")?.replyDepth ?? null;
    const replyDepth = resolveTutorReplyDepth(
      body.depth ?? "auto",
      body.message,
      previousReplyDepth,
    );

    // ── 學習目標、練習上下文（M4／P0）──────────────────────────────────
    // 學習目標課題只接受**已發布**課題；不存在或未發布一律當作沒有設定。
    const goalTopic = body.goalTopicId ? getTopic(body.goalTopicId) : null;
    const goalTopicId = goalTopic !== null && goalTopic.published ? goalTopic.id : null;
    // 練習上下文一律由伺服器重新組裝：請求只提供 questionId／sessionId，
    // 前端夾帶的 correctAnswer、explanation 等欄位完全不會被讀取。
    const practiceContext =
      body.practiceQuestionId === undefined
        ? null
        : resolvePracticeContextSafely({
            questionId: body.practiceQuestionId,
            practiceSessionId: body.practiceSessionId ?? null,
            learnerId,
          });
    const storedSessionContext =
      sessionId !== null ? getTutorSessionContext(sessionId) : { topicId: null, practiceContext: null };
    // soft prior 次序：學生本次設定的學習目標 → 練習題所屬課題 → 對話已保存的課題
    const preferredTopicId =
      goalTopicId ?? practiceContext?.topicId ?? storedSessionContext.topicId ?? null;
    const effectivePracticeContext = practiceContext ?? storedSessionContext.practiceContext;

    const attachSessionContext = (id: string): void => {
      if (practiceContext !== null) setTutorSessionPracticeContext(id, practiceContext);
      if (goalTopicId !== null) setTutorSessionTopicId(id, goalTopicId);
    };

    // 正規化有實際改寫 → 記錄匿名事件（供每月補強規則；不含身分、不扣額度）。
    // 只統一標點／大小寫的差異不算改寫，否則事件表會被無價值的樣本淹沒。
    if (tutorQueryWasRewritten(body.message, normalizedMessage)) {
      safeRecordTutorQueryEvent({
        eventType: "normalize",
        raw: body.message,
        normalized: normalizedMessage,
        hadSession: sessionId !== null,
      });
    }

    // ── 可答性與證據政策（Sprint 29）──────────────────────────────────
    // 檢索成敗不再直接等於「是否回答」：先取教材依據，再按可答性狀態決定
    // 澄清／離題引導／以教材回答／以一般歷史知識作答並標明（見
    // services/tutor-answerability.ts）。這一步只是本地判斷，沒有額外模型請求。
    let grounding = findTutorGrounding(normalizedMessage, groundingContext, curriculum, {
      preferredTopicId,
      maxSources: tutorMaxSourcesForDepth(replyDepth),
    });
    const answerability = classifyTutorAnswerability({
      message: body.message,
      curriculum,
      grounding,
      hasHistoryContext: hasValidHistoryContext,
      unclear,
    });

    // 真正無法判斷（含只有代詞、沒有上文）→ 只問一條澄清問題並提供可選方向。
    if (answerability.state === "D-needs-clarification") {
      const clarifyTopicId = grounding.topicId ?? preferredTopicId;
      safeRecordTutorQueryEvent({
        eventType: "clarify",
        raw: body.message,
        hadSession: sessionId !== null,
      });
      return jsonOk({
        clarify: true,
        reply: TUTOR_QUERY_CLARIFY_REPLY,
        candidates: withTopicCardQuestions(
          buildClarifyCandidates(
            body.message,
            groundingContext,
            curriculum,
            clarifyTopicId,
          ),
          clarifyTopicId,
        ),
        sessionId,
        topicId: clarifyTopicId,
        webSources: [],
        webSupplementStatus: webSupplementStatusWithoutFetch(),
        ...tutorDailyUsage(learnerId),
        dailyLimit: TUTOR_DAILY_LIMIT,
      });
    }

    // 明確不是歷史提問 → 沿用固定引導句（不呼叫模型，不計額度）。
    if (answerability.state === "out-of-scope") {
      // 離題也要留痕（決策 2）：學生重新載入後仍看到自己問過甚麼及平台的引導句。
      // assistant 訊息標記 `off-topic`，因此不計每日額度，亦不會成為下一輪的模型上文。
      const createdAt = hongKongTimestamp();
      if (sessionId === null) {
        sessionId = createTutorSession(learnerId, createdAt, {
          topicId: preferredTopicId,
          practiceContext,
        });
      } else {
        attachSessionContext(sessionId);
      }
      setTutorSessionLastTurnOnTopic(sessionId, false);
      saveTutorMessage(sessionId, "user", body.message, createdAt);
      saveTutorMessage(sessionId, "assistant", TUTOR_OFF_TOPIC_REPLY, createdAt, 0, {
        groundingStatus: "off-topic",
      });
      safeRecordTutorQueryEvent({
        eventType: "reject",
        raw: body.message,
        hadSession: true,
      });
      return jsonOk({
        onTopic: false,
        reply: TUTOR_OFF_TOPIC_REPLY,
        sessionId,
        webSources: [],
        webSupplementStatus: webSupplementStatusWithoutFetch(),
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
    if (sessionId === null) {
      sessionId = createTutorSession(learnerId, createdAt, {
        topicId: preferredTopicId,
        practiceContext,
      });
    } else {
      attachSessionContext(sessionId);
    }
    setTutorSessionLastTurnOnTopic(sessionId, true);
    saveTutorMessage(sessionId, "user", body.message, createdAt);

    // 語意改寫（2026-11-02）：只在字詞檢索**已確定**找不到教材時，才請模型把學生用語
    // 改寫成教材用語並重試檢索。正常提問零額外請求、零額外延遲；失敗提問最多多等
    // budgetMs（預設 2.5 秒），逾時即放棄並保留「未找到教材依據」。
    // 這是同一次提問的內部步驟，不另計每日額度（額度已在上方以 reserveAiOperation 預留）。
    if (grounding.status === "not-covered") {
      const expansion = await expandTutorQuery({
        message: normalizedMessage,
        topicTitle:
          grounding.topicTitle ?? (goalTopic?.published === true ? goalTopic.title : null),
        topicId: grounding.topicId ?? preferredTopicId,
        config: getServerConfig().tutorQueryExpansion,
        llm: { provider: llm.provider, apiKey: llm.apiKey, baseUrl: llm.baseUrl, model: llm.model },
      });
      if (expansion.terms.length > 0) {
        const expanded = findTutorGrounding(normalizedMessage, groundingContext, curriculum, {
          preferredTopicId,
          extraTerms: expansion.terms,
          maxSources: tutorMaxSourcesForDepth(replyDepth),
        });
        if (expanded.status === "grounded") grounding = expanded;
      }
    }

    // 外部參考（白名單網頁補充）：只在日額及 generation 預留**之後**才執行——它是為
    // 即將呼叫的主回答服務，不是獨立的 AI 操作，因此不另計次數、不改動每日額度。
    // 預設關閉時立即回傳 disabled，零外網請求；澄清／離題路徑已在上方返回，所以永遠
    // 不會為澄清句單獨抓網。整體預算 TUTOR_WEB_BUDGET_MS（預設 1.5 秒）用完即放棄，
    // 不會把主回答的首字推遲到使用者以為當機。
    const webSupplement: TutorWebSupplementResult = await collectTutorWebSupplement({
      query: body.message,
      topicId: grounding.topicId ?? preferredTopicId,
      /**
       * 「教材命中但關鍵詞缺口」視同未涵蓋（2026-11-06）。
       *
       * 實際個案：「法國為何參與了美國革命？」命中了課題7 三段教材（都只講美國革命的
       * 背景），但三段都沒有「法國」，答案其實沒有依據。`not-covered-only` 若只看
       * `status`，這類問題會剛好最需要外部參考時反而不抓網。
       */
      grounding:
        grounding.status === "grounded" && (grounding.uncoveredTerms ?? []).length === 0
          ? "grounded"
          : "not-covered",
      config: getServerConfig().webSupplement,
    });

    // 教材依據：只使用已開放給學生的教材段落（見 services/tutor-grounding.ts）。
    // 找不到時仍會回答，但提示詞要求模型先說「我在教材片段中找不到這部分」，
    // 並禁止斷言課本「沒有提及」（模型只看得到片段，看不到整本課本）。
    // 上下文只包含「有回覆」的提問：失敗的提問不可令模型在下一輪一併回答（見 answeredTurnsOnly）。
    const glossary = buildTutorGlossary(
      grounding.topicId,
      [body.message, ...grounding.passages.map((passage) => passage.promptText)].join("\n"),
    );

    const messages: StreamChatMessage[] = [
      {
        role: "system",
        content: buildTutorSystemPrompt({
          grounding,
          glossary,
          webSources: webSupplement.promptSources,
          practiceContextBlock:
            effectivePracticeContext === null
              ? null
              : describeTutorPracticeContextForPrompt(effectivePracticeContext),
          goalTopicTitle: goalTopic?.published === true ? goalTopic.title : null,
          depth: replyDepth,
          answerability,
        }),
      },
      ...promptHistory,
      { role: "user", content: body.message },
    ];

    // 與 llm/chat-client.ts 一致的參數處理：思考模式不支援 temperature；DeepSeek 預設
    // 停用思考模式，若不傳送 thinking，API 會用預設值，思考用掉的 token 會佔盡
    // max_tokens，令回覆內容變成空白（TUTOR_LLM_EMPTY_RESPONSE）。
    // 與 llm/chat-client.ts 一致的參數處理：思考模式不支援 temperature；DeepSeek 預設
    // 停用思考模式，若不傳送 thinking，API 會用預設值，思考用掉的 token 會佔盡
    // max_tokens，令回覆內容變成空白（TUTOR_LLM_EMPTY_RESPONSE）。
    //
    // Sprint 33：請求組裝、連線（含逾時）、SSE 解析及錯誤分類已抽到
    // llm/stream-chat-completion.ts，令受控評估與正式 route 共用同一條呼叫路徑
    // （不另寫 ad-hoc fetch）。每次嘗試仍然只發出**一個**請求。
    const requestOptions = {
      endpoint,
      apiKey: llm.apiKey,
      model: llm.model,
      messages,
      maxTokens: Math.min(
        llm.maxTokens ?? MAX_TOKENS_BY_DEPTH[replyDepth],
        MAX_TOKENS_BY_DEPTH[replyDepth],
      ),
      thinking: llm.thinking,
      reasoningEffort: llm.reasoningEffort,
      temperature: 0.4,
      timeoutMs: llm.requestTimeoutMs,
    } as const;

    // 先開啟上游連線並檢查 HTTP 狀態：供應商 5xx／無法連線時，必須在**開始串流之前**
    // 以 503 回報（既有行為，Sprint 33 回歸測試要求保留），不可先回 200 才送錯誤事件。
    const openUpstream = async (): Promise<OpenedChatStream> => {
      // 把 route 的 AbortController 一併傳入：學生關掉分頁時要真的中止上游請求
      // （Sprint 34；否則伺服器會繼續讀完整個回應並繼續計費）。
      const opened = await openChatStream({ ...requestOptions, signal: upstreamAbort.signal });
      if (opened.kind === "error") {
        if (opened.errorCode === "network" || opened.errorCode === "timeout" || opened.errorCode === "aborted") {
          throw new ApiRouteError(
            "DeepSeek 服務暫時無法連線，請稍後再試（TUTOR_LLM_UNAVAILABLE）",
            503,
          );
        }
        if (opened.errorCode === "missing-api-key") {
          throw new ApiRouteError(
            "DeepSeek 服務尚未完成設定，請聯絡平台管理員（TUTOR_LLM_NOT_CONFIGURED）",
            503,
          );
        }
        throw new ApiRouteError(
          "DeepSeek 暫時未能處理你的問題，請稍後再試（TUTOR_LLM_UPSTREAM_ERROR）",
          503,
        );
      }
      return opened;
    };

    const activeSessionId = sessionId;
    let cancelled = false;
    // 客戶端斷線時中止上游請求（保留原本 streamReader.cancel() 的行為）
    const upstreamAbort = new AbortController();
    let upstream = await openUpstream();
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
              webSources: webSupplement.sources,
              webSupplementStatus: webSupplement.status,
              skillHint: practiceSkillHint(effectivePracticeContext),
              depth: replyDepth,
            }),
          );
        }

        let completeAnswer = "";
        let sentAnyText = false;
        let failureMessage: string | null = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          const result = await upstream.consume({
            signal: upstreamAbort.signal,
            onDelta: (delta: string) => {
              if (delta.trim().length > 0) sentAnyText = true;
              if (!cancelled) controller.enqueue(sseEvent("delta", { text: delta }));
            },
          });

          if (result.ok) {
            completeAnswer = result.text;
            break;
          }

          if (result.errorCode === "invalid-response" || result.errorCode === "aborted") {
            failureMessage =
              "DeepSeek 串流中斷或格式不正確，請稍後重試（TUTOR_LLM_STREAM_ERROR）";
            break;
          }
          if (result.errorCode === "timeout" || result.errorCode === "network") {
            failureMessage = "DeepSeek 服務暫時無法連線，請稍後再試（TUTOR_LLM_UNAVAILABLE）";
            break;
          }
          if (result.errorCode === "rate-limited" || result.errorCode === "server-error") {
            failureMessage =
              "DeepSeek 暫時未能處理你的問題，請稍後再試（TUTOR_LLM_UPSTREAM_ERROR）";
            break;
          }

          // 空白回應：只有在完全沒有送出任何文字時才可重試（否則客戶端已看到部分內容）
          if (sentAnyText || attempt >= maxAttempts || cancelled) {
            failureMessage = "DeepSeek 回傳了空白回應，請稍後重試（TUTOR_LLM_EMPTY_RESPONSE）";
            break;
          }
          try {
            upstream = await openUpstream();
          } catch {
            failureMessage =
              "DeepSeek 暫時未能處理你的問題，請稍後再試（TUTOR_LLM_UPSTREAM_ERROR）";
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
            webSources: webSupplement.sources,
            webSupplementStatus: webSupplement.status,
            replyDepth,
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
                // 外部參考與教材依據是兩條軌道：模型說「教材找不到」不會令已抓取的
                // 外部參考消失，也不會令它變成課本說法。
                webSources: webSupplement.sources,
                webSupplementStatus: webSupplement.status,
                // 技能提示（M3）：只在有練習上下文且題目有技能標籤時出現
                skillHint: practiceSkillHint(effectivePracticeContext),
                // 回覆深度：介面據此標示「進階分析」「挑戰・史觀」
                depth: replyDepth,
                practiceQuestionId: effectivePracticeContext?.questionId ?? null,
              }),
            );
          }
        }

        if (!cancelled) controller.close();
      },
      async cancel() {
        cancelled = true;
        upstreamAbort.abort();
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
