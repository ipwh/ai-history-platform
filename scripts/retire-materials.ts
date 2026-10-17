/**
 * 退掉被取代的教材文件（離線快照亦可執行）。
 *
 * 背景：2026-10 版教材改用新檔名（`課題N ….docx`），舊的教師版文件
 * （`HNC*_SN_TE.docx`）不會被同名取代機制處理，必須逐份退掉，否則學生閱讀頁會顯示
 * 重複教材。以往只能在管理介面逐份刪除；本指令讓「快照 + 還原」的離線流程
 * （README 第十節做法 A）也能完成同一步，並沿用完全相同的刪除路徑：
 * `deleteDocumentWithFile` → `repairQuestionsWithMissingBlocks`（題目依據重新定位，
 * 找不到相符段落者標示「未通過教材依據核對」，學生端依 fail-closed 不顯示節錄）。
 *
 * 用法：
 *   npm run retire:materials -- --files "HNC1A2E_T1_SN_TE.docx,HNC2A2E_T6_SN_TE.docx"        # 模擬
 *   npm run retire:materials -- --files "…" --apply                                          # 執行刪除
 *
 * 安全設計：
 *   - 必須以 `--files` **逐個列出檔名**，不做任何模式或關鍵詞比對（避免誤刪）。
 *   - 預設模擬；要 `--apply` 才刪除。正式環境（Cloud Run / NODE_ENV=production）拒絕執行。
 *   - 刪除後會印出每個課題的題目修復結果（重新定位／剔除失效引用／標示未通過核對），
 *     刪除**不會**刪除學生練習記錄、覆核紀錄或授權稽核紀錄。
 */
import { getServerConfig, isProductionRuntime } from "../src/server/config";
import { getDb } from "../src/server/db/connection";
import { retireMaterialsByFileName } from "../src/server/services/material-service";
import { warnIfNpmSwallowedApply } from "./lifecycle-hints";

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

function main(): void {
  const apply = process.argv.includes("--apply");
  warnIfNpmSwallowedApply(apply);
  const raw = readArg("--files");
  const files = (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (files.length === 0) {
    console.error('用法：npm run retire:materials -- --files "檔案A.docx,檔案B.docx" [--apply]');
    process.exit(1);
  }
  if (isProductionRuntime()) {
    console.error("正式環境（Cloud Run / NODE_ENV=production）不可執行此指令，請在離線快照上執行。");
    process.exit(1);
  }

  getDb();
  console.log(`目標資料庫：${getServerConfig().databasePath}`);
  console.log(`模式：${apply ? "執行刪除（--apply）" : "模擬（預設，不刪除）"}`);
  console.log(`檔案：${files.length} 個\n`);

  const outcomes = retireMaterialsByFileName(files, { dryRun: !apply });
  for (const outcome of outcomes) {
    if (outcome.action === "not-found") {
      console.log(`✗ ${outcome.fileName}：資料庫沒有這份文件`);
      continue;
    }
    if (outcome.action === "planned") {
      console.log(`• ${outcome.fileName}：將刪除文件 ${outcome.documentId}（課題 ${outcome.topicId ?? "未指定"}）`);
      continue;
    }
    const repair = outcome.repair ?? { repointed: 0, pruned: 0, withheld: 0 };
    console.log(
      `✓ ${outcome.fileName}：已刪除文件 ${outcome.documentId}（課題 ${outcome.topicId ?? "未指定"}）｜題目：重新定位 ${repair.repointed}、剔除失效引用 ${repair.pruned}、標示未通過核對 ${repair.withheld}`,
    );
  }

  const missing = outcomes.filter((outcome) => outcome.action === "not-found").length;
  if (missing > 0) {
    console.log(`\n有 ${missing} 個檔名在資料庫中找不到；請確認檔名後再執行。`);
    process.exitCode = 1;
  }
}

main();
