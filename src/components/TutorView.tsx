"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { TutorGroundingStatus, TutorSource, TutorTermNote } from "@/lib/types";
import { parseTutorQuestionSuggestions } from "@/lib/tutor-question-suggestions";

interface TutorMessage {
  role: "user" | "assistant";
  content: string;
  /** 回覆所依據的教材出處（由伺服器提供，重新載入對話後仍然存在） */
  sources?: TutorSource[];
  grounding?: TutorGroundingStatus;
  topicTitle?: string | null;
  termNotes?: TutorTermNote[];
}

interface TutorState {
  remaining: number;
  dailyLimit: number;
}

/** 伺服器回傳的訊息格式（`GET /api/tutor/chat`） */
interface TutorWireMessage {
  role: "user" | "assistant";
  content: string;
  sources?: TutorSource[];
  groundingStatus?: TutorGroundingStatus;
  termNotes?: TutorTermNote[];
}

function toTutorMessage(message: TutorWireMessage): TutorMessage {
  return {
    role: message.role,
    content: message.content,
    sources: message.sources ?? [],
    grounding: message.groundingStatus ?? "none",
    termNotes: message.termNotes ?? [],
  };
}

const SESSION_STORAGE_KEY = "history-tutor-session";
const DISCLAIMER =
  "⚠️ 內容由 AI 輔助生成，僅供課後複習參考。標示「已對照課本教材」的回覆會列出教材節錄及出處可供核對；標示「未找到教材依據」的部分屬補充，不是課本說法。正式史實與作答標準請以課本及科任老師教授為準。";

function readStoredSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
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
 */
function TutorEvidence({ message }: { message: TutorMessage }) {
  // 只顯示真正有內容的出處：若資料殘缺，寧可顯示一句說明，也不要留下一列空白項目
  const sources = (message.sources ?? []).filter(
    (source) => source.excerpt.trim().length > 0 || source.location.trim().length > 0,
  );
  const termNotes = message.termNotes ?? [];
  const grounded = message.grounding === "grounded";
  const notCovered = message.grounding === "not-covered";
  if (!grounded && !notCovered && termNotes.length === 0) return null;

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
    try {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // 未能清除時，重新載入頁面才會回到舊對話；本次仍然可以開始新對話。
    }
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (message.length === 0 || sending || quota.remaining <= 0) return;

    setInput("");
    setError(null);
    setMessages((current) => [...current, { role: "user", content: message }]);
    setSending(true);

    try {
      const response = await fetch("/api/tutor/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, ...(sessionId ? { sessionId } : {}) }),
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
        setMessages((current) => [...current, { role: "assistant", content: payload.reply }]);
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
        patch: Partial<Pick<TutorMessage, "sources" | "grounding" | "topicTitle" | "termNotes">>,
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
        };
        if (event === "delta" && typeof data.text === "string") {
          updateAssistant({}, data.text);
        } else if (event === "meta") {
          updateAssistant({
            grounding: data.grounding ?? "none",
            topicTitle: typeof data.topicTitle === "string" ? data.topicTitle : null,
            sources: Array.isArray(data.sources) ? data.sources : [],
          });
        } else if (event === "done") {
          if (typeof data.remaining === "number") {
            setQuota((current) => ({ ...current, remaining: data.remaining as number }));
          }
          updateAssistant({
            ...(Array.isArray(data.termNotes) ? { termNotes: data.termNotes } : {}),
            ...(data.grounding === "grounded" || data.grounding === "not-covered"
              ? { grounding: data.grounding }
              : {}),
            ...(Array.isArray(data.sources) ? { sources: data.sources } : {}),
            ...(data.topicTitle !== undefined ? { topicTitle: data.topicTitle } : {}),
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
        {!loading && messages.length === 0 ? (
          <p className="text-sm text-gray-600">
            你可以提出歷史課題或事件；學伴會以問題和線索協助你思考，不會代答功課。
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
              <p className="mb-1 text-xs font-semibold text-gray-500">
                {message.role === "user" ? "你" : "歷史自學學伴"}
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
          <p className="text-sm font-semibold" style={{ color: "var(--warning)" }}>
            {quotaExhausted
              ? "今日提問次數已用完，請明日再來。已通過歷史主題檢查的問題才會計入每日上限。"
              : "目前已達 AI 使用時間窗上限，請稍後再試。"}
          </p>
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
            問題可以不太完整；若學伴未能確定你的意思，會列出可能方向供你選擇，或自行改寫。學伴只會引用已開放教材節錄，不會取得題庫、標準答案或評分參考。
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
