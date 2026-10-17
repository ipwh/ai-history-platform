/**
 * 套用「題目修正動作清單」（教師決定隊列／用詞對齊），決定性、可重複執行。
 *
 * 用法：
 *   npm run apply:question-queue                                  # 模擬（預設，不寫入）
 *   npm run apply:question-queue -- --apply                        # 寫入（全部條目通過驗證才寫入）
 *   npm run apply:question-queue -- --manifest <路徑> --apply       # 指定清單
 *   npm run apply:question-queue -- --apply --require-open          # 只處理已開放給學生的證據段落
 *   npm run apply:question-queue -- --apply --continue-on-error     # 容許部分套用（不建議）
 *
 * 預設清單：docs/teacher-review/question-queue-actions-2026-10.json（36 條：31 條改寫、5 條刪除）
 * 另有：docs/material-remapping/2026-10-wording-alignment.json（23 條用詞對齊）
 *       docs/teacher-review/school-paper-evidence-links-2026-10.json（10 條課題1 校內試題教材依據連結）
 *
 * **atomic（預設）**：刪除條目不需要教材證據，若在「尚未匯入新教材」的資料庫上執行，
 * 改寫會失敗但刪除仍會生效，令題庫半完成。因此 `--apply` 會先驗證全部條目，任何一條失敗
 * 即完全不寫入，讓執行者先補齊前置條件。
 *
 * 安全設計：正式環境（Cloud Run / NODE_ENV=production）拒絕執行；預設模擬；每條先驗證
 * 題目內容指紋與證據逐字相符；不建立任何人工覆核或擁有者授權紀錄。
 */
import fs from "node:fs";
import path from "node:path";

import { isProductionRuntime } from "../src/server/config";
import { getDb } from "../src/server/db/connection";
import { warnIfNpmSwallowedApply } from "./lifecycle-hints";
import {
  applyQuestionQueueActions,
  queueActionManifestSchema,
} from "../src/server/materials/question-queue-actions";

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

const DEFAULT_MANIFEST = path.join(
  "docs",
  "teacher-review",
  "question-queue-actions-2026-10.json",
);

function main(): void {
  const apply = process.argv.includes("--apply");
  warnIfNpmSwallowedApply(apply);
  const requireOpen = process.argv.includes("--require-open");
  const manifestPath = readArg("--manifest") ?? DEFAULT_MANIFEST;
  const resolved = path.isAbsolute(manifestPath)
    ? manifestPath
    : path.join(process.cwd(), manifestPath);

  if (isProductionRuntime()) {
    console.error("正式環境（Cloud Run / NODE_ENV=production）不可執行此指令，請在離線快照上執行。");
    process.exit(1);
  }
  if (!fs.existsSync(resolved)) {
    console.error(`找不到清單檔案：${resolved}`);
    process.exit(1);
  }

  const manifest = queueActionManifestSchema.parse(
    JSON.parse(fs.readFileSync(resolved, "utf8")) as unknown,
  );

  getDb();
  console.log(`清單檔案：${resolved}`);
  console.log(`標題：${manifest.title}`);
  console.log(`條目：${manifest.entries.length} 條`);
  console.log(`模式：${apply ? "套用（--apply）" : "模擬（預設，不寫入）"}`);
  if (requireOpen) console.log("要求：證據段落所屬文件必須已開放給學生（--require-open）");
  console.log("");

  const report = applyQuestionQueueActions(manifest, {
    dryRun: !apply,
    atomic: !process.argv.includes("--continue-on-error"),
    requireOpenDocuments: requireOpen,
  });

  for (const result of report.results) {
    const label =
      result.outcome === "applied"
        ? "✓ 已套用"
        : result.outcome === "planned"
          ? "• 將套用"
          : result.outcome === "already-applied"
            ? "= 已套用（略過）"
            : "✗ 失敗";
    const action =
      result.action === "delete"
        ? "刪除"
        : result.action === "rewrite"
          ? "改寫"
          : result.action === "link-evidence"
            ? "教材依據"
            : "用詞對齊";
    console.log(`${label}｜${action}｜${result.questionId}｜${result.detail}`);
  }

  console.log("");
  console.log(
    `結果：已套用 ${report.applied}（其中刪除 ${report.deleted}）｜將套用 ${report.planned}｜已套用（略過）${report.alreadyApplied}｜失敗 ${report.failed}`,
  );
  if (report.failed > 0) {
    console.log(
      apply
        ? "\n有任何一條失敗，因此**全部條目都沒有寫入**（atomic）。請先修正失敗原因（例如先執行 `npm run import:materials -- --books` 匯入新教材、`npm run retire:materials` 退掉被取代的文件），再重新執行；如確定要容許部分套用，可加 `--continue-on-error`。"
        : "\n失敗條目不會改動資料庫；請先處理失敗原因再重新執行。",
    );
    process.exitCode = 1;
  }
}

main();
