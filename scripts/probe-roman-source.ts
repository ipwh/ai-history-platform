/**
 * 唯讀探測：由原始試題檔（materials/*.docx）還原指定題目的原文段落。
 *
 * 只輸出原文行，不修改任何資料；用途是取得匯入時遺失的陳述分行與編號，
 * 避免以推測方式補上歷史內容。
 */
import fs from "node:fs";
import path from "node:path";

import { openReadOnlyDatabase } from "../src/server/db/connection";
import { extractQuestionBankText } from "../src/server/materials/question-bank";

const IDS = [
  "qb-NJCMN0060000045",
  "qb-JTH2ndEdMCQ09050",
  "qb-JTH2ndEdMCQ09126",
  "qb-JTH2ndEdMCQ10041",
  "qb-JTH2ndEdMCQ10099",
  "qb-NJCMN0120000013",
  "qb-NJCMN0120000056",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

async function main(): Promise<void> {
  const repo = process.cwd();
  const db = openReadOnlyDatabase(path.join(repo, "data", "app.db"));
  const rows = IDS.map((id) => {
    const row = db
      .prepare("SELECT id, question, source_location FROM questions WHERE id = ?")
      .get(id) as { id: string; question: string; source_location: string | null } | undefined;
    return { id, row };
  });
  db.close();

  const files = walk(path.join(repo, "materials"));
  const byName = new Map(files.map((file) => [path.basename(file), file]));
  const cache = new Map<string, string[]>();

  for (const { id, row } of rows) {
    console.log(`\n================ ${id}`);
    if (!row) {
      console.log("（資料庫找不到）");
      continue;
    }
    console.log("目前題幹：", row.question);
    const [fileName] = (row.source_location ?? "").split("·").map((part) => part.trim());
    const file = byName.get(fileName);
    if (!file) {
      console.log(`找不到檔案：${fileName}`);
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
    const probe = row.question.replace(/[＿_]{2,}/g, " ").slice(0, 10).trim();
    const start = lines.findIndex((line) => line.includes(probe));
    if (start < 0) {
      console.log(`原文找不到起點「${probe}」`);
      continue;
    }
    console.log(`原文（${fileName} 第 ${start + 1} 行起）：`);
    for (let index = start; index < Math.min(start + 14, lines.length); index += 1) {
      console.log(`  ${index + 1}| ${lines[index]}`);
    }
  }
}

void main();
