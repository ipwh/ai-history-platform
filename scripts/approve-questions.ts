/**
 * 擁有者授權：把題庫題目逐題記錄為「已覆核通過」並發布。
 *
 * 背景：
 *   - 校內試題匯入後一律為草稿，教師需逐題覆核；`publish:drafts` 只會發布，
 *     **不會**留下覆核紀錄（教師端會標示「已發布（未經人工覆核）」）。
 *   - 當擁有者明確指示「本批匯入的題目一律覆核通過並發布」時，本腳本為每題
 *     寫入一筆 `approved` 覆核紀錄（綁定目前版本及內容指紋），並把狀態設為
 *     `published`。之後教師仍可在「題目管理」看到覆核者及時間。
 *
 * 用法：
 *   npm run approve:questions -- --owner-email you@school.edu.hk \
 *     --reason "擁有者指示：本批匯入題目一律覆核通過" --apply
 *
 * 其他參數：
 *   --origins school-paper,material-ai   只處理指定來源（預設 school-paper）
 *   --topic topic-1                      只處理指定課題
 *   --role owner|admin                   覆核者角色（預設 admin）
 *
 * 拒絕執行的情況：正式環境（Cloud Run／NODE_ENV=production）、缺少 --owner-email
 * 或 --reason。預設為模擬模式，加 `--apply` 才會寫入。
 *
 * 批次覆核**不會**處理帶有「待教師確認」標記的題目（`teacherConfirmationRequired`）：
 * 那些題目的考核內容仍有未確定項目（例如自動修復改變了答案對應），只有教師的人工
 * 決定可以解除暫緩。腳本會列出被保留的題目，方便教師逐題處理。
 */
import { getServerConfig, isProductionRuntime } from "../src/server/config";
import { getDb } from "../src/server/db/connection";
import { QUESTION_ORIGIN_LABELS, type QuestionOrigin } from "../src/lib/types";
import {
  listOwnerApprovalCandidates,
  recordQuestionReview,
} from "../src/server/services/question-service";

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

const apply = process.argv.includes("--apply");
const ownerEmail = (readArg("--owner-email") ?? "").trim();
const role = (readArg("--role") ?? "admin").trim();
const reason = (readArg("--reason") ?? "").trim();
const topicId = (readArg("--topic") ?? "").trim() || null;
const origins = ((readArg("--origins") ?? "school-paper")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0)) as QuestionOrigin[];

function fail(message: string): never {
  console.error(`\n無法執行：${message}\n`);
  process.exit(1);
}

function main(): void {
  if (isProductionRuntime()) {
    fail("偵測到正式環境（Cloud Run／NODE_ENV=production）。批次覆核只可在本機執行。");
  }
  if (ownerEmail.length === 0) {
    fail("缺少 --owner-email：批次覆核必須指明授權的擁有者電郵，令紀錄可追溯至真人。");
  }
  if (reason.length < 10) {
    fail("缺少 --reason（至少 10 個字）：請說明為何可整批覆核通過。");
  }

  getDb();
  console.log(`目標資料庫：${getServerConfig().databasePath}`);
  console.log(`模式：${apply ? "執行（--apply）" : "模擬（預設，不寫入）"}`);
  console.log(`來源：${origins.map((origin) => QUESTION_ORIGIN_LABELS[origin] ?? origin).join("、")}`);
  if (topicId) console.log(`課題：${topicId}`);

  const { approvable, held } = listOwnerApprovalCandidates({
    ...(origins.length > 0 ? { origins } : {}),
    ...(topicId ? { topicId } : {}),
  });
  console.log(`\n符合條件的題目：${approvable.length + held.length} 題`);
  console.log(`可批次覆核：${approvable.length} 題`);
  if (held.length > 0) {
    console.log(
      `\n保留（待教師確認，批次覆核不會處理）：${held.length} 題`,
    );
    for (const question of held) {
      console.log(`  - ${question.id}（${question.status}，rev ${question.revision}）`);
    }
    console.log(
      "  這些題目只可由教師在「題目管理」逐題核對後決定（核准／退回／拒絕）。",
    );
  }

  let created = 0;
  let alreadyReviewed = 0;
  let approved = 0;
  let published = 0;
  for (const question of approvable) {
    if (!apply) continue;
    const result = recordQuestionReview({
      questionId: question.id,
      decision: "approved",
      reason,
      expectedRevision: question.revision,
      actor: { email: ownerEmail, role },
    });
    if (result.created) created += 1;
    else alreadyReviewed += 1;
    if (result.view.reviewState === "approved") approved += 1;
    if (result.view.question.status === "published") published += 1;
  }

  if (!apply) {
    console.log("\n（模擬模式）未寫入。要真正覆核並發布請加上 --apply。");
    return;
  }
  console.log(
    `\n✓ 已覆核並發布：新增覆核紀錄 ${created} 筆、已存在覆核紀錄 ${alreadyReviewed} 題；` +
      `覆核狀態為「通過」${approved} 題、狀態為已發布 ${published} 題。`,
  );
}

main();
