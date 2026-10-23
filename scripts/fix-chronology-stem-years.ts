/**
 * 刪去「時序題題幹內的年份」清單套用工具（預設模擬，必須 `--apply` 才寫入）。
 *
 * 為甚麼需要一個獨立工具：
 *   `checkQuestionServable` 會攔下「題幹已把年份寫在事件之前」的時序題（學生只須比較
 *   題幹印出的年份即可排序，題目沒有考核時序）。這類題目已發布但仍不可派給學生，
 *   令發布閘門 FAIL。修法是**刪去題幹的年份**——這是逐題的文字判斷，不可用一個通用
 *   正則批量改寫（會產生「其後於與追隨者」這類殘句），因此改為清單驅動：
 *   每項都寫明 `before`／`after` 及理由，套用時核對目前版本是否仍與 `before` 相同。
 *
 * 用法：
 *   npx tsx scripts/fix-chronology-stem-years.ts                       # 模擬（預設，唯讀）
 *   npx tsx scripts/fix-chronology-stem-years.ts --apply --actor you@pochiu.edu.hk
 *   npx tsx scripts/fix-chronology-stem-years.ts --manifest <路徑> --database <資料庫> --apply --actor … \
 *     [--actor-role automation]
 *
 * 安全限制：
 *   - `--apply` 必須提供 `--actor`（紀錄不可無名）；`--actor-role` 預設 `automation`；
 *   - 只改 `question`（題幹）一個欄位，答案、選項、解釋、知識點及教材依據一律不變；
 *   - 修改後即時下架（狀態回到 `draft`）並把 `revision` +1，需教師重新覆核才可再發布；
 *   - **整批在單一資料庫交易內套用**：交易內會重新核對每一題的題幹、版本及狀態，
 *     任何一項不符即整批回滾（見 `question-service.applyQuestionStemBatch`）；
 *   - 每項變更寫入 `question_mutations`（操作者、工具、改動前後版本／指紋／題幹）。
 *     這是**內容變更紀錄**，不是教師覆核：腳本不會建立任何 `question_reviews` 紀錄。
 */
import fs from "node:fs";
import path from "node:path";

import type { Question } from "../src/lib/types";

interface ChangeEntry {
  questionId: string;
  topicId?: string;
  before: string;
  after: string;
  note?: string;
}

interface Manifest {
  generatedAt?: string;
  notice?: string;
  reason?: string;
  actor?: string;
  changes: ChangeEntry[];
}

function readArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const actor = readArg(argv, "--actor")?.trim() ?? "";
  const actorRole = readArg(argv, "--actor-role")?.trim() || "automation";
  const database = readArg(argv, "--database");
  const manifestPath = path.resolve(
    readArg(argv, "--manifest") ??
      path.join("docs", "teacher-review", "chronology-stem-fixes-2026-10-23.json"),
  );

  // 必須在載入資料庫模組（會讀取設定）之前指定資料庫路徑
  if (database) process.env.APP_DATABASE_PATH = path.resolve(database);

  if (!fs.existsSync(manifestPath)) {
    console.error(`找不到清單：${manifestPath}`);
    return 1;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
  if (!Array.isArray(manifest.changes) || manifest.changes.length === 0) {
    console.error("清單沒有任何項目。");
    return 1;
  }
  if (apply && actor.length === 0) {
    console.error("--apply 必須提供 --actor <電郵>：修改紀錄不可無名。");
    return 1;
  }
  const { checkQuestionServable } = await import("../src/server/services/question-servability");
  const { chronologyGivenAwayReason } = await import("../src/server/llm/chronology-stem");
  const { getQuestion } = await import("../src/server/repositories/questions");
  const { applyQuestionStemBatch } = await import("../src/server/services/question-service");
  const { questionInputSchema } = await import("../src/lib/types");
  const { getServerConfig } = await import("../src/server/config");

  // 由完整題目建立 `updateManualQuestion` 所需的輸入（只覆寫題幹）——乾跑時用來確認
  // 產生的輸入合法；正式寫入由 `applyQuestionStemBatch` 在單一交易內完成。
  const inputFrom = (question: Question, nextStem: string) => {
    const { id, createdAt, sourceVerified, revision, ...rest } = question;
    void id;
    void createdAt;
    void sourceVerified;
    void revision;
    return questionInputSchema.parse({
      ...rest,
      question: nextStem,
      // 編輯一律回到草稿：內容已改變，舊覆核紀錄随即可失效（見 question-service）。
      status: "draft",
    });
  };

  console.log(`資料庫：${getServerConfig().databasePath}`);
  console.log(`清單：${path.basename(manifestPath)}（${manifest.changes.length} 項）`);
  console.log(`模式：${apply ? `套用（--apply，負責人 ${actor}）` : "模擬（預設，唯讀，不寫入）"}`);
  if (manifest.reason) console.log(`理由：${manifest.reason}`);
  console.log("");

  const failures: string[] = [];
  const pending: { entry: ChangeEntry; question: Question }[] = [];

  for (const entry of manifest.changes) {
    const question = getQuestion(entry.questionId);
    if (!question) {
      failures.push(`${entry.questionId}：題庫找不到這條題目`);
      continue;
    }
    if (question.question.trim() !== entry.before.trim()) {
      failures.push(
        `${entry.questionId}：目前題幹與清單的 before 不同（題目已被修改？），拒絕套用`,
      );
      continue;
    }

    const stillGivenAway = chronologyGivenAwayReason(entry.after);
    if (stillGivenAway !== null) {
      failures.push(`${entry.questionId}：修改後仍被判定為時序答案外洩：${stillGivenAway}`);
      continue;
    }
    const servable = checkQuestionServable({
      questionType: question.questionType,
      question: entry.after,
      options: question.options,
      correctAnswer: question.correctAnswer,
    });
    if (!servable.ok) {
      failures.push(`${entry.questionId}：修改後仍不可作答：${servable.reason ?? "未知原因"}`);
      continue;
    }
    try {
      // 乾跑亦確認「套用後的完整題目」符合 schema（答案、選項等欄位不變但需合法）
      inputFrom(question, entry.after);
    } catch (error) {
      failures.push(
        `${entry.questionId}：套用後的題目輸入不合法（${error instanceof Error ? error.message : String(error)}）`,
      );
      continue;
    }

    pending.push({ entry, question });
    console.log(`✓ ${entry.questionId}（${question.status} → draft）`);
    console.log(`  前：${entry.before}`);
    console.log(`  後：${entry.after}`);
    if (entry.note) console.log(`  註：${entry.note}`);
    console.log("");
  }

  if (failures.length > 0) {
    console.error("以下項目未通過核對，整批不會寫入：");
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    return 1;
  }

  if (!apply) {
    console.log(`（模擬模式）將修改 ${pending.length} 題，資料庫沒有任何變更。`);
    console.log("確認無誤後加上 `--actor <電郵> --apply` 才會寫入。");
    return 0;
  }

  // 單一交易套用全部修改：任何一項在交易內核對失敗（題幹／版本／狀態已改變）即整批回滾，
  // 不會留下「只改了一半」的題庫（Sprint 20）。
  let result;
  try {
    result = applyQuestionStemBatch({
      changes: pending.map(({ entry, question }) => ({
        questionId: entry.questionId,
        expectedQuestion: question.question,
        expectedRevision: question.revision,
        expectedStatus: question.status,
        nextQuestion: entry.after,
      })),
      actor: { email: actor, role: actorRole },
      source: "scripts/fix-chronology-stem-years.ts",
      reason: manifest.reason ?? manifest.notice ?? null,
      validate: (current, nextStem) => {
        const stillGivenAway = chronologyGivenAwayReason(nextStem);
        if (stillGivenAway !== null) return `修改後仍被判定為時序答案外洩：${stillGivenAway}`;
        const servable = checkQuestionServable({
          questionType: current.questionType,
          question: nextStem,
          options: current.options,
          correctAnswer: current.correctAnswer,
        });
        return servable.ok ? null : `修改後仍不可作答：${servable.reason ?? "未知原因"}`;
      },
    });
  } catch (error) {
    console.error(
      `整批沒有寫入任何變更：${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }

  for (const item of result.updated) {
    console.log(
      `已更新 ${item.questionId}：狀態 ${item.status}、版本 ${item.beforeRevision} → ${item.afterRevision}`,
    );
  }
  console.log("");
  console.log(`完成：${result.updated.length} 題已改為草稿，需教師重新覆核後才可再發布。`);
  console.log(
    `變更紀錄已寫入 question_mutations（操作者 ${actor}、機制身分 ${actorRole}）；沒有建立任何覆核紀錄。`,
  );
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error("執行失敗：", error);
    process.exitCode = 1;
  },
);
