/**
 * 依「逐題 AI 核對紀錄」記錄覆核通過並發布（擁有者授權）。
 *
 * 背景：
 *   - `approve:questions` 只按來源整批核准，不檢查任何內容證據。
 *   - 本工具相反：**只**核准有現行版本逐題核對紀錄、且判定為 `correct`、信心達到門檻、
 *     沒有確定性結構問題、並通過 `checkQuestionServable` 的題目。其餘一律保留並列入報告。
 *   - 核對紀錄來自 `scripts/verify-question-answers.mjs` 的輸出（`ai-textbook-verification`）。
 *     本工具本身**不會**改動題幹、選項、答案或解釋，只寫入覆核紀錄及發布狀態。
 *
 * 用法：
 *   npx tsx scripts/approve-verified-questions.ts \
 *     --owner-email you@school.edu.hk \
 *     --reason "擁有者指示：以逐題 AI 核對紀錄覆核本批題目" \
 *     --verification docs/quality/answer-verification-2026-10-21.jsonl \
 *     --verification docs/quality/answer-verification-2026-10-24.jsonl \
 *     --min-confidence 90 --apply \
 *     --report docs/teacher-review/verified-approval-2026-10-24.json \
 *     --report-md docs/teacher-review/verified-approval-2026-10-24.md
 *
 * `--reason` 是 release gate 判斷紀錄來源的唯一依據（見 `quality/review-provenance.ts`）：
 * 以「教師裁決」開頭會歸類為逐題教師覆核，以「擁有者指示」開頭會歸類為擁有者批次授權；
 * 其他寫法一律歸類為來源不明，`review-provenance` 關卡不會把它當作證據。
 *
 * 人工裁決（例如模型誤報）：
 *   --approve-ids <file>   即使核對判定不是 correct 或信心不足，仍核准（需另有裁決紀錄）
 *   --exclude-ids <file>   即使核對判定為 correct，仍然保留交由教師處理
 *
 * 防護：
 *   - 正式環境（Cloud Run／NODE_ENV=production）拒絕執行。
 *   - 覆核紀錄綁定目前版本及內容指紋；`expectedRevision` 不符時 `recordQuestionReview` 會拒絕。
 *   - 預設為模擬模式，加 `--apply` 才寫入。
 */
import fs from "node:fs";
import path from "node:path";

import { getServerConfig, isProductionRuntime } from "../src/server/config";
import { getDb } from "../src/server/db/connection";
import { listQuestionReviews, listQuestions } from "../src/server/repositories/questions";
import { QUESTION_ORIGIN_LABELS, type QuestionOrigin } from "../src/lib/types";
import {
  recordQuestionReview,
  reviewStateFor,
} from "../src/server/services/question-service";
import { checkQuestionServable } from "../src/server/services/question-servability";
import { questionFingerprint } from "../src/server/quality/question-fingerprint";

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

function readArgs(name: string): string[] {
  const values: string[] = [];
  process.argv.forEach((value, index) => {
    if (value === name && process.argv[index + 1]) values.push(process.argv[index + 1]!);
  });
  return values;
}

const apply = process.argv.includes("--apply");
const ownerEmail = (readArg("--owner-email") ?? "").trim();
const role = (readArg("--role") ?? "admin").trim();
const reason = (readArg("--reason") ?? "").trim();
const minConfidence = Number(readArg("--min-confidence") ?? "90");
const includeTeacherConfirmation = process.argv.includes("--include-teacher-confirmation");
const reapproveUnreasoned = process.argv.includes("--reapprove-unreasoned");
const verificationFiles = readArgs("--verification");
const approveIdsFile = readArg("--approve-ids");
const excludeIdsFile = readArg("--exclude-ids");
const reportPath = readArg("--report");
const reportMdPath = readArg("--report-md");

function readIdFile(file: string | null): Set<string> {
  if (!file) return new Set();
  if (!fs.existsSync(file)) fail(`找不到 id 清單：${file}`);
  return new Set(
    fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#")),
  );
}

function fail(message: string): never {
  console.error(`\n無法執行：${message}\n`);
  process.exit(1);
}

interface VerificationRecord {
  id: string;
  revision: number;
  question: string;
  verdict: string;
  confidence: number | null;
  issue?: string;
  correctedAnswer?: string | null;
  reason?: string;
  deterministicIssues?: string[];
  verifiedBy?: string;
  verifiedAt?: string;
  sourceFile: string;
}

interface HeldItem {
  id: string;
  topicId: string;
  sectionId: string;
  origin: string;
  questionType: string;
  reviewState: string;
  status: string;
  reason: string;
  detail: string;
}

interface ApprovedItem {
  id: string;
  topicId: string;
  origin: string;
  questionType: string;
  reviewStateBefore: string;
  statusBefore: string;
  verdict: string;
  confidence: number;
  verifiedAt: string;
  evidence: string;
  publicationChanged: boolean;
}

function loadVerification(files: string[]): Map<string, VerificationRecord> {
  const records = new Map<string, VerificationRecord>();
  for (const file of files) {
    if (!fs.existsSync(file)) fail(`找不到核對紀錄：${file}`);
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const id = String(parsed.id ?? "");
      if (!id) continue;
      records.set(id, {
        id,
        revision: Number(parsed.revision ?? 0),
        question: String(parsed.question ?? ""),
        verdict: String(parsed.verdict ?? "unknown"),
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
        issue: parsed.issue ? String(parsed.issue) : undefined,
        correctedAnswer: (parsed.correctedAnswer as string | null) ?? null,
        reason: parsed.reason ? String(parsed.reason) : undefined,
        deterministicIssues: Array.isArray(parsed.deterministicIssues)
          ? (parsed.deterministicIssues as string[])
          : [],
        verifiedBy: parsed.verifiedBy ? String(parsed.verifiedBy) : undefined,
        verifiedAt: parsed.verifiedAt ? String(parsed.verifiedAt) : undefined,
        sourceFile: path.basename(file),
      });
    }
  }
  return records;
}

function main(): void {
  if (isProductionRuntime()) {
    fail("偵測到正式環境（Cloud Run／NODE_ENV=production）。批次覆核只可在本機執行。");
  }
  if (ownerEmail.length === 0) {
    fail("缺少 --owner-email：覆核紀錄必須可追溯至授權的擁有者電郵。");
  }
  if (reason.length < 10) {
    fail("缺少 --reason（至少 10 個字）：請說明為何可批次記錄覆核通過。");
  }
  if (verificationFiles.length === 0) {
    fail("缺少 --verification：必須提供至少一份逐題核對紀錄（jsonl）。");
  }
  if (!Number.isFinite(minConfidence) || minConfidence <= 0 || minConfidence > 100) {
    fail("--min-confidence 必須介乎 1 至 100。");
  }

  getDb();
  const records = loadVerification(verificationFiles);
  console.log(`目標資料庫：${getServerConfig().databasePath}`);
  console.log(`模式：${apply ? "執行（--apply）" : "模擬（預設，不寫入）"}`);
  console.log(`核對紀錄：${verificationFiles.length} 份，共 ${records.size} 題`);
  console.log(`門檻：verdict = correct、confidence >= ${minConfidence}`);
  console.log(`覆核者：${ownerEmail}（${role}）`);

  const approved: ApprovedItem[] = [];
  const held: HeldItem[] = [];
  const questions = listQuestions();
  const forcedApprove = readIdFile(approveIdsFile);
  const forcedHold = readIdFile(excludeIdsFile);
  let alreadyApproved = 0;

  for (const question of questions) {
    if (question.status === "disabled") continue;
    const stateBefore = reviewStateFor(question);
    let backfill = false;
    if (stateBefore === "approved") {
      if (!reapproveUnreasoned) {
        alreadyApproved += 1;
        continue;
      }
      // 只補寫「現行版本已有批准、但紀錄沒有理由」的題目；理由已存在的紀錄不動。
      const fingerprint = questionFingerprint(question);
      const currentApproved = listQuestionReviews(question.id, 20).filter(
        (review) =>
          review.decision === "approved" &&
          review.revision === question.revision &&
          review.questionFingerprint === fingerprint,
      );
      const hasEmptyReason = currentApproved.some((review) => (review.reason ?? "").trim().length === 0);
      if (!hasEmptyReason || currentApproved.some((review) => (review.reason ?? "").trim().length > 0)) {
        alreadyApproved += 1;
        continue;
      }
      backfill = true;
    }
    const base = {
      id: question.id,
      topicId: question.topicId,
      sectionId: question.sectionId,
      origin: QUESTION_ORIGIN_LABELS[question.origin as QuestionOrigin] ?? question.origin,
      questionType: question.questionType,
      reviewState: stateBefore,
      status: question.status,
    };
    // 「待教師確認」是系統刻意暫緩派發的標記（品質警告未由人解決）。批次授權不會
    // 清除它，除非明確加 --include-teacher-confirmation。
    if (question.teacherConfirmationRequired && !includeTeacherConfirmation) {
      held.push({
        ...base,
        reason: "teacher-confirmation-required",
        detail: "系統標示待教師確認（自動發布暫緩），預設不代為核准",
      });
      continue;
    }
    if (forcedHold.has(question.id)) {
      held.push({
        ...base,
        reason: "excluded-by-adjudication",
        detail: "人工裁決列為需教師處理（見 --exclude-ids 對應的裁決紀錄）",
      });
      continue;
    }
    const record = records.get(question.id);
    const forced = forcedApprove.has(question.id);
    if (!record) {
      held.push({
        ...base,
        reason: "no-verification-record",
        detail: "沒有任何逐題核對紀錄",
      });
      continue;
    }
    if (record.revision !== question.revision || record.question !== question.question) {
      held.push({
        ...base,
        reason: "stale-verification",
        detail: `核對紀錄為第 ${record.revision} 版，題目現為第 ${question.revision} 版（或題幹已改動）`,
      });
      continue;
    }
    if (record.verdict !== "correct" && !forced) {
      held.push({
        ...base,
        reason: `verdict-${record.verdict}`,
        detail: `${record.issue ?? "未分類"}：${record.reason ?? ""}` + (record.correctedAnswer ? `（建議答案：${record.correctedAnswer}）` : ""),
      });
      continue;
    }
    if ((record.deterministicIssues ?? []).length > 0) {
      held.push({
        ...base,
        reason: "deterministic-issue",
        detail: (record.deterministicIssues ?? []).join("、"),
      });
      continue;
    }
    if (!forced && (record.confidence === null || record.confidence < minConfidence)) {
      held.push({
        ...base,
        reason: "low-confidence",
        detail: `信心 ${record.confidence ?? "未提供"} 低於門檻 ${minConfidence}`,
      });
      continue;
    }
    const servability = checkQuestionServable(question);
    if (!servability.ok) {
      held.push({
        ...base,
        reason: "unservable",
        detail: servability.reason ?? "題目結構不可作答",
      });
      continue;
    }

    if (apply) {
      try {
        const result = recordQuestionReview({
          questionId: question.id,
          decision: "approved",
          reason,
          expectedRevision: question.revision,
          actor: { email: ownerEmail, role },
          // 補寫既有批准的理由時，同一版本可能已有 approved 紀錄（沒有理由），
          // 必須強制新增一筆，否則唯一索引會把這次紀錄丟棄。
          forceNew: backfill,
        });
        approved.push({
          id: question.id,
          topicId: question.topicId,
          origin: base.origin,
          questionType: question.questionType,
          reviewStateBefore: stateBefore,
          statusBefore: question.status,
          verdict: record.verdict,
          confidence: Number(record.confidence ?? 0),
          verifiedAt: record.verifiedAt ?? "",
          evidence: forced ? `${record.sourceFile} + 人工裁決` : record.sourceFile,
          publicationChanged: result.view.question.status === "published" && question.status !== "published",
        });
      } catch (error) {
        held.push({
          ...base,
          reason: "review-rejected",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      approved.push({
        id: question.id,
        topicId: question.topicId,
        origin: base.origin,
        questionType: question.questionType,
        reviewStateBefore: stateBefore,
        statusBefore: question.status,
        verdict: record.verdict,
        confidence: Number(record.confidence ?? 0),
        verifiedAt: record.verifiedAt ?? "",
        evidence: forced ? `${record.sourceFile} + 人工裁決` : record.sourceFile,
        publicationChanged: false,
      });
    }
  }

  const byOrigin = new Map<string, number>();
  const byTopic = new Map<string, number>();
  for (const item of approved) {
    byOrigin.set(item.origin, (byOrigin.get(item.origin) ?? 0) + 1);
    byTopic.set(item.topicId, (byTopic.get(item.topicId) ?? 0) + 1);
  }
  const heldByReason = new Map<string, number>();
  for (const item of held) {
    heldByReason.set(item.reason, (heldByReason.get(item.reason) ?? 0) + 1);
  }

  console.log(`\n已核准（${apply ? "已寫入" : "模擬"}）：${approved.length} 題`);
  const backfilled = approved.filter((item) => item.reviewStateBefore === "approved").length;
  if (reapproveUnreasoned) console.log(`  其中補寫原有批准的理由：${backfilled} 題`);
  console.log(`保留（未核准）：${held.length} 題`);
  console.log(`原本已是「覆核通過」而略過：${alreadyApproved} 題`);
  for (const [key, count] of [...heldByReason.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  保留原因 ${key}：${count}`);
  }
  if (approved.length > 0) {
    console.log("已核准來源：");
    for (const [key, count] of [...byOrigin.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${key}：${count}`);
    }
  }

  if (reportPath) {
    fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
    fs.writeFileSync(
      path.resolve(reportPath),
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          applied: apply,
          database: getServerConfig().databasePath,
          reviewer: { email: ownerEmail, role },
          reason,
          thresholds: { minConfidence, verdict: "correct" },
          verificationFiles,
          totals: {
            approved: approved.length,
            held: held.length,
            alreadyApproved,
          },
          approvedByOrigin: Object.fromEntries([...byOrigin.entries()].sort()),
          approvedByTopic: Object.fromEntries([...byTopic.entries()].sort()),
          heldByReason: Object.fromEntries([...heldByReason.entries()].sort()),
          approved,
          held,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    console.log(`\n已寫入報告：${reportPath}`);
  }

  if (reportMdPath) {
    const lines: string[] = [];
    lines.push("# 逐題核對後的覆核通過紀錄");
    lines.push("");
    lines.push(`- 資料庫：\`${getServerConfig().databasePath}\``);
    lines.push(`- 覆核者：\`${ownerEmail}\`（${role}）`);
    lines.push(`- 理由：${reason}`);
    lines.push(`- 門檻：\`verdict = correct\`、信心 ≥ ${minConfidence}、無確定性結構問題、可作答`);
    lines.push(`- 核對紀錄：${verificationFiles.map((file) => `\`${path.basename(file)}\``).join("、")}`);
    lines.push(`- 模式：${apply ? "**已寫入**" : "模擬（未寫入）"}`);
    lines.push("");
    lines.push("## 結果");
    lines.push("");
    lines.push("| 項目 | 題數 |");
    lines.push("| --- | --- |");
    lines.push(`| 已核准 | ${approved.length} |`);
    lines.push(`| 保留（未核准） | ${held.length} |`);
    lines.push(`| 原本已通過（略過） | ${alreadyApproved} |`);
    lines.push("");
    lines.push("## 保留原因");
    lines.push("");
    lines.push("| 原因 | 題數 |");
    lines.push("| --- | --- |");
    for (const [key, count] of [...heldByReason.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`| \`${key}\` | ${count} |`);
    }
    lines.push("");
    lines.push("## 保留題目（最多 200 題）");
    lines.push("");
    for (const item of held.slice(0, 200)) {
      lines.push(`- \`${item.id}\`（${item.topicId}，${item.reason}）：${item.detail}`);
    }
    fs.mkdirSync(path.dirname(path.resolve(reportMdPath)), { recursive: true });
    fs.writeFileSync(path.resolve(reportMdPath), `${lines.join("\n")}\n`, "utf8");
    console.log(`已寫入報告：${reportMdPath}`);
  }

  if (!apply) console.log("\n（模擬模式）未寫入任何覆核紀錄。要真正覆核並發布請加上 --apply。");
}

main();

