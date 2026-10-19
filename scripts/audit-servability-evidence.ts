/**
 * 96 題羅馬數字標示缺失：原始證據核對（唯讀）。
 *
 * 逐題回到 `materials/` 的原始試題檔，檢查題幹是否真的包含 i／ii／iii／iv 標示。
 * 只有原文確實有標示，才產生修復候選；原文沒有標示時標記 `source_evidence_missing`，
 * 不推測、不補寫。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { extractQuestionBankText } from "../src/server/materials/question-bank";

type Row = {
  id: string;
  question: string;
  options_json: string | null;
  correct_answer: string;
  source_location: string | null;
  question_type: string;
};

type EvidenceStatus =
  | "labels_present_in_source"
  | "labels_missing_in_source"
  | "source_file_missing"
  | "source_block_not_found"
  | "statement_count_mismatch"
  | "not_applicable";

const LABEL_PATTERN = /^\s*(i{1,3}|iv)\s*[.、．)]\s*/i;
const OPTION_PATTERN = /^[A-D]\s*[.、．]\s*/;
const OPTION_COMBINATION = /^(i{1,3}|iv)(\s*[、,，]\s*(i{1,3}|iv))*$/i;

function readArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

function parseArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function romanLabelsReferenced(options: string[]): string[] {
  const labels = new Set<string>();
  for (const option of options) {
    for (const match of option.matchAll(/\b(i{1,3}|iv)\b/gi)) {
      labels.add(match[1].toLowerCase());
    }
  }
  return [...labels].sort();
}

async function main(): Promise<void> {
  const repo = process.cwd();
  const argv = process.argv.slice(2);
  const databasePath = path.resolve(
    readArg(argv, "--database") ?? path.join(repo, "data", "app.db"),
  );
  const outJson = path.resolve(
    readArg(argv, "--out-json") ??
      path.join(repo, "docs", "quality", "servability-evidence-2026-10-19.json"),
  );
  const outMd = path.resolve(
    readArg(argv, "--out-md") ??
      path.join(repo, "docs", "quality", "servability-evidence-2026-10-19.md"),
  );
  const materialsDir = path.join(repo, "materials");
  const servabilityPath = path.resolve(
    readArg(argv, "--servability") ??
      path.join(repo, "docs", "quality", "servability-remediation-2026-10-19.json"),
  );
  if (!fs.existsSync(databasePath)) throw new Error(`找不到資料庫：${databasePath}`);
  if (!fs.existsSync(materialsDir)) throw new Error("找不到 materials/，無法核對原始證據");
  const servability = fs.existsSync(servabilityPath)
    ? (JSON.parse(fs.readFileSync(servabilityPath, "utf8")) as {
        items?: { id: string; issueCode: string }[];
      })
    : null;
  const blockedRomanIds = new Set(
    (servability?.items ?? [])
      .filter((item) => item.issueCode === "MCQ_ROMAN_LABEL_MISSING")
      .map((item) => item.id),
  );

  const db = new DatabaseSync(databasePath, { readOnly: true });
  let rows: Row[];
  try {
    rows = db
      .prepare(
        "SELECT id, question, options_json, correct_answer, source_location, question_type FROM questions ORDER BY id",
      )
      .all() as unknown as Row[];
  } finally {
    db.close();
  }

  const allFiles = walk(materialsDir);
  const fileByName = new Map(allFiles.map((file) => [path.basename(file), file]));
  const itemCache = new Map<string, string>();
  const items: {
    id: string;
    questionType: string;
    sourceLocation: string | null;
    referencedLabels: string[];
    status: EvidenceStatus;
    evidence: string[];
    statementLines: string[];
    proposedStem: string | null;
    /** 只還原標示且其餘文字相同 → 確定性修復候選；否則需教師核對差異。 */
    labelsOnlyDiff?: boolean;
    note: string;
  }[] = [];

  for (const row of rows) {
    const options = parseArray(row.options_json);
    const referencedLabels = romanLabelsReferenced(options);
    if (row.question_type !== "mc" || referencedLabels.length === 0) continue;
    if (blockedRomanIds.size > 0 && !blockedRomanIds.has(row.id)) continue;
    const sourceLocation = row.source_location ?? "";
    const [fileName] = sourceLocation.split("·").map((part) => part.trim());
    const file = fileByName.get(fileName);
    if (!file) {
      items.push({
        id: row.id,
        questionType: row.question_type,
        sourceLocation: row.source_location,
        referencedLabels,
        status: "source_file_missing",
        evidence: [`materials/ 內找不到 ${fileName}`],
        statementLines: [],
        proposedStem: null,
        note: "來源檔不存在，無法核對原文；需教師裁決",
      });
      continue;
    }

    let text = itemCache.get(file);
    if (text === undefined) {
      text = await extractQuestionBankText(fs.readFileSync(file));
      itemCache.set(file, text);
    }
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const stemProbe = row.question.replace(/[＿_]{2,}/g, " ").slice(0, 12).trim();
    const start = lines.findIndex((line) => line.includes(stemProbe));
    if (start < 0) {
      items.push({
        id: row.id,
        questionType: row.question_type,
        sourceLocation: row.source_location,
        referencedLabels,
        status: "source_block_not_found",
        evidence: [`${fileName} 內找不到題幹起始文字「${stemProbe}」`],
        statementLines: [],
        proposedStem: null,
        note: "無法在原文定位題目；需教師裁決",
      });
      continue;
    }
    const block: string[] = [];
    for (let index = start; index < lines.length; index += 1) {
      const line = lines[index];
      if (
        index > start &&
        (line.startsWith("@O") ||
          line.startsWith("##") ||
          line.startsWith("|!|") ||
          OPTION_PATTERN.test(line) ||
          OPTION_COMBINATION.test(line))
      ) {
        break;
      }
      block.push(line);
    }
    const stemLines = block.slice(1);
    const labelledLines = stemLines.filter((line) => LABEL_PATTERN.test(line));
    const statementLines = stemLines.filter(
      (line) => !line.startsWith("@O") && !line.startsWith("##"),
    );

    if (labelledLines.length === referencedLabels.length) {
      const proposedStem = [block[0], ...stemLines].join("\n");
      const normalise = (value: string): string =>
        value
          .replace(/(^|\n)\s*(i{1,3}|iv)\s*[.、．)]\s*/gi, "$1")
          .replace(/[\s＿_]+/g, "");
      const labelsOnly = normalise(proposedStem) === normalise(row.question);
      items.push({
        id: row.id,
        questionType: row.question_type,
        sourceLocation: row.source_location,
        referencedLabels,
        status: "labels_present_in_source",
        evidence: labelledLines,
        statementLines,
        proposedStem,
        labelsOnlyDiff: labelsOnly,
        note: labelsOnly
          ? "原文有標示，且去掉標示後與現行題幹完全相同：屬「只還原標示」的確定性修復候選（仍需教師核准）"
          : "原文有標示，但去掉標示後與現行題幹不完全相同：需教師核對差異",
      });
      continue;
    }

    const status: EvidenceStatus =
      labelledLines.length === 0 && statementLines.length !== referencedLabels.length
        ? "statement_count_mismatch"
        : "labels_missing_in_source";
    items.push({
      id: row.id,
      questionType: row.question_type,
      sourceLocation: row.source_location,
      referencedLabels,
      status,
      evidence: statementLines,
      statementLines,
      proposedStem: null,
      note:
        labelledLines.length === 0
          ? "原文的陳述沒有 i／ii／iii／iv 標示；不能由選項推測順序，需教師對照原卷裁決"
          : "原文標示數量與選項引用不一致；需教師裁決",
    });
  }

  const countBy = (values: string[]): Record<string, number> =>
    values.reduce<Record<string, number>>((accumulator, value) => {
      accumulator[value] = (accumulator[value] ?? 0) + 1;
      return accumulator;
    }, {});
  const payload = {
    generatedAt: new Date().toISOString(),
    notice:
      "唯讀證據核對：沒有修改題目；`labels_present_in_source` 只代表原文有標示，仍需教師核准。",
    totals: {
      checked: items.length,
      scope: blockedRomanIds.size > 0 ? "MCQ_ROMAN_LABEL_MISSING（不可作答）" : "所有引用羅馬數字的選擇題",
      labelsPresent: items.filter((item) => item.status === "labels_present_in_source").length,
      labelsOnlyCandidates: items.filter((item) => item.labelsOnlyDiff === true).length,
      labelsMissing: items.filter((item) => item.status === "labels_missing_in_source").length,
      sourceMissing: items.filter((item) => item.status === "source_file_missing").length,
      blockNotFound: items.filter((item) => item.status === "source_block_not_found").length,
      countMismatch: items.filter((item) => item.status === "statement_count_mismatch").length,
    },
    byStatus: countBy(items.map((item) => item.status)),
    items,
  };

  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const lines: string[] = [];
  lines.push("# 96 題羅馬數字：原始證據核對（2026-10-19）");
  lines.push("");
  lines.push(`> ${payload.notice}`);
  lines.push("");
  lines.push("| 狀態 | 題數 |");
  lines.push("| --- | --- |");
  for (const [status, count] of Object.entries(payload.byStatus)) {
    lines.push(`| ${status} | ${count} |`);
  }
  lines.push("");
  lines.push("## 逐題證據");
  lines.push("");
  lines.push("| 題目 | 引用標示 | 狀態 | 原文陳述 |");
  lines.push("| --- | --- | --- | --- |");
  for (const item of items) {
    lines.push(
      `| ${item.id} | ${item.referencedLabels.join("、")} | ${item.status} | ${item.statementLines.slice(0, 6).join(" / ").replace(/\|/g, "\\|")} |`,
    );
  }
  lines.push("");
  lines.push("## 結論");
  lines.push("");
  lines.push(
    payload.totals.labelsPresent === 0
      ? "全部題目的原文都沒有 i／ii／iii／iv 標示：**不能自動補寫**，必須由教師對照原卷逐題裁決（`source_evidence_missing`）。"
      : `${payload.totals.labelsPresent} 題的原文有標示，可作為修復候選；其餘 ${payload.totals.checked - payload.totals.labelsPresent} 題需教師裁決。`,
  );

  fs.mkdirSync(path.dirname(outMd), { recursive: true });
  fs.writeFileSync(outMd, `${lines.join("\n")}\n`, "utf8");

  console.log(payload.notice);
  console.log(`核對：${items.length}；${JSON.stringify(payload.byStatus)}`);
  console.log(`已寫入：${path.relative(repo, outJson)}`);
  console.log(`已寫入：${path.relative(repo, outMd)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
