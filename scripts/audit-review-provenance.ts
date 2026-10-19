/**
 * 審核紀錄來源稽核（唯讀）。
 *
 * 目的：核對 Sprint 9 所述「1,279 筆以非 automation 角色記錄」的實際形成方式，
 * 逐筆分類，並保留原始紀錄（不改寫）。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { Question } from "../src/lib/types";
import { questionFingerprint } from "../src/server/quality/question-fingerprint";
import {
  classifyReviewKind,
  classifyReviewProvenance,
  type ReviewKind,
} from "../src/server/quality/review-provenance";

type QuestionRow = {
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

type ReviewRow = {
  id: string;
  question_id: string;
  revision: number;
  decision: string;
  reason: string | null;
  reviewer_email: string;
  reviewer_role: string;
  question_fingerprint: string;
  created_at: string;
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

function toQuestion(row: QuestionRow): Question {
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
      path.join(repo, "docs", "quality", "review-provenance-2026-10-19.json"),
  );
  const outMd = path.resolve(
    readArg(argv, "--out-md") ??
      path.join(repo, "docs", "quality", "review-provenance-2026-10-19.md"),
  );
  if (!fs.existsSync(databasePath)) throw new Error(`找不到資料庫：${databasePath}`);

  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const questions = db.prepare("SELECT * FROM questions").all() as unknown as QuestionRow[];
    const reviews = db
      .prepare("SELECT * FROM question_reviews ORDER BY created_at ASC, rowid ASC")
      .all() as unknown as ReviewRow[];
    const questionById = new Map(questions.map((row) => [row.id, row]));
    const fingerprintById = new Map(
      questions.map((row) => [row.id, questionFingerprint(toQuestion(row))]),
    );

    const conflictKeys = new Map<string, Set<ReviewKind>>();
    for (const review of reviews) {
      if (review.decision !== "approved") continue;
      const key = `${review.question_id}#${review.revision}#${review.question_fingerprint}`;
      const kinds = conflictKeys.get(key) ?? new Set<ReviewKind>();
      kinds.add(classifyReviewKind(review.reviewer_role, review.reason));
      conflictKeys.set(key, kinds);
    }

    const rows = reviews.map((review) => {
      const question = questionById.get(review.question_id);
      const fingerprint = fingerprintById.get(review.question_id) ?? "";
      const appliesToCurrentRevision =
        question !== undefined &&
        review.revision === question.revision &&
        review.question_fingerprint === fingerprint;
      const key = `${review.question_id}#${review.revision}#${review.question_fingerprint}`;
      const kinds = conflictKeys.get(key);
      const conflictingEvidence =
        kinds !== undefined &&
        (kinds.has("teacher_adjudication") || kinds.has("owner_batch")) &&
        kinds.has("automation_repair");
      const provenance = classifyReviewProvenance({
        reviewerRole: review.reviewer_role,
        reason: review.reason,
        decision: review.decision,
        appliesToCurrentRevision,
        conflictingEvidence,
      });
      return {
        reviewId: review.id,
        questionId: review.question_id,
        revision: review.revision,
        decision: review.decision,
        reviewerRole: review.reviewer_role,
        reviewerEmail: review.reviewer_email,
        reason: review.reason,
        createdAt: review.created_at,
        kind: provenance.kind,
        class: provenance.class,
        evidence: provenance.evidence,
        appliesToCurrentRevision,
        countsAsCurrentHumanEvidence: provenance.countsAsCurrentHumanEvidence,
        questionExists: question !== undefined,
      };
    });

    const countBy = <T extends string>(values: T[]): Record<string, number> =>
      values.reduce<Record<string, number>>((accumulator, value) => {
        accumulator[value] = (accumulator[value] ?? 0) + 1;
        return accumulator;
      }, {});

    // 每題目前版本的有效證據狀態（只看 approved）
    const currentApproved = new Map<
      string,
      { human: boolean; automation: boolean; ownerBatch: boolean; teacher: boolean }
    >();
    for (const row of rows) {
      if (row.decision !== "approved" || !row.appliesToCurrentRevision) continue;
      const state = currentApproved.get(row.questionId) ?? {
        human: false,
        automation: false,
        ownerBatch: false,
        teacher: false,
      };
      if (row.kind === "automation_repair") state.automation = true;
      if (row.kind === "owner_batch") {
        state.human = true;
        state.ownerBatch = true;
      }
      if (row.kind === "teacher_adjudication") {
        state.human = true;
        state.teacher = true;
      }
      currentApproved.set(row.questionId, state);
    }
    const questionEvidence = questions.map((question) => {
      const state = currentApproved.get(question.id);
      return {
        questionId: question.id,
        revision: question.revision,
        status: question.status,
        hasCurrentHumanEvidence: state?.human ?? false,
        hasCurrentTeacherAdjudication: state?.teacher ?? false,
        ownerBatchOnly:
          (state?.human ?? false) && !(state?.teacher ?? false) && state?.ownerBatch === true,
        automationOnly: !(state?.human ?? false) && (state?.automation ?? false),
        noCurrentApprovedEvidence: state === undefined,
      };
    });

    const automationRecords = rows.filter((row) => row.kind === "automation_repair");
    const teacherRecords = rows.filter((row) => row.kind === "teacher_adjudication");
    const payload = {
      generatedAt: new Date().toISOString(),
      notice:
        "唯讀審核來源稽核：只分類既有紀錄，沒有修改、刪除或重新標記任何審核紀錄。",
      totals: {
        records: rows.length,
        questions: questions.length,
        recordsApplyingToCurrentRevision: rows.filter((row) => row.appliesToCurrentRevision)
          .length,
      },
      byKind: countBy(rows.map((row) => row.kind)),
      byClass: countBy(rows.map((row) => row.class)),
      byDecision: countBy(rows.map((row) => row.decision)),
      roles: countBy(rows.map((row) => row.reviewerRole)),
      questionEvidenceSummary: {
        withCurrentHumanEvidence: questionEvidence.filter(
          (item) => item.hasCurrentHumanEvidence,
        ).length,
        withCurrentTeacherAdjudication: questionEvidence.filter(
          (item) => item.hasCurrentTeacherAdjudication,
        ).length,
        ownerBatchOnly: questionEvidence.filter((item) => item.ownerBatchOnly).length,
        automationOnly: questionEvidence.filter((item) => item.automationOnly).length,
        noCurrentApprovedEvidence: questionEvidence.filter(
          (item) => item.noCurrentApprovedEvidence,
        ).length,
      },
      sprint9Claim: {
        stated: 1279,
        description:
          "Sprint 9 以「role 不是 automation 且理由含『自動修復』」計出 1,279；本次逐筆核對後發現",
        recomputedAutomationRecords: automationRecords.length,
        miscountedTeacherAdjudications: teacherRecords.filter((row) =>
          (row.reason ?? "").includes("自動修復"),
        ).length,
        explanation:
          "13 筆『教師裁決（自動修復改變考核答案）…』的理由含『自動修復』字樣，被 Sprint 9 的子字串規則誤計為自動化紀錄；另有 1,266 筆真正的自動修復紀錄（718 筆『模擬學生使用後自動修復』＋548 筆『自動修復多空格填充題』）。所有 3,168 筆的 reviewer_role 都是 admin，因此角色欄不能單獨證明是否人工覆核。",
      },
      records: rows,
      questionEvidence,
    };

    fs.mkdirSync(path.dirname(outJson), { recursive: true });
    fs.writeFileSync(outJson, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

    const lines: string[] = [];
    lines.push("# 審核紀錄來源稽核（2026-10-19）");
    lines.push("");
    lines.push(`> ${payload.notice}`);
    lines.push("");
    lines.push(
      `紀錄 **${rows.length}** 筆；套用於目前版本 **${payload.totals.recordsApplyingToCurrentRevision}** 筆。`,
    );
    lines.push("");
    lines.push("| 來源類別 | 數量 |");
    lines.push("| --- | --- |");
    for (const [kind, count] of Object.entries(payload.byKind)) lines.push(`| ${kind} | ${count} |`);
    lines.push("");
    lines.push("| Provenance 分類 | 數量 |");
    lines.push("| --- | --- |");
    for (const [name, count] of Object.entries(payload.byClass)) lines.push(`| ${name} | ${count} |`);
    lines.push("");
    lines.push("## Sprint 9 的 1,279 筆：核對結果");
    lines.push("");
    lines.push(payload.sprint9Claim.explanation);
    lines.push("");
    lines.push("## 每題目前版本的證據");
    lines.push("");
    lines.push("| 情況 | 題數 |");
    lines.push("| --- | --- |");
    lines.push(`| 有人工證據（教師或擁有者批次） | ${payload.questionEvidenceSummary.withCurrentHumanEvidence} |`);
    lines.push(`| 其中教師逐題裁決 | ${payload.questionEvidenceSummary.withCurrentTeacherAdjudication} |`);
    lines.push(`| 只有擁有者批次（非逐題） | ${payload.questionEvidenceSummary.ownerBatchOnly} |`);
    lines.push(`| 只有自動修復紀錄 | ${payload.questionEvidenceSummary.automationOnly} |`);
    lines.push(`| 沒有目前版本核准紀錄 | ${payload.questionEvidenceSummary.noCurrentApprovedEvidence} |`);
    lines.push("");
    lines.push("## 限制");
    lines.push("");
    lines.push("- 分類只根據理由的已知前綴及角色；沒有推測未知紀錄的來源。");
    lines.push("- `verified_automation` 只表示「這筆紀錄由自動流程產生」，不代表題目內容錯誤。");
    lines.push("- 批次授權（擁有者指示）屬人類決定，但不是逐題教師覆核；兩者以 kind 分開。");
    lines.push("- 原始紀錄全部保留；沒有改寫角色、時間或指紋。");

    fs.mkdirSync(path.dirname(outMd), { recursive: true });
    fs.writeFileSync(outMd, `${lines.join("\n")}\n`, "utf8");

    console.log(payload.notice);
    console.log(`紀錄：${rows.length}；${JSON.stringify(payload.byKind)}`);
    console.log(`每題證據：${JSON.stringify(payload.questionEvidenceSummary)}`);
    console.log(`已寫入：${path.relative(repo, outJson)}`);
    console.log(`已寫入：${path.relative(repo, outMd)}`);
  } finally {
    db.close();
  }
}

main();
