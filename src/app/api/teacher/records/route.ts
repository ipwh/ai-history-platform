import { handleRoute, jsonOk } from "@/server/http";
import { requireTeacher } from "@/server/auth/guards";
import { listRecordLearners } from "@/server/repositories/practice";
import { listStoredRosterStudents } from "@/server/repositories/roster-identities";
import { listTopics } from "@/server/repositories/topics";
import { getRosterSnapshot } from "@/server/roster";
import {
  enrichPracticeRecordLabels,
  enrichRecordLearners,
  listPracticeRecords,
  recordFilterFromParams,
} from "@/server/services/practice-records";

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
    const roster = await getRosterSnapshot();
    // 名冊暫時不可用（或已停用）時，沿用最後一次成功載入的身分快照，
    // 令歷史練習記錄仍然顯示姓名、班別及學號。
    const rosterStudents = roster.students.length > 0 ? roster.students : listStoredRosterStudents();
    const learners = enrichRecordLearners(listRecordLearners(), rosterStudents);
    const records = enrichPracticeRecordLabels(
      listPracticeRecords(recordFilterFromParams(params)),
      learners,
    );
    const topics = listTopics()
      .filter((topic) => topic.level !== 0)
      .map((topic) => ({
        id: topic.id,
        title: topic.title,
        level: topic.level,
        curriculumTheme: topic.curriculumTheme,
        topicNumber: topic.topicNumber,
      }));
    const rosterNotice = rosterStudents.length === 0
      ? "尚未載入學生名冊，未能配對姓名、班別及學號；學習者只會以電郵或匿名 ID 顯示。請在部署環境設定 STUDENT_ROSTER_*（見 README「學生名冊」）。"
      : roster.error || !roster.loaded
        ? "學生名冊暫時未能更新，顯示的是上次成功載入的姓名及班別。"
        : null;
    return jsonOk({
      records,
      topics,
      learners,
      rosterNotice,
      rosterSource: roster.loaded ? "live" : rosterStudents.length > 0 ? "snapshot" : "none",
    });
  });
}
