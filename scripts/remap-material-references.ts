/**
 * 套用「教材依據重新連結清單」（**決定性、可重複執行**）。
 *
 * 用途：正式環境或本機資料庫要重現 2026-10 教材更新時的 30 條題目重新連結，
 * 不必依賴一次性腳本。清單在 `docs/material-remapping/`（版本控制內），
 * 每條都記錄題目 ID、目標課題／分節、目標段落、逐字節錄、內容指紋及核對理由。
 *
 * 用法：
 *   npm run remap:references                                  # 模擬（預設，不寫入）
 *   npm run remap:references -- --apply                        # 寫入
 *   npm run remap:references -- --apply --require-open          # 只套用目標文件已開放給學生的條目
 *   npm run remap:references -- --manifest docs/material-remapping/其他清單.json
 *
 * 安全設計：
 *   - 預設模擬；要 `--apply` 才寫入（與 `publish:drafts`、`open:materials` 一致）。
 *   - 正式環境（Cloud Run / NODE_ENV=production）拒絕執行：正式環境的更新一律以
 *     快照 + 還原方式進行（見 README 第十節）。
 *   - 每條都先驗證「節錄逐字出現在目標段落」及「題目內容指紋與清單一致」，
 *     不符合者不套用並列出原因；不會因為文字相似就建立依據。
 *   - 已套用的條目會回報「已套用（略過）」，重複執行不會令版本號無謂遞增。
 *   - 只會改寫 sourceExcerpt／sourceLocation／sourceBlockIds／sourceVerified，
 *     不會改題目內容，亦不會建立任何人工覆核或擁有者授權紀錄。
 */
import fs from "node:fs";
import path from "node:path";

import { isProductionRuntime } from "../src/server/config";
import { getDb } from "../src/server/db/connection";
import { warnIfNpmSwallowedApply } from "./lifecycle-hints";
import {
  applyRemappingManifest,
  manifestDigest,
  remappingManifestSchema,
} from "../src/server/materials/reference-remapping";

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

const DEFAULT_MANIFEST = path.join("docs", "material-remapping", "2026-10-material-refresh.json");

function main(): void {
  const apply = process.argv.includes("--apply");
  warnIfNpmSwallowedApply(apply);
  const requireOpen = process.argv.includes("--require-open");
  const manifestPath = readArg("--manifest") ?? DEFAULT_MANIFEST;
  const projectRoot = process.cwd();
  const resolved = path.isAbsolute(manifestPath)
    ? manifestPath
    : path.join(projectRoot, manifestPath);

  // 正式環境的資料更新一律以「快照 + 還原」方式進行（見 README 第十節做法 A），
  // 不可在執行中的服務內直接改寫資料庫。
  if (isProductionRuntime()) {
    console.error("正式環境（Cloud Run / NODE_ENV=production）不可執行此指令，請在離線快照上執行。");
    process.exit(1);
  }

  if (!fs.existsSync(resolved)) {
    console.error(`找不到清單檔案：${resolved}`);
    process.exit(1);
  }
  const manifest = remappingManifestSchema.parse(
    JSON.parse(fs.readFileSync(resolved, "utf8")) as unknown,
  );

  getDb();
  console.log(`清單檔案：${resolved}`);
  console.log(`標題：${manifest.title}`);
  console.log(`條目：${manifest.entries.length} 條｜內容摘要：${manifestDigest(manifest).slice(0, 16)}`);
  console.log(`模式：${apply ? "套用（--apply）" : "模擬（預設，不寫入）"}`);
  if (requireOpen) console.log("要求：目標段落所屬文件必須已開放給學生（--require-open）");
  console.log("");

  const report = applyRemappingManifest(manifest, {
    dryRun: !apply,
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
    console.log(`${label}｜${result.questionId}｜${result.detail}`);
  }

  console.log("");
  console.log(
    `結果：已套用 ${report.applied}｜將套用 ${report.planned}｜已套用（略過）${report.alreadyApplied}｜失敗 ${report.failed}`,
  );

  if (report.failed > 0) {
    console.log("\n失敗條目不會改動資料庫；請先處理失敗原因再重新執行。");
    process.exitCode = 1;
  }
}

main();
