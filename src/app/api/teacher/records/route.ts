import { handleRoute, jsonOk } from "@/server/http";
import { requireTeacher } from "@/server/auth/guards";
import { listRecordLearners } from "@/server/repositories/practice";
import { listTopics } from "@/server/repositories/topics";
import { listPracticeRecords, recordFilterFromParams } from "@/server/services/practice-records";

export const runtime = "nodejs";

/**
 * 教師端：學生練習記錄（可按課題、學習者及日期篩選）。
 *
 * 每筆記錄包含作答日期、課題、題型、答對及答錯的題目，供教師查閱及匯出。
 */
export async function GET(request: Request) {
  return handleRoute(async () => {
    await requireTeacher(request);
    const params = new URL(request.url).searchParams;
    const records = listPracticeRecords(recordFilterFromParams(params));
    const topics = listTopics()
      .filter((topic) => topic.level !== 0)
      .map((topic) => ({
        id: topic.id,
        title: topic.title,
        level: topic.level,
        topicNumber: topic.topicNumber,
      }));
    return jsonOk({ records, topics, learners: listRecordLearners() });
  });
}
