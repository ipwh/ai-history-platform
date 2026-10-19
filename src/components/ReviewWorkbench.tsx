"use client";

/**
 * 教師審核工作台（Sprint 16）。
 *
 * 三個佇列：不可作答（97）、修復 provenance 風險（623）、Golden 候選（42）。
 * 伺服器仍然是唯一權威：所有裁決都經既有 API，客戶端狀態不會令題目變成可派發。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, ApiError } from "@/lib/api-client";
import { ErrorNotice, Loading, Notice } from "@/components/ui";

type QueueKind = "servability" | "provenance" | "golden";

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

const QUEUE_LABELS: Record<QueueKind, string> = {
  servability: "不可作答題目（待裁決）",
  provenance: "修復 provenance 風險（排序）",
  golden: "Golden 候選（待教師核准）",
};

const DECISION_LABELS: Record<string, string> = {
  return_to_draft: "退回草稿（題目回到草稿，不會派發）",
  keep_quarantined: "保留隔離（維持不可派發，並保留待教師確認標記）",
  request_more_evidence: "要求補充證據（退回草稿並註明缺少的證據）",
  reject: "標示不可用（留在草稿，不再採用）",
  approve_after_verified_repair: "已修復並核准（只在題目已可作答時成功）",
};

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
      return `${error.message}（題目可能已被修改，請重新載入後再審閱。）`;
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

  /** 切換佇列、頁碼或題目前先確認，避免默默丟失未提交的裁決內容。 */
  function confirmDiscard(): boolean {
    if (!dirtyRef.current) return true;
    const proceed = window.confirm(
      "目前有尚未提交的裁決內容（理由或評估欄位）。切換佇列、頁碼或題目會失去這些內容，確定要繼續嗎？",
    );
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
    <section className="stack">
      <header className="stack" style={{ gap: 8 }}>
        <h1>教師審核工作台</h1>
        <p className="muted">
          佇列只顯示既有稽核證據；裁決一律由伺服器驗證（版本、指紋、學科授權）。
          任何裁決都不會令題目自動可派發，除非題目本身已可作答並通過覆核。
        </p>
      </header>

      <div role="tablist" aria-label="審核佇列" className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        {(Object.keys(QUEUE_LABELS) as QueueKind[]).map((kind) => (
          <button
            key={kind}
            role="tab"
            type="button"
            aria-selected={queue === kind}
            className={queue === kind ? "button" : "button secondary"}
            onClick={() => changeQueue(kind)}
          >
            {QUEUE_LABELS[kind]}
          </button>
        ))}
      </div>

      {loading ? <Loading label="載入審核佇列…" /> : null}
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
          <p className="muted" aria-live="polite">
            共 {data.total} 項
            {Object.keys(data.counts).length > 0
              ? `（${Object.entries(data.counts)
                  .map(([key, value]) => `${key} ${value}`)
                  .join("、")}）`
              : ""}
            {data.asOf ? `；資料時間 ${data.asOf}` : ""}
          </p>
          {data.limitation ? <Notice tone="info">{data.limitation}</Notice> : null}
          {!data.available ? (
            <Notice tone="warning">
              此佇列的稽核報告尚未產生，無法顯示。請先執行對應的 audit 指令，系統不會以推測數字代替。
            </Notice>
          ) : null}

          {data.available && data.items.length === 0 ? (
            <Notice tone="info">此佇列目前沒有項目。</Notice>
          ) : null}

          {data.available ? (
            <div className="row" style={{ alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
              <ol
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  flex: "1 1 320px",
                  minWidth: 280,
                }}
                aria-label="佇列項目"
              >
                {data.items.map((item) => (
                  <li key={item.id} style={{ marginBottom: 8 }}>
                    <button
                      type="button"
                      className="button secondary"
                      style={{ width: "100%", textAlign: "left" }}
                      aria-pressed={selected === item.id}
                      onClick={() => {
                        if (item.id !== selected && !confirmDiscard()) return;
                        setSelected(item.id);
                        setFeedback(null);
                      }}
                    >
                      <strong>{item.id}</strong>
                      <br />
                      <span className="muted">
                        第 {item.revision ?? "?"} 版 ｜ {item.status} ｜ {item.summary}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>

              <div style={{ flex: "2 1 420px", minWidth: 320 }}>
                {selected ? (
                  queue === "servability" ? (
                    <ServabilityPanel
                      key={selected}
                      questionId={selected}
                      onDirtyChange={(dirty) => {
                        dirtyRef.current = dirty;
                      }}
                      onDone={(message) => {
                        setFeedback(message);
                        reload();
                      }}
                    />
                  ) : queue === "golden" ? (
                    <GoldenPanel
                      key={selected}
                      item={data.items.find((entry) => entry.id === selected) ?? null}
                      onDirtyChange={(dirty) => {
                        dirtyRef.current = dirty;
                      }}
                      onDone={(message) => {
                        setFeedback(message);
                        reload();
                      }}
                    />
                  ) : (
                    <ProvenancePanel
                      item={data.items.find((entry) => entry.id === selected) ?? null}
                    />
                  )
                ) : (
                  <Notice tone="info">從左邊選擇一條題目查看證據及可用的決定。</Notice>
                )}
              </div>
            </div>
          ) : null}

          {data.available && data.total > data.pageSize ? (
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <button
                type="button"
                className="button secondary"
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
                className="button secondary"
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

interface QuestionDetailEnvelope {
  view: { question: QuestionDetail["question"] };
  servability?: { ok: boolean; reason: string | null };
  reviews?: ReviewRecord[];
}

function ServabilityPanel({
  questionId,
  onDone,
  onDirtyChange,
}: {
  questionId: string;
  onDone: (message: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [detail, setDetail] = useState<QuestionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [decision, setDecision] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  // 用 callback ref 在錯誤區每次掛載（包括重新載入後再次顯示）時取得焦點，
  // 只在 formError 變更時以 effect 聚焦會漏掉「重新載入後同樣錯誤再次出現」的情況。
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
          servability:
            result.servability ?? {
              ok: false,
              reason: "伺服器未回報可作答性判定，因此不視為可派發。",
            },
          reviews: result.reviews ?? [],
        });
        setError(null);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught);
        setDetail(null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [questionId, reloadToken]);

  function load() {
    setLoading(true);
    setError(null);
    setReloadToken((current) => current + 1);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!detail) return;
    if (!decision) {
      setFormError("請選擇一個決定。");
      return;
    }
    if (reason.trim().length < 5) {
      setFormError("請填寫至少 5 個字的理由。");
      return;
    }
    if (!confirmed) {
      setFormError("請先確認你已閱讀題目及來源證據。");
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/api/teacher/questions/${questionId}/servability`, {
        decision,
        reason: reason.trim(),
        expectedRevision: detail.question.revision,
      });
      onDone(`已記錄裁決（第 ${detail.question.revision} 版）。題目不會因此自動可派發。`);
      setDecision("");
      setReason("");
      setConfirmed(false);
      onDirtyChange?.(false);
      await load();
    } catch (caught) {
      setFormError(errorText(caught));
      if (isConflict(caught)) await load();
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Loading label="載入題目證據…" />;
  if (error) return <ErrorNotice error={error} onRetry={load} />;
  if (!detail) return null;
  const { question, servability, reviews } = detail;

  return (
    <article className="card stack" style={{ gap: 12 }}>
      <h2>題目 {question.id}</h2>
      <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 12px" }}>
        <dt>版本</dt>
        <dd>第 {question.revision} 版</dd>
        <dt>狀態</dt>
        <dd>
          {question.status}
          {question.teacherConfirmationRequired ? "（待教師確認）" : ""}
        </dd>
        <dt>可作答性</dt>
        <dd>{servability.ok ? "結構上可作答" : servability.reason}</dd>
        <dt>題型</dt>
        <dd>{question.questionType === "mc" ? "選擇題" : "填充題"}</dd>
        <dt>題幹</dt>
        <dd>{question.question}</dd>
        {question.options.length > 0 ? (
          <>
            <dt>選項</dt>
            <dd>{question.options.join(" ／ ")}</dd>
          </>
        ) : null}
        <dt>標準答案</dt>
        <dd>{question.correctAnswer}</dd>
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
        <dd>
          {question.gradingPoints.length > 0 ? question.gradingPoints.join("；") : "（沒有）"}
        </dd>
        <dt>來源位置</dt>
        <dd>
          {question.sourceLocation || "（沒有記錄）"}
          {question.sourceBlockIds.length > 0
            ? `（段落 ${question.sourceBlockIds.join("、")}）`
            : "（沒有教材段落依據）"}
        </dd>
        <dt>解釋</dt>
        <dd>{question.explanation}</dd>
      </dl>

      <details>
        <summary>既有覆核歷史（唯讀，共 {reviews.length} 筆）</summary>
        <ul>
          {reviews.length === 0 ? <li>沒有覆核紀錄。</li> : null}
          {reviews.map((review, index) => (
            <li key={`${review.createdAt}-${index}`}>
              {review.createdAt}｜{review.decision}｜角色 {review.reviewerRole}｜第 {review.revision} 版
              {review.reason ? `｜${review.reason}` : ""}
            </li>
          ))}
        </ul>
      </details>

      <form
        onSubmit={submit}
        noValidate
        className="stack"
        style={{ gap: 8 }}
        aria-label="不可作答題目裁決"
      >
        <fieldset>
          <legend>記錄新的裁決（第 {question.revision} 版）</legend>
          <label htmlFor="servability-decision">決定</label>
          <select
            id="servability-decision"
            value={decision}
            onChange={(event) => {
              setDecision(event.target.value);
              onDirtyChange?.(true);
            }}
            aria-invalid={formError !== null}
            aria-describedby={formError ? "servability-form-error" : undefined}
            required
          >
            <option value="">請選擇（不會預設為核准）</option>
            {Object.entries(DECISION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <ul className="muted">
            <li>只有「已修復並核准」可能令題目可派發，而且題目必須已通過結構檢查。</li>
            <li>其餘決定只會把題目留在草稿或維持隔離，不會令學生看到。</li>
            <li>沒有原卷證據時，請選擇要求補充證據或保留隔離，不要推測答案。</li>
          </ul>
          <label htmlFor="servability-reason">理由（至少 5 個字）</label>
          <textarea
            id="servability-reason"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              onDirtyChange?.(true);
            }}
            rows={3}
            maxLength={500}
            aria-invalid={formError !== null}
            aria-describedby={formError ? "servability-form-error" : undefined}
            required
          />
        </fieldset>
        <label>
          <input
            type="checkbox"
            checked={confirmed}
            aria-invalid={formError !== null}
            aria-describedby={formError ? "servability-form-error" : undefined}
            onChange={(event) => {
              setConfirmed(event.target.checked);
              onDirtyChange?.(true);
            }}
          />{" "}
          我已閱讀題目、來源證據及既有覆核歷史，並確認以上決定。
        </label>
        {formError ? (
          <div ref={focusFormError} id="servability-form-error" role="alert" tabIndex={-1}>
            <Notice tone="warning">{formError}</Notice>
          </div>
        ) : null}
        <div className="row" style={{ gap: 8 }}>
          <button type="submit" className="button" disabled={submitting}>
            {submitting ? "提交中…" : "提交裁決"}
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              if (
                (decision.length > 0 || reason.trim().length > 0 || confirmed) &&
                !window.confirm("重新載入會清除尚未提交的內容，確定要繼續嗎？")
              ) {
                return;
              }
              onDirtyChange?.(false);
              void load();
            }}
          >
            重新載入題目
          </button>
        </div>
      </form>
    </article>
  );
}

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

const GOLDEN_CATEGORIES = [
  "chronology",
  "cause-consequence",
  "significance",
  "comparison",
  "people",
  "treaty",
  "plausible-distractors",
] as const;

function GoldenPanel({
  item,
  onDone,
  onDirtyChange,
}: {
  item: QueueItem | null;
  onDone: (message: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const detail = (item?.detail ?? {}) as GoldenQueueDetail;
  const options = detail.options ?? [];
  const correctAnswer = detail.correctAnswer ?? "";
  const wrongOptions = options.filter((option) => option !== correctAnswer);

  const [decision, setDecision] = useState("");
  const focusFormError = useCallback((node: HTMLDivElement | null) => {
    if (node) node.focus();
  }, []);
  const [category, setCategory] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [reference, setReference] = useState("");
  const [level, setLevel] = useState("1");
  const [distractorNotes, setDistractorNotes] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (!item) return <Notice tone="info">請選擇一個候選。</Notice>;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!item) return;
    setFormError(null);
    if (!decision) {
      setFormError("請選擇一個決定（不會預設為核准）。");
      return;
    }
    if (reason.trim().length < 5) {
      setFormError("請填寫至少 5 個字的裁決理由。");
      return;
    }
    if (decision === "approved") {
      if (!category) {
        setFormError("核准需要選擇評估類別。");
        return;
      }
      if (reasoning.trim().length < 8) {
        setFormError("核准需要至少 8 個字的審核理由。");
        return;
      }
      const missingNotes = wrongOptions.filter(
        (option) => (distractorNotes[option] ?? "").trim().length < 4,
      );
      if (missingNotes.length > 0) {
        setFormError(`請為每個錯誤選項填寫至少 4 個字的說明：${missingNotes.join("、")}`);
        return;
      }
    }
    if (!confirmed) {
      setFormError("請先確認你已閱讀題目及來源證據。");
      return;
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
        reason: reason.trim(),
        expectedRevision: item.revision ?? 1,
        ...(fixture ? { fixture } : {}),
      });
      onDone(`已記錄 Golden 裁決（${decision}）。核准只代表評估基準，不會改變題目發布狀態。`);
      setConfirmed(false);
      setReason("");
      onDirtyChange?.(false);
    } catch (caught) {
      setFormError(errorText(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <article className="card stack" style={{ gap: 12 }}>
      <h2>Golden 候選 {item.id}</h2>
      <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 12px" }}>
        <dt>目前版本</dt>
        <dd>
          第 {item.revision ?? "?"} 版（候選第 {detail.candidateRevision ?? "?"} 版）
        </dd>
        <dt>指紋與候選一致</dt>
        <dd>{detail.fingerprintMatchesCandidate ? "是" : "否（請重新載入候選清單）"}</dd>
        <dt>狀態</dt>
        <dd>{item.status}</dd>
        <dt>題型</dt>
        <dd>{detail.questionType === "mc" ? "選擇題" : "填充題"}</dd>
        <dt>題幹</dt>
        <dd>{detail.stem ?? "（沒有）"}</dd>
        {options.length > 0 ? (
          <>
            <dt>選項</dt>
            <dd>{options.join(" ／ ")}</dd>
          </>
        ) : null}
        <dt>標準答案</dt>
        <dd>{correctAnswer || "（沒有）"}</dd>
        <dt>來源節錄</dt>
        <dd>{detail.evidence?.sourceExcerpt || "（沒有）"}</dd>
        <dt>來源位置</dt>
        <dd>{detail.evidence?.sourceLocation || "（沒有）"}</dd>
        <dt>既有裁決</dt>
        <dd>
          {detail.latestDecision
            ? `${detail.latestDecision.decision}｜${detail.latestDecision.reviewerEmail}｜${detail.latestDecision.createdAt}${detail.latestDecision.stillValid ? "" : "（已失效）"}`
            : "沒有"}
        </dd>
      </dl>

      <form
        onSubmit={submit}
        noValidate
        className="stack"
        style={{ gap: 8 }}
        aria-label="Golden fixture 裁決"
      >
        <fieldset>
          <legend>記錄 Golden 裁決（第 {item.revision ?? "?"} 版）</legend>
          <label htmlFor="golden-decision">決定</label>
          <select
            id="golden-decision"
            value={decision}
            onChange={(event) => {
              setDecision(event.target.value);
              onDirtyChange?.(true);
            }}
            aria-invalid={formError !== null}
            aria-describedby={formError ? "golden-form-error" : undefined}
            required
          >
            <option value="">請選擇（不會預設為核准）</option>
            <option value="approved">核准（需完整評估內容）</option>
            <option value="rejected">拒絕</option>
            <option value="revision_requested">要求修訂</option>
          </select>

          {decision === "approved" ? (
            <>
              <p className="muted">
                以下欄位是評估基準的一部分，必須由歷史科教師提供；系統不會代填或推測。
              </p>
              <label htmlFor="golden-category">評估類別</label>
              <select
                id="golden-category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                required
              >
                <option value="">請選擇</option>
                {GOLDEN_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <label htmlFor="golden-reasoning">審核理由（至少 8 個字）</label>
              <textarea
                id="golden-reasoning"
                value={reasoning}
                onChange={(event) => setReasoning(event.target.value)}
                rows={3}
                required
              />
              <label htmlFor="golden-reference">權威來源（沒有可留空）</label>
              <input
                id="golden-reference"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
              />
              <label htmlFor="golden-level">級別（1–3）</label>
              <input
                id="golden-level"
                type="number"
                min={1}
                max={3}
                value={level}
                onChange={(event) => setLevel(event.target.value)}
              />
              {wrongOptions.length > 0 ? (
                <fieldset>
                  <legend>錯誤選項說明</legend>
                  {wrongOptions.map((option) => (
                    <div key={option}>
                      <label htmlFor={`distractor-${option}`}>{option}</label>
                      <input
                        id={`distractor-${option}`}
                        value={distractorNotes[option] ?? ""}
                        onChange={(event) =>
                          setDistractorNotes((current) => ({
                            ...current,
                            [option]: event.target.value,
                          }))
                        }
                      />
                    </div>
                  ))}
                </fieldset>
              ) : null}
            </>
          ) : null}

          <label htmlFor="golden-reason">裁決理由（至少 5 個字）</label>
          <textarea
            id="golden-reason"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              onDirtyChange?.(true);
            }}
            rows={2}
            maxLength={500}
            aria-invalid={formError !== null}
            aria-describedby={formError ? "golden-form-error" : undefined}
            required
          />
        </fieldset>
        <p className="muted">
          Golden 裁決只影響評估基準，不會改變題目的發布狀態；題目內容一旦修改，舊裁決自動失效。
        </p>
        <label>
          <input
            type="checkbox"
            checked={confirmed}
            aria-invalid={formError !== null}
            aria-describedby={formError ? "golden-form-error" : undefined}
            onChange={(event) => {
              setConfirmed(event.target.checked);
              onDirtyChange?.(true);
            }}
          />{" "}
          我已核對題目、來源證據及評分方式，並確認以上裁決。
        </label>
        {formError ? (
          <div ref={focusFormError} id="golden-form-error" role="alert" tabIndex={-1}>
            <Notice tone="warning">{formError}</Notice>
          </div>
        ) : null}
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? "提交中…" : "提交 Golden 裁決"}
        </button>
      </form>
    </article>
  );
}

function ProvenancePanel({ item }: { item: QueueItem | null }) {
  if (!item) return <Notice tone="info">請選擇一條題目。</Notice>;
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
    <article className="card stack" style={{ gap: 8 }}>
      <h2>修復 provenance：{item.id}</h2>
      <Notice tone="info">{detail.notice ?? "P1／P3 只是覆核排序，不是核准狀態。"}</Notice>
      <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 12px" }}>
        <dt>等級</dt>
        <dd>{detail.priority ?? "—"}</dd>
        <dt>修復分類</dt>
        <dd>{detail.repairCategory ?? "—"}</dd>
        <dt>來源狀態</dt>
        <dd>{detail.sourceStatus ?? "—"}</dd>
        <dt>與來源待核實重疊</dt>
        <dd>{detail.overlapsSourcePending ? "是" : "否"}</dd>
        <dt>目前可作答</dt>
        <dd>
          {detail.servable ? "是（仍未有教師逐題確認）" : `否（${detail.issueCode ?? "結構問題"}）`}
        </dd>
        <dt>必要決定</dt>
        <dd>{detail.requiredDecision ?? "—"}</dd>
      </dl>
      <p className="muted">
        這個佇列沒有逐題裁決 API：provenance 覆核需要按 manifest 的證據契約進行，完成後再以題目覆核或
        servability 裁決記錄。系統不會把 P3 當作已核准。
      </p>
    </article>
  );
}
