/**
 * 96 題 Roman numeral 補號「乾跑」報告（Sprint 19 追加，唯讀）。
 *
 * 依負責人確認的匯入慣例（題幹陳述按原文列出順序＝i、ii、iii、iv），
 * 為每題產生「只插入編號、不改動任何字詞」的建議題幹，並列出 diff 供教師逐題核對。
 *
 * 這個指令**不寫入資料庫**：唯讀連線、只輸出報告檔。
 * 核准與發布仍須由教師在 /teacher/review 逐題記錄。
 *
 *   npx tsx scripts/build-roman-label-dry-run.ts
 */
import fs from "node:fs";
import path from "node:path";

import { openReadOnlyDatabase } from "../src/server/db/connection";

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi"];
const WORKLIST = "docs/quality/adjudication-worklist-2026-10-19.json";
const OUT_BASE = "docs/teacher-review/roman-label-dry-run-2026-10-19";

interface WorkItem {
  questionId: string;
  revision: number;
  fingerprint: string;
  issueCode: string;
  evidenceCategory: string;
  evidenceLines: string[];
  correctAnswer: string | null;
  sourceLocation: string | null;
  missingEvidence: string[];
}


interface Row {
  questionId: string;
  revision: number;
  fingerprint: string;
  sourceLocation: string | null;
  evidenceCategory: string;
  recordedAnswer: string | null;
  options: string[];
  statementsMatched: number;
  statementsTotal: number;
  oldStem: string;
  newStem: string | null;
  diff: string[];
  note: string;
}

function main(): void {
  const repo = process.cwd();
  const worklist = JSON.parse(
    fs.readFileSync(path.join(repo, WORKLIST), "utf8").replace(/^\uFEFF/, ""),
  ) as { items: WorkItem[] };
  const targets = worklist.items.filter((item) => item.issueCode === "MCQ_ROMAN_LABEL_MISSING");

  const db = openReadOnlyDatabase(path.join(repo, "data", "app.db"));
  const rows: Row[] = [];
  try {
    const statement = db.prepare(
      "SELECT question, options_json FROM questions WHERE id = ?",
    );
    for (const item of targets) {
      const record = statement.get(item.questionId) as
        | { question: string; options_json: string | null }
        | undefined;
      if (!record) {
        rows.push({
          questionId: item.questionId,
          revision: item.revision,
          fingerprint: item.fingerprint,
          sourceLocation: item.sourceLocation,
          evidenceCategory: item.evidenceCategory,
          recordedAnswer: item.correctAnswer,
          options: [],
          statementsMatched: 0,
          statementsTotal: item.evidenceLines.length,
          oldStem: "（資料庫找不到此題目）",
          newStem: null,
          diff: [],
          note: "資料庫缺少此題目，需人工核對",
        });
        continue;
      }

      const oldStem = record.question;
      const options = record.options_json ? (JSON.parse(record.options_json) as string[]) : [];
      // 證據檔有時把「選項文字」也當成原文陳述（例如 `i及ii`、`全部皆是`、`□`），
      // 有時陳述本身自帶 `i.`／`(ii)` 前綴或 tab；先剝除再比對。
      const stripMarker = (value: string) =>
        value.replace(/^\s*\(?[ivxIVX]{1,4}\)?[.、)]?[\s\t]*/, "").trim();
      const statementTexts = item.evidenceLines
        .map(stripMarker)
        .filter(
          (line) =>
            line.length > 0 &&
            !(
              line === "□" ||
              line === "全部皆是" ||
              line === "以上皆是" ||
              (line.length <= 12 && /(及|、)/.test(line))
            ),
        )
        .slice(0, ROMAN.length);

      const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const found = statementTexts
        .map((text) => {
          const pattern = new RegExp(
            `(?:\\(?[ivxIVX]{1,4}\\)?[.、)]?\\s*)?${escapeRegExp(text)}`,
          );
          const match = pattern.exec(oldStem);
          return match ? { text, index: match.index, length: match[0].length } : null;
        })
        .filter((entry): entry is { text: string; index: number; length: number } => entry !== null)
        .sort((a, b) => a.index - b.index);

      let newStem = "";
      let matched = 0;
      let total = statementTexts.length;
      const diff: string[] = [];

      if (found.length >= 2) {
        let cursor = 0;
        found.forEach((entry, index) => {
          newStem += oldStem.slice(cursor, entry.index) + `${ROMAN[index]}. ${entry.text}`;
          cursor = entry.index + entry.length;
          diff.push(`+ ${ROMAN[index]}. ${entry.text.slice(0, 60)}`);
        });
        newStem += oldStem.slice(cursor);
        matched = found.length;
      }

      // 備援：證據檔不可用，但題幹本身已有 `(ii)(iii)(iv)` 之類標記時，
      // 以題幹自身的順序推算第一句，並把括號格式統一為 `i.`（未套用）。
      if (found.length < 2) {
        const markers = [...oldStem.matchAll(/\(([ivxIVX]{1,4})\)\s*/g)];
        if (markers.length >= 2) {
          const firstMarker = markers[0].index ?? 0;
          const head = oldStem.slice(0, firstMarker);
          const questionEnd = head.lastIndexOf("？");
          if (questionEnd !== -1) {
            const questionPart = head.slice(0, questionEnd + 1);
            const firstStatement = head.slice(questionEnd + 1).trim();
            let rebuilt = questionPart;
            if (firstStatement.length > 0) {
              rebuilt += ` ${ROMAN[0]}. ${firstStatement}`;
              diff.push(`+ ${ROMAN[0]}. ${firstStatement.slice(0, 60)}`);
              matched += 1;
            }
            markers.forEach((marker, index) => {
              const start = (marker.index ?? 0) + marker[0].length;
              const nextStart = markers[index + 1]?.index ?? oldStem.length;
              const text = oldStem.slice(start, nextStart).trim();
              const roman = ROMAN[index + 1];
              if (!roman || text.length === 0) return;
              rebuilt += ` ${roman}. ${text}`;
              diff.push(`+ ${roman}. ${text.slice(0, 60)}`);
              matched += 1;
            });
            newStem = rebuilt;
            total = matched;
          }
        }
      }

      const complete = total >= 2 && matched === total;
      rows.push({
        questionId: item.questionId,
        revision: item.revision,
        fingerprint: item.fingerprint,
        sourceLocation: item.sourceLocation,
        evidenceCategory: item.evidenceCategory,
        recordedAnswer: item.correctAnswer,
        options,
        statementsMatched: matched,
        statementsTotal: statementTexts.length,
        oldStem,
        newStem: complete ? newStem : null,
        diff,
        note: complete
          ? "建議題幹已產生（未套用）"
          : "無法在題幹中完整定位所有原文陳述，需人工處理",
      });
    }
  } finally {
    db.close();
  }

  const ready = rows.filter((row) => row.newStem !== null);
  const manual = rows.filter((row) => row.newStem === null);

  const md: string[] = [
    "# 96 題 Roman numeral 補號乾跑報告（唯讀，未套用）",
    "",
    "> 本報告**沒有**修改任何題目、覆核紀錄或發布狀態；資料庫以唯讀模式開啟。",
    "> 補號依據：負責人於 2026-10-19 確認「題幹陳述按原文列出順序＝i、ii、iii、iv」。",
    "> 只插入編號前綴，未改動任何字詞；核准仍須由教師在 `/teacher/review` 逐題記錄。",
    "",
    `- 目標題目：${rows.length}`,
    `- 可自動產生建議題幹：${ready.length}`,
    `- 需人工處理（陳述無法完整定位）：${manual.length}`,
    "",
  ];

  for (const [title, group] of [
    ["可自動產生建議題幹（未套用）", ready],
    ["需人工處理", manual],
  ] as const) {
    md.push(`## ${title}（${group.length} 題）`, "");
    for (const row of group) {
      md.push(
        `### ${row.questionId}（第 ${row.revision} 版，指紋 ${row.fingerprint.slice(0, 12)}）`,
        "",
        `- 來源：${row.sourceLocation ?? "（無）"}`,
        `- 證據類別：${row.evidenceCategory}`,
        `- 記錄答案：${row.recordedAnswer ?? "（無）"}`,
        `- 選項：${row.options.join(" ｜ ") || "（無）"}`,
        `- 陳述定位：${row.statementsMatched}/${row.statementsTotal}`,
        `- 狀態：${row.note}`,
        "",
        "```diff",
        row.diff.join("\n") || "（無可用 diff）",
        "```",
        "",
      );
      if (row.newStem) {
        md.push("<details><summary>建議題幹全文（未套用）</summary>", "", "```text", row.newStem, "```", "", "</details>", "");
      }
    }
  }

  fs.mkdirSync(path.dirname(path.join(repo, `${OUT_BASE}.md`)), { recursive: true });
  fs.writeFileSync(path.join(repo, `${OUT_BASE}.md`), `${md.join("\n")}\n`, "utf8");
  fs.writeFileSync(
    path.join(repo, `${OUT_BASE}.json`),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), total: rows.length, ready: ready.length, manual: manual.length, rows }, null, 1)}\n`,
    "utf8",
  );

  console.log(`目標題目：${rows.length}`);
  console.log(`可自動產生建議題幹：${ready.length}`);
  console.log(`需人工處理：${manual.length}`);
  console.log(`已寫入：${OUT_BASE}.md／.json（未套用、未寫入資料庫）`);
}

main();
