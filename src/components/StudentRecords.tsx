"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { api, getLearnerId } from "@/lib/api-client";
import { practiceTopicLabel } from "@/lib/practice-summary";
import type {
  PracticeRecordSession,
  PracticeRecordSummary,
  PracticeRecordTopicOption,
  StudentRecordsPayload,
} from "@/lib/types";
import { EmptyState, ErrorNotice, Loading, Notice, StatBox } from "@/components/ui";
import { PracticeRecordCard } from "@/components/PracticeRecordCard";

interface Filters {
  topicId: string;
  from: string;
  to: string;
  correctMin: string;
  correctMax: string;
  accuracyMin: string;
  accuracyMax: string;
}

const EMPTY_FILTERS: Filters = {
  topicId: "",
  from: "",
  to: "",
  correctMin: "",
  correctMax: "",
  accuracyMin: "",
  accuracyMax: "",
};

function queryString(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.topicId) params.set("topicId", filters.topicId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.correctMin.trim()) params.set("correctMin", filters.correctMin.trim());
  if (filters.correctMax.trim()) params.set("correctMax", filters.correctMax.trim());
  if (filters.accuracyMin.trim()) params.set("accuracyMin", filters.accuracyMin.trim());
  if (filters.accuracyMax.trim()) params.set("accuracyMax", filters.accuracyMax.trim());
  return params.toString();
}

function rangeReversed(min: string, max: string): boolean {
  if (min.trim().length === 0 || max.trim().length === 0) return false;
  const lower = Number(min);
  const upper = Number(max);
  return Number.isFinite(lower) && Number.isFinite(upper) && lower > upper;
}

/**
 * 學生端：我的練習記錄。
 *
 * 與教師端「學生練習記錄」使用同一份資料及同一個逐題回顧元件，但學習者身分由
 * 伺服器工作階段決定，學生只會看到及匯出自己的記錄。
 */
export function StudentRecords() {
  const [data, setData] = useState<StudentRecordsPayload | null>(null);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [wrongOnly, setWrongOnly] = useState(false);
  /** 篩選表單預設收起：大部分學生只想看記錄，不需要每次都見到七個輸入框 */
  const [filtersOpen, setFiltersOpen] = useState(false);

  const fetchRecords = useCallback(async (filters: Filters): Promise<StudentRecordsPayload> => {
    const params = new URLSearchParams(queryString(filters));
    params.set("learnerId", getLearnerId());
    return api.get<StudentRecordsPayload>(`/api/records?${params.toString()}`);
  }, []);

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

  const handleQuery = async (filters: Filters) => {
    setLoading(true);
    try {
      const result = await fetchRecords(filters);
      setData(result);
      setApplied(filters);
      setError(null);
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
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
  if (!data) return <Loading label="正在載入你的練習記錄…" />;

  const records: PracticeRecordSession[] = data.records;
  const summary: PracticeRecordSummary = data.summary;
  const topics: PracticeRecordTopicOption[] = data.topics;
  const topicLabelById = new Map(topics.map((topic) => [topic.id, practiceTopicLabel(topic)]));
  const accuracy = summary.graded > 0 ? Math.round((summary.correct / summary.graded) * 100) : null;
  const filtersPending = queryString(draft) !== queryString(applied);
  const draftFilterCount = Object.values(draft).filter((value) => value.trim().length > 0).length;
  const allExpanded = records.length > 0 && records.every((record) => expanded.includes(record.sessionId));

  const exportHref = (format: "xlsx" | "docx" | "pdf" | "csv"): string => {
    const params = new URLSearchParams(queryString(draft));
    params.set("format", format);
    params.set("learnerId", getLearnerId());
    return `/api/records/export?${params.toString()}`;
  };

  return (
    <div className="flex flex-col gap-4" data-section="practice">
      <header className="page-head">
        <p className="eyebrow">我的學習</p>
        <h1 className="page-title">我的練習記錄</h1>
        <p className="page-sub">
          這裡顯示你自己的練習記錄（作答日期、課題、答對及答錯的題目），可隨時重看並下載。
          歷史科教師亦可在教師端查閱同一批記錄。
        </p>
        <p className="text-meta">
          {summary.sessions > 0 ? `共 ${summary.sessions} 次練習` : "尚未有練習記錄"}
        </p>
      </header>

      <section className="card flex flex-col gap-3">
        <div className="card__heading">
          <h2 className="card__title">篩選記錄</h2>
          <div className="flex flex-wrap items-center gap-2">
            {draftFilterCount > 0 ? (
              <span className="badge badge-accent">已設定 {draftFilterCount} 項</span>
            ) : null}
            <button
              type="button"
              className="btn"
              aria-expanded={filtersOpen}
              aria-controls="record-filters"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              {filtersOpen ? "收起篩選" : "展開篩選"}
            </button>
          </div>
        </div>
        {filtersOpen ? (
        <>
        <div id="record-filters" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          <label className="text-sm">
            答對題數（最少）
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={draft.correctMin}
              onChange={(event) => setDraft({ ...draft, correctMin: event.target.value })}
              placeholder="不限"
            />
          </label>
          <label className="text-sm">
            答對題數（最多）
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={draft.correctMax}
              onChange={(event) => setDraft({ ...draft, correctMax: event.target.value })}
              placeholder="不限"
            />
          </label>
          <label className="text-sm">
            答對百分比（最少）
            <input
              type="number"
              min={0}
              max={100}
              inputMode="numeric"
              value={draft.accuracyMin}
              onChange={(event) => setDraft({ ...draft, accuracyMin: event.target.value })}
              placeholder="不限"
            />
          </label>
          <label className="text-sm">
            答對百分比（最多）
            <input
              type="number"
              min={0}
              max={100}
              inputMode="numeric"
              value={draft.accuracyMax}
              onChange={(event) => setDraft({ ...draft, accuracyMax: event.target.value })}
              placeholder="不限"
            />
          </label>
        </div>
        {rangeReversed(draft.correctMin, draft.correctMax) ? (
          <Notice tone="warning">「答對題數」下限大於上限，不會有符合條件的記錄。</Notice>
        ) : null}
        {rangeReversed(draft.accuracyMin, draft.accuracyMax) ? (
          <Notice tone="warning">「答對百分比」下限大於上限，不會有符合條件的記錄。</Notice>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={() => void handleQuery(draft)} disabled={loading}>
            {loading ? "查詢中…" : "查詢記錄"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDraft(EMPTY_FILTERS);
              setExpanded([]);
              void handleQuery(EMPTY_FILTERS);
            }}
          >
            重設篩選
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <span className="text-sm font-semibold">匯出目前篩選結果</span>
          <a className="btn" href={exportHref("xlsx")} download onClick={() => { if (filtersPending) void handleQuery(draft); }}>
            Excel（XLSX）
          </a>
          <a className="btn" href={exportHref("docx")} download onClick={() => { if (filtersPending) void handleQuery(draft); }}>
            Word（DOCX）
          </a>
          <a className="btn" href={exportHref("pdf")} download onClick={() => { if (filtersPending) void handleQuery(draft); }}>
            PDF
          </a>
          <a className="btn" href={exportHref("csv")} download onClick={() => { if (filtersPending) void handleQuery(draft); }}>
            CSV
          </a>
        </div>
        {filtersPending ? (
          <Notice tone="info">
            你已更改篩選，但下方清單仍是上一次查詢的結果。按「查詢記錄」可更新畫面；直接按匯出會先套用新的篩選再下載。
          </Notice>
        ) : null}
        </>
        ) : null}
      </section>

      <section className="card flex flex-col gap-2">
        <span className="text-sm font-semibold">本次查詢統計</span>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatBox label="練習次數" value={`${summary.sessions}`} />
          <StatBox label="答對題數" value={`${summary.correct}`} />
          <StatBox label="答錯題數" value={`${summary.wrong}`} />
          <StatBox label="答對百分比" value={accuracy === null ? "未作答" : `${accuracy}%`} />
        </div>
        <p className="text-xs text-gray-500">
          答對百分比只計算已評分的題目（{summary.graded} 題）；未作答的題目不會計入。
        </p>
        {data.truncated ? (
          <Notice tone="info">
            下方只顯示最新 <strong>{records.length}</strong> 次練習（上限 {data.limit} 次），
            上方統計已包括其餘 <strong>{Math.max(summary.sessions - records.length, 0)}</strong> 次。
            需要完整資料請使用匯出功能（上限 2,000 次）。
          </Notice>
        ) : null}
      </section>

      <section className="card flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">練習記錄（逐題作答）</h2>
          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={wrongOnly}
                onChange={(event) => setWrongOnly(event.target.checked)}
              />
              只看答錯／未作答
            </label>
            {records.length > 0 ? (
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setExpanded(
                    allExpanded
                      ? []
                      : records
                          .filter((record) => !wrongOnly || record.wrongCount > 0)
                          .map((record) => record.sessionId),
                  )
                }
              >
                {allExpanded ? "全部收起" : "全部展開"}
              </button>
            ) : null}
          </div>
        </div>

        {loading ? <Loading label="正在載入練習記錄…" /> : null}
        {!loading && records.length === 0 ? (
          <EmptyState
            icon="🗂️"
            title="暫時沒有符合條件的練習記錄"
            action={
              <Link href="/" className="btn btn-primary">
                去練習
              </Link>
            }
          >
            完成一次練習並提交答案後，記錄會顯示在這裡。
          </EmptyState>
        ) : null}

        {records.map((record) => (
          <PracticeRecordCard
            key={record.sessionId}
            record={record}
            expanded={expanded.includes(record.sessionId)}
            onToggle={() => toggle(record.sessionId)}
            wrongOnly={wrongOnly}
            topicLabel={topicLabelById.get(record.topicId) ?? record.topicTitle}
            answerLabel="你的答案"
            choiceLabel="你的選擇"
          />
        ))}
      </section>
    </div>
  );
}
