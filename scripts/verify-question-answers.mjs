/**
 * 逐題核對「標示答案」是否與教材段落及公認史實相符。
 *
 * 這**不是**教師覆核：輸出的紀錄只會標明 `ai-textbook-verification`，
 * 供擁有者決定是否發布，以及供教師日後抽查。
 *
 * 用法：
 *   node scripts/verify-question-answers.mjs \
 *     --database data/exports/production-next.db \
 *     --out docs/quality/answer-verification-2026-10-21.jsonl \
 *     --batch 6 --concurrency 5
 *
 * 可加 `--limit 30` 先試跑，或 `--topic topic-1` 只核對某一課題。
 * 已存在於輸出檔的題目會自動略過（可中斷後續跑）。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const databasePath = arg("--database", path.join("data", "exports", "production-next.db"));
const outPath = arg("--out", path.join("docs", "quality", "answer-verification-2026-10-21.jsonl"));
const batchSize = Number(arg("--batch", "6"));
const concurrency = Number(arg("--concurrency", "5"));
const limit = arg("--limit") ? Number(arg("--limit")) : null;
const topicFilter = arg("--topic");
const includeCorrect = args.includes("--include-correct");
const idsFile = arg("--ids");
const idFilter = idsFile
  ? new Set(
      fs
        .readFileSync(idsFile, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#")),
    )
  : null;

function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

const env = { ...loadEnv(path.join(process.cwd(), ".env.local")), ...process.env };
const apiKey = env.DEEPSEEK_API_KEY ?? env.LLM_API_KEY;
const baseUrl = env.LLM_BASE_URL ?? "https://api.deepseek.com/v1";
const model = env.LLM_MODEL ?? "deepseek-flash";
if (!apiKey) {
  console.error("缺少 DEEPSEEK_API_KEY／LLM_API_KEY，無法核對。");
  process.exit(1);
}

const db = new DatabaseSync(databasePath, { readOnly: true });

/** 以中文字二元組計算詞彙重疊，用於挑選與題目最相關的教材段落。 */
function bigrams(text) {
  const cleaned = text.replace(/[\s\p{P}\p{S}a-zA-Z0-9]/gu, "");
  const grams = new Set();
  for (let i = 0; i < cleaned.length - 1; i += 1) grams.add(cleaned.slice(i, i + 2));
  return grams;
}

function overlapScore(questionGrams, text) {
  const grams = bigrams(text);
  let hits = 0;
  for (const gram of questionGrams) if (grams.has(gram)) hits += 1;
  return hits / Math.sqrt(Math.max(grams.size, 1));
}

/** 把課文段落按文件順序合併成 500-900 字的段落，並保留分節標籤。 */
function buildPassages(topicId) {
  const blocks = db
    .prepare(
      `SELECT b.section_id, b.text, b.type, b.sort_order, b.document_id
         FROM material_blocks b
         JOIN material_documents d ON d.id = b.document_id
        WHERE b.topic_id = ? AND d.kind = 'demo' AND b.type IN ('paragraph','list','heading','table')
        ORDER BY b.document_id, b.sort_order`,
    )
    .all(topicId);

  const passages = [];
  let current = { text: "", sectionId: null, documentId: null, start: 0 };
  const flush = () => {
    if (current.text.trim().length >= 80) passages.push({ ...current });
    current = { text: "", sectionId: null, documentId: null, start: 0 };
  };
  for (const block of blocks) {
    const text = (block.text ?? "").trim();
    if (!text) continue;
    if (current.documentId !== block.document_id) flush();
    if (!current.sectionId && block.section_id) current.sectionId = block.section_id;
    const isHeading = block.type === "heading";
    if (isHeading && current.text.length > 200) flush();
    if (current.text.length + text.length > 900) flush();
    if (!current.sectionId && block.section_id) current.sectionId = block.section_id;
    current.text += text + "\n";
    current.documentId = block.document_id;
  }
  flush();
  return passages;
}

const passageCache = new Map();
function relevantPassages(question) {
  if (!passageCache.has(question.topic_id)) {
    passageCache.set(question.topic_id, buildPassages(question.topic_id));
  }
  const passages = passageCache.get(question.topic_id);
  const query = `${question.question}\n${question.correct_answer}\n${question.explanation}\n${question.knowledge_point ?? ""}\n${question.source_excerpt ?? ""}`;
  const grams = bigrams(query);
  const ranked = passages
    .map((passage) => ({
      passage,
      score:
        overlapScore(grams, passage.text) +
        (passage.sectionId === question.section_id ? 0.35 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  return ranked.slice(0, 2).map((entry) => entry.passage.text.trim().slice(0, 900));
}

const questions = db
  .prepare(
    `SELECT id, topic_id, section_id, question_type, difficulty, question, options_json,
            correct_answer, accepted_answers_json, explanation, source_excerpt, knowledge_point,
            revision
       FROM questions
      WHERE (? IS NULL OR topic_id = ?)
      ORDER BY topic_id, section_id, id`,
  )
  .all(topicFilter, topicFilter);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const done = new Set();
const previous = new Map();
if (fs.existsSync(outPath)) {
  for (const line of fs.readFileSync(outPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      done.add(entry.id);
      previous.set(entry.id, entry);
    } catch {
      // 忽略損毀的最後一行
    }
  }
}

/** 本地確定性檢查：不需要 LLM 也能確定的結構問題。 */
function deterministicIssues(question) {
  const issues = [];
  let options = [];
  try {
    options = JSON.parse(question.options_json ?? "[]");
  } catch {
    issues.push("options-unparsable");
  }
  if (question.question_type === "mc") {
    if (options.length < 2) issues.push("too-few-options");
    const distinct = new Set(options.map((option) => String(option).trim()));
    if (distinct.size !== options.length) issues.push("duplicate-options");
    if (!options.map((option) => String(option).trim()).includes(question.correct_answer.trim())) {
      issues.push("answer-not-in-options");
    }
    if (options.some((option) => String(option).trim().length === 0 || String(option).trim() === ".")) {
      issues.push("empty-option");
    }
  } else {
    if (!question.correct_answer.trim()) issues.push("empty-answer");
    if (question.question.includes(question.correct_answer) && question.correct_answer.length >= 2) {
      issues.push("answer-printed-in-stem");
    }
  }
  return issues;
}

const SYSTEM_PROMPT = `你是一位香港初中歷史科教師，負責核對題庫的答案是否正確。
你會收到教材段落（課文／筆記）及題目。請逐題判斷：

1. 「標示答案」在歷史事實上是否正確（以教材段落為首要依據；教材沒有提及時，用公認史實判斷）。
2. 選擇題：是否有另一個選項同樣正確、或比標示答案更正確；題幹是否問「不是／錯誤」而你必須據此判斷。
3. 題幹是否有明顯史實錯誤（年份、人物、條約、地名）。
4. 解釋是否與標示答案或史實矛盾。

規則：
- 不要因為措辭、難度、題型或教材用語而判錯；只判斷事實與答案。
- 教材段落可能不相關；若無關，請以公認史實判斷，不要強行引用。
- 不確定時用 uncertain，不要猜。
- 只輸出 JSON，不要任何其他文字。

輸出格式：
{"results":[{"id":"題目ID","verdict":"correct|incorrect|uncertain","confidence":0,"issue":"none|wrong-answer|multiple-correct|stem-error|explanation-error|unclear","correctedAnswer":null,"reason":"30字內說明"}]}`;

function buildUserPrompt(batch) {
  const parts = [];
  parts.push("以下每題都附有教材段落（可能只有部分相關）。請逐題核對，並以 JSON 回覆。\n");
  for (const item of batch) {
    const options = (() => {
      try {
        return JSON.parse(item.options_json ?? "[]");
      } catch {
        return [];
      }
    })();
    parts.push(`【題目 ${item.id}】`);
    parts.push(`類型：${item.question_type === "mc" ? "選擇題" : "填充題"}`);
    parts.push(`課題／分節：${item.topic_id} / ${item.section_id ?? "（未分節）"}`);
    parts.push(`知識點：${item.knowledge_point ?? "（無）"}`);
    parts.push(`題幹：${item.question}`);
    if (options.length > 0) {
      options.forEach((option, index) => parts.push(`選項 ${index + 1}：${option}`));
    }
    parts.push(`標示答案：${item.correct_answer}`);
    const accepted = JSON.parse(item.accepted_answers_json ?? "[]");
    if (accepted.length > 0) parts.push(`可接受答案：${accepted.join("、")}`);
    parts.push(`解釋：${item.explanation}`);
    if (item.source_excerpt && item.source_excerpt !== item.question) {
      parts.push(`題目出處節錄：${item.source_excerpt.slice(0, 300)}`);
    }
    parts.push("教材段落：");
    for (const passage of item.passages) parts.push(`---\n${passage}\n---`);
    parts.push("");
  }
  parts.push("請回傳 JSON：{\"results\":[...]}，每題一項，id 必須與題目 ID 完全相同。");
  return parts.join("\n");
}

async function callModel(batch, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 4096,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(batch) },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) throw new Error("empty content");
    return JSON.parse(content);
  } catch (error) {
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      return callModel(batch, attempt + 1);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeResult(item, raw) {
  const verdict = ["correct", "incorrect", "uncertain"].includes(raw?.verdict)
    ? raw.verdict
    : "uncertain";
  const rawConfidence = Number(raw?.confidence);
  const confidence = Number.isFinite(rawConfidence)
    ? Math.max(0, Math.min(100, rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence))
    : null;
  return {
    id: item.id,
    revision: item.revision,
    topicId: item.topic_id,
    sectionId: item.section_id,
    type: item.question_type,
    difficulty: item.difficulty,
    question: item.question,
    markedAnswer: item.correct_answer,
    verdict,
    confidence,
    issue: typeof raw?.issue === "string" ? raw.issue : "unclear",
    correctedAnswer: typeof raw?.correctedAnswer === "string" && raw.correctedAnswer.trim() ? raw.correctedAnswer.trim() : null,
    reason: typeof raw?.reason === "string" ? raw.reason.slice(0, 200) : "",
    deterministicIssues: item.deterministicIssues,
    verifiedBy: "ai-textbook-verification",
    verifiedAt: new Date().toISOString(),
  };
}

/**
 * 校準模式：抽 N 條選擇題，故意把「標示答案」換成另一個選項，
 * 再用同一套 prompt 核對。偵測率太低代表 prompt 無法信賴。
 */
async function calibrate(count) {
  const sample = db
    .prepare(
      `SELECT id, topic_id, section_id, question_type, difficulty, question, options_json,
              correct_answer, accepted_answers_json, explanation, source_excerpt, knowledge_point,
              revision
         FROM questions
        WHERE question_type = 'mc'
          AND (? IS NULL OR topic_id = ?)
        ORDER BY RANDOM()
        LIMIT ?`,
    )
    .all(topicFilter, topicFilter, count);

  const corrupted = sample.map((question) => {
    const options = JSON.parse(question.options_json);
    const wrong = options.find((option) => option.trim() !== question.correct_answer.trim());
    return { ...question, correct_answer: wrong, passages: relevantPassages(question) };
  });

  let caught = 0;
  for (let i = 0; i < corrupted.length; i += batchSize) {
    const batch = corrupted.slice(i, i + batchSize);
    const payload = await callModel(batch);
    const byId = new Map((payload?.results ?? []).map((result) => [result?.id, result]));
    for (const item of batch) {
      const result = byId.get(item.id);
      const detected = result && result.verdict !== "correct";
      if (detected) caught += 1;
      console.log(
        `${detected ? "抓到" : "漏掉"}｜${item.id}｜假答案=${item.correct_answer.slice(0, 40)}｜verdict=${result?.verdict ?? "none"}｜${result?.reason ?? ""}`,
      );
    }
  }
  console.log(`\n校準結果：${caught}/${corrupted.length} 條故意改錯的答案被判定為非 correct。`);
}

async function main() {
  if (args.includes("--calibrate")) {
    await calibrate(limit ?? 20);
    return;
  }
  // 已核對為 correct 且信心 >= 80 的不再重跑；其餘（包括上次失敗、待裁決）重跑。
  let pending = includeCorrect
    ? questions
    : questions.filter((question) => {
        const prev = previous.get(question.id);
        return !prev || !(prev.verdict === "correct" && (prev.confidence ?? 0) >= 80);
      });
  if (idFilter) pending = pending.filter((question) => idFilter.has(question.id));
  if (limit !== null) pending = pending.slice(0, limit);
  console.log(
    `題目總數 ${questions.length}，已核對 ${done.size}，本次核對 ${pending.length}（每批 ${batchSize}，併發 ${concurrency}）`,
  );

  const batches = [];
  for (let i = 0; i < pending.length; i += batchSize) batches.push(pending.slice(i, i + batchSize));

  const out = fs.createWriteStream(outPath, { flags: "a" });
  let completed = 0;
  let failed = 0;
  let writeChain = Promise.resolve();
  const persist = (entries) => {
    writeChain = writeChain.then(
      () =>
        new Promise((resolve) => {
          const payload = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
          if (out.write(payload)) resolve();
          else out.once("drain", resolve);
        }),
    );
  };

  let cursor = 0;
  async function worker() {
    while (cursor < batches.length) {
      const batch = batches[cursor];
      cursor += 1;
      const items = batch.map((question) => ({
        ...question,
        passages: relevantPassages(question),
        deterministicIssues: deterministicIssues(question),
      }));
      try {
        const payload = await callModel(items);
        const results = Array.isArray(payload?.results) ? payload.results : [];
        const byId = new Map(results.map((result) => [result?.id, result]));
        const normalized = items.map((item) =>
          normalizeResult(item, byId.get(item.id) ?? { verdict: "uncertain", issue: "missing-result" }),
        );
        persist(normalized);
        completed += normalized.length;
      } catch (error) {
        failed += batch.length;
        console.error(`批次失敗（${batch.map((item) => item.id).join(",")}）：${error.message}`);
        persist(
          batch.map((item) =>
            normalizeResult(
              { ...item, deterministicIssues: [] },
              { verdict: "uncertain", issue: "verification-error", reason: String(error.message).slice(0, 120) },
            ),
          ),
        );
      }
      if ((completed + failed) % 60 < batchSize) {
        console.log(`進度 ${completed + failed}/${pending.length}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
  writeChain.then(() => out.end());
  console.log(`完成：成功 ${completed} 題，失敗 ${failed} 題。輸出：${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
