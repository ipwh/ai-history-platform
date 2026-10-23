/**
 * 品質警告的結構化診斷紀錄（Sprint 25，migration `0030-question-quality-findings`）。
 *
 * 與 `questions.quality_warnings_json` 的分工：
 *   - `quality_warnings_json`：教師介面顯示的人類可讀文字（可含其他模組的警告）；
 *   - `question_quality_findings`：可查詢、可統計的診斷中繼資料（代碼、規則版本、
 *     來源、時間、題目／練習關聯），**不含**題目內容、選項、答案或學生資料。
 *
 * 本檔案的函式不得改動 `questions` 的任何欄位；呼叫端負責在需要時把它與
 * `setQualityWarnings` 放在同一個交易內（見 `services/question-service.ts` 的重新檢查流程）。
 */
import { getDb, newId, nowIso, withTransaction } from "../db/connection";

/** 診斷來源：教師重新檢查落庫題目，或學生練習時的即時生成題 */
export type QualityFindingOrigin = "revalidation" | "instant";

export interface QualityFindingInput {
  code: string;
  ruleVersion: string;
  /** 目前一律 "warning"；保留欄位以便日後區分嚴重程度 */
  severity?: string;
  /** 即時生成題必填：快照內的題目 ID（題目本身不落庫） */
  snapshotQuestionId?: string | null;
}

export interface QualityFinding {
  id: string;
  code: string;
  ruleVersion: string;
  severity: string;
  origin: QualityFindingOrigin;
  questionId: string | null;
  questionRevision: number | null;
  sessionId: string | null;
  snapshotQuestionId: string | null;
  detectedAt: string;
}

interface FindingRow {
  id: string;
  code: string;
  rule_version: string;
  severity: string;
  origin: string;
  question_id: string | null;
  question_revision: number | null;
  session_id: string | null;
  snapshot_question_id: string | null;
  detected_at: string;
}

function toFinding(row: FindingRow): QualityFinding {
  return {
    id: row.id,
    code: row.code,
    ruleVersion: row.rule_version,
    severity: row.severity,
    origin: row.origin as QualityFindingOrigin,
    questionId: row.question_id,
    questionRevision: row.question_revision,
    sessionId: row.session_id,
    snapshotQuestionId: row.snapshot_question_id,
    detectedAt: row.detected_at,
  };
}

/**
 * 以最新一次的重新檢查結果取代該題 `origin='revalidation'` 的診斷列。
 *
 * 行為：
 *   1. 刪除該題所有 `revalidation` 列；
 *   2. 逐一插入目前判定（已解決的項目因此消失，不會留下過期警告）；
 *   3. 其他來源（例如日後啟用的 `instant`）及其他模組的警告完全不受影響。
 *
 * 交易：預設自行開啟交易（刪除＋插入全成或全不成）。若呼叫端已經持有交易
 * （例如把「更新 `quality_warnings_json`」與「更新診斷列」視為同一個單位），
 * 必須傳 `{ withinTransaction: true }`，否則 SQLite 會拒絕巢狀 `BEGIN`。
 *
 * 冪等：同一批輸入重複執行，結果相同（列 ID 會重新產生，但語意內容一致）。
 */
export function replaceRevalidationFindings(
  input: {
    questionId: string;
    questionRevision: number;
    findings: readonly QualityFindingInput[];
  },
  options: { withinTransaction?: boolean } = {},
): number {
  const db = getDb();
  const run = (): number => {
    db.prepare("DELETE FROM question_quality_findings WHERE question_id = ? AND origin = 'revalidation'").run(
      input.questionId,
    );
    const insert = db.prepare(
      `INSERT INTO question_quality_findings
         (id, code, rule_version, severity, origin, question_id, question_revision,
          session_id, snapshot_question_id, detected_at)
       VALUES (?, ?, ?, ?, 'revalidation', ?, ?, NULL, NULL, ?)`,
    );
    const detectedAt = nowIso();
    const seen = new Set<string>();
    let inserted = 0;
    for (const finding of input.findings) {
      // 同一批輸入內重複的代碼只寫一次（防止 unique index 失敗）
      const key = `${finding.code}::${finding.ruleVersion}`;
      if (seen.has(key)) continue;
      seen.add(key);
      insert.run(
        newId("qqf"),
        finding.code,
        finding.ruleVersion,
        finding.severity ?? "warning",
        input.questionId,
        input.questionRevision,
        detectedAt,
      );
      inserted += 1;
    }
    return inserted;
  };

  return options.withinTransaction === true ? run() : withTransaction(db, run);
}

/**
 * 記錄即時生成題（未落庫）的診斷。
 *
 * **本 Sprint 預設不呼叫**（見 docs/quality/option-quality-warning-traceability.md §5）：
 * 這些題目只存在於練習快照，加入此表會令診斷資料與個別學生的練習 session 產生關聯，
 * 需要先確認隱私、保留期限及刪除政策。函式已就緒並有測試，但沒有寫入路徑。
 *
 * 冪等：同一 session／題目／代碼／版本只會有一列（`INSERT OR IGNORE`）。
 */
export function recordSessionFindings(input: {
  sessionId: string;
  findings: readonly QualityFindingInput[];
}): number {
  const db = getDb();
  return withTransaction(db, () => {
    const insert = db.prepare(
      `INSERT OR IGNORE INTO question_quality_findings
         (id, code, rule_version, severity, origin, question_id, question_revision,
          session_id, snapshot_question_id, detected_at)
       VALUES (?, ?, ?, ?, 'instant', NULL, NULL, ?, ?, ?)`,
    );
    const detectedAt = nowIso();
    let inserted = 0;
    for (const finding of input.findings) {
      if (typeof finding.snapshotQuestionId !== "string" || finding.snapshotQuestionId.length === 0) {
        continue;
      }
      const result = insert.run(
        newId("qqf"),
        finding.code,
        finding.ruleVersion,
        finding.severity ?? "warning",
        input.sessionId,
        finding.snapshotQuestionId,
        detectedAt,
      );
      inserted += Number(result.changes);
    }
    return inserted;
  });
}

export function listFindingsForQuestion(questionId: string): QualityFinding[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM question_quality_findings WHERE question_id = ? ORDER BY code, rule_version",
    )
    .all(questionId) as unknown as FindingRow[];
  return rows.map(toFinding);
}

export function listFindingsForSession(sessionId: string): QualityFinding[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM question_quality_findings WHERE session_id = ? ORDER BY snapshot_question_id, code",
    )
    .all(sessionId) as unknown as FindingRow[];
  return rows.map(toFinding);
}

/** 刪除某一題的所有診斷（題目被刪除時清理，避免留下孤兒列） */
export function deleteFindingsForQuestion(questionId: string): number {
  const result = getDb()
    .prepare("DELETE FROM question_quality_findings WHERE question_id = ?")
    .run(questionId);
  return Number(result.changes);
}

/**
 * 清理孤兒列（`question_id` 指向已不存在的題目）。
 *
 * 只影響 `question_id` 非空且對應題目已不存在的列；`instant` 來源（`question_id` 為 NULL）
 * 不受影響。回傳刪除的列數。
 */
export function purgeOrphanedFindings(): number {
  const result = getDb()
    .prepare(
      `DELETE FROM question_quality_findings
        WHERE question_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM questions WHERE questions.id = question_quality_findings.question_id)`,
    )
    .run();
  return Number(result.changes);
}

export interface FindingSummaryRow {
  code: string;
  ruleVersion: string;
  origin: string;
  count: number;
}

/** 按代碼／版本／來源匯總（供審核腳本使用；不判斷史實或發布狀態） */
export function summariseFindings(): FindingSummaryRow[] {
  const rows = getDb()
    .prepare(
      `SELECT code, rule_version AS ruleVersion, origin, COUNT(*) AS count
         FROM question_quality_findings
        GROUP BY code, rule_version, origin
        ORDER BY code, rule_version, origin`,
    )
    .all() as unknown as FindingSummaryRow[];
  return rows;
}
