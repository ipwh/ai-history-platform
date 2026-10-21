/**
 * 依擁有者授權的逐題決定，解除「待教師確認」（`teacher_confirmation_required`）暫緩標記，
 * 讓題目可以發布給學生（**擁有者授權的內容決定，不是教師覆核**）。
 *
 * 界線（重要）：
 *   - 本腳本**不會**寫入任何 `question_reviews` 覆核紀錄，因此這些題目在教師端仍如實顯示為
 *     「已發布（未經人工覆核）」。
 *   - 只處理決定檔（`--plan`）內明列的題目；每題都必須附上理由，理由會寫入紀錄檔。
 *   - 答案修正只限「匯入黏連」造成的破損答案：必須同時提供 `from`（現值）與 `to`（修正值），
 *     兩者不符即拒絕。
 *   - 解除標記前必須通過可作答性檢查；不可作答的題目一律拒絕。
 *   - 原暫緩理由會保留在 `quality_warnings_json`，並附上一行「已由誰在何時決定發布」，
 *     不覆蓋歷史證據。判斷邏輯見 src/server/services/teacher-confirmation-override.ts。
 *
 * 預設為**模擬模式**；必須加 `--apply` 才寫入。
 *
 * 用法：
 *   npx tsx scripts/resolve-teacher-confirmation.ts \
 *     --plan docs/teacher-review/owner-content-repairs-2026-10-21.json \
 *     --owner-email you@school.edu.hk --database data/app.db --apply
 */
import fs from "node:fs";
import path from "node:path";

import { getDb } from "../src/server/db/connection";
import { getServerConfig, isProductionRuntime } from "../src/server/config";
import { getQuestion, updateQuestion } from "../src/server/repositories/questions";
import {
  planTeacherConfirmationOverride,
  type TeacherConfirmationOverrideItem,
  type TeacherConfirmationOverridePlan,
} from "../src/server/services/teacher-confirmation-override";
import { warnIfNpmSwallowedApply } from "./lifecycle-hints";

interface RepairPlan {
  decidedBy?: string;
  decidedAt?: string;
  authorization?: string;
  items: TeacherConfirmationOverrideItem[];
}

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

const apply = process.argv.includes("--apply");
warnIfNpmSwallowedApply(apply);
const planPath = readArg("--plan");
const databasePath = getServerConfig().databasePath;
const decidedOn = new Date().toISOString().slice(0, 10);

function fail(message: string): never {
  console.error(`\n無法執行：${message}\n`);
  process.exit(1);
}

function main(): void {
  if (isProductionRuntime()) {
    fail("偵測到正式環境。內容決定只可在本機執行，再把資料庫快照上載到備份 bucket。");
  }
  if (!planPath || !fs.existsSync(path.resolve(planPath))) {
    fail("缺少 --plan：請提供擁有者授權的逐題決定檔（JSON）。");
  }
  const plan = JSON.parse(fs.readFileSync(path.resolve(planPath), "utf8")) as RepairPlan;
  if (!Array.isArray(plan.items) || plan.items.length === 0) fail("決定檔沒有任何題目。");
  const actorEmail = (readArg("--owner-email") ?? plan.decidedBy ?? "").trim();
  if (actorEmail.length === 0) fail("缺少 --owner-email（或決定檔的 decidedBy）：必須可追溯至真人。");

  getDb();

  console.log(`決定檔：${planPath}（${plan.items.length} 題）`);
  console.log(`資料庫：${databasePath}`);
  console.log(`模式：${apply ? "套用（--apply）" : "模擬（未寫入）"}\n`);

  const planned = plan.items.map((item) =>
    planTeacherConfirmationOverride(getQuestion(item.questionId), item, decidedOn),
  );
  const statusLabels: Record<TeacherConfirmationOverridePlan["status"], string> = {
    planned: "將處理",
    "already-applied": "已是最新",
    missing: "找不到題目",
    conflict: "與決定檔不符",
    unservable: "不可作答",
  };
  for (const action of planned) {
    const icon = action.status === "planned" || action.status === "already-applied" ? "✓" : "✗";
    console.log(`${icon} ${statusLabels[action.status]}｜${action.questionId}｜${action.detail}`);
  }

  const problems = planned.filter(
    (action) =>
      action.status === "missing" || action.status === "conflict" || action.status === "unservable",
  );
  if (problems.length > 0) {
    console.log(`\n共 ${problems.length} 題無法處理；整批不寫入，請先修正決定檔或題目。`);
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

  const resolved: string[] = [];
  for (const action of writable) {
    const question = getQuestion(action.questionId);
    if (!question) fail(`題目 ${action.questionId} 讀取失敗`);
    updateQuestion(question.id, {
      ...question,
      correctAnswer: action.newCorrectAnswer ?? question.correctAnswer,
      qualityWarnings: action.updateWarnings ? action.warnings : question.qualityWarnings,
      teacherConfirmationRequired: false,
    });
    resolved.push(action.questionId);
    console.log(`✓ 已處理｜${action.questionId}`);
  }

  const recordPath = path.resolve("docs/teacher-review/owner-content-repairs-applied.json");
  const existing = fs.existsSync(recordPath)
    ? (JSON.parse(fs.readFileSync(recordPath, "utf8")) as { decisions?: unknown[] })
    : { decisions: [] };
  const decisions = Array.isArray(existing.decisions) ? existing.decisions : [];
  decisions.push({
    decision: "owner-authorized-teacher-confirmation-override",
    decidedBy: actorEmail,
    authorization: plan.authorization ?? null,
    plan: planPath,
    target: databasePath,
    appliedAt: new Date().toISOString(),
    questionIds: [...resolved].sort(),
    correctAnswerRepairs: writable
      .filter((action) => action.newCorrectAnswer !== null)
      .map((action) => ({ questionId: action.questionId, to: action.newCorrectAnswer })),
    note:
      "本決定解除品質閘門的「待教師確認」標記，**沒有**寫入任何覆核紀錄；" +
      "題目在教師端仍標示為「已發布（未經人工覆核）」，歷史準確性仍待歷史科教師覆核。",
  });
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  fs.writeFileSync(recordPath, `${JSON.stringify({ decisions }, null, 2)}\n`, "utf8");
  console.log(`\n✓ 已處理 ${resolved.length} 題。紀錄：${path.relative(process.cwd(), recordPath)}`);
}

main();
