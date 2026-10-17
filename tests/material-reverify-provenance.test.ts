/**
 * R-1 迴歸測試（Sprint 7.7）：教材匯入後的「重新定位教材依據」不可令匯入試題的
 * 來源標註（試題檔名及題號）成為學生可見的來源位置。
 *
 * 背景：`reverifyUnverifiedQuestions` 原本寫入
 * `sourceLocation: best.sourceLocation || question.sourceLocation`。若相符的教材段落
 * **沒有來源位置**，就會回退沿用題目原有的來源標註——匯入試題的來源標註正是試題檔的
 * 檔名及題號。Sprint 7.7 改為：沒有可用來源位置的段落一律**不可**作為依據（不連結），
 * 題目維持「未通過教材依據核對」，學生端依 fail-closed 政策不顯示節錄及來源位置。
 *
 * 全部使用合成資料（合成試題文字、合成 DOCX、合成段落），不涉及任何真實教材或學生資料。
 */
import { beforeAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { openDocumentForStudents } from "./material-distribution";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("reverify-provenance");
process.env.LLM_PROVIDER = "mock";
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_TEACHER_EMAILS = "teacher@example.com";
process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
delete process.env.ADMIN_TOKEN;
delete process.env.K_SERVICE;

type ImportService = typeof import("@/server/materials/import-service");
type MaterialsRepo = typeof import("@/server/repositories/materials");
type PracticeService = typeof import("@/server/services/practice-service");
type QuestionBankImportService = typeof import("@/server/services/question-bank-import-service");
type QuestionRepo = typeof import("@/server/repositories/questions");
type SeedModule = typeof import("@/server/seed");
type SourceVisibility = typeof import("@/server/services/source-visibility");

let importService: ImportService;
let materialsRepo: MaterialsRepo;
let practice: PracticeService;
let bankImport: QuestionBankImportService;
let questions: QuestionRepo;
let seed: SeedModule;
let sourceVisibility: SourceVisibility;

/** 合成試題檔名（只在測試資料庫使用；檔名帶 .MCQ. 標記以判定題型） */
const BANK_FILE = "SYNTH_QB_T1_1.MCQ.docx";
/** 被匯入的合成教材檔名（與下方放有測試段落的文件**不同名**，否則匯入會取代該文件） */
const LESSON_FILE = "合成匯入教材.docx";
let documentSequence = 0;

const BANK_TEXT = `選擇題
A. 合成單元
[[SYNTHMCQ00001
哪一項是合成測試的第一條問題？
@O
甲項
乙項
丙項
丁項
❒
##
A
@@
{{}}
d:0;
t:mc; nil:1
]]
[[SYNTHMCQ00002
哪一項是合成測試的第二條問題？
@O
戊項
己項
庚項
辛項
❒
##
A
@@
{{}}
d:0;
t:mc; nil:1
]]
[[SYNTHMCQ00003
哪一項是合成測試的第三條問題？
@O
壬項
癸項
子項
丑項
❒
##
A
@@
{{}}
d:0;
t:mc; nil:1
]]`;

/** 建立最小但合法的 DOCX（只含段落文字），用於觸發教材匯入及重新定位程序 */
async function buildSyntheticDocx(paragraphs: string[]): Promise<Buffer> {
  const escapeXml = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${paragraphs
  .map(
    (paragraph) =>
      `<w:p><w:r><w:t xml:space="preserve">${escapeXml(paragraph)}</w:t></w:r></w:p>`,
  )
  .join("")}
</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

/** 建立一個合成教材文件及一個段落（可指定來源位置，空字串代表沒有來源位置） */
function createSyntheticBlock(options: { text: string; sourceLocation: string }) {
  documentSequence += 1;
  const document = materialsRepo.createDocument({
    // 每次用不同檔名：同名文件會被「重新匯入」取代（連同段落一併刪除），令測試失去意義
    fileName: `合成來源教材 ${documentSequence}.docx`,
    kind: "demo",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 1024,
    status: "ready",
    topicId: "topic-1",
    sourceNote: "合成測試教材",
  });
  const blocks = materialsRepo.insertBlocks([
    {
      documentId: document.id,
      topicId: "topic-1",
      sectionId: "topic-1-origins",
      order: 0,
      type: "paragraph",
      level: null,
      text: options.text,
      table: null,
      sourceLocation: options.sourceLocation,
    },
  ]);
  return { document, blockId: blocks[0]!.id };
}

/** 匯入一份合成教材，觸發 `reverifyUnverifiedQuestions` */
async function importSyntheticLesson(paragraphs: string[]) {
  const buffer = await buildSyntheticDocx(paragraphs);
  return importService.importMaterial({
    fileName: LESSON_FILE,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: buffer.length,
    buffer,
    topicId: "topic-1",
    kind: "demo",
    sourceNote: "合成測試教材",
  });
}

/**
 * 建立一條「未通過核對」的合成題目（供最短節錄長度的迴歸測試使用）。
 *
 * `sourceLocation` 由呼叫端指定：含被匯入的檔名時會一併經過 `reverifyQuestionsForDocument`，
 * 不含時只會經由 `reverifyUnverifiedQuestions`。
 */
function createSyntheticQuestionForLesson(options: {
  excerpt: string;
  sourceLocation: string;
  origin?: "material-ai" | "demo";
}) {
  documentSequence += 1;
  return questions.insertQuestion({
    id: `q-excerpt-${documentSequence}`,
    topicId: "topic-1",
    sectionId: "topic-1-origins",
    questionType: "mc",
    difficulty: "basic",
    question: "合成問題：古人類最早出現於哪一洲？",
    options: ["非洲", "亞洲", "歐洲", "美洲"],
    correctAnswer: "非洲",
    acceptedAnswers: [],
    explanation: "合成解釋：教材指出古人類於非洲出現。",
    knowledgePoint: "合成知識點",
    sourceExcerpt: options.excerpt,
    sourceLocation: options.sourceLocation,
    sourceBlockIds: [],
    gradingPoints: [],
    origin: options.origin ?? "material-ai",
    status: "published",
    sourceVerified: false,
    skill: null,
    qualityWarnings: [],
    autoValidatedAt: null,
    autoValidatedRevision: null,
    autoValidatedFingerprint: null,
    teacherConfirmationRequired: false,
    revision: 1,
    createdAt: new Date().toISOString(),
  });
}

beforeAll(async () => {
  importService = await import("@/server/materials/import-service");
  materialsRepo = await import("@/server/repositories/materials");
  practice = await import("@/server/services/practice-service");
  bankImport = await import("@/server/services/question-bank-import-service");
  questions = await import("@/server/repositories/questions");
  seed = await import("@/server/seed");
  sourceVisibility = await import("@/server/services/source-visibility");
  seed.ensureBootstrap();
});

describe("教材匯入後的重新定位不可外洩試題檔的來源標註", () => {
  it("候選段落沒有來源位置時不會連結，學生端維持 fail-closed", async () => {
    const imported = bankImport.importQuestionBank({
      topicId: "topic-1",
      fileName: BANK_FILE,
      text: BANK_TEXT,
    });
    expect(imported.imported).toBe(3);

    const first = questions.getQuestion("qb-SYNTHMCQ00001");
    expect(first).not.toBeNull();
    expect(first?.sourceBlockIds).toEqual([]);
    expect(first?.sourceLocation).toContain(BANK_FILE);

    // 合成段落：文字與試題節錄相同，但**沒有來源位置**
    const { blockId: emptyLocationBlockId } = createSyntheticBlock({
      text: first!.sourceExcerpt,
      sourceLocation: "",
    });

    await importSyntheticLesson(["合成教材的課文內容，與試題無關。"]);

    // 非空洞檢查：該段落必須仍然存在，而且文字確實包含題目節錄（符合「相符段落」條件），
    // 否則「沒有連結」可能只是因為段落不存在或文字不符，而不是新規則生效。
    const survivor = materialsRepo
      .listBlocksByTopic("topic-1")
      .find((block) => block.id === emptyLocationBlockId);
    expect(survivor).toBeDefined();
    expect(survivor!.sourceLocation.trim()).toBe("");
    expect(survivor!.text).toContain(first!.sourceExcerpt);

    const after = questions.getQuestion("qb-SYNTHMCQ00001");
    // 沒有可用來源位置的段落不可作為依據 → 不連結
    expect(after?.sourceBlockIds).toEqual([]);
    expect(after?.sourceVerified).toBe(false);
    // 題目本身的來源標註不會被改寫成該段落
    expect(after?.sourceLocation).toContain(BANK_FILE);

    // 學生端：fail-closed（沒有可核對的來源）
    const visibility = sourceVisibility.studentExcerptVisibility(after!);
    expect(visibility.visible).toBe(false);
    expect(visibility.reason).toBe("unverified-source");

    const feedback = practice.buildFeedback(after!, "甲項", null);
    expect(feedback.sourceWithheld).toBe(true);
    expect(feedback.sourceExcerpt).toBeNull();
    expect(feedback.sourceLocation).toBeNull();
    // 學生可見的回饋中不可出現試題檔名或題號
    const payload = JSON.stringify(feedback);
    expect(payload).not.toContain(BANK_FILE);
    expect(payload).not.toContain("第 1 題");
  });

  it("有來源位置的相符段落會正確連結，來源位置改為教材位置（不是試題檔）", async () => {
    const second = questions.getQuestion("qb-SYNTHMCQ00002");
    expect(second).not.toBeNull();
    expect(second?.sourceBlockIds).toEqual([]);

    const { document, blockId } = createSyntheticBlock({
      text: second!.sourceExcerpt,
      sourceLocation: "合成教材 第 2 段",
    });

    await importSyntheticLesson(["合成教材的另一段課文，同樣與試題無關。"]);

    // 非空洞檢查：來源段落仍然存在，且文字包含題目節錄
    const survivor = materialsRepo
      .listBlocksByTopic("topic-1")
      .find((block) => block.id === blockId);
    expect(survivor).toBeDefined();
    expect(survivor!.text).toContain(second!.sourceExcerpt);

    const after = questions.getQuestion("qb-SYNTHMCQ00002");
    expect(after?.sourceBlockIds).toEqual([blockId]);
    expect(after?.sourceVerified).toBe(true);
    expect(after?.sourceLocation).toBe("合成教材 第 2 段");
    expect(after?.sourceLocation).not.toContain(BANK_FILE);

    // 匯入試題連結後仍然不發布：發布關卡不受影響（題目維持草稿）
    expect(after?.status).toBe("draft");
    expect(after?.revision).toBeGreaterThan(1);

    // 來源文件未確認可向學生發布 → 仍然不顯示節錄
    const hidden = sourceVisibility.studentExcerptVisibility(after!);
    expect(hidden.visible).toBe(false);
    expect(hidden.reason).toBe("unconfirmed-material");
    expect(practice.buildFeedback(after!, "戊項", null).sourceWithheld).toBe(true);

    // 管理員確認發行權後，來源位置顯示的是教材位置（不是試題檔名）
    openDocumentForStudents(materialsRepo, document.id);
    const shown = practice.buildFeedback(after!, "戊項", null);
    expect(shown.sourceWithheld).toBe(false);
    expect(shown.sourceLocation).toBe("合成教材 第 2 段");
    expect(JSON.stringify(shown)).not.toContain(BANK_FILE);
    expect(JSON.stringify(shown)).not.toContain("第 2 題");

    // 撤回發行權後即時再次停止顯示
    materialsRepo.setDocumentStudentDistribution(document.id, false);
    const revoked = practice.buildFeedback(after!, "戊項", null);
    expect(revoked.sourceWithheld).toBe(true);
    expect(revoked.sourceLocation).toBeNull();
  });

  it("沒有來源位置的段落也不會「競爭贏」有來源位置的段落", async () => {
    // 題目同時符合兩個段落：較短但沒有來源位置 vs 較長但有來源位置。
    // 沒有來源位置者不可被選中，因此結果必定使用有來源位置的那一段。
    const target = questions.getQuestion("qb-SYNTHMCQ00003");
    expect(target).not.toBeNull();
    expect(target?.sourceBlockIds).toEqual([]);
    const excerpt = target!.sourceExcerpt;

    const whitespaceOnly = createSyntheticBlock({ text: excerpt, sourceLocation: "   " });
    const valid = createSyntheticBlock({
      text: `${excerpt} 合成補充說明，令此段落較長。`,
      sourceLocation: "合成教材 第 3 段",
    });

    await importSyntheticLesson(["合成教材的第三段課文。"]);

    // 兩個來源段落都仍然存在（非空洞檢查）
    const blocks = materialsRepo.listBlocksByTopic("topic-1");
    expect(blocks.some((block) => block.id === whitespaceOnly.blockId)).toBe(true);
    expect(blocks.some((block) => block.id === valid.blockId)).toBe(true);

    const after = questions.getQuestion("qb-SYNTHMCQ00003");
    expect(after?.sourceBlockIds).toEqual([valid.blockId]);
    expect(after?.sourceLocation).toBe("合成教材 第 3 段");
  });
});

describe("最短節錄長度是自動連結的統一規則（2026-10-17 統一）", () => {
  it("低於最短長度的節錄不會經由重新定位變成已核對（兩個自動路徑）", async () => {
    // 兩條獨立的合成課文，各自對應一條短節錄題目；來源位置分別「不含」及「含」被匯入的檔名，
    // 令兩條題目分別只會經過 `reverifyUnverifiedQuestions` 及 `reverifyQuestionsForDocument`。
    const shortA = "合成短語甲";
    const shortB = "合成短語乙丙";
    expect(shortA.length).toBeLessThan(8);
    expect(shortB.length).toBeLessThan(8);

    const questionA = createSyntheticQuestionForLesson({
      excerpt: shortA,
      sourceLocation: "合成來源（不含教材檔名，短節錄甲）",
    });
    const questionB = createSyntheticQuestionForLesson({
      excerpt: shortB,
      sourceLocation: `${LESSON_FILE} · 合成合成段落（短節錄乙）`,
    });

    // 匯入含有這兩段短文字的教材：段落確實存在且逐字包含節錄
    await importSyntheticLesson([`合成課文：${shortA} 是本次測試的短語。`, `${shortB} 也是本次測試的短語。`]);

    // 非空洞檢查：兩個候選段落都存在，而且文字逐字包含節錄
    const blocks = materialsRepo.listBlocksByTopic("topic-1");
    for (const [excerpt, label] of [
      [shortA, "短節錄甲"],
      [shortB, "短節錄乙"],
    ] as const) {
      expect(blocks.some((block) => block.text.includes(excerpt)), label).toBe(true);
    }

    for (const [question, label] of [
      [questionA, "短節錄甲"],
      [questionB, "短節錄乙"],
    ] as const) {
      const after = questions.getQuestion(question.id)!;
      // 短片段會在無關段落中出現，不可自動連結 → 維持未通過核對
      expect(after.sourceBlockIds, label).toEqual([]);
      expect(after.sourceVerified, label).toBe(false);
      // 學生端維持 fail-closed（節錄不是作者撰寫的來源）
      const visibility = sourceVisibility.studentExcerptVisibility(after);
      expect(visibility.visible, label).toBe(false);
      expect(visibility.reason, label).toBe("unverified-source");
    }
  });

  it("達到最短長度的節錄仍會正常連結（非空洞對照組）", async () => {
    const long = "合成長句：古人類於非洲出現並向各地遷徙。";
    expect(long.length).toBeGreaterThanOrEqual(8);
    const question = createSyntheticQuestionForLesson({
      excerpt: long,
      sourceLocation: `${LESSON_FILE} · 合成合成段落（長節錄）`,
    });

    await importSyntheticLesson([`合成課文甲：${long}`, "合成課文乙：與本題無關的內容。"]);

    const after = questions.getQuestion(question.id)!;
    expect(after.sourceVerified).toBe(true);
    expect(after.sourceBlockIds).toHaveLength(1);
    const block = materialsRepo
      .listBlocksByTopic("topic-1")
      .find((candidate) => candidate.id === after.sourceBlockIds[0]);
    expect(block).toBeDefined();
    // 連結到的段落必須逐字包含節錄（非空洞：不是「有連結就算通過」）
    expect(block!.text).toContain(long);
    expect(block!.sourceLocation).toContain(LESSON_FILE);
  });

  it("作者撰寫的節錄（示範題庫）不受最短長度限制：短標籤仍會定位到教材段落", async () => {
    const label = "合成短標籤"; // 5 字
    expect(label.length).toBeLessThan(8);
    const question = createSyntheticQuestionForLesson({
      excerpt: label,
      sourceLocation: "示範題庫（未能自動核對教材位置）",
      origin: "demo",
    });

    await importSyntheticLesson([`合成課文：${label} 是本題的來源標註。`]);

    const after = questions.getQuestion(question.id)!;
    // 示範題庫的 sourceAnchor 本身就是作者提供的來源標註，程式只負責定位
    expect(after.sourceVerified).toBe(true);
    expect(after.sourceBlockIds).toHaveLength(1);
    const block = materialsRepo
      .listBlocksByTopic("topic-1")
      .find((candidate) => candidate.id === after.sourceBlockIds[0]);
    expect(block).toBeDefined();
    expect(block!.text).toContain(label);
  });
});
