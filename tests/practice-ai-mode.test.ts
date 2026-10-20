import { beforeAll, describe, expect, it } from "vitest";
import { openDocumentForStudents } from "./material-distribution";
import { freshTestDatabasePath } from "./test-database";

// 使用獨立暫存資料庫，並以本地示範生成代替真實 LLM（不會發出網絡請求）
const testDbPath = freshTestDatabasePath("ai-practice");
process.env.APP_DATABASE_PATH = testDbPath;
process.env.LLM_PROVIDER = "mock";

type PracticeService = typeof import("@/server/services/practice-service");
type QuestionRepository = typeof import("@/server/repositories/questions");
type MaterialService = typeof import("@/server/services/material-service");
type TopicService = typeof import("@/server/services/topic-service");
type MaterialsRepo = typeof import("@/server/repositories/materials");
type PracticeRepo = typeof import("@/server/repositories/practice");
type Seed = typeof import("@/server/seed");
type Types = typeof import("@/lib/types");

let practice: PracticeService;
let questionsRepo: QuestionRepository;
let materialService: MaterialService;
let topicService: TopicService;
let materialsRepo: MaterialsRepo;
let practiceRepo: PracticeRepo;
let seed: Seed;
let types: Types;

const LEARNER = "ai-mode-learner";
const SECTIONS = ["topic-5-renaissance-reformation", "topic-5-industrial"];

/**
 * 學生自行觸發的即時出題只可使用「已確認可向學生發布」的教材（Sprint 5 收緊）。
 * 測試若需要學生端即時生成，必須先把教材切換到已確認狀態——這正是管理員在正式
 * 環境要做的事（見 README「教材版權與學生閱讀範圍」）。
 */
function grantDistributionForTopic(topicId: string): void {
  for (const block of materialsRepo.listGroundingBlocksForSections(topicId, [])) {
    openDocumentForStudents(materialsRepo, block.documentId);
  }
}

function revokeDistribution(): void {
  for (const document of materialsRepo.listDocuments()) {
    materialsRepo.setDocumentStudentDistribution(document.id, false);
  }
}

beforeAll(async () => {
  practice = await import("@/server/services/practice-service");
  questionsRepo = await import("@/server/repositories/questions");
  materialService = await import("@/server/services/material-service");
  topicService = await import("@/server/services/topic-service");
  materialsRepo = await import("@/server/repositories/materials");
  practiceRepo = await import("@/server/repositories/practice");
  seed = await import("@/server/seed");
  types = await import("@/lib/types");
  seed.ensureBootstrap();
  // 即時出題需要教材內容作依據，因此匯入課題5的書本內容
  const imported = await materialService.importPilotMaterialFromDisk({
    runOcr: false,
  });
  if (!imported) throw new Error("找不到課題5的教材檔案，無法測試 AI 出題模式");
  grantDistributionForTopic("topic-5");
});

describe("AI 即時出題模式", () => {
  it("學生自行觸發即時出題、但教材未開放時，HTTP 409 並提供可行動的說明（且不建立練習）", async () => {
    revokeDistribution();
    try {
      const before = practiceRepo.listSessionsByLearner(LEARNER, "topic-5").length;
      const { POST } = await import("@/app/api/practice/route");
      const response = await POST(
        new Request("http://localhost:3000/api/practice", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            learnerId: LEARNER,
            topicId: "topic-5",
            sectionIds: [SECTIONS[0]],
            questionTypes: ["mc"],
            difficulty: "basic",
            questionCount: 3,
            mode: "standard",
            questionSource: "ai",
            sourceSessionId: null,
          }),
        }),
      );

      expect(response.status).toBe(409);
      const payload = (await response.json()) as { error?: string };
      // 學生看到的是「教材尚未開放」，而不是含糊的技術錯誤；前端據此提供替代做法
      expect(payload.error ?? "").toContain("尚未開放學生使用");
      // 失敗時不可留下半完成的練習記錄
      expect(practiceRepo.listSessionsByLearner(LEARNER, "topic-5").length).toBe(before);
    } finally {
      grantDistributionForTopic("topic-5");
    }
  });

  it("學生端即時出題不可使用未確認可發布的教材（fail-closed）", async () => {
    revokeDistribution();
    try {
      // 未確認版權時，學生自行觸發的即時生成必須拒絕，而**不是**改用教師版內容
      await expect(
        practice.createPractice({
          learnerId: LEARNER,
          topicId: "topic-5",
          sectionIds: [SECTIONS[0]],
          questionTypes: ["mc"],
          difficulty: "basic",
          questionCount: 1,
          mode: "standard",
          questionSource: "ai",
          sourceSessionId: null,
        }),
      ).rejects.toThrowError(/尚未開放學生使用|教材/);
    } finally {
      grantDistributionForTopic("topic-5");
    }
  });

  it("按所選分節分配題數", () => {
    expect([...practice.distributeQuestionCount(6, ["a", "b", "c"]).entries()]).toEqual([
      ["a", 2],
      ["b", 2],
      ["c", 2],
    ]);
    expect([...practice.distributeQuestionCount(5, ["a", "b"]).entries()]).toEqual([
      ["a", 3],
      ["b", 2],
    ]);
    expect([...practice.distributeQuestionCount(2, ["a", "b", "c"]).entries()]).toEqual([
      ["a", 1],
      ["b", 1],
    ]);
  });

  it("questionSource 預設為 bank，未指定時沿用題庫流程", () => {
    expect(types.practiceSetupSchema.parse({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: SECTIONS,
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 2,
    }).questionSource).toBe("bank");
  });

  it("即時生成的題目只存在於練習快照內，題庫不會增加題目", async () => {
    const before = questionsRepo.listQuestions({ topicId: "topic-5" }).length;

    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: SECTIONS,
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 2,
      mode: "standard",
      questionSource: "ai",
      sourceSessionId: null,
    });

    expect(assembled.questions.length).toBeGreaterThan(0);
    expect(assembled.session.origin).toBe("generated");
    expect(assembled.notice).toContain("本地示範生成");

    // 題目（含答案）仍可在練習快照中找回，供作答及查看成績
    const stored = practice.getPracticeView(assembled.session.id, LEARNER);
    expect(stored.questions.length).toBe(assembled.questions.length);
    expect(questionsRepo.getQuestion(assembled.questions[0].id)).toBeNull();

    expect(questionsRepo.listQuestions({ topicId: "topic-5" }).length).toBe(before);
  });

  it("不在題庫的即時生成題目也可以重做錯題", async () => {
    const first = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: SECTIONS,
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 2,
      mode: "standard",
      questionSource: "ai",
      sourceSessionId: null,
    });

    for (const question of first.questions) {
      await practice.submitAnswer(first.session.id, LEARNER, question.id, "刻意答錯");
    }

    const retry = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: SECTIONS,
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 2,
      mode: "wrong-only",
      questionSource: "ai",
      sourceSessionId: first.session.id,
    });

    expect(retry.questions.length).toBeGreaterThan(0);
    expect(retry.notice).toContain("答錯");
    const retryIds = retry.questions.map((question) => question.id);
    expect(retryIds.every((id) => first.questions.some((item) => item.id === id))).toBe(true);
  });

  it("選了多種題型時，練習頁會列出這次包含的題型及題數（學生可即時發現題型組合）", async () => {
    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: SECTIONS,
      // 題型可多選（介面預設已選「選擇題」），若學生以為只選了填充題，這個說明可即時顯示實際組合
      questionTypes: ["mc", "fill"],
      difficulty: "basic",
      questionCount: 4,
      mode: "standard",
      questionSource: "ai",
      sourceSessionId: null,
    });

    const usedTypes = new Set(assembled.questions.map((question) => question.questionType));
    expect(usedTypes.size).toBeGreaterThan(1);
    expect(assembled.notice).toContain("這次練習包含");
    for (const type of usedTypes) {
      expect(assembled.notice).toContain(types.QUESTION_TYPE_LABELS[type]);
    }
    // 學生重新載入頁面後仍看到同樣說明（快照的一部分）
    expect(practice.getPracticeView(assembled.session.id, LEARNER).notice).toContain(
      "這次練習包含",
    );
  });

  it("只選一種題型時不會加入題型說明", async () => {
    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: SECTIONS,
      questionTypes: ["fill"],
      difficulty: "basic",
      questionCount: 2,
      mode: "standard",
      questionSource: "ai",
      sourceSessionId: null,
    });

    expect(assembled.questions.every((question) => question.questionType === "fill")).toBe(true);
    expect(assembled.notice ?? "").not.toContain("這次練習包含");
  });

  // 迴歸：18 個分節只要求 10 題時，有 8 個分節本來就分不到題目，
  // 舊版把它們一併算成「教材內容未能出題」，學生會誤以為教材不足。
  it("題目數少於所選分節時，未獲分配題目的分節不計入「未能出題」", () => {
    const sections = ["a", "b", "c", "d", "e"];
    const allocation = practice.distributeQuestionCount(2, sections);
    expect([...allocation.keys()]).toEqual(["a", "b"]);

    // a、b 都成功出題 → 沒有「未能出題」的主題（舊版會報 c、d、e 共 3 個）
    expect(practice.countUnproductiveSections(allocation, ["a", "b"])).toEqual([]);
    // b 分配到題目但出不到題 → 只報 b，不會把 c、d、e 一併算入
    expect(practice.countUnproductiveSections(allocation, ["a"])).toEqual(["b"]);
  });
});

/**
 * 一次生成多個分節時，每條題目必須歸入「提供節錄的段落所屬分節」。
 * 舊行為一律使用 sectionIds[0]，令其他分節的題目被錯誤分類（教師會在錯誤的主題下看到題目）。
 */
describe("多分節生成的分節歸屬", () => {
  it("每條題目的分節都與其教材節錄所屬的段落一致", async () => {
    const questionService = await import("@/server/services/question-service");
    const { buildMaterialUnits } = await import("@/server/services/material-units");
    const { normalizeForMatch } = await import("@/server/materials/text-utils");

    // 建立 blockId → 分節 的對照表（單位的 sectionId 來自教材段落）。
    // 必須使用與生成時相同的分節清單，否則會拿到不同的段落集合（單位數量有上限）。
    const units = buildMaterialUnits("topic-5", SECTIONS);
    const sectionOfUnit = new Map(units.map((unit) => [unit.blockId, unit.sectionId ?? null]));

    const generated = await questionService.generateQuestions({
      topicId: "topic-5",
      sectionIds: SECTIONS,
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 4,
      persist: false,
      allowBankDuplicates: true,
    });

    expect(generated.questions.length).toBeGreaterThan(0);

    for (const question of generated.questions) {
      expect(SECTIONS).toContain(question.sectionId);

      // 真正提供節錄的段落，必須屬於該題被歸入的分節
      const excerptKey = normalizeForMatch(question.sourceExcerpt);
      const sourceUnit = units.find((unit) => normalizeForMatch(unit.text).includes(excerptKey));
      expect(sourceUnit, `找不到「${question.sourceExcerpt.slice(0, 20)}…」的來源段落`).toBeDefined();
      expect(question.sectionId).toBe(sectionOfUnit.get(sourceUnit!.blockId));
    }
  });
});

describe("分節可用性（介面顯示用，取代容易誤解的題目數量）", () => {
  it("匯入教材後，每個主題（整合後已無子分節）會回報教材段落數", () => {
    const overview = topicService.getTopicDetail("topic-5", null);
    expect(overview).not.toBeNull();

    // 2026-10-20：課題5 整合為 4 個主題，學生直接選取這 4 個主題
    expect(overview!.sections).toHaveLength(4);
    for (const theme of overview!.sections) {
      expect(theme.children).toHaveLength(0);
      expect(theme.materialBlockCount).toBeGreaterThan(0);
      // 教材已確認可向學生發布，因此學生端也看得到可用段落
      expect(theme.studentMaterialBlockCount).toBeGreaterThan(0);
      expect(types.isSectionPractisable(theme, "ai")).toBe(true);
    }

    const renaissance = overview!.sections.find(
      (section) => section.id === "topic-5-renaissance-reformation",
    );
    expect(renaissance?.title).toBe("文藝復興與宗教改革");
  });

  it("教材未開放給學生時，學生端可用段落數為 0，AI 出題不可選（但題庫仍可）", () => {
    revokeDistribution();
    try {
      const overview = topicService.getTopicDetail("topic-5", null);
      const renaissance = overview!.sections.find(
        (section) => section.id === "topic-5-renaissance-reformation",
      );
      expect(renaissance).toBeDefined();
      // 教師可見的教材段落數不受影響（教材仍在，只是未開放）
      expect(renaissance!.materialBlockCount).toBeGreaterThan(0);
      // 學生可用段落數必須為 0，介面才不會承諾做不到的 AI 出題
      expect(renaissance!.studentMaterialBlockCount).toBe(0);
      expect(types.isSectionPractisable(renaissance!, "ai")).toBe(false);
      // 題庫題目不受版權閘門影響，有已發布題目的主題仍可練習
      const bankPractisable = overview!.sections.filter(
        (section) => section.publishedQuestionCount > 0,
      );
      expect(bankPractisable.length).toBeGreaterThan(0);
      expect(bankPractisable.every((section) => types.isSectionPractisable(section, "bank"))).toBe(
        true,
      );
    } finally {
      grantDistributionForTopic("topic-5");
    }
  });

  it("沒有可用教材亦沒有題目的分節不可出題，有其一即可", () => {
    expect(
      types.isSectionPractisable({ publishedQuestionCount: 0, studentMaterialBlockCount: 0 }, "ai"),
    ).toBe(false);
    expect(
      types.isSectionPractisable({ publishedQuestionCount: 0, studentMaterialBlockCount: 3 }, "ai"),
    ).toBe(true);
    // AI 出題必須有學生可用教材：只有題庫題目不足以即時生成
    expect(
      types.isSectionPractisable({ publishedQuestionCount: 2, studentMaterialBlockCount: 0 }, "ai"),
    ).toBe(false);
    // 題庫出題有已發布題目即可，教材只是補足來源
    expect(
      types.isSectionPractisable(
        { publishedQuestionCount: 2, studentMaterialBlockCount: 0 },
        "bank",
      ),
    ).toBe(true);
    expect(
      types.isSectionPractisable(
        { publishedQuestionCount: 0, studentMaterialBlockCount: 2 },
        "bank",
      ),
    ).toBe(true);
  });

  it("課題的主題數以子分節計算，沒有子分節時以分節本身計算", () => {
    const overview = topicService.getTopicDetail("topic-5", null);
    expect(overview).not.toBeNull();
    const expected = overview!.sections.reduce(
      (total, section) => total + (section.children.length > 0 ? section.children.length : 1),
      0,
    );
    expect(types.countPracticeThemes(overview!)).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });
});
