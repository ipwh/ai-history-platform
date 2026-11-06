import { handleRoute, jsonOk } from "@/server/http";
import { resolveOptionalLearnerId } from "@/server/auth/guards";
import { summarizeSessionsForRecords } from "@/server/repositories/practice";
import { listTopics } from "@/server/repositories/topics";
import {
  enrichPracticeRecordLabels,
  listPracticeRecords,
  recordFilterFromParams,
} from "@/server/services/practice-records";

export const runtime = "nodejs";

/**
 * 學生端：我的練習記錄（可依課題、日期及成績篩選）。
 *
 * 學習者身分**只**由伺服器端工作階段推導；前端傳來的 `learnerId` 只在未啟用登入的
 * 匿名示範模式下使用（與 `/api/progress` 相同規則），已登入時一律以帳戶為準。
 * 因此學生不可能透過改動查詢參數讀取其他學生的記錄。
 */
export async function GET(request: Request) {
  return handleRoute(async () => {
    const params = new URL(request.url).searchParams;
    const learnerId = await resolveOptionalLearnerId(request, params.get("learnerId"));

    const topics = listTopics()
      .filter((topic) => topic.level !== 0)
      .map((topic) => ({
        id: topic.id,
        title: topic.title,
        level: topic.level,
        curriculumTheme: topic.curriculumTheme,
        topicNumber: topic.topicNumber,
      }));

    if (learnerId === null) {
      return jsonOk({
        records: [],
        summary: { sessions: 0, learners: 0, correct: 0, wrong: 0, graded: 0 },
        topics,
        truncated: false,
        limit: 200,
      });
    }

    const filter = recordFilterFromParams(params);
    // 班別／表單／其他學習者一律不適用：學生只能查自己的記錄
    const scopedFilter = {
      ...filter,
      learnerId,
      learnerIds: undefined,
      className: null,
      formLevel: null,
    };
    const records = enrichPracticeRecordLabels(listPracticeRecords(scopedFilter), []);
    const summary = summarizeSessionsForRecords(scopedFilter);

    return jsonOk({
      records,
      summary,
      truncated: records.length < summary.sessions,
      limit: filter.limit ?? 200,
      topics,
    });
  });
}
