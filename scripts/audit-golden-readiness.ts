/**
 * Golden Dataset 核准準備度（Sprint 14，唯讀）。
 *
 * 對 42 個既有候選逐題列出「教師核准前仍缺少甚麼」：
 *   - 題目版本／指紋是否仍與候選清單一致；
 *   - 是否有教材／權威來源證據；
 *   - 標準答案是否完整（選擇題：答案必須在選項內）；
 *   - 預期 grading、reasoning、category、distractorNotes（需教師在核准時提供，程式不可代填）；
 *   - 是否已有裁決紀錄；
 *   - 歷史科審核者名單（`HISTORY_REVIEWER_EMAILS`）是否已設定。
 *
 * 這份報告**不會**核准任何 fixture，也不會寫入資料庫。
 *
 * 用法：
 *   npx tsx scripts/audit-golden-readiness.ts
 *   npx tsx scripts/audit-golden-readiness.ts --database "C:\\temp\\copy.db"
 */
import fs from "node:fs";
import path from "node:path";

import { GOLDEN_CATEGORIES } from "../src/server/quality/golden-dataset";
import { questionFingerprint } from "../src/server/quality/question-fingerprint";
import { openReadOnlyDatabase } from "../src/server/db/connection";
import type { Question } from "../src/lib/types";

interface Candidate {
  group: string;
  questionId: string;
  questionRevision: number;
  questionFingerprint: string;
  questionType: "mc" | "fill";
  stem: string;
  options: string[];
  correctAnswer: string;
  acceptedAnswers: string[];
  evidence: {
    sourceExcerpt: string;
    sourceLocation: string;
    sourceBlockIds: string[];
    hasTraceableDocument: boolean;
  };
}

interface CandidateFile {
  generatedAt: string;
  groups: Array<{ group: string; items: Candidate[] }>;
}

function readArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

interface Readiness {
  questionId: string;
  group: string;
  candidateRevision: number;
  currentRevision: number | null;
  revisionMatches: boolean;
  fingerprintMatches: boolean;
  hasSourceEvidence: boolean;
  answerComplete: boolean;
  missing: string[];
  decision: string | null;
  decisionValidForCurrentVersion: boolean | null;
  status: "ready_for_teacher_review" | "blocked_by_version_drift" | "blocked_by_missing_evidence";
}

function main(): void {
  const repo = process.cwd();
  const argv = process.argv.slice(2);
  const databasePath = path.resolve(readArg(argv, "--database") ?? path.join(repo, "data", "app.db"));
  const candidatesPath = path.resolve(
    repo,
    "docs/teacher-review/golden-candidates-2026-10-19.json",
  );
  if (!fs.existsSync(candidatesPath)) throw new Error("找不到 golden 候選清單");
  if (!fs.existsSync(databasePath)) throw new Error(`找不到資料庫：${databasePath}`);

  const file = JSON.parse(fs.readFileSync(candidatesPath, "utf8")) as CandidateFile;
  const candidates = file.groups.flatMap((group) =>
    group.items.map((item) => ({ ...item, group: group.group })),
  );

  const db = openReadOnlyDatabase(databasePath);
  const rows: Readiness[] = [];
  let decisionTableAvailable = true;
  try {
    db.prepare("SELECT 1 FROM golden_fixture_reviews LIMIT 1").get();
  } catch {
    decisionTableAvailable = false;
  }

  try {
    for (const candidate of candidates) {
      const row = db
        .prepare(
          `SELECT id, topic_id, section_id, question_type, difficulty, question, options_json,
                  correct_answer, accepted_answers_json, explanation, knowledge_point,
                  grading_points_json, skill, revision, status
           FROM questions WHERE id = ?`,
        )
        .get(candidate.questionId) as
        | {
            id: string;
            topic_id: string;
            section_id: string | null;
            question_type: "mc" | "fill";
            difficulty: string;
            question: string;
            options_json: string | null;
            correct_answer: string;
            accepted_answers_json: string | null;
            explanation: string;
            knowledge_point: string;
            grading_points_json: string | null;
            skill: string | null;
            revision: number;
            status: string;
          }
        | undefined;

      const currentRevision = row?.revision ?? null;
      let fingerprintMatches = false;
      if (row) {
        const question = {
          id: row.id,
          topicId: row.topic_id,
          sectionId: row.section_id ?? "",
          questionType: row.question_type,
          difficulty: row.difficulty,
          question: row.question,
          options: row.options_json ? (JSON.parse(row.options_json) as string[]) : [],
          correctAnswer: row.correct_answer,
          acceptedAnswers: row.accepted_answers_json
            ? (JSON.parse(row.accepted_answers_json) as string[])
            : [],
          explanation: row.explanation,
          knowledgePoint: row.knowledge_point,
          gradingPoints: row.grading_points_json
            ? (JSON.parse(row.grading_points_json) as string[])
            : [],
          skill: row.skill,
        } as Question;
        fingerprintMatches = questionFingerprint(question) === candidate.questionFingerprint;
      }

      const hasSourceEvidence =
        candidate.evidence.sourceBlockIds.length > 0 ||
        (candidate.evidence.sourceExcerpt ?? "").trim().length >= 8;
      const answerComplete =
        candidate.correctAnswer.trim().length > 0 &&
        (candidate.questionType === "fill" || candidate.options.includes(candidate.correctAnswer));

      const missing: string[] = [];
      if (!row) missing.push("題庫找不到這道題目");
      if (currentRevision !== null && currentRevision !== candidate.questionRevision)
        missing.push(`題目版本已由 ${candidate.questionRevision} 變為 ${currentRevision}`);
      if (row && !fingerprintMatches) missing.push("內容指紋已改變");
      if (!hasSourceEvidence) missing.push("沒有可核對的來源證據（教材段落或具名權威來源）");
      if (!answerComplete) missing.push("標準答案不完整或不在選項內");
      missing.push("預期 grading（需教師在核准時提供）");
      missing.push("審核理由及類別（需教師提供）");
      if (candidate.questionType === "mc")
        missing.push(`錯誤選項說明 ${candidate.options.length - 1} 條（需教師提供）`);
      if (!decisionTableAvailable) missing.push("Golden 裁決表不存在（migration 0022 未套用）");

      let decision: string | null = null;
      let decisionValidForCurrentVersion: boolean | null = null;
      if (decisionTableAvailable) {
        const latest = db
          .prepare(
            `SELECT decision, revision, question_fingerprint FROM golden_fixture_reviews
             WHERE question_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
          )
          .get(candidate.questionId) as
          | { decision: string; revision: number; question_fingerprint: string }
          | undefined;
        if (latest) {
          decision = latest.decision;
          decisionValidForCurrentVersion =
            row !== undefined &&
            latest.revision === row.revision &&
            latest.question_fingerprint ===
              questionFingerprint({
                id: row.id,
                topicId: row.topic_id,
                sectionId: row.section_id ?? "",
                questionType: row.question_type,
                difficulty: row.difficulty,
                question: row.question,
                options: row.options_json ? (JSON.parse(row.options_json) as string[]) : [],
                correctAnswer: row.correct_answer,
                acceptedAnswers: row.accepted_answers_json
                  ? (JSON.parse(row.accepted_answers_json) as string[])
                  : [],
                explanation: row.explanation,
                knowledgePoint: row.knowledge_point,
                gradingPoints: row.grading_points_json
                  ? (JSON.parse(row.grading_points_json) as string[])
                  : [],
                skill: row.skill,
              } as Question);
        }
      }

      const status: Readiness["status"] =
        !row || currentRevision !== candidate.questionRevision || !fingerprintMatches
          ? "blocked_by_version_drift"
          : !hasSourceEvidence || !answerComplete
            ? "blocked_by_missing_evidence"
            : "ready_for_teacher_review";

      rows.push({
        questionId: candidate.questionId,
        group: candidate.group,
        candidateRevision: candidate.questionRevision,
        currentRevision,
        revisionMatches: currentRevision === candidate.questionRevision,
        fingerprintMatches,
        hasSourceEvidence,
        answerComplete,
        missing,
        decision,
        decisionValidForCurrentVersion,
        status,
      });
    }
  } finally {
    db.close();
  }

  const reviewerEmails = (process.env.HISTORY_REVIEWER_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const byStatus: Record<string, number> = {};
  for (const row of rows) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;

  const report = {
    generatedAt: new Date().toISOString(),
    notice:
      "唯讀準備度報告：不核准任何 fixture、不寫入資料庫。缺少的項目必須由具授權的歷史科教師在正式核准流程提供。",
    inputs: {
      candidates: path.relative(repo, candidatesPath),
      candidatesGeneratedAt: file.generatedAt,
      database: databasePath,
      goldenDecisionTableAvailable: decisionTableAvailable,
      reviewerAllowlistConfigured: reviewerEmails.length > 0,
      reviewerAllowlistSize: reviewerEmails.length,
    },
    totals: {
      candidates: rows.length,
      approved: rows.filter((row) => row.decision === "approved" && row.decisionValidForCurrentVersion).length,
      pending: rows.filter((row) => row.decision === null).length,
      staleDecisions: rows.filter((row) => row.decision !== null && row.decisionValidForCurrentVersion === false).length,
      readyForTeacherReview: byStatus.ready_for_teacher_review ?? 0,
      blockedByVersionDrift: byStatus.blocked_by_version_drift ?? 0,
      blockedByMissingEvidence: byStatus.blocked_by_missing_evidence ?? 0,
      categoriesRequiringTeacherInput: GOLDEN_CATEGORIES.length,
    },
    byStatus,
    rows,
    blockedByAllowlist: reviewerEmails.length === 0,
  };

  const outBase = path.resolve(
    repo,
    readArg(argv, "--out") ?? "docs/teacher-review/golden-readiness-2026-10-19",
  );
  fs.writeFileSync(`${outBase}.json`, `${JSON.stringify(report, null, 1)}\n`, "utf8");

  const lines: string[] = [];
  lines.push("# Golden Dataset 核准準備度（Sprint 14，唯讀）", "");
  lines.push(`產生時間：${report.generatedAt}`, "");
  lines.push("## 總數", "", "| 指標 | 數量 |", "| --- | --- |");
  for (const [key, value] of Object.entries(report.totals)) lines.push(`| ${key} | ${value} |`);
  lines.push("");
  lines.push(
    `- 歷史科審核者名單（\`HISTORY_REVIEWER_EMAILS\`）：${reviewerEmails.length > 0 ? `已設定 ${reviewerEmails.length} 個帳戶` : "**未設定**（核准一律 fail-closed）"}`,
  );
  lines.push(`- Golden 裁決表：${decisionTableAvailable ? "存在" : "**不存在**（migration 0022 未套用）"}`);
  lines.push("");
  lines.push("## 逐題缺少的項目", "");
  lines.push("| 候選 | 版本一致 | 指紋一致 | 來源證據 | 答案完整 | 仍缺少 |", "| --- | --- | --- | --- | --- | --- |");
  for (const row of rows) {
    lines.push(
      `| \`${row.questionId}\` | ${row.revisionMatches ? "是" : "否"} | ${row.fingerprintMatches ? "是" : "否"} | ${row.hasSourceEvidence ? "有" : "無"} | ${row.answerComplete ? "是" : "否"} | ${row.missing.join("；")} |`,
    );
  }
  lines.push("");
  lines.push("## 說明", "");
  lines.push("- 「預期 grading」「審核理由」「錯誤選項說明」屬教師判斷，程式不可代填。");
  lines.push("- 版本或指紋不一致的候選必須重新載入並重新審核；舊裁決不會被評估器採用。");
  lines.push("- `HISTORY_REVIEWER_EMAILS` 未設定時，任何核准嘗試都會收到 403（fail-closed）。");
  lines.push("");
  fs.writeFileSync(`${outBase}.md`, `${lines.join("\n")}\n`, "utf8");

  console.log("totals", report.totals);
  console.log("reviewerAllowlistConfigured", report.inputs.reviewerAllowlistConfigured);
  console.log(`已寫入 ${path.relative(repo, `${outBase}.json`)} 及 .md`);
  console.log("唯讀：沒有核准任何 fixture、沒有寫入資料庫。");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
