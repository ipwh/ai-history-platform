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

const QUESTION_COUNTS = [5, 10, 15];

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
  const [questionTypes, setQuestionTypes] = useState<QuestionType[]>(["mc"]);
  const [difficulty, setDifficulty] = useState<Difficulty>("basic");
  const [questionCount, setQuestionCount] = useState(5);
  const [mode, setMode] = useState<"standard" | "wrong-only">("standard");
  const [questionSource, setQuestionSource] = useState<PracticeQuestionSource>("bank");
  const [demoMode, setDemoMode] = useState<boolean | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<unknown>(null);
  const [failedAttempt, setFailedAttempt] = useState<StartAttempt | null>(null);

  const [reloadToken, setReloadToken] = useState(0);
  const [sourceChangeNotice, setSourceChangeNotice] = useState<string | null>(null);
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
              section && section.children.length > 0
                ? [section.id, ...section.children.map((child) => child.id)]
                : [initialSectionId],
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

  /** 主題 ID → 分節（含子分節），用於判斷所選主題是否仍可出題 */
  const themeById = useMemo(() => {
    const map = new Map<string, SectionWithCount>();
    for (const section of topic?.sections ?? []) {
      map.set(section.id, section);
      for (const child of section.children) map.set(child.id, child);
    }
    return map;
  }, [topic]);

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

  /**
   * 把分節及其主題整理成群組，用於「可多選」介面：
   * 分節有子分節時，以子分節為可選主題；沒有子分節時，分節本身就是一個主題。
   */
  const sectionGroups = useMemo(() => {
    if (!topic) return [];
    return topic.sections.map((section) => {
      const themeIds =
        section.children.length > 0 ? section.children.map((child) => child.id) : [section.id];
      const selectedCount = themeIds.filter((id) => selectedSections.includes(id)).length;
      return {
        section,
        themeIds,
        available: isSectionPractisable(section, questionSource),
        selectedCount,
        allSelected: selectedCount === themeIds.length,
      };
    });
  }, [topic, selectedSections, questionSource]);

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

  const totalSelectedThemes = sectionGroups.reduce((total, group) => total + group.selectedCount, 0);

  function toggleSection(sectionId: string) {
    setSelectedSections((current) =>
      current.includes(sectionId)
        ? current.filter((item) => item !== sectionId)
        : [...current, sectionId],
    );
  }

  /** 選取／取消整個分節（包含分節本身及其全部主題） */
  function toggleGroup(sectionId: string, themeIds: string[], allSelected: boolean) {
    const groupIds = [sectionId, ...themeIds];
    setSelectedSections((current) =>
      allSelected
        ? current.filter((id) => !groupIds.includes(id))
        : [...new Set([...current, ...groupIds])],
    );
  }

  function clearSelection() {
    setSelectedSections([]);
  }

  function toggleType(type: QuestionType) {
    setQuestionTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
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
    if (questionTypes.length === 0) {
      setStartError(new Error("請至少選擇一種題型。"));
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
        questionTypes,
        difficulty,
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
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/" className="text-sm" style={{ color: "var(--accent)" }}>
          ← 返回課題首頁
        </Link>
        <h1 className="text-xl font-bold mt-1">練習設定</h1>
        <p className="text-sm text-gray-600">{topic.title}</p>
      </div>

      <section className="card flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">1. 選擇主題（可多選）</h2>
          <span className="text-xs text-gray-600">
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
        <p className="text-xs text-gray-500">
          每個分節之下有多個主題：可按「全選此分節」一次選取，或逐個主題挑選，系統會按你所選的主題出題。
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

        <div className="flex flex-col gap-3">
          {sectionGroups.map(({ section, themeIds, available, allSelected, selectedCount }) => (
            <div
              key={section.id}
              className="section-group"
              data-complete={allSelected}
              data-empty={!available}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-sm">{section.title}</span>
                {available ? (
                  <button
                    type="button"
                    className="chip text-xs"
                    data-selected={allSelected}
                    onClick={() => toggleGroup(section.id, themeIds, allSelected)}
                  >
                    {section.children.length > 0
                      ? allSelected
                        ? "取消全選"
                        : `全選此分節（${selectedCount}/${themeIds.length}）`
                      : allSelected
                        ? "已選取"
                        : "選取此分節"}
                  </button>
                ) : (
                  <span className="badge badge-warning" title={unavailableReason(section, questionSource)}>
                    {unavailableLabel(section, questionSource)}
                  </span>
                )}
              </div>

              {section.children.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {section.children.map((child) => {
                    const childAvailable = isSectionPractisable(child, questionSource);
                    return (
                      <button
                        key={child.id}
                        type="button"
                        className="chip"
                        data-selected={selectedSections.includes(child.id)}
                        disabled={!childAvailable}
                        title={childAvailable ? undefined : unavailableReason(child, questionSource)}
                        onClick={() => toggleSection(child.id)}
                      >
                        {child.title}
                        {childAvailable ? null : (
                          <span className="text-xs ml-1 opacity-70">
                            （{unavailableLabel(child, questionSource)}）
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="card flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">2. 選擇題型（可多選）</h2>
          <span className="text-xs text-gray-600">已選 {questionTypes.length} 種題型</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {QUESTION_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className="chip"
              data-selected={questionTypes.includes(type)}
              onClick={() => toggleType(type)}
            >
              {QUESTION_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          AI 會按你選取的題型出題（至少要選一種）；題型可多選，想只練一種題型，請把其他已選的題型再按一下取消
          （例如只想練填充題，請取消「選擇題」）。
          短答題不會計入正確率；提交後由 AI 按「得分要點」批改（以意思判斷，用字不同不會直接判錯），
          你仍可按要點自我檢查。
        </p>
      </section>

      <section className="card flex flex-col gap-2">
        <h2 className="font-semibold">3. 選擇難度</h2>
        <div className="flex flex-wrap gap-2">
          {DIFFICULTIES.map((item) => (
            <button
              key={item}
              type="button"
              className="chip"
              data-selected={difficulty === item}
              onClick={() => setDifficulty(item)}
            >
              {DIFFICULTY_LABELS[item]}
            </button>
          ))}
        </div>
      </section>

      <section className="card flex flex-col gap-2">
        <h2 className="font-semibold">4. 題目數量</h2>
        <div className="flex flex-wrap gap-2">
          {QUESTION_COUNTS.map((count) => (
            <button
              key={count}
              type="button"
              className="chip"
              data-selected={questionCount === count}
              onClick={() => setQuestionCount(count)}
            >
              {count} 題
            </button>
          ))}
        </div>
      </section>

      <section className="card flex flex-col gap-2">
        <h2 className="font-semibold">5. 出題方式</h2>
        <div className="flex flex-wrap gap-2">
          {(["ai", "bank"] as const).map((source) => (
            <button
              key={source}
              type="button"
              className="chip"
              data-selected={questionSource === source}
              onClick={() => handleQuestionSourceChange(source)}
              disabled={mode === "wrong-only"}
            >
              {PRACTICE_QUESTION_SOURCE_LABELS[source]}
            </button>
          ))}
        </div>
        {mode === "wrong-only" ? (
          <p className="text-xs text-gray-500">重溫錯題會直接使用你之前的題目。</p>
        ) : questionSource === "ai" ? (
          <p className="text-xs text-gray-500">
            AI 會按你揀選的主題即時出題（每題都會核對教材依據），需時約 10 至 60 秒。
            AI 只會使用已確認可向學生發布的教材，因此教材未開放的主題不能選；
            如需在那些主題練習，請改用「使用題庫題目」。
            {demoMode === true ? " 現時為示範模式，會使用本地示範生成（未使用 AI）。" : null}
          </p>
        ) : (
          <p className="text-xs text-gray-500">
            使用題庫中已發布的題目；若題目不足，系統會按教材內容即時生成補足。
          </p>
        )}
      </section>

      <section className="card flex flex-col gap-2">
        <h2 className="font-semibold">6. 練習模式</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="chip"
            data-selected={mode === "standard"}
            onClick={() => setMode("standard")}
          >
            完整練習
          </button>
          <button
            type="button"
            className="chip"
            data-selected={mode === "wrong-only"}
            onClick={() => setMode("wrong-only")}
          >
            重溫錯題
          </button>
        </div>
        {mode === "wrong-only" ? (
          <Notice>
            只會抽取你之前答錯，或在短答題自我檢查中標記「需要重溫」的題目。
          </Notice>
        ) : null}
      </section>

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

      <div className="flex flex-wrap gap-2 items-center">
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
        <span className="text-xs text-gray-500">
          {questionSource === "ai" && mode === "standard"
            ? "AI 生成需時，請勿關閉頁面。"
            : "題目不足時，系統會按教材內容即時生成，並自動核對教材依據。"}
        </span>
      </div>
    </div>
  );
}


