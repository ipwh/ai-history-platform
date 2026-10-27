"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface TutorMessage {
  role: "user" | "assistant";
  content: string;
}

interface TutorState {
  remaining: number;
  dailyLimit: number;
}

const SESSION_STORAGE_KEY = "history-tutor-session";
const DISCLAIMER =
  "⚠️ 內容由 AI 輔助生成，僅供課後複習參考；正式史實與作答標準請以課本及科任老師教授為準。";

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
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          messages?: TutorMessage[];
          remaining?: number;
          dailyLimit?: number;
          windowLimitReached?: boolean;
      };
      if (!response.ok) throw new Error(responseError(payload, response.status));
      setMessages(payload.messages ?? []);
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
      let answer = "";

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
        };
        if (event === "delta" && typeof data.text === "string") {
          answer += data.text;
          setMessages((current) => {
            const next = [...current];
            const last = next[next.length - 1];
            if (last?.role === "assistant") {
              next[next.length - 1] = { ...last, content: answer };
            } else {
              next.push({ role: "assistant", content: answer });
            }
            return next;
          });
        } else if (event === "done" && typeof data.remaining === "number") {
          setQuota((current) => ({ ...current, remaining: data.remaining as number }));
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
      setError(cause instanceof Error ? cause.message : "傳送失敗，請稍後再試。");
    } finally {
      setSending(false);
    }
  }

  const quotaExhausted = quota.remaining <= 0;
  const inputBlocked = quotaExhausted || windowLimitReached;

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">🏛️ 歷史科自學學伴 (Beta)</h1>
        <p className="badge badge-accent" aria-live="polite">
          今日剩餘提問次數：{quota.remaining} / {quota.dailyLimit}
        </p>
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
        {!loading && messages.length === 0 ? (
          <p className="text-sm text-gray-600">
            你可以提出歷史課題或事件；學伴會以問題和線索協助你思考，不會代答功課。
          </p>
        ) : null}
        {messages.map((message, index) => (
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
            <TutorMarkdown content={message.content} />
          </article>
        ))}
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
          value={input}
          onChange={(event) => setInput(event.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="例如：一戰後簽訂《凡爾賽條約》的背景是甚麼？"
          disabled={loading || sending || inputBlocked}
          readOnly={inputBlocked}
          className="w-full rounded-lg border bg-white px-3 py-2"
          style={{ borderColor: "var(--border-strong)" }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-gray-500">不會向學伴提供題庫、標準答案、評分參考或課本全文。</p>
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
