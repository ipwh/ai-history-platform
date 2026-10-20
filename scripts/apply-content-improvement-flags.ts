/**
 * 批次標記「解釋待重寫」「技能待確認」（預設模擬，必須加 `--apply` 才寫入）。
 *
 * 為甚麼要獨立於覆核：`question_reviews` 是「誰核准過這一版題目」的證據，會決定題目可否
 * 發布。把「解釋待重寫」寫成覆核決定會令題目立即下架，並污染覆核歷史。本腳本改為寫入
 * `question_content_flags`（只可新增的事件表），記錄誰、何時、甚麼理由。
 *
 * 用法：
 *   # 看目前標記狀況
 *   npx tsx scripts/apply-content-improvement-flags.ts --list
 *
 *   # 模擬：把首批 50 條佔位／只列答案的題目標為「解釋待重寫」（不寫入）
 *   npx tsx scripts/apply-content-improvement-flags.ts \
 *     --flag explanation_needs_rewrite --limit 50 \
 *     --reason "2026-10 內容稽核：解釋為佔位文字"
 *
 *   # 真正寫入（必須提供 --actor，令紀錄有負責人）
 *   npx tsx scripts/apply-content-improvement-flags.ts \
 *     --flag explanation_needs_rewrite --limit 50 \
 *     --reason "2026-10 內容稽核：解釋為佔位文字" \
 *     --actor teacher@pochiu.edu.hk --apply
 *
 *   # 教師重寫完成後解除標記
 *   npx tsx scripts/apply-content-improvement-flags.ts \
 *     --flag explanation_needs_rewrite --clear \
 *     --ids qb-JTH2ndEdFBQ01001 --reason "已按課本補寫解釋" \
 *     --actor teacher@pochiu.edu.hk --apply
 *
 * 安全設計：
 *   - 預設模擬，且模擬模式以**唯讀**方式開啟資料庫（不會執行 migration、不會寫入任何東西）；
 *   - 正式環境（Cloud Run / NODE_ENV=production）拒絕執行；
 *   - `--apply` 必須提供 `--actor`，紀錄不可無名；
 *   - atomic：任何一條失敗，整批都不寫入；
 *   - 不改題目、不改答案、不改技能、不改發布狀態。
 */
import fs from "node:fs";
import path from "node:path";

import { isProductionRuntime } from "../src/server/config";
import { enableReadOnlyDatabaseMode } from "../src/server/db/connection";
import { warnIfNpmSwallowedApply } from "./lifecycle-hints";
import { countLatestFlagsByFlag } from "../src/server/repositories/content-flags";
import {
  applyContentFlags,
  buildContentWorklist,
  flagRequestsForWorklist,
  isContentFlag,
  listCurrentFlags,
  type ContentFlagRequest,
} from "../src/server/services/content-improvement";
import {
  CONTENT_FLAGS,
  CONTENT_FLAG_LABELS,
  type ContentFlag,
} from "../src/server/quality/content-flags";

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

const DEFAULT_LIMIT = 50;

function usage(): never {
  console.error(
    [
      "用法：npx tsx scripts/apply-content-improvement-flags.ts --flag <標記> --reason <理由> [選項]",
      "",
      `標記：${CONTENT_FLAGS.map((flag) => `${flag}（${CONTENT_FLAG_LABELS[flag]}）`).join("／")}`,
      "",
      "選項：",
      "  --reason <文字>     必填。寫入紀錄，供日後追溯為何標記／解除。",
      "  --limit <N>         只處理前 N 題（預設 50）。與 --ids 一起使用時忽略。",
      "  --all               處理全部符合條件的題目（不設上限）。",
      "  --ids a,b,c         只處理指定題目 ID。",
      "  --clear             解除標記（預設為標記）。",
      "  --force             容許標記已不需要處理的題目（預設會跳過並回報）。",
      "  --actor <電郵>      必填於 --apply。標記者身分，只可來自教師或管理員。",
      "  --database <路徑>   指定資料庫（預設 data/app.db 或 APP_DATABASE_PATH）。",
      "  --apply             真正寫入（預設只模擬）。",
      "  --list              只列出目前的標記狀況，不處理任何題目。",
    ].join("\n"),
  );
  process.exit(1);
}

function main(): void {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  warnIfNpmSwallowedApply(apply);

  const databasePath = path.resolve(
    readArg("--database") ?? process.env.APP_DATABASE_PATH ?? path.join("data", "app.db"),
  );
  if (!fs.existsSync(databasePath)) {
    console.error(`找不到資料庫：${databasePath}`);
    process.exit(1);
  }
  // 所有 getDb() 呼叫（包括 --list 及模擬模式）都會指向同一個資料庫
  process.env.APP_DATABASE_PATH = databasePath;

  if (isProductionRuntime()) {
    console.error(
      "正式環境（Cloud Run / NODE_ENV=production）不可執行此指令：請在離線快照上標記後再匯入。",
    );
    process.exit(1);
  }

  // 模擬模式以唯讀方式開啟：保證不會執行 migration，也不可能寫入。
  if (!apply) enableReadOnlyDatabaseMode();

  try {
    if (argv.includes("--list")) {
      const counts = countLatestFlagsByFlag();
      console.log(`資料庫：${databasePath}`);
      console.log("目前 open 標記：");
      for (const flag of CONTENT_FLAGS) {
        console.log(`  ${CONTENT_FLAG_LABELS[flag]}（${flag}）：${counts[flag]}`);
      }
      const open = listCurrentFlags().filter((view) => view.state === "open");
      console.log(`合計 ${open.length} 條 open 標記`);
      if (open.length > 0) {
        console.log("");
        console.log("最近 10 條：");
        for (const view of open
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          .slice(0, 10)) {
          console.log(
            `  ${view.questionId}｜${CONTENT_FLAG_LABELS[view.flag]}｜${view.actorEmail}｜${view.createdAt}｜${view.contentChangedSinceFlag ? "內容已改，需重新判斷" : "現行版本"}`,
          );
        }
      }
      return;
    }

    const flagArg = readArg("--flag");
    if (!flagArg || !isContentFlag(flagArg)) usage();
    const flag: ContentFlag = flagArg;
    const reason = readArg("--reason")?.trim() ?? "";
    if (reason.length === 0) {
      console.error("必須提供 --reason（紀錄理由，供日後追溯）。");
      process.exit(1);
    }
    const action = argv.includes("--clear") ? ("clear" as const) : ("mark" as const);

    let requests: ContentFlagRequest[];
    const idsArg = readArg("--ids");
    if (idsArg) {
      const ids = idsArg
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
      if (ids.length === 0) {
        console.error("--ids 沒有任何有效的題目 ID。");
        process.exit(1);
      }
      requests = ids.map((questionId) => ({ questionId, flag, action, reason }));
    } else if (action === "clear") {
      // 解除標記必須明確指定題目，避免一次把全部標記清空
      console.error("--clear 必須配合 --ids 使用（避免一次解除全部標記）。");
      process.exit(1);
    } else {
      const worklist = buildContentWorklist(databasePath);
      const limit = argv.includes("--all")
        ? undefined
        : Number.parseInt(readArg("--limit") ?? String(DEFAULT_LIMIT), 10);
      if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
        console.error("--limit 必須是正整數。");
        process.exit(1);
      }
      requests = flagRequestsForWorklist(worklist.items, { flag, reason, limit });
    }

    if (requests.length === 0) {
      console.log("沒有符合條件的題目，未做任何變更。");
      return;
    }

    const actorArg = readArg("--actor")?.trim() ?? "";
    if (apply && actorArg.length === 0) {
      console.error(
        "--apply 必須提供 --actor <電郵>：標記紀錄不可無名，否則日後無法追查是誰下的決定。",
      );
      process.exit(1);
    }

    console.log(`資料庫：${databasePath}`);
    console.log(`標記：${CONTENT_FLAG_LABELS[flag]}（${flag}）`);
    console.log(`動作：${action === "mark" ? "標記" : "解除標記"}`);
    console.log(`模式：${apply ? "套用（--apply）" : "模擬（預設，唯讀，不寫入）"}`);
    console.log(`條目：${requests.length}`);
    console.log("");

    const report = applyContentFlags(requests, {
      dryRun: !apply,
      actor: {
        email: actorArg.length > 0 ? actorArg : "（未提供 --actor）",
        role: actorArg.length > 0 ? "teacher-or-admin-cli" : "cli-without-actor",
      },
      atomic: true,
      force: argv.includes("--force"),
    });

    const shown = report.results.slice(0, 50);
    for (const result of shown) {
      const label =
        result.outcome === "applied"
          ? "✓ 已寫入"
          : result.outcome === "planned"
            ? "• 將寫入"
            : result.outcome === "already-applied"
              ? "= 已存在（略過）"
              : result.outcome === "skipped"
                ? "- 略過"
                : "✗ 失敗";
      console.log(`${label}｜${result.questionId}｜${result.detail}`);
    }
    if (report.results.length > shown.length) {
      console.log(`（其餘 ${report.results.length - shown.length} 條未列出）`);
    }

    console.log("");
    console.log(
      `結果：已寫入 ${report.applied}｜將寫入 ${report.planned}｜已存在 ${report.alreadyApplied}｜略過 ${report.skipped}｜失敗 ${report.failed}`,
    );
    if (report.failed > 0) {
      console.log(
        apply
          ? "\n有任何一條失敗，因此**整批都沒有寫入**（atomic）。請修正失敗原因後重新執行。"
          : "\n失敗條目不會改動資料庫；請先處理失敗原因再執行 --apply。",
      );
      process.exitCode = 1;
    }
    if (!apply && report.planned > 0) {
      console.log(
        "\n這是模擬結果，資料庫沒有任何變更。確認無誤後加上 `--actor <電郵> --apply` 才會寫入。",
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!apply) {
      console.error(
        `模擬模式以唯讀方式開啟資料庫時失敗：${message}\n` +
          "若這是因為缺少 question_content_flags 表，請先執行 `npm run db:migrate`（或直接加 --apply，程式會自動套用 migration）。",
      );
    } else {
      console.error(`執行失敗：${message}`);
    }
    process.exitCode = 1;
  }
}

main();
