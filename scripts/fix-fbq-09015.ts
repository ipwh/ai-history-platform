/**
 * 修正 `qb-JTH2ndEdFBQ09015` 的答案外洩（負責人 2026-10-19 批准）。
 *
 * 只把題幹線索「研發軍備」改為「研發武器」，標準答案仍為「軍備」，
 * 令答案只出現在空格而不出現在題幹其他位置。修改後 revision +1，
 * 並清除自動驗證紀錄（舊覆核不應再套用到新內容）。
 *
 *   npx tsx scripts/fix-fbq-09015.ts            # 乾跑
 *   npx tsx scripts/fix-fbq-09015.ts --apply    # 寫入
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { answerLeaksIntoStem } from "../src/server/llm/fill-question";

const SHOULD_APPLY = process.argv.includes("--apply");
const REPO = process.cwd();
const DB_PATH = path.join(REPO, "data", "app.db");
const ID = "qb-JTH2ndEdFBQ09015";
const FROM = "研發軍備";
const TO = "研發武器";

function main(): void {
  const db = new DatabaseSync(DB_PATH);
  try {
    const row = db
      .prepare("SELECT question, correct_answer, revision FROM questions WHERE id = ?")
      .get(ID) as { question: string; correct_answer: string; revision: number } | undefined;
    if (!row) throw new Error(`${ID}: 找不到題目`);
    if (!row.question.includes(FROM)) {
      throw new Error(`${ID}: 題幹不含「${FROM}」，不執行（可能已被修改）`);
    }

    const next = row.question.replace(FROM, TO);
    console.log(`原文：${row.question}`);
    console.log(`新文：${next}`);
    console.log(`答案：${row.correct_answer}`);
    console.log(`外洩檢查（修改前）：${answerLeaksIntoStem(row.question, row.correct_answer)}`);
    console.log(`外洩檢查（修改後）：${answerLeaksIntoStem(next, row.correct_answer)}`);

    if (answerLeaksIntoStem(next, row.correct_answer)) {
      throw new Error("修改後仍然外洩，中止");
    }

    if (SHOULD_APPLY) {
      const backupDir = path.join(REPO, "data", "backups");
      fs.mkdirSync(backupDir, { recursive: true });
      const backup = path.join(backupDir, `app-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
      fs.copyFileSync(DB_PATH, backup);
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          `UPDATE questions
           SET question = ?, revision = revision + 1,
               auto_validated_at = NULL, auto_validated_revision = NULL, auto_validated_fingerprint = NULL
           WHERE id = ?`,
        ).run(next, ID);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      console.log(`已備份：${path.relative(REPO, backup)}`);
      console.log("已套用（revision +1，自動驗證紀錄已清除）");
    } else {
      console.log("（乾跑：沒有寫入任何資料。加 --apply 才會執行。）");
    }
  } finally {
    db.close();
  }
}

main();
