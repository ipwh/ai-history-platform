"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api-client";
import type { TeacherTutorStats } from "@/lib/types";
import { ErrorNotice, Loading, Notice, StatBox } from "@/components/ui";

const PERIODS = [7, 30] as const;

const WEB_STATUS_LABELS: Record<string, string> = {
  disabled: "已關閉",
  "not-used": "未使用",
  ok: "已有外部參考",
  failed: "抓取失敗",
  "blocked-topic": "課題封鎖",
};

/**
 * 教師端「學伴使用概況」。
 *
 * 只顯示**聚合數字**（成功回答、離題、澄清、正規化改寫、外部參考狀態），
 * 不顯示任何對話正文。API 回傳 `contentIncluded: false`，介面亦以此顯示提示，
 * 令「後台不是用來讀學生對話」這件事在 UI 上明確可見。
 */
export function TutorUsagePanel() {
  const [days, setDays] = useState<number>(PERIODS[0]);
  const [stats, setStats] = useState<TeacherTutorStats | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<TeacherTutorStats>(`/api/teacher/tutor-stats?days=${days}`)
      .then((result) => {
        if (cancelled) return;
        setStats(result);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  if (error) return <ErrorNotice error={error} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold">學伴使用概況</h1>
        <div className="flex gap-2">
          {PERIODS.map((period) => (
            <button
              key={period}
              type="button"
              className={`btn ${days === period ? "btn-primary" : ""}`}
              onClick={() => {
                if (period === days) return;
                // 切換期間先清空，避免短暫顯示上一個期間的數字
                setStats(null);
                setError(null);
                setDays(period);
              }}
              aria-pressed={days === period}
            >
              近 {period} 日
            </button>
          ))}
        </div>
      </div>

      <Notice tone="info">
        本頁只有<strong>聚合數字</strong>，不會顯示學生與學伴的對話內容；後台並非用作監控學生對話。
        如需個別跟進，請直接與學生溝通，或依學校程序處理。
      </Notice>

      {stats === null ? <Loading label="正在載入學伴統計…" /> : null}

      {stats !== null ? (
        <>
          <section className="card flex flex-col gap-3">
            <h2 className="font-semibold">近 {stats.days} 日總數</h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <StatBox label="成功回答" value={`${stats.totals.answered}`} />
              <StatBox label="離題（固定拒答）" value={`${stats.totals.offTopic}`} />
              <StatBox label="澄清" value={`${stats.totals.clarify}`} />
              <StatBox label="正規化改寫" value={`${stats.totals.normalize}`} />
              <StatBox label="外部參考成功" value={`${stats.webSupplement.ok ?? 0}`} />
            </div>
            <p className="text-xs text-gray-600">
              「離題」及「澄清」不計入學生每日 15 次額度；「澄清」與「正規化改寫」來自匿名事件記錄
              （不含學生身分），只用作每月補強提問理解規則。
            </p>
          </section>

          <section className="card flex flex-col gap-3">
            <h2 className="font-semibold">外部參考狀態分佈</h2>
            {Object.keys(stats.webSupplement).length === 0 ? (
              <p className="text-sm text-gray-600">期內沒有相關記錄（外部參考功能預設關閉）。</p>
            ) : (
              <ul className="flex flex-wrap gap-2 text-sm">
                {Object.entries(stats.webSupplement).map(([status, count]) => (
                  <li key={status} className="badge">
                    {WEB_STATUS_LABELS[status] ?? status}：{count}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card flex flex-col gap-3">
            <h2 className="font-semibold">按日彙總</h2>
            {stats.daily.length === 0 ? (
              <p className="text-sm text-gray-600">期內沒有學伴提問記錄。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-600">
                      <th className="py-1 pr-3">日期</th>
                      <th className="py-1 pr-3">成功回答</th>
                      <th className="py-1 pr-3">離題</th>
                      <th className="py-1 pr-3">澄清</th>
                      <th className="py-1 pr-3">正規化</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.daily.map((row) => (
                      <tr key={row.date} style={{ borderTop: "1px solid var(--border-strong)" }}>
                        <td className="py-1 pr-3">{row.date}</td>
                        <td className="py-1 pr-3">{row.answered}</td>
                        <td className="py-1 pr-3">{row.offTopic}</td>
                        <td className="py-1 pr-3">{row.clarify}</td>
                        <td className="py-1 pr-3">{row.normalize}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-gray-600">
              日期以香港時間計算，與學生每日 15 次額度同一口徑；API 回應固定標示
              <code className="mx-1">contentIncluded: false</code>，即不含任何訊息內容。
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}
