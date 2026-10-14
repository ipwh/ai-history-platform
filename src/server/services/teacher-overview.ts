/**
 * 教師端首頁所需的統計（只包含出題相關及學生練習記錄）。
 *
 * 教材、OCR、課題發布及系統狀態屬於管理員職能，相關統計由
 * src/server/services/admin-dashboard.ts 提供，不會在此回傳。
 */
import {
  countQuestionsByStatus,
  countSchoolPaperQuestions,
  countUnverifiedQuestionsNeedingReview,
} from "../repositories/questions";
import { countOpenReports } from "../repositories/reports";
import { listRecordLearners } from "../repositories/practice";
import type { TeacherQuestionOverview } from "../../lib/types";

export type { TeacherQuestionOverview };

/** 教師端首頁統計：題庫狀態、待覆核回報及學生練習記錄數量 */
export function getTeacherQuestionOverview(): TeacherQuestionOverview {
  const counts = countQuestionsByStatus();
  const learners = listRecordLearners();

  return {
    questions: {
      total: counts.total,
      published: counts.published,
      draft: counts.draft,
      disabled: counts.disabled,
      unverified: countUnverifiedQuestionsNeedingReview(),
      schoolPaper: countSchoolPaperQuestions(),
      flagged: countOpenReports(),
    },
    records: {
      sessions: learners.reduce((total, learner) => total + learner.sessions, 0),
      learners: learners.length,
    },
  };
}
