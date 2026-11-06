import { NextResponse } from "next/server";

import { handleRoute, privateResponseHeaders } from "@/server/http";
import { resolveLearnerId } from "@/server/auth/guards";
import { listPracticeRecords, recordFilterFromParams } from "@/server/services/practice-records";
import { buildRecordsExport, parseRecordsExportFormat } from "@/server/services/records-export";

export const runtime = "nodejs";

/** 篩選條件的文字說明（寫進 DOCX／PDF 開頭，存檔後仍知道匯出範圍） */
function describeFilter(params: URLSearchParams): string {
  const parts: string[] = [];
  const topicId = params.get("topicId")?.trim();
  if (topicId) parts.push(`課題 ${topicId}`);
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
  return parts.length > 0 ? parts.join("、") : "全部課題、全部日期";
}

/**
 * 學生端：下載自己的練習記錄。
 *
 * 與教師端匯出共用同一套內容生成器；學習者身分同樣只取自工作階段，因此檔案永遠
 * 只包含自己的記錄。格式：csv（預設）／xlsx／docx／pdf。
 */
export async function GET(request: Request) {
  return handleRoute(async () => {
    const params = new URL(request.url).searchParams;
    const learnerId = await resolveLearnerId(request, params.get("learnerId"));
    const format = parseRecordsExportFormat(params.get("format"));
    const filter = recordFilterFromParams(params, 2000);
    const records = listPracticeRecords({
      ...filter,
      learnerId,
      learnerIds: undefined,
      className: null,
      formLevel: null,
    });

    const result = await buildRecordsExport(records, {
      format,
      filterSummary: `我的記錄・${describeFilter(params)}`,
    });

    return new NextResponse(new Uint8Array(result.body), {
      status: 200,
      headers: privateResponseHeaders({
        "Content-Type": result.contentType,
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "X-Records-Count": String(records.length),
      }),
    });
  });
}
