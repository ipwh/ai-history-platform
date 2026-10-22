/**
 * 把「短子標題誤中其他分節關鍵詞」的修正套用到已匯入的教材（不重新匯入，段落 ID 不變）。
 *
 * 只會處理**確定由這次修正造成**的改動：先以未套用修正的規則重算一次，
 * 若現存資料與該結果一致，而套用修正後結果不同，才會改動。
 * 這樣可以避免把歷來其他版本造成的差異一併「修正」，令改動範圍可審核。
 *
 * 用法：
 *   npm run remap:sections                                  # 檢查（預設只處理 kind = demo 的教材／課文）
 *   npm run remap:sections -- --topic topic-5               # 只檢查某課題
 *   npm run remap:sections -- --apply                       # 寫入資料庫
 *   npm run remap:sections -- --apply --report docs/teacher-review/section-remap-2026-10-22.json
 *   npm run remap:sections -- --include-question-bank       # 連校內試題文件一併處理
 */
import fs from "node:fs";
import path from "node:path";

import type { Section } from "../src/lib/types";
import { mapBlocksToSections } from "../src/server/materials/section-mapper";
import { listSections } from "../src/server/repositories/topics";
import { getDb, withTransaction } from "../src/server/db/connection";
import { declaredSectionsForFile } from "../src/server/seed/curriculum";

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

const apply = process.argv.includes("--apply");
const includeQuestionBank = process.argv.includes("--include-question-bank");
const topicFilter = readArg("--topic");
const reportPath = readArg("--report");

interface StoredBlock {
  id: string;
  type: string;
  level: number | null;
  text: string;
  sortOrder: number;
  sectionId: string | null;
}

interface DocumentReport {
  documentId: string;
  fileName: string;
  topicId: string;
  changedBlocks: number;
  changes: { blockId: string; from: string | null; to: string | null; text: string }[];
  movedQuestions: { questionId: string; from: string; to: string }[];
}

const db = getDb();

const conditions = ["d.status = 'ready'"];
const args: string[] = [];
if (!includeQuestionBank) conditions.push("d.kind = 'demo'");
if (topicFilter) {
  conditions.push("d.topic_id = ?");
  args.push(topicFilter);
}

const documents = db
  .prepare(
    `SELECT d.id, d.file_name AS fileName, d.topic_id AS topicId
     FROM material_documents d WHERE ${conditions.join(" AND ")}
     ORDER BY d.topic_id, d.file_name`,
  )
  .all(...args) as { id: string; fileName: string; topicId: string }[];

const updateBlock = db.prepare("UPDATE material_blocks SET section_id = ? WHERE id = ?");
const updateQuestion = db.prepare("UPDATE questions SET section_id = ? WHERE id = ?");

const report: { generatedAt: string; apply: boolean; documents: DocumentReport[] } = {
  generatedAt: new Date().toISOString(),
  apply,
  documents: [],
};

for (const document of documents) {
  const sections = listSections(document.topicId) as Section[];
  if (sections.length === 0) continue;
  const declared = declaredSectionsForFile(document.fileName);
  const candidates =
    declared && declared.length > 0
      ? sections.filter((section) => declared.includes(section.id))
      : sections;
  if (candidates.length === 0) continue;

  const blocks = db
    .prepare(
      `SELECT id, type, level, text, sort_order AS sortOrder, section_id AS sectionId
       FROM material_blocks WHERE document_id = ? ORDER BY sort_order, id`,
    )
    .all(document.id) as unknown as StoredBlock[];
  if (blocks.length === 0) continue;

  const parsed = blocks.map((block) => ({
    type: block.type as never,
    level: block.level,
    text: block.text,
    items: [],
    table: null,
    order: block.sortOrder,
    page: null,
  }));
  const before = mapBlocksToSections(parsed, candidates, { smoothShortRuns: false });
  const after = mapBlocksToSections(parsed, candidates);
  // 與 import-service 一致：只聲明單一分節的教材，未命中的段落亦歸入該分節
  if (declared?.length === 1 && candidates.length === 1) {
    const onlySection = candidates[0].id;
    before.sectionIds = before.sectionIds.map(() => onlySection);
    after.sectionIds = after.sectionIds.map(() => onlySection);
  }

  const changes: DocumentReport["changes"] = [];
  blocks.forEach((block, index) => {
    const stored = block.sectionId ?? null;
    const previous = before.sectionIds[index] ?? null;
    const next = after.sectionIds[index] ?? null;
    // 只處理「現存資料與舊規則一致」且「新規則有改動」的段落
    if (stored !== previous || previous === next) return;
    changes.push({
      blockId: block.id,
      from: stored,
      to: next,
      text: block.text.replace(/\n/g, " ").slice(0, 80),
    });
  });

  if (changes.length === 0) continue;

  // 題目：只跟隨「本次改動的段落」全部落在同一新分節的情況
  const changedIds = new Set(changes.map((change) => change.blockId));
  const targetByBlock = new Map(changes.map((change) => [change.blockId, change.to]));
  const questions = db
    .prepare("SELECT id, section_id AS sectionId, source_block_ids_json AS ids FROM questions WHERE topic_id = ?")
    .all(document.topicId) as { id: string; sectionId: string; ids: string }[];
  const movedQuestions: DocumentReport["movedQuestions"] = [];
  for (const question of questions) {
    let ids: string[] = [];
    try {
      ids = JSON.parse(question.ids || "[]") as string[];
    } catch {
      continue;
    }
    if (ids.length === 0 || !ids.every((id) => changedIds.has(id))) continue;
    const targets = new Set(ids.map((id) => targetByBlock.get(id)));
    if (targets.size !== 1) continue;
    const [target] = [...targets];
    if (!target || target === question.sectionId) continue;
    movedQuestions.push({ questionId: question.id, from: question.sectionId, to: target });
  }

  console.log(
    `${document.topicId} · ${document.fileName}：段落 ${changes.length} 段、題目 ${movedQuestions.length} 題`,
  );
  for (const change of changes.slice(0, 8)) {
    console.log(
      `    ${change.blockId}：${change.from ?? "（無）"} → ${change.to ?? "（無）"}｜${change.text.slice(0, 46)}`,
    );
  }

  report.documents.push({
    documentId: document.id,
    fileName: document.fileName,
    topicId: document.topicId,
    changedBlocks: changes.length,
    changes,
    movedQuestions,
  });

  if (apply) {
    withTransaction(db, () => {
      for (const change of changes) updateBlock.run(change.to, change.blockId);
      for (const question of movedQuestions) updateQuestion.run(question.to, question.questionId);
    });
  }
}

const totals = report.documents.reduce(
  (sum, document) => ({
    blocks: sum.blocks + document.changedBlocks,
    questions: sum.questions + document.movedQuestions.length,
  }),
  { blocks: 0, questions: 0 },
);
console.log(
  `\n${apply ? "已套用" : "（未套用，加 --apply 才寫入）"}：段落 ${totals.blocks} 段、題目 ${totals.questions} 題、教材 ${report.documents.length} 份`,
);

if (reportPath && report.documents.length > 0) {
  fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`報告：${reportPath}`);
}
