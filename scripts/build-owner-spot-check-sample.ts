/**
 * 產生「擁有者隨機抽樣」題目清單（Markdown + JSON），供擁有者快速檢查題目內容。
 *
 * 用途：批次發布或批次補寫解釋之後，擁有者需要抽樣核對題幹／選項／答案／解釋是否合理。
 * 抽樣以固定種子（`--seed`）決定，同一資料庫 + 同一 seed 會得出同一批題目（可重複核對）。
 *
 * 界線：只讀取資料庫，不修改任何題目、覆核或發布狀態；輸出不含學生資料。
 *
 * 用法：
 *   npx tsx scripts/build-owner-spot-check-sample.ts --database data/app.db --count 20 \
 *     --out-json docs/teacher-review/owner-spot-check-2026-10-21.json \
 *     --out-md docs/teacher-review/owner-spot-check-2026-10-21.md
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function readArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

interface Row {
  id: string;
  topic_id: string;
  question_type: string;
  question: string;
  options_json: string;
  correct_answer: string;
  explanation: string;
  source_location: string | null;
  source_excerpt: string | null;
  status: string;
  quality_warnings_json: string;
  teacher_confirmation_required: number;
}

interface SampleEntry {
  questionId: string;
  topicId: string;
  questionType: string;
  stem: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  sourceLocation: string;
  sourceExcerpt: string;
  status: string;
  publishedWithoutHumanReview: boolean;
  qualityWarnings: string[];
}

/** 固定種子的 PRNG，令抽樣可重現（mulberry32）。 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function main(): void {
  const repo = path.resolve(import.meta.dirname, "..");
  const databasePath = path.resolve(
    readArg(process.argv, "--database") ?? path.join(repo, "data", "app.db"),
  );
  const count = Number(readArg(process.argv, "--count") ?? "20");
  const seed = Number(readArg(process.argv, "--seed") ?? "20261021");
  const outJson = path.resolve(
    readArg(process.argv, "--out-json") ??
      path.join(repo, "docs", "teacher-review", "owner-spot-check.json"),
  );
  const outMd = path.resolve(
    readArg(process.argv, "--out-md") ?? path.join(repo, "docs", "teacher-review", "owner-spot-check.md"),
  );

  if (!fs.existsSync(databasePath)) throw new Error(`找不到資料庫：${databasePath}`);
  const db = new DatabaseSync(databasePath, { readOnly: true });
  const rows = db
    .prepare(
      `SELECT id, topic_id, question_type, question, options_json, correct_answer, explanation,
        source_location, source_excerpt, status, quality_warnings_json, teacher_confirmation_required
       FROM questions WHERE status = 'published' ORDER BY id ASC`,
    )
    .all() as unknown as Row[];
  db.close();

  // 分層抽樣：先按課題分組輪流抽，令樣本覆蓋多個課題，而不是集中在某幾個課題。
  const random = createRandom(seed);
  const byTopic = new Map<string, Row[]>();
  for (const row of rows) {
    const bucket = byTopic.get(row.topic_id) ?? [];
    bucket.push(row);
    byTopic.set(row.topic_id, bucket);
  }
  const topicOrder = [...byTopic.keys()].sort();
  const pools = new Map(topicOrder.map((topic) => [topic, shuffle(byTopic.get(topic) ?? [], random)]));
  const picked: Row[] = [];
  let cursor = 0;
  while (picked.length < count && cursor < rows.length + topicOrder.length) {
    const topic = topicOrder[cursor % topicOrder.length];
    const pool = pools.get(topic) ?? [];
    const next = pool.shift();
    if (next) picked.push(next);
    cursor += 1;
    if ([...pools.values()].every((items) => items.length === 0)) break;
  }

  const entries: SampleEntry[] = picked.map((row) => ({
    questionId: row.id,
    topicId: row.topic_id,
    questionType: row.question_type,
    stem: row.question,
    options: parseArray(row.options_json),
    correctAnswer: row.correct_answer,
    explanation: row.explanation,
    sourceLocation: row.source_location ?? "",
    sourceExcerpt: row.source_excerpt ?? "",
    status: row.status,
    publishedWithoutHumanReview: true,
    qualityWarnings: parseArray(row.quality_warnings_json),
  }));

  const payload = {
    generatedAt: new Date().toISOString(),
    scope: { database: path.relative(repo, databasePath).replace(/\\/g, "/"), publishedQuestions: rows.length },
    sampling: { method: "stratified-by-topic", seed, requested: count, picked: entries.length },
    note:
      "隨機抽樣清單，只讀取資料庫。`publishedWithoutHumanReview: true` 表示題目由擁有者授權批次發布，" +
      "平台內沒有該版本的人工覆核紀錄。",
    entries,
  };

  const lines: string[] = [];
  lines.push("# 擁有者隨機抽樣題目清單");
  lines.push("");
  lines.push(`- 產生時間：${payload.generatedAt}`);
  lines.push(`- 資料庫（唯讀）：\`${payload.scope.database}\`（已發布 ${rows.length} 題）`);
  lines.push(`- 抽樣方式：按課題分層抽樣，種子 \`${seed}\`，抽出 ${entries.length} 題`);
  lines.push(
    "- 說明：這些題目由擁有者授權批次發布，**平台內沒有該版本的人工覆核紀錄**" +
      "（教師端顯示「已發布（未經人工覆核）」）。請就題幹、選項、答案及解釋是否合理給予意見。",
  );
  lines.push("");
  for (const [index, entry] of entries.entries()) {
    lines.push(`## ${index + 1}. ${entry.questionId}（${entry.topicId}・${entry.questionType === "mc" ? "選擇題" : "填充題"}）`);
    lines.push("");
    lines.push(`**題幹**：${entry.stem}`);
    lines.push("");
    if (entry.options.length > 0) {
      for (const [optionIndex, option] of entry.options.entries()) {
        const letter = String.fromCharCode(65 + optionIndex);
        const marker = option.trim() === entry.correctAnswer.trim() ? " ✅" : "";
        lines.push(`- ${letter}. ${option}${marker}`);
      }
      lines.push("");
    }
    lines.push(`**正確答案**：${entry.correctAnswer}`);
    lines.push("");
    lines.push(`**解釋**：${entry.explanation}`);
    lines.push("");
    if (entry.sourceExcerpt.length > 0) {
      lines.push(`**教材依據**：${entry.sourceLocation || "（未填位置）"}`);
      lines.push("");
      lines.push(`> ${entry.sourceExcerpt.replace(/\n/g, "\n> ")}`);
      lines.push("");
    }
    if (entry.qualityWarnings.length > 0) {
      lines.push("**已知限制**：");
      for (const warning of entry.qualityWarnings) lines.push(`- ${warning}`);
      lines.push("");
    }
  }

  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.mkdirSync(path.dirname(outMd), { recursive: true });
  fs.writeFileSync(outMd, `${lines.join("\n")}\n`, "utf8");
  console.log(`已寫入：${path.relative(repo, outJson)}`);
  console.log(`已寫入：${path.relative(repo, outMd)}`);
}

main();
