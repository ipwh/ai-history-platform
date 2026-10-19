/**
 * 內容質量待辦佇列（唯讀、可重複執行）。
 *
 * 把不同性質的未解決問題**分開**列出，避免把版權許可、史實準確度、題目結構有效性
 * 與發布批准混為一談：
 *
 *   1. 附錄 B 的歷史／答案鍵疑點（需歷史科教師裁決，本腳本不作裁決）
 *   2. 沒有實質解釋的題目（佔位文字／只列出答案）
 *   3. 知識點與分節不對應、或知識點是排版殘留
 *   4. 技能標籤全部為空、難度全部 basic（元數據覆蓋率）
 *   5. 第 2 版以後但沒有可追溯修復紀錄的題目
 *   6. 教材發行權／版權許可狀態（與史實及結構無關）
 *
 * 用法：
 *   npx tsx scripts/build-content-quality-queue.ts
 *   npx tsx scripts/build-content-quality-queue.ts --database "C:\\temp\\snapshot.db" --audit docs/audit-2026-10-18-platform-audit.md
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

type QuestionRow = {
  id: string;
  topic_id: string;
  section_id: string | null;
  question_type: string;
  difficulty: string | null;
  skill: string | null;
  explanation: string | null;
  knowledge_point: string | null;
  status: string;
  revision: number;
  source_block_ids_json: string | null;
};

type DocumentRow = {
  id: string;
  file_name: string;
  status: string;
  student_distribution: number;
  rights_confirmed_at: string | null;
  rights_confirmed_by: string | null;
  topic_id: string | null;
};

type Category = {
  id: string;
  priority: string;
  owner: string;
  description: string;
  count?: number;
  items?: {
    questionId: string;
    observation: string;
    whyTeacher: string;
    status: string;
    decision: null;
  }[];
  byTopic?: { key: string; count: number }[];
  values?: { key: string; count: number }[];
  distribution?: { key: string; count: number }[];
  totals?: {
    documents: number;
    studentDistributionOn: number;
    studentDistributionOff: number;
    rightsNotRecorded: number;
  };
  documentsWithoutStudentDistribution?: {
    documentId: string;
    fileName: string;
    status: string;
    rightsConfirmedAt: string | null;
    rightsConfirmedBy: string | null;
    publishedQuestionsReferencing: number;
  }[];
  questionIds?: string[];
  notes?: string[];
  documentsReferencedByQuestions?: number;
  note?: string;
  questions?: number;
};

function readArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function countBy<T>(items: T[], key: (item: T) => string): { key: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ key: value, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

/** 從稽核報告的附錄 B 表格取出題目 ID 及觀察（不重新判斷史實）。 */
function parseAppendixB(auditPath: string): {
  available: boolean;
  items: { questionId: string; observation: string; whyTeacher: string }[];
  note: string | null;
} {
  if (!fs.existsSync(auditPath)) return { available: false, items: [], note: null };
  const lines = fs.readFileSync(auditPath, "utf8").split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith("## 附錄 B"));
  if (start < 0) return { available: false, items: [], note: null };

  const items: { questionId: string; observation: string; whyTeacher: string }[] = [];
  let note: string | null = null;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("## ") && index > start + 1) break;
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length >= 5 && /^qb-[A-Za-z0-9]+$/.test(cells[1])) {
      items.push({ questionId: cells[1], observation: cells[2], whyTeacher: cells[3] });
      continue;
    }
    if (line.startsWith("另：")) note = line.replace(/^另：/, "").trim();
  }
  return { available: true, items, note };
}

async function main() {
  const repo = process.cwd();
  const argv = process.argv.slice(2);
  const databasePath = path.resolve(
    readArg(argv, "--database") ?? path.join(repo, "data", "app.db"),
  );
  const auditPath = path.resolve(
    readArg(argv, "--audit") ?? path.join(repo, "docs", "audit-2026-10-18-platform-audit.md"),
  );
  const outJson = path.resolve(
    readArg(argv, "--out-json") ??
      path.join(repo, "docs", "teacher-review", "content-quality-queue-2026-10-19.json"),
  );
  const outMd = path.resolve(
    readArg(argv, "--out-md") ??
      path.join(repo, "docs", "teacher-review", "content-quality-queue-2026-10-19.md"),
  );

  if (!fs.existsSync(databasePath)) throw new Error(`找不到資料庫：${databasePath}`);
  const db = new DatabaseSync(databasePath, { readOnly: true });

  const questions = db
    .prepare(
      "SELECT id, topic_id, section_id, question_type, difficulty, skill, explanation, knowledge_point, status, revision, source_block_ids_json FROM questions WHERE status != 'disabled'",
    )
    .all() as unknown as QuestionRow[];
  const sections = db.prepare("SELECT id, topic_id, title FROM sections").all() as unknown as {
    id: string;
    topic_id: string;
    title: string;
  }[];
  const documents = db
    .prepare(
      "SELECT id, file_name, status, student_distribution, rights_confirmed_at, rights_confirmed_by, topic_id FROM material_documents",
    )
    .all() as unknown as DocumentRow[];
  const blocks = db.prepare("SELECT id, document_id FROM material_blocks").all() as unknown as {
    id: string;
    document_id: string;
  }[];

  const PLACEHOLDER = "答案依校內試題檔的評卷參考。";
  const placeholder = questions.filter((question) => question.explanation === PLACEHOLDER);
  const answerKeyOnly = questions.filter(
    (question) =>
      question.explanation !== PLACEHOLDER &&
      /^填充題答案（依空格次序）/.test(question.explanation ?? ""),
  );

  // 知識點與分節標題的對應（去除開頭的「A. 」等標記後互相比對）
  const sectionsByTopic = new Map<string, string[]>();
  for (const section of sections) {
    const list = sectionsByTopic.get(section.topic_id) ?? [];
    list.push(section.title);
    sectionsByTopic.set(section.topic_id, list);
  }
  const normalise = (value: string): string =>
    value
      .replace(/^[A-Za-z]\s*[.、．]\s*/, "")
      .replace(/[\s（）()：:、,，.。'"「」]/g, "")
      .toLowerCase();
  const looksLikeLayoutResidue = (value: string): boolean =>
    /^[A-D]\s*[.、．]\s*(?:[ivx]+(?:[、,，]\s*[ivx]+)*|[A-Z])$/i.test(value.trim()) ||
    /^[A-D]\s*[.、．].*[A-Z]$/.test(value.trim());
  const GENERIC_KNOWLEDGE_POINT = "校內試題";
  const genericKnowledgePoint = questions.filter(
    (question) => question.knowledge_point?.trim() === GENERIC_KNOWLEDGE_POINT,
  );
  const layoutResidueKnowledgePoint = questions.filter((question) => {
    const knowledgePoint = question.knowledge_point?.trim();
    return Boolean(knowledgePoint) && looksLikeLayoutResidue(knowledgePoint!);
  });
  const unmappedKnowledgePoint = questions.filter((question) => {
    const knowledgePoint = question.knowledge_point?.trim();
    if (!knowledgePoint) return false;
    if (knowledgePoint === GENERIC_KNOWLEDGE_POINT) return false;
    if (looksLikeLayoutResidue(knowledgePoint)) return false;
    const titles = sectionsByTopic.get(question.topic_id) ?? [];
    const kp = normalise(knowledgePoint);
    if (kp.length === 0) return false;
    return !titles.some((title) => {
      const section = normalise(title);
      return section.includes(kp) || kp.includes(section);
    });
  });

  // 第 2 版以後但找不到對應目前版本的修復紀錄（automation 或理由含「自動修復」）
  const repairReviews = db
    .prepare(
      "SELECT question_id, revision FROM question_reviews WHERE reviewer_role = 'automation' OR reason LIKE '%自動修復%'",
    )
    .all() as unknown as { question_id: string; revision: number }[];
  const repairKeys = new Set(repairReviews.map((row) => `${row.question_id}#${row.revision}`));
  const missingRepairProvenance = questions.filter(
    (question) => question.revision > 1 && !repairKeys.has(`${question.id}#${question.revision}`),
  );

  const blockToDocument = new Map(blocks.map((block) => [block.id, block.document_id]));
  const questionDocuments = new Map<string, Set<string>>();
  for (const question of questions) {
    const documentIds = new Set<string>();
    for (const blockId of parseJsonArray(question.source_block_ids_json)) {
      const documentId = blockToDocument.get(blockId);
      if (documentId) documentIds.add(documentId);
    }
    questionDocuments.set(question.id, documentIds);
  }
  const questionsByDocument = new Map<string, string[]>();
  for (const [questionId, documentIds] of questionDocuments) {
    for (const documentId of documentIds) {
      const list = questionsByDocument.get(documentId) ?? [];
      list.push(questionId);
      questionsByDocument.set(documentId, list);
    }
  }
  const documentsWithoutStudentDistribution = documents
    .filter((document) => document.student_distribution === 0)
    .map((document) => ({
      documentId: document.id,
      fileName: document.file_name,
      status: document.status,
      rightsConfirmedAt: document.rights_confirmed_at,
      rightsConfirmedBy: document.rights_confirmed_by,
      publishedQuestionsReferencing: (questionsByDocument.get(document.id) ?? []).length,
    }));

  const appendixB = parseAppendixB(auditPath);

  const categories: Category[] = [
      {
        id: "historical-concerns",
        priority: "P1",
        owner: "歷史科教師",
        description: "附錄 B 抽樣中疑似的答案鍵／史實問題；本報告不作裁決。",
        count: appendixB.items.length,
        items: appendixB.items.map((item) => ({
          ...item,
          status: "NEEDS_HISTORY_TEACHER_REVIEW",
          decision: null,
        })),
        notes: appendixB.note ? [appendixB.note] : [],
      },
      {
        id: "placeholder-explanations",
        priority: "P1",
        owner: "歷史科教師／內容編輯",
        description: `解釋為同一句佔位文字（「${PLACEHOLDER}」），不構成解釋。`,
        count: placeholder.length,
        byTopic: countBy(placeholder, (question) => question.topic_id),
        questionIds: placeholder.map((question) => question.id),
      },
      {
        id: "answer-key-only-explanations",
        priority: "P2",
        owner: "歷史科教師／內容編輯",
        description:
          "解釋只按空格次序列出答案，未有說明原因或史料依據；不可當作實質解釋（與上一個分類分開計算）。",
        count: answerKeyOnly.length,
        byTopic: countBy(answerKeyOnly, (question) => question.topic_id),
        questionIds: answerKeyOnly.map((question) => question.id),
      },
      {
        id: "knowledge-point-layout-residue",
        priority: "P2",
        owner: "歷史科教師",
        description:
          "知識點是排版殘留（例如「D. iii、iv」「A. 國家W」），不是課題或分節名稱；會令「需要重溫」指向錯誤主題。",
        count: layoutResidueKnowledgePoint.length,
        values: countBy(layoutResidueKnowledgePoint, (question) => question.knowledge_point ?? ""),
        byTopic: countBy(layoutResidueKnowledgePoint, (question) => question.topic_id),
        questionIds: layoutResidueKnowledgePoint.map((question) => question.id),
      },
      {
        id: "knowledge-point-generic-bucket",
        priority: "P2",
        owner: "歷史科教師",
        description: `知識點只是匯入時的通用標籤「${GENERIC_KNOWLEDGE_POINT}」，沒有指向任何分節；學習紀錄無法用作重溫指引。`,
        count: genericKnowledgePoint.length,
        byTopic: countBy(genericKnowledgePoint, (question) => question.topic_id),
        questionIds: genericKnowledgePoint.map((question) => question.id),
      },
      {
        id: "knowledge-point-mapping-review",
        priority: "P3",
        owner: "歷史科教師",
        description:
          "知識點與所屬課題的分節標題對不上（可能是課程指引的章節名稱，也可能是錯配）。本腳本**不判定**為錯配，只列出需教師確認的相異值及題數。",
        count: unmappedKnowledgePoint.length,
        values: countBy(unmappedKnowledgePoint, (question) => question.knowledge_point ?? ""),
        byTopic: countBy(unmappedKnowledgePoint, (question) => question.topic_id),
      },
      {
        id: "skill-metadata-missing",
        priority: "P3",
        owner: "平台維護者（不需歷史裁決）",
        description: "技能標籤為空，無法按「歷史技能」分析或練習。",
        count: questions.filter((question) => !question.skill).length,
        questions: questions.length,
      },
      {
        id: "difficulty-metadata-flat",
        priority: "P3",
        owner: "平台維護者（不需歷史裁決）",
        description: "難度只有單一值，學生無法選擇程度，難度配對亦無實際作用。",
        distribution: countBy(questions, (question) => question.difficulty ?? "（空白）"),
      },
      {
        id: "missing-repair-provenance",
        priority: "P1",
        owner: "歷史科教師",
        description:
          "題目已是第 2 版或以上，但找不到對應目前版本的自動修復紀錄；改寫來源不可追溯，需教師確認改寫後內容仍符合上載前的審核結論。",
        count: missingRepairProvenance.length,
        byTopic: countBy(missingRepairProvenance, (question) => question.topic_id),
        questionIds: missingRepairProvenance.map((question) => question.id),
      },
      {
        id: "copyright-and-distribution",
        priority: "P1",
        owner: "擁有者／版權負責人",
        description:
          "教材發行權與版權許可。與史實準確度、題目結構及發布批准無關，不可互相替代。",
        totals: {
          documents: documents.length,
          studentDistributionOn: documents.filter((document) => document.student_distribution === 1)
            .length,
          studentDistributionOff: documentsWithoutStudentDistribution.length,
          rightsNotRecorded: documents.filter((document) => !document.rights_confirmed_at).length,
        },
        documentsWithoutStudentDistribution,
        documentsReferencedByQuestions: documentsWithoutStudentDistribution.filter(
          (document) => document.publishedQuestionsReferencing > 0,
        ).length,
        note: "student_distribution = 0 的教材，其內容不會向學生顯示；引用它的題目仍需教師確認是否可繼續使用。",
      },
  ];

  const payload = {
    generatedAt: new Date().toISOString(),
    scope: {
      database: path.relative(repo, databasePath).replace(/\\/g, "/"),
      audit: fs.existsSync(auditPath) ? path.relative(repo, auditPath).replace(/\\/g, "/") : null,
      questionsConsidered: questions.length,
      note: "這是內容質量的待辦佇列，不是發布批准，也不是史實裁決。各分類互不等價。",
    },
    categories,
  };

  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const lines: string[] = [];
  lines.push("# 內容質量待辦佇列（與發布批准分開）");
  lines.push("");
  lines.push(`- 產生時間：${payload.generatedAt}`);
  lines.push(`- 資料庫（唯讀）：${payload.scope.database}`);
  lines.push(`- 稽核報告：${payload.scope.audit ?? "（找不到）"}`);
  lines.push(`- 考慮題目：${payload.scope.questionsConsidered} 題（不含已停用）`);
  lines.push("");
  lines.push(
    "> 本文件把**不同性質**的問題分開列出。版權許可 ≠ 史實準確 ≠ 結構有效 ≠ 發布批准；任何一項完成都不代表其餘各項已完成。",
  );
  lines.push("");
  lines.push("| 分類 | 優先 | 負責 | 數量 |");
  lines.push("| --- | --- | --- | --- |");
  for (const category of payload.categories) {
    const count =
      category.count ?? (category.distribution ?? []).reduce((sum, entry) => sum + entry.count, 0);
    lines.push(`| ${category.description.slice(0, 40)} | ${category.priority} | ${category.owner} | ${count} |`);
  }
  lines.push("");

  for (const category of payload.categories) {
    lines.push(`## ${category.id}（${category.priority}）`);
    lines.push("");
    lines.push(category.description);
    lines.push("");
    if (category.count !== undefined) {
      lines.push(`數量：**${category.count}**`);
      lines.push("");
    }
    if (category.byTopic) {
      lines.push("| 課題 | 題數 |");
      lines.push("| --- | --- |");
      for (const entry of category.byTopic) lines.push(`| ${entry.key} | ${entry.count} |`);
      lines.push("");
    }
    if (category.values) {
      lines.push("| 知識點 | 題數 |");
      lines.push("| --- | --- |");
      for (const entry of category.values) lines.push(`| ${entry.key} | ${entry.count} |`);
      lines.push("");
    }
    if (category.id === "historical-concerns" && category.items) {
      lines.push("| 題目 ID | 觀察 | 為何需要教師 |");
      lines.push("| --- | --- | --- |");
      for (const item of category.items) {
        lines.push(`| ${item.questionId} | ${item.observation} | ${item.whyTeacher} |`);
      }
      lines.push("");
      lines.push("以上項目全部維持 `NEEDS_HISTORY_TEACHER_REVIEW`，**未有**任何裁決。");
      lines.push("");
    }
    if (category.id === "difficulty-metadata-flat" && category.distribution) {
      lines.push("| 難度 | 題數 |");
      lines.push("| --- | --- |");
      for (const entry of category.distribution) lines.push(`| ${entry.key} | ${entry.count} |`);
      lines.push("");
    }
    if (category.id === "copyright-and-distribution" && category.totals) {
      lines.push(
        `教材 ${category.totals.documents} 份：可向學生發布 ${category.totals.studentDistributionOn} 份、不可 ${category.totals.studentDistributionOff} 份、未記錄版權確認 ${category.totals.rightsNotRecorded} 份。`,
      );
      lines.push("");
      lines.push("| 教材 | 狀態 | 版權確認 | 引用它的題目 |");
      lines.push("| --- | --- | --- | --- |");
      for (const document of category.documentsWithoutStudentDistribution ?? []) {
        lines.push(
          `| ${document.fileName} | ${document.status} | ${document.rightsConfirmedAt ?? "未記錄"} | ${document.publishedQuestionsReferencing} |`,
        );
      }
      lines.push("");
    }
    if (category.questionIds) {
      lines.push(
        `<details><summary>完整題目 ID（${category.questionIds.length}）</summary>`,
      );
      lines.push("");
      lines.push(category.questionIds.join("、"));
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
  }

  fs.writeFileSync(outMd, `${lines.join("\n")}\n`, "utf8");

  console.log(`已讀取資料庫（唯讀）：${path.relative(repo, databasePath)}`);
  for (const category of payload.categories) {
    const count = category.count ?? "—";
    console.log(`- ${category.id}: ${count}`);
  }
  console.log(`已寫入：${path.relative(repo, outJson)}`);
  console.log(`已寫入：${path.relative(repo, outMd)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
