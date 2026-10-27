import { getDb, newId } from "../db/connection";
import {
  tutorGroundingStatusSchema,
  tutorSourceSchema,
  tutorTermNoteSchema,
  type TutorGroundingStatus,
  type TutorSource,
  type TutorTermNote,
} from "../../lib/types";

export type TutorMessageRole = "user" | "assistant";

export interface TutorMessage {
  id: string;
  sessionId: string;
  role: TutorMessageRole;
  content: string;
  tokensUsed: number;
  createdAt: string;
  /** 回答所依據的教材出處（只有 assistant 訊息會有） */
  sources: TutorSource[];
  /** 教材依據狀態；`none` 代表沒有記錄（例如離題回覆或舊資料） */
  groundingStatus: TutorGroundingStatus;
  /** 模型用了課本以外寫法的對照 */
  termNotes: TutorTermNote[];
}

/** 寫入訊息時可一併保存的教材依據資料（學生提問不需要） */
export interface TutorMessageMetadata {
  sources?: TutorSource[];
  groundingStatus?: TutorGroundingStatus;
  termNotes?: TutorTermNote[];
}

interface TutorMessageRow {
  id: string;
  sessionId: string;
  role: TutorMessageRole;
  content: string;
  tokensUsed: number;
  createdAt: string;
  sourcesJson: string | null;
  groundingStatus: string | null;
  termNotesJson: string | null;
}

/**
 * 資料庫內的 JSON 一律以安全方式解析。
 *
 * 這裡的資料是前端顯示用的輔助資訊（出處、用語對照），即使格式損壞亦不應令整段
 * 對話載入失敗——最壞情況是該則訊息不顯示標示。
 */
function parseJsonArray<T>(value: string | null, schema: { safeParse: (input: unknown) => { success: boolean; data?: unknown } }): T[] {
  if (value === null || value.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const result = schema.safeParse(item);
      return result.success && result.data !== undefined ? [result.data as T] : [];
    });
  } catch {
    return [];
  }
}

function mapMessage(row: TutorMessageRow): TutorMessage {
  const status = tutorGroundingStatusSchema.safeParse(row.groundingStatus);
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role,
    content: row.content,
    tokensUsed: row.tokensUsed,
    createdAt: row.createdAt,
    sources: parseJsonArray<TutorSource>(row.sourcesJson, tutorSourceSchema),
    groundingStatus: status.success ? status.data : "none",
    termNotes: parseJsonArray<TutorTermNote>(row.termNotesJson, tutorTermNoteSchema),
  };
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
      `SELECT id, sessionId, role, content, tokensUsed, createdAt,
              sourcesJson, groundingStatus, termNotesJson
       FROM tutor_messages WHERE sessionId = ?
       ORDER BY createdAt DESC, rowid DESC LIMIT ?`,
    )
    .all(sessionId, limit) as unknown as TutorMessageRow[];
  return rows.reverse().map(mapMessage);
}

export function saveTutorMessage(
  sessionId: string,
  role: TutorMessageRole,
  content: string,
  createdAt: string,
  tokensUsed = 0,
  metadata: TutorMessageMetadata = {},
): void {
  getDb()
    .prepare(
      `INSERT INTO tutor_messages
         (id, sessionId, role, content, tokensUsed, createdAt,
          sourcesJson, groundingStatus, termNotesJson)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newId("tmsg"),
      sessionId,
      role,
      content,
      tokensUsed,
      createdAt,
      JSON.stringify(metadata.sources ?? []),
      metadata.groundingStatus ?? "none",
      JSON.stringify(metadata.termNotes ?? []),
    );
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
