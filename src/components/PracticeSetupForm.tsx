"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { api, ApiError, getLearnerId } from "@/lib/api-client";
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  PRACTICE_QUESTION_SOURCE_LABELS,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  isSectionPractisable,
  type AssembledPractice,
  type Difficulty,
  type Health,
  type PracticeQuestionSource,
  type QuestionType,
  type SectionWithCount,
  type TopicOverview,
} from "@/lib/types";
import { ErrorNotice, Loading, Notice } from "@/components/ui";

/**
 * 可選題目數量。
 *
 * 只保留 5 題及 10 題：部分課題的教材段落不多，要求太多題目時 AI 只能重複出題或
 * 補題失敗，學生反而會見到「題數不足」的提示（2026-10-20 擁有者指示刪去 15 題）。
 * 預設 10 題（2026-11 擁有者指示）：一次練習覆蓋較多知識點，減少重複開新練習。
 */
const QUESTION_COUNTS = [10, 5];

interface StartAttempt {
  mode: "standard" | "wrong-only";
  questionSource: PracticeQuestionSource;
}

/**
 * 主題不可選時的原因。
 *
 * 「教材未開放給學生」（版權閘門）與「未匯入教材」對學生是兩件不同的事：前者要改用
 * 題庫題目或請教師開放，後者只能改用其他主題。若一律顯示「未有教材」，學生會以為
 * 平台沒有內容，而不是教材尚未通過版權確認。
 */
function unavailableReason(
  section: SectionWithCount,
  source: PracticeQuestionSource,
): string {
  if (section.materialBlockCount === 0) {
    return "此主題暫未匯入教材，教師可在後台補充";
  }
  if (source === "ai") {
    return "此主題的教材仍未開放給學生，AI 不能據此出題；可改用「使用題庫題目」或請歷史科教師開放教材";
  }
  return "此主題暫時沒有已發布的題目，教師可在後台發布題目或開放教材";
}

/** 主題不可選時顯示的短標示（與 unavailableReason 對應） */
function unavailableLabel(section: SectionWithCount, source: PracticeQuestionSource): string {
  if (section.materialBlockCount === 0) return "未有教材";
  return source === "ai" ? "AI 未開放" : "未有題目";
}

/**
 * 開始練習失敗時，給學生可行動的下一步。
 *
 * 原則：**不重複同一組設定**（否則只會再失敗一次）、不假造題目，並在教材未開放時
 * 明確告知可改用的替代方式，而不是只顯示錯誤訊息。
 */
function describeStartFailure(
  error: unknown,
  attempt: StartAttempt | null,
): { heading: string; lines: string[]; canSwitchToBank: boolean; canSwitchToStandard: boolean } | null {
  if (!attempt) return null;
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof ApiError ? error.status : 0;

  // 錯題不足：建議先做一次完整練習
  if (status === 409 && message.includes("錯題")) {
    return {
      heading: "目前沒有可以重做的錯題",
      lines: [
        "先完成一次完整練習，之後答錯或標記「需要重溫」的題目就會出現在這裡。",
        "你也可以改選其他主題後再試。",
      ],
      canSwitchToBank: false,
      canSwitchToStandard: true,
    };
  }

  // 教材尚未開放給學生（版權或內容審核中）：不可改用未確認的教材頂替
  if (status === 409 && message.includes("尚未開放學生使用")) {
    return {
      heading: "所選主題的教材仍未開放給學生使用",
      lines: [
        "教師仍在確認教材的版權及內容，因此系統不會用這些教材出題。",
        "你可以：改用「使用題庫題目」（內建示範題目及教師已核可的題目）、改選其他主題，或請歷史科教師開放教材。",
      ],
      canSwitchToBank: attempt.questionSource === "ai",
      canSwitchToStandard: false,
    };
  }

  // 分節沒有可用題目
  if (status === 409) {
    return {
      heading: "所選主題暫時沒有可用題目",
      lines: [
        "試試其他主題、其他題型或不同難度；若全部主題都是這樣，請向歷史科教師反映。",
      ],
      canSwitchToBank: attempt.questionSource === "ai",
      canSwitchToStandard: false,
    };
  }

  // AI 用量上限（防濫用配額）
  if (status === 429) {
    return {
      heading: "短時間內的 AI 出題次數已達上限",
      lines: [
        "稍後可以再試，或先改用「使用題庫題目」練習（不會消耗 AI 額度）。",
      ],
      canSwitchToBank: attempt.questionSource === "ai",
      canSwitchToStandard: false,
    };
  }

  // AI 生成失敗或逾時
  if (status === 502) {
    return {
      heading: "這次未能為所選主題準備題目",
      lines: [
        "可能與主題的教材內容、題數或 AI 服務忙碌有關。",
        "可以減少題目數量、改選其他主題後再試一次，或改用「使用題庫題目」。",
      ],
      canSwitchToBank: attempt.questionSource === "ai",
      canSwitchToStandard: false,
    };
  }

  return null;
}

export function PracticeSetupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTopicId = searchParams.get("topic") ?? "";
  const initialSectionId = searchParams.get("section") ?? "";

  const [topic, setTopic] = useState<TopicOverview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selectedSections, setSelectedSections] = useState<string[]>([]);
  // 一次只練一種題型：選擇題可按難度調節；填充題以課本關鍵詞作答，不設難度。
  const [questionType, setQuestionType] = useState<QuestionType>("mc");
  const [difficulty, setDifficulty] = useState<Difficulty>("basic");
  const [questionCount, setQuestionCount] = useState(10);
  const [mode, setMode] = useState<"standard" | "wrong-only">("standard");
  const [questionSource, setQuestionSource] = useState<PracticeQuestionSource>("bank");
  const [demoMode, setDemoMode] = useState<boolean | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<unknown>(null);
  const [failedAttempt, setFailedAttempt] = useState<StartAttempt | null>(null);

  const [reloadToken, setReloadToken] = useState(0);
  const [sourceChangeNotice, setSourceChangeNotice] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const customSettingsRef = useRef<HTMLDetailsElement | null>(null);
  const initialSelectionApplied = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const learnerId = getLearnerId();
    const request: Promise<TopicOverview | null> = initialTopicId
      ? api
          .get<{ topic: TopicOverview }>(`/api/topics/${initialTopicId}?learnerId=${learnerId}`)
          .then((data) => data.topic)
      : api
          .get<{ topics: TopicOverview[] }>(`/api/topics?learnerId=${learnerId}`)
          .then((data) => data.topics[0] ?? null);

    request
      .then((value) => {
        if (cancelled) return;
        setTopic(value);
        setError(null);

        // 由首頁帶來的 ?section= 可能是分節或主題：分節會展開為它全部主題
        if (value && !initialSelectionApplied.current) {
          initialSelectionApplied.current = true;
          if (initialSectionId) {
            const section = value.sections.find((item) => item.id === initialSectionId);
            setSelectedSections(
              section
                ? section.children.length > 0
                  ? section.children.map((child) => child.id)
                  : [section.id]
                : [],
            );
          }
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught);
      });

    return () => {
      cancelled = true;
    };
  }, [initialTopicId, initialSectionId, reloadToken]);

  // 已設定 AI provider 時，預設以 AI 按所選主題即時生成題目
  useEffect(() => {
    let cancelled = false;
    api
      .get<Health>("/api/health")
      .then((health) => {
        if (cancelled) return;
        setDemoMode(health.demoMode);
        // 已接上真正的 AI provider 時，預設由 AI 按所選主題即時出題
        setQuestionSource(health.demoMode ? "bank" : "ai");
      })
      .catch(() => {
        if (!cancelled) setDemoMode(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 課題內可選的主題：分節有子分節時，以子分節為主題；
   * 沒有子分節時，分節本身就是一個主題。
   */
  const themes = useMemo<SectionWithCount[]>(
    () =>
      (topic?.sections ?? []).flatMap((section) =>
        section.children.length > 0 ? section.children : [section],
      ),
    [topic],
  );

  /** 主題 ID → 主題，用於判斷所選主題是否仍可出題 */
  const themeById = useMemo(() => new Map(themes.map((theme) => [theme.id, theme])), [themes]);

  /**
   * 已選、但依目前出題方式無法出題的主題。
   *
   * 反白的晶片已不能按，但學生可能先選好主題再切換出題方式（或由首頁連結直接帶入主題），
   * 因此仍需把這個情況顯示出來，而不是等到按下「開始練習」才失敗。
   */
  const blockedSelectedThemes = useMemo(
    () =>
      selectedSections
        .map((id) => themeById.get(id))
        .filter((section): section is SectionWithCount => section !== undefined)
        .filter((section) => !isSectionPractisable(section, questionSource)),
    [selectedSections, themeById, questionSource],
  );

  /** 切換出題方式：AI 只能使用已開放給學生的教材，因此同時取消不可用的主題 */
  function handleQuestionSourceChange(source: PracticeQuestionSource) {
    setQuestionSource(source);
    setSourceChangeNotice(null);
    if (source !== "ai") return;
    const blocked = selectedSections.filter((id) => {
      const section = themeById.get(id);
      return section !== undefined && !isSectionPractisable(section, "ai");
    });
    if (blocked.length === 0) return;
    setSelectedSections((current) => current.filter((id) => !blocked.includes(id)));
    setSourceChangeNotice(
      `已取消 ${blocked.length} 個主題：它們的教材仍未開放給學生，AI 不能據此出題。` +
        "可改用「使用題庫題目」練習，或請歷史科教師開放教材。",
    );
  }

  const totalSelectedThemes = selectedSections.length;

  function toggleTheme(themeId: string) {
    setSelectedSections((current) =>
      current.includes(themeId)
        ? current.filter((item) => item !== themeId)
        : [...current, themeId],
    );
  }

  function clearSelection() {
    setSelectedSections([]);
  }

  function selectType(type: QuestionType) {
    setQuestionType(type);
  }

  async function startPractice(
    source: PracticeQuestionSource,
    attemptMode: "standard" | "wrong-only",
  ): Promise<void> {
    if (!topic) return;
    if (selectedSections.length === 0) {
      setStartError(new Error("請至少選擇一個主題。"));
      return;
    }

    setStarting(true);
    setStartError(null);
    setFailedAttempt(null);
    try {
      const practice = await api.post<AssembledPractice>("/api/practice", {
        learnerId: getLearnerId(),
        topicId: topic.id,
        sectionIds: selectedSections,
        questionTypes: [questionType],
        // 填充題不設難度：一律以「基礎」送出，避免留下一個學生無法選擇的難度值。
        difficulty: questionType === "mc" ? difficulty : "basic",
        questionCount,
        mode: attemptMode,
        questionSource: source,
        sourceSessionId: null,
      });
      router.push(`/practice/${practice.session.id}`);
    } catch (caught) {
      setStartError(caught);
      setFailedAttempt({ mode: attemptMode, questionSource: source });
    } finally {
      setStarting(false);
    }
  }

  async function handleStart() {
    await startPractice(questionSource, mode);
  }

  const guidance = describeStartFailure(startError, failedAttempt);

  if (error) return <ErrorNotice error={error} onRetry={() => setReloadToken((t) => t + 1)} />;
  if (!topic) return <Loading label="正在載入練習設定…" />;

  return (
    <div className="flex flex-col gap-4" data-section="practice">
      <header className="page-head">
        <Link href="/" className="text-sm" style={{ color: "var(--accent)" }}>
          ← 返回課題首頁
        </Link>
        <p className="eyebrow">練習 · {topic.title}</p>
        <h1 className="page-title">練習設定</h1>
        <p className="page-sub">先選擇主題，然後按「開始練習」。其餘設定已為你選好，需要時才展開。</p>
      </header>

      <section className="quick-start">
        <div>
          <p className="quick-start__title">可以開始了</p>
          <p className="quick-start__hint">
            {totalSelectedThemes === 0
              ? "請先在下方選擇至少一個主題。"
              : `已選 ${totalSelectedThemes} 個主題，將按以下設定出題。`}
          </p>
        </div>
        <div className="preset-row" aria-label="目前練習設定">
          <span className="preset-pill">{questionCount} 題</span>
          <span className="preset-pill">{QUESTION_TYPE_LABELS[questionType]}</span>
          {questionType === "mc" ? (
            <span className="preset-pill">{DIFFICULTY_LABELS[difficulty]}</span>
          ) : (
            <span className="preset-pill">以關鍵詞作答</span>
          )}
          <span className="preset-pill">{PRACTICE_QUESTION_SOURCE_LABELS[questionSource]}</span>
          <span className="preset-pill">
            {mode === "wrong-only" ? "重溫錯題" : "完整練習"}
          </span>
        </div>
        <div className="quick-start__actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleStart()}
            disabled={starting}
          >
            {starting
              ? questionSource === "ai" && mode === "standard"
                ? "AI 正在按你揀選的主題生成題目…"
                : "正在準備題目…"
              : "開始練習"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (!customSettingsRef.current) return;
              customSettingsRef.current.open = true;
              setCustomOpen(true);
              customSettingsRef.current.scrollIntoView({ block: "start", behavior: "smooth" });
            }}
          >
            自訂設定
          </button>
          <span className="text-meta">
            {questionSource === "ai" && mode === "standard"
              ? "AI 生成需時（約 10 至 60 秒），請勿關閉頁面。"
              : "題目不足時，系統會按教材即時生成，並自動核對教材依據。"}
          </span>
        </div>
      </section>

      <section className="card card--accent flex flex-col gap-3">
        <div className="card__heading">
          <div className="flex flex-wrap items-center gap-2">
            <span className="step-no" aria-hidden="true">
              1
            </span>
            <h2 className="card__title">選擇主題（可多選）</h2>
          </div>
          <span className="text-meta">
            已選 {totalSelectedThemes} 個主題
            {totalSelectedThemes > 0 ? (
              <button
                type="button"
                className="ml-2 underline"
                style={{ color: "var(--accent)" }}
                onClick={clearSelection}
              >
                清除選擇
              </button>
            ) : null}
          </span>
        </div>
        <p className="text-meta">
          系統會按你所選的主題出題；課題下的每個主題都會直接列出，可多選。
          反白的主題目前未能出題（未有教材，或教材仍未開放給學生），可改用其他主題或題庫題目。
        </p>

        {sourceChangeNotice ? <Notice tone="warning">{sourceChangeNotice}</Notice> : null}

        {blockedSelectedThemes.length > 0 ? (
          <Notice tone="warning">
            <p>
              已選的主題中有 {blockedSelectedThemes.length} 個在目前的出題方式下無法出題
              {questionSource === "ai" ? "（教材仍未開放給學生）" : null}
              。請改用「使用題庫題目」、改選其他主題，或先取消這些主題。
            </p>
            <button
              type="button"
              className="btn mt-2"
              onClick={() =>
                setSelectedSections((current) =>
                  current.filter(
                    (id) => !blockedSelectedThemes.some((section) => section.id === id),
                  ),
                )
              }
            >
              取消這 {blockedSelectedThemes.length} 個主題
            </button>
          </Notice>
        ) : null}

        {themes.length === 0 ? (
          <p className="text-body">此課題暫未設定主題，請聯絡歷史科教師。</p>
        ) : (
          <div className="choice-grid">
            {themes.map((theme) => {
              const available = isSectionPractisable(theme, questionSource);
              const selected = selectedSections.includes(theme.id);
              return (
                <button
                  key={theme.id}
                  type="button"
                  className="chip"
                  data-selected={selected}
                  aria-pressed={selected}
                  disabled={!available}
                  title={available ? undefined : unavailableReason(theme, questionSource)}
                  onClick={() => toggleTheme(theme.id)}
                >
                  {theme.title}
                  {available ? null : (
                    <span className="text-xs opacity-70">
                      （{unavailableLabel(theme, questionSource)}）
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <details
        className="settings-group"
        ref={customSettingsRef}
        open={customOpen}
        onToggle={(event) => setCustomOpen(event.currentTarget.open)}
      >
        <summary>自訂設定（題型、難度、題數、出題方式、練習模式）</summary>
        <div className="settings-group__body">

        <div className="settings-step">
          <div className="settings-step__head">
            <span className="step-no" aria-hidden="true">
              2
            </span>
            <span className="step-label">選擇題型（一次一種）</span>
            <span className="text-meta">已選：{QUESTION_TYPE_LABELS[questionType]}</span>
          </div>
          <div className="choice-grid">
            {QUESTION_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                className="chip"
                data-selected={questionType === type}
                aria-pressed={questionType === type}
                onClick={() => selectType(type)}
              >
                {QUESTION_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
          <p className="text-meta">
            一次只練一種題型。選擇題可調節難度；填充題以課本關鍵詞作答，不設難度。
            填充題提交後會由 AI 按意思批改，用字不同不會直接判錯。
          </p>
        </div>

        <div className="settings-step">
          <div className="settings-step__head">
            <span className="step-no" aria-hidden="true">
              3
            </span>
            <span className="step-label">選擇難度</span>
          </div>
          {questionType === "mc" ? (
            <>
              <div className="choice-grid">
                {DIFFICULTIES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="chip"
                    data-selected={difficulty === item}
                    aria-pressed={difficulty === item}
                    onClick={() => setDifficulty(item)}
                  >
                    {DIFFICULTY_LABELS[item]}
                  </button>
                ))}
              </div>
              <p className="text-meta">
                所選難度會用於出題；題庫該難度不足時，系統會按所選難度即時生成，不會直接改用其他難度。
              </p>
            </>
          ) : (
            <p className="text-meta">填充題不設難度，系統會按教材的關鍵詞出題。</p>
          )}
        </div>

        <div className="settings-step">
          <div className="settings-step__head">
            <span className="step-no" aria-hidden="true">
              4
            </span>
            <span className="step-label">題目數量</span>
          </div>
          <div className="choice-grid">
            {QUESTION_COUNTS.map((count) => (
              <button
                key={count}
                type="button"
                className="chip"
                data-selected={questionCount === count}
                aria-pressed={questionCount === count}
                onClick={() => setQuestionCount(count)}
              >
                {count} 題
              </button>
            ))}
          </div>
        </div>

        <div className="settings-step">
          <div className="settings-step__head">
            <span className="step-no" aria-hidden="true">
              5
            </span>
            <span className="step-label">出題方式</span>
          </div>
          <div className="choice-grid">
            {(["ai", "bank"] as const).map((source) => (
              <button
                key={source}
                type="button"
                className="chip"
                data-selected={questionSource === source}
                aria-pressed={questionSource === source}
                onClick={() => handleQuestionSourceChange(source)}
                disabled={mode === "wrong-only"}
              >
                {PRACTICE_QUESTION_SOURCE_LABELS[source]}
              </button>
            ))}
          </div>
          {mode === "wrong-only" ? (
            <p className="text-meta">重溫錯題會直接使用你之前的題目。</p>
          ) : questionSource === "ai" ? (
            <p className="text-meta">
              AI 會按你揀選的主題即時出題（每題都會核對教材依據），需時約 10 至 60 秒。
              AI 只會使用已確認可向學生發布的教材，因此教材未開放的主題不能選；
              如需在那些主題練習，請改用「使用題庫題目」。
              {demoMode === true ? " 現時為示範模式，會使用本地示範生成（未使用 AI）。" : null}
            </p>
          ) : (
            <p className="text-meta">
              使用題庫中已發布的題目；所選難度（選擇題）的題目不足時，系統會按該難度即時生成補足
              （需時約 10 至 60 秒），仍然不足才加入其他難度並如實說明。
            </p>
          )}
        </div>

        <div className="settings-step">
          <div className="settings-step__head">
            <span className="step-no" aria-hidden="true">
              6
            </span>
            <span className="step-label">練習模式</span>
          </div>
          <div className="choice-grid">
            <button
              type="button"
              className="chip"
              data-selected={mode === "standard"}
              aria-pressed={mode === "standard"}
              onClick={() => setMode("standard")}
            >
              完整練習
            </button>
            <button
              type="button"
              className="chip"
              data-selected={mode === "wrong-only"}
              aria-pressed={mode === "wrong-only"}
              onClick={() => setMode("wrong-only")}
            >
              重溫錯題
            </button>
          </div>
          {mode === "wrong-only" ? <Notice>只會抽取你之前答錯的題目。</Notice> : null}
        </div>
        </div>
      </details>

      {startError ? (
        guidance ? (
          <Notice tone="warning">
            <p className="font-semibold">未能開始練習：{guidance.heading}</p>
            <ul className="list-disc pl-5 mt-1 text-sm">
              {guidance.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2 mt-3">
              {guidance.canSwitchToBank ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={starting}
                  onClick={() => {
                    setQuestionSource("bank");
                    void startPractice("bank", mode);
                  }}
                >
                  改用題庫題目再試一次
                </button>
              ) : null}
              {guidance.canSwitchToStandard ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={starting}
                  onClick={() => {
                    setMode("standard");
                    void startPractice(questionSource, "standard");
                  }}
                >
                  改用完整練習
                </button>
              ) : null}
              <button
                type="button"
                className="btn"
                disabled={starting || selectedSections.length === 0}
                onClick={clearSelection}
              >
                改選其他主題
              </button>
            </div>
          </Notice>
        ) : (
          <ErrorNotice error={startError} />
        )
      ) : null}

      <div className="action-bar action-bar--mobile-only">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void handleStart()}
          disabled={starting}
        >
          {starting
            ? questionSource === "ai" && mode === "standard"
              ? "AI 正在出題…"
              : "正在準備題目…"
            : `開始練習（${questionCount} 題）`}
        </button>
        <span className="action-bar__note">
          {totalSelectedThemes === 0 ? "請先選擇主題" : `${totalSelectedThemes} 個主題`}
        </span>
      </div>
    </div>
  );
}


