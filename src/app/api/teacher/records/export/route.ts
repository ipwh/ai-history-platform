import { NextResponse } from "next/server";

import { handleRoute, privateResponseHeaders } from "@/server/http";
import { requireTeacher } from "@/server/auth/guards";
import { formLevelLabel } from "@/lib/learner-ordering";
import { listRecordLearners } from "@/server/repositories/practice";
import { listStoredRosterStudents } from "@/server/repositories/roster-identities";
import { getRosterSnapshot } from "@/server/roster";
import {
  enrichPracticeRecordLabels,
  enrichRecordLearners,
  listPracticeRecords,
  recordLearnerIdsForFilters,
  recordFilterFromParams,
} from "@/server/services/practice-records";
import {
  buildRecordsExport,
  parseRecordsExportFormat,
  RECORDS_EXPORT_LABELS,
} from "@/server/services/records-export";

export const runtime = "nodejs";

/** 篩選條件的文字說明（寫進 DOCX／PDF 開頭，存檔後仍知道匯出範圍） */
function describeFilter(params: URLSearchParams, learnerLabel: string | null): string {
  const parts: string[] = [];
  const sessionId = params.get("sessionId")?.trim();
  if (sessionId) parts.push(`單次練習 ${sessionId}`);
  const topicId = params.get("topicId")?.trim();
  if (topicId) parts.push(`課題 ${topicId}`);
  const formLevel = params.get("formLevel")?.trim();
  if (formLevel) parts.push(`班級 ${formLevelLabel(formLevel)}`);
  const className = params.get("className")?.trim();
  if (className) parts.push(`班別 ${className === "__unlisted" ? "未列入名冊" : className}`);
  if (learnerLabel) parts.push(`學習者 ${learnerLabel}`);
  const from = params.get("from")?.trim();
  const to = params.get("to")?.trim();
  if (from || to) parts.push(`日期 ${from || "不限"} 至 ${to || "不限"}`);
  const correctMin = params.get("correctMin")?.trim();
  const correctMax = params.get("correctMax")?.trim();
  if (correctMin || correctMax) {
    parts.push(`答對題數 ${correctMin || "不限"} 至 ${correctMax || "不限"}`);
  }
  const accuracyMin = params.get("accuracyMin")?.trim();
  const accuracyMax = params.get("accuracyMax")?.trim();
  if (accuracyMin || accuracyMax) {
    parts.push(`答對百分比 ${accuracyMin || "不限"} 至 ${accuracyMax || "不限"}`);
  }
  return parts.length > 0 ? parts.join("、") : "全部課題、全部學習者";
}

/**
 * 教師端：下載學生練習記錄。
 *
 * `format` 可為 csv（預設，每題一列）、xlsx（練習概況＋逐題記錄）、docx 或 pdf（每次練習一節）。
 * 所有格式都套用同一組篩選條件，內容一致；加上 `sessionId` 則只匯出該次練習。
 */
export async function GET(request: Request) {
  return handleRoute(async () => {
    await requireTeacher(request);
    const params = new URL(request.url).searchParams;
    const format = parseRecordsExportFormat(params.get("format"));
    const roster = await getRosterSnapshot();
    const rosterStudents = roster.students.length > 0 ? roster.students : listStoredRosterStudents();
    const learners = enrichRecordLearners(listRecordLearners(), rosterStudents);
    const filtered = recordFilterFromParams(params, 2000);
    const records = enrichPracticeRecordLabels(
      listPracticeRecords({
        ...filtered,
        learnerIds: recordLearnerIdsForFilters(learners, filtered),
      }),
      learners,
    );
    const learner = filtered.learnerId
      ? learners.find((item) => item.learnerId === filtered.learnerId)
      : undefined;
    const learnerLabel = learner
      ? [learner.name || learner.email || learner.learnerId, learner.className, learner.studentNumber]
          .filter(Boolean)
          .join("・")
      : filtered.learnerId;

    const result = await buildRecordsExport(records, {
      format,
      filterSummary: describeFilter(params, learnerLabel ?? null),
    });

    return new NextResponse(new Uint8Array(result.body), {
      status: 200,
      headers: privateResponseHeaders({
        "Content-Type": result.contentType,
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "X-Records-Format": RECORDS_EXPORT_LABELS[format],
        "X-Records-Count": String(records.length),
      }),
    });
  });
}
