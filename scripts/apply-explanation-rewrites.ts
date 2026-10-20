/**
 * 套用「解釋補寫」清單（預設模擬，必須 `--apply` 才寫入）。
 *
 * 只改 `explanation`：不會改動 `correctAnswer`、`acceptedAnswers`、`options`、題幹或空格；
 * 保留題目的發布狀態與「待教師確認」標記；`revision` 會 +1（內容真的變了），
 * 因此舊的人工覆核紀錄會如實變成「已失效」，不會被偽造成仍然有效。
 *
 * 為甚麼可以不建 `question_reviews`：覆核紀錄代表「有人確認過這一版題目」。由程式補寫解釋
 * 不是教師覆核，所以改寫紀錄寫入 `question_content_flags`（`explanation_rewritten`），
 * 並同時解除該題原本的 `explanation_needs_rewrite` 標記。
 *
 * 用法：
 *   npx tsx scripts/apply-explanation-rewrites.ts --manifest <清單.json>            # 模擬
 *   npx tsx scripts/apply-explanation-rewrites.ts --manifest <清單.json> --apply \
 *     --actor ai-copilot --actor-role automation
 *
 * 安全設計：
 *   - 預設模擬，而且模擬模式以**唯讀**方式開啟資料庫（不 migration、不寫入）；
 *   - 正式環境（Cloud Run / NODE_ENV=production）拒絕執行；
 *   - `--apply` 必須提供 `--actor`，紀錄不可無名；
 *   - atomic：任何一條失敗，整批都不寫入；
 *   - 每條寫入前會核對「現有解釋」與清單記錄一致，題目已被他人修改即跳過。
 */
import fs from "node:fs";
import path from "node:path";

import { isProductionRuntime } from "../src/server/config";
import { enableReadOnlyDatabaseMode } from "../src/server/db/connection";
import { warnIfNpmSwallowedApply } from "./lifecycle-hints";
import {
  applyExplanationRewrites,
  type ExplanationRewriteEntry,
} from "../src/server/services/explanation-rewrite";

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

interface ManifestFile {
  title: string;
  notice?: string;
  entries: ExplanationRewriteEntry[];
}

function loadManifest(resolved: string): ManifestFile {
  const raw = JSON.parse(fs.readFileSync(resolved, "utf8")) as unknown;
  if (typeof raw !== "object" || raw === null) throw new Error("清單格式不正確");
  const manifest = raw as ManifestFile;
  if (typeof manifest.title !== "string" || manifest.title.trim().length === 0) {
    throw new Error("清單缺少 title");
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    throw new Error("清單沒有 entries");
  }
  for (const entry of manifest.entries) {
    if (
      typeof entry.questionId !== "string" ||
      typeof entry.expectedExplanation !== "string" ||
      typeof entry.newExplanation !== "string"
    ) {
      throw new Error(`條目格式不正確：${JSON.stringify(entry).slice(0, 120)}`);
    }
  }
  return manifest;
}

function main(): void {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  warnIfNpmSwallowedApply(apply);

  const manifestArg = readArg("--manifest");
  if (!manifestArg) {
    console.error("必須提供 --manifest <清單.json>");
    process.exit(1);
  }
  const resolved = path.isAbsolute(manifestArg)
    ? manifestArg
    : path.join(process.cwd(), manifestArg);
  if (!fs.existsSync(resolved)) {
    console.error(`找不到清單檔案：${resolved}`);
    process.exit(1);
  }

  const databasePath = path.resolve(
    readArg("--database") ?? process.env.APP_DATABASE_PATH ?? path.join("data", "app.db"),
  );
  if (!fs.existsSync(databasePath)) {
    console.error(`找不到資料庫：${databasePath}`);
    process.exit(1);
  }
  process.env.APP_DATABASE_PATH = databasePath;

  if (isProductionRuntime()) {
    console.error(
      "正式環境（Cloud Run / NODE_ENV=production）不可執行此指令：請在離線快照上套用後再匯入。",
    );
    process.exit(1);
  }
  if (!apply) enableReadOnlyDatabaseMode();

  const actorEmail = readArg("--actor")?.trim() ?? "";
  if (apply && actorEmail.length === 0) {
    console.error("--apply 必須提供 --actor（例如 ai-copilot-2026-10-20）：紀錄不可無名。");
    process.exit(1);
  }

  const manifest = loadManifest(resolved);
  console.log(`清單：${path.relative(process.cwd(), resolved)}`);
  console.log(`標題：${manifest.title}`);
  console.log(`條目：${manifest.entries.length}`);
  console.log(`資料庫：${databasePath}`);
  console.log(`模式：${apply ? "套用（--apply）" : "模擬（預設，唯讀，不寫入）"}`);
  console.log("");

  try {
    const report = applyExplanationRewrites(manifest.entries, {
      dryRun: !apply,
      batchTitle: manifest.title,
      actorEmail: actorEmail.length > 0 ? actorEmail : "（未提供 --actor）",
      actorRole: readArg("--actor-role") ?? "automation",
      atomic: true,
    });

    for (const result of report.results) {
      const label =
        result.outcome === "applied"
          ? "✓ 已寫入"
          : result.outcome === "planned"
            ? "• 將寫入"
            : result.outcome === "already-applied"
              ? "= 已是最新"
              : result.outcome === "skipped"
                ? "- 略過"
                : "✗ 失敗";
      console.log(`${label}｜${result.questionId}｜${result.detail}`);
      if (result.outcome === "failed" || result.outcome === "skipped") {
        if (result.before !== undefined) console.log(`    現有：${result.before}`);
      }
    }

    console.log("");
    console.log(
      `結果：已寫入 ${report.applied}｜將寫入 ${report.planned}｜已是最新 ${report.alreadyApplied}｜略過 ${report.skipped}｜失敗 ${report.failed}`,
    );
    if (report.failed > 0) {
      console.log(
        apply
          ? "\n有任何一條失敗，因此**整批都沒有寫入**（atomic）。請修正後重新執行。"
          : "\n失敗條目不會改動資料庫；請先處理失敗原因再執行 --apply。",
      );
      process.exitCode = 1;
    }
    if (!apply && report.planned > 0) {
      console.log(
        "\n這是模擬結果，資料庫沒有任何變更。確認無誤後加上 `--actor <名稱> --apply` 才會寫入。",
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      apply
        ? `執行失敗：${message}`
        : `模擬模式以唯讀方式開啟資料庫時失敗：${message}\n若這是因為缺少 question_content_flags 表，請先執行 \`npm run db:migrate -- --database <path>\`。`,
    );
    process.exitCode = 1;
  }
}

main();
