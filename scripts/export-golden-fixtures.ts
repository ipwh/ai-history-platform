/**
 * Golden Dataset v2 匯出／檢查 CLI（Sprint 13：真正的唯讀契約）。
 *
 * 模式：
 *   --check        只驗證（不寫檔、不寫資料庫、不執行 migration）。退出碼：
 *                    0 = schema 可用且檢查完成（approved 數目可以是 0）
 *                    2 = INSUFFICIENT_EVIDENCE（資料庫缺失、migration 0022 未套用、
 *                        或 candidate 檔缺失）
 *                    1 = 非預期錯誤
 *   一般匯出        同樣以**唯讀**方式讀取資料庫，只寫出 `--out` 指定的 JSON 檔
 *                    （預設 docs/teacher-review/golden-questions.v2.json）。
 *                    schema 不可用時同樣回 2，不會自動建立或修補資料表。
 *
 * 為什麼要這樣做（Sprint 12 發現的問題）：
 *   本腳本原本經 `golden-approval` 服務呼叫 `getDb()`，而 `getDb()` 會在開啟連線時
 *   自動執行 migration。結果 `--check` 在 Sprint 11 對開發資料庫套用了 0022——
 *   一個「檢查」動作不應該改 schema。現在腳本在**匯入服務之前**啟用唯讀模式，
 *   連線以 `readOnly: true` 開啟，缺表就是缺表，由 CLI 如實回報。
 *
 * 需要 migration 時，使用獨立、明確的命令：`npm run db:migrate -- --database <path>`。
 */
import fs from "node:fs";
import path from "node:path";

import { GOLDEN_CATEGORIES } from "../src/server/quality/golden-dataset";

function readArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_INSUFFICIENT_EVIDENCE = 2;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes("--check");
  const databasePath = readArg(argv, "--database");
  if (databasePath) process.env.APP_DATABASE_PATH = path.resolve(databasePath);
  const outPath = path.resolve(
    readArg(argv, "--out") ?? path.join("docs", "teacher-review", "golden-questions.v2.json"),
  );

  // 唯讀模式必須在匯入任何 repository／service 之前啟用：
  // 那些模組在第一次使用時才建立連線，屆時就會用 readOnly: true。
  const connection = await import("../src/server/db/connection");
  connection.enableReadOnlyDatabaseMode();

  const resolvedDatabase = path.resolve(
    process.env.APP_DATABASE_PATH ?? path.join(process.cwd(), "data", "app.db"),
  );
  if (!fs.existsSync(resolvedDatabase)) {
    console.error(
      `INSUFFICIENT_EVIDENCE：找不到資料庫檔案 ${resolvedDatabase}。` +
        "唯讀模式不會建立新資料庫；請確認 --database 或 APP_DATABASE_PATH。",
    );
    return EXIT_INSUFFICIENT_EVIDENCE;
  }

  let golden: typeof import("../src/server/services/golden-approval");
  try {
    golden = await import("../src/server/services/golden-approval");
  } catch (error) {
    console.error(`無法載入 Golden 服務：${describeError(error)}`);
    return EXIT_ERROR;
  }

  const schema = golden.goldenSchemaStatus();
  if (!schema.available) {
    console.error(
      `INSUFFICIENT_EVIDENCE：Golden 裁決表不可用（${schema.error}）。` +
        "這通常代表 migration 0022 尚未套用；唯讀模式不會自動執行 migration。" +
        "請先以 `npm run db:migrate -- --database <path>` 明確套用。",
    );
    return EXIT_INSUFFICIENT_EVIDENCE;
  }

  let candidates;
  try {
    candidates = golden.loadGoldenCandidates();
  } catch (error) {
    console.error(`INSUFFICIENT_EVIDENCE：${describeError(error)}`);
    return EXIT_INSUFFICIENT_EVIDENCE;
  }

  let result;
  try {
    result = golden.exportGoldenFixtures(candidates);
  } catch (error) {
    console.error(`讀取 Golden 資料失敗：${describeError(error)}`);
    return EXIT_ERROR;
  }

  const coverage = Object.fromEntries(GOLDEN_CATEGORIES.map((category) => [category, 0])) as Record<
    string,
    number
  >;
  for (const fixture of result.fixtures) {
    coverage[fixture.category] = (coverage[fixture.category] ?? 0) + 1;
  }

  console.log(
    JSON.stringify(
      {
        mode: checkOnly ? "check" : "export",
        database: resolvedDatabase,
        schemaAvailable: true,
        candidates: result.candidates.length,
        approvedFixtures: result.fixtures.length,
        invalidated: result.invalidated.length,
        coverage,
        status: result.fixtures.length > 0 ? "APPROVED_FIXTURES_PRESENT" : "INSUFFICIENT_EVIDENCE",
      },
      null,
      2,
    ),
  );
  for (const item of result.invalidated) {
    console.log(`  失效／未匯出：${item.questionId}（${item.decision}）— ${item.reason}`);
  }
  if (result.fixtures.length === 0) {
    console.log("沒有任何教師核准的 fixture：評估證據仍然不足（INSUFFICIENT_EVIDENCE）。");
  }

  if (checkOnly) {
    console.log("--check：沒有寫入資料庫或檔案。");
    return EXIT_OK;
  }

  if (fs.existsSync(outPath) && fs.statSync(outPath).isDirectory()) {
    console.error(`無法寫出 fixture：輸出路徑是目錄（${outPath}）。請指定檔案路徑。`);
    return EXIT_ERROR;
  }

  let existing: Record<string, unknown> = {};
  try {
    existing = fs.existsSync(outPath)
      ? (JSON.parse(fs.readFileSync(outPath, "utf8")) as Record<string, unknown>)
      : {};
  } catch (error) {
    console.error(
      `無法讀取既有 fixture 檔案（${outPath}）：${describeError(error)}。` +
        "唯讀檢查不會修改它；請修正檔案或改用其他 --out。",
    );
    return EXIT_ERROR;
  }

  const dataset = {
    version: 2,
    datasetVersion: (existing.datasetVersion as string) ?? "2026-10-19.1",
    reviewStatus: result.fixtures.length > 0 ? "approved" : "pending-review",
    reviewerRequired: true,
    coverage,
    targetPerCategory: (existing.targetPerCategory as number) ?? 2,
    notes: existing.notes ?? [],
    questions: result.fixtures,
  };

  try {
    if (fs.existsSync(outPath) && fs.statSync(outPath).isDirectory()) {
      console.error(`無法寫出 fixture：輸出路徑是目錄（${outPath}）。請指定檔案路徑。`);
      return EXIT_ERROR;
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  } catch (error) {
    console.error(`無法寫出 fixture 檔案（${outPath}）：${describeError(error)}`);
    return EXIT_ERROR;
  }
  console.log(`已寫入 ${path.relative(process.cwd(), outPath)}`);
  return EXIT_OK;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`未預期錯誤：${describeError(error)}`);
    process.exitCode = EXIT_ERROR;
  });
