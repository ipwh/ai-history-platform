import { getDb, newId } from "../db/connection";
import {
  tutorGroundingStatusSchema,
  tutorPracticeContextSchema,
  tutorSourceSchema,
  tutorTermNoteSchema,
  tutorWebSourceSchema,
  tutorWebSupplementStatusSchema,
  type TutorGroundingStatus,
  type TutorPracticeContext,
  type TutorSource,
  type TutorTermNote,
  type TutorWebSource,
  type TutorWebSupplementStatus,
} from "../../lib/types";

export type TutorMessageRole = "user" | "assistant";

/**
 * 對話載入視窗：`GET /api/tutor/chat` 預設回傳最近多少則訊息。
 *
 * 學生重新載入頁面時只看得到這個數目；超過時介面會顯示「僅顯示最近 N 則」，
 * 而不是無聲截斷（見 `truncated` 與 `messageCount`）。
 */
export const TUTOR_MESSAGE_WINDOW = 80;

/** 訊息層級的外部參考狀態；`none` = 該則訊息沒有記錄（例如舊資料或學生提問） */
export type TutorMessageWebStatus = TutorWebSupplementStatus | "none";

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
  /** 白名單網站的外部參考（與 `sources` 分軌，永不當成課本依據） */
  webSources: TutorWebSource[];
  /** 外部參考狀態（只用於教師端聚合統計，不影響顯示） */
  webSupplementStatus: TutorMessageWebStatus;
}

/** 寫入訊息時可一併保存的教材依據資料（學生提問不需要） */
export interface TutorMessageMetadata {
  sources?: TutorSource[];
  groundingStatus?: TutorGroundingStatus;
  termNotes?: TutorTermNote[];
  webSources?: TutorWebSource[];
  webSupplementStatus?: TutorWebSupplementStatus;
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
  webSourcesJson: string | null;
  webSupplementStatus: string | null;
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

/** 解析單一 JSON 物件（例如練習上下文）；格式損壞時回傳 null，不拋錯 */
export function parseTutorJsonObject<T>(
  value: string | null,
  schema: { safeParse: (input: unknown) => { success: boolean; data?: unknown } },
): T | null {
  if (value === null || value.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return null;
    const result = schema.safeParse(parsed);
    return result.success && result.data !== undefined ? (result.data as T) : null;
  } catch {
    return null;
  }
}

function mapMessage(row: TutorMessageRow): TutorMessage {
  const status = tutorGroundingStatusSchema.safeParse(row.groundingStatus);
  const webStatus = tutorWebSupplementStatusSchema.safeParse(row.webSupplementStatus);
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
    webSources: parseJsonArray<TutorWebSource>(row.webSourcesJson, tutorWebSourceSchema),
    webSupplementStatus: webStatus.success ? webStatus.data : "none",
  };
}

interface TutorSessionRow {
  learnerId: string;
  topicId: string | null;
  practiceContextJson: string | null;
}

interface TutorCountRow {
  total: number;
}

/** 建立的對話工作階段可附帶學習目標課題及練習上下文（兩者都只含學生安全資料） */
export interface CreateTutorSessionOptions {
  topicId?: string | null;
  practiceContext?: TutorPracticeContext | null;
}

export function createTutorSession(
  learnerId: string,
  createdAt: string,
  options: CreateTutorSessionOptions = {},
): string {
  const id = newId("tutor");
  getDb()
    .prepare(
      `INSERT INTO tutor_sessions (id, learnerId, createdAt, topicId, practiceContextJson)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      learnerId,
      createdAt,
      options.topicId ?? null,
      JSON.stringify(options.practiceContext ?? null),
    );
  return id;
}

/**
 * 讀取對話工作階段的學習目標課題及練習上下文。
 *
 * 重新載入頁面時用來重建開場引導：開場氣泡本身不寫入 `tutor_messages`
 * （它是平台的說明，不是學生或模型的對話），所以需要另外保存這一小段安全資料。
 */
export function getTutorSessionContext(sessionId: string): {
  topicId: string | null;
  practiceContext: TutorPracticeContext | null;
} {
  const row = getDb()
    .prepare("SELECT learnerId, topicId, practiceContextJson FROM tutor_sessions WHERE id = ?")
    .get(sessionId) as unknown as TutorSessionRow | undefined;
  if (!row) return { topicId: null, practiceContext: null };
  return {
    topicId: row.topicId,
    practiceContext: parseTutorJsonObject<TutorPracticeContext>(
      row.practiceContextJson,
      tutorPracticeContextSchema,
    ),
  };
}

/** 更新學習目標課題（只影響檢索的 soft prior，不會改寫學生原句或既有回覆） */
export function setTutorSessionTopicId(sessionId: string, topicId: string | null): void {
  getDb().prepare("UPDATE tutor_sessions SET topicId = ? WHERE id = ?").run(topicId, sessionId);
}

/** 保存練習上下文；只接受已由伺服器重組的安全資料 */
export function setTutorSessionPracticeContext(
  sessionId: string,
  context: TutorPracticeContext | null,
): void {
  getDb()
    .prepare("UPDATE tutor_sessions SET practiceContextJson = ? WHERE id = ?")
    .run(JSON.stringify(context ?? null), sessionId);
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

export function getTutorMessages(sessionId: string, limit = TUTOR_MESSAGE_WINDOW): TutorMessage[] {
  const rows = getDb()
    .prepare(
      `SELECT id, sessionId, role, content, tokensUsed, createdAt,
              sourcesJson, groundingStatus, termNotesJson, webSourcesJson, webSupplementStatus
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
          sourcesJson, groundingStatus, termNotesJson, webSourcesJson, webSupplementStatus)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      JSON.stringify(metadata.webSources ?? []),
      metadata.webSupplementStatus ?? "none",
    );
}

export function countTutorMessages(sessionId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS total FROM tutor_messages WHERE sessionId = ?")
    .get(sessionId) as unknown as TutorCountRow | undefined;
  return row?.total ?? 0;
}

/**
 * 由 `since` 起計、**已成功取得學伴回覆**的提問數（每日 15 次額度用）。
 *
 * 只有同時符合以下條件的提問才計入：
 *   1. 該提問之後緊接的下一則訊息是 assistant 回覆（即該次請求成功落庫）；
 *   2. 該回覆不是離題固定引導句（`groundingStatus = 'off-topic'`）。
 *
 * 學生的提問在呼叫模型**之前**就會寫入資料庫，因此「有提問」不等於「用了額度」：
 * 上游 5xx、串流中斷、空白回覆都不應扣學生的每日額度（2026-10-27 產品決定）。
 * 失敗路徑仍然受 `ai_operations` 的 generation 時間窗限制（見 route 的 reserveAiOperation），
 * 所以反覆失敗不會變成無限制刷模型。
 *
 * 「緊接的下一則」這個條件同時解決另一種情況：先失敗、再問第二題時，第一題之後的
 * 下一則訊息是第二題（user），所以第一題不會被第二題的回覆誤算成已作答。
 */
export function countAnsweredTutorQuestionsSince(learnerId: string, since: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS total
       FROM tutor_messages AS question
       INNER JOIN tutor_sessions AS sessions ON sessions.id = question.sessionId
       WHERE sessions.learnerId = ?
         AND question.role = 'user'
         AND question.createdAt >= ?
         AND EXISTS (
           SELECT 1 FROM tutor_messages AS reply
           WHERE reply.sessionId = question.sessionId
             AND reply.role = 'assistant'
             AND reply.rowid = (
               SELECT MIN(next.rowid)
               FROM tutor_messages AS next
               WHERE next.sessionId = question.sessionId AND next.rowid > question.rowid
             )
             AND COALESCE(reply.groundingStatus, 'none') <> 'off-topic'
         )`,
    )
    .get(learnerId, since) as unknown as TutorCountRow | undefined;
  return row?.total ?? 0;
}
