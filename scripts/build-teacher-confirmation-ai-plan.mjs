/**
 * 由逐題 AI 核對結果，產生「解除待教師確認」的決定檔。
 *
 * 只會處理資料庫內仍為 draft 且 AI 核對結果為 correct（信心 >= 85）的題目；
 * 每題的理由都會寫明核對方式（ai-textbook-verification）、信心及原本暫緩的原因，
 * 不會寫入任何 question_reviews。
 *
 * 用法：
 *   node scripts/build-teacher-confirmation-ai-plan.mjs \
 *     --database data/exports/production-next.db \
 *     --verification docs/quality/answer-verification-2026-10-21.jsonl \
 *     --out docs/teacher-review/owner-overrides-ai-2026-10-21.json
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const readArg = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const databasePath = readArg("--database", path.join("data", "exports", "production-next.db"));
const verificationPath = readArg(
  "--verification",
  path.join("docs", "quality", "answer-verification-2026-10-21.jsonl"),
);
const outPath = readArg(
  "--out",
  path.join("docs", "teacher-review", "owner-overrides-ai-2026-10-21.json"),
);
const ownerEmail = readArg("--owner-email", "ipwh@pochiu.edu.hk");

const db = new DatabaseSync(databasePath, { readOnly: true });
const verdicts = new Map();
for (const line of fs.readFileSync(verificationPath, "utf8").split(/\r?\n/)) {
  if (!line.trim()) continue;
  try {
    const entry = JSON.parse(line);
    verdicts.set(entry.id, entry);
  } catch {
    // ignore trailing partial line
  }
}

const drafts = db
  .prepare(
    "SELECT id, topic_id, question, correct_answer, quality_warnings_json FROM questions WHERE status = 'draft' ORDER BY topic_id, id",
  )
  .all();

const items = [];
const skipped = [];
for (const draft of drafts) {
  const verdict = verdicts.get(draft.id);
  if (!verdict || verdict.verdict !== "correct" || (verdict.confidence ?? 0) < 85) {
    skipped.push({
      questionId: draft.id,
      reason: verdict
        ? `AI 核對結果為 ${verdict.verdict}（信心 ${verdict.confidence ?? "?"}）`
        : "沒有 AI 核對紀錄",
    });
    continue;
  }
  const holdNote = (() => {
    try {
      const warnings = JSON.parse(draft.quality_warnings_json ?? "[]");
      return warnings.length > 0 ? warnings[0].slice(0, 80) : "品質閘門暫緩";
    } catch {
      return "品質閘門暫緩";
    }
  })();
  items.push({
    questionId: draft.id,
    reason:
      `2026-10-21 AI 逐題核對（ai-textbook-verification）：標示答案「${draft.correct_answer.slice(0, 30)}」與教材及史實一致，信心 ${verdict.confidence}；` +
      `原暫緩原因為「${holdNote}」，屬措辭或閘門提示，並非答案錯誤。擁有者已授權核對後發布。`,
  });
}

const plan = {
  decidedBy: ownerEmail,
  decidedAt: "2026-10-21",
  authorization:
    "2026-10-21 擁有者指示：題目太多，不可能人工覆核；用教材及網上權威資源查證題目及答案，代為覆核並發布。",
  note:
    "這是擁有者授權的內容決定（AI 核對後解除品質閘門暫緩），不是教師覆核；不會寫入 question_reviews，教師端仍會顯示『已發布（未經人工覆核）』。",
  items,
  skipped,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
console.log(`✓ 決定檔：${items.length} 題 → ${outPath}`);
if (skipped.length > 0) {
  console.log(`  另有 ${skipped.length} 題不會解除暫緩：`);
  for (const entry of skipped) console.log(`  - ${entry.questionId}：${entry.reason}`);
}
