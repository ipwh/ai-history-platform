/**
 * Sprint 19：依**原始試題檔**還原陳述分行並補回羅馬數字編號（唯讀規劃、需 --apply）。
 *
 * 只用於「題幹陳述與原卷逐字相同、只是匯入時遺失分行與編號」的題目：
 * 陳述文字一律取自 materials/*.docx，不自行撰寫或改寫任何歷史內容。
 *
 *   npx tsx scripts/apply-roman-labels-from-source.ts            # 乾跑
 *   npx tsx scripts/apply-roman-labels-from-source.ts --apply    # 寫入
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { extractQuestionBankText } from "../src/server/materials/question-bank";

const SHOULD_APPLY = process.argv.includes("--apply");
const ROMAN = ["i", "ii", "iii", "iv"];
const IDS = [
  "qb-JTH2ndEdMCQ09050",
  "qb-JTH2ndEdMCQ09126",
  "qb-JTH2ndEdMCQ10041",
  "qb-NJCMN0120000013",
  "qb-NJCMN0120000056",
];
const REPO = process.cwd();
const DB_PATH = path.join(REPO, "data", "app.db");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function isOptionLine(line: string): boolean {
  return (
    line.startsWith("@O") ||
    /^(i|ii|iii|iv)(及|、)/.test(line) ||
    /^全部|^以上/.test(line) ||
    /^[A-D][.、]/.test(line)
  );
}

function normalise(value: string): string {
  return value.replace(/[\s　]+/g, "").replace(/^(\(?[ivxIVX]{1,4}\)?[.、]?)/, "");
}

async function main(): Promise<void> {
  const db = new DatabaseSync(DB_PATH);
  const files = walk(path.join(REPO, "materials"));
  const byName = new Map(files.map((file) => [path.basename(file), file]));
  const cache = new Map<string, string[]>();

  try {
    const select = db.prepare(
      "SELECT question, options_json, correct_answer, revision, source_location FROM questions WHERE id = ?",
    );

    if (SHOULD_APPLY) {
      const backupDir = path.join(REPO, "data", "backups");
      fs.mkdirSync(backupDir, { recursive: true });
      const backup = path.join(backupDir, `app-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
      fs.copyFileSync(DB_PATH, backup);
      console.log(`已備份：${path.relative(REPO, backup)}`);
    }

    db.exec("BEGIN IMMEDIATE");
    let applied = 0;
    const manual: string[] = [];

    for (const id of IDS) {
      const row = select.get(id) as
        | {
            question: string;
            options_json: string | null;
            correct_answer: string;
            revision: number;
            source_location: string | null;
          }
        | undefined;
      if (!row) {
        console.log(`${id}: 不存在，略過`);
        continue;
      }

      const [fileName] = (row.source_location ?? "").split("·").map((part) => part.trim());
      const file = byName.get(fileName);
      if (!file) {
        manual.push(`${id}: 找不到原卷 ${fileName}`);
        continue;
      }
      let lines = cache.get(file);
      if (!lines) {
        const text = await extractQuestionBankText(fs.readFileSync(file));
        lines = text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        cache.set(file, lines);
      }

      const probe = normalise(row.question).slice(0, 10);
      const start = lines.findIndex((line) => normalise(line).includes(probe));
      if (start < 0) {
        manual.push(`${id}: 原卷找不到題幹`);
        continue;
      }

      const questionLine = lines[start];
      const statements: string[] = [];
      for (let index = start + 1; index < lines.length && statements.length < 4; index += 1) {
        const line = lines[index];
        if (isOptionLine(line)) break;
        statements.push(line);
      }
      if (statements.length !== 4) {
        manual.push(`${id}: 原卷陳述數為 ${statements.length}，不是 4`);
        continue;
      }

      // 必須每一句都能在現有題幹中逐字找到，否則代表題幹已被改寫，不可自動處理。
      const currentNormalised = normalise(row.question);
      const missing = statements.filter((line) => !currentNormalised.includes(normalise(line)));
      if (missing.length > 0) {
        manual.push(`${id}: 題幹與原卷不一致（缺 ${missing.length} 句），需教師裁決`);
        continue;
      }

      const answerLabels = row.correct_answer.match(/[ivx]+/g) ?? [];
      const invalid = answerLabels.filter((label) => !ROMAN.includes(label));
      if (invalid.length > 0) {
        manual.push(`${id}: 答案引用不存在的編號 ${invalid.join("、")}`);
        continue;
      }

      const rebuilt = `${questionLine} ${statements
        .map((line, index) => `${ROMAN[index]}. ${line}`)
        .join(" ")}`;

      console.log(`${id}:`);
      console.log(`  原：${row.question}`);
      console.log(`  新：${rebuilt}`);

      if (SHOULD_APPLY) {
        db.prepare(
          `UPDATE questions
           SET question = ?, revision = revision + 1,
               auto_validated_at = NULL, auto_validated_revision = NULL, auto_validated_fingerprint = NULL
           WHERE id = ?`,
        ).run(rebuilt, id);
      }
      applied += 1;
    }

    if (SHOULD_APPLY) db.exec("COMMIT");
    else db.exec("ROLLBACK");

    console.log(`\n${SHOULD_APPLY ? "已套用" : "乾跑"}：${applied} 題`);
    if (manual.length > 0) {
      console.log("需人工處理：");
      for (const line of manual) console.log(`  - ${line}`);
    }
    if (!SHOULD_APPLY) console.log("（沒有寫入任何資料；加 --apply 才會執行）");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

void main();
