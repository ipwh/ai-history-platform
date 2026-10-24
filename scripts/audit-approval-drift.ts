/**
 * 舊版批准 vs 現行內容的取證（Sprint 27，唯讀）。
 *
 * 問題：3,205 道已發布題目中，1,372 道（全部 `school-paper`）只有**舊 revision** 的
 * `approved` 覆核。要判斷「舊批准可否覆蓋現行版本」，必須先回答一個事實問題：
 * **現行內容是否仍是教師當初批准的那一版？**
 *
 * 方法：`questionFingerprint` 涵蓋分節、題型、難度、題幹、選項、正確答案、可接受寫法、
 * 解釋、知識點、技能。以「最近一次 approved 覆核」儲存的指紋與現行內容重算的指紋比對：
 *   - 相同 → 內容未改動（revision 只因非內容欄位而遞增）；
 *   - 不同 → 內容確實已改動。
 *
 * 並與 `question_content_flags` 交叉核對，找出改動的來源（例：`explanation_rewritten`）。
 *
 * 本工具**不判定**舊批准是否可覆蓋現行版本——那是歷史科主任的政策決定。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { questionFingerprint } from "../src/server/quality/question-fingerprint";

interface QuestionRow {
  id: string;
  topic_id: string;
  section_id: string | null;
  question_type: string;
  difficulty: string;
  question: string;
  options_json: string | null;
  correct_answer: string;
  accepted_answers_json: string | null;
  explanation: string;
  knowledge_point: string;
  grading_points_json: string | null;
  skill: string | null;
  origin: string;
  revision: number;
  status: string;
  auto_validated_revision: number | null;
}

interface ReviewRow {
  question_id: string;
  revision: number;
  question_fingerprint: string;
  created_at: string;
}

type Bucket =
  | "approvedAtCurrentRevision"
  | "autoValidatedOnly"
  | "staleApprovalContentIdentical"
  | "staleApprovalContentDiffers"
  | "neverApproved";

const parseArray = (raw: string | null): string[] => {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
};

/** 只傳入影響指紋的欄位；`questionFingerprint` 需要完整 Question，故以結構斷言傳入。 */
function fingerprintOf(row: QuestionRow): string {
  return questionFingerprint({
    topicId: row.topic_id,
    sectionId: row.section_id,
    questionType: row.question_type,
    difficulty: row.difficulty,
    question: row.question,
    options: parseArray(row.options_json),
    correctAnswer: row.correct_answer,
    acceptedAnswers: parseArray(row.accepted_answers_json),
    explanation: row.explanation,
    knowledgePoint: row.knowledge_point,
    gradingPoints: parseArray(row.grading_points_json),
    skill: row.skill,
  } as unknown as Parameters<typeof questionFingerprint>[0]);
}

const repo = process.cwd();
const databasePath = path.resolve(repo, "data", "app.db");
if (!fs.existsSync(databasePath)) throw new Error(`找不到資料庫：${databasePath}`);
const db = new DatabaseSync(databasePath, { readOnly: true });

const questions = db
  .prepare(
    `SELECT id, topic_id, section_id, question_type, difficulty, question, options_json,
            correct_answer, accepted_answers_json, explanation, knowledge_point,
            grading_points_json, skill, origin, revision, status, auto_validated_revision
       FROM questions WHERE status = 'published'`,
  )
  .all() as unknown as QuestionRow[];
const reviews = db
  .prepare(
    `SELECT question_id, revision, question_fingerprint, created_at
       FROM question_reviews WHERE decision = 'approved' ORDER BY created_at ASC, rowid ASC`,
  )
  .all() as unknown as ReviewRow[];
const rewrittenFlags = new Set(
  (
    db
      .prepare(
        "SELECT question_id FROM question_content_flags WHERE flag = 'explanation_rewritten' AND state = 'open'",
      )
      .all() as unknown as { question_id: string }[]
  ).map((row) => row.question_id),
);
db.close();

const approvedByQuestion = new Map<string, ReviewRow[]>();
for (const review of reviews) {
  const list = approvedByQuestion.get(review.question_id) ?? [];
  list.push(review);
  approvedByQuestion.set(review.question_id, list);
}

const emptyBuckets = (): Record<Bucket, number> => ({
  approvedAtCurrentRevision: 0,
  autoValidatedOnly: 0,
  staleApprovalContentIdentical: 0,
  staleApprovalContentDiffers: 0,
  neverApproved: 0,
});

const buckets = emptyBuckets();
const byOrigin: Record<string, Record<Bucket, number>> = {};
const driftSource = {
  inExplanationRewriteFlagSet: 0,
  notInFlagSet: 0,
  notInFlagSetExamples: [] as string[],
};

for (const question of questions) {
  const originBuckets = byOrigin[question.origin] ?? emptyBuckets();
  byOrigin[question.origin] = originBuckets;
  const bump = (bucket: Bucket): void => {
    buckets[bucket] += 1;
    originBuckets[bucket] += 1;
  };

  const approved = approvedByQuestion.get(question.id) ?? [];
  if (approved.some((review) => review.revision === question.revision)) {
    bump("approvedAtCurrentRevision");
    continue;
  }
  const latest = approved[approved.length - 1];
  if (latest === undefined) {
    if (question.auto_validated_revision === question.revision) bump("autoValidatedOnly");
    else bump("neverApproved");
    continue;
  }
  if (fingerprintOf(question) === latest.question_fingerprint) {
    bump("staleApprovalContentIdentical");
    continue;
  }
  bump("staleApprovalContentDiffers");
  if (rewrittenFlags.has(question.id)) driftSource.inExplanationRewriteFlagSet += 1;
  else {
    driftSource.notInFlagSet += 1;
    if (driftSource.notInFlagSetExamples.length < 5) {
      driftSource.notInFlagSetExamples.push(question.id);
    }
  }
}

console.log(
  JSON.stringify(
    {
      database: databasePath,
      published: questions.length,
      approvedReviews: reviews.length,
      explanationRewrittenFlagged: rewrittenFlags.size,
      buckets,
      byOrigin,
      staleApprovalDriftSource: driftSource,
      interpretation: [
        "buckets 是事實分類，不是批准判斷。",
        "staleApprovalContentIdentical＝內容未改動，但批准仍綁在舊 revision（政策問題）。",
        "staleApprovalContentDiffers＝內容確實已改動；若集中於 explanation_rewritten 旗標，",
        "則屬解釋重寫計劃而非題幹／答案改動，但現行版本仍須教師重新確認。",
      ],
    },
    null,
    2,
  ),
);
