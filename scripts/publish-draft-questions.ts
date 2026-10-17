/**
 * 發布指定狀態為「草稿」的題目（**擁有者授權的批次發布**）。
 *
 * 背景與界線（重要）：
 *   - 平台的發布關卡要求每一題都有對應**目前版本**的人工覆核紀錄
 *     （`question-service.changeQuestionStatus`），這正是為了避免未經核對的題目
 *     出現在學生面前。
 *   - 本腳本**刻意繞過**該關卡，只應在擁有者明確指示時使用（例如第一次上線前，
 *     課本及校內試卷題目已由科組審閱，但未逐題在平台內留下覆核紀錄）。
 *   - 腳本**不會**、也不可以建立任何覆核紀錄：題目在教師端會如實標示為
 *     「已發布（未經人工覆核）」，令之後任何人都看得出哪些題目未經逐題覆核。
 *   - 品質閘門判定**未確定**（`teacher_confirmation_required`：品質閘門無法確認答案依據、
 *     自動發布已被暫緩）的草稿題目**不在候選之列**：這類題目必須由教師核對後逐題發布，
 *     批次發布不能代替教師確認（Sprint 7.9）。腳本會列出被抽起的題數及來源。
 *   - `sourceVerified` 只代表「節錄與所引教材段落逐字相符」，**不代表**史實正確；
 *     這裡亦不進行任何歷史準確性判斷。
 *
 * 用法：
 *   npm run publish:drafts -- --owner-email you@school.edu.hk \
 *     --reason "科組已審閱課本及校內試卷題目，授權上線前先行發布" --apply
 *
 *   預設為**模擬模式**（只列出將發布的題目數量，不會改動資料）。
 *   加 `--apply` 才會寫入，並同時寫出授權紀錄檔（`--record`，預設
 *   docs/teacher-review/owner-publication-overrides.json）。
 *
 * 其他參數：
 *   --origins school-paper,material-ai   只發布指定來源（預設：全部草稿）
 *   --label local|production-snapshot    授權紀錄中的目標標籤（預設 local）
 *   --record <path>                      授權紀錄檔位置（多筆決定會依序附加）
 *
 * 授權紀錄：`docs/teacher-review/owner-publication-overrides.json`（`decisions[]`）。
 *   - 200 題以內會記錄全部題目 ID；更多時改以排序後 ID 清單的 SHA-256 摘要及頭尾樣本記錄，
 *     令紀錄檔仍可人工閱讀（日後可由資料庫重算摘要核對）。
 *
 * 拒絕執行的情況：正式環境（Cloud Run 或 NODE_ENV=production）、缺少 --owner-email
 * 或 --reason。正式環境的資料更新應以「備份快照 + 還原」方式進行（見 README 第十節）。
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { getDb } from "../src/server/db/connection";
import { getServerConfig, isProductionRuntime } from "../src/server/config";
import { QUESTION_ORIGIN_LABELS, type QuestionOrigin } from "../src/lib/types";
import { setQuestionStatus } from "../src/server/repositories/questions";
import { listOwnerPublicationCandidates } from "../src/server/services/question-service";
import { warnIfNpmSwallowedApply } from "./lifecycle-hints";

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

const apply = process.argv.includes("--apply");
warnIfNpmSwallowedApply(apply);
const ownerEmail = (readArg("--owner-email") ?? "").trim();
const reason = (readArg("--reason") ?? "").trim();
const label = readArg("--label") ?? "local";
const recordPath = readArg("--record") ?? "docs/teacher-review/owner-publication-overrides.json";
const originFilter = (readArg("--origins") ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0) as QuestionOrigin[];

function fail(message: string): never {
  console.error(`\n無法執行：${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (isProductionRuntime()) {
    fail(
      "偵測到正式環境（Cloud Run／NODE_ENV=production）。批次發布只可在本機執行，\n" +
        "  再把資料庫快照上載到備份 bucket（見 README 第十節「把本機內容帶到正式環境」）。",
    );
  }
  if (ownerEmail.length === 0) {
    fail("缺少 --owner-email：批次發布必須指明授權的擁有者電郵，令紀錄可追溯至真人。");
  }
  if (reason.length < 10) {
    fail("缺少 --reason（至少 10 個字）：請說明為何未逐題覆核即可發布，以便日後追查。");
  }

  getDb();
  const targetDatabase = getServerConfig().databasePath;

  // 未確定（待教師確認）的題目不在候選之列：批次發布只適用於「科組已審閱但未在平台
  // 逐題留下覆核紀錄」的題目，不能代替教師確認品質閘門無法確認的答案依據
  // （Sprint 7.9；規則見 question-service.listOwnerPublicationCandidates）。
  const { publishable: drafts, held } = listOwnerPublicationCandidates({ origins: originFilter });
  const byOrigin = new Map<string, number>();
  for (const question of drafts) {
    byOrigin.set(question.origin, (byOrigin.get(question.origin) ?? 0) + 1);
  }

  console.log(`可批次發布的草稿題目：${drafts.length} 題`);
  for (const [origin, count] of byOrigin) {
    const label = QUESTION_ORIGIN_LABELS[origin as QuestionOrigin] ?? origin;
    console.log(`  - ${label}（${origin}）：${count} 題`);
  }
  if (held.length > 0) {
    const heldByOrigin = new Map<string, number>();
    for (const question of held) {
      heldByOrigin.set(question.origin, (heldByOrigin.get(question.origin) ?? 0) + 1);
    }
    console.log(
      `\n！另有 ${held.length} 題草稿的品質檢查有未確定項目（例如答案只是教材語句的改寫），` +
        "自動發布已被暫緩，**不會**由本腳本發布：這類題目必須由教師核對後逐題發布" +
        "（人工覆核或重新執行自動品質驗證）。",
    );
    for (const [origin, count] of heldByOrigin) {
      const label = QUESTION_ORIGIN_LABELS[origin as QuestionOrigin] ?? origin;
      console.log(`  - ${label}（${origin}）：${count} 題（待教師確認）`);
    }
  }
  if (drafts.length === 0) {
    console.log(
      held.length > 0
        ? "\n沒有可批次發布的草稿題目（其餘草稿待教師確認），未作任何改動。"
        : "\n沒有符合條件的草稿題目，未作任何改動。",
    );
    return;
  }

  if (!apply) {
    console.log(
      "\n（模擬模式）以上題目**未**發布。要真正發布請加上 --apply，並會同時寫出授權紀錄檔。",
    );
    return;
  }

  const publishedIds: string[] = [];
  for (const question of drafts) {
    const updated = setQuestionStatus(question.id, "published");
    if (!updated) fail(`題目 ${question.id} 狀態更新失敗`);
    publishedIds.push(question.id);
  }

  // 題目數量可能很大（校內試卷可達數千題）：小量時記錄全部 ID，大量時記錄
  // 排序後 ID 清單的 SHA-256 摘要及頭尾樣本，令紀錄檔仍可人工閱讀及覆核。
  const sortedIds = [...publishedIds].sort();
  const decision: Record<string, unknown> = {
    decision: "owner-authorized-publication-without-individual-review",
    label,
    target: targetDatabase,
    ownerEmail,
    reason,
    decidedAt: new Date().toISOString(),
    publishedCount: sortedIds.length,
    publishedByOrigin: Object.fromEntries(byOrigin),
    heldAwaitingTeacherConfirmation: held.length,
    note:
      "這些題目由擁有者授權批次發布，**沒有**逐題人工覆核紀錄，因此教師端會標示為" +
      "「已發布（未經人工覆核）」。`sourceVerified` 只代表節錄與教材段落相符，不代表史實正確；" +
      "歷史準確性仍待合格歷史科教師覆核（見 docs/teacher-review/README.md）。" +
      "品質閘門判定未確定（待教師確認）的草稿題目一律不在本授權範圍之內，沒有被本腳本發布。",
  };
  if (sortedIds.length <= 200) {
    decision.questionIds = sortedIds;
  } else {
    decision.questionIdsDigest = createHash("sha256").update(sortedIds.join("\n")).digest("hex");
    decision.questionIdsSample = [...sortedIds.slice(0, 5), ...sortedIds.slice(-5)];
    decision.questionIdsNote = "題目數量較多，改以排序後 ID 清單的 SHA-256 摘要記錄（可日後重算核對）";
  }

  const absoluteRecordPath = path.resolve(recordPath);
  fs.mkdirSync(path.dirname(absoluteRecordPath), { recursive: true });
  const existing = fs.existsSync(absoluteRecordPath)
    ? (JSON.parse(fs.readFileSync(absoluteRecordPath, "utf8")) as { decisions?: unknown[] })
    : { decisions: [] };
  const decisions = Array.isArray(existing.decisions) ? existing.decisions : [];
  decisions.push(decision);
  fs.writeFileSync(
    absoluteRecordPath,
    `${JSON.stringify({ decisions }, null, 2)}\n`,
    "utf8",
  );

  console.log(`\n✓ 已發布 ${sortedIds.length} 題（狀態：published）。`);
  console.log(`  授權紀錄：${recordPath}（第 ${decisions.length} 筆）`);
  console.log(
    "  提醒：這些題目在教師端顯示為「已發布（未經人工覆核）」；如需正式覆核，" +
      "請教師在 /teacher/questions 逐題覆核（覆核會綁定目前的題目版本）。",
  );
}

main().catch((error) => {
  console.error("批次發布失敗：", error);
  process.exit(1);
});
