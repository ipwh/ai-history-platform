import { getDb, newId } from "../db/connection";

export type TutorMessageRole = "user" | "assistant";

export interface TutorMessage {
  id: string;
  sessionId: string;
  role: TutorMessageRole;
  content: string;
  tokensUsed: number;
  createdAt: string;
}

interface TutorSessionRow {
  learnerId: string;
}

interface TutorCountRow {
  total: number;
}

export function createTutorSession(learnerId: string, createdAt: string): string {
  const id = newId("tutor");
  getDb()
    .prepare("INSERT INTO tutor_sessions (id, learnerId, createdAt, topicId) VALUES (?, ?, ?, NULL)")
    .run(id, learnerId, createdAt);
  return id;
}

export function getTutorSessionLearnerId(sessionId: string): string | null {
  const row = getDb()
    .prepare("SELECT learnerId FROM tutor_sessions WHERE id = ?")
    .get(sessionId) as unknown as TutorSessionRow | undefined;
  return row?.learnerId ?? null;
}

export function isTutorSessionLastTurnOnTopic(sessionId: string): boolean {
  const row = getDb()
    .prepare("SELECT lastTurnOnTopic FROM tutor_sessions WHERE id = ?")
    .get(sessionId) as unknown as { lastTurnOnTopic: number } | undefined;
  return row?.lastTurnOnTopic === 1;
}

export function setTutorSessionLastTurnOnTopic(sessionId: string, onTopic: boolean): void {
  getDb()
    .prepare("UPDATE tutor_sessions SET lastTurnOnTopic = ? WHERE id = ?")
    .run(onTopic ? 1 : 0, sessionId);
}

export function getTutorMessages(sessionId: string, limit = 40): TutorMessage[] {
  const rows = getDb()
    .prepare(
      `SELECT id, sessionId, role, content, tokensUsed, createdAt
       FROM tutor_messages WHERE sessionId = ?
       ORDER BY createdAt DESC, rowid DESC LIMIT ?`,
    )
    .all(sessionId, limit) as unknown as TutorMessage[];
  return rows.reverse();
}

export function saveTutorMessage(
  sessionId: string,
  role: TutorMessageRole,
  content: string,
  createdAt: string,
  tokensUsed = 0,
): void {
  getDb()
    .prepare(
      `INSERT INTO tutor_messages (id, sessionId, role, content, tokensUsed, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(newId("tmsg"), sessionId, role, content, tokensUsed, createdAt);
}

export function countTutorQuestionsSince(learnerId: string, since: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS total
       FROM tutor_messages AS messages
       INNER JOIN tutor_sessions AS sessions ON sessions.id = messages.sessionId
       WHERE sessions.learnerId = ? AND messages.role = 'user' AND messages.createdAt >= ?`,
    )
    .get(learnerId, since) as unknown as TutorCountRow | undefined;
  return row?.total ?? 0;
}
