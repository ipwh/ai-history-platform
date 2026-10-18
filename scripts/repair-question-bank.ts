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
 * 修復方式：
 *   1. **多空格填充題**：由評卷參考（「填充題答案（依空格次序）：(1) …、(2) …」）
 *      還原每個空格的答案，把其餘空格的答案填回題幹，只保留一個空格；被考核的
 *      答案不會在題幹其他位置出現（自動逐一嘗試）。考核的史實不變、答案不變。
 *   2. **選項開頭的項目符號**：移除，令學生看到的選項與原卷一致。
 *   3. **其餘無法修復的題目**（空格數與答案數不符、題幹沒有空格、選項失效、
 *      答案已在題幹出現）：標示為「待教師確認」，學生端不會再收到
 *      （見 services/question-servability.ts）。
 *   4. 已發布而被改寫的題目，會以擁有者身分重新記錄一次覆核（內容已改變，
 *      舊覆核紀錄會自然失效），覆核原因會寫明是自動修復。
 *
 * 本腳本可重複執行（idempotent）：已修好的題目不會再被改動；由本腳本標示的
 * 「待教師確認」在題目重新變得可用時會自動清除（其他來源的標記不受影響）。
 *
 * 用法：
 *   npm run repair:questions -- --owner-email you@school.edu.hk          # 模擬
 *   npm run repair:questions -- --owner-email you@school.edu.hk --apply  # 執行
 *   # 同時刪除無法修復的題目（擁有者指示；預設不刪除）
 *   npm run repair:questions -- --delete-unusable --apply --owner-email you@school.edu.hk
 *
 * 只可在本機執行（正式環境拒絕），並建議先備份資料庫。
 */
import type { Question } from "../src/lib/types";
import { getServerConfig, isProductionRuntime } from "../src/server/config";
import { getDb } from "../src/server/db/connection";
import { countBlankMarkers } from "../src/server/llm/fill-question";
import { blankAnswersFromExplanation, normaliseMultiBlankFill } from "../src/server/materials/question-bank";
import { getQuestion, listQuestions, updateQuestion } from "../src/server/repositories/questions";
import { recordQuestionReview } from "../src/server/services/question-service";
import { checkQuestionServable } from "../src/server/services/question-servability";

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

const apply = process.argv.includes("--apply");
const ownerEmail = (readArg("--owner-email") ?? "").trim();
const role = (readArg("--role") ?? "admin").trim();
/**
 * 刪除無法修復的題目（擁有者指示）。只會刪除「由本腳本標示待教師確認」且
 * 結構上確實無法作答的題目；其他待確認題目（例如 AI 品質疑問）不會被刪除。
 */
const deleteUnusable = process.argv.includes("--delete-unusable");

/** 本腳本寫入的品質警告前綴（用以分辨其他來源的警告及標記） */
const AUTO_PREFIX = "平台自動檢查：";

interface Plan {
  question: Question;
  changed: boolean;
  blocked: boolean;
  note: string | null;
  before?: string;
  after?: string;
}

function autoWarnings(question: Question): string[] {
  return question.qualityWarnings.filter((warning) => warning.startsWith(AUTO_PREFIX));
}

function otherWarnings(question: Question): string[] {
  return question.qualityWarnings.filter((warning) => !warning.startsWith(AUTO_PREFIX));
}

/** 移除選項開頭殘留的項目符號（原檔寫成「A. . i和ii」） */
function cleanBullet(value: string): string {
  return value.replace(/^[.．·•‧]\s*/, "").trim();
}

/** 多空格填充題：可還原時改寫成單一空格，否則回傳原因 */
function normaliseFill(question: Question): { rewritten: Question; note: string } | { reason: string } | null {
  const blanks = countBlankMarkers(question.question);
  if (blanks <= 1) return null;
  const answers = [question.correctAnswer, ...question.gradingPoints]
    .map((answer) => answer.trim())
    .filter((answer) => answer.length > 0);
  const normalised =
    normaliseMultiBlankFill(question.question, answers) ??
    normaliseMultiBlankFill(question.question, blankAnswersFromExplanation(question.explanation));
  if (normalised === null) {
    return {
      reason: `題幹有 ${blanks} 個空格，但只有 ${answers.length} 個答案，未能還原其餘空格的答案`,
    };
  }
  return {
    rewritten: {
      ...question,
      question: normalised.question,
      correctAnswer: normalised.correctAnswer,
    },
    note: `原題有 ${blanks} 個空格，已把其餘空格的答案（${normalised.filled
      .map((entry) => entry.answer)
      .join("、")}）填入題幹，只考核一個空格`,
  };
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

  getDb();
  console.log(`目標資料庫：${getServerConfig().databasePath}`);
  console.log(`模式：${apply ? "執行（--apply）" : "模擬（預設，不寫入）"}`);

  const questions = listQuestions({ questionTypes: ["fill", "mc"] });
  const rewritten: Plan[] = [];
  const blocked: Plan[] = [];
  const unblocked: Plan[] = [];
  const failures: { id: string; error: string }[] = [];

  for (const original of questions) {
    let candidate = original;
    let changed = false;
    let note: string | null = null;
    let before: string | undefined;
    let after: string | undefined;

    if (original.questionType === "fill") {
      const outcome = normaliseFill(original);
      if (outcome !== null) {
        if ("rewritten" in outcome) {
          candidate = outcome.rewritten;
          changed = true;
          note = outcome.note;
          before = original.question;
          after = outcome.rewritten.question;
        } else {
          note = outcome.reason;
        }
      }
    } else {
      const options = original.options.map(cleanBullet);
      const answer = cleanBullet(original.correctAnswer);
      const cleanupSafe = options.every((option) => option.length > 0) && answer.length > 0;
      if (
        cleanupSafe &&
        (answer !== original.correctAnswer ||
          options.some((option, index) => option !== original.options[index]))
      ) {
        candidate = { ...original, options, correctAnswer: answer };
        changed = true;
        note = "已移除選項開頭殘留的項目符號（原檔的排版符號）";
        before = original.options.join(" ／ ");
        after = options.join(" ／ ");
      }
    }

    // 改寫後（或原本）的結構檢查：這是「是否可以派給學生」的單一判斷來源
    const check = checkQuestionServable(candidate);
    const isBlocked = !check.ok;
    if (isBlocked) note = check.reason ?? "結構不完整";

    const wasAutoFlagged = autoWarnings(original).length > 0 && original.teacherConfirmationRequired;
    // 由本腳本標示的題目，在重新變得可用時清除標記；其他來源的標記不動
    const nextFlag = isBlocked ? true : wasAutoFlagged ? false : original.teacherConfirmationRequired;

    const notes: string[] = [];
    if (note !== null) {
      notes.push(
        isBlocked
          ? `${AUTO_PREFIX}${note}；此題暫時不會派給學生，請按原卷修正。`
          : `${AUTO_PREFIX}${note}。`,
      );
    }
    const nextWarnings = [...otherWarnings(original), ...notes];
    const warningsChanged =
      nextWarnings.length !== original.qualityWarnings.length ||
      nextWarnings.some((warning, index) => warning !== original.qualityWarnings[index]);

    const plan: Plan = { question: candidate, changed, blocked: isBlocked, note, before, after };
    if (changed || warningsChanged || nextFlag !== original.teacherConfirmationRequired) {
      plan.question = {
        ...candidate,
        qualityWarnings: nextWarnings,
        teacherConfirmationRequired: nextFlag,
      };
      if (apply) {
        try {
          updateQuestion(original.id, plan.question);
        } catch (error) {
          failures.push({ id: original.id, error: String(error).slice(0, 400) });
        }
      }
    }

    if (changed) rewritten.push(plan);
    if (isBlocked) blocked.push(plan);
    if (!isBlocked && wasAutoFlagged) unblocked.push(plan);
  }

  // 已發布而被改寫的題目：內容已改變，舊覆核紀錄不再對應目前版本，
  // 由擁有者以同一個原因重新記錄覆核（被標示待確認的題目不會被重新覆核）。
  let refreshed = 0;
  if (apply) {
    const reason = "模擬學生使用後自動修復：只把多餘空格的答案填入題幹／移除排版符號，考核的答案不變";
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
      const current = getQuestion(row.id);
      if (!current || current.status !== "published" || current.teacherConfirmationRequired) continue;
      recordQuestionReview({
        questionId: current.id,
        decision: "approved",
        reason,
        expectedRevision: current.revision,
        actor: { email: ownerEmail, role },
      });
      refreshed += 1;
    }
  }

  console.log(`\n掃描題目：${questions.length} 題`);
  console.log(`改寫（多空格／排版符號）：${rewritten.length} 題`);
  console.log(`標示待教師確認（無法自動修復）：${blocked.length} 題`);
  console.log(`重新可用而清除標記：${unblocked.length} 題`);
  if (apply) console.log(`重新記錄覆核：${refreshed} 題`);
  if (failures.length > 0) {
    console.log(`\n⚠ ${failures.length} 題寫入失敗（未修改，題目保持原狀）：`);
    for (const failure of failures.slice(0, 5)) {
      console.log(`  · ${failure.id}｜${failure.error}`);
    }
  }

  if (rewritten.length > 0) {
    console.log("\n改寫樣本：");
    for (const plan of rewritten.slice(0, 4)) {
      console.log(`  · ${plan.question.id}｜答案：${plan.question.correctAnswer}`);
      console.log(`    修改前：${plan.before ?? ""}`);
      console.log(`    修改後：${plan.after ?? ""}`);
    }
  }
  if (blocked.length > 0) {
    console.log("\n無法自動修復的題目：");
    for (const plan of blocked.slice(0, 10)) {
      console.log(`  · ${plan.question.id}｜${plan.note ?? ""}`);
    }
    if (blocked.length > 10) console.log(`  …其餘 ${blocked.length - 10} 題`);
  }
  console.log(
    apply
      ? `\n✓ 已寫入。${blocked.length} 題暫時不會派給學生${
          deleteUnusable ? "，並會按 --delete-unusable 刪除（見下）" : "，請在「題目管理」按原卷修正後再發布"
        }。`
      : "\n（模擬模式）未寫入。要真正修復請加上 --apply。",
  );

  /* ---------------------------------------------------------------- */
  /* 刪除無法修復的題目（--delete-unusable）                            */
  /* ---------------------------------------------------------------- */
  if (!deleteUnusable || blocked.length === 0) return;

  const ids = blocked.map((plan) => plan.question.id);
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
    `\n刪除無法修復的題目：${ids.length} 題；練習快照需移除 ${removedFromSnapshots} 處` +
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
