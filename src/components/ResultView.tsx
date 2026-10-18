"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api, getLearnerId } from "@/lib/api-client";
import {
  AI_VERDICT_LABELS,
  type AssembledPractice,
  type AuthStatus,
  type PracticeResult,
} from "@/lib/types";
import { ErrorNotice, Loading, Notice, StatBox } from "@/components/ui";

export function ResultView({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [result, setResult] = useState<PracticeResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<unknown>(null);
  /** 教師／管理員以學生端測試時，提供返回後台首頁的入口 */
  const [staffHome, setStaffHome] = useState<{ href: string; label: string } | null>(null);

  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .get<AuthStatus>("/api/auth/session")
      .then((status) => {
        if (cancelled) return;
        const role = status.user?.role ?? null;
        if (role === "admin") setStaffHome({ href: "/admin", label: "返回管理員端" });
        else if (role === "teacher") setStaffHome({ href: "/teacher", label: "返回教師端" });
        else setStaffHome(null);
      })
      .catch(() => {
        // 未啟用登入時不會有登入狀態，維持只顯示學生端入口
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const learnerId = getLearnerId();
    api
      .get<PracticeResult>(`/api/practice/${sessionId}/result?learnerId=${learnerId}`)
      .then((data) => {
        if (cancelled) return;
        setResult(data);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, reloadToken]);

  async function handleRetryWrong() {
    if (!result) return;
    setRetrying(true);
    setRetryError(null);
    try {
      const wrongCount = result.feedback.filter((item) => item.isCorrect === false).length;
      const practice = await api.post<AssembledPractice>("/api/practice", {
        learnerId: getLearnerId(),
        topicId: result.session.topicId,
        sectionIds: result.session.sectionIds,
        questionTypes: result.session.questionTypes,
        difficulty: result.session.difficulty,
        questionCount: Math.max(1, Math.min(wrongCount, 30)),
        mode: "wrong-only",
        sourceSessionId: result.session.id,
      });
      router.push(`/practice/${practice.session.id}`);
    } catch (caught) {
      setRetryError(caught);
      setRetrying(false);
    }
  }

  if (error) return <ErrorNotice error={error} onRetry={() => setReloadToken((t) => t + 1)} />;
  if (!result) return <Loading label="正在載入成績…" />;

  const needsReview = result.feedback.filter((item) => item.isCorrect === false);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">練習結果</h1>
        <p className="text-sm text-gray-600">
          共 {result.totalQuestions} 題，已作答 {result.answeredCount} 題。
        </p>
      </div>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="完成題數" value={`${result.answeredCount} / ${result.totalQuestions}`} />
        <StatBox label="可自動評分題目" value={`${result.gradedCount}`} />
        <StatBox label="答對題數" value={`${result.correctCount}`} />
        <StatBox
          label="正確率（只計選擇及填充題）"
          value={result.accuracy === null ? "—" : `${Math.round(result.accuracy * 100)}%`}
        />
      </section>

      {result.accuracy === null ? (
        <Notice>這次練習沒有可自動評分的題目。</Notice>
      ) : null}

      <section className="card flex flex-col gap-2">
        <h2 className="font-semibold">需要重溫的知識點</h2>
        {result.knowledgePointsToReview.length === 0 ? (
          result.answeredCount < result.totalQuestions ? (
            <p className="text-sm text-gray-600">
              仍有 {result.totalQuestions - result.answeredCount} 題未作答，完成所有題目後才可更準確了解需要重溫的內容。
            </p>
          ) : (
            <p className="text-sm text-gray-600">沒有需要特別重溫的知識點。</p>
          )
        ) : (
          <ul className="list-disc pl-5 text-sm">
            {result.knowledgePointsToReview.map((item) => (
              <li key={item.knowledgePoint}>
                <span className="font-medium">{item.knowledgePoint}</span>
                <span className="text-gray-500">
                  （{item.sectionTitle}，{item.questionIds.length} 題）
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void handleRetryWrong()}
          disabled={retrying || needsReview.length === 0}
        >
          {retrying ? "正在準備…" : `針對錯題再練習（${needsReview.length} 題）`}
        </button>
        <Link href="/" className="btn">
          返回課題首頁
        </Link>
        <Link href={`/practice/new?topic=${result.session.topicId}`} className="btn">
          再練習一次
        </Link>
        <Link href={`/learn/${result.session.topicId}`} className="btn">
          閱讀這個課題的教材
        </Link>
        {staffHome ? (
          <Link href={staffHome.href} className="btn">
            {staffHome.label}
          </Link>
        ) : null}
      </div>
      {retryError ? <ErrorNotice error={retryError} /> : null}

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">逐題回顧</h2>
        {result.feedback.map((feedback, index) => {
          const attempted = feedback.answer.trim().length > 0;
          const aiVerdict = feedback.aiGrading?.verdict ?? null;
          const verdict = !attempted
            ? { text: "未作答", className: "badge badge-warning" }
            : feedback.isCorrect
              ? {
                  text: aiVerdict === "correct" ? "答對（AI 語意批改）" : "答對",
                  className: "badge badge-success",
                }
              : { text: "答錯", className: "badge badge-danger" };

          return (
            <article key={feedback.questionId} className="card flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">第 {index + 1} 題</span>
                <span className={verdict.className}>{verdict.text}</span>
              </div>
              <p className="text-sm text-gray-600">
                你的答案：{feedback.answer || "（未有作答）"}
              </p>
              {feedback.aiGrading ? (
                <div
                  className="rounded-xl p-3 text-sm flex flex-col gap-1"
                  style={{ background: "var(--accent-soft)", border: "1px solid #c6d6ff" }}
                >
                  <p className="font-semibold">
                    AI 語意批改：{AI_VERDICT_LABELS[feedback.aiGrading.verdict]}
                    <span className="font-normal text-gray-600">（非正式 HKDSE 評分）</span>
                  </p>
                  {feedback.aiGrading.feedback ? <p>{feedback.aiGrading.feedback}</p> : null}
                  {feedback.aiGrading.missingPoints.length > 0 ? (
                    <p className="text-xs" style={{ color: "var(--warning)" }}>
                      未達到的要點：{feedback.aiGrading.missingPoints.join("；")}
                    </p>
                  ) : null}
                  {feedback.aiGrading.note ? (
                    <p className="text-xs" style={{ color: "var(--warning)" }}>
                      {feedback.aiGrading.note}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <p className="text-sm">
                <span className="font-semibold">參考答案：</span>
                {feedback.correctAnswer}
              </p>
              <p className="text-sm">
                <span className="font-semibold">解釋：</span>
                {feedback.explanation}
              </p>
              <p className="text-sm">
                <span className="font-semibold">知識點：</span>
                {feedback.knowledgePoint}
              </p>
              {feedback.gradingPoints.length > 0 ? (
                <div className="text-sm">
                  <span className="font-semibold">得分要點：</span>
                  <ul className="list-disc pl-5">
                    {feedback.gradingPoints.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="source-box">
                <div className="text-xs text-gray-600 mb-1">
                  教材來源：
                  {feedback.sourceWithheld ? "未確認可向學生發布" : feedback.sourceLocation}
                </div>
                {feedback.sourceFromOcr ? (
                  <div className="text-xs mb-1" style={{ color: "var(--warning)" }}>
                    此題依據的教材文字由圖片 OCR 辨識取得，可能有錯字。
                  </div>
                ) : null}
                {feedback.sourceWithheld ? (
                  <div className="text-xs mb-1" style={{ color: "var(--warning)" }}>
                    此題引用的教材文件尚未經教師確認可向學生發布，因此不顯示原文節錄。
                  </div>
                ) : null}
                <div className="whitespace-pre-wrap">{feedback.sourceExcerpt ?? ""}</div>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}

