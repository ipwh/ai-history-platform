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
    options.goldenPath ?? path.join(repoRoot, "docs", "teacher-review", "golden-questions.v1.json");
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

  const golden = readJson<{
    questions?: { reviewerDecision?: string }[];
  }>(goldenPath);
  const goldenQuestions = golden?.questions ?? [];
  const goldenReviewed = goldenQuestions.filter((item) =>
    ["approved", "rejected"].includes(item.reviewerDecision ?? ""),
  ).length;

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
  } finally {
    db.close();
  }

  const report = evaluateReleaseGates({
    audit,
    answerProvenance: { affected: affectedIds.length, unresolved, reportFound: provenance !== null },
    teacherDecisions: { pendingCurrentRevision, openReports },
    copyright: { documents, distributable, rightsRecorded, ownerAttestation: true },
    golden: { questions: goldenQuestions.length, reviewed: goldenReviewed },
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
      golden: golden ? goldenPath : null,
      provenance: provenance ? provenancePath : null,
      contentQueue: contentQueue ? contentQueuePath : null,
    },
  };
}
