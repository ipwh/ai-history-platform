/**
 * 印出指定題目的完整內容、教材段落及核對結果，供逐題裁決使用。
 *
 * 用法：
 *   node scripts/show-question-context.mjs qb-NJCMN0120000064 q_ae82dfe050114587
 *   node scripts/show-question-context.mjs --file ids.txt --database data/exports/production-next.db
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const readArg = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const databasePath = readArg("--database", path.join("data", "exports", "production-next.db"));
const verificationPath = readArg(
  "--verification",
  path.join("docs", "quality", "answer-verification-2026-10-21.jsonl"),
);

let ids = args.filter((value, index) => {
  if (value.startsWith("--")) return false;
  const previous = args[index - 1];
  return previous !== "--database" && previous !== "--verification" && previous !== "--file";
});
const file = readArg("--file");
if (file) {
  ids = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}
if (ids.length === 0) {
  console.error("請提供題目 ID 或 --file。");
  process.exit(1);
}

const db = new DatabaseSync(databasePath, { readOnly: true });
const verdicts = new Map();
if (fs.existsSync(verificationPath)) {
  for (const line of fs.readFileSync(verificationPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      verdicts.set(entry.id, entry);
    } catch {
      // ignore
    }
  }
}

function bigrams(text) {
  const cleaned = text.replace(/[\s\p{P}\p{S}a-zA-Z0-9]/gu, "");
  const grams = new Set();
  for (let i = 0; i < cleaned.length - 1; i += 1) grams.add(cleaned.slice(i, i + 2));
  return grams;
}
function overlap(grams, text) {
  const other = bigrams(text);
  let hits = 0;
  for (const gram of grams) if (other.has(gram)) hits += 1;
  return hits / Math.sqrt(Math.max(other.size, 1));
}

const passageCache = new Map();
function passages(topicId) {
  if (passageCache.has(topicId)) return passageCache.get(topicId);
  const blocks = db
    .prepare(
      `SELECT b.section_id, b.text, b.type, b.document_id
         FROM material_blocks b
         JOIN material_documents d ON d.id = b.document_id
        WHERE b.topic_id = ? AND d.kind = 'demo' AND b.type IN ('paragraph','list','heading','table')
        ORDER BY b.document_id, b.sort_order`,
    )
    .all(topicId);
  const result = [];
  let current = { text: "", sectionId: null, documentId: null };
  const flush = () => {
    if (current.text.trim().length >= 80) result.push({ ...current });
    current = { text: "", sectionId: null, documentId: null };
  };
  for (const block of blocks) {
    const text = (block.text ?? "").trim();
    if (!text) continue;
    if (current.documentId !== block.document_id) flush();
    if (!current.sectionId && block.section_id) current.sectionId = block.section_id;
    if (block.type === "heading" && current.text.length > 200) flush();
    if (current.text.length + text.length > 900) flush();
    if (!current.sectionId && block.section_id) current.sectionId = block.section_id;
    current.text += text + "\n";
    current.documentId = block.document_id;
  }
  flush();
  passageCache.set(topicId, result);
  return result;
}

for (const id of ids) {
  const question = db.prepare("SELECT * FROM questions WHERE id = ?").get(id);
  console.log("=".repeat(90));
  if (!question) {
    console.log(`找不到題目：${id}`);
    continue;
  }
  console.log(`${question.id} | ${question.topic_id} / ${question.section_id} | ${question.question_type} ${question.difficulty} | ${question.status} | rev ${question.revision}`);
  console.log(`題幹：${question.question}`);
  try {
    const options = JSON.parse(question.options_json);
    options.forEach((option, index) => console.log(`  ${String.fromCharCode(65 + index)}. ${option}`));
  } catch {
    // no options
  }
  console.log(`答案：${question.correct_answer}`);
  console.log(`解釋：${question.explanation}`);
  console.log(`出處節錄：${question.source_excerpt}`);
  console.log(`知識點：${question.knowledge_point}`);
  console.log(`來源位置：${question.source_location}`);
  console.log(`品質警告：${question.quality_warnings_json}`);

  const query = `${question.question}\n${question.correct_answer}\n${question.explanation}\n${question.knowledge_point ?? ""}`;
  const grams = bigrams(query);
  const ranked = passages(question.topic_id)
    .map((passage) => ({
      passage,
      score: overlap(grams, passage.text) + (passage.sectionId === question.section_id ? 0.35 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  console.log("\n教材段落：");
  for (const entry of ranked) {
    console.log(`---（${entry.passage.sectionId ?? "未分節"}）\n${entry.passage.text.trim().slice(0, 900)}\n---`);
  }

  const verdict = verdicts.get(id);
  if (verdict) {
    console.log(`\n核對結果：${verdict.verdict}｜信心 ${verdict.confidence ?? "?"}｜${verdict.issue}`);
    console.log(`理由：${verdict.reason}`);
    if (verdict.correctedAnswer) console.log(`建議答案：${verdict.correctedAnswer}`);
  }
  console.log("");
}
