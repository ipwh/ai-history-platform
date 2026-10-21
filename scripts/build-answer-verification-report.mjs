/**
 * 產生 2026-10-21 全題庫逐題核對報告（Markdown）。
 *
 * 用法：
 *   node scripts/build-answer-verification-report.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const databasePath = path.join("data", "exports", "production-next.db");
const decisionsPath = path.join("docs", "quality", "answer-fixes-2026-10-21-decisions.json");
const verificationPath = path.join("docs", "quality", "answer-verification-2026-10-21.jsonl");
const adjudicationPath = path.join("docs", "quality", "answer-verification-2026-10-21-adjudication.json");
const outPath = path.join("docs", "quality", "answer-verification-2026-10-21.md");

const decisions = JSON.parse(fs.readFileSync(decisionsPath, "utf8"));
const adjudication = JSON.parse(fs.readFileSync(adjudicationPath, "utf8"));
const db = new DatabaseSync(databasePath, { readOnly: true });
const q = (sql) => db.prepare(sql).all();

const total = q("SELECT COUNT(*) c FROM questions")[0].c;
const published = q("SELECT COUNT(*) c FROM questions WHERE status='published'")[0].c;
const held = q("SELECT COUNT(*) c FROM questions WHERE teacher_confirmation_required=1")[0].c;
const reviews = q("SELECT COUNT(*) c FROM question_reviews")[0].c;

const verdicts = new Map();
for (const line of fs.readFileSync(verificationPath, "utf8").split(/\r?\n/)) {
  if (!line.trim()) continue;
  const entry = JSON.parse(line);
  verdicts.set(entry.id, entry);
}
const counts = { correct: 0, incorrect: 0, uncertain: 0 };
for (const entry of verdicts.values()) counts[entry.verdict] = (counts[entry.verdict] ?? 0) + 1;
const confidences = [...verdicts.values()].map((entry) => entry.confidence ?? 0).filter((value) => value > 0);
const averageConfidence = (
  confidences.reduce((sum, value) => sum + value, 0) / confidences.length
).toFixed(1);

function escapeCell(text) {
  return text.replace(/\|/g, "／").replace(/\n/g, " ");
}

const fixRows = decisions.items
  .map((item, index) => {
    const fields = [];
    if (item.questionTo) fields.push("題幹");
    if (item.optionsTo) fields.push("選項");
    if (item.correctAnswerTo) fields.push("答案");
    if (item.acceptedAnswersTo) fields.push("可接受答案");
    if (item.explanationTo) fields.push("解釋");
    return `| ${index + 1} | \`${item.questionId}\` | ${fields.join("、")} | ${escapeCell(item.reason)} |`;
  })
  .join("\n");

const deletionRows = (decisions.deletions ?? [])
  .map((item) => `| \`${item.questionId}\` | ${escapeCell(item.reason)} |`)
  .join("\n");

const noChangeRows = adjudication.noChangeAdjudications
  .map(
    (item) =>
      `| \`${item.questionId}\` | ${item.modelVerdict}／${item.modelIssue} | ${escapeCell(item.decision)} | ${escapeCell(item.basis)} |`,
  )
  .join("\n");

const report = `# 2026-10-21 全題庫逐題核對報告（AI 教材核對）

> **這不是教師覆核。** 本輪由 AI 逐題核對答案是否與教材及公認史實一致，紀錄一律標示
> \`ai-textbook-verification\`；沒有寫入任何 \`question_reviews\`。教師端仍會如實顯示
> 「已發布（未經人工覆核）」。擁有者已於 2026-10-21 明確授權以這種方式核對並發布。

## 1. 範圍

| 項目 | 數值 |
| --- | --- |
| 核對的正式題庫 | \`data/exports/production-next.db\`（部署前的正式快照） |
| 題目總數（核對開始時） | 2,082（已發布 2,056、草稿 26） |
| 題型 | 選擇題 1,179、填充題 903 |
| 來源 | 校內試題 1,786、AI 生成 260、示範 36 |
| 核對後題目總數 | **${total}**（全部已發布） |

## 2. 方法

1. **教材段落檢索**：由正式資料庫的課文／筆記（\`material_documents.kind = 'demo'\`）按文件順序
   合併成約 900 字的段落，再以題幹、答案、解釋及知識點的中文二元組重疊度排序，取最相關的兩段。
2. **逐題核對**：每批 6 題送入平台的 DeepSeek API（\`deepseek-flash\`），要求模型：
   判斷標示答案是否正確、選擇題是否有另一個同樣正確的選項、題幹是否有史實錯誤、解釋是否與答案矛盾；
   不確定時必須回答 \`uncertain\`。
3. **確定性檢查**：同時檢查選項重複、答案不在選項中、空選項、填充題答案為空等結構問題。
4. **逐題裁決**：所有非 \`correct\` 的結果由人工（AI 助理）逐題查閱教材段落、必要時查閱權威網上資源，
   再決定「修正」、「刪除」或「維持並記錄誤報」。
5. **修正後重核**：33 條修正題目全部再核對一次，結果均為 \`correct\`（信心 90–100）。

### 校準

抽 20 條選擇題，故意把標準答案換成另一個選項，再以同一 prompt 核對：
**20/20 條被判定為非 \`correct\`**。這證明 prompt 對答案錯誤有足夠敏感度，但不能證明沒有漏報。

## 3. 核對結果

下表是**每題最後一次判定**（證據檔已按題號去重；修正後的題目已重新核對）：

| 結果 | 題數 |
| --- | --- |
| \`correct\` | ${counts.correct} |
| \`incorrect\` | ${counts.incorrect} |
| \`uncertain\` | ${counts.uncertain} |
| 平均信心 | ${averageConfidence} / 100 |

第一輪核對時有 47 題（2.3%）被標示，另有部分題目在第二輪重核時被標示；全部均經逐題裁決：
33 題修正、2 題刪除、3 題維持原答案（見第 6 節）。其餘題目的最後判定為 \`correct\`。

## 4. 修正（33 題）

完整的新值、現值及理由見 [answer-fixes-2026-10-21.json](answer-fixes-2026-10-21.json)；
套用紀錄見 [content-fixes-applied.json](content-fixes-applied.json)。

| # | 題號 | 修正欄位 | 理由 |
| --- | --- | --- | --- |
${fixRows}

## 5. 刪除（2 題）

| 題號 | 理由 |
| --- | --- |
${deletionRows}

兩題的作答、題目回報及覆核紀錄均為 0；刪除清單見
[question-queue-actions-2026-10-21-image-deletions.json](../teacher-review/question-queue-actions-2026-10-21-image-deletions.json)。

## 6. 模型誤報，維持原答案（3 題）

| 題號 | 模型判定 | 裁決 | 依據 |
| --- | --- | --- | --- |
${noChangeRows}

## 7. 修正後狀態

| 指標 | 數值 |
| --- | --- |
| 題目總數 | ${total} |
| 已發布 | ${published} |
| 待教師確認（\`teacher_confirmation_required\`） | ${held} |
| \`question_reviews\` 覆核紀錄 | ${reviews}（本輪沒有新增） |
| \`PRAGMA integrity_check\` | ok |
| 不可作答（\`audit:servability\`） | 0 |

26 條原本被品質閘門暫緩的草稿，逐題核對為 \`correct\`（信心 85–100）後，以擁有者授權的
內容決定解除暫緩並發布；原暫緩理由保留在 \`quality_warnings_json\`，另附一行決定紀錄。
決定檔：[owner-overrides-ai-2026-10-21.json](../teacher-review/owner-overrides-ai-2026-10-21.json)；
發布紀錄：[owner-publication-overrides-ai-2026-10-21.json](../teacher-review/owner-publication-overrides-ai-2026-10-21.json)。

## 8. 明確不聲稱的事項

1. 這 2,080 題**沒有**逐題教師覆核紀錄；\`question_reviews\` 仍是 ${reviews} 筆（本輪沒有新增）。
2. AI 核對可能漏報；校準只證明「故意改錯的答案能被抓出」，不證明「沒有錯的題目一定正確」。
3. 教材段落檢索以字詞重疊排序，部分題目（尤其校內試題）未必抽到最相關段落；模型會以公認史實補足，
   但這代表部分判斷並非直接引用教材。
4. 知識點欄位有少量匯入時留下的異常值（例如「A. 國家W」、「D. iii、iv」）及 564 題只寫「校內試題」；
   本輪**沒有**改動，因為修改會令既有教師覆核紀錄失效，應以獨立遷移處理。
5. 平台不支援題目附圖，因此兩條只寫「圖中…」的題目已刪除；其他題目如有未發現的圖片依賴，仍需教師抽查。

## 9. 重現步驟

\`\`\`powershell
# 1. 逐題核對（可中斷後續跑；已 correct 且信心 >= 80 的不會重跑）
node scripts/verify-question-answers.mjs --database data/exports/production-next.db \\
  --out docs/quality/answer-verification-2026-10-21.jsonl --batch 6 --concurrency 6

# 2. 由裁決檔產生修正／刪除清單
$env:APP_DATABASE_PATH="data/exports/production-next.db"
npx tsx scripts/build-answer-verification-plan.ts \\
  --decisions docs/quality/answer-fixes-2026-10-21-decisions.json \\
  --out docs/quality/answer-fixes-2026-10-21.json \\
  --deletions docs/teacher-review/question-queue-actions-2026-10-21-image-deletions.json

# 3. 先模擬，再加 --apply
npx tsx scripts/fix-question-content.ts --plan docs/quality/answer-fixes-2026-10-21.json \\
  --owner-email ipwh@pochiu.edu.hk
npx tsx scripts/apply-question-queue.ts \\
  --manifest docs/teacher-review/question-queue-actions-2026-10-21-image-deletions.json
\`\`\`

## 10. 權威網上資源

${adjudication.authoritativeWebSources
  .map((source) => `- ${source.topic}：${source.url}${source.relatedUrl ? `；${source.relatedUrl}` : ""}。${source.conclusion}`)
  .join("\n")}
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, report, "utf8");
console.log(`✓ 報告：${outPath}`);
