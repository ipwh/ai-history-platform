/**
 * 「題目修正動作清單」套用器（Sprint 8.2 後續）。
 *
 * 兩部分：
 *   1. **清單檔本身**：36 條隊列清單（31 改寫、5 刪除）覆蓋隊列全部題目；23 條用詞對齊清單
 *      每條都有理由與指紋；改寫條目的證據必須是逐字節錄（長度下限）。
 *   2. **套用器行為**（合成資料）：改寫後節錄逐字成立、重複執行為 no-op、指紋不符不套用、
 *      非逐字節錄不套用、同一段落不會被重複引用、刪除可重複執行、模擬模式不寫入、
 *      `requireOpenDocuments` 擋下未開放的證據段落，而且**不建立任何人工覆核紀錄**。
 *
 * 全部使用合成教材／題目；真實清單只讀取檔案（不連接資料庫）。
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { openDocumentForStudents } from "./material-distribution";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("question-queue-actions");
process.env.LLM_PROVIDER = "mock";
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_TEACHER_EMAILS = "teacher@example.com";
process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
delete process.env.ADMIN_TOKEN;
delete process.env.K_SERVICE;

type MaterialsRepo = typeof import("@/server/repositories/materials");
type QuestionRepo = typeof import("@/server/repositories/questions");
type QueueModule = typeof import("@/server/materials/question-queue-actions");
type SeedModule = typeof import("@/server/seed");

let materialsRepo: MaterialsRepo;
let questions: QuestionRepo;
let queue: QueueModule;
let seed: SeedModule;

const SECTION_ID = "topic-1-stone-age";
const QUEUE_MANIFEST = path.join(
  "docs",
  "teacher-review",
  "question-queue-actions-2026-10.json",
);
const WORDING_MANIFEST = path.join(
  "docs",
  "material-remapping",
  "2026-10-wording-alignment.json",
);

let sequence = 0;

function createSyntheticDocument(text: string, sourceNote: string) {
  sequence += 1;
  const document = materialsRepo.createDocument({
    fileName: `合成隊列教材 ${sequence}.docx`,
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
  return { document, blockId: blocks[0]!.id, sourceLocation: `${document.fileName} · 第 1 段（段落）` };
}

function createSyntheticQuestion(options: {
  blockId: string;
  excerpt: string;
  sourceLocation: string;
  status?: "published" | "draft";
}) {
  sequence += 1;
  return questions.insertQuestion({
    id: `q-queue-${sequence}`,
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
    sourceExcerpt: options.excerpt,
    sourceLocation: options.sourceLocation,
    sourceBlockIds: [options.blockId],
    gradingPoints: [],
    origin: "material-ai",
    status: options.status ?? "published",
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
}

function buildManifest(entries: unknown[]) {
  return {
    version: 1 as const,
    title: "合成隊列清單",
    purpose: "測試用",
    sourceMaterials: "合成教材",
    generatedFrom: { database: "synthetic", generatedAt: "2026-10-16" },
    entries,
  };
}

/** 建立一條改寫項目的清單條目（指紋由目前題目計算） */
function rewriteEntry(options: {
  questionId: string;
  content: Record<string, unknown>;
  evidence: Record<string, unknown>;
  relatedLocators?: { documentFileName: string; sourceLocation: string }[];
}) {
  const question = questions.getQuestion(options.questionId)!;
  // resultFingerprint 是「套用後」的內容指紋：套用器以它判斷是否已套用（重複執行為 no-op）
  const resultFingerprint = queue.questionFingerprintFor({
    ...question,
    ...(options.content as Record<string, never>),
  });
  return {
    questionId: options.questionId,
    action: "rewrite" as const,
    topicId: question.topicId,
    sectionId: question.sectionId,
    questionType: question.questionType,
    beforeFingerprint: queue.questionFingerprintFor(question),
    beforeExcerpt: question.sourceExcerpt,
    beforeSourceLocation: question.sourceLocation,
    content: options.content,
    evidence: { relatedExcerpts: [], relatedLocators: [], ...options.evidence },
    resultFingerprint,
    reason: "合成理由：新教材有相關內容。",
  };
}

beforeAll(async () => {
  materialsRepo = await import("@/server/repositories/materials");
  questions = await import("@/server/repositories/questions");
  queue = await import("@/server/materials/question-queue-actions");
  seed = await import("@/server/seed");
  seed.ensureBootstrap();
});

describe("修正動作清單（檔案本身）", () => {
  it("36 條隊列清單覆蓋隊列全部題目，且改寫條目都有逐字節錄與理由", () => {
    const manifest = queue.queueActionManifestSchema.parse(
      JSON.parse(fs.readFileSync(QUEUE_MANIFEST, "utf8")) as unknown,
    );
    const decisionQueue = JSON.parse(
      fs.readFileSync(
        path.join("docs", "teacher-review", "material-decision-queue-2026-10.json"),
        "utf8",
      ),
    ) as { entries: { questionId: string }[] };

    const covered = new Set(manifest.entries.map((entry) => entry.questionId));
    expect(covered.size).toBe(36);
    for (const entry of decisionQueue.entries) {
      expect(covered.has(entry.questionId)).toBe(true);
    }

    const rewrites = manifest.entries.filter((entry) => entry.action === "rewrite");
    const deletes = manifest.entries.filter((entry) => entry.action === "delete");
    expect(rewrites).toHaveLength(31);
    expect(deletes).toHaveLength(5);
    for (const entry of rewrites) {
      if (entry.action !== "rewrite") continue;
      expect(entry.evidence.excerpt.trim().length).toBeGreaterThanOrEqual(queue.MIN_EXCERPT_LENGTH);
      expect(entry.reason.length).toBeGreaterThan(10);
      expect(entry.evidence.blockIds.length).toBeGreaterThan(0);
    }
    for (const entry of deletes) {
      expect(entry.reason.length).toBeGreaterThan(10);
      // 刪除前內容記錄在清單內，令刪除決定可稽核（不必依賴資料庫備份）
      if (entry.action !== "delete") continue;
      expect((entry.beforeQuestion ?? "").length).toBeGreaterThan(4);
      expect((entry.beforeCorrectAnswer ?? "").length).toBeGreaterThan(1);
    }
  });

  it("用詞對齊清單有 23 條，且每條都記錄理由與指紋", () => {
    const manifest = queue.queueActionManifestSchema.parse(
      JSON.parse(fs.readFileSync(WORDING_MANIFEST, "utf8")) as unknown,
    );
    expect(manifest.entries).toHaveLength(23);
    for (const entry of manifest.entries) {
      expect(entry.action).toBe("rewrite-content");
      if (entry.action !== "rewrite-content") continue;
      expect(entry.beforeFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.resultFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.beforeFingerprint).not.toBe(entry.resultFingerprint);
      expect(entry.reason.length).toBeGreaterThan(10);
    }
  });
  it("課題1 校內試題的教材依據連結清單：10 條、全部為 link-evidence、只改依據", () => {
    const manifest = queue.queueActionManifestSchema.parse(
      JSON.parse(
        fs.readFileSync(
          path.join("docs", "teacher-review", "school-paper-evidence-links-2026-10.json"),
          "utf8",
        ),
      ) as unknown,
    );
    expect(manifest.entries).toHaveLength(10);
    for (const entry of manifest.entries) {
      expect(entry.action).toBe("link-evidence");
      if (entry.action !== "link-evidence") continue;
      expect(entry.evidence.excerpt.trim().length).toBeGreaterThanOrEqual(queue.MIN_EXCERPT_LENGTH);
      expect(entry.evidence.blockIds).toHaveLength(1);
      expect(entry.beforeExcerpt).toContain("@");
      expect(entry.beforeExcerpt).not.toBe(entry.evidence.excerpt);
      expect(entry.reason).toContain("逐字");
    }
  });
});

describe("修正動作清單套用器（合成資料）", () => {
  it("link-evidence：證據位置對應多個段落時拒絕套用（歧義）", () => {
    const source = createSyntheticDocument("合成試卷：合成題幹文字（3分）", "合成試卷（歧義）");
    const location = source.sourceLocation;
    materialsRepo.insertBlocks([
      {
        documentId: source.document.id,
        topicId: "topic-1",
        sectionId: SECTION_ID,
        order: 1,
        type: "paragraph",
        level: null,
        text: "合成題幹文字（3分）（重複段落）",
        table: null,
        sourceLocation: location,
      },
    ]);
    const question = createSyntheticQuestion({
      blockId: source.blockId,
      excerpt: "合成舊節錄（歧義）。",
      sourceLocation: `${source.document.fileName} · 第 9 題`,
    });
    const entry = {
      questionId: question.id,
      action: "link-evidence" as const,
      topicId: question.topicId,
      sectionId: question.sectionId,
      questionType: question.questionType,
      beforeFingerprint: queue.questionFingerprintFor(question),
      beforeExcerpt: question.sourceExcerpt,
      beforeSourceLocation: question.sourceLocation,
      evidence: {
        blockIds: ["blk_other_database_only"],
        documentFileName: source.document.fileName,
        sourceLocation: location,
        excerpt: "合成題幹文字（3分）",
        relatedLocators: [],
        relatedExcerpts: [],
      },
      reason: "合成理由：測試歧義位置。",
    };
    const report = queue.applyQuestionQueueActions(
      queue.queueActionManifestSchema.parse(buildManifest([entry])),
    );
    expect(report.failed).toBe(1);
    expect(report.results[0]!.detail).toContain("歧義");
    expect(questions.getQuestion(question.id)!.sourceExcerpt).toBe(question.sourceExcerpt);
  });

  it("link-evidence：只修正教材依據，題目內容不變、第二次為 no-op", () => {
    const source = createSyntheticDocument("合成試卷：合成題幹文字（3分）", "合成試卷");
    const question = createSyntheticQuestion({
      blockId: source.blockId,
      excerpt: "合成題幹文字（3分）\n@O",
      sourceLocation: `${source.document.fileName} · 第 1 題`,
    });
    // 先手動清空引用（模擬從未連結的校內試題）
    questions.updateQuestion(question.id, {
      ...questions.getQuestion(question.id)!,
      sourceBlockIds: [],
      sourceVerified: false,
    });
    const cleared = questions.getQuestion(question.id)!;

    const entry = {
      questionId: question.id,
      action: "link-evidence" as const,
      topicId: cleared.topicId,
      sectionId: cleared.sectionId,
      questionType: cleared.questionType,
      beforeFingerprint: queue.questionFingerprintFor(cleared),
      beforeExcerpt: cleared.sourceExcerpt,
      beforeSourceLocation: cleared.sourceLocation,
      evidence: {
        blockIds: [source.blockId],
        documentFileName: source.document.fileName,
        sourceLocation: source.sourceLocation,
        excerpt: "合成題幹文字（3分）",
        relatedLocators: [],
        relatedExcerpts: [],
      },
      reason: "合成理由：節錄帶有匯入標記，改為逐字題幹並連結段落。",
    };
    const manifest = queue.queueActionManifestSchema.parse(buildManifest([entry]));

    const first = queue.applyQuestionQueueActions(manifest);
    expect(first.applied).toBe(1);
    const after = questions.getQuestion(question.id)!;
    expect(after.sourceExcerpt).toBe("合成題幹文字（3分）");
    expect(after.sourceBlockIds).toEqual([source.blockId]);
    expect(after.sourceVerified).toBe(true);
    expect(after.question).toBe(cleared.question);
    expect(after.options).toEqual(cleared.options);
    expect(after.revision).toBe(cleared.revision + 1);

    const second = queue.applyQuestionQueueActions(manifest);
    expect(second.alreadyApplied).toBe(1);
    expect(questions.getQuestion(question.id)!.revision).toBe(after.revision);
  });

  it("link-evidence：新節錄不是目標段落的逐字內容時不套用", () => {
    const source = createSyntheticDocument("合成試卷：另一段題幹文字。", "合成試卷（不逐字）");
    const question = createSyntheticQuestion({
      blockId: source.blockId,
      excerpt: "合成舊節錄（不逐字）。",
      sourceLocation: `${source.document.fileName} · 第 2 題`,
    });
    const entry = {
      questionId: question.id,
      action: "link-evidence" as const,
      topicId: question.topicId,
      sectionId: question.sectionId,
      questionType: question.questionType,
      beforeFingerprint: queue.questionFingerprintFor(question),
      beforeExcerpt: question.sourceExcerpt,
      beforeSourceLocation: question.sourceLocation,
      evidence: {
        blockIds: [source.blockId],
        documentFileName: source.document.fileName,
        sourceLocation: source.sourceLocation,
        excerpt: "這個節錄不在任何段落之中。",
        relatedLocators: [],
        relatedExcerpts: [],
      },
      reason: "合成理由：測試逐字驗證。",
    };
    const report = queue.applyQuestionQueueActions(
      queue.queueActionManifestSchema.parse(buildManifest([entry])),
    );
    expect(report.failed).toBe(1);
    expect(report.results[0]!.detail).toContain("逐字");
    expect(questions.getQuestion(question.id)!.sourceExcerpt).toBe(question.sourceExcerpt);
  });
  it("改寫：第一次套用、第二次略過，節錄逐字成立且版本號遞增", () => {
    const target = createSyntheticDocument("合成新教材：古人類於非洲出現，並向亞洲遷徙。", "合成新教材");
    const older = createSyntheticDocument("合成舊教材：無關的舊課文內容。", "合成舊教材");
    materialsRepo.recordDocumentGovernance({
      documentId: target.document.id,
      rights: { confirmedBy: "test-admin@example.com", at: new Date().toISOString() },
    });
    materialsRepo.setDocumentStudentDistribution(target.document.id, true);
    const question = createSyntheticQuestion({
      blockId: older.blockId,
      excerpt: "合成舊節錄的內容。",
      sourceLocation: older.sourceLocation,
    });
    const entry = rewriteEntry({
      questionId: question.id,
      content: {
        question: "合成新問題：古人類最早出現於哪一洲？（新教材版）",
        correctAnswer: "非洲",
        explanation: "教材：古人類於非洲出現。",
      },
      evidence: {
        blockIds: [target.blockId],
        documentFileName: target.document.fileName,
        sourceLocation: target.sourceLocation,
        excerpt: "古人類於非洲出現，並向亞洲遷徙。",
      },
    });
    const manifest = queue.queueActionManifestSchema.parse(buildManifest([entry]));

    const first = queue.applyQuestionQueueActions(manifest);
    expect(first.applied).toBe(1);
    const afterFirst = questions.getQuestion(question.id)!;
    expect(afterFirst.sourceVerified).toBe(true);
    expect(afterFirst.sourceExcerpt).toBe("古人類於非洲出現，並向亞洲遷徙。");
    expect(afterFirst.sourceBlockIds).toEqual([target.blockId]);
    expect(afterFirst.revision).toBe(question.revision + 1);
    expect(questions.listQuestionReviews(question.id, 10)).toHaveLength(0);

    const second = queue.applyQuestionQueueActions(manifest);
    expect(second.alreadyApplied).toBe(1);
    expect(questions.getQuestion(question.id)!.revision).toBe(afterFirst.revision);
  });

  it("改寫：清單同時列出主要及相關段落時不會重複引用同一段落", () => {
    const target = createSyntheticDocument("合成新教材：古人類於非洲出現，其後遷徙至亞洲。", "合成新教材（重複引用）");
    const older = createSyntheticDocument("合成舊教材：另一段無關課文。", "合成舊教材（重複引用）");
    const question = createSyntheticQuestion({
      blockId: older.blockId,
      excerpt: "合成舊節錄（重複引用）。",
      sourceLocation: older.sourceLocation,
    });
    const entry = rewriteEntry({
      questionId: question.id,
      content: { question: "合成問題（重複引用）：古人類最早出現於哪一洲？" },
      // 清單把主要段落同時放在 blockIds 及 relatedLocators，並重複列出
      relatedLocators: [
        { documentFileName: target.document.fileName, sourceLocation: target.sourceLocation },
      ],
      evidence: {
        blockIds: [target.blockId, target.blockId],
        documentFileName: target.document.fileName,
        sourceLocation: target.sourceLocation,
        excerpt: "古人類於非洲出現，其後遷徙至亞洲。",
      },
    });
    const manifest = queue.queueActionManifestSchema.parse(buildManifest([entry]));

    const report = queue.applyQuestionQueueActions(manifest);
    expect(report.applied).toBe(1);
    const after = questions.getQuestion(question.id)!;
    // 同一段落只可出現一次，否則「引用段落數目」與實際段落數目不符，學生端會 fail-closed
    expect(after.sourceBlockIds).toEqual([target.blockId]);
  });

  it("改寫：節錄不是逐字內容或段落 ID／位置都對不上時不套用", () => {
    const target = createSyntheticDocument("合成新教材：古人類於非洲出現。", "合成新教材（不逐字）");
    const older = createSyntheticDocument("合成舊教材：無關課文。", "合成舊教材（不逐字）");
    const question = createSyntheticQuestion({
      blockId: older.blockId,
      excerpt: "合成舊節錄（不逐字）。",
      sourceLocation: older.sourceLocation,
    });
    const similar = rewriteEntry({
      questionId: question.id,
      content: { question: "合成問題（不逐字）：古人類最早出現於哪一洲？" },
      evidence: {
        blockIds: [target.blockId],
        documentFileName: target.document.fileName,
        sourceLocation: target.sourceLocation,
        excerpt: "古人類於美洲出現。",
      },
    });
    const missing = { ...similar, evidence: { ...similar.evidence, blockIds: ["blk_not_here"] } };

    expect(
      queue.applyQuestionQueueActions(queue.queueActionManifestSchema.parse(buildManifest([similar])))
        .failed,
    ).toBe(1);
    expect(
      queue.applyQuestionQueueActions(queue.queueActionManifestSchema.parse(buildManifest([missing])))
        .failed,
    ).toBe(1);
    expect(questions.getQuestion(question.id)!.sourceBlockIds).toEqual([older.blockId]);
  });

  it("改寫：題目內容指紋不符（教師已改過）時不套用", () => {
    const target = createSyntheticDocument("合成新教材：古人類於非洲出現，並向各地遷徙。", "合成新教材（指紋）");
    const older = createSyntheticDocument("合成舊教材：無關課文（指紋）。", "合成舊教材（指紋）");
    const question = createSyntheticQuestion({
      blockId: older.blockId,
      excerpt: "合成舊節錄（指紋）。",
      sourceLocation: older.sourceLocation,
    });
    const entry = rewriteEntry({
      questionId: question.id,
      content: { question: "合成問題（指紋）：古人類最早出現於哪一洲？" },
      evidence: {
        blockIds: [target.blockId],
        documentFileName: target.document.fileName,
        sourceLocation: target.sourceLocation,
        excerpt: "古人類於非洲出現，並向各地遷徙。",
      },
    });
    const manifest = queue.queueActionManifestSchema.parse(buildManifest([entry]));

    // 教師先改了題幹
    const edited = { ...questions.getQuestion(question.id)!, question: "教師已修改的合成問題？" };
    questions.updateQuestion(edited.id, edited);

    const report = queue.applyQuestionQueueActions(manifest);
    expect(report.failed).toBe(1);
    expect(report.results[0]!.detail).toContain("指紋");
  });

  it("刪除：第一次刪除、第二次略過；內容已改時不刪除", () => {
    const older = createSyntheticDocument("合成舊教材：無關課文（刪除）。", "合成舊教材（刪除）");
    const question = createSyntheticQuestion({
      blockId: older.blockId,
      excerpt: "合成舊節錄（刪除）。",
      sourceLocation: older.sourceLocation,
    });
    const entry = {
      questionId: question.id,
      action: "delete" as const,
      topicId: question.topicId,
      sectionId: question.sectionId,
      questionType: question.questionType,
      beforeFingerprint: queue.questionFingerprintFor(question),
      reason: "合成理由：新教材沒有相關內容。",
    };
    const manifest = queue.queueActionManifestSchema.parse(buildManifest([entry]));

    expect(queue.applyQuestionQueueActions(manifest, { dryRun: true }).planned).toBe(1);
    expect(questions.getQuestion(question.id)).not.toBeNull();

    const applied = queue.applyQuestionQueueActions(manifest);
    expect(applied.deleted).toBe(1);
    expect(questions.getQuestion(question.id)).toBeNull();

    const again = queue.applyQuestionQueueActions(manifest);
    expect(again.alreadyApplied).toBe(1);
  });

  it("刪除：題目內容自清單產生後已改時，拒絕刪除", () => {
    const older = createSyntheticDocument("合成舊教材：無關課文（拒絕刪除）。", "合成舊教材（拒絕刪除）");
    const question = createSyntheticQuestion({
      blockId: older.blockId,
      excerpt: "合成舊節錄（拒絕刪除）。",
      sourceLocation: older.sourceLocation,
    });
    const entry = {
      questionId: question.id,
      action: "delete" as const,
      topicId: question.topicId,
      sectionId: question.sectionId,
      questionType: question.questionType,
      beforeFingerprint: queue.questionFingerprintFor(question),
      reason: "合成理由：新教材沒有相關內容。",
    };
    const manifest = queue.queueActionManifestSchema.parse(buildManifest([entry]));

    const edited = { ...questions.getQuestion(question.id)!, correctAnswer: "亞洲" };
    questions.updateQuestion(edited.id, edited);

    const report = queue.applyQuestionQueueActions(manifest);
    expect(report.failed).toBe(1);
    expect(questions.getQuestion(question.id)).not.toBeNull();
  });

  it("用詞對齊：只改內容、保留原有節錄與引用，且原節錄必須仍然逐字成立", () => {
    const source = createSyntheticDocument("合成教材：古人類於非洲出現，並向亞洲遷徙。", "合成教材（用詞）");
    materialsRepo.recordDocumentGovernance({
      documentId: source.document.id,
      rights: { confirmedBy: "test-admin@example.com", at: new Date().toISOString() },
    });
    openDocumentForStudents(materialsRepo, source.document.id);
    const question = createSyntheticQuestion({
      blockId: source.blockId,
      excerpt: "古人類於非洲出現，並向亞洲遷徙。",
      sourceLocation: source.sourceLocation,
    });
    const entry = {
      questionId: question.id,
      action: "rewrite-content" as const,
      topicId: question.topicId,
      sectionId: question.sectionId,
      questionType: question.questionType,
      beforeFingerprint: queue.questionFingerprintFor(question),
      content: { question: "合成問題（用詞對齊）：古人類最早出現於哪一洲？" },
      resultFingerprint: queue.questionFingerprintFor({
        ...question,
        question: "合成問題（用詞對齊）：古人類最早出現於哪一洲？",
      }),
      reason: "合成理由：用詞與新教材一致。",
    };
    const manifest = queue.queueActionManifestSchema.parse(buildManifest([entry]));

    const report = queue.applyQuestionQueueActions(manifest);
    expect(report.applied).toBe(1);
    const after = questions.getQuestion(question.id)!;
    expect(after.question).toBe("合成問題（用詞對齊）：古人類最早出現於哪一洲？");
    expect(after.sourceExcerpt).toBe(question.sourceExcerpt);
    expect(after.sourceBlockIds).toEqual([source.blockId]);
    expect(after.revision).toBe(question.revision + 1);

    // 節錄被改成引用段落沒有的文字時，拒絕套用
    const broken = { ...questions.getQuestion(question.id)!, sourceExcerpt: "引用段落沒有的文字內容。" };
    questions.updateQuestion(broken.id, broken);
    const secondContent = { question: "合成問題（用詞對齊第二次）：古人類最早出現於哪一洲？" };
    const again = queue.applyQuestionQueueActions(
      queue.queueActionManifestSchema.parse(
        buildManifest([
          {
            ...entry,
            beforeFingerprint: queue.questionFingerprintFor(broken),
            content: secondContent,
            resultFingerprint: queue.questionFingerprintFor({ ...broken, ...secondContent }),
          },
        ]),
      ),
    );
    expect(again.failed).toBe(1);
    expect(again.results[0]!.detail).toContain("逐字");
  });

  it("atomic（預設）：任何一條失敗時完全不寫入（避免只刪除、不改寫的半完成狀態）", () => {
    const target = createSyntheticDocument("合成新教材：古人類於非洲出現，並向亞洲遷徙。", "合成新教材（atomic）");
    const older = createSyntheticDocument("合成舊教材：無關課文（atomic）。", "合成舊教材（atomic）");
    const good = createSyntheticQuestion({
      blockId: older.blockId,
      excerpt: "合成舊節錄（atomic 好）。",
      sourceLocation: older.sourceLocation,
    });
    const doomed = createSyntheticQuestion({
      blockId: older.blockId,
      excerpt: "合成舊節錄（atomic 將刪除）。",
      sourceLocation: older.sourceLocation,
    });

    const goodEntry = rewriteEntry({
      questionId: good.id,
      content: { question: "合成問題（atomic）：古人類最早出現於哪一洲？" },
      evidence: {
        blockIds: [target.blockId],
        documentFileName: target.document.fileName,
        sourceLocation: target.sourceLocation,
        excerpt: "古人類於非洲出現，並向亞洲遷徙。",
      },
    });
    // 這條改寫的證據節錄不存在 → 失敗；同一清單內的刪除**不可**因此生效
    const badEntry = rewriteEntry({
      questionId: doomed.id,
      content: { question: "合成問題（atomic 失敗）：古人類最早出現於哪一洲？" },
      evidence: {
        blockIds: [target.blockId],
        documentFileName: target.document.fileName,
        sourceLocation: target.sourceLocation,
        excerpt: "這個節錄不存在於任何段落之中。",
      },
    });
    const manifest = queue.queueActionManifestSchema.parse(buildManifest([goodEntry, badEntry]));

    const report = queue.applyQuestionQueueActions(manifest, { atomic: true });
    expect(report.failed).toBe(1);
    expect(report.applied).toBe(0);
    // 兩條題目都沒有被改動
    expect(questions.getQuestion(good.id)!.sourceBlockIds).toEqual([older.blockId]);
    expect(questions.getQuestion(doomed.id)!.sourceBlockIds).toEqual([older.blockId]);

    // 明確關閉 atomic 時才容許部分套用
    const partial = queue.applyQuestionQueueActions(manifest, { atomic: false });
    expect(partial.applied).toBe(1);
    expect(partial.failed).toBe(1);
  });

  it("requireOpenDocuments 會擋下未開放文件中的證據段落", () => {
    const target = createSyntheticDocument("合成新教材：古人類於非洲出現，再向亞洲遷徙。", "合成未開放教材");
    const older = createSyntheticDocument("合成舊教材：無關課文（未開放）。", "合成舊教材（未開放）");
    const question = createSyntheticQuestion({
      blockId: older.blockId,
      excerpt: "合成舊節錄（未開放）。",
      sourceLocation: older.sourceLocation,
    });
    const entry = rewriteEntry({
      questionId: question.id,
      content: { question: "合成問題（未開放）：古人類最早出現於哪一洲？" },
      evidence: {
        blockIds: [target.blockId],
        documentFileName: target.document.fileName,
        sourceLocation: target.sourceLocation,
        excerpt: "古人類於非洲出現，再向亞洲遷徙。",
      },
    });
    const manifest = queue.queueActionManifestSchema.parse(buildManifest([entry]));

    const blocked = queue.applyQuestionQueueActions(manifest, { requireOpenDocuments: true });
    expect(blocked.failed).toBe(1);
    expect(blocked.results[0]!.detail).toContain("尚未開放");
    expect(questions.getQuestion(question.id)!.sourceBlockIds).toEqual([older.blockId]);

    const allowed = queue.applyQuestionQueueActions(manifest);
    expect(allowed.applied).toBe(1);
  });
});
