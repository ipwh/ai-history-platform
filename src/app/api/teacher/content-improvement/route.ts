import { z } from "zod";

import { ApiRouteError, handleRoute, jsonOk, parseJsonBody } from "@/server/http";
import { requireTeacher } from "@/server/auth/guards";
import {
  applyContentFlags,
  listContentImprovementQueue,
  MAX_BATCH_FLAG_SIZE,
  MAX_CONTENT_QUEUE_PAGE_SIZE,
  type ContentQueueStatus,
} from "@/server/services/content-improvement";
import { CONTENT_FLAGS } from "@/server/quality/content-flags";

export const runtime = "nodejs";

const QUEUE_STATUSES = ["unflagged", "flagged", "all"] as const;

const querySchema = z.object({
  flag: z.enum(CONTENT_FLAGS).optional(),
  explanationClass: z
    .enum(["placeholder", "answer_only", "insufficient", "potentially_inconsistent"])
    .optional(),
  improvement: z
    .enum([
      "rewrite_from_source_wording",
      "add_causal_reasoning",
      "add_concept_definition",
      "add_chronology_context",
      "teacher_adjudication",
    ])
    .optional(),
  status: z.enum(QUEUE_STATUSES).optional(),
  page: z.coerce.number().int().positive().max(1000).optional(),
  pageSize: z.coerce.number().int().positive().max(MAX_CONTENT_QUEUE_PAGE_SIZE).optional(),
});

const mutateSchema = z.object({
  flag: z.enum(CONTENT_FLAGS),
  action: z.enum(["mark", "clear"]),
  questionIds: z.array(z.string().min(1)).min(1).max(MAX_BATCH_FLAG_SIZE),
  /** 必填：標記紀錄不可無名，日後要能回答「為何把這批題目列為待重寫」 */
  reason: z.string().min(5).max(500),
});

/**
 * 教師端：解釋補寫／技能確認的工作佇列（唯讀）。
 *
 * 只允許教師或管理員讀取（`requireTeacher`）；學生 403、未登入 401。
 * 佇列內容來自 `npm run audit:explanation-worklist` 產生的報告，加上目前的標記狀態；
 * **不會**改變任何題目、答案、技能或發布狀態。
 */
export async function GET(request: Request) {
  return handleRoute(async () => {
    const viewer = await requireTeacher(request);
    if (!viewer) throw new ApiRouteError("需要教師或管理員登入才可查看內容改進佇列", 401);

    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      flag: url.searchParams.get("flag") ?? undefined,
      explanationClass: url.searchParams.get("explanationClass") ?? undefined,
      improvement: url.searchParams.get("improvement") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    if (!parsed.success) {
      throw new ApiRouteError(
        `查詢參數不正確：${parsed.error.issues.map((issue) => issue.path.join(".")).join("、")}`,
        400,
      );
    }

    return jsonOk(
      listContentImprovementQueue({
        ...parsed.data,
        status: parsed.data.status as ContentQueueStatus | undefined,
      }),
    );
  });
}

/**
 * 教師端：批次標記「解釋待重寫」「技能待確認」（或解除標記）。
 *
 * 需要真實的教師或管理員工作階段（不接受示範模式身分），因為標記必須記錄負責人。
 * 標記寫入 `question_content_flags`（只可新增），**不是**覆核決定：不會改變題目的發布
 * 狀態、內容、答案或技能標籤。
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const viewer = await requireTeacher(request);
    if (!viewer) throw new ApiRouteError("需要教師或管理員登入才可標記內容改進項目", 401);
    const body = await parseJsonBody(request, mutateSchema);

    const report = applyContentFlags(
      body.questionIds.map((questionId) => ({
        questionId,
        flag: body.flag,
        action: body.action,
        reason: body.reason,
      })),
      {
        dryRun: false,
        atomic: true,
        actor: { email: viewer.email, role: viewer.role },
      },
    );

    return jsonOk(report);
  });
}
