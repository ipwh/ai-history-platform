/**
 * 選擇題表面線索的唯讀審核（Sprint 23）。
 *
 * 用法：
 *   npx tsx scripts/audit-option-bias.ts [--database <path>] [--json]
 *
 * 只以 `readOnly: true` 開啟資料庫；不修改任何題目、審核紀錄或發布狀態，亦不會
 * 產生任何檔案。輸出按 `origin` 分組的：
 *
 *   - 可分析題數及排除原因；
 *   - **描述性**：正確選項「唯一最長」的比例；
 *   - **預測性**：「一律選唯一最長的選項」策略的覆蓋率、命中率及 95% Wilson 信賴區間；
 *   - 新增檢查（`src/server/quality/option-quality.ts`）在現有題目上的警告率；
 *   - 各警告代碼的分佈。
 *
 * 兩個指標不可混為一談：描述性指標問「正確答案是否剛好最長」；預測性指標問
 * 「最長的那一項是否就是正確答案」，後者才是學生實際可利用的策略。
 *
 * 這些數字只反映**本機資料庫快照**，不等於正式環境現況；`correctAnswer` 只是
 * 平台記錄的答案，不是歷史科教師已核實的史實。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  OPTION_QUALITY_CODES,
  analyseOptionQuality,
  optionTextLength,
  summariseOptionQualityWarnings,
  type OptionQualityCode,
} from "../src/server/quality/option-quality";

interface Row {
  id: string;
  origin: string;
  status: string;
  difficulty: string;
  options_json: string | null;
  correct_answer: string;
  quality_warnings_json: string | null;
}

interface SnapshotQuestion {
  sessionId: string;
  questionId: string;
  questionType: string;
  qualityWarnings: string[];
}

interface GroupStats {
  origin: string;
  analysable: number;
  excluded: number;
  /** 正確選項唯一最長（描述性） */
  correctUniquelyLongest: number;
  correctUniquelyShortest: number;
  /** 有任何一個選項唯一最長（可作預測） */
  predictable: number;
  /** 唯一最長的那一項就是正確答案 */
  predictedCorrectly: number;
  /** 至少一個新檢查警告的題數 */
  flaggedQuestions: number;
  flagCounts: Partial<Record<OptionQualityCode, number>>;
}

function readArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

function wilson(hits: number, total: number): [number, number] | null {
  if (total === 0) return null;
  const z = 1.96;
  const p = hits / total;
  const denominator = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / denominator;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denominator;
  return [
    Number(((centre - margin) * 100).toFixed(1)),
    Number(((centre + margin) * 100).toFixed(1)),
  ];
}

function percent(value: number, total: number): string {
  if (total === 0) return "—";
  return `${((value / total) * 100).toFixed(1)}%`;
}

function parseOptions(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed.map((value) => String(value)) : [];
  } catch {
    return [];
  }
}

function parseStringArray(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
}

export function summarise(rows: readonly Row[]): GroupStats[] {
  const groups = new Map<string, GroupStats>();
  for (const row of rows) {
    let group = groups.get(row.origin);
    if (group === undefined) {
      group = {
        origin: row.origin,
        analysable: 0,
        excluded: 0,
        correctUniquelyLongest: 0,
        correctUniquelyShortest: 0,
        predictable: 0,
        predictedCorrectly: 0,
        flaggedQuestions: 0,
        flagCounts: {},
      };
      groups.set(row.origin, group);
    }

    const options = parseOptions(row.options_json);
    if (options.length !== 4) {
      group.excluded += 1;
      continue;
    }
    const result = analyseOptionQuality({
      questionType: "mc",
      options,
      correctAnswer: row.correct_answer,
    });
    if (!result.applicable || result.metrics === null) {
      group.excluded += 1;
      continue;
    }
    const metrics = result.metrics;
    group.analysable += 1;
    if (metrics.uniquelyLongest) group.correctUniquelyLongest += 1;
    if (metrics.uniquelyShortest) group.correctUniquelyShortest += 1;

    const maxLength = Math.max(...metrics.lengths);
    const winners = metrics.lengths
      .map((length, index) => (length === maxLength ? index : -1))
      .filter((index) => index >= 0);
    if (winners.length === 1) {
      group.predictable += 1;
      if (winners[0] === metrics.correctIndex) group.predictedCorrectly += 1;
    }

    if (result.findings.length > 0) {
      group.flaggedQuestions += 1;
      for (const finding of result.findings) {
        group.flagCounts[finding.code] = (group.flagCounts[finding.code] ?? 0) + 1;
      }
    }
  }
  return [...groups.values()].sort((a, b) => b.analysable - a.analysable);
}

function main(): void {
  const argv = process.argv.slice(2);
  const repo = process.cwd();
  const databasePath = path.resolve(
    readArg(argv, "--database") ?? path.join(repo, "data", "app.db"),
  );
  if (!fs.existsSync(databasePath)) throw new Error(`找不到資料庫：${databasePath}`);

  const db = new DatabaseSync(databasePath, { readOnly: true });
  let rows: Row[];
  const snapshotQuestions: SnapshotQuestion[] = [];
  try {
    rows = db
      .prepare(
        "SELECT id, origin, status, difficulty, options_json, correct_answer, quality_warnings_json FROM questions WHERE question_type = 'mc'",
      )
      .all() as unknown as Row[];

    // 即時生成題（`persist:false`）不會落庫，只存在於練習快照；警告因此只在快照內。
    const sessions = db
      .prepare("SELECT id, question_snapshot_json FROM practice_sessions")
      .all() as unknown as { id: string; question_snapshot_json: string }[];
    for (const session of sessions) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(session.question_snapshot_json);
      } catch {
        continue;
      }
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed) {
        if (item === null || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        snapshotQuestions.push({
          sessionId: session.id,
          questionId: String(record.id ?? ""),
          questionType: String(record.questionType ?? ""),
          qualityWarnings: Array.isArray(record.qualityWarnings)
            ? record.qualityWarnings.filter((value): value is string => typeof value === "string")
            : [],
        });
      }
    }
  } finally {
    db.close();
  }

  const stats = summarise(rows);

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ database: databasePath, total: rows.length, stats }, null, 2));
    return;
  }

  console.log(`資料庫：${databasePath}（唯讀）`);
  console.log(`選擇題總數：${rows.length}`);
  console.log("");
  console.log("origin              可分析  排除  正確唯一最長  唯一最短  可預測  命中率  警告題數");
  for (const group of stats) {
    console.log(
      [
        group.origin.padEnd(18),
        String(group.analysable).padStart(6),
        String(group.excluded).padStart(5),
        percent(group.correctUniquelyLongest, group.analysable).padStart(13),
        percent(group.correctUniquelyShortest, group.analysable).padStart(9),
        percent(group.predictable, group.analysable).padStart(7),
        percent(group.predictedCorrectly, group.predictable).padStart(7),
        `${percent(group.flaggedQuestions, group.analysable)}（${group.flaggedQuestions}）`.padStart(12),
      ].join("  "),
    );
  }

  console.log("");
  for (const group of stats) {
    const hit = wilson(group.predictedCorrectly, group.predictable);
    console.log(
      `${group.origin}：「選唯一最長」覆蓋 ${percent(group.predictable, group.analysable)}，` +
        `命中 ${percent(group.predictedCorrectly, group.predictable)}` +
        `${hit ? `（95% CI ${hit[0]}–${hit[1]}%）` : ""}`,
    );
    const codes = OPTION_QUALITY_CODES.filter((code) => (group.flagCounts[code] ?? 0) > 0);
    if (codes.length > 0) {
      console.log(
        `  └ 警告分佈：${codes
          .map(
            (code) =>
              `${code} ${group.flagCounts[code]}（${percent(group.flagCounts[code] ?? 0, group.analysable)}）`,
          )
          .join("；")}`,
      );
    }
  }

  console.log("");
  // ── 已儲存警告的可追溯性摘要（Sprint 24）──────────────────────────────
  const stored = summariseOptionQualityWarnings(
    rows.map((row) => parseStringArray(row.quality_warnings_json)),
  );
  const bankIds = new Set(rows.map((row) => row.id));
  const ephemeral = snapshotQuestions.filter(
    (question) => question.questionType === "mc" && !bankIds.has(question.questionId),
  );
  const ephemeralSummary = summariseOptionQualityWarnings(
    ephemeral.map((question) => question.qualityWarnings),
  );

  console.log("已儲存警告（questions.quality_warnings_json）：");
  console.log(
    `  帶有表面線索警告的題目 ${stored.questionsFlagged}／${rows.length}` +
      `（${percent(stored.questionsFlagged, rows.length)}）` +
      `；版本分佈 ${JSON.stringify(stored.byVersion)}`,
  );
  console.log(
    `  代碼分佈：${OPTION_QUALITY_CODES.map((code) => `${code} ${stored.byCode[code]}`).join("；")}`,
  );
  console.log(
    `即時生成題（僅存在練習快照，未落庫）：${ephemeral.length} 題，` +
      `其中帶警告 ${ephemeralSummary.questionsFlagged} 題` +
      `（${percent(ephemeralSummary.questionsFlagged, ephemeral.length)}）` +
      `；版本分佈 ${JSON.stringify(ephemeralSummary.byVersion)}`,
  );
  console.log(
    "  （警告文字的格式為「品質檢查提示：…（規則 <版本> · <代碼>）」，由 parseOptionQualityWarning 解析；" +
      "舊題目要由教師執行「重新檢查」才會取得新版本的警告。）",
  );

  console.log("");
  console.log("注意：`correctAnswer` 是平台的既定答案，不代表歷史科教師已核實；本報告不判斷史實對錯。");
  console.log(`（長度度量：移除空白後的 Unicode 字元數；「甲城。」＝${optionTextLength("甲城。")} 字）`);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]).includes("audit-option-bias")) {
  main();
}
