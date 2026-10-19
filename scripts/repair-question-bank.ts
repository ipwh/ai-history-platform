/**
 * 修復題庫中「結構上無法作答」的題目（由模擬學生使用發現）。
 *
 * 實際缺陷（2026-10-18 模擬 12 個課題、58 次練習後量度）：
 *   - 923 題填充題之中，574 題的題幹有 2–5 個空格，但答案區只記錄 1 個答案。
 *     平台的作答介面每題只有一個輸入框，評分亦只比對一個答案，因此學生見到
 *     多個空格卻只能填一個，其餘空格永遠沒有答案可對。
 *   - 1 題填充題的題幹完全沒有空格（原檔以 Word 底線排版，轉換成文字後消失）。
 *   - 92 題選擇題的選項保留了原檔的項目符號（「. i和ii」），1 題的選項在解析後
 *     全部變成「.」，學生無法作答。
 *
 * 處理方式（2026-10-19 修訂：見 services/question-repair.ts）：
 *   1. **可安全還原的多空格填充題**（補回其餘空格的答案後，仍考核**原第 1 個空格**，
 *      考核答案不變）：改寫題幹，只保留一個空格。
 *   2. **選項項目符號**：移除，令學生看到的選項與原卷一致（語意不變）。
 *   3. **會改變考核內容的改寫**（保留其他空格才不會令答案外洩，但答案會由第 1 個
 *      空格變成第 N 個）：**不改寫**，保留原題供教師比較，並標示「待教師確認」，
 *      學生不會收到；不會記錄任何覆核。
 *   4. **其餘無法修復的題目**（空格數與答案數不符、題幹沒有空格、選項失效、
 *      答案已在題幹出現）：標示為「待教師確認」，學生端不會再收到。
 *   5. 已發布而**安全改寫**的題目：內容已改變，舊覆核紀錄不再對應目前版本，
 *      以 `reviewer_role = automation` 及 `[automation]` 理由補記一次覆核，
 *      如實標明是自動格式整理。**絕不以教師身分寫入。**
 *
 * 本腳本可重複執行（idempotent）：已整理好的題目不會再被改動；由本腳本標示的
 * 「待教師確認」在題目重新變得可用時會自動清除（其他來源的標記不受影響）。
 *
 * 用法：
 *   npm run repair:questions -- --owner-email you@school.edu.hk          # 模擬
 *   npm run repair:questions -- --owner-email you@school.edu.hk --apply  # 執行
 *   # 同時刪除結構上無法修復的題目（擁有者指示；預設不刪除）
 *   # 注意：只會刪除「結構上無法作答」的題目，不會刪除待教師確認考核內容的題目。
 *   npm run repair:questions -- --delete-unusable --apply --owner-email you@school.edu.hk
 *
 *   # 只隔離（不改內容）已被證實改變考核答案的題目（清單由 audit-repair-provenance 產生）
 *   npm run repair:questions -- --quarantine docs/teacher-review/repair-provenance-2026-10-19.json
 *   npm run repair:questions -- --quarantine docs/teacher-review/repair-provenance-2026-10-19.json --apply --owner-email you@school.edu.hk
 *
 * 只可在本機執行（正式環境拒絕），並建議先備份資料庫。
 */
import type { Question } from "../src/lib/types";
import fs from "node:fs";
import path from "node:path";

import { getServerConfig, isProductionRuntime } from "../src/server/config";
import { getDb } from "../src/server/db/connection";
import { getQuestion, listQuestions, updateQuestion } from "../src/server/repositories/questions";
import { recordQuestionReview } from "../src/server/services/question-service";
import {
  AUTO_QUARANTINE_PREFIX,
  nextTeacherConfirmationFlag,
  planQuestionRepair,
  repairWarnings,
  type RepairPlan,
} from "../src/server/services/question-repair";

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

const apply = process.argv.includes("--apply");
const ownerEmail = (readArg("--owner-email") ?? "").trim();
/**
 * 本腳本寫入的覆核紀錄一律標示為自動化，不會冒充教師或管理員的人工覆核。
 * `--role` 只為兼容舊有指令而接受，實際寫入的角色固定為 automation。
 */
const AUTOMATION_ROLE = "automation";
/**
 * 刪除無法修復的題目（擁有者指示）。只會刪除「結構上無法作答」且已由本腳本
 * 標示待教師確認的題目；因改變考核內容而待確認的題目**不會**被刪除。
 */
const deleteUnusable = process.argv.includes("--delete-unusable");
/**
 * 只隔離（不修改內容）在自動修復後被改動考核答案的題目。
 *
 * 用法：`--quarantine <manifest.json>`，manifest 為 `scripts/audit-repair-provenance.ts`
 * 產生的報告（讀取 `affectedQuestionIds`）。預設模擬；要寫入需同時加 `--apply`。
 */
const quarantineManifest = readArg("--quarantine");

function runQuarantine(manifestPath: string): void {
  const resolved = path.resolve(manifestPath);
  const manifest = JSON.parse(fs.readFileSync(resolved, "utf8")) as {
    affectedQuestionIds?: string[];
    affected?: { id: string; notes?: string[] }[];
  };
  const ids = manifest.affectedQuestionIds ?? manifest.affected?.map((item) => item.id) ?? [];
  const notesById = new Map(
    (manifest.affected ?? []).map((item) => [item.id, (item.notes ?? []).join("；")]),
  );
  if (ids.length === 0) {
    console.log("隔離清單為空：沒有需要處理的題目。");
    return;
  }

  let quarantined = 0;
  let already = 0;
  let missing = 0;
  for (const id of ids) {
    const question = getQuestion(id);
    if (!question) {
      missing += 1;
      continue;
    }
    if (question.teacherConfirmationRequired) {
      already += 1;
      continue;
    }
    const detail = notesById.get(id) ?? "自動修復後被考核的空格已改變";
    const warning = `${AUTO_QUARANTINE_PREFIX}${detail}；須由教師核對原卷後確認，學生暫時不會收到這一題。`;
    if (apply) {
      updateQuestion(id, {
        ...question,
        teacherConfirmationRequired: true,
        qualityWarnings: [...question.qualityWarnings, warning],
      });
    }
    quarantined += 1;
  }

  console.log(`\n隔離清單：${ids.length} 題`);
  console.log(`${apply ? "已隔離" : "將隔離（模擬）"}：${quarantined} 題`);
  console.log(`已標示待教師確認：${already} 題`);
  console.log(`資料庫找不到：${missing} 題`);
  console.log(
    apply
      ? "✓ 已寫入。這些題目不會派給學生，亦沒有記錄任何覆核。"
      : "（模擬模式）未寫入。要真正隔離請加上 --apply。",
  );
}

interface AppliedPlan {
  original: Question;
  plan: RepairPlan;
  finalQuestion: Question;
  shouldWrite: boolean;
}

function main(): void {
  if (isProductionRuntime()) {
    console.error("\n無法執行：偵測到正式環境（Cloud Run／NODE_ENV=production）。\n");
    process.exit(1);
  }
  if (apply && ownerEmail.length === 0) {
    console.error("\n無法執行：--apply 需要 --owner-email，令改寫後的覆核紀錄可追溯至授權者。\n");
    process.exit(1);
  }
  if (readArg("--role") !== null) {
    console.warn("\n提示：--role 已不再使用；本腳本寫入的覆核紀錄一律標示為 automation。\n");
  }

  getDb();
  console.log(`目標資料庫：${getServerConfig().databasePath}`);
  console.log(`模式：${apply ? "執行（--apply）" : "模擬（預設，不寫入）"}`);

  if (quarantineManifest !== null) {
    runQuarantine(quarantineManifest);
    return;
  }

  const questions = listQuestions({ questionTypes: ["fill", "mc"] });
  const applied: AppliedPlan[] = [];
  const rewritten: AppliedPlan[] = [];
  const blocked: AppliedPlan[] = [];
  const unusable: AppliedPlan[] = [];
  const reviewRequired: AppliedPlan[] = [];
  const unblocked: AppliedPlan[] = [];
  const failures: { id: string; error: string }[] = [];

  for (const original of questions) {
    const plan = planQuestionRepair(original);
    const nextWarnings = repairWarnings(original, plan);
    const nextFlag = nextTeacherConfirmationFlag(original, plan);
    const warningsChanged =
      nextWarnings.length !== original.qualityWarnings.length ||
      nextWarnings.some((warning, index) => warning !== original.qualityWarnings[index]);
    const flagChanged = nextFlag !== original.teacherConfirmationRequired;
    const shouldWrite = plan.changed || warningsChanged || flagChanged;

    const finalQuestion: Question = shouldWrite
      ? {
          ...plan.question,
          qualityWarnings: nextWarnings,
          teacherConfirmationRequired: nextFlag,
        }
      : original;

    const entry: AppliedPlan = { original, plan, finalQuestion, shouldWrite };
    applied.push(entry);

    if (shouldWrite && apply) {
      try {
        updateQuestion(original.id, finalQuestion);
      } catch (error) {
        failures.push({ id: original.id, error: String(error).slice(0, 400) });
      }
    }

    if (plan.changed) rewritten.push(entry);
    if (plan.blocked) blocked.push(entry);
    if (plan.unusable) unusable.push(entry);
    if (plan.requiresReview) reviewRequired.push(entry);
    if (
      !plan.blocked &&
      original.teacherConfirmationRequired &&
      nextFlag === false
    ) {
      unblocked.push(entry);
    }
  }

  const appliedById = new Map(applied.map((entry) => [entry.original.id, entry]));

  // 已發布而被**安全**改寫的題目：內容已改變，舊覆核紀錄不再對應目前版本，
  // 以 automation 身分補記一次覆核（理由如實說明是自動格式整理）。
  // 改變考核內容或結構失敗的題目不會被補記覆核。
  let refreshed = 0;
  if (apply) {
    const stale = getDb()
      .prepare(
        `SELECT id FROM questions q
          WHERE q.status = 'published'
            AND q.origin = 'school-paper'
            AND q.teacher_confirmation_required = 0
            AND EXISTS (SELECT 1 FROM question_reviews r WHERE r.question_id = q.id AND r.decision = 'approved')
            AND NOT EXISTS (
              SELECT 1 FROM question_reviews r
               WHERE r.question_id = q.id AND r.decision = 'approved' AND r.revision = q.revision
            )`,
      )
      .all() as unknown as { id: string }[];
    for (const row of stale) {
      const entry = appliedById.get(row.id);
      if (!entry || !entry.plan.changed || entry.plan.blocked || entry.plan.reviewReason === null) {
        continue;
      }
      const current = getQuestion(row.id);
      if (!current || current.status !== "published" || current.teacherConfirmationRequired) continue;
      recordQuestionReview({
        questionId: current.id,
        decision: "approved",
        reason: entry.plan.reviewReason,
        expectedRevision: current.revision,
        actor: { email: ownerEmail, role: AUTOMATION_ROLE },
      });
      refreshed += 1;
    }
  }

  console.log(`\n掃描題目：${questions.length} 題`);
  console.log(`安全改寫（格式／考核答案不變）：${rewritten.length} 題`);
  console.log(`因會改變考核內容而不改寫、待教師確認：${reviewRequired.length} 題`);
  console.log(`結構上無法作答、待教師確認：${unusable.length} 題`);
  console.log(`重新可用而清除標記：${unblocked.length} 題`);
  if (apply) console.log(`以 automation 身分補記覆核：${refreshed} 題`);
  if (failures.length > 0) {
    console.log(`\n⚠ ${failures.length} 題寫入失敗（未修改，題目保持原狀）：`);
    for (const failure of failures.slice(0, 5)) {
      console.log(`  · ${failure.id}｜${failure.error}`);
    }
  }

  if (rewritten.length > 0) {
    console.log("\n安全改寫樣本：");
    for (const entry of rewritten.slice(0, 4)) {
      console.log(`  · ${entry.finalQuestion.id}｜答案：${entry.finalQuestion.correctAnswer}`);
      console.log(`    修改前：${entry.plan.before ?? ""}`);
      console.log(`    修改後：${entry.plan.after ?? ""}`);
    }
  }
  if (reviewRequired.length > 0) {
    console.log("\n改變考核內容（不改寫，待教師確認）：");
    for (const entry of reviewRequired.slice(0, 10)) {
      console.log(`  · ${entry.original.id}｜${entry.plan.note ?? ""}`);
    }
    if (reviewRequired.length > 10) console.log(`  …其餘 ${reviewRequired.length - 10} 題`);
  }
  if (unusable.length > 0) {
    console.log("\n結構上無法作答：");
    for (const entry of unusable.slice(0, 10)) {
      console.log(`  · ${entry.original.id}｜${entry.plan.note ?? ""}`);
    }
    if (unusable.length > 10) console.log(`  …其餘 ${unusable.length - 10} 題`);
  }
  console.log(
    apply
      ? `\n✓ 已寫入。${blocked.length} 題暫時不會派給學生` +
          `${deleteUnusable ? "；結構上無法作答者會按 --delete-unusable 刪除（見下）" : "，請在「題目管理」按原卷處理"}。`
      : "\n（模擬模式）未寫入。要真正修復請加上 --apply。",
  );

  /* ---------------------------------------------------------------- */
  /* 刪除無法修復的題目（--delete-unusable）                            */
  /* ---------------------------------------------------------------- */
  if (!deleteUnusable || unusable.length === 0) return;

  // 只刪除結構上無法作答的題目；改變考核內容的題目必須保留原卷內容供教師核對。
  const ids = unusable.map((entry) => entry.original.id);
  const placeholders = ids.map(() => "?").join(",");
  const snapshotSessions = getDb()
    .prepare("SELECT id, question_snapshot_json AS json FROM practice_sessions")
    .all() as unknown as { id: string; json: string }[];
  let removedFromSnapshots = 0;
  let emptiedSessions = 0;
  const snapshotUpdates: { id: string; json: string | null }[] = [];

  for (const session of snapshotSessions) {
    let snapshot: { id?: string }[];
    try {
      snapshot = JSON.parse(session.json) as { id?: string }[];
    } catch {
      continue;
    }
    const kept = snapshot.filter((question) => !question.id || !ids.includes(question.id));
    if (kept.length === snapshot.length) continue;
    removedFromSnapshots += snapshot.length - kept.length;
    if (kept.length === 0) emptiedSessions += 1;
    snapshotUpdates.push({ id: session.id, json: kept.length === 0 ? null : JSON.stringify(kept) });
  }

  console.log(
    `\n刪除結構上無法作答的題目：${ids.length} 題；練習快照需移除 ${removedFromSnapshots} 處` +
      `（其中 ${emptiedSessions} 次練習會因此沒有題目而一併刪除）。`,
  );

  if (!apply) {
    console.log("（模擬模式）未刪除。要真正刪除請加上 --apply。");
    return;
  }

  const db = getDb();
  for (const update of snapshotUpdates) {
    if (update.json === null) {
      db.prepare("DELETE FROM attempts WHERE session_id = ?").run(update.id);
      db.prepare("DELETE FROM practice_sessions WHERE id = ?").run(update.id);
    } else {
      db.prepare("UPDATE practice_sessions SET question_snapshot_json = ? WHERE id = ?").run(
        update.json,
        update.id,
      );
    }
  }
  db.prepare(`DELETE FROM attempts WHERE question_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM question_reviews WHERE question_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM question_reports WHERE question_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM questions WHERE id IN (${placeholders})`).run(...ids);
  console.log(`✓ 已刪除 ${ids.length} 題及其覆核紀錄。`);
}

main();
