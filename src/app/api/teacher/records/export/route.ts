import { NextResponse } from "next/server";

import { handleRoute, privateResponseHeaders } from "@/server/http";
import { requireTeacher } from "@/server/auth/guards";
import {
  buildRecordsCsv,
  listPracticeRecords,
  recordFilterFromParams,
} from "@/server/services/practice-records";

export const runtime = "nodejs";

/** 教師端：下載學生練習記錄（CSV，每題一列，含作答日期、課題、題型及答對／答錯） */
export async function GET(request: Request) {
  return handleRoute(async () => {
    await requireTeacher(request);
    const params = new URL(request.url).searchParams;
    const records = listPracticeRecords(recordFilterFromParams(params, 2000));
    const csv = buildRecordsCsv(records);
    const filename = `practice-records-${new Date().toISOString().slice(0, 10)}.csv`;
    return new NextResponse(`\uFEFF${csv}`, {
      status: 200,
      headers: privateResponseHeaders({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      }),
    });
  });
}
