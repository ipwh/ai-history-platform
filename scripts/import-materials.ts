/**
 * 由專案 materials 資料夾匯入教材及校內試題。
 *
 * materials 的結構（2026 學年更新）：
 *   課題N 課題名稱/
 *     課題N 課題名稱.docx          ← 書本內容（作為 AI 出題依據）
 *     HNCxY2E_QB_TN_1.MCQ.docx    ← 校內試題（匯入題庫，草稿待教師審核）
 *     …_2.FBQ / _3.TFQ / _4.MUQ / _5.COQ / _6.LAQ
 *
 * 用法：
 *   npm run import:materials                       # 匯入全部課題（書本內容 + 校內試題）
 *   npm run import:materials -- --books            # 只匯入書本內容
 *   npm run import:materials -- --questions        # 只匯入校內試題
 *   npm run import:materials -- --topic topic-5    # 只匯入指定課題
 *   npm run import:materials -- --senior           # 只匯入高中教材（materials/高中/…）
 *   npm run import:materials -- --file 某檔案.docx --topic topic-3
 *   npm run import:materials -- --ocr              # 匯入後執行 OCR（辨識圖片文字）
 */
import fs from "node:fs";
import path from "node:path";

import { getServerConfig } from "../src/server/config";
import { getDb } from "../src/server/db/connection";
import { importMaterial } from "../src/server/materials/import-service";
import { collectMaterialFiles } from "../src/server/materials/material-files";
import { extractQuestionBankText, isQuestionBankFileName, isRetiredQuestionBankFileName } from "../src/server/materials/question-bank";
import { describeOcr } from "../src/server/ocr";
import { seedCurriculum, seedDemoQuestionBank } from "../src/server/seed";
import { runOcr } from "../src/server/services/ocr-service";
import { importQuestionBank } from "../src/server/services/question-bank-import-service";

interface Args {
  files: string[] | null;
  booksOnly: boolean;
  questionsOnly: boolean;
  topicId: string | null;
  seniorOnly: boolean;
  ocr: boolean;
}

function readArgs(argv: string[]): Args {
  const args = argv.slice(2);
  const fileIndex = args.indexOf("--file");
  const topicIndex = args.indexOf("--topic");
  return {
    files: fileIndex >= 0 && args[fileIndex + 1] ? [args[fileIndex + 1]] : null,
    booksOnly: args.includes("--books"),
    questionsOnly: args.includes("--questions"),
    topicId: topicIndex >= 0 && args[topicIndex + 1] ? args[topicIndex + 1] : null,
    seniorOnly: args.includes("--senior"),
    ocr: args.includes("--ocr"),
  };
}

function mimeFor(fileName: string): string {
  return path.extname(fileName).toLowerCase() === ".pdf"
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

interface Target {
  filePath: string;
  topicId: string | null;
}

/** 掃描 materials 內所有支援的檔案（含課題子資料夾） */
function collectTargets(materialsDir: string): Target[] {
  return collectMaterialFiles(materialsDir).map((entry) => ({
    filePath: path.join(materialsDir, entry.relativePath.split("/").join(path.sep)),
    topicId: entry.topicId,
  }));
}

async function docxToText(filePath: string): Promise<string> {
  return extractQuestionBankText(fs.readFileSync(filePath));
}

async function main() {
  const config = getServerConfig();
  const { files, booksOnly, questionsOnly, topicId, seniorOnly, ocr } = readArgs(process.argv);

  getDb();
  const seeded = seedCurriculum();
  console.log(
    `✓ 課程結構：${seeded.topics} 個課題、${seeded.sections} 個分節（${seeded.levels
      .map((level) => `${level.label} ${level.topics} 個`)
      .join("、")}）`,
  );

  let targets: Target[] = files
    ? files.map((fileName) => ({
        filePath: path.isAbsolute(fileName) ? fileName : path.join(config.materialsDir, fileName),
        topicId,
      }))
    : collectTargets(config.materialsDir);
  if (topicId) targets = targets.filter((target) => target.topicId === topicId);
  // 只匯入高中教材（避免重複匯入已存在的初中教材）
  if (seniorOnly) targets = targets.filter((target) => target.topicId?.startsWith("hs-topic-"));

  if (targets.length === 0) {
    console.log(`找不到可匯入的教材，請把檔案放在：${config.materialsDir}`);
    return;
  }

  const importBooks = !questionsOnly;
  const importQuestions = !booksOnly;
  // 平台已移除資料題（DBQ）：不會匯入題庫，亦不可當作課文教材
  const retiredTargets = targets.filter((target) =>
    isRetiredQuestionBankFileName(path.basename(target.filePath)),
  );
  const activeTargets = targets.filter(
    (target) => !isRetiredQuestionBankFileName(path.basename(target.filePath)),
  );
  if (retiredTargets.length > 0) {
    console.log(
      `\n【已停用的試題檔】共 ${retiredTargets.length} 份（資料題／DBQ 已從平台移除，不會匯入）`,
    );
    for (const target of retiredTargets) console.log(`－ ${path.basename(target.filePath)}`);
  }
  const bookTargets = activeTargets.filter((target) => !isQuestionBankFileName(path.basename(target.filePath)));
  const questionTargets = activeTargets.filter((target) => isQuestionBankFileName(path.basename(target.filePath)));

  const importedDocuments: { id: string; fileName: string }[] = [];
  let importedQuestions = 0;
  let skippedQuestions = 0;
  let excludedQuestions = 0;
  let excludedImageQuestions = 0;
  let warnedQuestions = 0;
  let skippedFiles = 0;

  if (importBooks) {
    console.log(`\n【書本內容】共 ${bookTargets.length} 份`);
    for (const target of bookTargets) {
      const fileName = path.basename(target.filePath);
      if (!fs.existsSync(target.filePath)) {
        console.log(`！找不到檔案：${target.filePath}`);
        continue;
      }
      const buffer = fs.readFileSync(target.filePath);
      const outcome = await importMaterial({
        fileName,
        mimeType: mimeFor(fileName),
        sizeBytes: buffer.byteLength,
        buffer,
        topicId: target.topicId,
        kind: "demo",
        sourceNote: "由命令列匯入（課程教材）",
      });
      console.log(
        `✓ ${fileName}：${outcome.document.status}，段落 ${outcome.blocks.length} 段，課題 ${
          outcome.detectedTopic?.title ?? "（教師參考）"
        }`,
      );
      for (const warning of outcome.warnings.slice(0, 3)) console.log(`  ！${warning}`);
      if (outcome.document.status === "ready") {
        importedDocuments.push({ id: outcome.document.id, fileName });
      } else {
        skippedFiles += 1;
      }
    }
  }

  if (importQuestions) {
    console.log(`\n【校內試題】共 ${questionTargets.length} 份`);
    for (const target of questionTargets) {
      const fileName = path.basename(target.filePath);
      if (!target.topicId) {
        console.log(`！${fileName}：無法判斷所屬課題，已略過`);
        skippedFiles += 1;
        continue;
      }
      const text = await docxToText(target.filePath);
      const buffer = fs.readFileSync(target.filePath);

      // 試題檔亦保留為教材文件（kind = question-bank），方便教師查看原卷；
      // 這類文件不會作為 AI 出題依據（見 repositories/materials 的 grounding 查詢）。
      await importMaterial({
        fileName,
        mimeType: mimeFor(fileName),
        sizeBytes: buffer.byteLength,
        buffer,
        topicId: target.topicId,
        kind: "question-bank",
        sourceNote: "校內試題（題庫來源）",
      });

      const result = importQuestionBank({ topicId: target.topicId, fileName, text });
      importedQuestions += result.imported;
      skippedQuestions += result.skipped.length;
      excludedQuestions += result.excluded;
      excludedImageQuestions += result.excludedForImage;
      warnedQuestions += result.withQualityWarnings;
      console.log(
        `✓ ${fileName}（${result.fileType}）：匯入 ${result.imported} 題（草稿）、略過 ${
          result.skipped.length
        } 題${result.excluded > 0 ? `、不考核範圍 ${result.excluded} 題` : ""}${
          result.excludedForImage > 0 ? `、需原檔圖片排除 ${result.excludedForImage} 題` : ""
        }${result.withQualityWarnings > 0 ? `、需教師核對 ${result.withQualityWarnings} 題` : ""}`,
      );
      for (const reason of new Set(result.skipped.map((item) => item.reason))) {
        const count = result.skipped.filter((item) => item.reason === reason).length;
        console.log(`    - ${reason}：${count} 題`);
      }
    }
  }

  if (ocr) {
    const engine = describeOcr();
    if (!engine.enabled) {
      console.log(`！OCR 未啟用：${engine.notice ?? "請設定 OCR_PROVIDER"}`);
    } else {
      console.log(`\n開始 OCR（${engine.providerLabel}）…`);
      for (const document of importedDocuments) {
        const summary = await runOcr(document.id);
        console.log(
          `  ✓ ${document.fileName}：${summary.status}，辨識 ${summary.recognized} 張，略過 ${
            summary.skipped
          } 張（${Math.round(summary.durationMs / 1000)} 秒）`,
        );
      }
    }
  }

  const report = seedDemoQuestionBank();
  console.log(
    `\n✓ 示範題庫核對：${report.verifiedQuestions}/${report.totalQuestions} 題找到教材依據（課題5）`,
  );
  if (importQuestions) {
    console.log(
      `✓ 校內試題：新增／更新 ${importedQuestions} 題（草稿，待教師審核）` +
        `；不考核範圍略過 ${excludedQuestions} 題；需原檔圖片排除 ${excludedImageQuestions} 題；格式未支援 ${skippedQuestions} 題` +
        `${warnedQuestions > 0 ? `；需教師核對 ${warnedQuestions} 題` : ""}`,
    );
  }
  if (skippedFiles > 0) console.log(`！有 ${skippedFiles} 個檔案未能匯入（詳見上方訊息）`);
}

main().catch((error) => {
  console.error("匯入失敗：", error);
  process.exit(1);
});
