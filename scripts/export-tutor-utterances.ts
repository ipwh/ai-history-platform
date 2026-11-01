/**
 * 學伴怪句匯出 CLI（唯讀）——每月補強正規化規則用。
 *
 * 用法：
 *   npm run tutor:export-utterances
 *   npm run tutor:export-utterances -- --days 30 --limit 200 --type reject,clarify
 *   npm run tutor:export-utterances -- --database "C:\\temp\\snapshot.db" --format csv > out.csv
 *
 * 只讀取 `tutor_query_events`；**不連接正式資料庫以外的來源**、不改動任何資料。
 * 事件表本身不含學生身分（無 learnerId／電郵／班別），句子已截斷至 120 字，
 * 亦不含任何題目、答案、解釋或教材節錄，因此輸出可以直接貼進教師工作清單。
 *
 * 建議每月流程（另見 README）：
 *   1. `npm run tutor:export-utterances -- --days 30 --limit 200`（人工抽 20 句）；
 *   2. 找出仍然誤判／誤譯的寫法，改 `src/server/services/tutor-query.ts` 的規則；
 *   3. 為每個改動加一條 fixture 測試（tests/fixtures/tutor-colloquial-utterances.ts
 *      或 tests/tutor-query.test.ts）。
 */
import fs from "node:fs";
import path from "node:path";

import { enableReadOnlyDatabaseMode } from "../src/server/db/connection";
import {
  listTutorQueryEvents,
  tutorEventPreview,
} from "../src/server/repositories/tutor-events";
import type { TutorQueryEventType } from "../src/lib/types";

const READ_ONLY_NOTICE =
  "唯讀匯出：只讀取 tutor_query_events，沒有修改任何資料；事件不含學生身分或題目內容。";
const EVENT_TYPES: readonly TutorQueryEventType[] = ["reject", "clarify", "normalize"];
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 500;

function readArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

function parseTypes(raw: string | null): TutorQueryEventType[] | undefined {
  if (raw === null) return undefined;
  const values = raw
    .split(/[,;|\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const types = values.filter((value): value is TutorQueryEventType =>
    (EVENT_TYPES as readonly string[]).includes(value),
  );
  return types.length > 0 ? types : undefined;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function main(): void {
  const repo = process.cwd();
  const argv = process.argv.slice(2);
  const databasePath = path.resolve(
    readArg(argv, "--database") ?? path.join(repo, "data", "app.db"),
  );
  if (!fs.existsSync(databasePath)) {
    throw new Error(`找不到資料庫：${databasePath}`);
  }
  const days = Number.parseInt(readArg(argv, "--days") ?? "30", 10);
  const limitRaw = Number.parseInt(readArg(argv, "--limit") ?? String(DEFAULT_LIMIT), 10);
  const limit = Math.min(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : DEFAULT_LIMIT, MAX_LIMIT);
  const format = (readArg(argv, "--format") ?? "json").toLowerCase();
  const types = parseTypes(readArg(argv, "--type"));

  const since = new Date(
    Date.now() - Math.max(Number.isFinite(days) && days > 0 ? days : 30, 1) * 24 * 60 * 60 * 1000,
  ).toISOString();

  // 必須在匯入任何服務模組**之前**啟用唯讀模式（避免自動 migration）。
  process.env.APP_DATABASE_PATH = databasePath;
  enableReadOnlyDatabaseMode();

  const events = listTutorQueryEvents({ since, limit, eventTypes: types });

  if (format === "csv") {
    const lines = ["createdAt,eventType,rawPreview,normalizedPreview,hadSession"];
    for (const event of events) {
      lines.push(
        [
          event.createdAt,
          event.eventType,
          csvCell(tutorEventPreview(event.rawPreview)),
          csvCell(tutorEventPreview(event.normalizedPreview ?? "")),
          event.hadSession ? "1" : "0",
        ].join(","),
      );
    }
    process.stdout.write(`${lines.join("\n")}\n`);
    return;
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        notice: READ_ONLY_NOTICE,
        generatedAt: new Date().toISOString(),
        scope: {
          database: path.relative(repo, databasePath).replace(/\\/g, "/"),
          since,
          limit,
          eventTypes: types ?? EVENT_TYPES,
        },
        count: events.length,
        // 提示：人工抽樣只看 rawPreview 已足夠；normalizedPreview 用來判斷規則改寫是否正確。
        suggestedSampleSize: Math.min(20, events.length),
        events: events.map((event) => ({
          createdAt: event.createdAt,
          eventType: event.eventType,
          rawPreview: event.rawPreview,
          normalizedPreview: event.normalizedPreview,
          hadSession: event.hadSession,
        })),
      },
      null,
      2,
    )}\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
