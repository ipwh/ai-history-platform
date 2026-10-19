/**
 * 結構不可作答題目的唯讀修復報告。
 *
 * 用法：
 *   npx tsx scripts/audit-servability.ts
 *
 * 只讀取資料庫；不會修改題目、審核或發布狀態。逐題列出 issue code、使用情況及
 * 建議處置（建議不等於已執行）。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { Question } from "../src/lib/types";
import { questionFingerprint } from "../src/server/quality/question-fingerprint";
import { checkQuestionServable } from "../src/server/services/question-servability";
import {
  categoryForIssue,
  classifyServabilityIssue,
  recommendRemediation,
  requiresHumanDecision,
  type RemediationRecommendation,
  type ServabilityCategory,
  type ServabilityIssueCode,
} from "../src/server/quality/servability-remediation";
import {
  classifyReviewProvenance,
} from "../src/server/quality/review-provenance";

type Row = {
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
  source_excerpt: string | null;
  source_location: string | null;
  source_block_ids_json: string | null;
  grading_points_json: string | null;
  origin: string;
  status: string;
  source_verified: number;
  quality_warnings_json: string | null;
  skill: string | null;
  revision: number;
  teacher_confirmation_required: number;
};

function readArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

function parseArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function toQuestion(row: Row): Question {
  return {
    id: row.id,
    topicId: row.topic_id,
    sectionId: row.section_id ?? "",
    questionType: row.question_type,
    difficulty: row.difficulty,
    question: row.question,
    options: parseArray(row.options_json),
    correctAnswer: row.correct_answer,
    acceptedAnswers: parseArray(row.accepted_answers_json),
    explanation: row.explanation,
    knowledgePoint: row.knowledge_point,
    sourceExcerpt: row.source_excerpt ?? "",
    sourceLocation: row.source_location ?? "",
    sourceBlockIds: parseArray(row.source_block_ids_json),
    gradingPoints: parseArray(row.grading_points_json),
    origin: row.origin,
    status: row.status,
    sourceVerified: row.source_verified !== 0,
    qualityWarnings: parseArray(row.quality_warnings_json),
    skill: row.skill,
    revision: row.revision,
    autoValidatedAt: null,
    autoValidatedRevision: null,
    autoValidatedFingerprint: null,
    teacherConfirmationRequired: row.teacher_confirmation_required !== 0,
    createdAt: "",
  } as unknown as Question;
}

function main(): void {
  const repo = process.cwd();
  const argv = process.argv.slice(2);
  const databasePath = path.resolve(
    readArg(argv, "--database") ?? path.join(repo, "data", "app.db"),
  );
  const outJson = path.resolve(
    readArg(argv, "--out-json") ??
      path.join(repo, "docs", "quality", "servability-remediation-2026-10-19.json"),
  );
  const outMd = path.resolve(
    readArg(argv, "--out-md") ??
      path.join(repo, "docs", "quality", "servability-remediation-2026-10-19.md"),
  );
  if (!fs.existsSync(databasePath)) throw new Error(`找不到資料庫：${databasePath}`);

  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = db.prepare("SELECT * FROM questions ORDER BY id ASC").all() as unknown as Row[];
    const blocks = new Set(
      (db.prepare("SELECT id FROM material_blocks").all() as { id: string }[]).map(
        (row) => row.id,
      ),
    );
    const attemptCounts = new Map(
      (
        db
          .prepare("SELECT question_id, COUNT(*) AS c FROM attempts GROUP BY question_id")
          .all() as { question_id: string; c: number }[]
      ).map((row) => [row.question_id, row.c]),
    );
    const snapshotIds = new Set<string>();
    for (const session of db
      .prepare("SELECT question_snapshot_json FROM practice_sessions")
      .all() as { question_snapshot_json: string }[]) {
      try {
        const parsed: unknown = JSON.parse(session.question_snapshot_json);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && typeof item === "object" && "id" in item) {
              snapshotIds.add(String((item as { id: unknown }).id));
            }
          }
        }
      } catch {
        // 損壞的快照不影響可作答性報告；另見歷史資料報告。
      }
    }

    const reviewStatement = db.prepare(
      "SELECT revision, decision, reviewer_role, reason, question_fingerprint FROM question_reviews WHERE question_id = ?",
    );

    const items: {
      id: string;
      revision: number;
      fingerprint: string;
      questionType: string;
      status: string;
      teacherConfirmationRequired: boolean;
      issueCode: ServabilityIssueCode;
      category: ServabilityCategory;
      reason: string;
      hasSourceDocument: boolean;
      attempts: number;
      snapshots: number;
      reviewRecords: number;
      currentHumanReview: boolean;
      recommendation: RemediationRecommendation;
      needsHumanDecision: boolean;
    }[] = [];

    for (const row of rows) {
      const question = toQuestion(row);
      const check = checkQuestionServable(question);
      if (check.ok) continue;
      const fingerprint = questionFingerprint(question);
      const reviews = reviewStatement.all(row.id) as {
        revision: number;
        decision: string;
        reviewer_role: string;
        reason: string | null;
        question_fingerprint: string;
      }[];
      const currentHumanReview = reviews.some((review) => {
        if (review.decision !== "approved") return false;
        const provenance = classifyReviewProvenance({
          reviewerRole: review.reviewer_role,
          reason: review.reason,
          decision: review.decision,
          appliesToCurrentRevision:
            review.revision === row.revision && review.question_fingerprint === fingerprint,
        });
        return provenance.countsAsCurrentHumanEvidence;
      });
      const issueCode = classifyServabilityIssue(check.reason);
      const recommendation = recommendRemediation({
        issueCode,
        attempts: attemptCounts.get(row.id) ?? 0,
        snapshots: snapshotIds.has(row.id) ? 1 : 0,
        hasSourceDocument: question.sourceBlockIds.some((id) => blocks.has(id)),
      });
      items.push({
        id: row.id,
        revision: row.revision,
        fingerprint,
        questionType: row.question_type,
        status: row.status,
        teacherConfirmationRequired: row.teacher_confirmation_required !== 0,
        issueCode,
        category: categoryForIssue(issueCode),
        reason: check.reason ?? "",
        hasSourceDocument: question.sourceBlockIds.some((id) => blocks.has(id)),
        attempts: attemptCounts.get(row.id) ?? 0,
        snapshots: snapshotIds.has(row.id) ? 1 : 0,
        reviewRecords: reviews.length,
        currentHumanReview,
        recommendation,
        needsHumanDecision: requiresHumanDecision(recommendation),
      });
    }

    const countBy = <T extends string>(values: T[]): Record<string, number> =>
      values.reduce<Record<string, number>>((accumulator, value) => {
        accumulator[value] = (accumulator[value] ?? 0) + 1;
        return accumulator;
      }, {});
    const publishedUnanswerable = items.filter((item) => item.status === "published");
    const payload = {
      generatedAt: new Date().toISOString(),
      notice:
        "唯讀報告：沒有修改題目、審核或發布狀態；建議處置不等於已執行。",
      totals: {
        questions: rows.length,
        unanswerable: items.length,
        publishedUnanswerable: publishedUnanswerable.length,
        withAttempts: items.filter((item) => item.attempts > 0).length,
        withSnapshots: items.filter((item) => item.snapshots > 0).length,
        withCurrentHumanReview: items.filter((item) => item.currentHumanReview).length,
      },
      byIssueCode: countBy(items.map((item) => item.issueCode)),
      byCategory: countBy(items.map((item) => item.category)),
      byRecommendation: countBy(items.map((item) => item.recommendation)),
      byStatus: countBy(items.map((item) => item.status)),
      items,
    };

    fs.mkdirSync(path.dirname(outJson), { recursive: true });
    fs.writeFileSync(outJson, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

    const lines: string[] = [];
    lines.push("# 結構不可作答題目：唯讀修復報告（2026-10-19）");
    lines.push("");
    lines.push(`> ${payload.notice}`);
    lines.push("");
    lines.push(
      `題目總數 **${payload.totals.questions}**；不可作答 **${payload.totals.unanswerable}**（已發布 **${publishedUnanswerable.length}**）。`,
    );
    lines.push("");
    lines.push("## 問題代碼");
    lines.push("");
    lines.push("| 代碼 | 數量 | 類別 |");
    lines.push("| --- | --- | --- |");
    for (const [code, count] of Object.entries(payload.byIssueCode)) {
      lines.push(`| ${code} | ${count} | ${categoryForIssue(code as ServabilityIssueCode)} |`);
    }
    lines.push("");
    lines.push("## 建議處置（未執行）");
    lines.push("");
    lines.push("| 建議 | 數量 |");
    lines.push("| --- | --- |");
    for (const [recommendation, count] of Object.entries(payload.byRecommendation)) {
      lines.push(`| ${recommendation} | ${count} |`);
    }
    lines.push("");
    lines.push(
      `曾有學生作答：${payload.totals.withAttempts} 題；存在於練習快照：${payload.totals.withSnapshots} 題；目前版本有人工證據：${payload.totals.withCurrentHumanReview} 題。`,
    );
    lines.push("");
    lines.push("## 逐題清單");
    lines.push("");
    lines.push("| 題目 | 版本 | 狀態 | 代碼 | 原因 | 作答 | 快照 | 建議 |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const item of items) {
      lines.push(
        `| ${item.id} | ${item.revision} | ${item.status} | ${item.issueCode} | ${item.reason.replace(/\|/g, "\\|")} | ${item.attempts} | ${item.snapshots} | ${item.recommendation} |`,
      );
    }
    lines.push("");
    lines.push("## 限制");
    lines.push("");
    lines.push("- 建議只根據結構檢查、來源連結及使用紀錄；沒有判斷歷史事實或答案是否正確。");
    lines.push("- 現階段沒有任何一種原因符合「可確定自動修復」的條件，因此沒有 `safe_automatic_repair_candidate`。");
    lines.push("- 本報告沒有修改任何題目；退回草稿或隔離需要另行授權。");

    fs.mkdirSync(path.dirname(outMd), { recursive: true });
    fs.writeFileSync(outMd, `${lines.join("\n")}\n`, "utf8");

    console.log(payload.notice);
    console.log(`不可作答：${items.length}（已發布 ${publishedUnanswerable.length}）`);
    console.log(`代碼：${JSON.stringify(payload.byIssueCode)}`);
    console.log(`建議：${JSON.stringify(payload.byRecommendation)}`);
    console.log(`已寫入：${path.relative(repo, outJson)}`);
    console.log(`已寫入：${path.relative(repo, outMd)}`);
  } finally {
    db.close();
  }
}

main();
