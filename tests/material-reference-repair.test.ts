/**
 * 迴歸測試：刪除／取代教材文件後，引用其段落的題目不可再被標示為「已核對教材依據」。
 *
 * 背景（2026-10-16 教材更新時發現）：`reverifyQuestionsForDocument` 只處理「來源位置字串
 * 包含重新匯入檔名」的題目，`reverifyUnverifiedQuestions` 只處理「本來就未通過核對」的題目。
 * 因此當舊教材以**不同檔名**被新教材取代、管理員其後刪除舊文件時，引用舊段落的題目會保留
 * `sourceVerified = true` 但段落 ID 已不存在——教師端顯示「已核對」、學生端卻沒有節錄，
 * 屬靜默失效（fail-open 的錯誤標示）。
 *
 * 修正：`repairQuestionsWithMissingBlocks` 在刪除文件後（`removeDocument`）及每次教材匯入後
 * 執行：找到相符段落就重新定位，找不到就標示為「未通過教材依據核對」。
 *
 * 全部使用合成資料（合成教材、合成題目），不涉及任何真實教材或學生資料。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { openDocumentForStudents } from "./material-distribution";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("material-reference-repair");
process.env.LLM_PROVIDER = "mock";
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_TEACHER_EMAILS = "teacher@example.com";
process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
delete process.env.ADMIN_TOKEN;
delete process.env.K_SERVICE;

type ImportService = typeof import("@/server/materials/import-service");
type MaterialService = typeof import("@/server/services/material-service");
type MaterialsRepo = typeof import("@/server/repositories/materials");
type PracticeRepo = typeof import("@/server/repositories/practice");
type QuestionRepo = typeof import("@/server/repositories/questions");
type SeedModule = typeof import("@/server/seed");
type SourceVisibility = typeof import("@/server/services/source-visibility");

let importService: ImportService;
let materialService: MaterialService;
let materialsRepo: MaterialsRepo;
let practiceRepo: PracticeRepo;
let questions: QuestionRepo;
let seed: SeedModule;
let sourceVisibility: SourceVisibility;

const SECTION_ID = "topic-1-origins";
let documentSequence = 0;

/**
 * 每條測試使用**不同**的課文，避免「本課題內仍有其他相符段落」令預期結果取決於測試次序。
 * 文字與生成題目的節錄相同（模擬生成題目逐字節錄教材）。
 */
function uniqueLessonText(label: string): string {
  documentSequence += 1;
  return `合成課文（${label}）：古人類於非洲出現，其後遷徙至亞洲及歐洲，這段敘述只用於第 ${documentSequence} 個合成情境。`;
}

/** 建立一份合成教材文件（kind = demo）並放入一段課文 */
function createSyntheticDocument(text: string, sourceNote: string) {
  documentSequence += 1;
  const document = materialsRepo.createDocument({
    fileName: `合成教材 ${documentSequence}.docx`,
    kind: "demo",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 1024,
    status: "ready",
    topicId: "topic-1",
    sourceNote,
  });
  const blocks = materialsRepo.insertBlocks([
    {
      documentId: document.id,
      topicId: "topic-1",
      sectionId: SECTION_ID,
      order: 0,
      type: "paragraph",
      level: null,
      text,
      table: null,
      sourceLocation: `${document.fileName} · 第 1 段（段落）`,
    },
  ]);
  return { document, blockId: blocks[0]!.id };
}

/** 建立一條引用指定段落的題目（模擬生成題目：節錄逐字取自該段落） */
function createSyntheticQuestion(
  blockId: string,
  sourceLocation: string,
  excerpt: string,
  origin: "material-ai" | "demo" = "material-ai",
) {
  documentSequence += 1;
  const question = questions.insertQuestion({
    id: `q-synth-${documentSequence}`,
    topicId: "topic-1",
    sectionId: SECTION_ID,
    questionType: "mc",
    difficulty: "basic",
    question: "合成問題：古人類最早出現於哪一洲？",
    options: ["非洲", "亞洲", "歐洲", "美洲"],
    correctAnswer: "非洲",
    acceptedAnswers: [],
    explanation: "合成解釋：教材指出古人類於非洲出現。",
    knowledgePoint: "合成知識點",
    sourceExcerpt: excerpt,
    sourceLocation,
    sourceBlockIds: [blockId],
    gradingPoints: [],
    origin,
    status: "published",
    sourceVerified: true,
    skill: null,
    qualityWarnings: [],
    autoValidatedAt: null,
    autoValidatedRevision: null,
    autoValidatedFingerprint: null,
    teacherConfirmationRequired: false,
    revision: 1,
    createdAt: new Date().toISOString(),
  });
  return question;
}

beforeAll(async () => {
  importService = await import("@/server/materials/import-service");
  materialService = await import("@/server/services/material-service");
  materialsRepo = await import("@/server/repositories/materials");
  practiceRepo = await import("@/server/repositories/practice");
  questions = await import("@/server/repositories/questions");
  seed = await import("@/server/seed");
  sourceVisibility = await import("@/server/services/source-visibility");
  seed.ensureBootstrap();
});

describe("刪除教材文件後的題目依據修復", () => {
  it("找不到相符段落時標示為未通過核對，且學生端看不到節錄", () => {
    const lessonText = uniqueLessonText("測試一");
    const { document, blockId } = createSyntheticDocument(lessonText, "合成舊教材");
    const question = createSyntheticQuestion(blockId, `${document.fileName} · 第 1 段（段落）`, lessonText);
    openDocumentForStudents(materialsRepo, document.id);

    // 前提：修正前學生看得到節錄（段落存在、文件已開放）
    expect(sourceVisibility.studentExcerptVisibility(questions.getQuestion(question.id)!).visible).toBe(
      true,
    );

    // 管理員刪除該文件：段落消失，且課題內沒有其他相符段落
    materialService.removeDocument(document.id);

    const after = questions.getQuestion(question.id)!;
    expect(after.sourceVerified).toBe(false);
    // 已不存在的引用會被剔除，因此學生端判定為「沒有可核對的來源」（fail-closed）
    expect(after.sourceBlockIds).toEqual([]);
    const visibility = sourceVisibility.studentExcerptVisibility(after);
    expect(visibility.visible).toBe(false);
    expect(visibility.reason).toBe("unverified-source");
  });

  it("課題內仍有相符段落時會重新定位，並保持已核對", () => {
    const lessonText = uniqueLessonText("測試二");
    const older = createSyntheticDocument(lessonText, "合成舊教材（將被刪除）");
    const replacement = createSyntheticDocument(lessonText, "合成新教材");
    openDocumentForStudents(materialsRepo, older.document.id);
    openDocumentForStudents(materialsRepo, replacement.document.id);

    const question = createSyntheticQuestion(
      older.blockId,
      `${older.document.fileName} · 第 1 段（段落）`,
      lessonText,
    );

    materialService.removeDocument(older.document.id);

    const after = questions.getQuestion(question.id)!;
    expect(after.sourceVerified).toBe(true);
    expect(after.sourceBlockIds).toEqual([replacement.blockId]);
    expect(after.sourceLocation).toContain(replacement.document.fileName);
    // 重新定位後學生端可以看到節錄（新文件已開放）
    expect(sourceVisibility.studentExcerptVisibility(after).visible).toBe(true);
  });

  it("匯入後的修復步驟不會把不相符的段落當作依據", () => {
    const lessonText = uniqueLessonText("測試三");
    const older = createSyntheticDocument(lessonText, "合成舊教材（匯入時修復）");
    const question = createSyntheticQuestion(
      older.blockId,
      `${older.document.fileName} · 第 1 段（段落）`,
      lessonText,
    );
    // 直接以資料庫層刪除文件（模擬其他路徑刪除文件後才匯入教材）
    materialsRepo.deleteDocument(older.document.id);
    expect(questions.getQuestion(question.id)!.sourceVerified).toBe(true);
    expect(questions.getQuestion(question.id)!.sourceBlockIds).toEqual([older.blockId]);

    const updated = createSyntheticDocument("合成教材的其他課文內容。", "合成新教材（匯入時修復）");
    const repair = importService.repairQuestionsWithMissingBlocks("topic-1");

    expect(repair.withheld).toBeGreaterThanOrEqual(1);
    const after = questions.getQuestion(question.id)!;
    expect(after.sourceVerified).toBe(false);
    // 不相符的段落不可被當作依據
    expect(after.sourceBlockIds).not.toContain(updated.blockId);
  });

  it("只有相似（非逐字）的段落時不連結，且保持未通過核對", () => {
    const lessonText = uniqueLessonText("測試四");
    const older = createSyntheticDocument(lessonText, "合成舊教材（近似段落）");
    const question = createSyntheticQuestion(
      older.blockId,
      `${older.document.fileName} · 第 1 段（段落）`,
      lessonText,
    );
    materialsRepo.deleteDocument(older.document.id);
    // 近似段落：與節錄只差一個字，但**不是**逐字內容
    const similar = lessonText.replace("非洲", "美洲");
    expect(similar).not.toBe(lessonText);
    expect(similar.includes(lessonText)).toBe(false);
    const nearMiss = createSyntheticDocument(similar, "合成近似教材");

    const repair = importService.repairQuestionsWithMissingBlocks("topic-1");

    expect(repair.withheld).toBeGreaterThanOrEqual(1);
    const after = questions.getQuestion(question.id)!;
    expect(after.sourceBlockIds).not.toContain(nearMiss.blockId);
    expect(after.sourceVerified).toBe(false);
    expect(after.revision).toBe(question.revision + 1);
  });

  it("節錄短於 8 字時不會連結到任何段落", () => {
    const older = createSyntheticDocument("合成教材：惡性循環的說法會出現在多個段落。", "合成舊教材（短節錄）");
    const question = createSyntheticQuestion(
      older.blockId,
      `${older.document.fileName} · 第 1 段（段落）`,
      "惡性循環", // 4 字：不足以辨識，不可作為依據
    );
    materialsRepo.deleteDocument(older.document.id);
    const containsShortExcerpt = createSyntheticDocument(
      "另一個段落也提到惡性循環的例子，但與題目無關。",
      "合成無關教材（短節錄）",
    );

    const repair = importService.repairQuestionsWithMissingBlocks("topic-1");

    expect(repair.withheld).toBeGreaterThanOrEqual(1);
    const after = questions.getQuestion(question.id)!;
    expect(after.sourceBlockIds).not.toContain(containsShortExcerpt.blockId);
    expect(after.sourceVerified).toBe(false);
    // 已不存在的引用一并剔除，教師端不會看到指向不存在段落的依據
    expect(after.sourceBlockIds).toEqual([]);
    // 重複執行不會再改動（已剔除、已標示未通過核對）
    const revision = after.revision;
    expect(importService.repairQuestionsWithMissingBlocks("topic-1").repointed).toBe(0);
    expect(questions.getQuestion(question.id)!.revision).toBe(revision);
  });

  it("作者撰寫的短節錄（示範題庫）在文件被取代後仍會重新定位，不受 8 字下限攔下", () => {
    const label = "合成短標籤"; // 5 字：低於最短長度
    expect(label.length).toBeLessThan(8);
    const older = createSyntheticDocument(`合成舊課文：${label} 是來源標註。`, "合成舊教材（短標籤）");
    const replacement = createSyntheticDocument(
      `合成新課文：${label} 仍然是來源標註。`,
      "合成新教材（短標籤）",
    );
    const question = createSyntheticQuestion(
      older.blockId,
      `${older.document.fileName} · 第 1 段（段落）`,
      label,
      "demo",
    );

    materialService.removeDocument(older.document.id);

    // 示範題庫的 sourceAnchor 本身就是作者提供的來源標註：程式只負責定位，不受 8 字下限限制。
    // 否則同一條題目會因走哪一條路徑而在已核對／未核對之間來回改變（2026-10-17 統一）。
    const after = questions.getQuestion(question.id)!;
    expect(after.sourceVerified).toBe(true);
    expect(after.sourceBlockIds).toEqual([replacement.blockId]);
    expect(after.sourceLocation).toContain(replacement.document.fileName);
    // 重新定位後「重複執行」不會再改動版本號
    const revision = after.revision;
    const repair = importService.repairQuestionsWithMissingBlocks("topic-1");
    expect(repair.repointed).toBe(0);
    expect(questions.getQuestion(question.id)!.revision).toBe(revision);
  });

  it("多數引用中只有部分失效時，剔除失效 ID 並保留仍支持的段落", () => {
    const lessonText = uniqueLessonText("測試五");
    const { document, blockId } = createSyntheticDocument(lessonText, "合成教材（多重引用）");
    openDocumentForStudents(materialsRepo, document.id);
    const question = createSyntheticQuestion(
      blockId,
      `${document.fileName} · 第 1 段（段落）`,
      lessonText,
    );
    // 人工加入一個已不存在的段落 ID（模擬另一個引用被刪除）
    const withDangling = { ...questions.getQuestion(question.id)!, sourceBlockIds: [blockId, "blk_missing_synthetic"] };
    questions.updateQuestion(withDangling.id, withDangling);

    // 修正前：引用包含不存在的段落 → 學生端 fail-closed（教師端仍顯示「已核對」）
    const beforeRepair = questions.getQuestion(question.id)!;
    expect(sourceVisibility.studentExcerptVisibility(beforeRepair).reason).toBe("missing-source-blocks");
    const revisionBefore = beforeRepair.revision;

    const repair = importService.repairQuestionsWithMissingBlocks("topic-1");

    expect(repair.pruned).toBeGreaterThanOrEqual(1);
    const after = questions.getQuestion(question.id)!;
    expect(after.sourceBlockIds).toEqual([blockId]);
    expect(after.sourceVerified).toBe(true);
    expect(after.revision).toBe(revisionBefore + 1);
    expect(sourceVisibility.studentExcerptVisibility(after).visible).toBe(true);
  });

  it("沒有需要改動的題目時完全不寫入（重複匯入不會令版本號遞增）", () => {
    const lessonText = uniqueLessonText("測試六");
    const { document, blockId } = createSyntheticDocument(lessonText, "合成教材（無需修復）");
    const question = createSyntheticQuestion(
      blockId,
      `${document.fileName} · 第 1 段（段落）`,
      lessonText,
    );
    // 課題內所有題目的版本號（包括先前測試留下的題目）：修復不應改動任何一條
    const revisionsBefore = new Map(
      questions.listQuestions({ topicId: "topic-1" }).map((item) => [item.id, item.revision]),
    );

    const first = importService.repairQuestionsWithMissingBlocks("topic-1");
    const second = importService.repairQuestionsWithMissingBlocks("topic-1");

    // 兩次結果完全相同（已未通過核對的題目不會被重複處理）
    expect(second).toEqual(first);
    const revisionsAfter = new Map(
      questions.listQuestions({ topicId: "topic-1" }).map((item) => [item.id, item.revision]),
    );
    expect(revisionsAfter).toEqual(revisionsBefore);
    const after = questions.getQuestion(question.id)!;
    expect(after.revision).toBe(revisionsBefore.get(question.id));
    expect(after.sourceBlockIds).toEqual([blockId]);
    expect(after.sourceVerified).toBe(true);
  });

  it("不會影響有效引用、發行稽核紀錄及既有學生作答", async () => {
    const lessonText = uniqueLessonText("測試七");    const { document, blockId } = createSyntheticDocument(lessonText, "合成教材（作答保護）");
    openDocumentForStudents(materialsRepo, document.id);
    const question = createSyntheticQuestion(
      blockId,
      `${document.fileName} · 第 1 段（段落）`,
      lessonText,
    );
    materialsRepo.recordDistributionChange({
      documentId: document.id,
      allowed: true,
      actorEmail: "test-admin@example.com",
      actorRole: "admin",
    });

    const practice = practiceRepo;
    const session = practice.createSession({
      learnerId: "synthetic-learner",
      topicId: "topic-1",
      sectionIds: [SECTION_ID],
      questionTypes: ["mc"],
      difficulty: "basic",
      mode: "standard",
      sourceSessionId: null,
      origin: "bank",
      questions: [questions.getQuestion(question.id)!],
      notice: null,
    });
    practice.saveAttempt({
      sessionId: session.id,
      questionId: question.id,
      learnerId: "synthetic-learner",
      answer: "非洲",
      autoGraded: true,
      isCorrect: true,
      questionRevision: question.revision,
    });

    const auditBefore = materialsRepo.listDistributionAudit(document.id, 50).length;
    const revisionBefore = questions.getQuestion(question.id)!.revision;

    // 刪除另一份**無關**文件（會觸發同一課題的修復流程）
    const unrelated = createSyntheticDocument("完全無關的課文內容，不包含任何題目節錄。", "合成無關教材");
    materialService.removeDocument(unrelated.document.id);

    const attempts = practice.listAttempts(session.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.answer).toBe("非洲");
    expect(attempts[0]!.questionRevision).toBe(question.revision);
    expect(attempts[0]!.isCorrect).toBe(true);
    expect(materialsRepo.listDistributionAudit(document.id, 50).length).toBe(auditBefore);
    const after = questions.getQuestion(question.id)!;
    expect(after.revision).toBe(revisionBefore);
    expect(after.sourceBlockIds).toEqual([blockId]);
    expect(after.sourceVerified).toBe(true);
  });
});

