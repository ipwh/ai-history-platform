"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api-client";
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  QUESTION_ORIGIN_LABELS,
  QUESTION_REPORT_STATUS_LABELS,
  QUESTION_REVIEW_STATE_LABELS,
  QUESTION_STATUS_LABELS,
  STUDENT_EXCERPT_HIDDEN_REASON_LABELS,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  type Difficulty,
  type GeneratedQuestionPreview,
  type Question,
  type QuestionReportDetail,
  type QuestionReportStatus,
  type QuestionReviewDecision,
  type QuestionReviewState,
  type QuestionReviewStatus,
  type QuestionStatus,
  type QuestionType,
  type TopicOverview,
} from "@/lib/types";
import { ErrorNotice, Loading, Notice } from "@/components/ui";
import { QuestionReportPanel } from "@/components/QuestionReportPanel";

interface GenerateResult extends GeneratedQuestionPreview {
  notice: string | null;
  usable: boolean;
}

/**
 * 題目管理（教師端）。
 *
 * @param focusGenerate 由 /teacher/questions/generate 進入時，把生成區塊放在最前並自動捲動。
 */
export function QuestionManager({
  focusGenerate = false,
  focusQuestionId = null,
}: {
  focusGenerate?: boolean;
  /** 由教師審核工作台進入時指定要直接開啟的題目（`?question=<id>`） */
  focusQuestionId?: string | null;
} = {}) {
  const [topics, setTopics] = useState<TopicOverview[]>([]);
  const [topicId, setTopicId] = useState<string>("");
  const [sectionId, setSectionId] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [originFilter, setOriginFilter] = useState<string>("");
  const [questions, setQuestions] = useState<Question[] | null>(null);
  /** 每題的人工覆核狀態（與題目分開存放，令題目物件的形狀保持不變） */
  const [reviewStatus, setReviewStatus] = useState<Map<string, QuestionReviewStatus>>(new Map());
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [generateSections, setGenerateSections] = useState<string[]>([]);
  const [generateTypes, setGenerateTypes] = useState<QuestionType[]>(["mc"]);
  const [generateDifficulty, setGenerateDifficulty] = useState<Difficulty>("basic");
  const [generateCount, setGenerateCount] = useState(5);
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<GenerateResult | null>(null);
  const [generateError, setGenerateError] = useState<unknown>(null);

  const [editorState, setEditorState] = useState<{ mode: "new" | "edit"; question?: Question } | null>(
    null,
  );

  const [questionsReloadToken, setQuestionsReloadToken] = useState(0);
  const generateSectionRef = useRef<HTMLElement | null>(null);

  /** 由 /teacher/questions/generate 進入時，把生成區塊捲入畫面（方便直接開始生成） */
  useEffect(() => {
    if (!focusGenerate) return;
    generateSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusGenerate]);

  /**
   * 由教師審核工作台以 `?question=<id>` 進入時，直接開啟該題的編輯表單。
   *
   * 沒有單一題目的 GET 端點，但覆核端點會回傳完整題目（`view.question`），因此沿用
   * 同一個已受 `requireTeacher` 保護的來源，不另開 API。載入失敗時如實顯示錯誤，
   * 不會假裝已開啟。
   */
  const [focusError, setFocusError] = useState<unknown>(null);
  useEffect(() => {
    if (!focusQuestionId) return;
    let cancelled = false;
    api
      .get<{ view: { question: Question } }>(`/api/teacher/questions/${focusQuestionId}/review`)
      .then((result) => {
        if (cancelled) return;
        // 編輯器只會在已選定課題時顯示，因此同時設定課題，令深層連結可以直接開啟表單
        setTopicId(result.view.question.topicId);
        setSectionId(result.view.question.sectionId);
        setEditorState({ mode: "edit", question: result.view.question });
        setFocusError(null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setFocusError(caught);
      });
    return () => {
      cancelled = true;
    };
  }, [focusQuestionId]);

  const [reports, setReports] = useState<QuestionReportDetail[]>([]);
  const [reportStatusFilter, setReportStatusFilter] = useState<QuestionReportStatus | "">("open");
  const [reportTopicFilter, setReportTopicFilter] = useState<string>("");
  const [busyReportId, setBusyReportId] = useState<string | null>(null);
  const [reportsReloadToken, setReportsReloadToken] = useState(0);

  const refreshReports = useCallback(async () => {
    setReportsReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ limit: "50" });
    if (reportStatusFilter) query.set("status", reportStatusFilter);
    if (reportTopicFilter) query.set("topicId", reportTopicFilter);
    api
      .get<{ reports: QuestionReportDetail[] }>(`/api/teacher/reports?${query.toString()}`)
      .then((data) => {
        if (!cancelled) setReports(data.reports);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught);
      });
    return () => {
      cancelled = true;
    };
  }, [reportStatusFilter, reportTopicFilter, reportsReloadToken]);

  const openReportCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const report of reports) {
      if (report.status !== "open") continue;
      counts.set(report.questionId, (counts.get(report.questionId) ?? 0) + 1);
    }
    return counts;
  }, [reports]);

  async function handleResolveReport(reportId: string, status: QuestionReportStatus) {
    setBusyReportId(reportId);
    setError(null);
    try {
      await api.patch(`/api/teacher/reports?reportId=${encodeURIComponent(reportId)}`, { status });
      setMessage(
        status === "open" ? "已重設為待覆核。" : `已將回報標記為「${QUESTION_REPORT_STATUS_LABELS[status]}」。`,
      );
      await refreshReports();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusyReportId(null);
    }
  }

  /**
   * 從回報直接採取題目行動（Sprint 7.8 教師補救流程）：
   * `withdraw-question` 暫時下架題目（可隨時重新發布）；
   * `revalidate-question` 重新執行自動品質驗證，通過後才可能發布。
   * 兩者都由伺服器決定是否可行，前端只是觸發及顯示結果。
   *
   * Sprint 8.6：機器檢查通過但題目仍待教師確認時，訊息必須說清楚「要由你覆核」，
   * 不可顯示成驗證失敗，亦不可暗示已可發布。
   */
  async function handleReportAction(
    reportId: string,
    action: "withdraw-question" | "revalidate-question",
  ) {
    setBusyReportId(reportId);
    setError(null);
    try {
      const result = await api.patch<{
        remediation?: { action: string | null; autoValidated: boolean; issues: string[] };
      }>(`/api/teacher/reports?reportId=${encodeURIComponent(reportId)}`, { action });
      const remediation = result.remediation;
      if (action === "withdraw-question") {
        setMessage("已暫時下架題目（學生不再於新練習看到），可隨時重新發布。");
      } else if (remediation?.autoValidated === true) {
        setMessage("自動品質驗證通過，已記錄；確認內容後可按「發布」讓學生練習。");
      } else if (remediation?.action === "awaiting-teacher-confirmation") {
        setMessage(
          "機器檢查已通過，但這條題目仍待教師確認（自動發布暫緩）：請核對內容後按「覆核通過並發布」。",
        );
      } else {
        setMessage(
          `自動品質驗證未通過：${(remediation?.issues ?? []).join("；") || "請檢查教材依據及內容"}`,
        );
      }
      await refreshReports();
      await refreshQuestions();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusyReportId(null);
    }
  }
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ topics: TopicOverview[] }>("/api/topics")
      .then((data) => {
        if (cancelled) return;
        setTopics(data.topics);
        setTopicId((current) => {
          if (current !== "" || data.topics.length === 0) return current;
          const firstSection = data.topics[0].sections[0];
          if (firstSection) setGenerateSections([firstSection.id]);
          return data.topics[0].id;
        });
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!topicId) return;
    let cancelled = false;
    const query = new URLSearchParams({ topicId });
    if (sectionId) query.set("sectionId", sectionId);
    if (statusFilter) query.set("status", statusFilter);
    if (originFilter) query.set("origin", originFilter);

    api
      .get<{ questions: Question[]; reviews: QuestionReviewStatus[] }>(
        `/api/teacher/questions?${query.toString()}`,
      )
      .then((data) => {
        if (cancelled) return;
        setQuestions(data.questions);
        setReviewStatus(new Map(data.reviews.map((entry) => [entry.questionId, entry])));
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught);
      });

    return () => {
      cancelled = true;
    };
  }, [topicId, sectionId, statusFilter, originFilter, questionsReloadToken]);

  const refreshQuestions = useCallback(async () => {
    if (!topicId) return;
    const query = new URLSearchParams({ topicId });
    if (sectionId) query.set("sectionId", sectionId);
    if (statusFilter) query.set("status", statusFilter);
    if (originFilter) query.set("origin", originFilter);
    const data = await api.get<{ questions: Question[]; reviews: QuestionReviewStatus[] }>(
      `/api/teacher/questions?${query.toString()}`,
    );
    setQuestions(data.questions);
    setReviewStatus(new Map(data.reviews.map((entry) => [entry.questionId, entry])));
  }, [topicId, sectionId, statusFilter, originFilter]);

  const topic = useMemo(() => topics.find((item) => item.id === topicId) ?? null, [topics, topicId]);
  const sectionOptions = useMemo(
    () =>
      topic
        ? topic.sections.flatMap((section) => [
            { id: section.id, label: section.title },
            ...section.children.map((child) => ({
              id: child.id,
              label: `　${child.title}`,
            })),
          ])
        : [],
    [topic],
  );

  /** 有品質警告的題目數目（警告只提示教師核對，題目不會被丟棄） */
  const warningCount = useMemo(
    () =>
      generateResult
        ? generateResult.questions.filter((question) => question.qualityWarnings.length > 0).length
        : 0,
    [generateResult],
  );

  async function handleGenerate() {
    if (!topic || generateSections.length === 0 || generateTypes.length === 0) {
      setGenerateError(new Error("請選擇分節及題型。"));
      return;
    }
    setGenerating(true);
    setGenerateError(null);
    setGenerateResult(null);
    try {
      const result = await api.post<GenerateResult>("/api/teacher/questions/generate", {
        topicId: topic.id,
        sectionIds: generateSections,
        questionTypes: generateTypes,
        difficulty: generateDifficulty,
        questionCount: generateCount,
      });
      setGenerateResult(result);
      await refreshQuestions();
    } catch (caught) {
      setGenerateError(caught);
    } finally {
      setGenerating(false);
    }
  }

  async function handleStatus(questionId: string, status: QuestionStatus) {
    setError(null);
    try {
      await api.patch(`/api/teacher/questions/${questionId}`, { action: "status", status });
      setMessage(`已更新題目狀態為「${QUESTION_STATUS_LABELS[status]}」。`);
      await refreshQuestions();
    } catch (caught) {
      setError(caught);
    }
  }

  /**
   * 記錄人工覆核決定。
   *
   * 「覆核通過」即發布（會檢查目前版本是否有覆核紀錄）；「退回修改」及
   * 「不可用」必須填寫原因，因此會先要求教師輸入。
   *
   * Sprint 8.8：覆核通過也可以填寫理由（可留空），令「為甚麼這一版可用」同樣有紀錄，
   * 而不是只有退回／不可用才有原因。理由會與決定、版本及覆核者一併寫入不可修改的紀錄。
   *
   * Sprint 8.7：提交時一併送出教師**實際看到的版本**（`expectedRevision`）。
   * 若另一位教師（或同一位在另一個分頁）在提交前改了題目，伺服器會回 409 並提示
   * 重新載入，避免覆核被記到沒有看過的內容上。
   */
  async function handleReview(
    questionId: string,
    expectedRevision: number,
    decision: QuestionReviewDecision,
  ) {
    setError(null);
    let reason: string | null = null;
    if (decision !== "approved") {
      const input = window.prompt(
        decision === "returned"
          ? "退回修改的原因（例如：選項具誤導性、解釋不足）"
          : "標示不可用的原因（例如：教材未提及此史實）",
        "",
      );
      if (input === null) return;
      const trimmed = input.trim();
      if (trimmed.length === 0) {
        setError(new Error("退回或標示不可用時必須填寫原因。"));
        return;
      }
      reason = trimmed;
    } else {
      const input = window.prompt(
        "覆核理由（可留空；例如：答案與教材一致、選項互不重疊、解釋說明推理）",
        "",
      );
      if (input === null) return;
      const trimmed = input.trim();
      reason = trimmed.length > 0 ? trimmed : null;
    }
    try {
      const result = await api.post<{ created: boolean }>(
        `/api/teacher/questions/${questionId}/review`,
        reason === null
          ? { decision, expectedRevision }
          : { decision, reason, expectedRevision },
      );
      setMessage(
        decision === "approved"
          ? result.created
            ? "已記錄覆核通過並發布（此版本已由你確認）。"
            : "此版本先前已記錄相同的覆核決定，沒有重複新增紀錄。"
          : "已記錄覆核決定，題目不會顯示給學生，必須修改後重新覆核。",
      );
      await refreshQuestions();
    } catch (caught) {
      setError(caught);
    }
  }

  async function handleDelete(questionId: string) {
    setError(null);
    try {
      await api.delete(`/api/teacher/questions/${questionId}`);
      setMessage("已刪除題目。");
      await refreshQuestions();
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">題目管理</h1>
        <p className="text-sm text-gray-600">
          生成題目時只會把相關教材段落傳給 LLM，輸出會經過 schema 驗證、教材依據核對及自動品質驗證；
          沒有教材依據或答案不唯一的題目不會儲存。通過自動品質驗證的題目會即時供學生自學（毋須教師
          預先批准），教師可在這裡覆核、修正或重新驗證；未通過驗證的題目維持草稿。
        </p>
      </div>

      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <ErrorNotice error={error} onRetry={() => setQuestionsReloadToken((t) => t + 1)} /> : null}
      {focusError ? (
        <Notice tone="warning">
          未能自動開啟指定的題目（可能已被刪除或連結有誤）：{String(focusQuestionId)}。
          請在下方清單自行篩選該題。
        </Notice>
      ) : null}

      <section className="card flex flex-col gap-3" ref={generateSectionRef}>
        <h2 className="font-semibold">生成題目預覽</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            課題
            <select
              value={topicId}
              onChange={(event) => {
                setTopicId(event.target.value);
                setGenerateSections([]);
                setSectionId("");
              }}
            >
              {topics.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            題數
            <select
              value={generateCount}
              onChange={(event) => setGenerateCount(Number(event.target.value))}
            >
              {[3, 5, 10, 15].map((count) => (
                <option key={count} value={count}>
                  {count} 題
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="text-sm">
          分節（可多選）
          <div className="flex flex-wrap gap-2 mt-1">
            {sectionOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className="chip"
                data-selected={generateSections.includes(option.id)}
                onClick={() =>
                  setGenerateSections((current) =>
                    current.includes(option.id)
                      ? current.filter((item) => item !== option.id)
                      : [...current, option.id],
                  )
                }
              >
                {option.label.trim()}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="text-sm">
            題型
            <div className="flex flex-wrap gap-2 mt-1">
              {QUESTION_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  className="chip"
                  data-selected={generateTypes.includes(type)}
                  onClick={() =>
                    setGenerateTypes((current) =>
                      current.includes(type)
                        ? current.filter((item) => item !== type)
                        : [...current, type],
                    )
                  }
                >
                  {QUESTION_TYPE_LABELS[type]}
                </button>
              ))}
            </div>
          </div>
          <div className="text-sm">
            難度
            <div className="flex flex-wrap gap-2 mt-1">
              {DIFFICULTIES.map((difficulty) => (
                <button
                  key={difficulty}
                  type="button"
                  className="chip"
                  data-selected={generateDifficulty === difficulty}
                  onClick={() => setGenerateDifficulty(difficulty)}
                >
                  {DIFFICULTY_LABELS[difficulty]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {generateError ? <ErrorNotice error={generateError} /> : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleGenerate()}
            disabled={generating}
          >
            {generating ? "正在生成及驗證…" : "生成題目"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setEditorState({ mode: "new" })}
            disabled={!topic}
          >
            手動新增題目
          </button>
        </div>

        {generateResult ? (
          <div className="flex flex-col gap-3">
            <Notice tone={generateResult.usedDemoFallback || warningCount > 0 ? "warning" : "success"}>
              來源：{generateResult.providerLabel}
              {generateResult.discardedCount > 0
                ? `；已捨棄 ${generateResult.discardedCount} 題（不合規或沒有教材依據）`
                : "；全部題目均通過驗證"}
              {warningCount > 0
                ? `；${warningCount} 題有品質警告（教材未提及的人名或條約名），題目已保留（可能已供學生練習），請核對，如有問題可用回報面板下架`
                : ""}
              {generateResult.notice ? `。${generateResult.notice}` : ""}
            </Notice>
            {generateResult.discardReasons.length > 0 ? (
              <details className="text-sm">
                <summary className="cursor-pointer">查看被捨棄題目的原因</summary>
                <ul className="list-disc pl-5 mt-1 text-gray-600">
                  {generateResult.discardReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            <QuestionListCard
              questions={generateResult.questions}
              reviewStatus={reviewStatus}
              openReportCounts={openReportCounts}
              onStatus={handleStatus}
              onReview={handleReview}
              onDelete={handleDelete}
              onEdit={(question) => setEditorState({ mode: "edit", question })}
            />
          </div>
        ) : null}
      </section>

      <QuestionReportPanel
        reports={reports}
        topics={topics}
        statusFilter={reportStatusFilter}
        topicFilter={reportTopicFilter}
        busyReportId={busyReportId}
        onStatusFilterChange={setReportStatusFilter}
        onTopicFilterChange={setReportTopicFilter}
        onRefresh={() => void refreshReports()}
        onResolve={(reportId, status) => void handleResolveReport(reportId, status)}
        onAction={(reportId, action) => void handleReportAction(reportId, action)}
      />

      {editorState && topic ? (
        <QuestionEditor
          topic={topic}
          question={editorState.question}
          onCancel={() => setEditorState(null)}
          onSaved={async () => {
            setEditorState(null);
            setMessage("已儲存題目。");
            await refreshQuestions();
          }}
        />
      ) : null}

      <section className="card flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-semibold">題庫</h2>
          <div className="flex flex-wrap items-end gap-2 text-sm">
            <label>
              分節
              <select value={sectionId} onChange={(event) => setSectionId(event.target.value)}>
                <option value="">全部分節</option>
                {sectionOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label.trim()}
                  </option>
                ))}
              </select>
            </label>
            <label>
              狀態
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="">全部</option>
                <option value="published">已發布</option>
                <option value="draft">草稿</option>
                <option value="disabled">已停用</option>
              </select>
            </label>
            <label>
              來源
              <select
                value={originFilter}
                onChange={(event) => setOriginFilter(event.target.value)}
              >
                <option value="">全部</option>
                <option value="school-paper">校內試卷</option>
                <option value="material-ai">教材 + AI 生成</option>
                <option value="material-mock">教材 + 示範生成</option>
                <option value="demo">示範題庫</option>
                <option value="manual">教師手動建立</option>
              </select>
            </label>
          </div>
        </div>

        {!questions ? (
          <Loading label="正在載入題目…" />
        ) : questions.length === 0 ? (
          <p className="text-sm text-gray-600">沒有符合條件的題目。</p>
        ) : (
          <QuestionListCard
            questions={questions}
            reviewStatus={reviewStatus}
            openReportCounts={openReportCounts}
            onStatus={handleStatus}
            onReview={handleReview}
            onDelete={handleDelete}
            onEdit={(question) => setEditorState({ mode: "edit", question })}
          />
        )}
      </section>
    </div>
  );
}

function QuestionListCard({
  questions,
  reviewStatus,
  openReportCounts,
  onStatus,
  onReview,
  onDelete,
  onEdit,
}: {
  questions: Question[];
  /** 每題的人工覆核狀態（由 /api/teacher/questions 的 reviews 欄位提供） */
  reviewStatus: Map<string, QuestionReviewStatus>;
  /** 每題的未處理回報數（顯示「待覆核」） */
  openReportCounts?: Map<string, number>;
  onStatus: (questionId: string, status: QuestionStatus) => Promise<void>;
  /** 第二個參數是教師看到的版本（樂觀鎖），見 handleReview */
  onReview: (
    questionId: string,
    expectedRevision: number,
    decision: QuestionReviewDecision,
  ) => Promise<void>;
  onDelete: (questionId: string) => Promise<void>;
  onEdit: (question: Question) => void;
}) {
  return (
    <ul className="flex flex-col gap-3">
      {questions.map((question) => {
        const review = reviewStatus.get(question.id);
        const reviewState: QuestionReviewState = review?.reviewState ?? "pending-review";
        return (
        <li
          key={question.id}
          className="rounded-xl border p-3 text-sm flex flex-col gap-2"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge">{QUESTION_TYPE_LABELS[question.questionType]}</span>
            <span className="badge">{DIFFICULTY_LABELS[question.difficulty]}</span>
            <span className="badge badge-accent">{QUESTION_ORIGIN_LABELS[question.origin]}</span>
            <span
              className={`badge ${
                question.status === "published"
                  ? "badge-success"
                  : question.status === "draft"
                    ? "badge-warning"
                    : "badge-danger"
              }`}
            >
              {QUESTION_STATUS_LABELS[question.status]}
            </span>
            {/* 人工覆核狀態：與「教材依據自動核對」分開顯示，不可混為一談 */}
            <span
              className={`badge ${
                reviewState === "approved"
                  ? "badge-success"
                  : reviewState === "published-unreviewed" || reviewState === "stale-approval"
                    ? "badge-danger"
                    : "badge-warning"
              }`}
              title={
                review?.approvedReview
                  ? (review.approvedReview.reviewerRole === "automation"
                      ? `由自動修復程式記錄（非教師覆核）：${review.approvedReview.reviewerEmail}，第 ${review.approvedReview.revision} 版`
                      : `由 ${review.approvedReview.reviewerEmail} 於 ${review.approvedReview.createdAt.slice(0, 10)} 覆核第 ${review.approvedReview.revision} 版`) +
                    (review.approvedReview.reason ? `；理由：${review.approvedReview.reason}` : "")
                  : "尚未有教師覆核紀錄"
              }
            >
              {QUESTION_REVIEW_STATE_LABELS[reviewState]}
              {review?.approvedReview?.reviewerRole === "automation" ? "（自動記錄）" : ""}
            </span>
            <span className="badge" title="目前題目版本；修改後版本會遞增，舊覆核即失效">
              第 {question.revision} 版
            </span>
            <span className="badge" title="題目建立時間">
              建立：{question.createdAt.slice(0, 10)}
            </span>
            {/* 未確定項目：自動發布已暫緩，學生看不到；教師必須知道這題在等自己核對 */}
            {question.teacherConfirmationRequired ? (
              <span
                className="badge badge-danger"
                title="品質檢查有未確定項目（例如題目要求的思考面向未見於教材），自動發布已暫緩，學生看不到這一題。核對內容後按「覆核通過並發布」，或先重新執行自動品質驗證。"
              >
                等待教師確認（自動發布暫緩）
              </span>
            ) : null}
            {/* 學生是否看得到教材節錄：由版權／教材閘門決定，教師必須知道實際情況 */}
            {review?.sourceExcerptHiddenFromStudents ? (
              <span
                className="badge badge-warning"
                title={`學生看不到本題的教材節錄：${
                  review.sourceExcerptHiddenReason
                    ? STUDENT_EXCERPT_HIDDEN_REASON_LABELS[review.sourceExcerptHiddenReason]
                    : "教材未確認"
                }`}
              >
                學生看不到節錄
              </span>
            ) : null}
            {/* 結構上無法作答：即使已發布，學生練習也不會收到（見 question-servability.ts） */}
            {question.status === "published" && review && !review.studentServable ? (
              <span
                className="badge badge-danger"
                title={`學生練習不會收到這一題：${
                  review.studentServableReason ?? "題目結構上無法作答"
                }`}
              >
                學生無法作答（不會派發）
              </span>
            ) : null}
            {question.origin === "school-paper" ? (
              <span className="badge">來源：校內試卷</span>
            ) : (
              <span
                className={question.sourceVerified ? "badge badge-success" : "badge badge-danger"}
              >
                {question.sourceVerified ? "已核對教材依據" : "未通過教材依據核對"}
              </span>
            )}
            {question.qualityWarnings.length > 0 ? (
              <span className="badge badge-warning">品質警告 {question.qualityWarnings.length} 項</span>
            ) : null}
            {(openReportCounts?.get(question.id) ?? 0) > 0 ? (
              <span className="badge badge-danger">
                待覆核回報 {openReportCounts?.get(question.id)} 筆
              </span>
            ) : null}
          </div>

          {question.qualityWarnings.length > 0 ? (
            <div
              className="rounded-lg px-3 py-2"
              style={{ background: "var(--warning-soft)", border: "1px solid #f2ddb0" }}
            >
              <p className="font-semibold" style={{ color: "var(--warning)" }}>
                品質警告（題目已保留，請核對教材後才發布）
              </p>
              <ul className="list-disc pl-5 mt-1">
                {question.qualityWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="font-medium whitespace-pre-wrap">{question.question}</p>

          {question.options.length > 0 ? (
            <ul className="list-disc pl-5 text-gray-700">
              {question.options.map((option) => (
                <li key={option}>
                  {option}
                  {option === question.correctAnswer ? (
                    <span className="badge badge-success ml-2">正確答案</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              <span className="font-semibold">答案：</span>
              {question.correctAnswer}
            </p>
          )}

          <p>
            <span className="font-semibold">解釋：</span>
            {question.explanation}
          </p>
          <p>
            <span className="font-semibold">知識點：</span>
            {question.knowledgePoint}
          </p>

          <div className="source-box">
            <div className="text-xs text-gray-600 mb-1">
              教材依據：{question.sourceLocation}
              {question.sourceBlockIds.length > 0
                ? `（段落 ${question.sourceBlockIds.join("、")}）`
                : "（未連結教材段落）"}
            </div>
            <div className="whitespace-pre-wrap">{question.sourceExcerpt}</div>
          </div>

          <div className="flex flex-wrap gap-2">
            {/*
              發布關卡：未經人工覆核（或覆核後已修改）的題目不可發布，
              因此這裡提供「覆核通過」而不是單純的「發布」按鈕。
            */}
            {reviewState === "approved" ? (
              <button
                type="button"
                className="btn"
                onClick={() => void onStatus(question.id, "draft")}
              >
                轉為草稿（保留覆核紀錄）
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void onReview(question.id, question.revision, "approved")}
              >
                覆核通過並發布
              </button>
            )}
            {reviewState !== "approved" && reviewState !== "approved-unpublished" ? (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void onReview(question.id, question.revision, "returned")}
                >
                  退回修改
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void onReview(question.id, question.revision, "rejected")}
                >
                  標示不可用
                </button>
              </>
            ) : null}
            {question.status !== "disabled" ? (
              <button
                type="button"
                className="btn"
                onClick={() => void onStatus(question.id, "disabled")}
              >
                停用
              </button>
            ) : null}
            <button type="button" className="btn" onClick={() => onEdit(question)}>
              編輯
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void onDelete(question.id)}
            >
              刪除
            </button>
          </div>
        </li>
        );
      })}
    </ul>
  );
}

function QuestionEditor({
  topic,
  question,
  onCancel,
  onSaved,
}: {
  topic: TopicOverview;
  question?: Question;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const sections = useMemo(
    () =>
      topic.sections.flatMap((section) => [
        { id: section.id, label: section.title },
        ...section.children.map((child) => ({ id: child.id, label: `　${child.title}` })),
      ]),
    [topic],
  );

  const [form, setForm] = useState({
    sectionId: question?.sectionId ?? sections[0]?.id ?? "",
    questionType: question?.questionType ?? ("mc" as QuestionType),
    difficulty: question?.difficulty ?? ("basic" as Difficulty),
    question: question?.question ?? "",
    optionsText: (question?.options ?? ["", "", "", ""]).join("\n"),
    correctAnswer: question?.correctAnswer ?? "",
    explanation: question?.explanation ?? "",
    knowledgePoint: question?.knowledgePoint ?? "",
    sourceExcerpt: question?.sourceExcerpt ?? "",
    sourceLocation: question?.sourceLocation ?? "",
    status: question?.status ?? ("draft" as QuestionStatus),
  });
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<unknown>(null);

  async function handleSave() {
    setSaving(true);
    setEditorError(null);
    try {
      const payload = {
        topicId: topic.id,
        sectionId: form.sectionId,
        questionType: form.questionType,
        difficulty: form.difficulty,
        question: form.question,
        options:
          form.questionType === "mc"
            ? form.optionsText
                .split("\n")
                .map((option) => option.trim())
                .filter((option) => option.length > 0)
            : [],
        correctAnswer: form.correctAnswer,
        acceptedAnswers: question?.acceptedAnswers ?? [],
        explanation: form.explanation,
        knowledgePoint: form.knowledgePoint,
        sourceExcerpt: form.sourceExcerpt || "（教師手動建立，未提供教材節錄）",
        sourceLocation: form.sourceLocation || "教師手動建立",
        sourceBlockIds: question?.sourceBlockIds ?? [],
        origin: question?.origin ?? "manual",
        status: form.status,
      };

      if (question) {
        await api.patch(`/api/teacher/questions/${question.id}`, {
          action: "edit",
          question: payload,
        });
      } else {
        await api.post("/api/teacher/questions", payload);
      }
      await onSaved();
    } catch (caught) {
      setEditorError(caught);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card flex flex-col gap-3">
      <h2 className="font-semibold">{question ? "編輯題目" : "新增題目"}</h2>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">
          分節
          <select
            value={form.sectionId}
            onChange={(event) => setForm({ ...form, sectionId: event.target.value })}
          >
            {sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.label.trim()}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          題型
          <select
            value={form.questionType}
            onChange={(event) =>
              setForm({ ...form, questionType: event.target.value as QuestionType })
            }
          >
            {QUESTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {QUESTION_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          難度
          <select
            value={form.difficulty}
            onChange={(event) =>
              setForm({ ...form, difficulty: event.target.value as Difficulty })
            }
          >
            {DIFFICULTIES.map((difficulty) => (
              <option key={difficulty} value={difficulty}>
                {DIFFICULTY_LABELS[difficulty]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="text-sm">
        題目
        <textarea
          rows={2}
          value={form.question}
          onChange={(event) => setForm({ ...form, question: event.target.value })}
        />
      </label>

      {form.questionType === "mc" ? (
        <label className="text-sm">
          選項（每行一個，其中一行必須與標準答案完全相同）
          <textarea
            rows={4}
            value={form.optionsText}
            onChange={(event) => setForm({ ...form, optionsText: event.target.value })}
          />
        </label>
      ) : null}

      <label className="text-sm">
        標準答案
        <input
          type="text"
          value={form.correctAnswer}
          onChange={(event) => setForm({ ...form, correctAnswer: event.target.value })}
        />
      </label>

      <label className="text-sm">
        解釋
        <textarea
          rows={2}
          value={form.explanation}
          onChange={(event) => setForm({ ...form, explanation: event.target.value })}
        />
      </label>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">
          知識點
          <input
            type="text"
            value={form.knowledgePoint}
            onChange={(event) => setForm({ ...form, knowledgePoint: event.target.value })}
          />
        </label>
        <label className="text-sm">
          教材來源位置
          <input
            type="text"
            value={form.sourceLocation}
            placeholder="例如：HNC2A2E_T5_SN_TE.docx · 第 12 段（清單）"
            onChange={(event) => setForm({ ...form, sourceLocation: event.target.value })}
          />
        </label>
      </div>

      <label className="text-sm">
        教材原文節錄（用於核對題目依據）
        <textarea
          rows={2}
          value={form.sourceExcerpt}
          onChange={(event) => setForm({ ...form, sourceExcerpt: event.target.value })}
        />
      </label>

      <label className="text-sm max-w-xs">
        狀態
        <select
          value={form.status}
          onChange={(event) => setForm({ ...form, status: event.target.value as QuestionStatus })}
        >
          <option value="draft">草稿</option>
          <option value="published">已發布</option>
          <option value="disabled">已停用</option>
        </select>
      </label>

      {editorError ? <ErrorNotice error={editorError} /> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? "儲存中…" : "儲存"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          取消
        </button>
      </div>
    </section>
  );
}


