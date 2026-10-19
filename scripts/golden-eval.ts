/**
 * Golden evaluation runner（唯讀）。
 *
 * 用法：npx tsx scripts/golden-eval.ts
 * 輸出：docs/quality/golden-eval-2026-10-19.json／.md
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { Question } from "../src/lib/types";
import { questionFingerprint } from "../src/server/quality/question-fingerprint";
import { checkQuestionServable } from "../src/server/services/question-servability";
import {
  evaluateGoldenDataset,
  goldenDatasetSchema,
  type GoldenQuestionSnapshot,
} from "../src/server/quality/golden-dataset";

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

function main(): number {
  const repo = process.cwd();
  const argv = process.argv.slice(2);
  const databasePath = path.resolve(
    readArg(argv, "--database") ?? path.join(repo, "data", "app.db"),
  );
  const datasetPath = path.resolve(
    readArg(argv, "--dataset") ??
      path.join(repo, "docs", "teacher-review", "golden-questions.v2.json"),
  );
  const outJson = path.resolve(
    readArg(argv, "--out-json") ?? path.join(repo, "docs", "quality", "golden-eval-2026-10-19.json"),
  );
  const outMd = path.resolve(
    readArg(argv, "--out-md") ?? path.join(repo, "docs", "quality", "golden-eval-2026-10-19.md"),
  );
  if (!fs.existsSync(databasePath)) throw new Error(`找不到資料庫：${databasePath}`);
  if (!fs.existsSync(datasetPath)) throw new Error(`找不到 dataset：${datasetPath}`);

  const parsed = goldenDatasetSchema.safeParse(
    JSON.parse(fs.readFileSync(datasetPath, "utf8")) as unknown,
  );
  if (!parsed.success) {
    console.error("Golden dataset schema 驗證失敗：");
    for (const issue of parsed.error.issues) {
      console.error(`- ${issue.path.join(".")}: ${issue.message}`);
    }
    return 1;
  }

  const db = new DatabaseSync(databasePath, { readOnly: true });
  const lookup = new Map<string, GoldenQuestionSnapshot>();
  try {
    const rows = db.prepare("SELECT * FROM questions").all() as unknown as Row[];
    for (const row of rows) {
      const question = toQuestion(row);
      lookup.set(row.id, {
        id: row.id,
        revision: row.revision,
        fingerprint: questionFingerprint(question),
        servable: checkQuestionServable(question).ok,
        question,
      });
    }
  } finally {
    db.close();
  }

  const evaluation = evaluateGoldenDataset(parsed.data, lookup);
  const payload = {
    generatedAt: new Date().toISOString(),
    notice:
      "唯讀評估：沒有修改題目、審核或發布狀態；未核准 fixture 不會被當作正式結果。",
    dataset: path.relative(repo, datasetPath).replace(/\\/g, "/"),
    ...evaluation,
  };
  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const lines: string[] = [];
  lines.push("# Golden Evaluation 結果（2026-10-19）");
  lines.push("");
  lines.push(`> ${payload.notice}`);
  lines.push("");
  lines.push(`- Dataset：${payload.dataset}`);
  lines.push(`- Dataset 版本：${evaluation.datasetVersion}`);
  lines.push(`- 結果：**${evaluation.status}**`);
  lines.push("");
  lines.push(
    `Fixture 總數 ${evaluation.totals.fixtures}：approved ${evaluation.totals.approved}、pending ${evaluation.totals.pending}、rejected ${evaluation.totals.rejected}、superseded ${evaluation.totals.superseded}、draft ${evaluation.totals.draft}。`,
  );
  lines.push(
    `評估：pass ${evaluation.totals.passed}、fail ${evaluation.totals.failed}、skipped ${evaluation.totals.skipped}。`,
  );
  lines.push("");
  if (!evaluation.evidenceSufficient) {
    lines.push(
      "**INSUFFICIENT_EVIDENCE**：沒有 approved fixture，不能宣稱評估已通過；這不是零錯誤。",
    );
    lines.push("");
  }
  if (evaluation.results.length > 0) {
    lines.push("| Fixture | 狀態 | 結果 | 代碼 | 說明 |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const result of evaluation.results) {
      lines.push(
        `| ${result.fixtureId} | ${result.reviewStatus} | ${result.outcome} | ${result.codes.join("、") || "—"} | ${result.detail} |`,
      );
    }
    lines.push("");
  }
  fs.mkdirSync(path.dirname(outMd), { recursive: true });
  fs.writeFileSync(outMd, `${lines.join("\n")}\n`, "utf8");

  console.log(payload.notice);
  console.log(`結果：${evaluation.status}`);
  console.log(`fixtures：${JSON.stringify(evaluation.totals)}`);
  console.log(`已寫入：${path.relative(repo, outJson)}`);
  console.log(`已寫入：${path.relative(repo, outMd)}`);
  return evaluation.status === "FAIL" ? 1 : 0;
}

process.exit(main());
