"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import type {
  TopicOverview,
  TutorDepthPreference,
  TutorGroundingStatus,
  TutorPracticeContext,
  TutorReplyDepth,
  TutorSource,
  TutorTermNote,
  TutorWebSource,
} from "@/lib/types";
import {
  parseTutorQuestionSuggestions,
  type TutorQuestionCandidate,
} from "@/lib/tutor-question-suggestions";

interface TutorMessage {
  role: "user" | "assistant";
  content: string;
  /** 回覆所依據的教材出處（由伺服器提供，重新載入對話後仍然存在） */
  sources?: TutorSource[];
  grounding?: TutorGroundingStatus;
  topicTitle?: string | null;
  termNotes?: TutorTermNote[];
  /** 🌐 白名單網站的外部參考（非課本・非考試標準），與教材出處分開顯示 */
  webSources?: TutorWebSource[];
  candidates?: TutorQuestionCandidate[];
  /** 該則回覆的深度（非 `standard` 時在氣泡上方標示） */
  depth?: TutorReplyDepth;
}

interface TutorState {
  remaining: number;
  dailyLimit: number;
}

/**
 * 由練習進入時的開場引導。
 *
 * 這是**平台**的說明，不是學生或模型的對話，因此不寫入資料庫、也不呼叫模型：
 * 它只把「我們會針對哪條練習／哪個課題討論」講清楚，並列出 1–3 個引導問題。
 * 內容全部來自 `/api/tutor/practice-context`（學生安全欄位），不含任何答案。
 */
interface TutorOpening {
  topicTitle: string;
  stemSummary: string;
  skillHint: string | null;
  suggestions: string[];
}

/** 伺服器回傳的訊息格式（`GET /api/tutor/chat`） */
interface TutorWireMessage {
  role: "user" | "assistant";
  content: string;
  sources?: TutorSource[];
  groundingStatus?: TutorGroundingStatus;
  termNotes?: TutorTermNote[];
  webSources?: TutorWebSource[];
  replyDepth?: TutorReplyDepth;
}

function toTutorMessage(message: TutorWireMessage): TutorMessage {
  return {
    role: message.role,
    content: message.content,
    sources: message.sources ?? [],
    grounding: message.groundingStatus ?? "none",
    termNotes: message.termNotes ?? [],
    webSources: message.webSources ?? [],
    depth: message.replyDepth ?? "standard",
  };
}

const SESSION_STORAGE_KEY = "history-tutor-session";
/** 回覆深度偏好（本機保存：屬顯示偏好，不需要伺服器端設定） */
const DEPTH_STORAGE_KEY = "history-tutor-depth";

const DEPTH_OPTIONS: { value: TutorDepthPreference; label: string; hint: string }[] = [
  { value: "auto", label: "自動（按提問判斷）", hint: "平台會按提問要求自動選擇深度" },
  { value: "standard", label: "精簡", hint: "四段短結構：定位、線索、依據、下一步" },
  { value: "advanced", label: "進階分析", hint: "分析框架、張力與反駁、挑戰問題" },
  { value: "challenge", label: "挑戰・史觀", hint: "問題拆解、立場光譜、判斷準則、挑戰任務" },
];

/** 回覆氣泡上方顯示的深度標籤（`standard` 不顯示，避免每則回覆都多一個標籤） */
function depthLabel(depth: TutorReplyDepth | undefined): string | null {
  if (depth === undefined || depth === "standard") return null;
  return DEPTH_OPTIONS.find((option) => option.value === depth)?.label ?? null;
}
const DISCLAIMER =
  "⚠️ 內容由 AI 輔助生成，僅供課後複習參考。標示「已對照課本教材」的回覆會列出教材節錄及出處可供核對；標示「未找到教材依據」的部分屬補充，不是課本說法；標示「外部參考」的是白名單網站的短摘錄，不是課本亦不是考試標準。正式史實與作答標準請以課本及科任老師教授為準。";

function readStoredSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function readStoredDepth(): TutorDepthPreference {
  try {
    const stored = window.localStorage.getItem(DEPTH_STORAGE_KEY);
    return DEPTH_OPTIONS.some((option) => option.value === stored)
      ? (stored as TutorDepthPreference)
      : "auto";
  } catch {
    return "auto";
  }
}

/** 同一頁面內改動 localStorage 不會觸發 storage 事件，因此自行派發通知 */
const DEPTH_STORAGE_EVENT = "hk-history-tutor-depth";

function subscribeDepth(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(DEPTH_STORAGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(DEPTH_STORAGE_EVENT, onChange);
  };
}

function writeStoredDepth(value: TutorDepthPreference): void {
  try {
    window.localStorage.setItem(DEPTH_STORAGE_KEY, value);
    window.dispatchEvent(new Event(DEPTH_STORAGE_EVENT));
  } catch {
    // 未能保存時只是下次回到「自動」，不影響本次提問
  }
}

function inlineMarkdown(text: string) {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function TutorMarkdown({ content }: { content: string }) {
  return (
    <div className="space-y-2 whitespace-pre-wrap break-words">
      {content.split(/\r?\n/).map((line, index) => {
        if (/^\s*[-*]\s+/.test(line)) {
          return (
            <div key={index} className="flex gap-2 pl-1">
              <span aria-hidden="true">•</span>
              <span>{inlineMarkdown(line.replace(/^\s*[-*]\s+/, ""))}</span>
            </div>
          );
        }
        if (/^\s*>\s?/.test(line)) {
          return (
            <blockquote
              key={index}
              className="border-l-2 pl-3 text-gray-600"
              style={{ borderColor: "var(--border-strong)" }}
            >
              {inlineMarkdown(line.replace(/^\s*>\s?/, ""))}
            </blockquote>
          );
        }
        return <p key={index}>{line.length > 0 ? inlineMarkdown(line) : "\u00a0"}</p>;
      })}
    </div>
  );
}

/**
 * 教材依據標示。
 *
 * 三種狀態直接對應學生要做的判斷：這句可否照背（已對照課本）、這只是補充
 * （課本未涵蓋）、用字是否要跟課本（用語對照）。
 *
 * 🌐 外部參考另成一段，永遠與 📖 教材出處分開列出：學生要一眼看得出哪些內容
 * 有課本依據、哪些只是課外延伸。
 */
function TutorEvidence({ message }: { message: TutorMessage }) {
  // 只顯示真正有內容的出處：若資料殘缺，寧可顯示一句說明，也不要留下一列空白項目
  const sources = (message.sources ?? []).filter(
    (source) => source.excerpt.trim().length > 0 || source.location.trim().length > 0,
  );
  const webSources = (message.webSources ?? []).filter(
    (source) => source.url.trim().length > 0,
  );
  const termNotes = message.termNotes ?? [];
  const grounded = message.grounding === "grounded";
  const notCovered = message.grounding === "not-covered";
  if (!grounded && !notCovered && termNotes.length === 0 && webSources.length === 0) return null;

  return (
    <div
      className="mt-3 space-y-2 border-t pt-2"
      style={{ borderColor: "var(--border-strong)" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {grounded ? (
          <span className="badge badge-success">✅ 已對照課本教材（{sources.length} 段）</span>
        ) : null}
        {notCovered ? (
          <span className="badge badge-warning">➕ 未找到教材依據（屬補充，非課本說法）</span>
        ) : null}
        {message.topicTitle ? (
          <span className="text-xs text-gray-500">{message.topicTitle}</span>
        ) : null}
      </div>
      {sources.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-600">查看教材節錄及出處</summary>
          <ul className="mt-2 space-y-2">
            {sources.map((source, index) => (
              <li
                key={`${source.blockId}-${index}`}
                className="rounded-lg bg-white px-3 py-2"
                style={{ border: "1px solid var(--border-strong)" }}
              >
                <p className="text-xs font-semibold text-gray-500">
                  {source.documentLabel.length > 0
                    ? `${source.documentLabel}${source.location.length > 0 ? ` · ${source.location}` : ""}`
                    : source.location.length > 0
                      ? source.location
                      : "教材段落"}
                </p>
                <p className="mt-1 text-gray-700">「{source.excerpt}」</p>
              </li>
            ))}
          </ul>
        </details>
      ) : grounded ? (
        <p className="text-xs text-gray-500">
          未能顯示教材出處，請重新載入頁面再試；如持續出現請通知老師。
        </p>
      ) : null}
      {termNotes.length > 0 ? (
        <ul className="space-y-1 text-xs text-gray-600">
          {termNotes.map((note) => (
            <li key={note.canonical}>
              📖 課本用語：<strong>{note.canonical}</strong>（回覆用了「{note.used}」）
            </li>
          ))}
        </ul>
      ) : null}
      {webSources.length > 0 ? (
        <div
          className="rounded-lg px-3 py-2 text-sm"
          style={{ background: "var(--accent-soft)", border: "1px solid #c6d6ff" }}
          aria-label="外部參考（非課本・非考試標準）"
        >
          <p className="text-xs font-semibold">🌐 外部參考（非課本・非考試標準）</p>
          <ul className="mt-2 space-y-2">
            {webSources.map((source, index) => (
              <li key={`${source.url}-${index}`}>
                <a
                  className="font-semibold underline"
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {source.title.trim().length > 0 ? source.title : source.url}
                </a>
                {source.siteLabel.trim().length > 0 ? (
                  <span className="ml-2 text-xs text-gray-600">{source.siteLabel}</span>
                ) : null}
                {source.excerpt.trim().length > 0 ? (
                  <p className="mt-1 text-xs text-gray-700">「{source.excerpt}」</p>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-600">
            外部網站內容僅供課後擴充，可能與課本表述不同；不可當作考試或評分標準。
          </p>
        </div>
      ) : null}
    </div>
  );
}

function responseError(payload: unknown, status: number): string {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const message = (payload as { error?: unknown }).error;
    if (typeof message === "string") return message;
  }
  return `請求失敗（HTTP ${status}）`;
}

export function TutorView({
  staffPreview = false,
  backHref,
}: {
  /** 教師／管理員測試身分：顯示標示，提醒記錄屬於教職員帳戶 */
  staffPreview?: boolean;
  /** 教職員返回後台的連結（學生不會渲染） */
  backHref?: string;
}) {
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(readStoredSessionId);
  const initialSessionId = useRef(sessionId);
  const [quota, setQuota] = useState<TutorState>({ remaining: 15, dailyLimit: 15 });
  const [windowLimitReached, setWindowLimitReached] = useState(false);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncation, setTruncation] = useState<{ shown: number; total: number } | null>(null);
  /** 練習開場引導（本機顯示，不入資料庫） */
  const [opening, setOpening] = useState<TutorOpening | null>(null);
  /** 學習目標課題（M4）：soft prior，只用於檢索及澄清排序 */
  const [goalTopicId, setGoalTopicId] = useState<string>("");
  const [goalTopics, setGoalTopics] = useState<{ id: string; title: string }[]>([]);
  /**
   * 回覆深度偏好（2026-11-06）：以 `useSyncExternalStore` 讀取瀏覽器設定，
   * 伺服器快照一律為 `auto`，避免 hydration 不一致（與 HomeView 的做法一致）。
   */
  const depth = useSyncExternalStore<TutorDepthPreference>(
    subscribeDepth,
    readStoredDepth,
    () => "auto",
  );
  /** 練習關聯（只作關聯用；伺服器會重新組裝安全上下文） */
  const practiceLink = useRef<{ questionId: string; sessionId: string | null } | null>(null);
  /** 最近一次回覆的技能提示（M3） */
  const [skillHint, setSkillHint] = useState<string | null>(null);
  /** 最近一次回覆的外部參考狀態（用於如實顯示「本回合未取得外部參考」） */
  const [webStatus, setWebStatus] = useState<string | null>(null);

  /**
   * 練習 → 學伴：讀取網址上的 questionId／sessionId，向伺服器換取安全上下文。
   *
   * 只接受 `from=practice`；失敗（404／403／網絡）時靜默略過——學生仍然可以正常
   * 提問，只是沒有開場引導，不會因為一條已下架的題目而卡在錯誤畫面。
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("from") !== "practice") return;
    const questionId = params.get("questionId");
    if (questionId === null || questionId.length === 0) return;
    const practiceSessionId = params.get("sessionId");
    practiceLink.current = { questionId, sessionId: practiceSessionId };
    void (async () => {
      try {
        const query = new URLSearchParams({ questionId });
        if (practiceSessionId !== null) query.set("sessionId", practiceSessionId);
        const response = await fetch(`/api/tutor/practice-context?${query.toString()}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          practiceContext?: TutorPracticeContext;
          skillHint?: string | null;
        };
        const context = payload.practiceContext;
        if (!context) return;
        setOpening({
          topicTitle: context.topicTitle,
          stemSummary: context.stemSummary,
          skillHint: payload.skillHint ?? null,
          suggestions: context.suggestedQuestions,
        });
      } catch {
        // 練習上下文只是開場輔助，讀不到就照常讓學生提問
      }
    })();
  }, []);

  /** 學習目標課題清單（只用已發布課題） */
  useEffect(() => {
    let cancelled = false;
    fetch("/api/topics?publishedOnly=true", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { topics?: TopicOverview[] } | null) => {
        if (cancelled || !payload?.topics) return;
        setGoalTopics(
          payload.topics.map((topic) => ({ id: topic.id, title: topic.title })),
        );
      })
      .catch(() => {
        // 課題清單讀不到時只是沒有下拉選單，不影響提問
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const storedSession = initialSessionId.current;
    const query = storedSession ? `?sessionId=${encodeURIComponent(storedSession)}` : "";
    void (async () => {
      let response = await fetch(`/api/tutor/chat${query}`, { cache: "no-store" });
      if (response.status === 404 && storedSession) {
        try {
          window.localStorage.removeItem(SESSION_STORAGE_KEY);
        } catch {
          // A stale session must not prevent starting a new conversation.
        }
        setSessionId(null);
        response = await fetch("/api/tutor/chat", { cache: "no-store" });
      }
      const payload = (await response.json()) as {
          error?: string;
          messages?: TutorWireMessage[];
          remaining?: number;
          dailyLimit?: number;
          windowLimitReached?: boolean;
          truncated?: boolean;
          messageCount?: number;
          topicId?: string | null;
          practiceContext?: TutorPracticeContext | null;
      };
      if (!response.ok) throw new Error(responseError(payload, response.status));
      setMessages((payload.messages ?? []).map(toTutorMessage));
      // 長對話只回最近 N 則：如實提示，不要讓學生以為紀錄消失了
      setTruncation(
        payload.truncated === true && typeof payload.messageCount === "number"
          ? { shown: (payload.messages ?? []).length, total: payload.messageCount }
          : null,
      );
      setQuota({
        remaining: payload.remaining ?? 0,
        dailyLimit: payload.dailyLimit ?? 15,
      });
      setWindowLimitReached(payload.windowLimitReached === true);
      // 學習目標課題：沿用對話已保存的設定（學生可隨時更改）
      if (typeof payload.topicId === "string") setGoalTopicId(payload.topicId);
      // 重新載入後重建練習開場（網址沒有 from=practice 時，用對話保存的上下文）
      if (payload.practiceContext) {
        const context = payload.practiceContext;
        setOpening((current) =>
          current !== null
            ? current
            : {
                topicTitle: context.topicTitle,
                stemSummary: context.stemSummary,
                skillHint:
                  context.skill === null ? null : `這題較常練習：${context.skill}`,
                suggestions: context.suggestedQuestions,
              },
        );
      }
    })()
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "未能載入學伴對話，請稍後再試。");
      })
      .finally(() => setLoading(false));
  }, []);

  /**
   * 開始新對話。
   *
   * 只在本機忘掉工作階段：舊對話仍留在資料庫（教師可在學習紀錄查看），但不再顯示、
   * 亦不會再被當成上下文。下一次傳送會由伺服器建立新的 `tutor_sessions` 記錄。
   * 每日提問次數屬於學生帳戶，不受影響。
   */
  function startNewConversation() {
    if (sending || loading) return;
    if (
      messages.length > 0 &&
      !window.confirm("開始新對話？目前畫面上的對話會保留在學習紀錄，但不再顯示。")
    ) {
      return;
    }
    setSessionId(null);
    setMessages([]);
    setError(null);
    setInput("");
    setTruncation(null);
    // 新對話同時清掉練習開場及學習目標：否則之後每一輪都會繼續帶舊題目的上下文。
    setOpening(null);
    setSkillHint(null);
    setWebStatus(null);
    setGoalTopicId("");
    practiceLink.current = null;
    if (typeof window !== "undefined") {
      // 網址上的 from=practice 只對「今次」有效，重新開始對話時一併移除
      window.history.replaceState(null, "", "/tutor");
    }
    try {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // 未能清除時，重新載入頁面才會回到舊對話；本次仍然可以開始新對話。
    }
  }

  async function submitMessage(message: string) {
    if (message.length === 0 || sending || quota.remaining <= 0) return;

    setInput("");
    setError(null);
    setMessages((current) => [...current, { role: "user", content: message }]);
    setSending(true);

    try {
      const response = await fetch("/api/tutor/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message,
          ...(sessionId ? { sessionId } : {}),
          ...(goalTopicId.length > 0 ? { goalTopicId } : {}),
          ...(depth !== "auto" ? { depth } : {}),
          // 只帶關聯 ID；伺服器會自行重組安全上下文，前端不會傳任何答案欄位。
          ...(practiceLink.current
            ? {
                practiceQuestionId: practiceLink.current.questionId,
                ...(practiceLink.current.sessionId
                  ? { practiceSessionId: practiceLink.current.sessionId }
                  : {}),
              }
            : {}),
        }),
      });

      if (!response.ok) {
        const payload: unknown = await response.json();
        if (response.status === 429) {
          setWindowLimitReached(true);
          if (
            typeof payload === "object" &&
            payload !== null &&
            "error" in payload &&
            typeof payload.error === "string" &&
            payload.error.includes("今日已達到歷史自學學伴提問上限")
          ) {
            setQuota((current) => ({ ...current, remaining: 0 }));
          }
        }
        throw new Error(responseError(payload, response.status));
      }
      setWindowLimitReached(false);

      if (response.headers.get("content-type")?.includes("application/json")) {
        const payload = (await response.json()) as {
          reply: string;
          sessionId: string | null;
          remaining: number;
          dailyLimit: number;
          clarify?: boolean;
          candidates?: TutorQuestionCandidate[];
        };
        // 離題回覆（onTopic=false）也會在伺服器建立對話紀錄；必須沿用同一個 session，
        // 否則該輪離題對話在重新載入後會看不到（下一次提問會另開新對話）。
        if (payload.sessionId) {
          setSessionId(payload.sessionId);
          try {
            window.localStorage.setItem(SESSION_STORAGE_KEY, payload.sessionId);
          } catch {
            // 未能保存時仍可繼續本次對話，只是重新載入後會回到上一個工作階段。
          }
        }
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            content: payload.reply,
            ...(payload.clarify === true && Array.isArray(payload.candidates)
              ? { candidates: payload.candidates }
              : {}),
          },
        ]);
        setQuota({ remaining: payload.remaining, dailyLimit: payload.dailyLimit });
        return;
      }

      const nextSessionId = response.headers.get("x-tutor-session-id");
      if (nextSessionId) {
        setSessionId(nextSessionId);
        try {
          window.localStorage.setItem(SESSION_STORAGE_KEY, nextSessionId);
        } catch {
          // The current page can continue without retaining the session between visits.
        }
      }
      const remainingHeader = response.headers.get("x-tutor-remaining");
      if (remainingHeader !== null) {
        setQuota((current) => ({ ...current, remaining: Number(remainingHeader) }));
      }

      if (!response.body) throw new Error("伺服器沒有提供串流回應，請稍後再試。");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let event = "";

      /**
       * 更新（或建立）最後一則學伴訊息。
       *
       * `meta` 事件比第一段文字先到，所以這裡需要能在沒有內容時先建立氣泡，
       * 之後再逐段附加文字。
       */
      const updateAssistant = (
        patch: Partial<
          Pick<TutorMessage, "sources" | "grounding" | "topicTitle" | "termNotes" | "webSources">
        >,
        append = "",
      ) => {
        setMessages((current) => {
          const next = [...current];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = { ...last, ...patch, content: last.content + append };
          } else {
            next.push({ role: "assistant", content: append, ...patch });
          }
          return next;
        });
      };

      const handleSseLine = (line: string) => {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
          return;
        }
        if (!line.startsWith("data:")) return;
        const data = JSON.parse(line.slice(5).trim()) as {
          text?: string;
          error?: string;
          remaining?: number;
          grounding?: TutorGroundingStatus;
          topicTitle?: string | null;
          sources?: TutorSource[];
          termNotes?: TutorTermNote[];
          webSources?: TutorWebSource[];
          webSupplementStatus?: string;
          skillHint?: string | null;
          depth?: TutorReplyDepth;
        };
        if (event === "delta" && typeof data.text === "string") {
          updateAssistant({}, data.text);
        } else if (event === "meta") {
          updateAssistant({
            grounding: data.grounding ?? "none",
            topicTitle: typeof data.topicTitle === "string" ? data.topicTitle : null,
            sources: Array.isArray(data.sources) ? data.sources : [],
            ...(Array.isArray(data.webSources) ? { webSources: data.webSources } : {}),
            ...(data.depth !== undefined ? { depth: data.depth } : {}),
          });
          if (typeof data.skillHint === "string") setSkillHint(data.skillHint);
        } else if (event === "done") {
          if (typeof data.remaining === "number") {
            setQuota((current) => ({ ...current, remaining: data.remaining as number }));
          }
          if (typeof data.skillHint === "string") setSkillHint(data.skillHint);
          if (typeof data.webSupplementStatus === "string") setWebStatus(data.webSupplementStatus);
          updateAssistant({
            ...(Array.isArray(data.termNotes) ? { termNotes: data.termNotes } : {}),
            ...(data.grounding === "grounded" || data.grounding === "not-covered"
              ? { grounding: data.grounding }
              : {}),
            ...(Array.isArray(data.sources) ? { sources: data.sources } : {}),
            ...(Array.isArray(data.webSources) ? { webSources: data.webSources } : {}),
            ...(data.topicTitle !== undefined ? { topicTitle: data.topicTitle } : {}),
            ...(data.depth !== undefined ? { depth: data.depth } : {}),
          });
        } else if (event === "error") {
          throw new Error(data.error ?? "DeepSeek 串流發生錯誤，請稍後再試。");
        }
        event = "";
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) handleSseLine(line);
      }
      buffer += decoder.decode();
      if (buffer.length > 0) handleSseLine(buffer);
    } catch (cause) {
      // 串流開始時已先建立空白回覆（教材依據先到）；失敗時不可留下空白氣泡
      setMessages((current) => {
        const last = current[current.length - 1];
        if (last?.role === "assistant" && last.content.trim().length === 0) {
          return current.slice(0, -1);
        }
        return current;
      });
      setError(cause instanceof Error ? cause.message : "傳送失敗，請稍後再試。");
    } finally {
      setSending(false);
    }
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitMessage(input.trim());
  }

  function chooseQuestionSuggestion(question: string) {
    setInput(question);
    inputRef.current?.focus();
    inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const quotaExhausted = quota.remaining <= 0;
  const inputBlocked = quotaExhausted || windowLimitReached;

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">🏛️ 歷史科自學學伴 (Beta)</h1>
        <div className="flex flex-wrap items-center gap-2">
          <p className="badge badge-accent" aria-live="polite">
            今日剩餘提問次數：{quota.remaining} / {quota.dailyLimit}
          </p>
          <button
            type="button"
            className="btn"
            onClick={startNewConversation}
            disabled={loading || sending || messages.length === 0}
            title="清空畫面並開始新的對話（舊對話仍保留在學習紀錄）"
          >
            ＋ 新對話
          </button>
        </div>
      </header>

      {/*
        學習目標課題（M4）：只用作檢索的 soft prior。
        學生問到另一個課題的專名時，仍以當前的問題為準（見 tutor-grounding.ts）。
      */}
      {goalTopics.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="tutor-goal-topic" className="font-semibold">
            溫習課題（可選）
          </label>
          <select
            id="tutor-goal-topic"
            className="rounded-lg border bg-white px-2 py-1"
            style={{ borderColor: "var(--border-strong)" }}
            value={goalTopicId}
            disabled={sending}
            onChange={(event) => setGoalTopicId(event.target.value)}
          >
            <option value="">不指定</option>
            {goalTopics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.title}
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-600">
            設定後，「之後怎樣？」這類短問題會優先留在這個課題；你明確問另一個課題時仍以你的問題為準。
          </span>
        </div>
      ) : null}

      {/*
        回覆深度（2026-11-06）：能力較高的學生可自行要求更深入的分析，
        而不必受限於「自動」按提問字面所作的判斷。
      */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="tutor-depth" className="font-semibold">
          回覆深度
        </label>
        <select
          id="tutor-depth"
          className="rounded-lg border bg-white px-2 py-1"
          style={{ borderColor: "var(--border-strong)" }}
          value={depth}
          disabled={sending}
          onChange={(event) =>
            writeStoredDepth(event.target.value as TutorDepthPreference)
          }
        >
          {DEPTH_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-600">
          {DEPTH_OPTIONS.find((option) => option.value === depth)?.hint ?? ""}
        </span>
      </div>

      <p
        className="rounded-xl border px-4 py-3 text-sm font-medium"
        style={{
          borderColor: "#f2ddb0",
          background: "var(--warning-soft)",
          color: "var(--warning)",
        }}
      >
        {DISCLAIMER}
      </p>

      {staffPreview ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3 text-sm"
          style={{ borderColor: "#c6d6ff", background: "var(--accent-soft)" }}
        >
          <span className="badge badge-accent">教師測試身分</span>
          <span>
            你現正以教職員身分測試學伴。對話記錄及每日 15 次配額屬於你自己的教職員帳戶，
            不會影響任何學生。
          </span>
          {backHref ? (
            <Link className="btn ml-auto" href={backHref}>
              返回後台
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="card space-y-4" aria-live="polite" aria-busy={loading || sending}>
        {loading ? <p className="text-sm text-gray-500">正在載入學伴對話…</p> : null}
        {!loading && truncation ? (
          <p className="rounded-lg px-3 py-2 text-xs text-gray-600" style={{ background: "var(--accent-soft)" }}>
            此對話共有 {truncation.total} 則訊息，現時只顯示最近 {truncation.shown} 則；較早的內容仍保留在學習紀錄。
          </p>
        ) : null}
        {/*
          練習開場引導：平台說明，不呼叫模型、不寫入資料庫。
          只顯示課題、題幹摘要及引導問題（學生安全欄位），不含任何答案。
        */}
        {opening !== null ? (
          <div
            className="max-w-3xl rounded-xl px-4 py-3"
            style={{ background: "#f4f5f8" }}
            aria-label="練習開場引導"
          >
            <p className="mb-1 text-xs font-semibold text-gray-500">歷史自學學伴</p>
            <p className="text-sm">
              我們會針對你在練習中遇到的
              {opening.topicTitle.length > 0 ? `「${opening.topicTitle}」` : ""}概念討論。
              學伴只會協助你理解思路，<strong>不會提供這題的標準答案或哪個選項正確</strong>。
            </p>
            {opening.stemSummary.length > 0 ? (
              <p className="mt-2 rounded-lg bg-white px-3 py-2 text-xs text-gray-700">
                題幹摘要：{opening.stemSummary}
              </p>
            ) : null}
            {opening.skillHint !== null ? (
              <p className="mt-2 text-xs text-gray-600">🎯 {opening.skillHint}</p>
            ) : null}
            {opening.suggestions.length > 0 ? (
              <div className="mt-3 space-y-2" aria-label="建議提問方向">
                <p className="text-sm text-gray-600">可以從這些方向開始（點選後會放入輸入框）：</p>
                <div className="flex flex-wrap gap-2">
                  {opening.suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="btn text-left text-sm"
                      disabled={sending || inputBlocked || loading}
                      onClick={() => chooseQuestionSuggestion(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {!loading && messages.length === 0 && opening === null ? (
          <p className="text-sm text-gray-600">
            你可以提出歷史課題或事件；學伴會以問題和線索協助你思考，不會代答功課。
          </p>
        ) : null}
        {skillHint !== null && messages.length > 0 ? (
          <p className="text-xs text-gray-600">🎯 {skillHint}</p>
        ) : null}
        {webStatus === "failed" ? (
          <p className="text-xs text-gray-500" aria-live="polite">
            🌐 本回合未能取得外部參考（逾時或沒有可用來源），回答只根據教材及一般背景知識。
          </p>
        ) : null}
        {messages.map((message, index) => {
          const parsed =
            message.role === "assistant"
              ? parseTutorQuestionSuggestions(message.content)
              : { content: message.content, suggestions: [] };
          return (
            <article
              key={`${index}-${message.role}`}
              className={`max-w-3xl rounded-xl px-4 py-3 ${
                message.role === "user" ? "ml-auto" : "mr-auto"
              }`}
              style={{
                background: message.role === "user" ? "var(--accent-soft)" : "#f4f5f8",
              }}
            >
              <p className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-gray-500">
                <span>{message.role === "user" ? "你" : "歷史自學學伴"}</span>
                {message.role === "assistant" && depthLabel(message.depth) !== null ? (
                  <span className="badge badge-accent">{depthLabel(message.depth)}</span>
                ) : null}
              </p>
              {parsed.content.length > 0 ? <TutorMarkdown content={parsed.content} /> : null}
              {parsed.suggestions.length > 0 ? (
                <div className="mt-3 space-y-2" aria-label="可能的提問方向">
                  <p className="text-sm text-gray-600">
                    可選一個方向填入問題框再傳送，亦可自行改寫：
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {parsed.suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        className="btn text-left text-sm"
                        disabled={sending || inputBlocked || loading}
                        onClick={() => chooseQuestionSuggestion(suggestion)}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {message.candidates && message.candidates.length > 0 ? (
                <div className="mt-3 space-y-2" aria-label="可選的歷史提問">
                  <p className="text-sm text-gray-600">
                    點選一個方向會以該問題繼續查詢；你也可以自行改寫問題：
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {message.candidates.map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        className="btn text-left text-sm"
                        disabled={sending || inputBlocked || loading}
                        aria-label={`以「${candidate.suggestedQuestion}」繼續提問`}
                        onClick={() => void submitMessage(candidate.suggestedQuestion)}
                      >
                        <span className="block font-semibold">{candidate.label}</span>
                        <span className="block text-xs font-normal text-gray-600">
                          {candidate.suggestedQuestion}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {message.role === "assistant" ? <TutorEvidence message={message} /> : null}
            </article>
          );
        })}
        {error ? (
          <div role="alert" className="rounded-lg px-3 py-2 text-sm" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
            {error} {error.includes("登入") ? <Link className="underline" href="/login">前往登入</Link> : null}
          </div>
        ) : null}
        {inputBlocked ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold" style={{ color: "var(--warning)" }}>
              {quotaExhausted
                ? "今日提問次數已用完，明日再來就可以繼續問。"
                : "目前已達 AI 使用時間窗上限，請稍後再試。"}
            </p>
            {/*
              額度用盡不是處罰：立即給學生可行的下一步，而不是只有一句「不能再問」。
              兩個連結都是既有路由，毋須新的權限或資料。
            */}
            <p className="text-sm text-gray-600">這段時間你可以：</p>
            <div className="flex flex-wrap gap-2">
              <Link className="btn" href="/review">
                🔁 重溫錯題
              </Link>
              <Link className="btn" href="/">
                📚 返回課題首頁，查看練習進度
              </Link>
            </div>
            <p className="text-xs text-gray-600">
              離題及澄清的問題不會計入每日次數，所以明天的 15 次會全數留給你真正想問的歷史問題。
            </p>
          </div>
        ) : null}
      </div>

      <form onSubmit={sendMessage} className="card space-y-3">
        <label htmlFor="tutor-message" className="block text-sm font-semibold">
          你的歷史問題
        </label>
        <textarea
          id="tutor-message"
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="可用口語、錯字或簡體字提問，例如：二戰點解會打？"
          disabled={loading || sending || inputBlocked}
          readOnly={inputBlocked}
          className="w-full rounded-lg border bg-white px-3 py-2"
          style={{ borderColor: "var(--border-strong)" }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-gray-500">
            問題可以不太完整；若學伴未能確定你的意思，會列出可能方向供你選擇，或自行改寫。學伴只會引用已開放教材節錄，不會取得題庫、標準答案或評分參考；若學校已開啟外部參考，亦只會引用事先核准的白名單網站短摘錄，並以「🌐 外部參考」另行標示。
          </p>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || sending || inputBlocked || input.trim().length === 0}
          >
            {sending ? "學伴思考中…" : "傳送問題"}
          </button>
        </div>
      </form>
    </section>
  );
}
