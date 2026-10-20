/**
 * 內容改進工作清單（唯讀、可重複執行）。
 *
 * 針對 2026-10-19 內容稽核的三類問題，產生**可操作**的清單：
 *   1. 解釋為佔位文字／只列答案／過短／疑似矛盾 → 需補寫解釋
 *   2. 技能標籤空白 → 需教師確認技能
 *
 * 每一題會附上：
 *   - 題幹摘要、現有解釋、正確答案（教師判斷需要，屬教師端資料）
 *   - 知識點、來源節錄及來源位置（如有）
 *   - 建議的「解釋改進類型」及理由
 *   - 建議的歷史技能（排序後的候選，附信心及理由）
 *
 * **本腳本不會改寫任何東西**：不寫題目、不寫答案、不寫技能、不寫覆核，
 * 亦不會把建議技能當成已確認。標記工作狀態請用
 * `scripts/apply-content-improvement-flags.ts`。
 *
 * 用法：
 *   npx tsx scripts/build-content-improvement-worklist.ts
 *   npx tsx scripts/build-content-improvement-worklist.ts --database "C:\\temp\\snapshot.db"
 *   npx tsx scripts/build-content-improvement-worklist.ts --out-json docs/quality/x.json --out-md docs/teacher-review/x.md
 */
import fs from "node:fs";
import path from "node:path";

import {
  buildContentWorklist,
  CONTENT_WORKLIST_REPORT_PATH,
  type ContentWorkItem,
  type ContentWorklistPayload,
} from "../src/server/services/content-improvement";
import { IMPROVEMENT_TYPE_LABELS, type ImprovementType } from "../src/server/quality/explanation-improvement";
import { CONTENT_FLAG_LABELS } from "../src/server/quality/content-flags";

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

const DEFAULT_JSON = CONTENT_WORKLIST_REPORT_PATH;
const DEFAULT_MD = path.join(
  "docs",
  "teacher-review",
  "explanation-skill-worklist-2026-10-20.md",
);

/** 每類問題在 Markdown 內顯示的樣本數（完整清單在 JSON） */
const SAMPLE_PER_TYPE = 5;

function countByTopic(items: ContentWorkItem[], needExplanation: boolean): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (needExplanation && item.explanation === null) continue;
    if (!needExplanation && item.skill === null) continue;
    counts.set(item.topicTitle, (counts.get(item.topicTitle) ?? 0) + 1);
  }
  return counts;
}

function esc(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function writeMarkdown(payload: ContentWorklistPayload, outPath: string): void {
  const lines: string[] = [];
  const explanationItems = payload.items.filter((item) => item.explanation !== null);
  const skillItems = payload.items.filter((item) => item.skill !== null);

  lines.push("# 解釋補寫及技能標籤工作清單");
  lines.push("");
  lines.push(`> ${payload.notice}`);
  lines.push("");
  lines.push(`- 產生時間：${payload.generatedAt}`);
  lines.push(`- 內容指紋：\`${payload.inputFingerprint}\``);
  lines.push(`- 題目總數：${payload.totals.questions}（已發布 ${payload.totals.published}）`);
  lines.push(`- 需要處理的題目：**${payload.totals.needsWork}**`);
  lines.push("");
  lines.push("## 一、解釋需要補寫");
  lines.push("");
  lines.push("| 分類 | 題數 |");
  lines.push("| --- | --- |");
  for (const [name, count] of Object.entries(payload.totals.explanationByClass)) {
    lines.push(`| ${name} | ${count} |`);
  }
  lines.push("");
  lines.push("| 建議改進類型 | 題數 |");
  lines.push("| --- | --- |");
  const improvements = Object.entries(payload.totals.explanationByImprovement).sort(
    (left, right) => right[1] - left[1],
  );
  for (const [type, count] of improvements) {
    lines.push(`| ${IMPROVEMENT_TYPE_LABELS[type as ImprovementType] ?? type} | ${count} |`);
  }
  lines.push("");
  lines.push("### 按課題分佈");
  lines.push("");
  lines.push("| 課題 | 需補寫解釋的題數 |");
  lines.push("| --- | --- |");
  for (const [topic, count] of [...countByTopic(explanationItems, true)].sort(
    (left, right) => right[1] - left[1],
  )) {
    lines.push(`| ${esc(topic)} | ${count} |`);
  }
  lines.push("");
  lines.push("### 樣本（每類最多 " + SAMPLE_PER_TYPE + " 題；完整清單見 JSON）");
  lines.push("");
  for (const [type, count] of improvements) {
    const samples = explanationItems
      .filter((item) => item.explanation?.improvement === type)
      .slice(0, SAMPLE_PER_TYPE);
    if (samples.length === 0) continue;
    lines.push(`#### ${IMPROVEMENT_TYPE_LABELS[type as ImprovementType] ?? type}（${count} 題）`);
    lines.push("");
    lines.push("| 題目 ID | 題幹（前 80 字） | 現有解釋 | 正確答案 |");
    lines.push("| --- | --- | --- | --- |");
    for (const item of samples) {
      lines.push(
        `| ${item.questionId} | ${esc(item.stemSummary)} | ${esc(item.currentExplanation)} | ${esc(item.correctAnswer)} |`,
      );
    }
    lines.push("");
  }

  lines.push("## 二、技能標籤空白");
  lines.push("");
  lines.push(`- 未標示技能的題目：**${payload.totals.skillMissing}**`);
  const confidences = payload.totals.skillSuggestionByConfidence;
  lines.push(
    `- 首選建議的信心分佈：高 ${confidences.high}、中 ${confidences.medium}、低 ${confidences.low}`,
  );
  lines.push("");
  lines.push("| 課題 | 未標示技能的題數 |");
  lines.push("| --- | --- |");
  for (const [topic, count] of [...countByTopic(skillItems, false)].sort(
    (left, right) => right[1] - left[1],
  )) {
    lines.push(`| ${esc(topic)} | ${count} |`);
  }
  lines.push("");
  const highConfidence = skillItems
    .filter((item) => item.skill?.suggestions[0]?.confidence === "high")
    .slice(0, SAMPLE_PER_TYPE);
  lines.push("### 高信心樣本（關鍵詞明確命中）");
  lines.push("");
  if (highConfidence.length === 0) {
    lines.push("（本題庫沒有高信心樣本）");
  } else {
    lines.push("| 題目 ID | 題幹（前 80 字） | 建議技能 | 理由 |");
    lines.push("| --- | --- | --- | --- |");
    for (const item of highConfidence) {
      const suggestion = item.skill?.suggestions[0];
      lines.push(
        `| ${item.questionId} | ${esc(item.stemSummary)} | ${esc(suggestion?.skill ?? "")} | ${esc(suggestion?.reason ?? "")} |`,
      );
    }
  }
  lines.push("");
  lines.push("## 三、如何使用");
  lines.push("");
  lines.push("```bash");
  lines.push("# 1. 重新產生工作清單（唯讀）");
  lines.push("npm run audit:explanation-worklist");
  lines.push("");
  lines.push("# 2. 把其中一批標記為「解釋待重寫」（預設模擬，不寫入）");
  lines.push(`npm run flag:content-improvement -- --flag explanation_needs_rewrite --limit 50 --reason "2026-10 內容稽核：解釋為佔位文字"`);
  lines.push("");
  lines.push("# 3. 確認輸出無誤後才真正寫入");
  lines.push(`npm run flag:content-improvement -- --flag explanation_needs_rewrite --limit 50 --reason "2026-10 內容稽核：解釋為佔位文字" --actor teacher@pochiu.edu.hk --apply`);
  lines.push("```");
  lines.push("");
  lines.push("## 四、界線");
  lines.push("");
  lines.push("- 本清單**不改變**任何題目的正確答案、選項或解釋內容；");
  lines.push("- 建議技能只是候選，教師確認前**不會**寫入題目的 `skill` 欄位；");
  lines.push("- 標記（" + Object.values(CONTENT_FLAG_LABELS).join("／") + "）是工作狀態，不是覆核決定，不會改變發布狀態；");
  lines.push("- 是否暫緩派發佔位解釋的題目屬產品政策，見 `EXPLANATION_HOLD_POLICY`（預設關閉）。");
  lines.push("");

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${lines.join("\n")}\n`, "utf8");
}

function main(): void {
  const repo = process.cwd();
  const databasePath = path.resolve(
    readArg("--database") ?? path.join(repo, "data", "app.db"),
  );
  const outJson = path.resolve(readArg("--out-json") ?? path.join(repo, DEFAULT_JSON));
  const outMd = path.resolve(readArg("--out-md") ?? path.join(repo, DEFAULT_MD));

  if (!fs.existsSync(databasePath)) throw new Error(`找不到資料庫：${databasePath}`);

  const payload = buildContentWorklist(databasePath);
  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  writeMarkdown(payload, outMd);

  const { totals } = payload;
  console.log("唯讀工作清單：沒有修改任何題目、答案、覆核或發布狀態。");
  console.log(
    `題目：${totals.questions}（已發布 ${totals.published}）；需要處理 ${totals.needsWork}`,
  );
  console.log(`解釋分類：${JSON.stringify(totals.explanationByClass)}`);
  console.log(`建議改進類型：${JSON.stringify(totals.explanationByImprovement)}`);
  console.log(
    `技能空白：${totals.skillMissing}；首選建議信心：${JSON.stringify(totals.skillSuggestionByConfidence)}`,
  );
  console.log(`指紋：${payload.inputFingerprint}`);
  console.log(`已寫入：${path.relative(repo, outJson)}`);
  console.log(`已寫入：${path.relative(repo, outMd)}`);
}

main();
