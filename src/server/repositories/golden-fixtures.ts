import { getDb } from "../db/connection";

export type GoldenFixtureDecision = "approved" | "rejected" | "revision_requested";

export interface GoldenFixtureReview {
  id: string;
  questionId: string;
  revision: number;
  questionFingerprint: string;
  decision: GoldenFixtureDecision;
  reason: string;
  reviewerEmail: string;
  reviewerRole: string;
  createdAt: string;
  /** 教師在核准時提供的評估內容（category、reasoning、預期 grading 等） */
  payload: unknown;
}

type Row = {
  id: string;
  question_id: string;
  revision: number;
  question_fingerprint: string;
  decision: string;
  reason: string;
  reviewer_email: string;
  reviewer_role: string;
  created_at: string;
  payload_json: string | null;
};

function mapRow(row: Row): GoldenFixtureReview {
  return {
    id: row.id,
    questionId: row.question_id,
    revision: row.revision,
    questionFingerprint: row.question_fingerprint,
    decision: row.decision as GoldenFixtureDecision,
    reason: row.reason,
    reviewerEmail: row.reviewer_email,
    reviewerRole: row.reviewer_role,
    createdAt: row.created_at,
    payload: row.payload_json ? (JSON.parse(row.payload_json) as unknown) : null,
  };
}

/** 只新增，不更新、不刪除：Golden fixture 的裁決是可稽核的事件紀錄 */
export function insertGoldenFixtureReview(review: GoldenFixtureReview): GoldenFixtureReview {
  getDb()
    .prepare(
      `INSERT INTO golden_fixture_reviews
        (id, question_id, revision, question_fingerprint, decision, reason,
         reviewer_email, reviewer_role, created_at, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      review.id,
      review.questionId,
      review.revision,
      review.questionFingerprint,
      review.decision,
      review.reason,
      review.reviewerEmail,
      review.reviewerRole,
      review.createdAt,
      review.payload === null || review.payload === undefined
        ? null
        : JSON.stringify(review.payload),
    );
  return review;
}

export function listGoldenFixtureReviews(questionId?: string): GoldenFixtureReview[] {
  const rows = questionId
    ? (getDb()
        .prepare(
          "SELECT * FROM golden_fixture_reviews WHERE question_id = ? ORDER BY created_at ASC, rowid ASC",
        )
        .all(questionId) as unknown as Row[])
    : (getDb()
        .prepare("SELECT * FROM golden_fixture_reviews ORDER BY created_at ASC, rowid ASC")
        .all() as unknown as Row[]);
  return rows.map(mapRow);
}

/** 每題最新一筆裁決（`created_at` 相同時以寫入次序為準） */
export function latestGoldenFixtureReviews(): Map<string, GoldenFixtureReview> {
  const latest = new Map<string, GoldenFixtureReview>();
  for (const review of listGoldenFixtureReviews()) latest.set(review.questionId, review);
  return latest;
}
