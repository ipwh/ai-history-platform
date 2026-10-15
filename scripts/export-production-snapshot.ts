/**
 * 匯出「正式環境用」的資料庫快照。
 *
 * 用途：正式環境（Cloud Run）的資料庫位於容器內，重新部署後會由備份 bucket 還原，
 * 因此要把本機已整理好的內容（教材段落、題目、已發布狀態）帶到正式環境，就要
 * 產出一份**乾淨**的快照並上載到 `<BACKUP_BUCKET>/<BACKUP_PREFIX>/data/app.db`。
 *
 * 快照會保留：教材段落、題目及狀態、練習記錄（原樣保留，不會刪除任何學習記錄）。
 * 快照會清除：
 *   1. 教材的「已開放給學生」及版權／內容確認欄位——這些確認必須由擁有者／管理員
 *      在管理端逐份確認；本機的確認紀錄可能來自測試或示範流程，**不可**當作正式授權
 *      （見 docs/teacher-review/README.md）。清除後正式環境維持 fail-closed。
 *   2. `distribution_audit`（教材開放稽核）：紀錄已被清除，保留會令人誤以為正式環境
 *      曾有過這些開放決定。
 *
 * 用法：
 *   npm run snapshot:production                     # 輸出 data/exports/app.db
 *   npm run snapshot:production -- --out path.db --force
 *
 * 上載（需要 gcloud 已登入並有該 bucket 的寫入權限）：
 *   gcloud storage cp data/exports/app.db gs://<專案ID>-history-backup/history/data/app.db
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { getDb } from "../src/server/db/connection";
import { getServerConfig, isProductionRuntime } from "../src/server/config";

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

const outPath = path.resolve(readArg("--out") ?? "data/exports/app.db");
const force = process.argv.includes("--force");

function count(db: DatabaseSync, sql: string): number {
  return (db.prepare(sql).get() as unknown as { c: number }).c;
}

function main(): void {
  if (isProductionRuntime()) {
    console.error("\n無法執行：本腳本只在本機使用（正式環境請以備份還原方式更新）。\n");
    process.exit(1);
  }
  if (fs.existsSync(outPath) && !force) {
    console.error(
      `\n無法執行：${outPath} 已存在。請先確認那是舊快照，或加上 --force 覆寫。\n`,
    );
    process.exit(1);
  }

  const source = getServerConfig().databasePath;
  if (!fs.existsSync(source)) {
    console.error(`\n無法執行：找不到本機資料庫 ${source}\n`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.rmSync(outPath, { force: true });

  // VACUUM INTO 會在單一交易內把資料庫完整複製到新檔案（不含 WAL 未提交內容的風險）
  getDb().prepare("VACUUM INTO ?").run(outPath);

  const snapshot = new DatabaseSync(outPath);
  try {
    const beforeOpen = count(
      snapshot,
      "SELECT COUNT(*) AS c FROM material_documents WHERE student_distribution = 1",
    );
    const beforeAudit = count(snapshot, "SELECT COUNT(*) AS c FROM distribution_audit");

    snapshot.exec(
      `UPDATE material_documents
         SET student_distribution = 0,
             rights_confirmed_at = NULL,
             rights_confirmed_by = NULL,
             content_reviewed_at = NULL,
             content_reviewed_by = NULL
       WHERE student_distribution = 1
          OR rights_confirmed_at IS NOT NULL
          OR content_reviewed_at IS NOT NULL`,
    );
    snapshot.exec("DELETE FROM distribution_audit");

    const integrity = (snapshot.prepare("PRAGMA integrity_check").get() as unknown as {
      integrity_check: string;
    }).integrity_check;

    const summary = {
      questions: count(snapshot, "SELECT COUNT(*) AS c FROM questions"),
      published: count(snapshot, "SELECT COUNT(*) AS c FROM questions WHERE status = 'published'"),
      drafts: count(snapshot, "SELECT COUNT(*) AS c FROM questions WHERE status = 'draft'"),
      blocks: count(snapshot, "SELECT COUNT(*) AS c FROM material_blocks"),
      documentsOpen: count(
        snapshot,
        "SELECT COUNT(*) AS c FROM material_documents WHERE student_distribution = 1",
      ),
      practiceSessions: count(snapshot, "SELECT COUNT(*) AS c FROM practice_sessions"),
      attempts: count(snapshot, "SELECT COUNT(*) AS c FROM attempts"),
      learners: count(snapshot, "SELECT COUNT(*) AS c FROM learners"),
    };

    console.log(`快照已建立：${outPath}`);
    console.log(`  資料庫完整性檢查：${integrity}`);
    console.log(
      `  教材開放狀態：原有 ${beforeOpen} 份已開放 → 現有 ${summary.documentsOpen} 份（正式環境維持 fail-closed）`,
    );
    console.log(`  教材開放稽核紀錄：原有 ${beforeAudit} 筆 → 全部清除（0 筆）`);
    console.log(`  題目：${summary.questions} 題（已發布 ${summary.published}、草稿 ${summary.drafts}）`);
    console.log(`  教材段落：${summary.blocks}`);
    console.log(
      `  練習記錄：${summary.practiceSessions} 次練習、${summary.attempts} 次作答、${summary.learners} 位學習者（原樣保留）`,
    );
    console.log(
      "\n上載：gcloud storage cp " +
        `${path.relative(process.cwd(), outPath)} gs://<專案ID>-history-backup/history/data/app.db`,
    );
  } finally {
    snapshot.close();
  }
}

main();
