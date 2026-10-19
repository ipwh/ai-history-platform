/**
 * Golden Dataset v2 的人工核准流程（Sprint 11）。
 *
 * 分工：
 *   - **候選**來自 `docs/teacher-review/golden-candidates-*.json`（唯讀，由
 *     `npm run golden:candidates` 產生）。
 *   - **裁決**寫入 `golden_fixture_reviews`（只新增，不更新或刪除），記錄教師、
 *     伺服器時間、題目版本及內容指紋。
 *   - **approved fixture** 只在「最新裁決為 approved」且「裁決的版本／指紋仍與
 *     目前題目一致」時成立；題目內容改變後舊核准自動失效，必須重新核准。
 *
 * 核准 Golden fixture 不代表題目已可發布，也不會改變任何題目的發布狀態。
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import type { Question } from "../../lib/types";
import { getDb, newId, nowIso } from "../db/connection";
import { getQuestion } from "../repositories/questions";
import { getSection, getTopic } from "../repositories/topics";
import {
  insertGoldenFixtureReview,
  listGoldenFixtureReviews,
  type GoldenFixtureDecision,
  type GoldenFixtureReview,
} from "../repositories/golden-fixtures";
import {
  GOLDEN_CATEGORIES,
  goldenFixtureSchema,
} from "../quality/golden-dataset";
import { questionFingerprint } from "./question-service";
import { checkQuestionServable } from "./question-servability";
import { isAuthorizedHistoryReviewer } from "../auth/history-reviewer";

/**
 * 教師核准 Golden fixture 時必須一併提供的評估內容。
 * 這些是「人工確認的標準答案及預期 grading」，不可由程式推測或代填。
 */
export const goldenFixtureContentSchema = z.object({
  category: z.enum(GOLDEN_CATEGORIES),
  reasoning: z.string().min(8),
  grading: z
    .array(z.object({ answer: z.string().min(1), correct: z.boolean() }))
    .min(1),
  distractorNotes: z.array(z.object({ option: z.string().min(1), why: z.string().min(4) })),
  knownEdgeCases: z.array(z.string()),
  reference: z.string().min(1).nullable(),
  level: z.number().int().positive(),
});

export type GoldenFixtureContent = z.infer<typeof goldenFixtureContentSchema>;

export interface GoldenCandidate {
  group: string;
  selectionReason: string;
  questionId: string;
  questionRevision: number;
  questionFingerprint: string;
  stem: string;
  options: string[];
  correctAnswer: string;
  acceptedAnswers: string[];
  explanation: string;
  servable: boolean;
  evidence: {
    sourceExcerpt: string;
    sourceLocation: string;
    sourceBlockIds: string[];
    hasTraceableDocument: boolean;
  };
}

export interface GoldenCandidateView extends Omit<GoldenCandidate, "questionFingerprint"> {
  /** 目前題目的版本／指紋（可能已與候選清單不同） */
  currentRevision: number | null;
  currentFingerprint: string | null;
  fingerprintMatchesCandidate: boolean;
  latestDecision: {
    decision: GoldenFixtureDecision;
    reason: string;
    reviewerEmail: string;
    createdAt: string;
    revision: number;
    /** 裁決仍對應目前版本且指紋一致 */
    stillValid: boolean;
  } | null;
  /** 依裁決與版本檢查計算的實際狀態 */
  status: "pending-review" | "approved" | "rejected" | "revision-requested" | "stale";
}

export interface GoldenFixture {
  fixtureId: string;
  datasetVersion: string;
  source: { questionId: string; revision: number; fingerprint: string };
  curriculum: { level: number; topicId: string; topicTitle: string; sectionId: string; sectionTitle: string };
  questionType: "mc" | "fill";
  difficulty: string;
  stem: string;
  options: string[];
  correctAnswer: string;
  acceptedAnswers: string[];
  gradingPoints: string[];
  explanation: string;
  evidence: {
    sourceExcerpt: string;
    sourceLocation: string;
    sourceBlockIds: string[];
    reference: string | null;
  };
  reasoning: string;
  distractorNotes: Array<{ option: string; why: string }>;
  category: string;
  skill: string | null;
  reviewStatus: "approved";
  reviewer: string;
  reviewedAt: string;
  reviewNote: string;
  knownEdgeCases: string[];
  expected: { servable: boolean; grading: Array<{ answer: string; correct: boolean }> };
  supersededBy: null;
}

export interface GoldenFixtureExport {
  candidates: GoldenCandidateView[];
  fixtures: GoldenFixture[];
  invalidated: Array<{ questionId: string; reason: string; decision: GoldenFixtureDecision }>;
}

export const GOLDEN_CANDIDATES_PATH = "docs/teacher-review/golden-candidates-2026-10-19.json";

/**
 * Golden 裁決表是否存在（Sprint 13）。
 *
 * 唯讀模式下不會執行 migration，所以「表不存在」是**可回報的狀態**，不是自動修復的訊號：
 * CLI 應據此輸出 `INSUFFICIENT_EVIDENCE`，而不是建立表格。
 */
export function goldenSchemaStatus(): { available: boolean; error: string | null } {
  try {
    getDb().prepare("SELECT 1 FROM golden_fixture_reviews LIMIT 1").get();
    return { available: true, error: null };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function repositoryRoot(): string {
  return process.cwd();
}

export function loadGoldenCandidates(
  filePath = path.join(repositoryRoot(), GOLDEN_CANDIDATES_PATH),
): GoldenCandidate[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `找不到 Golden 候選清單（${path.relative(repositoryRoot(), filePath)}）。請先執行 npm run golden:candidates。`,
    );
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
    groups?: Array<{ group: string; items?: GoldenCandidate[] }>;
  };
  const candidates: GoldenCandidate[] = [];
  for (const group of parsed.groups ?? []) {
    for (const item of group.items ?? []) {
      candidates.push({ ...item, group: group.group });
    }
  }
  return candidates;
}

function currentQuestion(questionId: string): Question | null {
  try {
    return getQuestion(questionId);
  } catch {
    return null;
  }
}

/** 最新裁決是否仍對應目前版本及內容指紋 */
export function isDecisionStillValid(
  review: GoldenFixtureReview,
  question: Question | null,
): boolean {
  if (!question) return false;
  return (
    review.revision === question.revision &&
    review.questionFingerprint === questionFingerprint(question)
  );
}

export function listGoldenCandidateViews(
  candidates = loadGoldenCandidates(),
): GoldenCandidateView[] {
  const reviews = listGoldenFixtureReviews();
  const latest = new Map<string, GoldenFixtureReview>();
  for (const review of reviews) latest.set(review.questionId, review);

  return candidates.map((candidate) => {
    const question = currentQuestion(candidate.questionId);
    const currentRevision = question?.revision ?? null;
    const currentFingerprint = question ? questionFingerprint(question) : null;
    const review = latest.get(candidate.questionId) ?? null;
    const stillValid = review ? isDecisionStillValid(review, question) : false;
    let status: GoldenCandidateView["status"] = "pending-review";
    if (review) {
      if (!stillValid) status = "stale";
      else if (review.decision === "approved") status = "approved";
      else if (review.decision === "rejected") status = "rejected";
      else status = "revision-requested";
    }
    return {
      ...candidate,
      currentRevision,
      currentFingerprint,
      fingerprintMatchesCandidate:
        currentFingerprint !== null && currentFingerprint === candidate.questionFingerprint,
      latestDecision: review
        ? {
            decision: review.decision,
            reason: review.reason,
            reviewerEmail: review.reviewerEmail,
            createdAt: review.createdAt,
            revision: review.revision,
            stillValid,
          }
        : null,
      status,
    };
  });
}

export function recordGoldenFixtureDecision(input: {
  questionId: string;
  decision: GoldenFixtureDecision;
  reason: string;
  expectedRevision: number;
  actor: { email: string; role: string };
  /** 只在 decision = approved 時必填：人工確認的評估內容 */
  fixture?: unknown;
}): { review: GoldenFixtureReview; candidate: GoldenCandidateView | null; created: boolean } {
  if (input.actor.email.trim().length === 0 || input.actor.role.trim().length === 0) {
    throw new GoldenApprovalError("缺少審核者身分", 400);
  }
  // Golden fixture 是「歷史科標準答案」的背書：平台角色（teacher／admin）不足以證明
  // 學科資格，必須在獲授權的歷史科審核者名單內；名單未設定時 fail-closed。
  if (!isAuthorizedHistoryReviewer(input.actor.email)) {
    throw new GoldenApprovalError(
      "未獲授權審核香港歷史科 Golden fixture。此操作需要歷史科教師授權名單（HISTORY_REVIEWER_EMAILS）中的帳戶；" +
        "平台 teacher／admin 角色本身不等於學科審核資格。",
      403,
    );
  }
  const reason = input.reason.trim();
  if (reason.length < 5) throw new GoldenApprovalError("請填寫至少 5 個字的裁決理由", 400);
  const question = currentQuestion(input.questionId);
  if (!question) throw new GoldenApprovalError(`找不到題目 ${input.questionId}`, 404);
  if (input.expectedRevision !== question.revision) {
    throw new GoldenApprovalError(
      `題目已被修改（目前第 ${question.revision} 版，你審核的是第 ${input.expectedRevision} 版），請重新載入後再裁決。`,
      409,
    );
  }

  let payload: GoldenFixtureContent | null = null;
  if (input.decision === "approved") {
    const parsed = goldenFixtureContentSchema.safeParse(input.fixture);
    if (!parsed.success) {
      throw new GoldenApprovalError(
        `核准 Golden fixture 需要教師提供評估內容（${parsed.error.issues
          .map((issue) => issue.path.join("."))
          .join("、")}）。沒有這些資料就不可能重現預期 grading，不能只記錄「核准」。`,
        400,
      );
    }
    payload = parsed.data;
  }

  // 重複提交（同一版本、指紋、決定及理由）不應產生重複裁決列；回傳既有紀錄。
  const latest = listGoldenFixtureReviews(input.questionId).at(-1);
  const fingerprint = questionFingerprint(question);
  const created = !(
    latest &&
    latest.revision === question.revision &&
    latest.questionFingerprint === fingerprint &&
    latest.decision === input.decision &&
    latest.reason === reason
  );
  if (!created && latest) {
    const candidate =
      listGoldenCandidateViews().find((item) => item.questionId === input.questionId) ?? null;
    return { review: latest, candidate, created: false };
  }

  const review = insertGoldenFixtureReview({
    id: newId("golden"),
    questionId: input.questionId,
    revision: question.revision,
    questionFingerprint: questionFingerprint(question),
    decision: input.decision,
    reason,
    reviewerEmail: input.actor.email.trim(),
    reviewerRole: input.actor.role.trim(),
    createdAt: nowIso(),
    payload,
  });

  // 裁決已寫入（不刪除）；這題不在候選清單時仍回傳紀錄，只是沒有候選檢視
  const candidate =
    listGoldenCandidateViews().find((item) => item.questionId === input.questionId) ?? null;
  return { review, candidate, created: true };
}

/** 需要 HTTP 狀態碼的 Golden 流程錯誤（由 route 轉成 API 回應） */
export class GoldenApprovalError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GoldenApprovalError";
  }
}

/**
 * 由裁決紀錄匯出 approved fixture。
 *
 * 只有「最新裁決為 approved」、「版本／指紋仍與目前題目一致」而且「教師提供的評估
 * 內容通過 goldenFixtureSchema」的候選才會成為 fixture；其餘列入 invalidated 並
 * 說明原因。沒有任何真實教師核准時，結果必然是 0 個 fixture。
 */
export function exportGoldenFixtures(
  candidates = loadGoldenCandidates(),
  datasetVersion = "2026-10-19.1",
): GoldenFixtureExport {
  const views = listGoldenCandidateViews(candidates);
  const fixtures: GoldenFixture[] = [];
  const invalidated: GoldenFixtureExport["invalidated"] = [];

  for (const view of views) {
    if (!view.latestDecision) continue;
    if (!view.latestDecision.stillValid) {
      invalidated.push({
        questionId: view.questionId,
        decision: view.latestDecision.decision,
        reason: "題目版本或內容指紋已改變，舊裁決失效",
      });
      continue;
    }
    if (view.latestDecision.decision !== "approved") continue;
    const question = currentQuestion(view.questionId);
    const review = listGoldenFixtureReviews(view.questionId).at(-1);
    if (!question || !review?.payload) {
      invalidated.push({
        questionId: view.questionId,
        decision: "approved",
        reason: question ? "裁決沒有教師提供的評估內容" : "找不到題目",
      });
      continue;
    }
    const content = goldenFixtureContentSchema.safeParse(review.payload);
    if (!content.success) {
      invalidated.push({
        questionId: view.questionId,
        decision: "approved",
        reason: "教師提供的評估內容不完整，無法匯出可重現的 fixture",
      });
      continue;
    }
    const topic = getTopic(question.topicId);
    const section = question.sectionId ? getSection(question.sectionId) : null;
    const fixture: GoldenFixture = {
      fixtureId: `golden-${question.id}-r${question.revision}`,
      datasetVersion,
      source: {
        questionId: question.id,
        revision: question.revision,
        fingerprint: questionFingerprint(question),
      },
      curriculum: {
        level: content.data.level,
        topicId: question.topicId,
        topicTitle: topic?.title ?? question.topicId,
        sectionId: question.sectionId,
        sectionTitle: section?.title ?? question.sectionId,
      },
      questionType: question.questionType,
      difficulty: question.difficulty,
      stem: question.question,
      options: question.options,
      correctAnswer: question.correctAnswer,
      acceptedAnswers: question.acceptedAnswers,
      gradingPoints: question.gradingPoints,
      explanation: question.explanation,
      evidence: {
        ...view.evidence,
        reference: content.data.reference,
      },
      reasoning: content.data.reasoning,
      distractorNotes: content.data.distractorNotes,
      category: content.data.category,
      skill: question.skill ?? null,
      reviewStatus: "approved",
      reviewer: review.reviewerEmail,
      reviewedAt: review.createdAt,
      reviewNote: review.reason,
      knownEdgeCases: content.data.knownEdgeCases,
      expected: {
        servable: checkQuestionServable(question).ok,
        grading: content.data.grading,
      },
      supersededBy: null,
    };
    const validated = goldenFixtureSchema.safeParse(fixture);
    if (!validated.success) {
      invalidated.push({
        questionId: view.questionId,
        decision: "approved",
        reason: `fixture 未通過 schema 驗證：${validated.error.issues
          .map((issue) => issue.path.join("."))
          .join("、")}`,
      });
      continue;
    }
    fixtures.push(fixture);
  }

  return { candidates: views, fixtures, invalidated };
}
