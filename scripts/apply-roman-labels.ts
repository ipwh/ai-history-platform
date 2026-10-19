/**
 * Sprint 19：套用負責人已批准的兩項決定（本機資料庫）。
 *
 * 1. 依 `docs/teacher-review/roman-label-dry-run-2026-10-19.json` 套用 93 題的
 *    「只插入羅馬數字編號」修訂（字詞不改）。修訂會令 revision +1，並清除
 *    自動驗證紀錄，令舊的覆核／自動驗證不能再套用到新內容。
 * 2. 依負責人指示硬刪除 `qb-JTH2ndEdMCQ10144`、`qb-NJCMN0060000039`
 *    （連同其覆核紀錄；歷史紀錄將無法回溯）。
 *
 * 必須加 `--apply`；預設乾跑。寫入前會在 `data/backups/` 建立副本。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SHOULD_APPLY = process.argv.includes("--apply");
const REPO = process.cwd();
const DB_PATH = path.join(REPO, "data", "app.db");
const REPORT = path.join(REPO, "docs", "teacher-review", "roman-label-dry-run-2026-10-19.json");
const DELETE_IDS = ["qb-JTH2ndEdMCQ10144", "qb-NJCMN0060000039"];

interface ReportRow {
  questionId: string;
  revision: number;
  oldStem: string;
  newStem: string | null;
}

function main(): void {
  const report = JSON.parse(fs.readFileSync(REPORT, "utf8")) as { rows: ReportRow[] };
  const ready = report.rows.filter((row) => row.newStem !== null);
  const db = new DatabaseSync(DB_PATH);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    const columns = (db.prepare("PRAGMA table_info(questions)").all() as { name: string; notnull: number }[])
      .map((column) => ({ name: column.name, notNull: column.notnull === 1 }));

    if (SHOULD_APPLY) {
      const backupDir = path.join(REPO, "data", "backups");
      fs.mkdirSync(backupDir, { recursive: true });
      const backup = path.join(backupDir, `app-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
      fs.copyFileSync(DB_PATH, backup);
      console.log(`已備份：${path.relative(REPO, backup)}`);
    }

    const select = db.prepare("SELECT question, revision FROM questions WHERE id = ?");
    let applied = 0;
    let skipped = 0;

    db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of ready) {
        const current = select.get(row.questionId) as
          | { question: string; revision: number }
          | undefined;
        if (!current) {
          console.log(`${row.questionId}: 題目不存在，略過`);
          skipped += 1;
          continue;
        }
        if (current.question !== row.oldStem || current.revision !== row.revision) {
          console.log(`${row.questionId}: 題幹或版本已改變（報告 rev ${row.revision}／現況 rev ${current.revision}），略過`);
          skipped += 1;
          continue;
        }
        if (SHOULD_APPLY) {
          const assignments = ["question = ?", "revision = revision + 1"];
          const params: (string | number)[] = [row.newStem as string];
          if (!columns.find((c) => c.name === "auto_validated_at")?.notNull) {
            assignments.push("auto_validated_at = NULL");
          }
          if (!columns.find((c) => c.name === "auto_validated_revision")?.notNull) {
            assignments.push("auto_validated_revision = NULL");
          }
          if (!columns.find((c) => c.name === "auto_validated_fingerprint")?.notNull) {
            assignments.push("auto_validated_fingerprint = NULL");
          }
          db.prepare(`UPDATE questions SET ${assignments.join(", ")} WHERE id = ?`).run(
            ...params,
            row.questionId,
          );
        }
        applied += 1;
      }

      let deletedQuestions = 0;
      let deletedReviews = 0;
      for (const id of DELETE_IDS) {
        const exists = select.get(id);
        if (!exists) {
          console.log(`${id}: 已不存在，略過`);
          continue;
        }
        if (SHOULD_APPLY) {
          deletedReviews += Number(
            db.prepare("DELETE FROM question_reviews WHERE question_id = ?").run(id).changes,
          );
          deletedQuestions += Number(db.prepare("DELETE FROM questions WHERE id = ?").run(id).changes);
        } else {
          deletedQuestions += 1;
        }
        console.log(`${id}: 刪除${SHOULD_APPLY ? "" : "（乾跑）"}`);
      }

      if (SHOULD_APPLY) db.exec("COMMIT");
      else db.exec("ROLLBACK");

      console.log(`補號：${applied} 題${SHOULD_APPLY ? "已套用" : "（乾跑）"}，略過 ${skipped} 題`);
      console.log(`刪除：questions ${deletedQuestions} 列、question_reviews ${deletedReviews} 列`);
      if (!SHOULD_APPLY) console.log("（乾跑：沒有寫入任何資料。加 --apply 才會執行。）");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const total = db.prepare("SELECT COUNT(*) AS count FROM questions").get() as { count: number };
    console.log(`題目總數：${total.count}`);
  } finally {
    db.close();
  }
}

main();
