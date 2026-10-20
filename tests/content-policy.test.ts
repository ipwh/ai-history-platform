/**
 * 教材內容政策測試：區分「課文」與「非課文內容」。
 *
 * 教師版課本（`HNC*_TE.docx`）除課文外還夾附資料題練習**及其評分參考**
 * （「（3分）」、「資料線索：」、「個人所知：」），匯入時亦會在圖片位置插入
 * `[[IMAGE_UNEXTRACTED]]`。這些內容不屬課文，部分更是答案，因此同一個判斷
 * （[content-policy.ts](../src/server/materials/content-policy.ts)）用於三處：
 *   1. 出題素材（不可作為出題依據）
 *   2. 題目來源節錄（不顯示）
 *   3. 學生端可用性計數（與出題素材一致，避免介面承諾做不到的出題）
 */
import { beforeAll, describe, expect, it } from "vitest";
import { openDocumentForStudents } from "./material-distribution";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("content-policy");
process.env.LLM_PROVIDER = "mock";

type ContentPolicy = typeof import("@/server/materials/content-policy");
type MaterialsRepo = typeof import("@/server/repositories/materials");
type MaterialUnits = typeof import("@/server/services/material-units");
type SourceVisibility = typeof import("@/server/services/source-visibility");
type Types = typeof import("@/lib/types");

let policy: ContentPolicy;
let materialsRepo: MaterialsRepo;
let materialUnits: MaterialUnits;
let sourceVisibility: SourceVisibility;
let types: Types;

const SECTION = "topic-5-renaissance-reformation";
const LESSON_TEXT = "文藝復興時期，歐洲人重視人文主義。";
const EXERCISE_TEXT = "根據以下資料，回答相關問題。（12分）";
const ANSWER_TEXT = "資料線索：資料A指出人文主義重視人的價值。（1分）";

beforeAll(async () => {
  policy = await import("@/server/materials/content-policy");
  materialsRepo = await import("@/server/repositories/materials");
  materialUnits = await import("@/server/services/material-units");
  sourceVisibility = await import("@/server/services/source-visibility");
  types = await import("@/lib/types");
  const seed = await import("@/server/seed");
  seed.ensureBootstrap();
});

describe("課文與非課文內容的判斷", () => {
  it("辨識練習題目及評分參考（分數標記、資料線索、個人所知、作答指令、作答空位）", () => {
    for (const text of [
      "根據以下資料，回答相關問題。（12分）",
      "試參考資料A及B，並就你所知，解釋這個說法。（7分）",
      "資料線索：資料B指出…",
      "個人所知：舊石器時代人類以敲擊方式製造石器。",
      "把代表答案的英文字母填在下列方格內。",
      "十九世紀的亞洲國家面對以下哪一項挑戰？＿＿＿＿＿＿",
      "不能。（1分）",
    ]) {
      expect(policy.isExerciseOrAnswerText(text), text).toBe(true);
    }
  });

  it("不會把課文誤判為練習題目", () => {
    for (const text of [
      LESSON_TEXT,
      "1919年，協約國與德國簽訂《凡爾賽條約》，德國須承擔戰爭責任。",
      "工業革命期間，工廠制度取代了家庭手工業制度，生產規模大幅提高。",
      "第二次世界大戰後，聯合國成立，以維持國際和平及安全。",
    ]) {
      expect(policy.isExerciseOrAnswerText(text), text).toBe(false);
    }
  });

  it("移除圖片佔位標記，並辨識只有年份／數字的碎片", () => {
    expect(policy.stripImageMarkers("約一萬二千年前展開[[IMAGE_UNEXTRACTED]]")).toBe(
      "約一萬二千年前展開",
    );
    expect(policy.isStandaloneNumberText("約公元前3,500年")).toBe(true);
    expect(policy.isStandaloneNumberText("4,000,000年")).toBe(true);
    expect(policy.isStandaloneNumberText("）")).toBe(true);
    expect(policy.isStandaloneNumberText("公元476年，西羅馬帝國滅亡。")).toBe(false);
    expect(policy.isStandaloneNumberText("文藝復興")).toBe(false);
  });

  it("OCR 雜散文字亦屬非課文內容", () => {
    expect(policy.isNonLessonContent("俄國\n德國\n況\n奧匈", { fromOcr: true })).toBe(true);
    // 同一段文字若不是 OCR 產生（例如表格欄位），不會單憑此判斷略去
    expect(policy.isNonLessonContent("俄國\n德國\n況\n奧匈", { fromOcr: false })).toBe(false);
  });
});

describe("非課文內容不會顯示、亦不會成為出題依據", () => {
  function createMixedDocument() {
    const document = materialsRepo.createDocument({
      fileName: "policy-check_TE.docx",
      kind: "demo",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 1024,
      status: "ready",
      topicId: "topic-5",
    });
    const blocks = materialsRepo.insertBlocks([
      {
        documentId: document.id,
        topicId: "topic-5",
        sectionId: SECTION,
        order: 1,
        type: "paragraph",
        text: LESSON_TEXT,
        sourceLocation: "測試教材 · 第 1 段（課文）",
      },
      {
        documentId: document.id,
        topicId: "topic-5",
        sectionId: SECTION,
        order: 2,
        type: "paragraph",
        text: EXERCISE_TEXT,
        sourceLocation: "測試教材 · 第 2 段（練習題目）",
      },
      {
        documentId: document.id,
        topicId: "topic-5",
        sectionId: SECTION,
        order: 3,
        type: "list",
        text: ANSWER_TEXT,
        sourceLocation: "測試教材 · 第 3 段（評分參考）",
      },
      {
        documentId: document.id,
        topicId: "topic-5",
        sectionId: SECTION,
        order: 4,
        type: "paragraph",
        text: "約公元前3,500年",
        sourceLocation: "測試教材 · 第 4 段（時間軸碎片）",
      },
      {
        documentId: document.id,
        topicId: "topic-5",
        sectionId: SECTION,
        order: 5,
        type: "paragraph",
        text: "[[IMAGE_UNEXTRACTED]]",
        sourceLocation: "測試教材 · 第 5 段（圖片）",
      },
    ]);
    openDocumentForStudents(materialsRepo, document.id);
    return { document, blockIds: blocks.map((block) => block.id) };
  }

  it("出題素材不會使用練習題目或評分參考（學生與教師生成皆然）", () => {
    const { document, blockIds } = createMixedDocument();
    try {
      for (const audience of ["student", "staff"] as const) {
        const units = materialUnits.buildMaterialUnits("topic-5", [SECTION], { audience });
        const texts = units.map((unit) => unit.text).join("\n");

        expect(texts, audience).toContain(LESSON_TEXT);
        expect(texts, audience).not.toContain("（12分）");
        expect(texts, audience).not.toContain("資料線索");
        expect(texts, audience).not.toContain("IMAGE_UNEXTRACTED");
        // 練習題目、評分參考及碎片段落都不會成為出題單位
        expect(units.some((unit) => blockIds.slice(1).includes(unit.blockId)), audience).toBe(false);
      }
    } finally {
      materialsRepo.deleteDocument(document.id);
    }
  });

  it("引用練習題目或評分參考的題目不會顯示來源節錄（附明確原因）", () => {
    const { document, blockIds } = createMixedDocument();
    try {
      const base = {
        id: "policy-excerpt-1",
        topicId: "topic-5",
        sectionId: SECTION,
        questionType: "fill" as const,
        difficulty: "basic" as const,
        question: "文藝復興時期歐洲人重視哪一種思想？",
        options: [],
        correctAnswer: "人文主義",
        acceptedAnswers: [],
        explanation: "教材指出文藝復興重視人文主義。",
        knowledgePoint: "文藝復興",
        sourceLocation: "測試教材 · 第 2 段（練習題目）",
        gradingPoints: [],
        origin: "material-ai" as const,
        status: "draft" as const,
        sourceVerified: true,
        createdAt: new Date().toISOString(),
      };

      // 課文 → 顯示
      const fromLesson = types.questionSchema.parse({
        ...base,
        sourceExcerpt: LESSON_TEXT,
        sourceBlockIds: [blockIds[0]],
      });
      expect(sourceVisibility.studentExcerptVisibility(fromLesson)).toEqual({
        visible: true,
        reason: null,
      });

      // 練習題目／評分參考 → 不顯示，並說明原因
      for (const blockId of [blockIds[1], blockIds[2]]) {
        const question = types.questionSchema.parse({
          ...base,
          sourceExcerpt: EXERCISE_TEXT,
          sourceBlockIds: [blockId],
        });
        expect(sourceVisibility.studentExcerptVisibility(question)).toEqual({
          visible: false,
          reason: "exercise-content",
        });
      }
    } finally {
      materialsRepo.deleteDocument(document.id);
    }
  });

  it("學生端可用性計數與出題素材一致：只有練習題目的話不可聲稱可出題", () => {
    const document = materialsRepo.createDocument({
      fileName: "exercise-only-policy_TE.docx",
      kind: "demo",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 1024,
      status: "ready",
      topicId: "topic-6",
    });
    materialsRepo.insertBlocks([
      {
        documentId: document.id,
        topicId: "topic-6",
        sectionId: "topic-6-methods-impact",
        order: 1,
        type: "paragraph",
        text: EXERCISE_TEXT,
        sourceLocation: "測試教材 · 第 1 段（練習題目）",
      },
      {
        documentId: document.id,
        topicId: "topic-6",
        sectionId: "topic-6-methods-impact",
        order: 2,
        type: "paragraph",
        text: ANSWER_TEXT,
        sourceLocation: "測試教材 · 第 2 段（評分參考）",
      },
    ]);
    openDocumentForStudents(materialsRepo, document.id);

    try {
      const counts = materialsRepo.studentMaterialBlockCounts("topic-6");
      // 教師可見的教材段落仍在（管理員端要看到），但學生可用數為 0
      const blocks = materialsRepo.listGroundingBlocksForSections("topic-6", ["topic-6-methods-impact"]);
      expect(blocks.length).toBeGreaterThan(0);
      expect(counts.get("topic-6-methods-impact") ?? 0).toBe(0);
      expect(materialUnits.buildMaterialUnits("topic-6", ["topic-6-methods-impact"], { audience: "student" })).toEqual(
        [],
      );
    } finally {
      materialsRepo.deleteDocument(document.id);
    }
  });
});
