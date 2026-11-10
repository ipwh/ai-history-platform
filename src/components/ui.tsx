"use client";

import { describeApiFailure } from "@/lib/api-errors";

export function Loading({ label = "載入中…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm py-6" style={{ color: "var(--text)" }} role="status" aria-live="polite">
      <span
        className="inline-block h-4 w-4 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }}
      />
      {label}
    </div>
  );
}

/** 內容骨架：AI 出題或載入時先顯示版面，減少「畫面空白」的等待感 */
export function Skeleton({
  className = "skeleton-line",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden="true" />;
}

/**
 * 作答頁的載入骨架。
 *
 * 仍保留 `label` 文字（測試及輔助技術依賴「正在載入題目…」這句話），
 * 只是同時顯示題目、選項的骨架，令學生知道即將出現甚麼。
 */
export function QuestionSkeleton({ label = "正在載入題目…" }: { label?: string }) {
  return (
    <div className="flex flex-col gap-4" role="status" aria-live="polite" aria-busy="true">
      <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
        <span
          className="inline-block h-4 w-4 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }}
        />
        {label}
      </div>
      <Skeleton className="skeleton-line" style={{ width: "40%" }} />
      <div className="card flex flex-col gap-3">
        <Skeleton className="skeleton-line skeleton-line--lg" style={{ width: "85%" }} />
        <Skeleton className="skeleton-line skeleton-line--lg" style={{ width: "60%" }} />
        <div className="flex flex-col gap-2">
          <Skeleton className="skeleton-block" />
          <Skeleton className="skeleton-block" />
          <Skeleton className="skeleton-block" />
          <Skeleton className="skeleton-block" />
        </div>
      </div>
    </div>
  );
}

/** 空狀態：圖示 + 一句解釋 + 一個可行動的下一步 */
export function EmptyState({
  icon = "🗂️",
  title,
  children,
  action,
}: {
  icon?: string;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon" aria-hidden="true">
        {icon}
      </span>
      <p className="empty-state__title">{title}</p>
      {children ? <p className="empty-state__body">{children}</p> : null}
      {action ? <div className="flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  // 錯誤分類（Sprint 23）：網絡、逾時、登入、權限、找不到、資料格式、伺服器錯誤各自
  // 有標題及可行的下一步，避免把所有失敗都顯示成同一句「沒有題目」。
  const failure = describeApiFailure(error);
  const title = failure.title;
  const message = failure.message;
  const details = failure.details;

  return (
    <div className="card" style={{ borderColor: "var(--danger)" }}>
      <p className="font-semibold" style={{ color: "var(--danger)" }}>
        {title}：{message}
      </p>
      {failure.hint ? (
        <p className="text-sm mt-1" style={{ color: "var(--foreground)" }}>
          {failure.hint}
        </p>
      ) : null}
      {details.length > 0 ? (
        <ul className="list-disc pl-5 text-sm mt-1">
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
      {onRetry && failure.retryable ? (
        <button type="button" className="btn mt-3" onClick={onRetry}>
          重試
        </button>
      ) : null}
      {onRetry && !failure.retryable ? (
        <button type="button" className="btn mt-3" onClick={onRetry}>
          重新載入
        </button>
      ) : null}
    </div>
  );
}

export function Notice({
  children,
  tone = "info",
}: {
  children: React.ReactNode;
  tone?: "info" | "warning" | "success";
}) {
  const palette = {
    info: { background: "var(--accent-soft)", border: "#c6d6ff" },
    warning: { background: "var(--warning-soft)", border: "#f2ddb0" },
    success: { background: "var(--success-soft)", border: "#bfe6d1" },
  }[tone];

  return (
    <div
      className="rounded-xl px-3 py-2 text-sm"
      style={{ background: palette.background, border: `1px solid ${palette.border}` }}
    >
      {children}
    </div>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div
      className="w-full h-2 rounded-full overflow-hidden"
      style={{ background: "var(--border)" }}
      role="progressbar"
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full"
        style={{ width: `${clamped * 100}%`, background: "var(--accent)" }}
      />
    </div>
  );
}

export function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl px-3 py-2 text-center" style={{ background: "var(--accent-soft)" }}>
      <div className="text-xl font-bold" style={{ color: "var(--accent)" }}>
        {value}
      </div>
      <div className="text-xs text-gray-600">{label}</div>
    </div>
  );
}
