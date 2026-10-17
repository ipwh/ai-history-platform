/**
 * 「教材依據重新連結清單」的驗證與套用（Sprint 8.2）。
 *
 * 兩部分：
 *   1. **清單本身的檢查**：版本控制內的清單必須符合 schema、題目 ID 不重複、
 *      每條都有逐字節錄及核對理由，而且仍然覆蓋 2026-10 教材更新的那 30 條。
 *   2. **套用器的行為**：以合成題目及段落驗證
 *      － 逐字不符即不套用（不做相似度判斷）；
 *      － 題目內容指紋不符（教師改過）或狀態非清單預期時不套用；
 *      － 重複執行第二次為 no-op（版本號不變）；
 *      － 清單同時把同一段落列為主要及相關段落時，不會寫入重複的引用段落；
 *      － 不建立任何人工覆核紀錄；
 *      － 目標文件未開放時，`requireOpenDocuments` 會擋下。
 *
 * 全部使用合成資料；真實清單只讀取檔案（不連接資料庫）。
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("reference-remapping");
process.env.LLM_PROVIDER = "mock";
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_TEACHER_EMAILS = "teacher@example.com";
process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
delete process.env.ADMIN_TOKEN;
delete process.env.K_SERVICE;

type MaterialsRepo = typeof import("@/server/repositories/materials");
type QuestionRepo = typeof import("@/server/repositories/questions");
type RemappingModule = typeof import("@/server/materials/reference-remapping");
type SeedModule = typeof import("@/server/seed");

let materialsRepo: MaterialsRepo;
let questions: QuestionRepo;
let remapping: RemappingModule;
let seed: SeedModule;

const SECTION_ID = "topic-1-origins";
/** 2026-10 教材更新後重新連結的 30 條題目（清單必須仍然覆蓋全部） */
const EXPECTED_QUESTION_IDS = [
  "q_07336d3a018348ab",
  "q_1132db41064a45e3",
  "q_1331bde8275c449f",
  "q_163e9008f57d4378",
  "q_173bce5a718349ce",
  "q_20081c1ba3fa4021",
  "q_2972fc745e3c4d0f",
  "q_54b270c73d464baf",
  "q_56260c5e1fb043bb",
  "q_56c24cb665fa4653",
  "q_6fa6d4aa5f154b18",
  "q_703652ade8524504",
  "q_70b9fd416134442e",
  "q_750b4d351bf64529",
  "q_77e7395afb2d42b7",
  "q_79f94b7fc7ad464b",
  "q_8282065385794559",
  "q_837a4dab89fa408e",
  "q_9c91cecb7b6849dc",
  "q_a2ab34d608954a57",
  "q_a2c7b14c18284a6a",
  "q_abdfcbab69fe49cc",
  "q_b6a855e95b7d4495",
  "q_ba04d2b1595d444e",
  "q_bc07aba8dba34840",
  "q_bcee6ef4211f4729",
  "q_bebc1e60e12f4034",
  "q_c1f8b48892644a55",
  "q_dc813d90c4c647d5",
  "q_e70c615a65ef4bbc",
];

const MANIFEST_PATH = path.join("docs", "material-remapping", "2026-10-material-refresh.json");

let documentSequence = 0;

/** 建立合成教材文件及段落 */
function createSyntheticDocument(text: string, sourceNote: string) {
  documentSequence += 1;
  const document = materialsRepo.createDocument({
    fileName: `合成清單教材 ${documentSequence}.docx`,
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

/** 建立合成題目（引用指定段落） */
function createSyntheticQuestion(options: {
  blockId: string | null;
  excerpt: string;
  sourceLocation: string;
}) {
  documentSequence += 1;
  return questions.insertQuestion({
    id: `q-remap-${documentSequence}`,
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
    sourceBlockIds: options.blockId ? [options.blockId] : [],
    gradingPoints: [],
    origin: "material-ai",
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

/** 由題目及目標段落建立清單條目（與真實清單同一 schema） */
function buildEntry(questionId: string, blockId: string, excerpt: string, sourceLocation: string) {
  const question = questions.getQuestion(questionId)!;
  return {
    questionId,
    topicId: question.topicId,
    sectionId: question.sectionId,
    questionType: question.questionType,
    documentFileName: sourceLocation.split("·")[0]!.trim(),
    blockIds: [blockId],
    sourceLocation,
    excerpt,
    contentFingerprint: remapping.remappingContentFingerprint(question),
    rationale: `合成理由：${excerpt}`,
    verifiedAt: "2026-10-16",
    verification: "逐字比對",
    previous: {
      excerpt: question.sourceExcerpt,
      sourceLocation: question.sourceLocation,
      blockIds: question.sourceBlockIds,
      revision: question.revision,
      status: question.status,
    },
  };
}

function buildManifest(entries: unknown[]) {
  return {
    version: 1 as const,
    title: "合成清單",
    purpose: "測試用",
    sourceMaterials: "合成教材",
    generatedFrom: { database: "synthetic", previousState: "synthetic", generatedAt: "2026-10-16" },
    entries,
  };
}

beforeAll(async () => {
  materialsRepo = await import("@/server/repositories/materials");
  questions = await import("@/server/repositories/questions");
  remapping = await import("@/server/materials/reference-remapping");
  seed = await import("@/server/seed");
  seed.ensureBootstrap();
});

describe("2026-10 教材依據重新連結清單（檔案本身）", () => {
  it("符合 schema、覆蓋 30 條題目，且每條都有逐字節錄與核對理由", () => {
    const raw = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as unknown;
    const manifest = remapping.remappingManifestSchema.parse(raw);

    const ids = manifest.entries.map((entry) => entry.questionId);
    expect([...ids].sort()).toEqual([...EXPECTED_QUESTION_IDS].sort());
    expect(new Set(ids).size).toBe(ids.length);

    for (const entry of manifest.entries) {
      expect(entry.excerpt.trim().length).toBeGreaterThanOrEqual(remapping.MIN_EXCERPT_LENGTH);
      expect(entry.rationale.trim().length).toBeGreaterThan(0);
      expect(entry.blockIds.length).toBeGreaterThan(0);
      expect(new Set(entry.blockIds).size).toBe(entry.blockIds.length);
      // 重新連結必須真的改變依據，否則不必列入清單
      expect(entry.excerpt).not.toBe(entry.previous.excerpt);
      // 來源位置必須指向清單所列的文件
      expect(entry.sourceLocation.split("·")[0]!.trim()).toBe(entry.documentFileName);
    }
  });
});

describe("清單套用器（合成資料）", () => {
  it("第一次套用、第二次略過，且不建立任何人工覆核紀錄", () => {
    const target = createSyntheticDocument("合成新教材：古人類於非洲出現，其後遷徙至亞洲及歐洲。", "合成新教材");
    const older = createSyntheticDocument("合成舊教材已經不同的課文內容。", "合成舊教材");
    materialsRepo.recordDocumentGovernance({
      documentId: target.document.id,
      rights: { confirmedBy: "test-admin@example.com", at: new Date().toISOString() },
    });
    materialsRepo.setDocumentStudentDistribution(target.document.id, true);

    const question = createSyntheticQuestion({
      blockId: older.blockId,
      excerpt: "合成舊節錄的文字內容。",
      sourceLocation: `${older.document.fileName} · 第 1 段（段落）`,
    });
    const entry = buildEntry(
      question.id,
      target.blockId,
      "古人類於非洲出現，其後遷徙至亞洲及歐洲。",
      `${target.document.fileName} · 第 1 段（段落）`,
    );
    const manifest = remapping.remappingManifestSchema.parse(buildManifest([entry]));

    const first = remapping.applyRemappingManifest(manifest);
    expect(first.applied).toBe(1);
    expect(first.failed).toBe(0);

    const afterFirst = questions.getQuestion(question.id)!;
    expect(afterFirst.sourceExcerpt).toBe(entry.excerpt);
    expect(afterFirst.sourceBlockIds).toEqual([target.blockId]);
    expect(afterFirst.sourceVerified).toBe(true);
    expect(afterFirst.revision).toBe(question.revision + 1);
    // 題目內容（指紋）不變——清單不可改動學生作答相關欄位
    expect(remapping.remappingContentFingerprint(afterFirst)).toBe(entry.contentFingerprint);
    // 沒有建立任何人工覆核紀錄
    expect(questions.listQuestionReviews(question.id, 10)).toHaveLength(0);

    const second = remapping.applyRemappingManifest(manifest);
    expect(second.alreadyApplied).toBe(1);
    expect(second.applied).toBe(0);
    expect(questions.getQuestion(question.id)!.revision).toBe(afterFirst.revision);
  });

  it("模擬模式只報告，不寫入", () => {
    const target = createSyntheticDocument("合成新教材：古人類源自非洲大陸。", "合成新教材（模擬）");
    const older = createSyntheticDocument("合成舊教材的另一段課文。", "合成舊教材（模擬）");
    const question = createSyntheticQuestion({
      blockId: older.blockId,
      excerpt: "合成舊節錄（模擬）。",
      sourceLocation: `${older.document.fileName} · 第 1 段（段落）`,
    });
    const entry = buildEntry(
      question.id,
      target.blockId,
      "古人類源自非洲大陸。",
      `${target.document.fileName} · 第 1 段（段落）`,
    );
    const manifest = remapping.remappingManifestSchema.parse(buildManifest([entry]));

    const report = remapping.applyRemappingManifest(manifest, { dryRun: true });
    expect(report.planned).toBe(1);
    expect(report.applied).toBe(0);
    const after = questions.getQuestion(question.id)!;
    expect(after.revision).toBe(question.revision);
    expect(after.sourceVerified).toBe(false);
    expect(after.sourceExcerpt).toBe(question.sourceExcerpt);
  });

  it("節錄只有相似而非逐字時不套用", () => {
    const target = createSyntheticDocument("合成新教材：古人類於非洲出現。", "合成新教材（近似）");
    const older = createSyntheticDocument("合成舊教材的另一段課文內容。", "合成舊教材（近似）");
    const question = createSyntheticQuestion({
      blockId: older.blockId,
      excerpt: "合成舊節錄（近似）。",
      sourceLocation: `${older.document.fileName} · 第 1 段（段落）`,
    });
    // 只差一個字：不是逐字內容
    const entry = buildEntry(
      question.id,
      target.blockId,
      "古人類於美洲出現。",
      `${target.document.fileName} · 第 1 段（段落）`,
    );
    const manifest = remapping.remappingManifestSchema.parse(buildManifest([entry]));

    const report = remapping.applyRemappingManifest(manifest);
    expect(report.failed).toBe(1);
    expect(report.results[0]!.detail).toContain("逐字");
    const after = questions.getQuestion(question.id)!;
    expect(after.revision).toBe(question.revision);
    expect(after.sourceVerified).toBe(false);
  });

  it("題目內容指紋不符（教師已改過題目）時不套用", () => {
    const target = createSyntheticDocument("合成新教材：古人類於非洲出現，其後遷徙。", "合成新教材（指紋）");
    const older = createSyntheticDocument("合成舊教材的課文內容（指紋）。", "合成舊教材（指紋）");
    const question = createSyntheticQuestion({
      blockId: older.blockId,
      excerpt: "合成舊節錄（指紋）。",
      sourceLocation: `${older.document.fileName} · 第 1 段（段落）`,
    });
    const entry = buildEntry(
      question.id,
      target.blockId,
      "古人類於非洲出現，其後遷徙。",
      `${target.document.fileName} · 第 1 段（段落）`,
    );
    const manifest = remapping.remappingManifestSchema.parse(buildManifest([entry]));

    // 教師改了題幹（內容指紋改變）
    const edited = { ...questions.getQuestion(question.id)!, question: "合成問題（教師已修改）：古人類最早出現於哪一洲？" };
    questions.updateQuestion(edited.id, edited);

    const report = remapping.applyRemappingManifest(manifest);
    expect(report.failed).toBe(1);
    expect(report.results[0]!.detail).toContain("指紋");
    expect(questions.getQuestion(question.id)!.sourceVerified).toBe(false);
  });

  it("題目狀態與清單記載的套用前狀態不符時不套用", () => {
    const target = createSyntheticDocument("合成新教材：古人類於非洲出現，並向各地遷徙。", "合成新教材（狀態）");
    const older = createSyntheticDocument("合成舊教材的課文內容（狀態）。", "合成舊教材（狀態）");
    const question = createSyntheticQuestion({
      blockId: older.blockId,
      excerpt: "合成舊節錄（狀態）。",
      sourceLocation: `${older.document.fileName} · 第 1 段（段落）`,
    });
    const entry = buildEntry(
      question.id,
      target.blockId,
      "古人類於非洲出現，並向各地遷徙。",
      `${target.document.fileName} · 第 1 段（段落）`,
    );
    const manifest = remapping.remappingManifestSchema.parse(buildManifest([entry]));

    // 教師已自行把依據改到另一個段落（既非清單的套用前狀態，亦非目標狀態）
    const other = createSyntheticDocument("合成教師自行指定的段落內容。", "合成教師指定教材");
    const moved = {
      ...questions.getQuestion(question.id)!,
      sourceBlockIds: [other.blockId],
      sourceLocation: `${other.document.fileName} · 第 1 段（段落）`,
    };
    questions.updateQuestion(moved.id, moved);

    const report = remapping.applyRemappingManifest(manifest);
    expect(report.failed).toBe(1);
    expect(report.results[0]!.detail).toContain("套用前狀態");
    expect(questions.getQuestion(question.id)!.sourceBlockIds).toEqual([other.blockId]);
  });

  it("清單條目的段落 ID 不在此資料庫時，改用檔名＋位置字串定位（跨資料庫重現）", () => {
    const target = createSyntheticDocument("合成新教材：古人類於非洲出現，並向亞洲遷徙。", "合成新教材（跨資料庫）");
    const older = createSyntheticDocument("合成舊教材的課文內容（跨資料庫）。", "合成舊教材（跨資料庫）");
    const question = createSyntheticQuestion({
      blockId: older.blockId,
      excerpt: "合成舊節錄（跨資料庫）。",
      sourceLocation: `${older.document.fileName} · 第 1 段（段落）`,
    });
    const entry = buildEntry(
      question.id,
      target.blockId,
      "古人類於非洲出現，並向亞洲遷徙。",
      `${target.document.fileName} · 第 1 段（段落）`,
    );
    // 模擬另一個資料庫：清單記載的段落 ID 不存在，但檔名及位置字串仍然對得上
    const foreignEntry = {
      ...entry,
      blockIds: ["blk_other_database_only"],
    };
    const manifest = remapping.remappingManifestSchema.parse(buildManifest([foreignEntry]));

    const report = remapping.applyRemappingManifest(manifest);
    expect(report.applied).toBe(1);
    const after = questions.getQuestion(question.id)!;
    expect(after.sourceBlockIds).toEqual([target.blockId]);
    expect(after.sourceExcerpt).toBe(foreignEntry.excerpt);
    expect(after.sourceVerified).toBe(true);
  });

  it("清單同時把同一段落列為主要及相關段落時，寫入不重複且第二次為 no-op", () => {
    const target = createSyntheticDocument(
      "合成新教材：古人類於非洲出現，並向亞洲及歐洲遷徙。",
      "合成新教材（重複段落）",
    );
    const older = createSyntheticDocument("合成舊教材的課文內容（重複段落）。", "合成舊教材（重複段落）");
    const question = createSyntheticQuestion({
      blockId: older.blockId,
      excerpt: "合成舊節錄（重複段落）。",
      sourceLocation: `${older.document.fileName} · 第 1 段（段落）`,
    });
    const location = `${target.document.fileName} · 第 1 段（段落）`;
    const entry = buildEntry(question.id, target.blockId, "古人類於非洲出現，並向亞洲及歐洲遷徙。", location);
    const manifest = remapping.remappingManifestSchema.parse(
      buildManifest([
        {
          ...entry,
          // 真實清單由產生器寫入時，同一段落可能同時出現在 blockIds 及相關定位之中
          relatedBlockLocators: [
            { documentFileName: target.document.fileName, sourceLocation: location },
          ],
        },
      ]),
    );

    const first = remapping.applyRemappingManifest(manifest);
    expect(first.applied).toBe(1);
    expect(first.failed).toBe(0);

    const after = questions.getQuestion(question.id)!;
    // 重複的段落 ID 會令 getBlocksByIds 的長度與 ID 數目不符，學生端依 fail-closed 不顯示節錄
    expect(after.sourceBlockIds).toEqual([target.blockId]);
    expect(new Set(after.sourceBlockIds).size).toBe(after.sourceBlockIds.length);
    expect(after.sourceVerified).toBe(true);

    const second = remapping.applyRemappingManifest(manifest);
    expect(second.alreadyApplied).toBe(1);
    expect(second.applied).toBe(0);
    expect(second.failed).toBe(0);
    expect(questions.getQuestion(question.id)!.revision).toBe(after.revision);
  });

  it("已套用的題目其後由另一份清單更新用詞時，重複執行仍為 no-op（不誤報指紋不符）", () => {
    const target = createSyntheticDocument("合成新教材：古人類於非洲出現，其後向各地遷徙。", "合成新教材（重複執行）");
    const older = createSyntheticDocument("合成舊教材的課文內容（重複執行）。", "合成舊教材（重複執行）");
    const question = createSyntheticQuestion({
      blockId: older.blockId,
      excerpt: "合成舊節錄（重複執行）。",
      sourceLocation: `${older.document.fileName} · 第 1 段（段落）`,
    });
    const entry = buildEntry(
      question.id,
      target.blockId,
      "古人類於非洲出現，其後向各地遷徙。",
      `${target.document.fileName} · 第 1 段（段落）`,
    );
    const manifest = remapping.remappingManifestSchema.parse(buildManifest([entry]));
    expect(remapping.applyRemappingManifest(manifest).applied).toBe(1);
    const linked = questions.getQuestion(question.id)!;

    // 之後由「用詞對齊」清單更新題目文字（教材依據不變）——真實流程的第 3b 步
    questions.updateQuestion(linked.id, { ...linked, question: "合成問題（已統一用詞）：古人類最早出現於哪一洲？" });
    const refreshed = questions.getQuestion(question.id)!;

    const repeat = remapping.applyRemappingManifest(manifest);
    expect(repeat.alreadyApplied).toBe(1);
    expect(repeat.failed).toBe(0);
    expect(questions.getQuestion(question.id)!.revision).toBe(refreshed.revision);

    // 但若題目仍未套用，指紋不符仍必須擋下（清單不可覆寫教師已改過的題目）
    const other = createSyntheticDocument("合成新教材：另一段課文內容（指紋次序）。", "合成新教材（指紋次序）");
    const pending = createSyntheticQuestion({
      blockId: other.blockId,
      excerpt: "合成未套用節錄（指紋次序）。",
      sourceLocation: `${other.document.fileName} · 第 1 段（段落）`,
    });
    const pendingEntry = buildEntry(
      pending.id,
      target.blockId,
      "古人類於非洲出現，其後向各地遷徙。",
      `${target.document.fileName} · 第 1 段（段落）`,
    );
    const pendingManifest = remapping.remappingManifestSchema.parse(buildManifest([pendingEntry]));
    questions.updateQuestion(pending.id, { ...questions.getQuestion(pending.id)!, explanation: "合成解釋（教師已修改）。" });
    const blocked = remapping.applyRemappingManifest(pendingManifest);
    expect(blocked.failed).toBe(1);
    expect(blocked.results[0]!.detail).toContain("指紋");
  });

  it("以位置解析時，同一位置對應多個段落即視為歧義並拒絕套用", () => {
    // 兩份同名文件（模擬匯入重複），令同一來源位置字串對應兩個段落
    const target = createSyntheticDocument("合成新教材：古人類於非洲出現，並向亞洲遷徙。", "合成新教材（歧義）");
    const duplicateLocation = `${target.document.fileName} · 第 1 段（段落）`;
    materialsRepo.insertBlocks([
      {
        documentId: target.document.id,
        topicId: "topic-1",
        sectionId: SECTION_ID,
        order: 1,
        type: "paragraph",
        level: null,
        text: "合成新教材：古人類於非洲出現，並向亞洲遷徙。（重複段落）",
        table: null,
        sourceLocation: duplicateLocation,
      },
    ]);
    const older = createSyntheticDocument("合成舊教材的課文內容（歧義）。", "合成舊教材（歧義）");
    const question = createSyntheticQuestion({
      blockId: older.blockId,
      excerpt: "合成舊節錄（歧義）。",
      sourceLocation: `${older.document.fileName} · 第 1 段（段落）`,
    });
    const entry = buildEntry(
      question.id,
      target.blockId,
      "古人類於非洲出現，並向亞洲遷徙。",
      duplicateLocation,
    );
    const manifest = remapping.remappingManifestSchema.parse(
      buildManifest([
        {
          ...entry,
          // 清單記載的段落 ID 不在此資料庫 → 以檔名＋位置解析 → 命中兩個段落
          blockIds: ["blk_other_database_only"],
        },
      ]),
    );

    const report = remapping.applyRemappingManifest(manifest);
    expect(report.failed).toBe(1);
    expect(report.results[0]!.detail).toContain("歧義");
    const after = questions.getQuestion(question.id)!;
    expect(after.sourceVerified).toBe(false);
    expect(after.sourceBlockIds).toEqual([older.blockId]);
    expect(after.revision).toBe(question.revision);
  });

  it("目標位置在此資料庫完全找不到時拒絕套用（不會改用相似段落）", () => {
    const target = createSyntheticDocument("合成新教材：另一段完全不同的課文。", "合成新教材（找不到位置）");
    const older = createSyntheticDocument("合成舊教材的課文內容（找不到位置）。", "合成舊教材（找不到位置）");
    const question = createSyntheticQuestion({
      blockId: older.blockId,
      excerpt: "合成舊節錄（找不到位置）。",
      sourceLocation: `${older.document.fileName} · 第 1 段（段落）`,
    });
    const entry = buildEntry(
      question.id,
      target.blockId,
      "古人類於非洲出現，並向亞洲遷徙。",
      `${target.document.fileName} · 第 999 段（段落）`,
    );
    const manifest = remapping.remappingManifestSchema.parse(
      buildManifest([{ ...entry, blockIds: ["blk_other_database_only"] }]),
    );

    const report = remapping.applyRemappingManifest(manifest);
    expect(report.failed).toBe(1);
    expect(report.results[0]!.detail).toContain("找不到");
    expect(questions.getQuestion(question.id)!.sourceVerified).toBe(false);
  });

  it("目標文件未開放給學生時，requireOpenDocuments 會擋下", () => {
    const target = createSyntheticDocument("合成新教材：古人類於非洲出現，再向亞洲遷徙。", "合成新教材（未開放）");
    const older = createSyntheticDocument("合成舊教材的課文內容（未開放）。", "合成舊教材（未開放）");
    const question = createSyntheticQuestion({
      blockId: older.blockId,
      excerpt: "合成舊節錄（未開放）。",
      sourceLocation: `${older.document.fileName} · 第 1 段（段落）`,
    });
    const entry = buildEntry(
      question.id,
      target.blockId,
      "古人類於非洲出現，再向亞洲遷徙。",
      `${target.document.fileName} · 第 1 段（段落）`,
    );
    const manifest = remapping.remappingManifestSchema.parse(buildManifest([entry]));

    const blocked = remapping.applyRemappingManifest(manifest, { requireOpenDocuments: true });
    expect(blocked.failed).toBe(1);
    expect(blocked.results[0]!.detail).toContain("尚未開放");
    expect(questions.getQuestion(question.id)!.sourceVerified).toBe(false);

    const allowed = remapping.applyRemappingManifest(manifest);
    expect(allowed.applied).toBe(1);
  });
});
