"use client";

import type { PracticeRecordQuestion, PracticeRecordSession } from "@/lib/types";

/** 練習時間顯示（香港時區、24 小時制） */
export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-HK", { hour12: false });
}

function outcomeBadge(record: PracticeRecordQuestion) {
  if (!record.answered) return { label: "未作答", className: "badge" };
  if (record.isCorrect === true) return { label: "答對", className: "badge badge-success" };
  if (record.isCorrect === false) return { label: "答錯", className: "badge badge-danger" };
  return {
    label: record.selfAssessment === "needs-review" ? "需重溫" : "待自我檢查",
    className: "badge badge-warning",
  };
}

export type RecordExportFormat = "xlsx" | "docx" | "pdf" | "csv";

const RECORD_EXPORT_OPTIONS: { format: RecordExportFormat; label: string }[] = [
  { format: "xlsx", label: "Excel（XLSX）" },
  { format: "docx", label: "Word（DOCX）" },
  { format: "pdf", label: "PDF" },
  { format: "csv", label: "CSV" },
];

/** 選擇題選項的 A／B／C／D 標記（與學生作答時看到的次序一致） */
function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** 需要逐題回顧的題目：答錯或未作答 */
export function needsReview(question: PracticeRecordQuestion): boolean {
  return !question.answered || question.isCorrect === false;
}

export interface PracticeRecordCardProps {
  record: PracticeRecordSession;
  expanded: boolean;
  onToggle: () => void;
  /** 只看答錯／未作答的題目 */
  wrongOnly: boolean;
  /**
   * 標題顯示的學習者名稱（教師端需要逐次核對是哪位學生）；
   * 學生端只看自己的記錄，毋須顯示。
   */
  learnerLabel?: string | null;
  /** 課題標題（由呼叫方提供，兩端使用的課題標示一致） */
  topicLabel?: string | null;
  /** 答案欄的標示：教師端「學生答案」，學生端「你的答案」 */
  answerLabel?: string;
  /** 選項標記：教師端「學生選擇」，學生端「你的選擇」 */
  choiceLabel?: string;
  /** 教師端逐次匯出：提供時會在卡片顯示「匯出此次練習」的下載選項 */
  exportHref?: (format: RecordExportFormat) => string;
}

/**
 * 一次練習記錄（統計標籤＋可展開的逐題回顧）。
 *
 * 教師端與學生端共用同一份呈現，避免兩邊對「答對／答錯／未作答」的用語或
 * 選項標記出現分歧。未按「完成練習並查看結果」便離開的練習會標示「未完成」，
 * 因為這類記錄仍會列出已提交的答案，但不會計入完成練習次數。
 */
export function PracticeRecordCard({
  record,
  expanded,
  onToggle,
  wrongOnly,
  learnerLabel,
  topicLabel,
  answerLabel = "學生答案",
  choiceLabel = "學生選擇",
  exportHref,
}: PracticeRecordCardProps) {
  const visible = record.questions
    .map((question, index) => ({ question, index }))
    .filter((item) => !wrongOnly || needsReview(item.question));

  return (
    <article
      className="rounded-xl border p-3 flex flex-col gap-2"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {learnerLabel ? <span className="badge badge-accent">{learnerLabel}</span> : null}
        {record.learnerClassName || record.learnerStudentNumber ? (
          <span className="text-xs text-gray-500">
            {[record.learnerClassName, record.learnerStudentNumber ? `學號 ${record.learnerStudentNumber}` : ""]
              .filter(Boolean)
              .join(" ・ ")}
          </span>
        ) : null}
        <span className="font-semibold">{formatDateTime(record.createdAt)}</span>
        <span>{topicLabel ?? record.topicTitle}</span>
        {record.completedAt === null ? (
          <span
            className="badge badge-warning"
            title="這次練習尚未按「完成練習並查看結果」；已提交的答案仍會保留，未作答題目不會計分。"
          >
            未完成
          </span>
        ) : null}
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
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {exportHref ? (
            <details className="flex flex-col items-end gap-2">
              <summary className="btn cursor-pointer">匯出此次練習</summary>
              <div className="flex flex-wrap justify-end gap-2">
                {RECORD_EXPORT_OPTIONS.map((option) => (
                  <a
                    key={option.format}
                    className="btn"
                    href={exportHref(option.format)}
                    download
                  >
                    {option.label}
                  </a>
                ))}
              </div>
            </details>
          ) : null}
          <button type="button" className="btn" onClick={onToggle}>
            {expanded ? "收起題目" : `查看題目（${record.totalQuestions}）`}
          </button>
        </div>
      </div>

      {expanded ? (
        visible.length === 0 ? (
          <p className="text-sm text-gray-600 mt-1">這次練習沒有答錯或未作答的題目。</p>
        ) : (
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
                    {question.uncertain ? (
                      <span
                        className="badge badge-warning"
                        title="批改時無法確定這個答案是否應該算對（可能是錯別字、另一個可接受的寫法，或只寫出詞語前段），已標示交由教師覆核。"
                      >
                        待覆核
                      </span>
                    ) : null}
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
                              <span className={isCorrect ? "badge badge-success" : "badge badge-danger"}>
                                {choiceLabel}
                              </span>
                            ) : null}
                            {isCorrect ? <span className="badge badge-success">正確答案</span> : null}
                          </li>
                        );
                      })}
                    </ol>
                  ) : null}
                  <p className="text-gray-700">
                    {answerLabel}：
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
        )
      ) : null}
    </article>
  );
}
