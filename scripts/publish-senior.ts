/**
 * 發布高中課題（中四至中六）。
 *
 * 用法：
 *   npm run publish:senior                         # 發布全部已完成教材及題目的高中課題
 *   npm run publish:senior -- --topics hs-topic-1,hs-topic-2
 *   npm run publish:senior -- --force              # 即使未匯入教材／未有已發布題目亦發布
 *
 * 預設只發布「已有教材段落及至少一條已發布題目」的課題，避免學生看到空課題。
 * 指令只改變 `topics.published`，不會修改任何題目、教材或學生記錄。
 */
import { getDb } from "../src/server/db/connection";
import { countQuestions } from "../src/server/repositories/questions";
import {
  countMaterialBlocks,
  getTopic,
  setTopicPublished,
} from "../src/server/repositories/topics";
import { SENIOR_CURRICULUM_TOPICS } from "../src/server/seed/senior-curriculum";

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

function main(): void {
  const db = getDb();
  const requested = readArg("--topics");
  const force = process.argv.includes("--force");
  const allIds = SENIOR_CURRICULUM_TOPICS.map((topic) => topic.id);
  const ids = requested
    ? requested.split(",").map((value) => value.trim()).filter(Boolean)
    : allIds;

  const unknown = ids.filter((id) => !allIds.includes(id));
  if (unknown.length > 0) {
    console.error(`不屬於高中課程的課題：${unknown.join(", ")}`);
    process.exit(1);
  }

  let published = 0;
  let skipped = 0;
  for (const id of ids) {
    const topic = getTopic(id);
    if (!topic) {
      console.log(`- ${id}：尚未建立（請先執行資料庫遷移及課程種子）`);
      skipped += 1;
      continue;
    }
    const materials = countMaterialBlocks(id);
    const questions = countQuestions({ topicId: id, statuses: ["published"] });
    const ready = materials > 0 && questions > 0;

    if (!ready && !force) {
      console.log(
        `- ${topic.title}：未發布（教材 ${materials} 段、已發布題目 ${questions} 條；` +
          "請先匯入教材及生成題目，或使用 --force）",
      );
      skipped += 1;
      continue;
    }

    setTopicPublished(id, true);
    published += 1;
    console.log(
      `✓ ${topic.title}：已發布（教材 ${materials} 段、已發布題目 ${questions} 條）`,
    );
  }

  // 只讀一次 DB，確保連線在程序結束前正常關閉
  db.close();
  console.log(`\n完成：發布 ${published} 個、略過 ${skipped} 個。`);
  if (published === 0 && skipped > 0) process.exit(1);
}

main();
