/**
 * 初始化本機示範環境：
 *   1. 建立資料庫及資料表。
 *   2. 建立教育局歷史科課程（中一至中三）12 個課題的結構。
 *   3. 匯入 materials 資料夾內的課程教材（可用 --ocr 同時執行圖片文字辨識）。
 *   4. 寫入內建示範題庫，並為各課題生成練習題目。
 *
 * 指令：
 *   npm run setup             # 建立結構、匯入全部教材、生成題目（不執行 OCR）
 *   npm run setup -- --ocr    # 同時執行 OCR（較慢，視乎圖片數量）
 *   npm run setup -- --pilot  # 只匯入試點教材（課題5），加快示範
 */
import path from "node:path";
import fs from "node:fs";

import { getDb } from "../src/server/db/connection";
import { getServerConfig } from "../src/server/config";
import { CURRICULUM_TOPICS } from "../src/server/seed/curriculum";
import { deleteDocumentsByKind } from "../src/server/repositories/materials";
import { importMaterial } from "../src/server/materials/import-service";
import { describeLlm } from "../src/server/llm";
import { describeOcr } from "../src/server/ocr";
import { countQuestions } from "../src/server/repositories/questions";
import { listTopics } from "../src/server/repositories/topics";
import { runOcr } from "../src/server/services/ocr-service";
import { generateQuestionBank } from "../src/server/services/question-bank";
import { seedCurriculum, seedDemoQuestionBank } from "../src/server/seed";

const PILOT_FILE = "HNC2A2E_T5_SN_TE.docx";

async function main() {
  const config = getServerConfig();
  const withOcr = process.argv.includes("--ocr");
  const pilotOnly = process.argv.includes("--pilot");

  console.log("【歷史科自學網站】初始化示範環境");
  console.log(`資料庫位置：${config.databasePath}`);
  console.log(`教材來源：${config.materialsDir}`);

  getDb();
  console.log("✓ 資料庫及資料表已就緒");

  // 1. 建立課程結構（先建立分節，教材段落才能自動對應）
  const seeded = seedCurriculum();
  console.log(
    `✓ 課程結構：${seeded.topics} 個課題、${seeded.sections} 個分節（${seeded.levels
      .map((level) => `${level.label} ${level.topics} 個`)
      .join("、")}）`,
  );

  // 2. 匯入教材（重新匯入示範教材，避免重複執行時產生重複段落）
  deleteDocumentsByKind("demo");

  const targets = pilotOnly
    ? [{ fileName: PILOT_FILE, topicId: "topic-5" }]
    : CURRICULUM_TOPICS.flatMap((topic) =>
        topic.materialFile ? [{ fileName: topic.materialFile, topicId: topic.id }] : [],
      );

  const importedDocuments: { id: string; fileName: string }[] = [];

  for (const target of targets) {
    const filePath = path.join(config.materialsDir, target.fileName);
    if (!fs.existsSync(filePath)) {
      console.log(`！找不到 ${target.fileName}，略過。`);
      continue;
    }
    const buffer = fs.readFileSync(filePath);
    const outcome = await importMaterial({
      fileName: target.fileName,
      mimeType: target.fileName.endsWith(".pdf")
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: buffer.byteLength,
      buffer,
      topicId: target.topicId,
      kind: "demo",
      sourceNote: "專案內附的課程教材",
    });
    console.log(
      `✓ 已匯入 ${outcome.document.fileName}：${outcome.blocks.length} 段，狀態 ${outcome.document.status}${
        outcome.detectedTopic ? `，課題：${outcome.detectedTopic.title}` : ""
      }`,
    );
    if (outcome.document.errorMessage) console.log(`  ！${outcome.document.errorMessage}`);
    if (outcome.document.limitationNote) console.log(`  ！${outcome.document.limitationNote}`);
    if (outcome.document.status === "ready") {
      importedDocuments.push({ id: outcome.document.id, fileName: outcome.document.fileName });
    }
  }

  // 3. OCR（可選）
  if (withOcr) {
    const engine = describeOcr();
    if (!engine.enabled) {
      console.log(`！OCR 未啟用：${engine.notice ?? "請設定 OCR_PROVIDER"}`);
    } else {
      console.log(`\n開始 OCR（${engine.providerLabel}）… 這可能需要數分鐘。`);
      for (const document of importedDocuments) {
        const summary = await runOcr(document.id);
        console.log(
          `  ✓ ${document.fileName}：${summary.status}，辨識 ${summary.recognized} 張，略過 ${summary.skipped} 張（${Math.round(
            summary.durationMs / 1000,
          )} 秒）`,
        );
      }
    }
  } else {
    console.log(
      "\n提示：如需辨識教材圖片內的文字，可執行 npm run setup -- --ocr，或在管理介面按「執行 OCR」。",
    );
  }

  // 4. 示範題庫（課題5，教師撰寫並自動核對教材依據）
  const report = seedDemoQuestionBank();
  console.log(`✓ 教材段落：${report.materialBlockCount} 段（課題5）`);
  console.log(
    `✓ 示範題庫：${report.totalQuestions} 題，已核對教材依據 ${report.verifiedQuestions} 題`,
  );
  if (report.unverifiedQuestions.length > 0) {
    console.log("！以下示範題未能自動核對教材依據（已降為草稿待教師檢查）：");
    for (const item of report.unverifiedQuestions) {
      console.log(`  - ${item.id}（關鍵字：${item.anchor}）`);
    }
  }

  // 5. 為各課題生成練習題目（本地示範生成或設定的 LLM provider）
  const skipQuestions = process.argv.includes("--no-questions");
  if (skipQuestions) {
    console.log("\n（略過題目生成，可執行 npm run generate:questions 補充題目）");
  } else {
    console.log("\n開始為各課題生成練習題目…");
    const bank = await generateQuestionBank({
      perSection: 5,
      onTopic: (message) => console.log(`  ${message}`),
    });
    const byDifficulty = `基礎 ${bank.createdByDifficulty.basic}、進階 ${bank.createdByDifficulty.advanced}、挑戰 ${bank.createdByDifficulty.challenge}`;
    console.log(
      bank.autoPublish
        ? `✓ 共新增 ${bank.created} 題（${byDifficulty}），其中 ${bank.published} 題已自動發布（示範模式）`
        : `✓ 共新增 ${bank.created} 題（${byDifficulty}）（草稿狀態，待教師發布）`,
    );
    if (bank.insufficientSections.length > 0) {
      console.log(
        `！${bank.insufficientSections.length} 個分節未能產生合乎要求的題目（教材內容不足或未通過教材依據核對），可補充教材或由教師手動建立。`,
      );
    }
  }

  // 6. 統計
  const llm = describeLlm();
  console.log(`\nLLM provider：${llm.providerLabel}`);
  const topics = listTopics();
  let totalQuestions = 0;
  for (const topic of topics) {
    const count = countQuestions({ topicId: topic.id });
    totalQuestions += count;
    if (count > 0) console.log(`  ${topic.title}：${count} 題`);
  }
  console.log(`  合計：${totalQuestions} 題`);

  console.log(
    "\n完成。執行 npm run dev 後開啟 http://localhost:3000 即可使用；\
如某分節題目不足，學生練習時會由本地示範生成即時補充，亦可執行 npm run generate:questions。",
  );
}

main().catch((error) => {
  console.error("初始化失敗：", error);
  process.exit(1);
});

