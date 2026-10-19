/**
 * 題庫同步的「先驗證、後決定」工具（Sprint 19）。
 *
 * 背景（2026-10-19 實測發現）：本機 `data/app.db` 與正式環境 bucket 內的快照
 * **不是同一份題庫**：
 *   - 正式：473 題（`qb-` 116、`demo-` 49、雜湊 ID 308），migration 至 0020
 *   - 本機：1,875 題（全為 `qb-`），migration 至 0022
 *   - 兩者只有 73 題重疊，其中 11 題題幹不同
 * 因此「把本機資料庫上載到正式」會刪掉正式獨有的題目，並令既有作答紀錄指向不存在的題目。
 *
 * 這個工具不假設任何一邊正確，只做三件事：
 *   1. 比較兩邊題目與學習紀錄，輸出差異報告（預設，唯讀）。
 *   2. 檢查目標快照的完整性（integrity_check、外鍵孤兒、學習紀錄數量）。
 *   3. 只有在明確加 `--apply --shared-only` 時，才更新**兩邊都存在**的題目題幹；
 *      永不刪題、永不新增題目、永不改動學習紀錄。
 *
 * 用法：
 *   npx tsx scripts/verify-questionbank-sync.ts --target C:\temp\prod.db
 *   npx tsx scripts/verify-questionbank-sync.ts --target C:\temp\prod.db --apply --shared-only
 *
 * 回滾（上載前必須執行）：
 *   gcloud storage cp gs://<BUCKET>/<PREFIX>/data/app.db \
 *     gs://<BUCKET>/<PREFIX>/data/app.db.pre-<時間戳>     # 先保留現用快照
 *   需要回滾時：
 *   gcloud storage cp gs://<BUCKET>/<PREFIX>/data/app.db.pre-<時間戳> \
 *     gs://<BUCKET>/<PREFIX>/data/app.db
 *   然後重新啟動 Cloud Run 服務（或重新部署），令容器重新還原快照。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

const targetPath = readArg("--target");
const sourcePath = path.resolve(readArg("--source") ?? "data/app.db");
const shouldApply = process.argv.includes("--apply");
const sharedOnly = process.argv.includes("--shared-only");

if (!targetPath) {
  console.error("必須指定 --target <正式快照路徑>（例如 gcloud storage cp 下載的 app.db）");
  process.exit(2);
}
if (shouldApply && !sharedOnly) {
  console.error(
    "拒絕執行：--apply 必須同時加 --shared-only。\n" +
      "本工具刻意不支援「整份覆寫」，因為那會刪除正式環境獨有的題目並令作答紀錄孤立。",
  );
  process.exit(2);
}

interface Row {
  id: string;
  question: string;
  revision: number;
  status: string;
}

function rows(db: DatabaseSync): Map<string, Row> {
  const list = db
    .prepare("SELECT id, question, revision, status FROM questions")
    .all() as unknown as Row[];
  return new Map(list.map((row) => [row.id, row]));
}

function scalar(db: DatabaseSync, sql: string): number {
  try {
    return (db.prepare(sql).get() as unknown as { c: number }).c;
  } catch {
    return -1;
  }
}

const target = new DatabaseSync(targetPath, { readOnly: !shouldApply });
const source = new DatabaseSync(sourcePath, { readOnly: true });

try {
  const targetRows = rows(target);
  const sourceRows = rows(source);

  const shared: string[] = [];
  const differing: string[] = [];
  for (const [id, row] of sourceRows) {
    const other = targetRows.get(id);
    if (!other) continue;
    shared.push(id);
    if (other.question !== row.question) differing.push(id);
  }
  const targetOnly = [...targetRows.keys()].filter((id) => !sourceRows.has(id));
  const sourceOnly = [...sourceRows.keys()].filter((id) => !targetRows.has(id));

  console.log("=== 題目集合 ===");
  console.log(`正式快照題目：${targetRows.size}`);
  console.log(`來源（本機）題目：${sourceRows.size}`);
  console.log(`共同題目：${shared.length}（其中題幹不同：${differing.length}）`);
  console.log(`只在正式存在：${targetOnly.length}`);
  console.log(`只在來源存在：${sourceOnly.length}`);

  console.log("=== 學習紀錄（必須原樣保留）===");
  for (const table of ["learners", "attempts", "practice_sessions", "question_reviews"]) {
    console.log(`${table}: ${scalar(target, `SELECT COUNT(*) AS c FROM ${table}`)}`);
  }

  const attemptsOnMissing = scalar(
    target,
    `SELECT COUNT(*) AS c FROM attempts WHERE question_id NOT IN (SELECT id FROM questions)`,
  );
  console.log(`作答紀錄指向不存在題目：${attemptsOnMissing}`);

  console.log("=== 完整性 ===");
  const integrity = (target.prepare("PRAGMA integrity_check").get() as { integrity_check: string })
    .integrity_check;
  const fk = target.prepare("PRAGMA foreign_key_check").all() as unknown[];
  console.log(`integrity_check: ${integrity}`);
  console.log(`foreign_key_check 違規列：${fk.length}`);

  const migrations = (
    target.prepare("SELECT id FROM schema_migrations ORDER BY id").all() as unknown as { id: string }[]
  ).map((row) => row.id);
  console.log(`正式快照 migration：${migrations[migrations.length - 1] ?? "（無）"}（共 ${migrations.length}）`);

  if (differing.length > 0) {
    console.log("=== 題幹不同的共同題目（前 10 筆）===");
    for (const id of differing.slice(0, 10)) {
      console.log(`- ${id}`);
      console.log(`  正式：${(targetRows.get(id) as Row).question.slice(0, 80)}`);
      console.log(`  來源：${(sourceRows.get(id) as Row).question.slice(0, 80)}`);
    }
  }

  if (targetOnly.length > 0 || sourceOnly.length > 0) {
    console.log(
      "\n⚠ 兩邊題目集合不同。這代表「上載本機快照」會刪除正式獨有題目、令作答紀錄孤立，" +
        "並把未經正式環境覆核的題目帶給學生。請先決定要保留哪一份題庫。",
    );
  }

  if (!shouldApply) {
    console.log("\n（驗證模式：沒有寫入任何資料。要更新共同題目的題幹請加 --apply --shared-only）");
  } else {
    let updated = 0;
    target.exec("BEGIN IMMEDIATE");
    try {
      const update = target.prepare(
        `UPDATE questions
         SET question = ?, revision = revision + 1,
             auto_validated_at = NULL, auto_validated_revision = NULL, auto_validated_fingerprint = NULL
         WHERE id = ? AND question = ?`,
      );
      for (const id of differing) {
        const src = sourceRows.get(id) as Row;
        const dst = targetRows.get(id) as Row;
        const result = update.run(src.question, id, dst.question);
        updated += Number(result.changes);
      }
      target.exec("COMMIT");
    } catch (error) {
      target.exec("ROLLBACK");
      throw error;
    }
    console.log(`\n已更新共同題目的題幹：${updated} 題（未刪除、未新增、未改動學習紀錄）`);
    const after = scalar(target, "SELECT COUNT(*) AS c FROM questions");
    console.log(`更新後題目總數：${after}（應與更新前相同：${targetRows.size}）`);
  }
} finally {
  target.close();
  source.close();
}
