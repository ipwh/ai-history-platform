"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { api, getLearnerId } from "@/lib/api-client";
import {
  AI_VERDICT_LABELS,
  DIFFICULTY_LABELS,
  QUESTION_REPORT_REASONS,
  QUESTION_REPORT_REASON_LABELS,
  QUESTION_TYPE_LABELS,
  QUESTION_ORIGIN_LABELS,
  type Health,
  type PracticeSession,
  type QuestionFeedback,
  type QuestionReportReason,
  type StudentQuestion,
} from "@/lib/types";
import { ErrorNotice, Loading, Notice, ProgressBar } from "@/components/ui";

interface PracticeViewData {
  session: PracticeSession;
  questions: StudentQuestion[];
  notice: string | null;
  feedback: QuestionFeedback[];
}

export function PracticeRunner({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [data, setData] = useState<PracticeViewData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, QuestionFeedback>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [completing, setCompleting] = useState(false);
  const [aiGradingAvailable, setAiGradingAvailable] = useState(false);

  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Health>("/api/health")
      .then((health) => {
        if (!cancelled) setAiGradingAvailable(health.aiGrading === true);
      })
      .catch(() => {
        if (!cancelled) setAiGradingAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const learnerId = getLearnerId();
    api
      .get<PracticeViewData>(`/api/practice/${sessionId}?learnerId=${learnerId}`)
      .then((view) => {
        if (cancelled) return;
        setData(view);
        setFeedback(Object.fromEntries(view.feedback.map((item) => [item.questionId, item])));
        setDrafts(Object.fromEntries(view.feedback.map((item) => [item.questionId, item.answer])));
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, reloadToken]);

  const questions = data?.questions ?? [];
  const current = questions[currentIndex];
  const currentFeedback = current ? feedback[current.id] : undefined;
  const answeredCount = Object.keys(feedback).length;

  const progress = useMemo(
    () => (questions.length === 0 ? 0 : answeredCount / questions.length),
    [answeredCount, questions.length],
  );

  async function handleSubmit() {
    if (!current) return;
    // 兩次點擊可能在 React 重新渲染之前都觸發（按鈕的 disabled 尚未生效），
    // 而伺服器端每次提交都會呼叫一次 AI 批改，因此必須在此擋掉重複提交。
    if (submitting) return;
    const answer = (drafts[current.id] ?? "").trim();
    if (answer.length === 0) {
      setSubmitError(new Error("請先作答再提交。"));
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await api.post<{ feedback: QuestionFeedback }>(
        `/api/practice/${sessionId}/answers`,
        { learnerId: getLearnerId(), questionId: current.id, answer },
      );
      setFeedback((prev) => ({ ...prev, [current.id]: result.feedback }));
    } catch (caught) {
      setSubmitError(caught);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleComplete() {
    setCompleting(true);
    try {
      await api.post(`/api/practice/${sessionId}/complete`, { learnerId: getLearnerId() });
      router.push(`/practice/${sessionId}/result`);
    } catch (caught) {
      setSubmitError(caught);
      setCompleting(false);
    }
  }

  if (error) return <ErrorNotice error={error} onRetry={() => setReloadToken((t) => t + 1)} />;
  if (!data || !current) return <Loading label="正在載入題目…" />;

  const isLast = currentIndex === questions.length - 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-gray-600">
          第 {currentIndex + 1} / {questions.length} 題 ・ 已作答 {answeredCount} 題
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="badge">{QUESTION_TYPE_LABELS[current.questionType]}</span>
          <span className="badge">{DIFFICULTY_LABELS[current.difficulty]}</span>
          <span className="badge badge-accent">{QUESTION_ORIGIN_LABELS[current.origin]}</span>
        </div>
      </div>

      <ProgressBar value={progress} />

      {data.notice ? <Notice>{data.notice}</Notice> : null}

      <article className="card flex flex-col gap-3">
        <h1 className="text-lg font-semibold leading-relaxed">{current.question}</h1>

        {current.questionType === "mc" ? (
          <div className="flex flex-col gap-2">
            {current.options.map((option, index) => {
              const selected = (drafts[current.id] ?? "") === option;
              let state: string | undefined;
              if (currentFeedback) {
                if (option === currentFeedback.correctAnswer) state = "correct";
                else if (option === currentFeedback.answer) state = "wrong";
              }
              return (
                <button
                  key={`${index}-${option}`}
                  type="button"
                  className="option-row"
                  data-selected={selected}
                  data-state={state}
                  disabled={currentFeedback !== undefined}
                  onClick={() =>
                    setDrafts((prev) => ({ ...prev, [current.id]: option }))
                  }
                >
                  <span className="font-semibold" style={{ color: "var(--accent)" }}>
                    {String.fromCharCode(65 + index)}
                  </span>
                  <span>{option}</span>
                </button>
              );
            })}
          </div>
        ) : current.questionType === "fill" ? (
          <input
            type="text"
            value={drafts[current.id] ?? ""}
            placeholder="請輸入答案"
            disabled={currentFeedback !== undefined}
            onChange={(event) =>
              setDrafts((prev) => ({ ...prev, [current.id]: event.target.value }))
            }
          />
        ) : (
          <textarea
            rows={6}
            value={drafts[current.id] ?? ""}
            placeholder="請以自己的文字作答；提交後 AI 會按得分要點批改，你亦可自行覆核。"
            disabled={currentFeedback !== undefined}
            onChange={(event) =>
              setDrafts((prev) => ({ ...prev, [current.id]: event.target.value }))
            }
          />
        )}

        {submitError ? <ErrorNotice error={submitError} /> : null}

        {currentFeedback ? (
          <FeedbackPanel feedback={currentFeedback} sessionId={sessionId} />
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleSubmit()}
              disabled={submitting}
            >
              {submitting
                ? aiGradingAvailable && current.questionType !== "mc"
                  ? "AI 批改中…"
                  : "提交中…"
                : "提交答案"}
            </button>
            <span className="text-xs text-gray-500 self-center">
              {current.questionType === "mc"
                ? "提交前不會顯示答案，請先自行作答。"
                : aiGradingAvailable
                  ? "提交後會由 AI 按語意批改，用字不同不會直接判錯。"
                  : "提交前不會顯示答案，請先自行作答。"}
            </span>
          </div>
        )}
      </article>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn"
          onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
          disabled={currentIndex === 0}
        >
          上一題
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => setCurrentIndex((index) => Math.min(questions.length - 1, index + 1))}
          disabled={isLast}
        >
          下一題
        </button>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/" className="btn">
            離開
          </Link>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleComplete()}
            disabled={completing}
          >
            {completing ? "正在計算成績…" : "完成練習並查看結果"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FeedbackPanel({
  feedback,
  sessionId,
}: {
  feedback: QuestionFeedback;
  sessionId: string;
}) {
  const aiVerdict = feedback.aiGrading?.verdict ?? null;
  const verdict = feedback.isCorrect
    ? {
        text: aiVerdict === "correct" ? "答對了（AI 語意批改）" : "答對了",
        className: "badge badge-success",
      }
    : { text: "答錯了", className: "badge badge-danger" };

  return (
    <section className="flex flex-col gap-3 rounded-xl p-3" style={{ background: "#fafbff" }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={verdict.className}>{verdict.text}</span>
        <span className="text-sm text-gray-600">你的答案：{feedback.answer || "（未有作答）"}</span>
      </div>

      {feedback.aiGrading ? (
        <div
          className="rounded-xl p-3 text-sm flex flex-col gap-1"
          style={{ background: "var(--accent-soft)", border: "1px solid #c6d6ff" }}
        >
          <p className="font-semibold">
            AI 語意批改：{AI_VERDICT_LABELS[feedback.aiGrading.verdict]}
            <span className="font-normal text-gray-600">
              （以意思判斷，用字不同不會直接判錯；這不是正式 HKDSE 評分）
            </span>
          </p>
          {feedback.aiGrading.feedback ? <p>{feedback.aiGrading.feedback}</p> : null}
          {feedback.aiGrading.hitPoints.length > 0 ? (
            <div>
              <p className="font-medium text-gray-700">已達到的要點：</p>
              <ul className="list-disc pl-5">
                {feedback.aiGrading.hitPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {feedback.aiGrading.missingPoints.length > 0 ? (
            <div>
              <p className="font-medium text-gray-700">未達到的要點：</p>
              <ul className="list-disc pl-5">
                {feedback.aiGrading.missingPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {feedback.aiGrading.note ? (
            <p className="text-xs" style={{ color: "var(--warning)" }}>
              {feedback.aiGrading.note}
            </p>
          ) : null}
          {feedback.aiLimitReached ? (
            <p className="text-xs" style={{ color: "var(--warning)" }}>
              這次未使用 AI 語意批改（已達到 AI 使用上限），只以字詞比對及參考答案判斷。
              分數不會因為這個原因而改變，稍後再試即可再次使用 AI 批改。
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="text-sm">
        <span className="font-semibold">參考答案：</span>
        <span>{feedback.correctAnswer}</span>
        {feedback.acceptedAnswers.length > 0 ? (
          <span className="text-gray-500">
            （也可接受：{feedback.acceptedAnswers.join("、")}）
          </span>
        ) : null}
      </div>

      <div className="text-sm">
        <span className="font-semibold">解釋：</span>
        <span>{feedback.explanation}</span>
      </div>

      <div className="text-sm">
        <span className="font-semibold">知識點：</span>
        <span>{feedback.knowledgePoint}</span>
      </div>

      {feedback.reviewFlag === "uncertain-answer" ? (
        <div
          className="text-xs rounded-xl px-3 py-2"
          style={{ background: "var(--warning-soft)", border: "1px solid #f2ddb0" }}
        >
          你的答案與標準答案極為接近（可能是錯別字或另一個可接受的寫法），系統無法確定是否應該算對，
          因此這次仍然以「未達到」記錄，並已標示交由教師覆核。請對照下方標準答案再確認一次。
        </div>
      ) : null}

      {feedback.gradingPoints.length > 0 ? (
        <div className="text-sm">
          <p className="font-semibold">
            {feedback.aiGrading
              ? "得分要點（供你覆核 AI 的判斷，非正式評分）："
              : "得分要點（自我檢查用，非正式評分）："}
          </p>
          <ul className="list-disc pl-5">
            {feedback.gradingPoints.map((point) => (
              <li
                key={point}
                style={
                  feedback.aiGrading?.missingPoints.includes(point)
                    ? { color: "var(--warning)" }
                    : feedback.aiGrading?.hitPoints.includes(point)
                      ? { color: "var(--success)" }
                      : undefined
                }
              >
                {point}
                {feedback.aiGrading?.missingPoints.includes(point) ? "（AI 認為未達到）" : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="source-box">
        <div className="text-xs text-gray-600 mb-1">
          教材來源：
          {feedback.sourceWithheld
            ? "未確認可向學生發布"
            : feedback.sourceLocation}
          {feedback.sourceBlockIds.length > 0 || feedback.sourceWithheld
            ? ""
            : "（示範題庫，未與已上載教材核對）"}
        </div>
        {feedback.sourceFromOcr ? (
          <div className="text-xs mb-1" style={{ color: "var(--warning)" }}>
            此題依據的教材文字由圖片 OCR 辨識取得，可能有錯字，教師會定期核對。
          </div>
        ) : null}
        {feedback.sourceWithheld ? (
          <div className="text-xs mb-1" style={{ color: "var(--warning)" }}>
            此題引用的教材文件尚未經教師確認可向學生發布，因此不顯示原文節錄；答案與解釋不受影響。
          </div>
        ) : null}
        <div className="text-sm whitespace-pre-wrap">{feedback.sourceExcerpt ?? ""}</div>
      </div>

      <QuestionReportForm questionId={feedback.questionId} sessionId={sessionId} />
    </section>
  );
}

/**
 * 回報此題：學生可指出題目不清楚、答案有爭議等問題。
 * 回報只會令題目在教師端標示「待覆核」，不會自動刪除或停用題目。
 */
function QuestionReportForm({
  questionId,
  sessionId,
}: {
  questionId: string;
  sessionId: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<QuestionReportReason>("unclear");
  const [detail, setDetail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "already">("idle");
  const [error, setError] = useState<unknown>(null);

  async function handleSubmit() {
    setState("sending");
    setError(null);
    try {
      const result = await api.post<{ alreadyReported: boolean }>("/api/reports", {
        // 已登入時伺服器會忽略此值，一律使用工作階段身分
        learnerId: getLearnerId(),
        questionId,
        sessionId,
        reason,
        detail: detail.trim(),
      });
      setState(result.alreadyReported ? "already" : "done");
    } catch (caught) {
      setError(caught);
      setState("idle");
    }
  }

  if (state === "done" || state === "already") {
    return (
      <Notice tone="success">
        {state === "already"
          ? "你已回報過這條題目，教師會盡快核對。"
          : "已回報。教師會在題目管理看到這筆回報並核對；回報不會自動刪除或停用題目。"}
      </Notice>
    );
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      {error ? <ErrorNotice error={error} /> : null}
      {!open ? (
        <div>
          <button type="button" className="btn" onClick={() => setOpen(true)}>
            回報此題
          </button>
          <span className="text-xs text-gray-500 ml-2">
            題目或答案有問題？告訴教師，我們會核對教材後處理。
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
          <label>
            問題類別
            <select
              value={reason}
              onChange={(event) => setReason(event.target.value as QuestionReportReason)}
            >
              {QUESTION_REPORT_REASONS.map((item) => (
                <option key={item} value={item}>
                  {QUESTION_REPORT_REASON_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
          <label>
            補充說明（可選，最多 500 字）
            <textarea
              rows={3}
              maxLength={500}
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              placeholder="例如：答案應為……，因為教材提到……"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleSubmit()}
              disabled={state === "sending"}
            >
              {state === "sending" ? "正在送出…" : "送出回報"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setOpen(false)}
              disabled={state === "sending"}
            >
              取消
            </button>
            <span className="text-xs text-gray-500 self-center">
              回報會記錄你的學習者身分，但教師端只會顯示「學生回報」，不會顯示你的姓名或電郵。
            </span>
          </div>
        </div>
      )}
    </div>
  );
}


