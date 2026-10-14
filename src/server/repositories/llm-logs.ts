/**
 * LLM 用量及 AI 批改記錄的資料存取（只儲存於本機資料庫）。
 *
 * 設計原則：
 *   1. 只記錄統計所需的欄位（provider、模型、請求類型、成功與否、回應時間、token 數、
 *      錯誤「類別」），**不記錄** API key、完整回應內容或學生的答案內容。
 *   2. 記錄失敗不可影響主要流程：呼叫端以 try/catch 包住寫入。
 */
import { getDb, newId, nowIso, toSqlBool, fromSqlBool } from "../db/connection";
import {
  gradingLogSchema,
  llmRequestTypeSchema,
  llmUsageLogSchema,
  type GradingLog,
  type LlmUsageEntry,
  type LlmUsageLog,
} from "../../lib/types";

interface UsageRow {
  id: string;
  request_type: string;
  provider: string;
  model: string | null;
  topic_id: string | null;
  success: number;
  duration_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  error_type: string | null;
  created_at: string;
}

interface GradingRow {
  id: string;
  question_id: string | null;
  session_id: string | null;
  question_type: string;
  provider: string;
  success: number;
  fell_back: number;
  duration_ms: number;
  error_type: string | null;
  created_at: string;
}

export function recordLlmUsage(entry: LlmUsageEntry): void {
  getDb()
    .prepare(
      `INSERT INTO llm_usage_logs
        (id, request_type, provider, model, topic_id, success, duration_ms, input_tokens,
         output_tokens, error_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newId("usage"),
      llmRequestTypeSchema.parse(entry.requestType),
      entry.provider,
      entry.model,
      entry.topicId,
      toSqlBool(entry.success),
      Math.max(0, Math.round(entry.durationMs)),
      entry.inputTokens,
      entry.outputTokens,
      entry.errorType,
      nowIso(),
    );
}

export interface NewGradingLogInput {
  questionId: string | null;
  sessionId: string | null;
  questionType: string;
  provider: string;
  success: boolean;
  fellBack: boolean;
  durationMs: number;
  errorType: string | null;
}

export function recordGradingLog(input: NewGradingLogInput): void {
  getDb()
    .prepare(
      `INSERT INTO ai_grading_logs
        (id, question_id, session_id, question_type, provider, success, fell_back, duration_ms,
         error_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newId("grade"),
      input.questionId,
      input.sessionId,
      input.questionType,
      input.provider,
      toSqlBool(input.success),
      toSqlBool(input.fellBack),
      Math.max(0, Math.round(input.durationMs)),
      input.errorType,
      nowIso(),
    );
}

function sinceIso(days: number): string {
  return new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000).toISOString();
}

export function llmUsageStats(days = 7): { llmRequests: number; llmFailures: number } {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failures
       FROM llm_usage_logs WHERE created_at >= ?`,
    )
    .get(sinceIso(days)) as unknown as { total: number; failures: number | null } | undefined;
  return { llmRequests: row?.total ?? 0, llmFailures: row?.failures ?? 0 };
}

export function gradingStats(days = 7): { attempts: number; failures: number; fallbacks: number } {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS attempts,
              SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failures,
              SUM(CASE WHEN fell_back = 1 THEN 1 ELSE 0 END) AS fallbacks
       FROM ai_grading_logs WHERE created_at >= ?`,
    )
    .get(sinceIso(days)) as unknown as
    | { attempts: number; failures: number | null; fallbacks: number | null }
    | undefined;
  return {
    attempts: row?.attempts ?? 0,
    failures: row?.failures ?? 0,
    fallbacks: row?.fallbacks ?? 0,
  };
}

export function tokenTotals(days = 7): { inputTokens: number; outputTokens: number } {
  const row = getDb()
    .prepare(
      `SELECT SUM(COALESCE(input_tokens, 0)) AS input_tokens,
              SUM(COALESCE(output_tokens, 0)) AS output_tokens
       FROM llm_usage_logs WHERE created_at >= ?`,
    )
    .get(sinceIso(days)) as unknown as
    | { input_tokens: number | null; output_tokens: number | null }
    | undefined;
  return { inputTokens: row?.input_tokens ?? 0, outputTokens: row?.output_tokens ?? 0 };
}

export function listRecentLlmUsage(limit = 20, days = 7): LlmUsageLog[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM llm_usage_logs WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(sinceIso(days), Math.min(Math.max(limit, 1), 100)) as unknown as UsageRow[];
  return rows.map((row) =>
    llmUsageLogSchema.parse({
      id: row.id,
      requestType: row.request_type,
      provider: row.provider,
      model: row.model,
      topicId: row.topic_id,
      success: fromSqlBool(row.success),
      durationMs: row.duration_ms,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      errorType: row.error_type,
      createdAt: row.created_at,
    }),
  );
}

export function listRecentGradingLogs(limit = 20, days = 7): GradingLog[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM ai_grading_logs WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(sinceIso(days), Math.min(Math.max(limit, 1), 100)) as unknown as GradingRow[];
  return rows.map((row) =>
    gradingLogSchema.parse({
      id: row.id,
      questionId: row.question_id,
      sessionId: row.session_id,
      questionType: row.question_type,
      provider: row.provider,
      success: fromSqlBool(row.success),
      fellBack: fromSqlBool(row.fell_back),
      durationMs: row.duration_ms,
      errorType: row.error_type,
      createdAt: row.created_at,
    }),
  );
}

/** 依錯誤類別統計失敗次數（供教師端了解最常見的失敗原因） */
export function errorTypeStats(days = 7): { errorType: string; count: number }[] {
  const rows = getDb()
    .prepare(
      `SELECT COALESCE(error_type, 'unknown') AS error_type, COUNT(*) AS total
       FROM llm_usage_logs
       WHERE created_at >= ? AND success = 0
       GROUP BY error_type ORDER BY total DESC LIMIT 10`,
    )
    .all(sinceIso(days)) as unknown as { error_type: string; total: number }[];
  return rows.map((row) => ({ errorType: row.error_type, count: row.total }));
}
