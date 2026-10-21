/**
 * 由逐題裁決檔（只寫新值）產生可稽核的修正清單：
 *   - 修正清單（供 fix-question-content.ts 使用）會補上資料庫現值（from）；
 *   - 刪除清單（供 apply:question-queue 使用）會補上內容指紋。
 *
 * 用法：
 *   $env:APP_DATABASE_PATH="data/exports/production-next.db"
 *   npx tsx scripts/build-answer-verification-plan.ts \
 *     --decisions docs/quality/answer-fixes-2026-10-21-decisions.json \
 *     --out docs/quality/answer-fixes-2026-10-21.json \
 *     --deletions docs/teacher-review/question-queue-actions-2026-10-21-image-deletions.json
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { getDb } from "../src/server/db/connection";
import { getQuestion } from "../src/server/repositories/questions";
import { questionFingerprint } from "../src/server/services/question-service";
import type { Question } from "../src/lib/types";

interface DecisionItem {
  questionId: string;
  reason: string;
  questionTo?: string;
  optionsTo?: string[];
  correctAnswerTo?: string;
  acceptedAnswersTo?: string[];
  explanationTo?: string;
}

interface Decisions {
  authorization?: string;
  decidedBy?: string;
  items: DecisionItem[];
  deletions?: { questionId: string; reason: string }[];
}

interface FixPlanItem {
  questionId: string;
  reason: string;
  question?: { from: string; to: string };
  options?: { from: string[]; to: string[] };
  correctAnswer?: { from: string; to: string };
  acceptedAnswers?: { from: string[]; to: string[] };
  explanation?: { from: string; to: string };
}

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

function fail(message: string): never {
  console.error(`\n無法執行：${message}\n`);
  process.exit(1);
}

const decisionsPath = readArg("--decisions");
const outPath = readArg("--out");
const deletionsPath = readArg("--deletions");
if (!decisionsPath || !outPath) fail("缺少 --decisions 或 --out。");

const decisions = JSON.parse(fs.readFileSync(decisionsPath, "utf8")) as Decisions;
getDb();

const planItems: FixPlanItem[] = [];
const problems: string[] = [];

for (const item of decisions.items) {
  const question: Question | null = getQuestion(item.questionId);
  if (!question) {
    problems.push(`${item.questionId}：資料庫找不到此題目`);
    continue;
  }
  const plan: FixPlanItem = { questionId: item.questionId, reason: item.reason };
  let changed = false;

  const setChange = <T>(key: keyof FixPlanItem, current: T, next: T | undefined) => {
    if (next === undefined) return;
    const same =
      Array.isArray(current) && Array.isArray(next)
        ? current.length === next.length && current.every((value, index) => value === next[index])
        : current === next;
    if (same) return;
    (plan as unknown as Record<string, unknown>)[key] = { from: current, to: next };
    changed = true;
  };

  setChange("question", question.question, item.questionTo);
  setChange("options", question.options, item.optionsTo);
  setChange("correctAnswer", question.correctAnswer, item.correctAnswerTo);
  setChange("acceptedAnswers", question.acceptedAnswers, item.acceptedAnswersTo);
  setChange("explanation", question.explanation, item.explanationTo);

  if (!changed) {
    problems.push(`${item.questionId}：新值與現值完全相同，無需修正`);
    continue;
  }
  planItems.push(plan);
}

const deletions: {
  questionId: string;
  action: "delete";
  topicId: string;
  sectionId: string;
  questionType: string;
  beforeFingerprint: string;
  beforeQuestion: string;
  beforeCorrectAnswer: string;
  reason: string;
}[] = [];

for (const item of decisions.deletions ?? []) {
  const question = getQuestion(item.questionId);
  if (!question) {
    problems.push(`${item.questionId}：資料庫找不到此題目（可能已刪除）`);
    continue;
  }
  deletions.push({
    questionId: question.id,
    action: "delete",
    topicId: question.topicId,
    sectionId: question.sectionId,
    questionType: question.questionType,
    beforeFingerprint: questionFingerprint(question),
    beforeQuestion: question.question,
    beforeCorrectAnswer: question.correctAnswer,
    reason: item.reason,
  });
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  fail("裁決檔有問題，未產生清單。");
}

const fixPlan = {
  decidedBy: decisions.decidedBy ?? null,
  authorization: decisions.authorization ?? null,
  generatedAt: new Date().toISOString(),
  sourceDecisionFile: decisionsPath,
  items: planItems,
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(fixPlan, null, 2)}\n`, "utf8");

if (deletionsPath && deletions.length > 0) {
  const manifest = {
    version: 1,
    title: "2026-10-21 逐題核對：刪除平台無法顯示附圖的題目",
    purpose:
      "題幹只寫『圖中…』，但平台沒有題目附圖功能，來源試卷圖片亦未匯入，學生無法作答；刪除前已確認作答、回報及覆核紀錄均為 0。",
    sourceMaterials: "課題4 早期香港地區的歷史_MCQ.docx",
    generatedFrom: {
      decisions: decisionsPath,
      database: process.env.APP_DATABASE_PATH ?? "data/app.db",
      generatedAt: new Date().toISOString(),
    },
    entries: deletions,
  };
  fs.mkdirSync(path.dirname(deletionsPath), { recursive: true });
  fs.writeFileSync(deletionsPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

const digest = createHash("sha256")
  .update(JSON.stringify(fixPlan.items))
  .digest("hex")
  .slice(0, 16);
console.log(`✓ 修正清單：${planItems.length} 題 → ${outPath}（sha256:${digest}）`);
if (deletionsPath) console.log(`✓ 刪除清單：${deletions.length} 題 → ${deletionsPath}`);
