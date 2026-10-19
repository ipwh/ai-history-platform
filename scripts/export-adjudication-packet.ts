/**
 * 產生 97 題裁決包（CSV + 可列印 HTML）。
 *
 * 唯讀：只讀取既有的裁決工作清單 JSON，不開啟資料庫、不寫入資料庫、不改變題目狀態。
 *
 *   npx tsx scripts/export-adjudication-packet.ts \
 *     --in docs/quality/adjudication-worklist-2026-10-19.json \
 *     --out docs/teacher-review/adjudication-packet-2026-10-19
 */
import fs from "node:fs";
import path from "node:path";

import { buildAdjudicationPacket, type WorklistReport } from "../src/server/quality/adjudication-packet";

function readArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

function main(): void {
  const argv = process.argv.slice(2);
  const repo = process.cwd();
  const inputPath = path.resolve(
    repo,
    readArg(argv, "--in") ?? "docs/quality/adjudication-worklist-2026-10-19.json",
  );
  const outBase = path.resolve(
    repo,
    readArg(argv, "--out") ?? "docs/teacher-review/adjudication-packet-2026-10-19",
  );

  if (!fs.existsSync(inputPath)) {
    throw new Error(
      `找不到裁決工作清單：${inputPath}。請先執行 npm run audit:adjudication-worklist（唯讀）。`,
    );
  }

  const report = JSON.parse(fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, "")) as WorklistReport;
  const packet = buildAdjudicationPacket(report);

  fs.mkdirSync(path.dirname(`${outBase}.csv`), { recursive: true });
  // Excel 需要 UTF-8 BOM 才會正確顯示中文，因此 CSV 刻意寫入 BOM（JSON／MD 不會）。
  fs.writeFileSync(`${outBase}.csv`, `\uFEFF${packet.csv}\r\n`, "utf8");
  fs.writeFileSync(`${outBase}.html`, packet.html, "utf8");

  console.log(`題目數：${packet.stats.rows}`);
  console.log(`證據類別分佈：${JSON.stringify(packet.stats.byCategory)}`);
  console.log(`已有覆核紀錄（任何來源）：${packet.stats.withReviewRecords}`);
  console.log(`原卷可核對：${packet.stats.withVerifiableOriginal}`);
  console.log(`必須維持隔離：${packet.stats.mustStayQuarantined}`);
  console.log(`已寫入：${path.relative(repo, `${outBase}.csv`)}`);
  console.log(`已寫入：${path.relative(repo, `${outBase}.html`)}`);
  console.log("（本指令不包含任何裁決；所有題目維持不可派發。）");
}

main();
