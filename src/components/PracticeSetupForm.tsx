"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { api, getLearnerId } from "@/lib/api-client";
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
  type TopicOverview,
} from "@/lib/types";
import { ErrorNotice, Loading, Notice } from "@/components/ui";

const QUESTION_COUNTS = [5, 10, 15];

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

  const [reloadToken, setReloadToken] = useState(0);
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
        available: isSectionPractisable(section),
        selectedCount,
        allSelected: selectedCount === themeIds.length,
      };
    });
  }, [topic, selectedSections]);

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

  async function handleStart() {
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
    try {
      const practice = await api.post<AssembledPractice>("/api/practice", {
        learnerId: getLearnerId(),
        topicId: topic.id,
        sectionIds: selectedSections,
        questionTypes,
        difficulty,
        questionCount,
        mode,
        questionSource,
        sourceSessionId: null,
      });
      router.push(`/practice/${practice.session.id}`);
    } catch (caught) {
      setStartError(caught);
    } finally {
      setStarting(false);
    }
  }

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
        </p>

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
                  <span className="badge badge-warning" title="此分節暫未匯入教材，教師可在後台補充">
                    未有教材
                  </span>
                )}
              </div>

              {section.children.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {section.children.map((child) => {
                    const childAvailable = isSectionPractisable(child);
                    return (
                      <button
                        key={child.id}
                        type="button"
                        className="chip"
                        data-selected={selectedSections.includes(child.id)}
                        disabled={!childAvailable}
                        title={
                          childAvailable ? undefined : "此主題暫未匯入教材，教師可在後台補充"
                        }
                        onClick={() => toggleSection(child.id)}
                      >
                        {child.title}
                        {childAvailable ? null : (
                          <span className="text-xs ml-1 opacity-70">（未有教材）</span>
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
        <h2 className="font-semibold">2. 選擇題型</h2>
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
              onClick={() => setQuestionSource(source)}
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

      {startError ? <ErrorNotice error={startError} /> : null}

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


