"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

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
import { ErrorNotice, Loading, Notice, ProgressBar } from "@/components/ui";

/** 學生最後開啟的課題（用於「繼續上次練習」） */
const LAST_TOPIC_KEY = "hk-history-last-topic";
/** 學生最後選擇的年級（重開頁面時沿用） */
const LEVEL_KEY = "hk-history-level";
/** 同一頁面內改動 localStorage 不會觸發 storage 事件，因此自行派發通知 */
const STORAGE_EVENT = "hk-history-storage";

type Level = 1 | 2 | 3;
const LEVELS: Level[] = [1, 2, 3];

function subscribeStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(STORAGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(STORAGE_EVENT, onChange);
  };
}

function readStored(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    /* 瀏覽器停用儲存空間時仍可正常使用，只是不會記住選擇 */
    return "";
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
    window.dispatchEvent(new Event(STORAGE_EVENT));
  } catch {
    /* 忽略：無法儲存時只影響下次開啟的預設選擇 */
  }
}

function toLevel(raw: string): Level | null {
  return raw === "1" ? 1 : raw === "2" ? 2 : raw === "3" ? 3 : null;
}

/**
 * 首頁：讓學生一登入就找到自己要練的課題。
 *
 * 版面由三部分組成：
 *   1. 個人化摘要（已作答題目、答對比率、待重溫題目）及「繼續上次練習」；
 *   2. 年級切換（中一／中二／中三）— 只顯示該年級的 4 個課題，避免一次過顯示 12 個；
 *   3. 課題卡：顯示課題名稱（已含課題編號）、主題、進度及狀態，整張卡可點擊進入練習設定。
 *
 * 年級會自動判斷：先用學生上次的選擇，再用「練習次數最多的課題」所屬年級（通常就是
 * 本學年），最後才用中一。選擇只儲存在瀏覽器（localStorage），不涉及個人資料。
 */
export function HomeView() {
  const [topics, setTopics] = useState<TopicOverview[] | null>(null);
  const [progress, setProgress] = useState<LearningProgressPayload | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [learnerId, setLearnerId] = useState("");
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  /** 學生手動選擇的年級（儲存在瀏覽器；未選擇時會自動偵測） */
  const chosenLevel = toLevel(useSyncExternalStore(subscribeStorage, () => readStored(LEVEL_KEY), () => ""));
  const storedTopicId = useSyncExternalStore(
    subscribeStorage,
    () => readStored(LAST_TOPIC_KEY),
    () => "",
  );
  const lastTopicId = storedTopicId === "" ? null : storedTopicId;

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
    // 學習進度及到期重溫通知：失敗時不會影響課題列表（首頁仍可正常使用）
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

  const progressByTopic = useMemo(
    () =>
      new Map<string, TopicProgressSummary>(
        (progress?.topics ?? []).map((item) => [item.topicId, item]),
      ),
    [progress],
  );

  const activeLevel: Level = useMemo(() => {
    if (chosenLevel !== null) return chosenLevel;
    if (topics !== null) {
      const busiest = [...topics]
        .filter((topic) => topic.progress.completedSessions > 0)
        .sort((a, b) => b.progress.completedSessions - a.progress.completedSessions)[0];
      if (busiest && (busiest.level === 1 || busiest.level === 2 || busiest.level === 3)) {
        return busiest.level;
      }
    }
    return 1;
  }, [chosenLevel, topics]);

  function chooseLevel(level: Level): void {
    writeStored(LEVEL_KEY, String(level));
  }

  function rememberTopic(topicId: string): void {
    writeStored(LAST_TOPIC_KEY, topicId);
  }

  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  if (!topics) return <Loading label="正在載入課題…" />;

  const started = (progress?.topics ?? []).filter((item) => item.attemptedQuestions > 0);
  const dueCount = progress?.review.dueCount ?? 0;
  const totalAttempted = started.reduce((sum, item) => sum + item.attemptedQuestions, 0);
  const totalCorrect = started.reduce((sum, item) => sum + item.correctQuestions, 0);
  const totalPracticeAnswers = topics.reduce(
    (sum, topic) => sum + topic.progress.answeredQuestions,
    0,
  );
  const overallAccuracy =
    totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 100) : null;

  const levelTopics = topics
    .filter((topic) => topic.level === activeLevel)
    .sort((a, b) => (a.topicNumber ?? 0) - (b.topicNumber ?? 0));

  const lastTopic =
    lastTopicId !== null ? (topics.find((topic) => topic.id === lastTopicId) ?? null) : null;

  /**
   * 首頁主要行動：優先「繼續上次練習」，但必須屬於目前選取的年級；
   * 否則建議該年級中第一個「已開始但未完成」的課題，最後才用第一個課題。
   * 這樣切換年級後，按鈕不會帶學生去另一個年級的課題。
   */
  const continueTopic = (() => {
    if (lastTopic !== null && lastTopic.level === activeLevel) return lastTopic;
    const inProgress = levelTopics.find(
      (topic) => topic.progress.completedSessions > 0 && topic.progress.answeredQuestions > 0,
    );
    return inProgress ?? levelTopics[0] ?? null;
  })();
  const isResuming = lastTopic !== null && continueTopic?.id === lastTopic.id;

  const greetingName = signedIn && auth?.user?.name ? auth.user.name : "同學";
  const theme = CURRICULUM_THEMES[activeLevel];

  return (
    <div className="flex flex-col gap-5" data-level={activeLevel}>
      <section className="home-hero">
        <div className="home-hero__main">
          <p className="home-hero__eyebrow">
            {CURRICULUM_LEVEL_LABELS[activeLevel]} ・ 歷史科自學
          </p>
          <h1 className="home-hero__title">你好，{greetingName}</h1>
          <p className="home-hero__subtitle">
            先選擇你的年級，再揀課題就可以開始練習；每個課題都已按課本主題整理。
          </p>
          <div className="home-hero__stats">
            <div className="home-stat">
              <span className="home-stat__value">{totalPracticeAnswers}</span>
              <span className="home-stat__label">練習累計答題</span>
            </div>
            <div className="home-stat">
              <span className="home-stat__value">
                {overallAccuracy === null ? "—" : `${overallAccuracy}%`}
              </span>
              <span className="home-stat__label">答對比率</span>
            </div>
            <div className="home-stat">
              <span className="home-stat__value">{dueCount}</span>
              <span className="home-stat__label">待重溫題目</span>
            </div>
          </div>
        </div>
        <div className="home-hero__actions">
          {continueTopic ? (
            <Link
              href={`/practice/new?topic=${continueTopic.id}`}
              className="home-cta home-cta--primary"
              onClick={() => rememberTopic(continueTopic.id)}
            >
              {isResuming ? "繼續上次練習" : "開始練習"}：{continueTopic.title} →
            </Link>
          ) : null}
          {dueCount > 0 ? (
            <Link href="/review" className="home-cta home-cta--light">
              重溫 {dueCount} 條到期題目 →
            </Link>
          ) : null}
        </div>
      </section>

      {progress && progress.review.dueCount > 0 ? (
        <Notice>
          你有 <strong>{progress.review.dueCount}</strong> 條題目已到重溫時間；重溫同一題不會重複計算進度。
          <Link href="/review" className="underline ml-1">
            前往重溫 ›
          </Link>
        </Notice>
      ) : null}

      {topics.length === 0 ? (
        <Notice tone="warning">
          目前沒有已發布的課題。管理員可到「教材管理」匯入課程教材，或執行{" "}
          <code>npm run setup</code> 建立示範內容。
        </Notice>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">選擇課題</h2>
          <div className="level-tabs" role="tablist" aria-label="選擇年級">
            {LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                role="tab"
                aria-selected={activeLevel === level}
                className="level-tab"
                data-active={activeLevel === level}
                onClick={() => chooseLevel(level)}
              >
                {CURRICULUM_LEVEL_LABELS[level]}
              </button>
            ))}
          </div>
        </div>

        <div className="level-banner">
          <div>
            <p className="level-banner__title">
              {CURRICULUM_LEVEL_LABELS[activeLevel]}｜{theme.title}
              <span className="level-banner__era">{theme.era}</span>
            </p>
            <p className="level-banner__focus">{theme.focus}</p>
          </div>
          <p className="level-banner__count">{levelTopics.length} 個課題</p>
        </div>

        {levelTopics.length === 0 ? (
          <p className="text-sm text-gray-500 pl-1">
            此年級暫無已發布的課題，可切換其他年級，或請教師匯入教材。
          </p>
        ) : null}

        <div className="topic-grid">
          {levelTopics.map((topic) => {
            const topicProgress = progressByTopic.get(topic.id);
            const state = topicProgress?.state ?? "not-started";
            const answered = topicProgress?.attemptedQuestions ?? 0;
            const eligible = topicProgress?.eligibleQuestions ?? topic.totalPublishedQuestions;
            const themeNames = topic.sections.map((section) => section.title);
            const shownThemes = themeNames.slice(0, 2);
            const stateBadge =
              state === "needs-review"
                ? "badge-warning"
                : state === "not-started"
                  ? ""
                  : "badge-success";
            const isLast = lastTopicId === topic.id;
            return (
              <Link
                key={topic.id}
                href={`/practice/new?topic=${topic.id}`}
                className="topic-tile"
                data-state={state}
                onClick={() => rememberTopic(topic.id)}
              >
                <span className="topic-tile__head">
                  <span className="topic-tile__title">{topic.title}</span>
                  <span className={`badge ${stateBadge}`}>{LEARNING_STATE_LABELS[state]}</span>
                </span>
                <span className="topic-tile__themes">
                  {isLast ? <span className="theme-chip theme-chip--last">上次練習</span> : null}
                  <span className="topic-tile__themeText">
                    {shownThemes.join(" ・ ")}
                    {themeNames.length > shownThemes.length
                      ? ` ＋${themeNames.length - shownThemes.length}`
                      : ""}
                  </span>
                </span>
                <span className="topic-tile__progress">
                  <ProgressBar value={eligible > 0 ? answered / eligible : 0} />
                  <span className="topic-tile__progressText">
                    {eligible > 0
                      ? `題庫進度 ${answered}／${eligible} 條 ・ 練習累計答題 ${topic.progress.answeredQuestions} 題`
                      : `尚未有可作答題目 ・ 練習累計答題 ${topic.progress.answeredQuestions} 題`}
                  </span>
                </span>
                <span className="topic-tile__footer">
                  <span className="topic-tile__meta">
                    共 {countPracticeThemes(topic)} 個主題
                    {topic.materialReady ? "" : " ・ 尚未匯入教材"}
                    {topic.progress.completedSessions > 0
                      ? ` ・ 已完成 ${topic.progress.completedSessions} 次`
                      : ""}
                  </span>
                  <span className="topic-tile__cta">開始練習 ›</span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

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
