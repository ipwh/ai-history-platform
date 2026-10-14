/**
 * 匿名學習者及學習進度的資料存取。
 * 學習者 ID 由前端產生（UUID），不含姓名、電話等個人資料。
 */
import { getDb, nowIso } from "../db/connection";

export interface LearnerProgress {
  completedSessions: number;
  answeredQuestions: number;
  correctAnswers: number;
  accuracy: number | null;
}

export function ensureLearner(learnerId: string): void {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO learners (id, created_at) VALUES (?, ?)").run(
    learnerId,
    nowIso(),
  );
}

export function learnerExists(learnerId: string): boolean {
  const row = getDb().prepare("SELECT id FROM learners WHERE id = ?").get(learnerId);
  return row !== undefined;
}

export function getLearnerProgress(learnerId: string, topicId: string): LearnerProgress {
  const db = getDb();
  const sessionRow = db
    .prepare(
      `SELECT COUNT(*) AS total FROM practice_sessions
       WHERE learner_id = ? AND topic_id = ? AND completed_at IS NOT NULL`,
    )
    .get(learnerId, topicId) as unknown as { total: number } | undefined;

  const attemptRow = db
    .prepare(
      `SELECT COUNT(*) AS answered,
              COALESCE(SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END), 0) AS correct,
              COALESCE(SUM(CASE WHEN a.is_correct IS NOT NULL THEN 1 ELSE 0 END), 0) AS graded
       FROM attempts a
       JOIN practice_sessions s ON s.id = a.session_id
       WHERE a.learner_id = ? AND s.topic_id = ?`,
    )
    .get(learnerId, topicId) as unknown as
    | { answered: number; correct: number; graded: number }
    | undefined;

  const graded = attemptRow?.graded ?? 0;
  const correct = attemptRow?.correct ?? 0;

  return {
    completedSessions: sessionRow?.total ?? 0,
    answeredQuestions: attemptRow?.answered ?? 0,
    correctAnswers: correct,
    accuracy: graded > 0 ? Number((correct / graded).toFixed(4)) : null,
  };
}

/** 需要重溫的知識點（依答錯次數排序） */
export function listKnowledgePointsToReview(
  learnerId: string,
  topicId: string,
  limit = 12,
): { knowledgePoint: string; questionId: string; wrongCount: number }[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT q.knowledge_point AS knowledgePoint,
              q.id AS questionId,
              COUNT(*) AS wrongCount
       FROM attempts a
       JOIN practice_sessions s ON s.id = a.session_id
       JOIN questions q ON q.id = a.question_id
       WHERE a.learner_id = ? AND s.topic_id = ? AND a.is_correct = 0
       GROUP BY q.knowledge_point, q.id
       ORDER BY wrongCount DESC, q.knowledge_point ASC
       LIMIT ?`,
    )
    .all(learnerId, topicId, limit) as unknown as {
    knowledgePoint: string;
    questionId: string;
    wrongCount: number;
  }[];
  return rows;
}
