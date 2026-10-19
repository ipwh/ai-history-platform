/**
 * 唯讀內容稽核（來源可追溯性、解釋品質、元數據、政策分類）。
 *
 * 這個模組只讀取資料庫，不寫入任何題目、覆核或發布狀態；CLI
 * (`scripts/audit-content-quality.ts`) 只負責輸出 JSON／Markdown。
 *
 * 穩定輸出：題目按 ID 排序、問題代碼排序，並附 inputFingerprint（內容＋版本＋指紋的
 * SHA-256），令相同資料重跑可得相同指紋，方便比較。
 */
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import type { Question } from "../../lib/types";
import { questionFingerprint } from "../services/question-service";
import { checkQuestionServable } from "../services/question-servability";
import {
  classifyExplanation,
  type ExplanationClass,
  type ExplanationQualityResult,
} from "./explanation-quality";
import {
  assessMetadata,
  type MetadataCode,
  type MetadataQualityResult,
  type MetadataSeverity,
} from "./metadata-quality";
import {
  evaluateQuestionPolicy,
  POLICY_CATEGORIES,
  type PolicyCategory,
} from "./question-policy";
import { classifyReviewKind } from "./review-provenance";
import {
  classifySourceTraceability,
  SOURCE_TRACEABILITY_STATUSES,
  type SourceTraceabilityResult,
  type SourceTraceabilityStatus,
} from "./source-traceability";

type QuestionRow = {
  id: string;
  topic_id: string;
  section_id: string | null;
  question_type: string;
  difficulty: string;
  skill: string | null;
  question: string;
  options_json: string | null;
  correct_answer: string;
  accepted_answers_json: string | null;
  explanation: string | null;
  knowledge_point: string;
  source_excerpt: string | null;
  source_location: string | null;
  source_block_ids_json: string | null;
  grading_points_json: string | null;
  origin: string;
  status: string;
  source_verified: number;
  quality_warnings_json: string | null;
  revision: number;
  teacher_confirmation_required: number;
};

type ReviewRow = {
  question_id: string;
  revision: number;
  decision: string;
  reviewer_role: string;
  question_fingerprint: string;
  reason: string | null;
};

type TopicRow = { id: string; title: string };
type SectionRow = { id: string; topic_id: string; title: string };
type DocumentRow = { id: string; status: string; student_distribution: number; rights_confirmed_at: string | null };
type BlockRow = { id: string; document_id: string };

export interface AuditedQuestion {
  id: string;
  revision: number;
  topicId: string;
  sectionId: string | null;
  status: string;
  teacherConfirmationRequired: boolean;
  servable: boolean;
  servabilityReason: string;
  source: SourceTraceabilityResult;
  explanation: ExplanationQualityResult;
  metadata: MetadataQualityResult;
  policy: ReturnType<typeof evaluateQuestionPolicy>;
  reviewEvidence: {
    human: boolean;
    teacher: boolean;
    ownerBatch: boolean;
    automation: boolean;
  };
}

export interface ContentAuditPayload {
  generatedAt: string;
  inputFingerprint: string;
  totals: {
    questions: number;
    published: number;
    teacherConfirmationRequired: number;
    notServable: number;
    releasable: number;
    canServe: number;
  };
  source: {
    counts: Record<SourceTraceabilityStatus, number>;
    missingDocumentRecord: number;
    missingQuestionNumber: number;
    missingSourceHash: number;
    hasImportBatch: 0;
    staleBlockReferences: number;
    byOrigin: Record<string, Record<SourceTraceabilityStatus, number>>;
  };
  explanation: {
    counts: Record<ExplanationClass, number>;
    reviewedButLowQuality: number;
    automationApprovalsRecordedAsHuman: number;
    unknownReviewOrigin: number;
    byTopic: Record<string, Record<ExplanationClass, number>>;
  };
  metadata: {
    byCode: Partial<Record<MetadataCode, number>>;
    bySeverity: Record<MetadataSeverity, number>;
    skillMissing: number;
    difficulty: Record<string, number>;
    blockingReferences: number;
  };
  policy: {
    byCategory: Record<PolicyCategory, number>;
    questionsWithHardBlock: number;
    questionsWithTeacherReview: number;
    questionsReleasable: number;
  };
  questions: AuditedQuestion[];
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function toQuestion(row: QuestionRow): Question {
  return {
    id: row.id,
    topicId: row.topic_id,
    sectionId: row.section_id ?? "",
    questionType: row.question_type,
    difficulty: row.difficulty,
    question: row.question,
    options: parseJsonArray(row.options_json),
    correctAnswer: row.correct_answer,
    acceptedAnswers: parseJsonArray(row.accepted_answers_json),
    explanation: row.explanation ?? "",
    knowledgePoint: row.knowledge_point,
    sourceExcerpt: row.source_excerpt ?? "",
    sourceLocation: row.source_location ?? "",
    sourceBlockIds: parseJsonArray(row.source_block_ids_json),
    gradingPoints: parseJsonArray(row.grading_points_json),
    origin: row.origin,
    status: row.status,
    sourceVerified: row.source_verified !== 0,
    qualityWarnings: parseJsonArray(row.quality_warnings_json),
    skill: row.skill,
    revision: row.revision,
    autoValidatedAt: null,
    autoValidatedRevision: null,
    autoValidatedFingerprint: null,
    teacherConfirmationRequired: row.teacher_confirmation_required !== 0,
    createdAt: "",
  } as unknown as Question;
}

export function loadContentAudit(databasePath: string): ContentAuditPayload {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = db
      .prepare("SELECT * FROM questions ORDER BY id ASC")
      .all() as unknown as QuestionRow[];
    const blocks = db
      .prepare("SELECT id, document_id FROM material_blocks")
      .all() as unknown as BlockRow[];
    const documents = db
      .prepare("SELECT id, status, student_distribution, rights_confirmed_at FROM material_documents")
      .all() as unknown as DocumentRow[];
    const topics = db
      .prepare("SELECT id, title FROM topics")
      .all() as unknown as TopicRow[];
    const sections = db
      .prepare("SELECT id, topic_id, title FROM sections")
      .all() as unknown as SectionRow[];
    const reviews = db
      .prepare(
        "SELECT question_id, revision, decision, reviewer_role, question_fingerprint, reason FROM question_reviews",
      )
      .all() as unknown as ReviewRow[];

    const blockIds = new Set(blocks.map((block) => block.id));
    const documentIds = new Set(documents.map((document) => document.id));
    const blockDocument = new Map(blocks.map((block) => [block.id, block.document_id]));
    const topicIds = new Set(topics.map((topic) => topic.id));
    const sectionById = new Map(sections.map((section) => [section.id, section]));
    const sectionTitlesByTopic = new Map<string, string[]>();
    for (const section of sections) {
      const list = sectionTitlesByTopic.get(section.topic_id) ?? [];
      list.push(section.title);
      sectionTitlesByTopic.set(section.topic_id, list);
    }

    const humanReviewKeys = new Set<string>();
    const reviewKindsByKey = new Map<string, Set<"teacher_adjudication" | "owner_batch" | "automation_repair">>();
    let automationRecordedAsHuman = 0;
    let unknownReviewOrigin = 0;
    for (const review of reviews) {
      const key = `${review.question_id}#${review.revision}#${review.question_fingerprint}`;
      const kind = classifyReviewKind(review.reviewer_role, review.reason);
      if (kind !== "unknown") {
        const kinds = reviewKindsByKey.get(key) ?? new Set();
        kinds.add(kind);
        reviewKindsByKey.set(key, kinds);
      }
      if (review.decision !== "approved") continue;
      if (kind === "automation_repair") {
        if (review.reviewer_role !== "automation") automationRecordedAsHuman += 1;
      } else if (kind === "unknown") {
        unknownReviewOrigin += 1;
      } else {
        // 教師裁決（teacher_adjudication）及擁有者批次（owner_batch）都屬人類紀錄；
        // 批次授權不是逐題教師覆核，但仍是人類決定，兩者以 kind 另行區分。
        humanReviewKeys.add(key);
      }
    }

    const questions: AuditedQuestion[] = [];
    const sourceCounts = Object.fromEntries(
      SOURCE_TRACEABILITY_STATUSES.map((status) => [status, 0]),
    ) as Record<SourceTraceabilityStatus, number>;
    const sourceByOrigin: Record<string, Record<SourceTraceabilityStatus, number>> = {};
    const explanationCounts = Object.fromEntries(
      ["placeholder", "answer_only", "insufficient", "potentially_inconsistent", "not_assessed"].map(
        (name) => [name, 0],
      ),
    ) as Record<ExplanationClass, number>;
    const explanationByTopic: Record<string, Record<ExplanationClass, number>> = {};
    const metadataByCode: Partial<Record<MetadataCode, number>> = {};
    const metadataBySeverity: Record<MetadataSeverity, number> = {
      blocking: 0,
      needs_review: 0,
      warning: 0,
    };
    const policyByCategory = Object.fromEntries(
      POLICY_CATEGORIES.map((category) => [category, 0]),
    ) as Record<PolicyCategory, number>;

    let missingDocumentRecord = 0;
    let missingQuestionNumber = 0;
    let missingSourceHash = 0;
    let staleBlockReferences = 0;
    let reviewedButLowQuality = 0;
    let notServable = 0;
    let releasable = 0;
    let canServe = 0;
    let blockingReferences = 0;
    let teacherConfirmationRequired = 0;
    let published = 0;
    const difficulty: Record<string, number> = {};
    const fingerprints = new Map<string, string>();

    for (const row of rows) {
      const question = toQuestion(row);
      const fingerprint = questionFingerprint(question);
      fingerprints.set(row.id, fingerprint);
      const humanReviewed = humanReviewKeys.has(`${row.id}#${row.revision}#${fingerprint}`);
      const servability = checkQuestionServable(question);
      const blockResolutions = question.sourceBlockIds.map((blockId) => ({
        blockId,
        blockExists: blockIds.has(blockId),
        documentExists: blockIds.has(blockId) && documentIds.has(blockDocument.get(blockId) ?? ""),
      }));
      const source = classifySourceTraceability({
        origin: row.origin,
        sourceLocation: row.source_location ?? "",
        sourceBlockIds: question.sourceBlockIds,
        sourceVerified: row.source_verified !== 0,
        blockResolutions,
      });
      const explanation = classifyExplanation({
        explanation: row.explanation ?? "",
        correctAnswer: row.correct_answer,
        acceptedAnswers: question.acceptedAnswers,
        options: question.options,
        hasHumanReview: humanReviewed,
      });
      const metadata = assessMetadata({
        topicId: row.topic_id,
        sectionId: row.section_id ?? "",
        knowledgePoint: row.knowledge_point,
        difficulty: row.difficulty,
        skill: row.skill,
        topicExists: topicIds.has(row.topic_id),
        sectionExists: row.section_id !== null && sectionById.has(row.section_id),
        sectionTopicId: row.section_id ? (sectionById.get(row.section_id)?.topic_id ?? null) : null,
        sectionTitles: sectionTitlesByTopic.get(row.topic_id) ?? [],
      });
      const policy = evaluateQuestionPolicy({
        teacherConfirmationRequired: row.teacher_confirmation_required !== 0,
        servability: { ok: servability.ok, reason: servability.ok ? undefined : servability.reason },
        source,
        explanation,
        metadata,
      });
      const reviewKinds = reviewKindsByKey.get(`${row.id}#${row.revision}#${fingerprint}`);
      const reviewEvidence = {
        human:
          (reviewKinds?.has("teacher_adjudication") ?? false) ||
          (reviewKinds?.has("owner_batch") ?? false),
        teacher: reviewKinds?.has("teacher_adjudication") ?? false,
        ownerBatch: reviewKinds?.has("owner_batch") ?? false,
        automation: reviewKinds?.has("automation_repair") ?? false,
      };

      questions.push({
        id: row.id,
        revision: row.revision,
        topicId: row.topic_id,
        sectionId: row.section_id,
        status: row.status,
        teacherConfirmationRequired: row.teacher_confirmation_required !== 0,
        servable: servability.ok,
        servabilityReason: servability.ok ? "" : (servability.reason ?? ""),
        source,
        explanation,
        metadata,
        policy,
        reviewEvidence,
      });

      sourceCounts[source.status] += 1;
      const originCounts = (sourceByOrigin[row.origin] ??= Object.fromEntries(
        SOURCE_TRACEABILITY_STATUSES.map((status) => [status, 0]),
      ) as Record<SourceTraceabilityStatus, number>);
      originCounts[source.status] += 1;

      if (!source.evidence.hasDocumentRecord) missingDocumentRecord += 1;
      if (!source.evidence.hasQuestionNumber) missingQuestionNumber += 1;
      if (!source.evidence.hasSourceHash) missingSourceHash += 1;
      if (source.codes.includes("SOURCE_BLOCK_MISSING")) staleBlockReferences += 1;

      explanationCounts[explanation.class] += 1;
      const topicExplanation = (explanationByTopic[row.topic_id] ??= Object.fromEntries(
        ["placeholder", "answer_only", "insufficient", "potentially_inconsistent", "not_assessed"].map(
          (name) => [name, 0],
        ),
      ) as Record<ExplanationClass, number>);
      topicExplanation[explanation.class] += 1;
      if (explanation.codes.includes("EXPLANATION_REVIEWED_BUT_LOW_QUALITY")) {
        reviewedButLowQuality += 1;
      }

      for (const issue of metadata.issues) {
        metadataByCode[issue.code] = (metadataByCode[issue.code] ?? 0) + 1;
        metadataBySeverity[issue.severity] += 1;
        if (issue.severity === "blocking") blockingReferences += 1;
      }

      for (const finding of policy.findings) policyByCategory[finding.category] += 1;
      if (!policy.canServe) notServable += 1;
      if (policy.releasable) releasable += 1;
      if (policy.canServe) canServe += 1;

      if (row.status === "published") published += 1;
      if (row.teacher_confirmation_required !== 0) teacherConfirmationRequired += 1;
      difficulty[row.difficulty] = (difficulty[row.difficulty] ?? 0) + 1;
    }

    const inputFingerprint = createHash("sha256")
      .update(
        questions
          .map((question) => `${question.id}:${question.revision}:${fingerprints.get(question.id) ?? ""}`)
          .join("\n"),
      )
      .digest("hex");

    return {
      generatedAt: new Date().toISOString(),
      inputFingerprint,
      totals: {
        questions: questions.length,
        published,
        teacherConfirmationRequired,
        notServable,
        releasable,
        canServe,
      },
      source: {
        counts: sourceCounts,
        missingDocumentRecord,
        missingQuestionNumber,
        missingSourceHash,
        hasImportBatch: 0,
        staleBlockReferences,
        byOrigin: sourceByOrigin,
      },
      explanation: {
        counts: explanationCounts,
        reviewedButLowQuality,
        automationApprovalsRecordedAsHuman: automationRecordedAsHuman,
        unknownReviewOrigin,
        byTopic: explanationByTopic,
      },
      metadata: {
        byCode: metadataByCode,
        bySeverity: metadataBySeverity,
        skillMissing: metadataByCode.SKILL_MISSING ?? 0,
        difficulty,
        blockingReferences,
      },
      policy: {
        byCategory: policyByCategory,
        questionsWithHardBlock: notServable,
        questionsWithTeacherReview: questions.filter((question) =>
          question.policy.findings.some((finding) => finding.category === "teacher_review"),
        ).length,
        questionsReleasable: releasable,
      },
      questions,
    };
  } finally {
    db.close();
  }
}
