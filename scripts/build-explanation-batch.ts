/**
 * 產生「解釋補寫批次」的上下文檔（唯讀）。
 *
 * 為每一道待補寫的題目，附上：
 *   - 題幹、選項、正確答案、知識點、現有解釋
 *   - 由**同課題課本／筆記段落**中挑出最相關的 1–3 段原文（供補寫時核對，不修改任何資料）
 *
 * 用途：把 1,875 題分成可逐題核對的批次，避免「沒有依據地重寫」。
 * 本腳本只讀取資料庫，不寫入任何題目、答案或狀態。
 *
 * 用法：
 *   npx tsx scripts/build-explanation-batch.ts --topic topic-1
 *   npx tsx scripts/build-explanation-batch.ts --topic topic-1 --limit 40 --offset 40
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { classifyExplanation } from "../src/server/quality/explanation-quality";

interface QuestionRow {
  id: string;
  topic_id: string;
  section_id: string;
  question_type: string;
  question: string;
  options_json: string | null;
  correct_answer: string;
  accepted_answers_json: string | null;
  explanation: string;
  knowledge_point: string;
  source_location: string;
  status: string;
  revision: number;
}

interface BlockRow {
  id: string;
  text: string;
}

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

/** 以二字詞重疊計分（中文短句的簡單相似度，足夠挑出同主題段落） */
function bigrams(value: string): Set<string> {
  const cleaned = value.replace(/[\s，,。.、；;：:！!？?「」『』（）()＿_]/g, "");
  const grams = new Set<string>();
  for (let index = 0; index < cleaned.length - 1; index += 1) {
    grams.add(cleaned.slice(index, index + 2));
  }
  return grams;
}

function relevance(blockText: string, needle: Set<string>): number {
  let score = 0;
  for (const gram of bigrams(blockText)) {
    if (needle.has(gram)) score += 1;
  }
  return score;
}

function main(): void {
  const repo = process.cwd();
  const databasePath = path.resolve(
    readArg("--database") ?? process.env.APP_DATABASE_PATH ?? path.join("data", "app.db"),
  );
  const topicFilter = readArg("--topic");
  const limit = Number.parseInt(readArg("--limit") ?? "40", 10);
  const offset = Number.parseInt(readArg("--offset") ?? "0", 10);
  const outPath = readArg("--out");

  if (!fs.existsSync(databasePath)) throw new Error(`找不到資料庫：${databasePath}`);
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `SELECT id, topic_id, section_id, question_type, question, options_json, correct_answer,
                accepted_answers_json, explanation, knowledge_point, source_location, status, revision
           FROM questions
          WHERE status = 'published' AND (? IS NULL OR topic_id = ?)
          ORDER BY id ASC`,
      )
      .all(topicFilter ?? null, topicFilter ?? null) as unknown as QuestionRow[];

    const candidates = rows.filter((row) => {
      const explanationClass = classifyExplanation({
        explanation: row.explanation,
        correctAnswer: row.correct_answer,
        acceptedAnswers: parseJsonArray(row.accepted_answers_json),
        options: parseJsonArray(row.options_json),
        hasHumanReview: false,
      }).class;
      return explanationClass !== "not_assessed";
    });

    const page = candidates.slice(offset, offset + limit);
    const blocksByTopic = new Map<string, BlockRow[]>();
    for (const topicId of new Set(page.map((row) => row.topic_id))) {
      const blocks = db
        .prepare(
          `SELECT b.id, b.text
             FROM material_blocks b
             JOIN material_documents d ON d.id = b.document_id
            WHERE b.topic_id = ? AND d.student_distribution = 1 AND LENGTH(b.text) >= 20
            ORDER BY b.id`,
        )
        .all(topicId) as unknown as BlockRow[];
      blocksByTopic.set(topicId, blocks);
    }

    const topics = db.prepare("SELECT id, title FROM topics").all() as unknown as {
      id: string;
      title: string;
    }[];
    const topicTitle = new Map(topics.map((topic) => [topic.id, topic.title]));

    const items = page.map((row) => {
      const needle = bigrams(`${row.question}${row.correct_answer}`);
      const blocks = (blocksByTopic.get(row.topic_id) ?? [])
        .map((block) => ({ block, score: relevance(block.text, needle) }))
        .filter((entry) => entry.score >= 3)
        .sort((left, right) => right.score - left.score || left.block.id.localeCompare(right.block.id))
        .slice(0, 3)
        .map((entry) => ({
          blockId: entry.block.id,
          excerpt:
            entry.block.text.length > 160 ? `${entry.block.text.slice(0, 160)}…` : entry.block.text,
        }));

      return {
        questionId: row.id,
        revision: row.revision,
        topicTitle: topicTitle.get(row.topic_id) ?? row.topic_id,
        questionType: row.question_type,
        question: row.question,
        options: parseJsonArray(row.options_json),
        correctAnswer: row.correct_answer,
        knowledgePoint: row.knowledge_point,
        sourceLocation: row.source_location,
        currentExplanation: row.explanation,
        textbook: blocks,
      };
    });

    const payload = {
      generatedAt: new Date().toISOString(),
      notice:
        "唯讀：本檔只供補寫解釋時核對依據，沒有修改題目、答案或任何狀態；不含學生資料。",
      scope: {
        database: path.relative(repo, databasePath).replace(/\\/g, "/"),
        topic: topicFilter ?? "(全部課題)",
        offset,
        limit,
        pendingTotal: candidates.length,
      },
      items,
    };

    const json = `${JSON.stringify(payload, null, 2)}\n`;
    if (outPath) {
      const resolved = path.isAbsolute(outPath) ? outPath : path.join(repo, outPath);
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, json, "utf8");
      console.log(`已寫入：${path.relative(repo, resolved)}`);
    } else {
      process.stdout.write(json);
    }
    console.error(
      `待補寫題目共 ${candidates.length} 題；本批 ${items.length} 題（offset ${offset}）。`,
    );
  } finally {
    db.close();
  }
}

main();
