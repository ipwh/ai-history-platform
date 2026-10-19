/**
 * 依負責人指示硬刪除題目（連同其覆核紀錄）。
 *
 * 這是不可逆操作：會一併刪除 `question_reviews` 的歷史紀錄，刪除後無法回溯該題的裁決歷史。
 * 必須明確加 `--apply`；預設只列出將被刪除的內容。
 *
 *   npx tsx scripts/delete-questions.ts qb-XXXX qb-YYYY
 *   npx tsx scripts/delete-questions.ts qb-XXXX --apply
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const REPO = process.cwd();
const DB_PATH = path.join(REPO, "data", "app.db");
const args = process.argv.slice(2);
const SHOULD_APPLY = args.includes("--apply");
const ids = args.filter((arg) => !arg.startsWith("--"));

function main(): void {
  if (ids.length === 0) {
    console.error("請提供至少一個題號，例如：npx tsx scripts/delete-questions.ts qb-XXXX --apply");
    process.exit(2);
  }
  const db = new DatabaseSync(DB_PATH);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    const select = db.prepare(
      "SELECT id, status, revision, substr(question, 1, 40) AS stem FROM questions WHERE id = ?",
    );
    const reviewCount = db.prepare(
      "SELECT COUNT(*) AS count FROM question_reviews WHERE question_id = ?",
    );

    if (SHOULD_APPLY) {
      const backupDir = path.join(REPO, "data", "backups");
      fs.mkdirSync(backupDir, { recursive: true });
      const backup = path.join(backupDir, `app-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
      fs.copyFileSync(DB_PATH, backup);
      console.log(`已備份：${path.relative(REPO, backup)}`);
    }

    db.exec("BEGIN IMMEDIATE");
    let questions = 0;
    let reviews = 0;
    for (const id of ids) {
      const row = select.get(id) as
        | { id: string; status: string; revision: number; stem: string }
        | undefined;
      if (!row) {
        console.log(`${id}: 不存在，略過`);
        continue;
      }
      const count = (reviewCount.get(id) as { count: number }).count;
      console.log(`${id}: status=${row.status} rev=${row.revision} reviews=${count} | ${row.stem}…`);
      if (SHOULD_APPLY) {
        reviews += Number(db.prepare("DELETE FROM question_reviews WHERE question_id = ?").run(id).changes);
        questions += Number(db.prepare("DELETE FROM questions WHERE id = ?").run(id).changes);
      } else {
        questions += 1;
        reviews += count;
      }
    }
    if (SHOULD_APPLY) db.exec("COMMIT");
    else db.exec("ROLLBACK");

    console.log(
      `${SHOULD_APPLY ? "已刪除" : "將刪除（乾跑）"}：questions ${questions} 列、question_reviews ${reviews} 列`,
    );
    const total = db.prepare("SELECT COUNT(*) AS count FROM questions").get() as { count: number };
    console.log(`題目總數：${total.count}`);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

main();
