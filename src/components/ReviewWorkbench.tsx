"use client";

/**
 * 教師審核工作台（2026-10-20 簡化版）。
 *
 * 設計原則：
 * 1. **單欄、一步一步**：先看題目 → 看有甚麼問題 → 按一個決定 → 選一句理由 → 確認提交。
 * 2. **不出現內部術語**：畫面不見 provenance／servability／fingerprint；技術資料收在「技術資料」內。
 * 3. **伺服器仍然是唯一權威**：所有裁決都經既有 API，客戶端狀態不會令題目變成可派發。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { api, ApiError } from "@/lib/api-client";
import { ErrorNotice, Loading, Notice } from "@/components/ui";
import {
  GOLDEN_CATEGORY_LABELS,
  GOLDEN_DECISIONS,
  QUEUE_META,
  REASON_CHIPS,
  SERVABILITY_DECISIONS,
  SERVABILITY_SECONDARY_DECISIONS,
  composeReason,
  decisionMeta,
  servabilityReasonText,
  type WorkbenchQueue,
} from "@/lib/review-workbench-labels";

type QueueKind = WorkbenchQueue;

interface QueueItem {
  id: string;
  revision: number | null;
  fingerprint: string | null;
  status: string;
  summary: string;
  detail: Record<string, unknown>;
}

interface QueuePage {
  queue: QueueKind;
  available: boolean;
  limitation: string | null;
  asOf: string | null;
  total: number;
  page: number;
  pageSize: number;
  items: QueueItem[];
  counts: Record<string, number>;
}

interface ReviewRecord {
  decision: string;
  reviewerRole: string;
  revision: number;
  createdAt: string;
  reason: string | null;
}

interface QuestionDetail {
  question: {
    id: string;
    revision: number;
    questionType: "mc" | "fill";
    question: string;
    options: string[];
    correctAnswer: string;
    acceptedAnswers: string[];
    gradingPoints: string[];
    explanation: string;
    sourceLocation: string;
    sourceBlockIds: string[];
    teacherConfirmationRequired: boolean;
    status: string;
  };
  servability: { ok: boolean; reason: string | null };
  reviews: ReviewRecord[];
}

/** 佇列項目的摘要格式是 `<issueCode>：<系統訊息>`，這裡只取代碼用於顯示白話說明。 */
function issueCodeOf(item: QueueItem): string | null {
  const match = /^([A-Z_]+)：/.exec(item.summary);
  return match ? match[1] : null;
}

function plainSummary(queue: QueueKind, item: QueueItem): string {
  if (queue === "servability") return servabilityReasonText(issueCodeOf(item));
  if (queue === "golden") return "可以考慮用作評分示例的題目。";
  return "這一題的課本依據需要人手核對。";
}

function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "請先以教師或管理員帳戶登入。";
    if (error.status === 403)
      return error.message || "沒有權限執行這個操作（需要歷史科審核者授權）。";
    if (error.status === 429) return "操作太頻繁，請稍後再試。";
    if (error.status === 409)
      return `${error.message}（這題在你看的時候被修改過，畫面已重新載入，請再確認一次。）`;
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function ReviewWorkbench() {
  const [queue, setQueue] = useState<QueueKind>("servability");
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);
  const [data, setData] = useState<QueuePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  /** 離開前先確認，避免默默丟失未提交的內容。 */
  function confirmDiscard(): boolean {
    if (!dirtyRef.current) return true;
    const proceed = window.confirm("你還有未提交的內容，離開就會失去。確定要離開嗎？");
    if (proceed) dirtyRef.current = false;
    return proceed;
  }

  useEffect(() => {
    let cancelled = false;
    api
      .get<QueuePage>(`/api/teacher/review-queue?queue=${queue}&page=${page}&pageSize=10`)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught);
        setData(null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [queue, page, reloadToken]);

  const totalPages = useMemo(() => {
    if (!data || data.total === 0) return 1;
    return Math.max(1, Math.ceil(data.total / data.pageSize));
  }, [data]);

  const selectedItem = useMemo(
    () => data?.items.find((entry) => entry.id === selected) ?? null,
    [data, selected],
  );

  function reload() {
    setLoading(true);
    setFeedback(null);
    setReloadToken((current) => current + 1);
  }

  function changeQueue(kind: QueueKind) {
    if (!confirmDiscard()) return;
    setLoading(true);
    setSelected(null);
    setFeedback(null);
    setQueue(kind);
    setPage(1);
    setReloadToken((current) => current + 1);
  }

  function changePage(next: number) {
    if (!confirmDiscard()) return;
    setLoading(true);
    setSelected(null);
    setPage(next);
    setReloadToken((current) => current + 1);
  }

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">教師審核工作台</h1>
        <p className="text-sm text-gray-600">
          這裡只列出需要你看一看的題目。每次看一題，看完按一個按鈕就可以，系統會如實記錄你的決定。
        </p>
      </header>

      <div role="tablist" aria-label="選擇清單" className="flex flex-wrap gap-2">
        {(Object.keys(QUEUE_META) as QueueKind[]).map((kind) => (
          <button
            key={kind}
            role="tab"
            type="button"
            aria-selected={queue === kind}
            className={queue === kind ? "btn btn-primary" : "btn"}
            onClick={() => changeQueue(kind)}
          >
            {QUEUE_META[kind].label}
          </button>
        ))}
      </div>

      <Notice tone="info">{QUEUE_META[queue].hint}</Notice>

      {loading ? <Loading label="正在讀取清單…" /> : null}
      {error ? (
        <div role="alert">
          <ErrorNotice error={error} onRetry={reload} />
        </div>
      ) : null}
      {feedback ? (
        <div role="status">
          <Notice tone="success">{feedback}</Notice>
        </div>
      ) : null}

      {data && !loading ? (
        <>
          <p className="text-sm text-gray-600" aria-live="polite">
            共 {data.total} 題
            {data.asOf ? `；清單更新時間 ${new Date(data.asOf).toLocaleString("zh-HK")}` : ""}
          </p>
          {data.limitation ? (
            <details className="text-sm text-gray-600">
              <summary>關於這份清單</summary>
              <p className="mt-1">{data.limitation}</p>
            </details>
          ) : null}
          {!data.available ? (
            <Notice tone="warning">
              這份清單仍未產生，所以暫時顯示不到。系統不會用估算數字代替，請先請管理員產生清單。
            </Notice>
          ) : null}

          {data.available && data.items.length === 0 ? (
            <Notice tone="info">這份清單目前沒有題目，暫時不需要處理。</Notice>
          ) : null}

          {data.available && selectedItem ? (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                className="btn self-start"
                onClick={() => {
                  if (!confirmDiscard()) return;
                  setSelected(null);
                  setFeedback(null);
                }}
              >
                ← 返回題目清單
              </button>

              {queue === "servability" ? (
                <ServabilityPanel
                  key={selectedItem.id}
                  item={selectedItem}
                  onDirtyChange={(dirty) => {
                    dirtyRef.current = dirty;
                  }}
                  onDone={(message) => {
                    reload();
                    setFeedback(message);
                  }}
                />
              ) : queue === "golden" ? (
                <GoldenPanel
                  key={selectedItem.id}
                  item={selectedItem}
                  onDirtyChange={(dirty) => {
                    dirtyRef.current = dirty;
                  }}
                  onDone={(message) => {
                    reload();
                    setFeedback(message);
                  }}
                />
              ) : (
                <ProvenancePanel key={selectedItem.id} item={selectedItem} />
              )}
            </div>
          ) : null}

          {data.available && !selectedItem ? (
            <ol aria-label="題目清單" className="flex flex-col gap-2">
              {data.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="btn w-full text-left"
                    style={{ alignItems: "flex-start", justifyContent: "flex-start" }}
                    data-question-id={item.id}
                    onClick={() => {
                      setSelected(item.id);
                      setFeedback(null);
                    }}
                  >
                    <span className="flex flex-col items-start gap-1">
                      <strong>{plainSummary(queue, item)}</strong>
                      <span className="text-xs" style={{ fontWeight: 400, color: "#5b6478" }}>
                        題目編號 {item.id}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : null}

          {data.available && data.total > data.pageSize ? (
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="btn"
                onClick={() => changePage(Math.max(1, page - 1))}
                disabled={page <= 1}
              >
                上一頁
              </button>
              <span aria-live="polite">
                第 {page}／{totalPages} 頁
              </span>
              <button
                type="button"
                className="btn"
                onClick={() => changePage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
              >
                下一頁
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 共用小元件                                                          */
/* ------------------------------------------------------------------ */

function QuestionCard({ detail }: { detail: QuestionDetail }) {
  const { question } = detail;
  return (
    <article className="card flex flex-col gap-3">
      <h2 className="text-lg font-bold">這一題</h2>
      <p className="text-lg" style={{ fontWeight: 600 }}>
        {question.question}
      </p>
      {question.options.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="選項">
          {question.options.map((option) => (
            <li
              key={option}
              className="option-row"
              data-state={option === question.correctAnswer ? "correct" : undefined}
            >
              <span className="flex-1">{option}</span>
              {option === question.correctAnswer ? (
                <span className="badge badge-success">正確答案</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p>
          <span className="badge badge-success">正確答案</span> {question.correctAnswer}
        </p>
      )}
      {question.explanation ? (
        <p className="text-sm text-gray-600">解釋：{question.explanation}</p>
      ) : null}
    </article>
  );
}

function ReasonPicker({
  chips,
  onToggle,
  freeText,
  onFreeText,
  hint,
}: {
  chips: string[];
  onToggle: (chip: string) => void;
  freeText: string;
  onFreeText: (value: string) => void;
  hint: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-gray-600">{hint}</p>
      <div className="flex flex-wrap gap-2">
        {REASON_CHIPS.map((chip) => {
          const active = chips.includes(chip);
          return (
            <button
              key={chip}
              type="button"
              className="chip"
              data-selected={active}
              aria-pressed={active}
              onClick={() => onToggle(chip)}
            >
              {chip}
            </button>
          );
        })}
      </div>
      <label htmlFor="review-reason-extra" className="text-sm">
        想補充的話（可以留空）
      </label>
      <textarea
        id="review-reason-extra"
        rows={2}
        maxLength={500}
        value={freeText}
        onChange={(event) => onFreeText(event.target.value)}
        className="w-full rounded-lg border px-3 py-2"
        style={{ borderColor: "var(--border-strong)", background: "var(--surface)" }}
      />
    </div>
  );
}

function TechnicalDetails({ detail }: { detail: QuestionDetail }) {
  const { question, reviews } = detail;
  return (
    <details className="text-sm text-gray-600">
      <summary>技術資料（一般不需要理會）</summary>
      <dl className="mt-2 grid grid-cols-1 gap-1">
        <dt>題目編號</dt>
        <dd>{question.id}</dd>
        <dt>版本</dt>
        <dd>第 {question.revision} 版</dd>
        <dt>狀態</dt>
        <dd>
          {question.status}
          {question.teacherConfirmationRequired ? "（待教師確認）" : ""}
        </dd>
        <dt>題型</dt>
        <dd>{question.questionType === "mc" ? "選擇題" : "填充題"}</dd>
        <dt>可接受答案</dt>
        <dd>
          {question.acceptedAnswers.length > 0 ? question.acceptedAnswers.join("、") : "（未設定）"}
        </dd>
        <dt>評分方式</dt>
        <dd>
          {question.questionType === "fill"
            ? "填充題：字面對比 + 可接受答案；必要時 AI 語意批改"
            : "選擇題：選項完全比對"}
        </dd>
        <dt>評分要點</dt>
        <dd>{question.gradingPoints.length > 0 ? question.gradingPoints.join("；") : "（沒有）"}</dd>
        <dt>來源位置</dt>
        <dd>
          {question.sourceLocation || "（沒有記錄）"}
          {question.sourceBlockIds.length > 0
            ? `（段落 ${question.sourceBlockIds.join("、")}）`
            : "（沒有教材段落依據）"}
        </dd>
      </dl>
      <p className="mt-2">覆核紀錄（唯讀，共 {reviews.length} 筆）</p>
      <ul className="list-disc pl-5">
        {reviews.length === 0 ? <li>沒有覆核紀錄。</li> : null}
        {reviews.map((review, index) => (
          <li key={`${review.createdAt}-${index}`}>
            {review.createdAt}｜{review.decision}｜角色 {review.reviewerRole}｜第 {review.revision} 版
            {review.reason ? `｜${review.reason}` : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}

/* ------------------------------------------------------------------ */
/* 學生答唔到的題目                                                     */
/* ------------------------------------------------------------------ */

interface QuestionDetailEnvelope {
  view: { question: QuestionDetail["question"] };
  servability?: { ok: boolean; reason: string | null };
  reviews?: ReviewRecord[];
}

function ServabilityPanel({
  item,
  onDone,
  onDirtyChange,
}: {
  item: QueueItem;
  onDone: (message: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const questionId = item.id;
  const [detail, setDetail] = useState<QuestionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [decision, setDecision] = useState<string | null>(null);
  const [chips, setChips] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const focusFormError = useCallback((node: HTMLDivElement | null) => {
    if (node) node.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get<QuestionDetailEnvelope>(`/api/teacher/questions/${questionId}/review`)
      .then((result) => {
        if (cancelled) return;
        setDetail({
          question: result.view.question,
          servability: result.servability ?? { ok: false, reason: "未能確認題目是否可以作答。" },
          reviews: result.reviews ?? [],
        });
        setError(null);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [questionId, reloadToken]);

  const reasonValue = composeReason(chips, freeText);
  const chosen = decision ? decisionMeta(decision) : null;

  async function load() {
    setLoading(true);
    setError(null);
    setReloadToken((current) => current + 1);
  }

  function markDirty() {
    onDirtyChange?.(true);
  }

  function toggleChip(chip: string) {
    setChips((current) =>
      current.includes(chip) ? current.filter((entry) => entry !== chip) : [...current, chip],
    );
    markDirty();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;
    setFormError(null);
    if (!decision) {
      setFormError("請先按上面其中一個按鈕，選擇你的決定。");
      return;
    }
    if (reasonValue.trim().length < 5) {
      setFormError("請至少選一句理由（或自己寫幾個字），讓其他同事知道你為甚麼這樣決定。");
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/api/teacher/questions/${questionId}/servability`, {
        decision,
        reason: reasonValue.trim(),
        expectedRevision: detail.question.revision,
      });
      onDone(`已記錄你的決定（第 ${detail.question.revision} 版）。題目不會因此自動派給學生。`);
      setDecision(null);
      setChips([]);
      setFreeText("");
      onDirtyChange?.(false);
      await load();
    } catch (caught) {
      setFormError(errorText(caught));
      if (isConflict(caught)) await load();
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Loading label="正在讀取題目…" />;
  if (error) return <ErrorNotice error={error} onRetry={load} />;
  if (!detail) return null;

  return (
    <div className="flex flex-col gap-3">
      <QuestionCard detail={detail} />

      <Notice tone="warning">
        <strong>這一題的問題：</strong>
        {servabilityReasonText(issueCodeOf(item))}
        {detail.servability.reason ? `（系統訊息：${detail.servability.reason}）` : ""}
      </Notice>

      <form onSubmit={submit} noValidate className="flex flex-col gap-3" aria-label="記錄你的決定">
        <div
          className="card flex flex-col gap-3"
          role="group"
          aria-labelledby="servability-decision-title"
        >
          <h2 id="servability-decision-title" className="text-lg font-bold">
            你的決定
          </h2>
          {SERVABILITY_DECISIONS.map((entry) => {
            const disabled = entry.value === "approve_after_verified_repair" && !detail.servability.ok;
            return (
              <button
                key={entry.value}
                type="button"
                className={decision === entry.value ? "btn btn-primary" : "btn"}
                style={{ flexDirection: "column", alignItems: "flex-start", padding: "0.75rem 0.95rem" }}
                aria-pressed={decision === entry.value}
                disabled={disabled}
                onClick={() => {
                  setDecision(entry.value);
                  setFormError(null);
                  markDirty();
                }}
              >
                <span style={{ fontSize: "1.05rem" }}>{entry.label}</span>
                <span style={{ fontWeight: 400, fontSize: "0.85rem" }}>{entry.effect}</span>
              </button>
            );
          })}
          {!detail.servability.ok ? (
            <p className="text-sm text-gray-600">
              「{SERVABILITY_DECISIONS[2].label}」暫時不能用：題目現時仍未可正常作答。
            </p>
          ) : null}

          <details className="text-sm">
            <summary>其他決定</summary>
            <div className="mt-2 flex flex-col gap-2">
              {SERVABILITY_SECONDARY_DECISIONS.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  className="btn"
                  style={{ flexDirection: "column", alignItems: "flex-start" }}
                  aria-pressed={decision === entry.value}
                  onClick={() => {
                    setDecision(entry.value);
                    setFormError(null);
                    markDirty();
                  }}
                >
                  <span>{entry.label}</span>
                  <span style={{ fontWeight: 400, fontSize: "0.85rem" }}>{entry.effect}</span>
                </button>
              ))}
            </div>
          </details>
        </div>

        {chosen ? (
          <div className="card flex flex-col gap-3" role="group" aria-labelledby="servability-reason-title">
            <h2 id="servability-reason-title" className="text-lg font-bold">
              為甚麼？
            </h2>
            <ReasonPicker
              chips={chips}
              onToggle={toggleChip}
              freeText={freeText}
              onFreeText={(value) => {
                setFreeText(value);
                markDirty();
              }}
              hint="點選最接近的一句就可以（可以選多於一句）。"
            />
            <p className="text-sm text-gray-600">
              你會提交的決定：<strong>{chosen.label}</strong>
              {reasonValue ? `；理由：${reasonValue}` : "；仍未選理由"}
            </p>
            {formError ? (
              <div ref={focusFormError} id="servability-form-error" role="alert" tabIndex={-1}>
                <Notice tone="warning">{formError}</Notice>
              </div>
            ) : null}
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? "正在提交…" : "確認提交"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setDecision(null);
                  setChips([]);
                  setFreeText("");
                  setFormError(null);
                  onDirtyChange?.(false);
                }}
              >
                取消
              </button>
            </div>
          </div>
        ) : null}
      </form>

      <TechnicalDetails detail={detail} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 評分示例題（Golden）                                                */
/* ------------------------------------------------------------------ */

interface GoldenQueueDetail {
  stem?: string;
  options?: string[];
  correctAnswer?: string;
  acceptedAnswers?: string[];
  explanation?: string;
  questionType?: "mc" | "fill";
  evidence?: { sourceExcerpt?: string; sourceLocation?: string; sourceBlockIds?: string[] };
  latestDecision?: {
    decision: string;
    reason: string;
    reviewerEmail: string;
    createdAt: string;
    stillValid: boolean;
  } | null;
  candidateRevision?: number;
  fingerprintMatchesCandidate?: boolean;
}

function GoldenPanel({
  item,
  onDone,
  onDirtyChange,
}: {
  item: QueueItem;
  onDone: (message: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const detail = (item.detail ?? {}) as GoldenQueueDetail;
  const options = detail.options ?? [];
  const correctAnswer = detail.correctAnswer ?? "";
  const wrongOptions = options.filter((option) => option !== correctAnswer);

  const [decision, setDecision] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [reference, setReference] = useState("");
  const [level, setLevel] = useState("1");
  const [distractorNotes, setDistractorNotes] = useState<Record<string, string>>({});
  const [chips, setChips] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const focusFormError = useCallback((node: HTMLDivElement | null) => {
    if (node) node.focus();
  }, []);

  const reasonValue = composeReason(chips, freeText);
  const chosen = decision ? GOLDEN_DECISIONS.find((entry) => entry.value === decision) ?? null : null;

  function markDirty() {
    onDirtyChange?.(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!decision) {
      setFormError("請先按上面其中一個按鈕，選擇你的決定。");
      return;
    }
    if (reasonValue.trim().length < 5) {
      setFormError("請至少選一句理由（或自己寫幾個字）。");
      return;
    }
    if (decision === "approved") {
      if (!category) {
        setFormError("要用作示例，請先選擇評估類別。");
        return;
      }
      if (reasoning.trim().length < 8) {
        setFormError("要用作示例，請寫幾句審核理由（至少 8 個字）。");
        return;
      }
      const missingNotes = wrongOptions.filter(
        (option) => (distractorNotes[option] ?? "").trim().length < 4,
      );
      if (missingNotes.length > 0) {
        setFormError(`請為每個錯誤選項寫一句說明（至少 4 個字）：${missingNotes.join("、")}`);
        return;
      }
    }
    setSubmitting(true);
    try {
      const grading = correctAnswer.length > 0 ? [{ answer: correctAnswer, correct: true }] : [];
      const fixture =
        decision === "approved"
          ? {
              category,
              reasoning: reasoning.trim(),
              grading,
              distractorNotes: wrongOptions.map((option) => ({
                option,
                why: (distractorNotes[option] ?? "").trim(),
              })),
              knownEdgeCases: [],
              reference: reference.trim().length > 0 ? reference.trim() : null,
              level: Number(level) || 1,
            }
          : undefined;
      await api.post(`/api/teacher/golden/${item.id}`, {
        decision,
        reason: reasonValue.trim(),
        expectedRevision: item.revision ?? 1,
        ...(fixture ? { fixture } : {}),
      });
      onDone("已記錄你的決定。這只影響評分基準，不會改變題目是否派給學生。");
      setDecision(null);
      setChips([]);
      setFreeText("");
      onDirtyChange?.(false);
    } catch (caught) {
      setFormError(errorText(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3" aria-label="評分示例決定">
      <article className="card flex flex-col gap-3">
        <h2 className="text-lg font-bold">這一題</h2>
        <p className="text-lg" style={{ fontWeight: 600 }}>
          {detail.stem ?? "（沒有題幹）"}
        </p>
        {options.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="選項">
            {options.map((option) => (
              <li
                key={option}
                className="option-row"
                data-state={option === correctAnswer ? "correct" : undefined}
              >
                <span className="flex-1">{option}</span>
                {option === correctAnswer ? (
                  <span className="badge badge-success">正確答案</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>
            <span className="badge badge-success">正確答案</span> {correctAnswer || "（沒有）"}
          </p>
        )}
        <p className="text-sm text-gray-600">課本原文：{detail.evidence?.sourceExcerpt || "（沒有）"}</p>
      </article>

      <div className="card flex flex-col gap-3" role="group" aria-labelledby="golden-decision-title">
        <h2 id="golden-decision-title" className="text-lg font-bold">
          你的決定
        </h2>
        {GOLDEN_DECISIONS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            className={decision === entry.value ? "btn btn-primary" : "btn"}
            style={{ flexDirection: "column", alignItems: "flex-start", padding: "0.75rem 0.95rem" }}
            aria-pressed={decision === entry.value}
            onClick={() => {
              setDecision(entry.value);
              setFormError(null);
              markDirty();
            }}
          >
            <span style={{ fontSize: "1.05rem" }}>{entry.label}</span>
            <span style={{ fontWeight: 400, fontSize: "0.85rem" }}>{entry.effect}</span>
          </button>
        ))}
      </div>

      {chosen ? (
        <div className="card flex flex-col gap-3" role="group" aria-labelledby="golden-reason-title">
          <h2 id="golden-reason-title" className="text-lg font-bold">
            為甚麼？
          </h2>
          <ReasonPicker
            chips={chips}
            onToggle={(chip) => {
              setChips((current) =>
                current.includes(chip)
                  ? current.filter((entry) => entry !== chip)
                  : [...current, chip],
              );
              markDirty();
            }}
            freeText={freeText}
            onFreeText={(value) => {
              setFreeText(value);
              markDirty();
            }}
            hint="點選最接近的一句就可以（可以選多於一句）。"
          />

          {decision === "approved" ? (
            <details className="text-sm">
              <summary>用作示例要填寫的資料（老師提供，系統不會代填）</summary>
              <div className="mt-2 flex flex-col gap-2">
                <label htmlFor="golden-category">這一題主要考甚麼？</label>
                <select
                  id="golden-category"
                  value={category}
                  onChange={(event) => {
                    setCategory(event.target.value);
                    markDirty();
                  }}
                  className="rounded-lg border px-3 py-2"
                  style={{ borderColor: "var(--border-strong)", background: "var(--surface)" }}
                >
                  <option value="">請選擇</option>
                  {Object.entries(GOLDEN_CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>

                <label htmlFor="golden-reasoning">審核理由（至少 8 個字）</label>
                <textarea
                  id="golden-reasoning"
                  rows={3}
                  value={reasoning}
                  onChange={(event) => {
                    setReasoning(event.target.value);
                    markDirty();
                  }}
                  className="w-full rounded-lg border px-3 py-2"
                  style={{ borderColor: "var(--border-strong)", background: "var(--surface)" }}
                />

                <label htmlFor="golden-reference">權威來源（沒有可留空）</label>
                <input
                  id="golden-reference"
                  value={reference}
                  onChange={(event) => {
                    setReference(event.target.value);
                    markDirty();
                  }}
                  className="rounded-lg border px-3 py-2"
                  style={{ borderColor: "var(--border-strong)", background: "var(--surface)" }}
                />

                <label htmlFor="golden-level">級別（1–3）</label>
                <input
                  id="golden-level"
                  type="number"
                  min={1}
                  max={3}
                  value={level}
                  onChange={(event) => {
                    setLevel(event.target.value);
                    markDirty();
                  }}
                  className="rounded-lg border px-3 py-2"
                  style={{ borderColor: "var(--border-strong)", background: "var(--surface)" }}
                />

                {wrongOptions.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <p>為每個錯誤選項寫一句：為甚麼學生會選錯？</p>
                    {wrongOptions.map((option) => (
                      <div key={option} className="flex flex-col gap-1">
                        <label htmlFor={`distractor-${option}`}>{option}</label>
                        <input
                          id={`distractor-${option}`}
                          value={distractorNotes[option] ?? ""}
                          onChange={(event) => {
                            setDistractorNotes((current) => ({
                              ...current,
                              [option]: event.target.value,
                            }));
                            markDirty();
                          }}
                          className="rounded-lg border px-3 py-2"
                          style={{ borderColor: "var(--border-strong)", background: "var(--surface)" }}
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}

          <p className="text-sm text-gray-600">
            你會提交的決定：<strong>{chosen.label}</strong>
            {reasonValue ? `；理由：${reasonValue}` : "；仍未選理由"}
          </p>
          {formError ? (
            <div ref={focusFormError} id="golden-form-error" role="alert" tabIndex={-1}>
              <Notice tone="warning">{formError}</Notice>
            </div>
          ) : null}
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? "正在提交…" : "確認提交"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setDecision(null);
                setChips([]);
                setFreeText("");
                setFormError(null);
                onDirtyChange?.(false);
              }}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      <details className="text-sm text-gray-600">
        <summary>技術資料（一般不需要理會）</summary>
        <dl className="mt-2 grid grid-cols-1 gap-1">
          <dt>題目編號</dt>
          <dd>{item.id}</dd>
          <dt>目前版本</dt>
          <dd>
            第 {item.revision ?? "?"} 版（候選第 {detail.candidateRevision ?? "?"} 版）
          </dd>
          <dt>與候選版本一致</dt>
          <dd>{detail.fingerprintMatchesCandidate ? "是" : "否（請重新載入清單）"}</dd>
          <dt>狀態</dt>
          <dd>{item.status}</dd>
          <dt>來源位置</dt>
          <dd>{detail.evidence?.sourceLocation || "（沒有）"}</dd>
          <dt>上一次決定</dt>
          <dd>
            {detail.latestDecision
              ? `${detail.latestDecision.decision}｜${detail.latestDecision.reviewerEmail}｜${detail.latestDecision.createdAt}${detail.latestDecision.stillValid ? "" : "（已失效）"}`
              : "沒有"}
          </dd>
        </dl>
      </details>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* 要跟進課本依據的題目                                                */
/* ------------------------------------------------------------------ */

function ProvenancePanel({ item }: { item: QueueItem }) {
  const detail = item.detail as {
    priority?: string;
    repairCategory?: string;
    sourceStatus?: string;
    overlapsSourcePending?: boolean;
    servable?: boolean;
    issueCode?: string | null;
    requiredDecision?: string;
    notice?: string;
  };

  return (
    <article className="card flex flex-col gap-3">
      <h2 className="text-lg font-bold">這一題需要你核對課本依據</h2>
      <Notice tone="info">
        這裡只顯示現有的核對資料，沒有「一按就完成」的按鈕。看完後請到題目頁面補上或修正課本依據，
        再回到覆核流程記錄。
      </Notice>
      <dl className="grid grid-cols-1 gap-1 text-sm">
        <dt>題目現時可否作答</dt>
        <dd>{detail.servable ? "可以（但仍未有老師逐題確認）" : "不可以，需要先修好題目"}</dd>
        <dt>優先次序</dt>
        <dd>
          {detail.priority === "P1" ? "高（請先處理）" : detail.priority === "P3" ? "一般" : (detail.priority ?? "—")}
        </dd>
        <dt>要處理的問題</dt>
        <dd>{detail.issueCode ? servabilityReasonText(detail.issueCode) : (detail.repairCategory ?? "—")}</dd>
      </dl>
      <details className="text-sm text-gray-600">
        <summary>技術資料（一般不需要理會）</summary>
        <dl className="mt-2 grid grid-cols-1 gap-1">
          <dt>題目編號</dt>
          <dd>{item.id}</dd>
          <dt>優先等級代碼</dt>
          <dd>{detail.priority ?? "—"}</dd>
          <dt>修復分類</dt>
          <dd>{detail.repairCategory ?? "—"}</dd>
          <dt>來源狀態</dt>
          <dd>{detail.sourceStatus ?? "—"}</dd>
          <dt>與待核實來源重疊</dt>
          <dd>{detail.overlapsSourcePending ? "是" : "否"}</dd>
          <dt>需要的決定</dt>
          <dd>{detail.requiredDecision ?? "—"}</dd>
        </dl>
        <p className="mt-2">{detail.notice ?? "P1／P3 只是覆核排序，不是核准狀態。"}</p>
      </details>
    </article>
  );
}
