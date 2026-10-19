/**
 * 發布閘門執行器：收集唯讀證據，交由 `evaluateReleaseGates()` 判斷。
 * 不修改題庫、覆核或發布狀態。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { loadContentAudit, type ContentAuditPayload } from "./content-audit";
import {
  evaluateReleaseGates,
  type ReleaseGateReport,
} from "./release-gates";

export interface ReleaseGateOptions {
  repoRoot: string;
  databasePath: string;
  /** 測試證據檔（由 release 流程寫入）；不存在時閘門為證據不足。 */
  testsEvidencePath?: string;
  deploymentEvidencePath?: string;
  goldenPath?: string;
  provenancePath?: string;
  contentQueuePath?: string;
}

export interface ReleaseGateRun {
  report: ReleaseGateReport;
  audit: ContentAuditPayload;
  sources: {
    database: string;
    testsEvidence: string | null;
    deploymentEvidence: string | null;
    golden: string | null;
    provenance: string | null;
    contentQueue: string | null;
    servabilityEvidence: string | null;
    provenanceRisk: string | null;
    goldenCandidates: string | null;
  };
}

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

export function runReleaseGate(options: ReleaseGateOptions): ReleaseGateRun {
  const repoRoot = options.repoRoot;
  const databasePath = options.databasePath;
  const testsEvidencePath =
    options.testsEvidencePath ?? path.join(repoRoot, "docs", "release-evidence-2026-10-19.json");
  const deploymentEvidencePath =
    options.deploymentEvidencePath ??
    path.join(repoRoot, "docs", "deployment-evidence-2026-10-19.json");
  const goldenPath =
    options.goldenPath ??
    path.join(repoRoot, "docs", "teacher-review", "golden-questions.v2.json");
  const goldenV1Path = path.join(
    repoRoot,
    "docs",
    "teacher-review",
    "golden-questions.v1.json",
  );
  const servabilityPath = path.join(
    repoRoot,
    "docs",
    "quality",
    "servability-remediation-2026-10-19.json",
  );
  const provenancePath =
    options.provenancePath ??
    path.join(repoRoot, "docs", "teacher-review", "repair-provenance-2026-10-19.json");
  const contentQueuePath =
    options.contentQueuePath ??
    path.join(repoRoot, "docs", "teacher-review", "content-quality-queue-2026-10-19.json");

  const audit = loadContentAudit(databasePath);
  const auditById = new Map(audit.questions.map((question) => [question.id, question]));

  const provenance = readJson<{ affectedQuestionIds?: string[]; affected?: { id: string }[] }>(
    provenancePath,
  );
  const affectedIds = provenance
    ? (provenance.affectedQuestionIds ?? provenance.affected?.map((item) => item.id) ?? [])
    : [];
  const unresolved = affectedIds.filter((id) => {
    const question = auditById.get(id);
    return question !== undefined && question.teacherConfirmationRequired;
  }).length;

  const goldenV2 = readJson<{
    datasetVersion?: string;
    questions?: { reviewStatus?: string }[];
  }>(goldenPath);
  const goldenV1 = goldenV2
    ? null
    : readJson<{
        questions?: { reviewerDecision?: string }[];
      }>(goldenV1Path);
  const goldenQuestions = goldenV2?.questions ?? goldenV1?.questions ?? [];
  const goldenReviewed = goldenV2
    ? (goldenV2.questions ?? []).filter((item) => item.reviewStatus === "approved").length
    : (goldenV1?.questions ?? []).filter((item) =>
        ["approved", "rejected"].includes(item.reviewerDecision ?? ""),
      ).length;

  const servability = readJson<{ byIssueCode?: Record<string, number> }>(servabilityPath);
  const servabilityEvidencePath = path.join(
    repoRoot,
    "docs",
    "quality",
    "servability-evidence-2026-10-19.json",
  );
  const servabilityEvidence = readJson<{
    totals?: { checked?: number; labelsOnlyCandidates?: number; labelsPresent?: number };
  }>(servabilityEvidencePath);
  const provenanceRiskPath = path.join(
    repoRoot,
    "docs",
    "quality",
    "provenance-risk-2026-10-19.json",
  );
  const provenanceRisk = readJson<{
    byTier?: { P0?: number; P1?: number; P2?: number; P3?: number };
  }>(provenanceRiskPath);
  const goldenCandidatesPath = path.join(
    repoRoot,
    "docs",
    "teacher-review",
    "golden-candidates-2026-10-19.json",
  );
  const goldenCandidates = readJson<{ groups?: { items?: unknown[] }[] }>(goldenCandidatesPath);
  const goldenCandidateCount =
    goldenCandidates?.groups?.reduce((sum, group) => sum + (group.items?.length ?? 0), 0) ?? 0;

  const testsEvidence = readJson<{
    failures?: number;
    skipped?: number;
    commands?: string[];
  }>(testsEvidencePath);

  const deploymentEvidence = readJson<{ notes?: string[] }>(deploymentEvidencePath);
  const contentQueue = readJson<{
    categories?: { id: string; count?: number }[];
  }>(contentQueuePath);
  const previousCategory = (id: string): number =>
    contentQueue?.categories?.find((category) => category.id === id)?.count ?? 0;

  const db = new DatabaseSync(databasePath, { readOnly: true });
  let pendingCurrentRevision = 0;
  let openReports = 0;
  let documents = 0;
  let distributable = 0;
  let rightsRecorded = 0;
  let servabilityTeacherDecisions = 0;
  let goldenApprovedDecisions = 0;
  let goldenStaleApprovals = 0;
  let goldenDecidedCurrent = 0;
  try {
    openReports = (
      db.prepare("SELECT COUNT(*) AS c FROM question_reports WHERE status = 'open'").get() as {
        c: number;
      }
    ).c;

    const returnedRows = db
      .prepare(
        `SELECT q.id AS id
         FROM questions q
         JOIN question_reviews r
           ON r.question_id = q.id AND r.revision = q.revision
         WHERE r.decision = 'returned' AND q.status = 'draft'
         GROUP BY q.id`,
      )
      .all() as { id: string }[];
    pendingCurrentRevision = returnedRows.length;

    const documentRows = db
      .prepare(
        "SELECT student_distribution, rights_confirmed_at FROM material_documents",
      )
      .all() as { student_distribution: number; rights_confirmed_at: string | null }[];
    documents = documentRows.length;
    distributable = documentRows.filter((row) => row.student_distribution === 1).length;
    rightsRecorded = documentRows.filter((row) => row.rights_confirmed_at !== null).length;

    // Sprint 11：結構不可作答題目中，已有「結構裁決」紀錄且對應目前版本者
    servabilityTeacherDecisions = (
      db
        .prepare(
          `SELECT COUNT(DISTINCT q.id) AS c
           FROM questions q
           JOIN question_reviews r
             ON r.question_id = q.id AND r.revision = q.revision
           WHERE r.reason LIKE '結構裁決%'`,
        )
        .get() as { c: number }
    ).c;

    // Sprint 11：Golden fixture 裁決（只計最新一筆；版本不同即視為失效）
    // 舊資料庫可能尚未套用 0022 migration；此時視為沒有裁決，不偽造證據。
    let goldenRows: {
      question_id: string;
      decision: string;
      revision: number;
      current_revision: number;
    }[] = [];
    try {
      goldenRows = db
        .prepare(
          `SELECT g.question_id AS question_id, g.decision AS decision, g.revision AS revision,
                  q.revision AS current_revision
           FROM golden_fixture_reviews g
           JOIN questions q ON q.id = g.question_id
           ORDER BY g.created_at ASC, g.rowid ASC`,
        )
        .all() as typeof goldenRows;
    } catch {
      goldenRows = [];
    }
    const latestGolden = new Map<string, (typeof goldenRows)[number]>();
    for (const row of goldenRows) latestGolden.set(row.question_id, row);
    for (const row of latestGolden.values()) {
      if (row.revision === row.current_revision) goldenDecidedCurrent += 1;
      if (row.decision !== "approved") continue;
      if (row.revision === row.current_revision) goldenApprovedDecisions += 1;
      else goldenStaleApprovals += 1;
    }
  } finally {
    db.close();
  }

  const report = evaluateReleaseGates({
    audit,
    answerProvenance: { affected: affectedIds.length, unresolved, reportFound: provenance !== null },
    teacherDecisions: { pendingCurrentRevision, openReports },    reviewProvenance: {
      teacherAdjudicated: audit.questions.filter((question) => question.reviewEvidence.teacher)
        .length,
      ownerBatchOnly: audit.questions.filter(
        (question) => question.reviewEvidence.human && !question.reviewEvidence.teacher,
      ).length,
      automationOnly: audit.questions.filter(
        (question) => !question.reviewEvidence.human && question.reviewEvidence.automation,
      ).length,
      noEvidence: audit.questions.filter(
        (question) => !question.reviewEvidence.human && !question.reviewEvidence.automation,
      ).length,
    },
    servabilityIssues: servability?.byIssueCode ?? {},
    servabilityAdjudication: {
      unservable: audit.questions.filter(
        (question) => question.status === "published" && !question.servable,
      ).length,
      originalEvidenceChecked: servabilityEvidence?.totals?.checked ?? 0,
      labelsOnlyRepairCandidates: servabilityEvidence?.totals?.labelsOnlyCandidates ?? 0,
      teacherDecisions: servabilityTeacherDecisions,
      awaitingTeacherDecision: Math.max(
        0,
        audit.questions.filter((question) => question.status === "published" && !question.servable)
          .length - servabilityTeacherDecisions,
      ),
    },
    provenanceRisk: {
      reportFound: provenanceRisk !== null,
      p0: provenanceRisk?.byTier?.P0 ?? 0,
      p1: provenanceRisk?.byTier?.P1 ?? 0,
      p2: provenanceRisk?.byTier?.P2 ?? 0,
      p3: provenanceRisk?.byTier?.P3 ?? 0,
    },
    goldenApproval: {
      approved: goldenApprovedDecisions,
      pending: Math.max(0, goldenCandidateCount - goldenDecidedCurrent),
      stale: goldenStaleApprovals,
    },
    copyright: { documents, distributable, rightsRecorded, ownerAttestation: true },
    golden: {
      questions: goldenQuestions.length,
      reviewed: goldenReviewed,
      datasetVersion: goldenV2?.datasetVersion ?? null,
    },
    tests: {
      evidenceProvided: testsEvidence !== null,
      failures: testsEvidence?.failures ?? 0,
      skipped: testsEvidence?.skipped ?? 0,
      commands: testsEvidence?.commands ?? [],
    },
    deployment: {
      evidenceProvided: deploymentEvidence !== null,
      notes: deploymentEvidence?.notes ?? [
        "需要 Cloud Run 部署、正式資料庫備份／還原、登入及權限抽查證據",
      ],
    },
    previous: contentQueue
      ? {
          label: "content-quality-queue-2026-10-19",
          placeholderExplanations: previousCategory("placeholder-explanations"),
          answerOnlyExplanations: previousCategory("answer-key-only-explanations"),
          skillMissing: previousCategory("skill-metadata-missing"),
          sourceUnknown: 0,
        }
      : null,
  });

  return {
    report,
    audit,
    sources: {
      database: databasePath,
      testsEvidence: testsEvidence ? testsEvidencePath : null,
      deploymentEvidence: deploymentEvidence ? deploymentEvidencePath : null,
      golden: goldenV2 || goldenV1 ? goldenPath : null,
      provenance: provenance ? provenancePath : null,
      contentQueue: contentQueue ? contentQueuePath : null,
      servabilityEvidence: servabilityEvidence ? servabilityEvidencePath : null,
      provenanceRisk: provenanceRisk ? provenanceRiskPath : null,
      goldenCandidates: goldenCandidates ? goldenCandidatesPath : null,
    },
  };
}
