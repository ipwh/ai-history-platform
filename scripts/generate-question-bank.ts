/**
 * 為所有課題生成練習題目（供 AI／本地示範生成使用）。
 *
 * 用法：
 *   npm run generate:questions                    # 為所有有教材的課題生成題目
 *   npm run generate:questions -- --topic topic-5 # 只處理指定課題
 *   npm run generate:questions -- --count 6       # 每個分節的目標題數（平均分配至三個難度）
 *   npm run generate:questions -- --types mc      # 只補選擇題（預設 mc,fill）
 *   npm run generate:questions -- --draft-only    # 只建立草稿，不自動發布
 *
 * 說明：
 *   - 生成後會經過 schema 驗證及教材依據核對，沒有依據的題目不會儲存。
 *   - 每個分節的目標題數會平均分配到基礎／進階／挑戰，確保題庫齊備三個難度。
 *   - `--types mc` 會只計算及生成選擇題，適合「每個分節補齊三種難度的選擇題」
 *     （目標題數及現有題數都不會把填充題計算在內）。
 *   - 本地示範生成（LLM_PROVIDER=mock）只會產生答案唯一的題目；
 *     若分節教材以敘述為主，可能無法生成題目，會如實回報而不會產生含糊題目。
 *   - DEMO_AUTO_PUBLISH_QUESTIONS（預設 true）為 true 時，示範模式下生成的題目會
 *     自動發布，令學生無需教師逐一審核也可練習；正式環境請設為 false，
 *     只影響未經任何驗證的示範題目；通過自動品質驗證的題目另有開關（AUTO_PUBLISH_VALIDATED_QUESTIONS）。
 */
import { getDb } from "../src/server/db/connection";
import { DIFFICULTY_LABELS, type QuestionType } from "../src/lib/types";
import { describeLlm } from "../src/server/llm";
import { countQuestions } from "../src/server/repositories/questions";
import { generateQuestionBank } from "../src/server/services/question-bank";

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

/** `--types mc` / `--types mc,fill`；省略時沿用預設（兩者都生成） */
function readTypes(): QuestionType[] | undefined {
  const raw = readArg("--types");
  if (!raw) return undefined;
  const parts = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const invalid = parts.filter((value) => value !== "mc" && value !== "fill");
  if (invalid.length > 0 || parts.length === 0) {
    console.error(`--types 只接受 mc 或 fill（以逗號分隔），收到：${raw}`);
    process.exit(1);
  }
  return parts as QuestionType[];
}

async function main() {
  const draftOnly = process.argv.includes("--draft-only");
  const questionTypes = readTypes();
  const llm = describeLlm();

  getDb();
  console.log(`生成題目：provider = ${llm.providerLabel}`);
  console.log(
    `題型：${questionTypes ? questionTypes.join("、") : "mc、fill（預設）"}；` +
      `每個分節目標 ${Number(readArg("--count") ?? 5)} 題（平均分配至三個難度）`,
  );

  const report = await generateQuestionBank({
    topicId: readArg("--topic"),
    perSection: Number(readArg("--count") ?? 5),
    ...(questionTypes ? { questionTypes } : {}),
    draftOnly,
    onTopic: (message) => console.log(`  ${message}`),
  });

  const byDifficulty = `基礎 ${report.createdByDifficulty.basic} 題、進階 ${report.createdByDifficulty.advanced} 題、挑戰 ${report.createdByDifficulty.challenge} 題`;
  if (report.autoPublishSuppressedReason) {
    console.log(`\n！${report.autoPublishSuppressedReason}`);
  }
  console.log(
    report.autoPublish
      ? `\n✓ 共新增 ${report.created} 題（${byDifficulty}），其中 ${report.published} 題已自動發布（示範模式）。`
      : `\n✓ 共新增 ${report.created} 題（${byDifficulty}）。`,
  );
  console.log(
    `  通過自動品質驗證：${report.autoPublishedValidated} 題，其中 ${report.publishedValidated} 題已即時供學生練習（Sprint 7.8）；` +
      "未通過驗證者為草稿，需教師在「題目管理」覆核、修正或重新驗證。",
  );  console.log(
    "  題庫難度分佈（所有課題）：" +
      (["basic", "advanced", "challenge"] as const)
        .map(
          (difficulty) =>
            `${DIFFICULTY_LABELS[difficulty]} ${countQuestions({
              difficulties: [difficulty],
              ...(questionTypes ? { questionTypes } : {}),
            })}`,
        )
        .join("、"),
  );

  if (report.duplicateSections.length > 0) {
    console.log(
      `\n提示：${report.duplicateSections.length} 個分節已達目標題數，沒有再新增（避免重複題目）：`,
    );
    for (const label of report.duplicateSections) console.log(`  - ${label}`);
  }

  if (report.insufficientSections.length > 0) {
    console.log(
      `\n！以下 ${report.insufficientSections.length} 個分節未能產生合乎要求的題目（教材內容不足或未通過教材依據核對）：`,
    );
    for (const label of report.insufficientSections) console.log(`  - ${label}`);
    console.log(
      "  建議：補充教材內容、改用其他題型／難度，或由教師在「題目管理」手動建立題目；\n" +
        "  學生練習這些分節時仍會使用題庫既有題目，或即時以教材內容生成。",
    );
  }

  console.log("\n完成。可開啟 /teacher/questions 查看及核對題目。");
}

main().catch((error) => {
  console.error("生成題目失敗：", error);
  process.exit(1);
});
