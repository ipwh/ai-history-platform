"use client";

import { describeApiFailure } from "@/lib/api-errors";

export function Loading({ label = "載入中…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-600 py-6" role="status">
      <span
        className="inline-block h-4 w-4 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }}
      />
      {label}
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
