"use client";

import {
  QUESTION_REPORT_REASON_LABELS,
  QUESTION_REPORT_STATUSES,
  QUESTION_REPORT_STATUS_LABELS,
  type QuestionReportDetail,
  type QuestionReportStatus,
  type TopicOverview,
} from "@/lib/types";

interface QuestionReportPanelProps {
  reports: QuestionReportDetail[];
  topics: TopicOverview[];
  statusFilter: QuestionReportStatus | "";
  topicFilter: string;
  busyReportId: string | null;
  onStatusFilterChange: (status: QuestionReportStatus | "") => void;
  onTopicFilterChange: (topicId: string) => void;
  onRefresh: () => void;
  onResolve: (reportId: string, status: QuestionReportStatus) => void;
}

/** 回報者只顯示「學生／教師／管理員」類別，不顯示帳戶或學習者 ID（減少個資暴露） */
function reporterLabel(learnerId: string): string {
  if (learnerId.startsWith("admin:")) return "管理員（測試）";
  return learnerId.startsWith("teacher:") ? "教師（測試）" : "學生";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-HK", { hour12: false });
}

/**
 * 學生題目回報（教師覆核用）。
 *
 * 回報只提示教師留意，**不會**自動刪除或停用題目；教師可標記為已處理或已略過。
 */
export function QuestionReportPanel({
  reports,
  topics,
  statusFilter,
  topicFilter,
  busyReportId,
  onStatusFilterChange,
  onTopicFilterChange,
  onRefresh,
  onResolve,
}: QuestionReportPanelProps) {
  const openCount = reports.filter((report) => report.status === "open").length;

  return (
    <section className="card flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-semibold">題目回報（待教師覆核）</h2>
          <p className="text-sm text-gray-600">
            學生在答案頁回報題目問題。回報不會自動刪除或停用題目，請核對教材後再決定處理方式。
            目前顯示的待覆核回報：{openCount} 筆。
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label>
            狀態
            <select
              value={statusFilter}
              onChange={(event) =>
                onStatusFilterChange(event.target.value as QuestionReportStatus | "")
              }
            >
              <option value="">全部</option>
              {QUESTION_REPORT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {QUESTION_REPORT_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
          <label>
            課題
            <select value={topicFilter} onChange={(event) => onTopicFilterChange(event.target.value)}>
              <option value="">全部課題</option>
              {topics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.title}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn" onClick={onRefresh}>
            重新載入
          </button>
        </div>
      </div>

      {reports.length === 0 ? (
        <p className="text-sm text-gray-600">目前沒有符合條件的題目回報。</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {reports.map((report) => (
            <li
              key={report.id}
              className="rounded-xl border p-3 text-sm flex flex-col gap-1"
              style={{ borderColor: "var(--border)" }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="badge badge-warning">
                  {QUESTION_REPORT_REASON_LABELS[report.reason]}
                </span>
                <span
                  className={`badge ${
                    report.status === "open"
                      ? "badge-warning"
                      : report.status === "resolved"
                        ? "badge-success"
                        : "badge"
                  }`}
                >
                  {QUESTION_REPORT_STATUS_LABELS[report.status]}
                </span>
                <span className="text-gray-600">{reporterLabel(report.learnerId)}回報</span>
                <span className="text-gray-600">{formatDateTime(report.createdAt)}</span>
                {report.openCountForQuestion > 1 ? (
                  <span className="badge badge-danger">
                    同一題目共有 {report.openCountForQuestion} 筆待覆核
                  </span>
                ) : null}
                {report.inQuestionBank ? null : <span className="badge">AI 即時生成題目</span>}
              </div>

              <p className="font-medium whitespace-pre-wrap">{report.question}</p>
              {report.detail.length > 0 ? (
                <p className="text-gray-700">補充說明：{report.detail}</p>
              ) : null}
              <p className="text-xs text-gray-600">
                {report.topicTitle}
                {report.sectionTitle ? ` › ${report.sectionTitle}` : ""}｜題目狀態：
                {report.inQuestionBank
                  ? report.questionStatus === "published"
                    ? "已發布"
                    : report.questionStatus === "draft"
                      ? "草稿"
                      : "已停用"
                  : "AI 即時生成（只存於該次練習，未存入題庫）"}
              </p>

              <div className="flex flex-wrap gap-2">
                {report.status !== "resolved" ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={busyReportId === report.id}
                    onClick={() => onResolve(report.id, "resolved")}
                  >
                    標記為已處理
                  </button>
                ) : null}
                {report.status !== "dismissed" ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={busyReportId === report.id}
                    onClick={() => onResolve(report.id, "dismissed")}
                  >
                    略過
                  </button>
                ) : null}
                {report.status !== "open" ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={busyReportId === report.id}
                    onClick={() => onResolve(report.id, "open")}
                  >
                    重設為待覆核
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
