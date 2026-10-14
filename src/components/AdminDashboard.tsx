"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "@/lib/api-client";
import {
  LLM_REQUEST_TYPE_LABELS,
  type ObservabilitySummary,
  type SystemStatus,
  type TeacherOverview,
} from "@/lib/types";
import { ErrorNotice, Loading, Notice, StatBox } from "@/components/ui";

interface OverviewResponse {
  overview: TeacherOverview;
  observability: ObservabilitySummary;
}

const QUICK_ACTIONS = [
  { href: "/admin/materials", label: "匯入教材、執行 OCR" },
  { href: "/admin/settings", label: "課題發布與系統狀態" },
  { href: "/teacher/questions/generate", label: "生成題目並審核" },
  { href: "/teacher/questions", label: "題目管理、處理回報" },
  { href: "/teacher/records", label: "查看／下載學生練習記錄" },
  { href: "/", label: "學生端測試（以管理員身分練習）" },
];

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-HK", { hour12: false });
}

/** 管理員儀表板：課題、教材、題庫、回報及 AI 用量概況，並提供全部功能的常用操作入口 */
export function AdminDashboard({ adminEmail }: { adminEmail?: string | null }) {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<OverviewResponse>("/api/admin/system/overview"),
      api.get<SystemStatus>("/api/admin/system/health"),
    ])
      .then(([overview, health]) => {
        if (cancelled) return;
        setData(overview);
        setStatus(health);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorNotice error={error} />;
  if (!data || !status) return <Loading label="正在載入管理員儀表板…" />;

  const { overview, observability } = data;
  const grading = observability.grading;
  const gradingSuccessRate =
    grading.attempts === 0 ? null : Math.round(((grading.attempts - grading.failures) / grading.attempts) * 100);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold">管理員儀表板</h1>
        <span className="text-sm text-gray-600">
          {adminEmail ? `已登入：${adminEmail}` : "未啟用登入（本機示範模式）"}
        </span>
      </div>

      {status.auth.staffApiOpen ? (
        <Notice tone="warning">
          尚未啟用學校帳戶登入，後台（管理員端及教師端）目前完全開放，只適合本機開發及示範。正式使用前請設定
          Google 登入（見 README）。
        </Notice>
      ) : null}

      {status.configIssues.filter((issue) => issue.level === "error").length > 0 ? (
        <Notice tone="warning">
          {status.configIssues
            .filter((issue) => issue.level === "error")
            .map((issue) => issue.message)
            .join(" ")}
        </Notice>
      ) : null}

      <section className="card flex flex-col gap-3">
        <h2 className="font-semibold">平台概況</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatBox label="課程課題" value={`${overview.topics.published}/${overview.topics.total}`} />
          <StatBox label="教材文件" value={`${overview.materials.documents}`} />
          <StatBox label="教材段落" value={`${overview.materials.blocks}`} />
          <StatBox label="OCR 段落" value={`${overview.materials.ocrBlocks}`} />
          <StatBox label="題庫題目" value={`${overview.questions.total}`} />
          <StatBox label="已發布題目" value={`${overview.questions.published}`} />
          <StatBox label="草稿題目" value={`${overview.questions.draft}`} />
          <StatBox label="校內試題（待核對）" value={`${overview.questions.schoolPaper}`} />
          <StatBox label="題目待覆核回報" value={`${overview.questions.flagged}`} />
        </div>
        <p className="text-sm text-gray-600">
          已發布課題 {overview.topics.published}/{overview.topics.total}；未通過教材依據核對的題目{" "}
          {overview.questions.unverified} 題（校內試題的來源是試卷本身，不需教材依據核對，因此不計入）；
          未執行或部分完成 OCR 的教材 {overview.materials.ocrPending} 份。
        </p>
      </section>

      <section className="card flex flex-col gap-3">
        <h2 className="font-semibold">系統狀態</h2>
        <ul className="text-sm grid gap-1 sm:grid-cols-2">
          <li>版本：{status.version}</li>
          <li>
            資料庫：{status.database.driver}（{status.database.status === "ok" ? "連線正常" : "無法連線"}）
          </li>
          <li>
            LLM：{status.llm.providerLabel}
            {status.llm.model ? `｜模型 ${status.llm.model}` : ""}
          </li>
          <li>AI 語意批改：{status.llm.aiGrading ? "已啟用" : "未啟用（會回退字詞比對／自我檢查）"}</li>
          <li>OCR：{status.ocr.enabled ? status.ocr.providerLabel : "已停用"}</li>
          <li>
            登入：{status.auth.enabled ? "已啟用學校 Google 帳戶" : "未啟用（匿名示範模式）"}
          </li>
          <li>執行環境：{status.deployment.platform}</li>
          <li>資料持久性：{status.deployment.ephemeralStorage ? "容器／專案目錄（非永久）" : "外部儲存"}</li>
          <li>
            自動備份：
            {status.backup.enabled
              ? `已啟用（已上傳 ${status.backup.backupsUploaded} 次${
                  status.backup.lastSuccessAt
                    ? `；上次 ${formatDateTime(status.backup.lastSuccessAt)}`
                    : "；尚未完成第一次備份"
                }${status.backup.lastError ? `；上次錯誤：${status.backup.lastError}` : ""}）`
              : "未啟用（未設定 BACKUP_BUCKET）"}
          </li>
          <li>
            啟動還原：
            {status.backup.restore === "restored"
              ? "已由 Cloud Storage 還原資料庫"
              : status.backup.restore === "failed"
                ? "還原失敗（見設定提示）"
                : status.backup.restore === "skipped"
                  ? status.backup.restoreMessage ?? "未還原"
                  : "未嘗試"}
          </li>
        </ul>
        {status.deployment.notes.length > 0 ? (
          <Notice tone="info">{status.deployment.notes.join(" ")}</Notice>
        ) : null}
        {status.configIssues.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer">設定提示（{status.configIssues.length} 項）</summary>
            <ul className="list-disc pl-5 mt-1 text-gray-600">
              {status.configIssues.map((issue) => (
                <li key={issue.code}>
                  [{issue.level}] {issue.message}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="card flex flex-col gap-3">
        <h2 className="font-semibold">最近 7 天 AI 使用情況</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatBox label="LLM 請求" value={`${observability.llmRequests}`} />
          <StatBox label="LLM 失敗" value={`${observability.llmFailures}`} />
          <StatBox
            label="AI 批改成功率"
            value={gradingSuccessRate === null ? "—" : `${gradingSuccessRate}%`}
          />
          <StatBox label="Input／Output tokens" value={`${observability.inputTokens}／${observability.outputTokens}`} />
        </div>
        <p className="text-sm text-gray-600">
          AI 批改：{grading.attempts} 次嘗試、{grading.failures} 次失敗、{grading.fallbacks} 次改用字詞比對或自我檢查。
          只記錄統計資料（provider、模型、時間、token 及錯誤類別），不會記錄 API key 或學生的答案內容。
        </p>
        {observability.errorTypes.length > 0 ? (
          <p className="text-sm text-gray-600">
            失敗原因：{observability.errorTypes.map((item) => `${item.errorType}（${item.count}）`).join("、")}
          </p>
        ) : null}
        {observability.recentLlm.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer">最近的 LLM 請求（{observability.recentLlm.length} 筆）</summary>
            <ul className="mt-1 flex flex-col gap-1 text-gray-600">
              {observability.recentLlm.map((log) => (
                <li key={log.id}>
                  {formatDateTime(log.createdAt)}｜{LLM_REQUEST_TYPE_LABELS[log.requestType]}｜{log.provider}
                  {log.model ? `（${log.model}）` : ""}｜{log.success ? "成功" : `失敗（${log.errorType ?? "未知"}）`}
                  ｜{log.durationMs} ms
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="card flex flex-col gap-3">
        <h2 className="font-semibold">常用操作</h2>
        <div className="flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((action) => (
            <Link key={action.href} href={action.href} className="btn">
              {action.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
