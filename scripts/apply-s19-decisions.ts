/**
 * Sprint 19：執行負責人已明確批准的兩項資料決定（本機資料庫）。
 *
 * 1. 修正 4 題的來源檔名（資料庫記錄為 `課題6 歐洲國家的殖民擴張_.MCQ.docx`，
 *    實際檔名為 `課題6 歐洲國家的殖民擴張_MCQ.docx`；只是記錄錯誤，原卷沒有遺失）。
 * 2. 依負責人指示硬刪除 `qb-NJCMN0020000002`（連同其覆核紀錄，歷史紀錄將無法回溯）。
 *
 * 必須明確加 `--apply` 才會寫入；預設為乾跑。寫入前會先在 `data/backups/` 建立副本。
 *
 *   npx tsx scripts/apply-s19-decisions.ts            # 乾跑
 *   npx tsx scripts/apply-s19-decisions.ts --apply    # 實際寫入
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SHOULD_APPLY = process.argv.includes("--apply");
const REPO = process.cwd();
const DB_PATH = path.join(REPO, "data", "app.db");

const WRONG_NAME = "課題6 歐洲國家的殖民擴張_.MCQ.docx";
const RIGHT_NAME = "課題6 歐洲國家的殖民擴張_MCQ.docx";
const FIX_IDS = [
  "qb-NJCMN0060000037",
  "qb-NJCMN0060000039",
  "qb-NJCMN0060000042",
  "qb-NJCMN0060000045",
];
const DELETE_ID = "qb-NJCMN0020000002";

function main(): void {
  if (!fs.existsSync(DB_PATH)) throw new Error(`找不到資料庫：${DB_PATH}`);
  const db = new DatabaseSync(DB_PATH);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    const select = db.prepare("SELECT id, revision, status, source_location FROM questions WHERE id = ?");

    console.log("=== 1. 來源檔名修正 ===");
    for (const id of FIX_IDS) {
      const row = select.get(id) as
        | { id: string; revision: number; status: string; source_location: string | null }
        | undefined;
      if (!row) {
        console.log(`${id}: 找不到題目，略過`);
        continue;
      }
      if (!row.source_location || !row.source_location.includes(WRONG_NAME)) {
        console.log(`${id}: 來源欄位不含預期檔名，略過（${row.source_location}）`);
        continue;
      }
      const next = row.source_location.replace(WRONG_NAME, RIGHT_NAME);
      console.log(`${id}: ${WRONG_NAME} → ${RIGHT_NAME}`);
      if (SHOULD_APPLY) {
        db.prepare("UPDATE questions SET source_location = ? WHERE id = ?").run(next, id);
      }
    }

    console.log("=== 2. 硬刪除 ===");
    const target = select.get(DELETE_ID) as
      | { id: string; revision: number; status: string; source_location: string | null }
      | undefined;
    if (!target) {
      console.log(`${DELETE_ID}: 已不存在，略過`);
    } else {
      const reviews = db
        .prepare("SELECT COUNT(*) AS count FROM question_reviews WHERE question_id = ?")
        .get(DELETE_ID) as { count: number };
      console.log(`${DELETE_ID}: status=${target.status} rev=${target.revision} reviews=${reviews.count}`);
      if (SHOULD_APPLY) {
        const backupDir = path.join(REPO, "data", "backups");
        fs.mkdirSync(backupDir, { recursive: true });
        const backup = path.join(backupDir, `app-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
        fs.copyFileSync(DB_PATH, backup);
        console.log(`已備份：${path.relative(REPO, backup)}`);

        db.exec("BEGIN IMMEDIATE");
        try {
          const removedReviews = db
            .prepare("DELETE FROM question_reviews WHERE question_id = ?")
            .run(DELETE_ID);
          const removedQuestion = db.prepare("DELETE FROM questions WHERE id = ?").run(DELETE_ID);
          db.exec("COMMIT");
          console.log(
            `已刪除：questions ${removedQuestion.changes} 列、question_reviews ${removedReviews.changes} 列`,
          );
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      }
    }

    if (SHOULD_APPLY) {
      const total = db.prepare("SELECT COUNT(*) AS count FROM questions").get() as { count: number };
      console.log(`題目總數：${total.count}`);
    } else {
      console.log("（乾跑：沒有寫入任何資料。加 --apply 才會執行。）");
    }
  } finally {
    db.close();
  }
}

main();
