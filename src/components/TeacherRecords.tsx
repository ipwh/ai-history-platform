"use client";

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api-client";
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
}

interface Filters {
  topicId: string;
  learnerId: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { topicId: "", learnerId: "", from: "", to: "" };

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-HK", { hour12: false });
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

/** 教師端：學生練習記錄查閱及下載（作答日期、課題、題型、答對及答錯的題目） */
export function TeacherRecords() {
  const [data, setData] = useState<RecordsResponse | null>(null);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string[]>([]);

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

  const records = data?.records ?? [];
  const learners = data?.learners ?? [];
  const topics = data?.topics ?? [];
  const correctTotal = records.reduce((sum, record) => sum + record.correctCount, 0);
  const wrongTotal = records.reduce((sum, record) => sum + record.wrongCount, 0);
  const exportQuery = queryString(applied);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold">學生練習記錄</h1>
        <span className="text-sm text-gray-600">共 {records.length} 次練習記錄</span>
      </div>

      <section className="card flex flex-col gap-3">
        <h2 className="font-semibold">篩選</h2>
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
                  {topic.title}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            學習者
            <select
              value={draft.learnerId}
              onChange={(event) => setDraft({ ...draft, learnerId: event.target.value })}
            >
              <option value="">全部學習者</option>
              {learners.map((learner) => (
                <option key={learner.learnerId} value={learner.learnerId}>
                  {learner.learnerId}（{learner.sessions} 次）
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
        </div>
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
              void handleQuery(EMPTY_FILTERS);
            }}
          >
            重設篩選
          </button>
          <a
            className="btn"
            href={`/api/teacher/records/export${exportQuery ? `?${exportQuery}` : ""}`}
            download
          >
            下載 CSV
          </a>
        </div>
        <p className="text-xs text-gray-500">
          下載的 CSV 會按目前篩選條件匯出，每題一列，可用 Excel 開啟（含作答日期、課題、題型、題目、學生答案、正確答案及答對／答錯）。
        </p>
      </section>

      <section className="card flex flex-col gap-3">
        <h2 className="font-semibold">概況</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatBox label="練習次數" value={`${records.length}`} />
          <StatBox label="學習者人數" value={`${new Set(records.map((r) => r.learnerId)).size}`} />
          <StatBox label="答對題數" value={`${correctTotal}`} />
          <StatBox label="答錯題數" value={`${wrongTotal}`} />
        </div>
      </section>

      <section className="card flex flex-col gap-3">
        <h2 className="font-semibold">練習記錄</h2>
        {loading ? <Loading label="正在載入練習記錄…" /> : null}
        {!loading && records.length === 0 ? (
          <p className="text-sm text-gray-600">目前沒有符合條件的練習記錄。</p>
        ) : null}

        {records.map((record) => (
          <article
            key={record.sessionId}
            className="rounded-xl border p-3 flex flex-col gap-2"
            style={{ borderColor: "var(--border)" }}
          >
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="badge badge-accent">{record.learnerLabel}</span>
              <span className="font-semibold">{formatDateTime(record.createdAt)}</span>
              <span>{record.topicTitle}</span>
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
              <ul className="flex flex-col gap-2 mt-1">
                {record.questions.map((question, index) => {
                  const badge = outcomeBadge(question);
                  return (
                    <li
                      key={question.questionId}
                      className="rounded-lg border p-2 text-sm flex flex-col gap-1"
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
                      <p className="text-gray-700">
                        學生答案：{question.studentAnswer.trim().length > 0 ? question.studentAnswer : "（未作答）"}
                      </p>
                      <p className="text-gray-700">正確答案：{question.correctAnswer}</p>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </article>
        ))}
      </section>

      {!loading && records.length === 0 ? (
        <Notice tone="info">
          學生完成練習後，記錄會自動儲存並顯示在這裡；教師亦可隨時下載 CSV 存檔。
        </Notice>
      ) : null}
    </div>
  );
}
