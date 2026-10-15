"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type {
  AuthStatus,
  LearningProgressPayload,
  TopicOverview,
  TopicProgressSummary,
} from "@/lib/types";
import {
  CURRICULUM_LEVEL_LABELS,
  CURRICULUM_THEMES,
  LEARNING_STATE_LABELS,
  LEARNER_STORAGE_KEY,
  countPracticeThemes,
} from "@/lib/types";
import { api, getLearnerId } from "@/lib/api-client";
import { ErrorNotice, Loading, Notice } from "@/components/ui";

/**
 * 首頁：只顯示三個年級、每個年級四個課題（共 12 個按鈕）。
 * 點選課題後直接進入練習設定頁揀選分節及主題，不再經中間的課題頁。
 *
 * 另顯示由 `/api/progress` 計算的「下一步建議」及課題學習狀態：建議一律附上
 * 可追溯的理由，沒有足夠作答記錄時只會提示先開始練習，不會虛擬弱點。
 */
export function HomeView() {
  const [topics, setTopics] = useState<TopicOverview[] | null>(null);
  const [progress, setProgress] = useState<LearningProgressPayload | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [learnerId, setLearnerId] = useState("");
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const id = getLearnerId();
    api
      .get<{ topics: TopicOverview[] }>(`/api/topics?learnerId=${id}&publishedOnly=true`)
      .then((data) => {
        if (cancelled) return;
        setLearnerId(id);
        setTopics(data.topics);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught);
      });
    // 學習進度及建議：失敗時不會影響課題列表（首頁仍可正常使用）
    api
      .get<LearningProgressPayload>(`/api/progress?learnerId=${id}`)
      .then((data) => {
        if (!cancelled) setProgress(data);
      })
      .catch(() => {
        if (!cancelled) setProgress(null);
      });
    api
      .get<AuthStatus>("/api/auth/session")
      .then((status) => {
        if (!cancelled) setAuth(status);
      })
      .catch(() => {
        if (!cancelled) setAuth(null);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const reload = () => setReloadToken((token) => token + 1);
  const signedIn = auth?.enabled === true && auth.user !== null;

  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  if (!topics) return <Loading label="正在載入課題…" />;

  const progressByTopic = new Map<string, TopicProgressSummary>(
    (progress?.topics ?? []).map((item) => [item.topicId, item]),
  );
  const started = (progress?.topics ?? []).filter((item) => item.attemptedQuestions > 0);

  const levels = [1, 2, 3] as const;
  const grouped = levels.map((level) => ({
    level,
    theme: CURRICULUM_THEMES[level],
    topics: topics
      .filter((topic) => topic.level === level)
      .sort((a, b) => (a.topicNumber ?? 0) - (b.topicNumber ?? 0)),
  }));

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-bold">選擇課題</h1>

      {progress && progress.review.dueCount > 0 ? (
        <Notice>
          你有 <strong>{progress.review.dueCount}</strong> 條題目已到重溫時間。
          <Link href="/review" className="underline ml-1">
            前往重溫 ›
          </Link>
        </Notice>
      ) : null}

      {progress && progress.recommendations.length > 0 ? (
        <section className="card flex flex-col gap-2">
          <h2 className="font-bold">下一步建議</h2>
          <p className="text-xs text-gray-500">
            以下建議依你的作答記錄產生，每項都說明原因；記錄不足時不會推測你的強弱項。
          </p>
          <ul className="flex flex-col gap-2">
            {progress.recommendations.map((item) => (
              <li key={`${item.kind}-${item.href}`} className="flex flex-col gap-0.5">
                <Link href={item.href} className="font-medium" style={{ color: "var(--accent)" }}>
                  {item.title} ›
                </Link>
                <span className="text-sm text-gray-700">{item.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {started.length > 0 ? (
        <section className="card flex flex-col gap-2">
          <h2 className="font-bold">我的學習進度</h2>
          <p className="text-xs text-gray-500">
            只計算題庫內已發布的題目，同一題重複作答不會重複計算；「已多次答對」代表同一課題至少 2
            條不同題目答對，並非課程意義上的精熟。
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {started.map((item) => (
              <li key={item.topicId} className="flex flex-wrap items-center gap-2">
                <Link href={`/practice/new?topic=${item.topicId}`} className="font-medium">
                  {item.title}
                </Link>
                <span
                  className={`badge ${
                    item.state === "needs-review" ? "badge-warning" : "badge-success"
                  }`}
                >
                  {LEARNING_STATE_LABELS[item.state]}
                </span>
                <span className="text-gray-600">
                  已作答 {item.attemptedQuestions}／{item.eligibleQuestions} 條（答對{" "}
                  {item.correctQuestions} 條
                  {item.uncertainQuestions > 0 ? `，未能確定 ${item.uncertainQuestions} 條` : ""}）
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {topics.length === 0 ? (
        <Notice tone="warning">
          目前沒有已發布的課題。管理員可到「教材管理」匯入課程教材，或執行{" "}
          <code>npm run setup</code> 建立示範內容。
        </Notice>
      ) : null}

      {grouped.map((group) => (
        <section key={group.level} className="flex flex-col gap-3">
          <header
            className="rounded-xl px-3 py-2"
            style={{ background: "var(--accent-soft)", border: "1px solid #c6d6ff" }}
          >
            <h2 className="font-bold">
              {CURRICULUM_LEVEL_LABELS[group.level]}｜{group.theme.title}
              <span className="text-sm font-normal text-gray-600">（{group.theme.era}）</span>
            </h2>
            <p className="text-sm text-gray-700">{group.theme.focus}</p>
          </header>

          {group.topics.length === 0 ? (
            <p className="text-sm text-gray-500 pl-1">此年級暫無已發布的課題。</p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            {group.topics.map((topic) => {
              const topicProgress = progressByTopic.get(topic.id);
              return (
                <div key={topic.id} className="flex flex-col gap-1">
                  <Link href={`/practice/new?topic=${topic.id}`} className="topic-card">
                    <span className="flex-1 min-w-0">
                      <span className="font-bold block leading-snug">{topic.title}</span>
                      <span className="text-xs text-gray-600 block mt-0.5">
                        共 {countPracticeThemes(topic)} 個主題
                        {topic.progress.completedSessions > 0
                          ? ` ・ 已完成 ${topic.progress.completedSessions} 次練習`
                          : ""}
                        {topic.materialReady ? "" : " ・ 尚未匯入教材"}
                      </span>
                      {topicProgress && topicProgress.attemptedQuestions > 0 ? (
                        <span className="text-xs text-gray-600 block mt-0.5">
                          已作答 {topicProgress.attemptedQuestions} 條 ・{" "}
                          {LEARNING_STATE_LABELS[topicProgress.state]}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-gray-400" aria-hidden="true">
                      ›
                    </span>
                  </Link>
                  {/* 先閱讀、後練習：讓學生毋須教師在場亦可先了解內容 */}
                  <Link
                    href={`/learn/${topic.id}`}
                    className="text-xs self-start px-1"
                    style={{ color: "var(--accent)" }}
                  >
                    閱讀這個課題的教材 ›
                  </Link>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <section className="card flex flex-col gap-2">
        <h2 className="font-bold">學習記錄</h2>
        {signedIn && auth?.user ? (
          <>
            <p className="text-sm text-gray-600">
              你以學校帳戶 <strong>{auth.user.email}</strong> 登入，
              練習記錄會儲存在這個帳戶之下，並供歷史科教師查閱及下載。
            </p>
            <p className="text-xs text-gray-500">
              如需查看帳戶資料或登出，請使用右上角的選單。
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-600">
              系統使用匿名學習 ID 儲存你的練習記錄（儲存於 {LEARNER_STORAGE_KEY}{" "}
              及本機資料庫），不會要求你輸入姓名或聯絡方法。
            </p>
            <p className="text-xs text-gray-500 break-all">
              你的匿名學習 ID：{learnerId || "（未建立）"}
            </p>
          </>
        )}
        <p className="text-sm">
          <Link href="/account" className="btn">
            前往我的帳戶
          </Link>
        </p>
      </section>
    </div>
  );
}