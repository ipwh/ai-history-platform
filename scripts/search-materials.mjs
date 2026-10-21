/**
 * 在教材（課文／筆記）中搜尋關鍵字，供逐題核對時找依據。
 *
 * 用法：
 *   node scripts/search-materials.mjs 工業基礎 --topic topic-12
 *   node scripts/search-materials.mjs 市政局 --topic topic-12 --kind demo --limit 20
 */
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const readArg = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const databasePath = readArg("--database", path.join("data", "exports", "production-next.db"));
const topic = readArg("--topic");
const kind = readArg("--kind", "demo");
const limit = Number(readArg("--limit", "20"));
const terms = args.filter((value, index) => {
  if (value.startsWith("--")) return false;
  const previous = args[index - 1];
  return !["--database", "--topic", "--kind", "--limit"].includes(previous);
});

if (terms.length === 0) {
  console.error("請提供搜尋字詞。");
  process.exit(1);
}

const db = new DatabaseSync(databasePath, { readOnly: true });
for (const term of terms) {
  const rows = db
    .prepare(
      `SELECT b.topic_id, b.section_id, b.text, d.file_name
         FROM material_blocks b
         JOIN material_documents d ON d.id = b.document_id
        WHERE b.text LIKE ?
          AND (? IS NULL OR b.topic_id = ?)
          AND (? IS NULL OR d.kind = ?)
        LIMIT ?`,
    )
    .all(`%${term}%`, topic, topic, kind, kind, limit);
  console.log(`\n### ${term}（${rows.length} 段）`);
  for (const row of rows) {
    console.log(`[${row.section_id ?? "未分節"}] ${row.text.replace(/\s+/g, " ").slice(0, 400)}`);
  }
}
