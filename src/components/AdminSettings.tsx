"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api-client";
import { CURRICULUM_LEVEL_LABELS, type SystemStatus, type TopicOverview } from "@/lib/types";
import { ErrorNotice, Loading, Notice } from "@/components/ui";

/** 名冊來源的顯示名稱 */
const ROSTER_SOURCE_LABELS: Record<SystemStatus["roster"]["source"], string> = {
  "sheets-api": "Google Sheets API（服務帳戶）",
  csv: "Google Sheet CSV 匯出",
  file: "本機 CSV 檔案",
  none: "未設定來源",
};

/**
 * 課題與系統狀態：
 *   - 課程課題的發布狀態（學生端只會看到已發布的課題）
 *   - 每個課題的教材段落數及分節數
 *   - 系統狀態（版本、資料庫、LLM、OCR、登入、部署提示）及環境變數提示
 */
export function AdminSettings() {
  const [topics, setTopics] = useState<TopicOverview[] | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyTopicId, setBusyTopicId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [topicList, systemStatus] = await Promise.all([
      api.get<{ topics: TopicOverview[] }>("/api/topics?publishedOnly=false"),
      api.get<SystemStatus>("/api/admin/system/health"),
    ]);
    setTopics(topicList.topics);
    setStatus(systemStatus);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<{ topics: TopicOverview[] }>("/api/topics?publishedOnly=false"),
      api.get<SystemStatus>("/api/admin/system/health"),
    ])
      .then(([topicList, systemStatus]) => {
        if (cancelled) return;
        setTopics(topicList.topics);
        setStatus(systemStatus);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function togglePublish(topic: TopicOverview, published: boolean) {
    setBusyTopicId(topic.id);
    setError(null);
    setMessage(null);
    try {
      await api.patch(`/api/admin/topics/${topic.id}`, { published });
      setMessage(`已${published ? "發布" : "取消發布"}「${topic.title}」。`);
      await load();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusyTopicId(null);
    }
  }

  if (error && !topics) return <ErrorNotice error={error} />;
  if (!topics || !status) return <Loading label="正在載入課題及系統狀態…" />;

  const curriculum = topics.filter((topic) => topic.level !== 0);
  const authEnabled = status.auth.enabled;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">課題與系統狀態</h1>

      {error ? <ErrorNotice error={error} /> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}

      <section className="card flex flex-col gap-3">
        <h2 className="font-semibold">課程課題（共 {curriculum.length} 個）</h2>
        <p className="text-sm text-gray-600">
          取消發布後，學生端不會看到該課題；管理員仍可在教材管理檢視。
        </p>
        <ul className="flex flex-col gap-2">
          {curriculum.map((topic) => (
            <li
              key={topic.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)" }}
            >
              <span className="badge">{CURRICULUM_LEVEL_LABELS[topic.level]}</span>
              <span className="font-medium">{topic.title}</span>
              <span className="text-gray-600">
                {topic.sections.length} 個分節節點
              </span>
              <span className={topic.published ? "badge badge-success" : "badge badge-warning"}>
                {topic.published ? "已發布" : "未發布"}
              </span>
              <span className="ml-auto flex gap-2">
                <button
                  type="button"
                  className="btn"
                  disabled={busyTopicId === topic.id}
                  onClick={() => void togglePublish(topic, !topic.published)}
                >
                  {busyTopicId === topic.id ? "處理中…" : topic.published ? "取消發布" : "發布"}
                </button>
                <Link href="/teacher/questions" className="btn">
                  題目管理
                </Link>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card flex flex-col gap-3">
        <h2 className="font-semibold">系統狀態</h2>
        <ul className="text-sm grid gap-1 sm:grid-cols-2">
          <li>應用程式版本：{status.version}</li>
          <li>
            資料庫：{status.database.driver}（
            {status.database.status === "ok" ? "連線正常" : "無法連線"}）
          </li>
          <li>LLM provider：{status.llm.providerLabel}</li>
          <li>LLM 模型：{status.llm.model ?? "（本地示範生成）"}</li>
          <li>AI 語意批改：{status.llm.aiGrading ? "已啟用" : "未啟用"}</li>
          <li>OCR：{status.ocr.enabled ? `${status.ocr.providerLabel}（${status.ocr.languages}）` : "已停用"}</li>
          <li>
            登入：{status.auth.enabled ? "已啟用" : "未啟用"}
            {status.auth.schoolDomains.length > 0 ? `（${status.auth.schoolDomains.join("、")}）` : ""}
          </li>
          <li>後台 API 保護：{status.auth.staffApiOpen ? "未受保護（僅限本機示範）" : "受登入保護"}</li>
          <li>
            學生名冊：
            {status.roster.enabled
              ? `${ROSTER_SOURCE_LABELS[status.roster.source]}（${status.roster.loaded ? `已載入 ${status.roster.students} 人` : "未載入"}${
                  status.roster.inScope !== null && status.roster.inScope !== status.roster.students
                    ? `，開放 ${status.roster.inScope} 人`
                    : ""
                }${status.roster.enforce ? "，只限名冊帳戶登入" : "，不限制登入"}）`
              : "未啟用"}
          </li>
          {status.roster.classPrefixes.length > 0 || status.roster.classes.length > 0 ? (
            <li>
              開放班別：
              {[...status.roster.classes, ...status.roster.classPrefixes.map((prefix) => `${prefix} 班`)].join(
                "、",
              )}
            </li>
          ) : null}
          {status.roster.loadedAt !== null ? (
            <li>名冊更新時間：{new Date(status.roster.loadedAt).toLocaleString("zh-HK", { hour12: false })}</li>
          ) : null}
        </ul>

        {status.roster.error !== null ? (
          <Notice tone="warning">名冊最近的讀取問題：{status.roster.error}</Notice>
        ) : null}

        {status.configIssues.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="font-semibold text-sm">環境變數提示</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {status.configIssues.map((issue) => (
                <li key={issue.code}>
                  <span
                    className={`badge ${
                      issue.level === "error"
                        ? "badge-danger"
                        : issue.level === "warning"
                          ? "badge-warning"
                          : "badge-accent"
                    }`}
                  >
                    {issue.level === "error" ? "需處理" : issue.level === "warning" ? "注意" : "提示"}
                  </span>{" "}
                  {issue.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <Notice tone="info">
          目前只在本機執行及測試。部署到 Google Cloud Run 前，資料庫、教材檔案及 OCR 快取需要改為持久化方案
          （Cloud SQL／Cloud Storage），並以 Secret Manager 注入憑證；詳見 README「部署準備」。
        </Notice>
        {!authEnabled ? (
          <Notice tone="warning">目前未啟用登入，後台功能完全開放，請勿在公開網絡使用。</Notice>
        ) : null}
      </section>
    </div>
  );
}
