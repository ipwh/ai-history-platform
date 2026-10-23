/**
 * 題目內容變更的稽核紀錄（只可新增）。
 *
 * 這個 repository **沒有** update／delete：變更歷史不可覆寫，與 `question_reviews`、
 * `question_content_flags` 的處理方式一致。
 *
 * 與覆核紀錄的分工（Sprint 20）：
 *   - `question_reviews`：**人的判斷**——某人確認過某一版題目，是發布關卡的證據。
 *   - `question_mutations`：**內容變更的事實**——哪個工具、以誰的身分、把哪一題由
 *     哪一版改成哪一版，改動前後的題幹及指紋。腳本改寫題幹**不是**覆核。
 */
import { getDb, newId, nowIso } from "../db/connection";

export interface QuestionMutation {
  id: string;
  questionId: string;
  action: string;
  beforeRevision: number;
  afterRevision: number;
  beforeFingerprint: string;
  afterFingerprint: string;
  beforeQuestion: string;
  afterQuestion: string;
  actorEmail: string;
  actorRole: string;
  source: string;
  reason: string | null;
  createdAt: string;
}

interface QuestionMutationRow {
  id: string;
  question_id: string;
  action: string;
  before_revision: number;
  after_revision: number;
  before_fingerprint: string;
  after_fingerprint: string;
  before_question: string;
  after_question: string;
  actor_email: string;
  actor_role: string;
  source: string;
  reason: string | null;
  created_at: string;
}

function mapMutation(row: QuestionMutationRow): QuestionMutation {
  return {
    id: row.id,
    questionId: row.question_id,
    action: row.action,
    beforeRevision: row.before_revision,
    afterRevision: row.after_revision,
    beforeFingerprint: row.before_fingerprint,
    afterFingerprint: row.after_fingerprint,
    beforeQuestion: row.before_question,
    afterQuestion: row.after_question,
    actorEmail: row.actor_email,
    actorRole: row.actor_role,
    source: row.source,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

export interface InsertQuestionMutationInput {
  questionId: string;
  action: string;
  beforeRevision: number;
  afterRevision: number;
  beforeFingerprint: string;
  afterFingerprint: string;
  beforeQuestion: string;
  afterQuestion: string;
  actorEmail: string;
  actorRole: string;
  source: string;
  reason: string | null;
}

/**
 * 新增一筆內容變更紀錄。
 *
 * 刻意**不**做冪等去重：同一批重跑一次就是另一個真實發生的變更事件（版本會再次遞增），
 * 隱藏它反而令歷史不完整。
 */
export function insertQuestionMutation(input: InsertQuestionMutationInput): QuestionMutation {
  const id = newId("qmut");
  const createdAt = nowIso();
  getDb()
    .prepare(
      `INSERT INTO question_mutations
        (id, question_id, action, before_revision, after_revision, before_fingerprint,
         after_fingerprint, before_question, after_question, actor_email, actor_role, source,
         reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.questionId,
      input.action,
      input.beforeRevision,
      input.afterRevision,
      input.beforeFingerprint,
      input.afterFingerprint,
      input.beforeQuestion,
      input.afterQuestion,
      input.actorEmail,
      input.actorRole,
      input.source,
      input.reason,
      createdAt,
    );
  const row = getDb()
    .prepare("SELECT * FROM question_mutations WHERE id = ?")
    .get(id) as unknown as QuestionMutationRow | undefined;
  if (!row) throw new Error("題目變更紀錄寫入失敗");
  return mapMutation(row);
}

/** 指定題目的變更歷史（最新在前） */
export function listQuestionMutations(questionId: string, limit = 20): QuestionMutation[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM question_mutations WHERE question_id = ?
        ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(questionId, limit) as unknown as QuestionMutationRow[];
  return rows.map(mapMutation);
}

/** 指定操作者的變更紀錄（供稽核） */
export function listMutationsByActor(actorEmail: string, limit = 50): QuestionMutation[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM question_mutations WHERE actor_email = ?
        ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(actorEmail, limit) as unknown as QuestionMutationRow[];
  return rows.map(mapMutation);
}
