/**
 * 套用題目內容修正（題幹錯字／答案明顯有誤）。擁有者授權的逐題修正工具。
 *
 * 用途：逐題核對時發現的**內容錯誤**（匯入黏連、原卷錯字、答案與史實不符）需要就地修正。
 * 這類修正會改動 `question` 或 `correct_answer`，因此：
 *   - 必須逐題提供 `from`（現值）及 `to`（修正值），現值不符即整批拒絕；
 *   - 修正後必須仍可作答（`checkQuestionServable`）；
 *   - 預設 dry-run，要 `--apply` 才寫入；
 *   - 不寫入任何覆核紀錄；`revision` +1，與其他內容修改一致。
 *
 * 用法：
 *   npx tsx scripts/fix-question-content.ts --plan docs/quality/content-fixes-2026-10-21.json \
 *     --owner-email you@school.edu.hk --database data/app.db --apply
 */
import fs from "node:fs";
import path from "node:path";

import { getDb } from "../src/server/db/connection";
import { getServerConfig, isProductionRuntime } from "../src/server/config";
import { getQuestion, updateQuestion } from "../src/server/repositories/questions";
import {
  planQuestionContentFix,
  type QuestionContentFix,
  type QuestionContentFixPlan,
} from "../src/server/services/question-content-fix";
import { warnIfNpmSwallowedApply } from "./lifecycle-hints";

interface FixPlanFile {
  decidedBy?: string;
  authorization?: string;
  items: QuestionContentFix[];
}

const STATUS_LABELS: Record<QuestionContentFixPlan["status"], string> = {
  planned: "將修正",
  "already-applied": "已是最新",
  missing: "找不到題目",
  conflict: "與紀錄不符",
  unservable: "修正後仍不可作答",
};

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

function fail(message: string): never {
  console.error(`\n無法執行：${message}\n`);
  process.exit(1);
}

function main(): void {
  const apply = process.argv.includes("--apply");
  warnIfNpmSwallowedApply(apply);
  const planPath = readArg("--plan");
  const databasePath = getServerConfig().databasePath;

  if (isProductionRuntime()) {
    fail("偵測到正式環境。內容修正只可在本機執行，再把資料庫快照上載到備份 bucket。");
  }
  if (!planPath || !fs.existsSync(path.resolve(planPath))) fail("缺少 --plan：請提供逐題修正清單。");
  const plan = JSON.parse(fs.readFileSync(path.resolve(planPath), "utf8")) as FixPlanFile;
  if (!Array.isArray(plan.items) || plan.items.length === 0) fail("修正清單沒有任何題目。");
  const decidedBy = (readArg("--owner-email") ?? plan.decidedBy ?? "").trim();
  if (decidedBy.length === 0) fail("缺少 --owner-email（或清單的 decidedBy）：修正必須可追溯至真人。");

  getDb();
  console.log(`修正清單：${planPath}（${plan.items.length} 題）`);
  console.log(`資料庫：${databasePath}`);
  console.log(`模式：${apply ? "套用（--apply）" : "模擬（未寫入）"}\n`);

  const planned = plan.items.map((item) => planQuestionContentFix(getQuestion(item.questionId), item));
  for (const action of planned) {
    const icon = action.status === "planned" || action.status === "already-applied" ? "✓" : "✗";
    console.log(`${icon} ${STATUS_LABELS[action.status]}｜${action.questionId}｜${action.detail}`);
  }

  const problems = planned.filter(
    (action) =>
      action.status === "missing" || action.status === "conflict" || action.status === "unservable",
  );
  if (problems.length > 0) {
    console.log(`\n共 ${problems.length} 題無法處理；整批不寫入，請先修正清單或題目。`);
    process.exit(1);
  }

  const writable = planned.filter((action) => action.status === "planned");
  if (writable.length === 0) {
    console.log("\n全部題目已是最新狀態，沒有需要寫入。");
    return;
  }
  if (!apply) {
    console.log(`\n（模擬模式）以上 ${writable.length} 題**未**寫入。要真正寫入請加上 --apply。`);
    return;
  }

  const applied: {
    questionId: string;
    question?: { from: string; to: string };
    options?: { from: string[]; to: string[] };
    correctAnswer?: { from: string; to: string };
    acceptedAnswers?: { from: string[]; to: string[] };
    explanation?: { from: string; to: string };
    revisionBefore: number;
    revisionAfter: number;
    reason: string;
  }[] = [];
  for (const action of writable) {
    const question = getQuestion(action.questionId);
    if (!question) fail(`題目 ${action.questionId} 讀取失敗`);
    const updated = updateQuestion(question.id, {
      ...question,
      question: action.newQuestion ?? question.question,
      options: action.newOptions ?? question.options,
      correctAnswer: action.newCorrectAnswer ?? question.correctAnswer,
      acceptedAnswers: action.newAcceptedAnswers ?? question.acceptedAnswers,
      explanation: action.newExplanation ?? question.explanation,
    });
    const item = plan.items.find((entry) => entry.questionId === action.questionId);
    applied.push({
      questionId: action.questionId,
      reason: item?.reason ?? "",
      revisionBefore: question.revision,
      revisionAfter: updated.revision,
      ...(item?.question ? { question: item.question } : {}),
      ...(item?.options ? { options: item.options } : {}),
      ...(item?.correctAnswer ? { correctAnswer: item.correctAnswer } : {}),
      ...(item?.acceptedAnswers ? { acceptedAnswers: item.acceptedAnswers } : {}),
      ...(item?.explanation ? { explanation: item.explanation } : {}),
    });
    console.log(`✓ 已修正｜${action.questionId}｜${action.detail}`);
  }

  const recordPath = path.resolve("docs/quality/content-fixes-applied.json");
  const existing = fs.existsSync(recordPath)
    ? (JSON.parse(fs.readFileSync(recordPath, "utf8")) as { decisions?: unknown[] })
    : { decisions: [] };
  const decisions = Array.isArray(existing.decisions) ? existing.decisions : [];
  decisions.push({
    decision: "owner-authorized-content-fix",
    decidedBy,
    authorization: plan.authorization ?? null,
    plan: planPath,
    appliedAt: new Date().toISOString(),
    items: applied,
    note:
      "只修正清單明列的欄位（題幹、選項、標準答案、可接受答案、解釋）；沒有改動知識點或來源，亦沒有寫入任何覆核紀錄。" +
      "修正會令 revision +1，因此舊有覆核如實失效。",
  });
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  fs.writeFileSync(recordPath, `${JSON.stringify({ decisions }, null, 2)}\n`, "utf8");
  console.log(`\n✓ 已修正 ${applied.length} 題。紀錄：${path.relative(process.cwd(), recordPath)}`);
}

main();
