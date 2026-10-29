"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api-client";
import { compareLearnersByClass, formLevelLabel, formLevelOf } from "@/lib/learner-ordering";
import { learnerAccuracyLabel, practiceTopicLabel } from "@/lib/practice-summary";
import type {
  PracticeRecordLearner,
  PracticeRecordSession,
  PracticeRecordTopicOption,
} from "@/lib/types";
import { ErrorNotice, Loading, Notice, StatBox } from "@/components/ui";

interface RecordsResponse {
  records: PracticeRecordSession[];
  topics: PracticeRecordTopicOption[];
  learners: PracticeRecordLearner[];
  rosterNotice: string | null;
  rosterSource: "live" | "snapshot" | "none";
}

interface Filters {
  topicId: string;
  learnerId: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { topicId: "", learnerId: "", from: "", to: "" };

function learnerName(learner: PracticeRecordLearner): string {
  return learner.name || learner.email || `匿名 ${learner.learnerId.slice(0, 8)}`;
}

function learnerDetails(learner: PracticeRecordLearner): string {
  return [
    learner.studentNumber ? `學號 ${learner.studentNumber}` : "",
    learner.email ?? "",
    learner.email ? "" : learner.learnerId,
  ]
    .filter(Boolean)
    .join(" ・ ");
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-HK", { hour12: false });
}

function learnerActivity(learner: PracticeRecordLearner): {
  label: string;
  className: string;
  daysInactive: number | null;
} {
  if (learner.sessions === 0) {
    return { label: "尚未開始", className: "badge", daysInactive: null };
  }
  const timestamp = new Date(learner.lastAt).getTime();
  if (!Number.isFinite(timestamp)) {
    return { label: "日期不明", className: "badge", daysInactive: null };
  }
  const daysInactive = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  if (daysInactive >= 14) {
    return { label: "14 日以上未活動", className: "badge badge-danger", daysInactive };
  }
  if (daysInactive >= 7) {
    return { label: "7 日以上未活動", className: "badge badge-warning", daysInactive };
  }
  return { label: "活躍", className: "badge badge-success", daysInactive };
}

function queryString(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.topicId) params.set("topicId", filters.topicId);
  if (filters.learnerId) params.set("learnerId", filters.learnerId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return params.toString();
}

function outcomeBadge(record: PracticeRecordSession["questions"][number]) {
  if (!record.answered) return { label: "未作答", className: "badge" };
  if (record.isCorrect === true) return { label: "答對", className: "badge badge-success" };
  if (record.isCorrect === false) return { label: "答錯", className: "badge badge-danger" };
  return {
    label: record.selfAssessment === "needs-review" ? "需重溫" : "待自我檢查",
    className: "badge badge-warning",
  };
}

/** 選擇題選項的 A／B／C／D 標記（與學生作答時看到的次序一致） */
function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** 需要與學生逐題回顧的題目：答錯或未作答 */
function needsReview(question: PracticeRecordSession["questions"][number]): boolean {
  return !question.answered || question.isCorrect === false;
}

/** 教師端：學生練習記錄查閱及下載（作答日期、課題、題型、答對及答錯的題目） */
export function TeacherRecords() {
  const [data, setData] = useState<RecordsResponse | null>(null);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string[]>([]);
  // 與學生回顧時通常只需要逐題看錯題及未作答的題目
  const [wrongOnly, setWrongOnly] = useState(false);
  const [classFilter, setClassFilter] = useState("");
  const [formFilter, setFormFilter] = useState("");
  const [learnerSearch, setLearnerSearch] = useState("");
  const [activityFilter, setActivityFilter] = useState("");
  // 名冊可能有數百名學生；先顯示 50 人，避免手機一次渲染整份名單。
  const [listLimit, setListLimit] = useState(50);
  /**
   * 「學習者使用概況」（名冊清單）預設收合：選定學習者後只需看逐題記錄，
   * 不應每次都要越過整份名冊表才看到查詢結果。
   */
  const [overviewOpen, setOverviewOpen] = useState(false);
  const recordsRef = useRef<HTMLDivElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  // 每次查詢的流水號；見 handleQuery（避免較慢的舊請求覆蓋新結果）
  const requestSequence = useRef(0);
  // 每次查詢後遞增並指定捲動位置；畫面更新後才捲動，避免捲到尚未更新的內容。
  const [scrollRequest, setScrollRequest] = useState<{
    target: "results" | "records";
    token: number;
  } | null>(null);

  const fetchRecords = useCallback(async (filters: Filters): Promise<RecordsResponse> => {
    const query = queryString(filters);
    return api.get<RecordsResponse>(`/api/teacher/records${query ? `?${query}` : ""}`);
  }, []);

  // 首次載入：在 promise 回呼內更新狀態，避免在 effect 內同步 render
  useEffect(() => {
    let cancelled = false;
    fetchRecords(EMPTY_FILTERS)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchRecords]);

  /**
   * 查詢記錄後的捲動。
   *
   * focusLearnerId 有值時（按下某位學習者的「查看記錄」）捲到逐題作答；否則捲到統計區，
   * 令「查詢記錄」按下去一定有反應——不再停留在名冊列表。
   */
  useEffect(() => {
    if (scrollRequest === null) return;
    const element = scrollRequest.target === "records" ? recordsRef.current : resultsRef.current;
    element?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollRequest]);

  const handleQuery = async (
    filters: Filters,
    options: { focusLearnerId?: string } = {},
  ) => {
    /**
     * 每次查詢都取得一個流水號；回覆回來時若已有更新的查詢，就丟棄這次結果。
     *
     * 學習者選單改為「選好即查詢」後，老師可能連續點選幾位學生；沒有這個守衛時，
     * 較慢的舊請求會覆蓋較新的結果，畫面顯示的學生與選單不一致。
     */
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setLoading(true);
    try {
      const result = await fetchRecords(filters);
      if (sequence !== requestSequence.current) return;
      setData(result);
      setApplied(filters);
      setError(null);
      // 選定某位學習者後收起名冊清單，讓逐題記錄緊接統計出現
      if (filters.learnerId && filters.learnerId !== applied.learnerId) setOverviewOpen(false);
      if (options.focusLearnerId !== undefined) {
        setExpanded(result.records.map((record) => record.sessionId));
        setScrollRequest((current) => ({ target: "records", token: (current?.token ?? 0) + 1 }));
      } else {
        setScrollRequest((current) => ({ target: "results", token: (current?.token ?? 0) + 1 }));
      }
    } catch (caught) {
      if (sequence !== requestSequence.current) return;
      setError(caught);
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  };

  const toggle = (sessionId: string) => {
    setExpanded((current) =>
      current.includes(sessionId)
        ? current.filter((id) => id !== sessionId)
        : [...current, sessionId],
    );
  };

  if (error) return <ErrorNotice error={error} />;

  const records = data?.records ?? [];
  const learners = data?.learners ?? [];
  const topics = data?.topics ?? [];
  const classes = [...new Set(learners.map((learner) => learner.className).filter(
    (className): className is string => Boolean(className),
  ))].sort((left, right) => left.localeCompare(right, "zh-HK"));
  /** 名冊內出現過的班級（中一、中二…），依級別數字排序 */
  const forms = [...new Set(learners.map((learner) => formLevelOf(learner.className)).filter(
    (level): level is string => Boolean(level),
  ))].sort((left, right) => Number(left) - Number(right));
  /** 選了班級時，「班別」只列出該級的班，避免出現「中一＋2A」這種必然沒有結果的組合 */
  const classesForForm = classes.filter(
    (className) => !formFilter || formLevelOf(className) === formFilter,
  );
  const visibleLearners = learners.filter((learner) => {
    const matchesClass = !classFilter
      || (classFilter === "__unlisted" ? !learner.className : learner.className === classFilter);
    const matchesForm = !formFilter || formLevelOf(learner.className) === formFilter;
    const search = learnerSearch.trim().toLocaleLowerCase();
    const matchesSearch =
      !search ||
      [learner.name, learner.studentNumber, learner.email, learner.learnerId]
        .some((value) => value?.toLocaleLowerCase().includes(search));
    const activity = learnerActivity(learner);
    const matchesActivity =
      !activityFilter ||
      (activityFilter === "inactive"
        ? activity.daysInactive !== null && activity.daysInactive >= 14
        : activityFilter === "low"
          ? activity.daysInactive !== null && activity.daysInactive >= 7 && activity.daysInactive < 14
          : activityFilter === "active"
            ? activity.daysInactive !== null && activity.daysInactive < 7
            : activityFilter === "never-started"
              ? learner.sessions === 0
              : false);
    return matchesClass && matchesForm && matchesSearch && matchesActivity;
  });
  const correctTotal = records.reduce((sum, record) => sum + record.correctCount, 0);
  const wrongTotal = records.reduce((sum, record) => sum + record.wrongCount, 0);
  const learnerCountInRecords = new Set(records.map((record) => record.learnerId)).size;
  const notStartedCount = learners.filter((learner) => learner.sessions === 0).length;
  const learnerById = new Map(learners.map((learner) => [learner.learnerId, learner]));
  /**
   * 「學習者」選單的選項＝已用快篩收窄的清單。
   *
   * 若現時選取的學習者被快篩排除（例如選了人之後再改班別），仍要把他留在選單內，
   * 否則下拉會變成空白，看起來像沒有選人。
   */
  const selectedLearner = draft.learnerId ? learnerById.get(draft.learnerId) : undefined;
  const learnerOptions = [
    ...(selectedLearner &&
    !visibleLearners.some((learner) => learner.learnerId === selectedLearner.learnerId)
      ? [...visibleLearners, selectedLearner]
      : visibleLearners),
    // 選單按班級、班別、班號排列，方便老師逐班核對（見 lib/learner-ordering）
  ].sort(compareLearnersByClass);
  const topicLabelById = new Map(topics.map((topic) => [topic.id, practiceTopicLabel(topic)]));
  /**
   * 匯出使用**目前選擇的篩選**（`draft`），不是上次查詢的條件。
   *
   * 2026-10-22 用家回報「匯出的資料與所選的學生無關」：老師在「學習者」下拉選單
   * 選了某位學生但未按「查詢記錄」，匯出仍用上一次已套用的條件（多數是「全部學習者」）。
   * 現在連結以下拉選單的值為準，按下時同時套用查詢，畫面與檔案保持一致。
   */
  const exportHref = (format: "xlsx" | "docx" | "pdf" | "csv"): string => {
    const params = new URLSearchParams(queryString(draft));
    params.set("format", format);
    return `/api/teacher/records/export?${params.toString()}`;
  };
  const filtersPending = queryString(draft) !== queryString(applied);
  /** 篩選條件的中文摘要（課題、學習者、日期），供畫面說明「現在顯示／將匯出」的是甚麼 */
  const scopeText = (filters: Filters): string =>
    [
      filters.topicId ? topicLabelById.get(filters.topicId) ?? filters.topicId : "全部課題",
      filters.learnerId
        ? (() => {
            const learner = learnerById.get(filters.learnerId);
            return learner
              ? [learnerName(learner), learner.className, learner.studentNumber].filter(Boolean).join("・")
              : filters.learnerId;
          })()
        : "全部學習者",
      filters.from || filters.to ? `日期 ${filters.from || "不限"} 至 ${filters.to || "不限"}` : "",
    ]
      .filter(Boolean)
      .join("、");
  const exportScope = scopeText(draft);
  const activeScope = scopeText(applied);
  const activeLearner = applied.learnerId ? learnerById.get(applied.learnerId) : undefined;
  const activeLearnerName =
    activeLearner?.name ||
    activeLearner?.email ||
    activeLearner?.learnerId ||
    applied.learnerId;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold">學生練習記錄</h1>
        <span className="text-sm text-gray-600">
          目前顯示：{activeScope}
        </span>
      </div>

      {data?.rosterNotice ? <Notice tone="warning">{data.rosterNotice}</Notice> : null}

      <section className="card flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <h2 className="font-semibold">篩選</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">
              班別
              <select
                value={classFilter}
                onChange={(event) => {
                  setClassFilter(event.target.value);
                  setListLimit(50);
                }}
              >
                <option value="">全部班別</option>
                {classesForForm.map((className) => (
                  <option key={className} value={className}>{className}</option>
                ))}
                <option value="__unlisted">未列入名冊</option>
              </select>
            </label>
            <label className="text-sm">
              班級
              <select
                value={formFilter}
                onChange={(event) => {
                  const nextForm = event.target.value;
                  setFormFilter(nextForm);
                  // 由「中一」改為「中二」時，原本選着的 1A 已不屬於新班級，要一併清除，
                  // 否則畫面同時套用兩個互斥條件，只會顯示「沒有符合條件的學習者」。
                  if (classFilter && nextForm && formLevelOf(classFilter) !== nextForm) {
                    setClassFilter("");
                  }
                  setListLimit(50);
                }}
              >
                <option value="">全部班級</option>
                {forms.map((level) => (
                  <option key={level} value={level}>{formLevelLabel(level)}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              搜尋學習者（姓名／學號／電郵）
              <input
                type="search"
                value={learnerSearch}
                onChange={(event) => {
                  setLearnerSearch(event.target.value);
                  setListLimit(50);
                }}
                placeholder="輸入姓名、學號或電郵"
              />
            </label>
            <label className="text-sm">
              學習者
              <select
                value={draft.learnerId}
                onChange={(event) => {
                  const filters = { ...draft, learnerId: event.target.value };
                  setDraft(filters);
                  // 選好學習者後立即查詢並捲到逐題記錄，不必再按「查詢記錄」
                  void handleQuery(filters, {
                    focusLearnerId: filters.learnerId === "" ? undefined : filters.learnerId,
                  });
                }}
              >
                <option value="">全部學習者（{learnerOptions.length} 位）</option>
                {learnerOptions.map((learner) => (
                  <option key={learner.learnerId} value={learner.learnerId}>
                    {[learner.name || learner.email || learner.learnerId, learner.className, learner.studentNumber]
                      .filter(Boolean)
                      .join(" ・ ")}（{learner.sessions} 次）
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-gray-500">
            「班別」「班級」及搜尋只收窄「學習者」選單及「學習者使用概況」清單，<strong>不會改變已查詢的記錄</strong>；
            選定「學習者」則會即時查詢他的記錄。要改變記錄範圍請用課題及日期。
          </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">
            課題
            <select
              value={draft.topicId}
              onChange={(event) => setDraft({ ...draft, topicId: event.target.value })}
            >
              <option value="">全部課題</option>
              {topics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {practiceTopicLabel(topic)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            活動狀態
            <select
              value={activityFilter}
              onChange={(event) => {
                setActivityFilter(event.target.value);
                setListLimit(50);
              }}
            >
              <option value="">全部狀態</option>
              <option value="active">近 7 日活躍</option>
              <option value="low">7–13 日未活動</option>
              <option value="inactive">14 日以上未活動</option>
              <option value="never-started">尚未開始</option>
            </select>
          </label>
          <label className="text-sm">
            開始日期
            <input
              type="date"
              value={draft.from}
              onChange={(event) => setDraft({ ...draft, from: event.target.value })}
            />
          </label>
          <label className="text-sm">
            結束日期
            <input
              type="date"
              value={draft.to}
              onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            />
          </label>
        </div>
        <p className="text-xs text-gray-500">
          「活動狀態」只收窄下面的「學習者使用概況」清單，<strong>不會改變已查詢的記錄</strong>。
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleQuery(draft)}
            disabled={loading}
          >
            {loading ? "查詢中…" : "查詢記錄"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDraft(EMPTY_FILTERS);
              setClassFilter("");
              setFormFilter("");
              setLearnerSearch("");
              setActivityFilter("");
              setListLimit(50);
              setExpanded([]);
              void handleQuery(EMPTY_FILTERS);
            }}
          >
            重設篩選
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <span className="text-sm font-semibold">匯出目前篩選結果</span>
          <a
            className="btn"
            href={exportHref("xlsx")}
            download
            onClick={() => {
              if (filtersPending) void handleQuery(draft);
            }}
          >
            Excel（XLSX）
          </a>
          <a
            className="btn"
            href={exportHref("docx")}
            download
            onClick={() => {
              if (filtersPending) void handleQuery(draft);
            }}
          >
            Word（DOCX）
          </a>
          <a
            className="btn"
            href={exportHref("pdf")}
            download
            onClick={() => {
              if (filtersPending) void handleQuery(draft);
            }}
          >
            PDF
          </a>
          <a
            className="btn"
            href={exportHref("csv")}
            download
            onClick={() => {
              if (filtersPending) void handleQuery(draft);
            }}
          >
            CSV
          </a>
        </div>
        <p className="text-xs text-gray-600">
          匯出範圍：<strong>{exportScope}</strong>（會使用上面已選擇的篩選；按下匯出時畫面亦會同步套用）。
        </p>
        {filtersPending ? (
          <Notice tone="info">
            你已更改篩選，但下方清單仍是上一次查詢的結果。按「查詢記錄」可更新畫面；直接按匯出會先套用新的篩選再下載。
          </Notice>
        ) : null}
        </div>

        <div
          ref={resultsRef}
          className="flex flex-col gap-2 border-t pt-4 scroll-mt-4"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="text-sm font-semibold">本次查詢統計</span>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <StatBox label="練習次數" value={`${records.length}`} />
            <StatBox label="學習者人數" value={`${learnerCountInRecords}`} />
            <StatBox label="答對題數" value={`${correctTotal}`} />
            <StatBox label="答錯題數" value={`${wrongTotal}`} />
          </div>
        </div>

        <div
          className="flex flex-col gap-3 border-t pt-4"
          style={{ borderColor: "var(--border)" }}
        >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">學習者使用概況</h2>
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
            <span>
              名冊 {learners.length} 位・本次查詢 {learnerCountInRecords} 位有記錄・{notStartedCount} 位尚未開始
              {data?.rosterSource === "live"
                ? " ・ 名冊：即時"
                : data?.rosterSource === "snapshot"
                  ? " ・ 名冊：上次成功載入"
                  : ""}
            </span>
            <button
              type="button"
              className="btn"
              aria-expanded={overviewOpen}
              aria-controls="learner-overview"
              title={
                overviewOpen
                  ? "收起名冊清單，只保留本次查詢統計及逐題記錄。"
                  : "展開名冊清單，逐項核對班別、練習次數、答對比率及最近活動。"
              }
              onClick={() => setOverviewOpen((open) => !open)}
            >
              {overviewOpen ? "收起名冊" : "展開名冊"}
            </button>
          </div>
        </div>
        {overviewOpen ? (
        <div id="learner-overview" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs text-gray-500">
            依學生名冊配對班別、姓名及學號；找不到名冊資料時會保留登入電郵或匿名 ID。
          </p>
          <p className="text-xs text-gray-500">
            表內「練習次數」「累計答題」「答對比率」是該學習者的<strong>終身累計</strong>，不受課題及日期篩選影響；
            上方統計方塊才是本次查詢的數字。活動狀態：未曾練習＝尚未開始；7 日內＝活躍；7–13 日未練習；
            14 日以上未練習。「答對比率」只計算已提交的答案，未作答時顯示「未作答」。
          </p>
        </div>
        {visibleLearners.length === 0 ? (
          <p className="text-sm text-gray-600">沒有符合條件的學習者。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr>
                  <th className="px-2 py-2">學生</th>
                  <th className="px-2 py-2">班別／學號</th>
                  <th className="px-2 py-2">活動狀態</th>
                  <th className="px-2 py-2 text-right">練習次數</th>
                  <th className="px-2 py-2 text-right">累計答題</th>
                  <th className="px-2 py-2 text-right">答對比率</th>
                  <th className="px-2 py-2">最近活動</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {visibleLearners.slice(0, listLimit).map((learner) => {
                  const activity = learnerActivity(learner);
                  return (
                    <tr key={learner.learnerId} className="border-t" style={{ borderColor: "var(--border)" }}>
                      <td className="px-2 py-2">
                        <div className="font-medium">{learnerName(learner)}</div>
                        <div className="text-xs text-gray-500">{learnerDetails(learner)}</div>
                      </td>
                      <td className="px-2 py-2">
                        {[learner.className, learner.studentNumber].filter(Boolean).join(" ・ ") || "未列入名冊"}
                      </td>
                      <td className="px-2 py-2"><span className={activity.className}>{activity.label}</span></td>
                      <td className="px-2 py-2 text-right">{learner.sessions}</td>
                      <td className="px-2 py-2 text-right">{learner.answeredQuestions}</td>
                      <td className="px-2 py-2 text-right">
                        {learnerAccuracyLabel(learner)}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        {learner.lastAt ? formatDateTime(learner.lastAt) : "尚未活動"}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          className="btn"
                          title={
                            learner.sessions === 0
                              ? "這位學習者目前沒有練習記錄；按下會顯示說明。"
                              : "篩選並展開這位學習者的逐題作答。"
                          }
                          onClick={() => {
                            const filters = { ...draft, learnerId: learner.learnerId };
                            setDraft(filters);
                            // 收起名冊清單，逐題記錄便會緊接統計出現（並自動捲動到該區）
                            setOverviewOpen(false);
                            void handleQuery(filters, { focusLearnerId: learner.learnerId });
                          }}
                        >
                          查看記錄
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {visibleLearners.length > listLimit ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600">
            <span>
              顯示 {listLimit}／{visibleLearners.length} 位
            </span>
            <button type="button" className="btn" onClick={() => setListLimit((limit) => limit + 50)}>
              顯示更多
            </button>
          </div>
        ) : null}
        </div>
        ) : (
          <p className="text-xs text-gray-500">
            名冊清單已收起，下面只顯示本次查詢的統計及逐題記錄。按「展開名冊」可逐項核對班別、
            練習次數、答對比率及最近活動。
          </p>
        )}
        </div>

        <div
          ref={recordsRef}
          className="flex flex-col gap-3 border-t pt-4 scroll-mt-4"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">練習記錄（逐題作答）</h2>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={wrongOnly}
                  onChange={(event) => setWrongOnly(event.target.checked)}
                />
                只看答錯／未作答
              </label>
              <span className="text-sm text-gray-600">
                {applied.learnerId ? `目前顯示：${activeLearnerName}` : "目前顯示：全部學習者"}
                ・共 {records.length} 次練習
              </span>
            </div>
          </div>
        {loading ? <Loading label="正在載入練習記錄…" /> : null}
        {!loading && records.length === 0 && applied.learnerId ? (
          <Notice tone="info">
            <strong>{activeLearnerName}</strong> 在目前篩選條件下沒有練習記錄。練習記錄只會在學生
            以學校 Google 帳戶登入並提交答案後產生；若學生已在其他裝置作答，請確認他使用的是同一個
            學校帳戶，並先按「重設篩選」清除課題及日期條件。
          </Notice>
        ) : null}
        {!loading && records.length === 0 && !applied.learnerId ? (
          <p className="text-sm text-gray-600">目前沒有符合條件的練習記錄。</p>
        ) : null}

        {records.map((record) => (
          <article
            key={record.sessionId}
            className="rounded-xl border p-3 flex flex-col gap-2"
            style={{ borderColor: "var(--border)" }}
          >
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="badge badge-accent">
                {learnerById.get(record.learnerId)?.name || record.learnerLabel}
              </span>
              {record.learnerClassName || record.learnerStudentNumber ? (
                <span className="text-xs text-gray-500">
                  {[record.learnerClassName, record.learnerStudentNumber ? `學號 ${record.learnerStudentNumber}` : ""]
                    .filter(Boolean)
                    .join(" ・ ")}
                </span>
              ) : null}
              <span className="font-semibold">{formatDateTime(record.createdAt)}</span>
              <span>{topicLabelById.get(record.topicId) ?? record.topicTitle}</span>
              {record.questionTypeLabels.map((label) => (
                <span key={label} className="badge">
                  {label}
                </span>
              ))}
              <span className="badge badge-success">答對 {record.correctCount}</span>
              <span className="badge badge-danger">答錯 {record.wrongCount}</span>
              {record.accuracy !== null ? (
                <span className="text-gray-600">
                  準確率 {Math.round(record.accuracy * 100)}%
                </span>
              ) : null}
              <button
                type="button"
                className="btn ml-auto"
                onClick={() => toggle(record.sessionId)}
              >
                {expanded.includes(record.sessionId) ? "收起題目" : `查看題目（${record.totalQuestions}）`}
              </button>
            </div>

            {expanded.includes(record.sessionId) ? (
              (() => {
                const visible = record.questions
                  .map((question, index) => ({ question, index }))
                  .filter((item) => !wrongOnly || needsReview(item.question));
                if (visible.length === 0) {
                  return (
                    <p className="text-sm text-gray-600 mt-1">
                      這次練習沒有答錯或未作答的題目。
                    </p>
                  );
                }
                return (
                  <ul className="flex flex-col gap-2 mt-1">
                    {visible.map(({ question, index }) => {
                      const badge = outcomeBadge(question);
                      const chosen = question.studentAnswer.trim();
                      return (
                        <li
                          key={question.questionId}
                          className="rounded-lg border p-2 text-sm flex flex-col gap-2"
                          style={{ borderColor: "var(--border)" }}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-gray-500">{index + 1}.</span>
                            <span className="badge">{question.questionTypeLabel}</span>
                            <span className={badge.className}>{badge.label}</span>
                            {question.sectionTitle ? (
                              <span className="text-xs text-gray-500">{question.sectionTitle}</span>
                            ) : null}
                          </div>
                          <p className="whitespace-pre-wrap font-medium">{question.question}</p>
                          {question.options.length > 0 ? (
                            <ol className="flex flex-col gap-1">
                              {question.options.map((option, optionIndex) => {
                                const isCorrect = option === question.correctAnswer;
                                const isChosen = chosen.length > 0 && option === chosen;
                                return (
                                  <li
                                    key={`${question.questionId}-${optionIndex}`}
                                    className="flex flex-wrap items-start gap-2 rounded-lg px-2 py-1"
                                    style={{
                                      border: `1px solid ${isCorrect ? "var(--success)" : "var(--border)"}`,
                                      background: isCorrect ? "var(--success-soft)" : "transparent",
                                    }}
                                  >
                                    <span className="font-semibold">{optionLetter(optionIndex)}</span>
                                    <span className="flex-1">{option}</span>
                                    {isChosen ? (
                                      <span
                                        className={isCorrect ? "badge badge-success" : "badge badge-danger"}
                                      >
                                        學生選擇
                                      </span>
                                    ) : null}
                                    {isCorrect ? <span className="badge badge-success">正確答案</span> : null}
                                  </li>
                                );
                              })}
                            </ol>
                          ) : null}
                          <p className="text-gray-700">
                            學生答案：
                            {chosen.length > 0 ? question.studentAnswer : "（未作答）"}
                          </p>
                          <p className="text-gray-700">正確答案：{question.correctAnswer}</p>
                          {question.explanation ? (
                            <p className="text-gray-700">解釋：{question.explanation}</p>
                          ) : null}
                          {question.knowledgePoint ? (
                            <p className="text-gray-700">知識點：{question.knowledgePoint}</p>
                          ) : null}
                          {question.sourceExcerpt ? (
                            <details className="text-xs text-gray-600">
                              <summary className="cursor-pointer">
                                教材依據{question.sourceLocation ? `：${question.sourceLocation}` : ""}
                              </summary>
                              <p className="whitespace-pre-wrap mt-1">{question.sourceExcerpt}</p>
                            </details>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                );
              })()
            ) : null}
          </article>
        ))}
        </div>
      </section>
    </div>
  );
}
