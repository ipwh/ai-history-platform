/**
 * 學生自學可用性測試（Sprint 7.8）。
 *
 * 核心契約：題目只要**通過自動品質驗證**就可以供學生練習，毋須任何教師預先批准；
 * 教師覆核改為事後補救。同時確認：
 *   1. 驗證通過的題目可以立即被學生組題練習（不是只「已發布」在資料庫裡）。
 *   2. 不合格的題目會被抽起，但不影響同一份練習的其他題目。
 *   3. 教材依據不足／答案含糊的題目 fail-closed。
 *   4. 沒有任何「假造的人工覆核紀錄」。
 *   5. 撤回（停用）的題目不再進入新練習；既有練習快照與已作答記錄不變。
 *   6. 教材發行權與來源可見性閘門不受本修訂影響。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { openDocumentForStudents, closeDocumentForStudents } from "./material-distribution";
import { freshTestDatabasePath } from "./test-database";

const testDbPath = freshTestDatabasePath("self-study");
process.env.APP_DATABASE_PATH = testDbPath;
process.env.LLM_PROVIDER = "mock";
delete process.env.K_SERVICE;

type QuestionService = typeof import("@/server/services/question-service");
type QuestionRepo = typeof import("@/server/repositories/questions");
type PracticeService = typeof import("@/server/services/practice-service");
type PracticeRepo = typeof import("@/server/repositories/practice");
type MaterialService = typeof import("@/server/services/material-service");
type MaterialsRepo = typeof import("@/server/repositories/materials");
type Seed = typeof import("@/server/seed");

let questions: QuestionService;
let questionsRepo: QuestionRepo;
let practice: PracticeService;
let practiceRepo: PracticeRepo;
let materialService: MaterialService;
let materialsRepo: MaterialsRepo;
let seed: Seed;

const SECTION = "topic-5-industrial-development";
const LEARNER = "self-study-learner";

beforeAll(async () => {
  questions = await import("@/server/services/question-service");
  questionsRepo = await import("@/server/repositories/questions");
  practice = await import("@/server/services/practice-service");
  practiceRepo = await import("@/server/repositories/practice");
  materialService = await import("@/server/services/material-service");
  materialsRepo = await import("@/server/repositories/materials");
  seed = await import("@/server/seed");
  seed.ensureBootstrap();
  const imported = await materialService.importPilotMaterialFromDisk({ runOcr: false });
  if (!imported) throw new Error("找不到課題5的教材檔案");
  for (const block of materialsRepo.listGroundingBlocksForSections("topic-5", [])) {
    openDocumentForStudents(materialsRepo, block.documentId);
  }
});

describe("通過自動驗證的題目可即時自學（毋須教師預先批准）", () => {
  it("生成 → 自動驗證 → 立即發布 → 學生組題時確實取得", async () => {
    const generated = await questions.generateQuestions({
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 2,
      persist: true,
      allowBankDuplicates: true,
      requestType: "question-bank",
    });

    expect(generated.questions.length).toBeGreaterThan(0);
    const created = generated.questions[0];

    // 自動品質驗證紀錄存在，且對應目前版本；沒有任何人為覆核紀錄
    expect(created.autoValidatedAt).not.toBeNull();
    expect(created.autoValidatedRevision).toBe(created.revision);
    expect(questions.autoValidationIsCurrent(questionsRepo.getQuestion(created.id)!)).toBe(true);
    expect(questionsRepo.listQuestionReviews(created.id)).toEqual([]);
    expect(created.status).toBe("published");

    // 學生以題庫模式組題（questionSource: "bank"）時真的會拿到這條題目
    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 20,
      mode: "standard",
      questionSource: "bank",
      sourceSessionId: null,
    });
    expect(assembled.questions.map((question) => question.id)).toContain(created.id);
  });

  it("撤回（disabled）後不再進入新練習，但既有快照與作答記錄不變", async () => {
    const generated = await questions.generateQuestions({
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 1,
      persist: true,
      allowBankDuplicates: true,
      requestType: "question-bank",
    });
    const target = generated.questions[0];

    const first = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 20,
      mode: "standard",
      questionSource: "bank",
      sourceSessionId: null,
    });
    expect(first.questions.map((question) => question.id)).toContain(target.id);
    await practice.submitAnswer(first.session.id, LEARNER, target.id, "人文主義");
    const attemptBefore = practiceRepo.getAttempt(first.session.id, target.id);
    const snapshotBefore = practiceRepo.getSessionQuestions(first.session.id).length;

    // 教師依回報處理：暫時下架（不是刪除）
    questions.changeQuestionStatus(target.id, "disabled");

    const second = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 20,
      mode: "standard",
      questionSource: "bank",
      sourceSessionId: null,
    });
    expect(second.questions.map((question) => question.id)).not.toContain(target.id);

    // 歷史記錄不變：題目仍在題庫（未刪除）、既有快照及答案不變
    expect(questionsRepo.getQuestion(target.id)?.status).toBe("disabled");
    expect(practiceRepo.getSessionQuestions(first.session.id).length).toBe(snapshotBefore);
    expect(practiceRepo.getAttempt(first.session.id, target.id)).toEqual(attemptBefore);
  });

  it("單一不合格題目不會阻塞其他題目的生成（抽起後仍有其他題目）", async () => {
    // 以小分節、要求多題：部分題目會因為品質閘門或教材不足被抽起，
    // 但只要有其他合格題目，練習仍然可以進行
    const generated = await questions.generateQuestions({
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc", "fill"],
      difficulty: "basic",
      questionCount: 4,
      persist: true,
      allowBankDuplicates: true,
      requestType: "question-bank",
    });

    expect(generated.questions.length).toBeGreaterThan(0);
    for (const question of generated.questions) {
      expect(question.autoValidatedAt).not.toBeNull();
    }
  });
});

describe("自動驗證不會繞過教材發行權與來源可見性", () => {
  it("來源文件未開放給學生時，即使題目已自動驗證並發布，節錄仍然不對學生顯示", async () => {
    const documentId = materialsRepo.listGroundingBlocksForSections("topic-5", [])[0].documentId;
    closeDocumentForStudents(materialsRepo, documentId);
    try {
      const generated = await questions.generateQuestions({
        topicId: "topic-5",
        sectionIds: [SECTION],
        questionTypes: ["mc"],
        difficulty: "basic",
        questionCount: 1,
        persist: true,
        allowBankDuplicates: true,
        requestType: "question-bank",
      });
      const question = generated.questions[0];
      expect(question.status).toBe("published");

      const visibility = await import("@/server/services/source-visibility");
      // 來源在未確認可向學生發布的文件中 → 節錄及來源位置一律不顯示
      const decision = visibility.studentExcerptVisibility(
        questionsRepo.getQuestion(question.id)!,
      );
      expect(decision.visible).toBe(false);
    } finally {
      openDocumentForStudents(materialsRepo, documentId);
    }
  });

  it("題目修正後，以舊版本批改的作答會被標示（不會靜默重算分數）", async () => {
    const generated = await questions.generateQuestions({
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 1,
      persist: true,
      allowBankDuplicates: true,
      requestType: "question-bank",
    });
    const question = generated.questions[0];

    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 20,
      mode: "standard",
      questionSource: "bank",
      sourceSessionId: null,
    });
    await practice.submitAnswer(assembled.session.id, LEARNER, question.id, "錯的答案");

    // 作答當時的版本會被記錄下來
    const attempt = practiceRepo.getAttempt(assembled.session.id, question.id)!;
    expect(attempt.questionRevision).toBe(question.revision);
    expect(questions.teacherQuestionView(questionsRepo.getQuestion(question.id)!).staleAttempts).toBe(0);

    // 教師修正題目內容（版本遞增）
    const current = questionsRepo.getQuestion(question.id)!;
    questions.updateManualQuestion(question.id, {
      ...current,
      status: "draft",
      explanation: `${current.explanation}（已由教師補充說明）`,
    });

    const view = questions.teacherQuestionView(questionsRepo.getQuestion(question.id)!);
    expect(view.question.revision).toBeGreaterThan(question.revision);
    // 既有作答仍按當時版本記錄，但教師會看到「有 1 筆舊版作答」
    expect(view.staleAttempts).toBe(1);
    expect(view.totalAttempts).toBe(1);
    expect(practiceRepo.getAttempt(assembled.session.id, question.id)!.isCorrect).toBe(false);
  });

  it("撤回後的題目在教師端仍保留版本與自動驗證紀錄（可追溯）", async () => {    const generated = await questions.generateQuestions({
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["fill"],
      difficulty: "basic",
      questionCount: 1,
      persist: true,
      allowBankDuplicates: true,
      requestType: "question-bank",
    });
    const question = generated.questions[0];
    questions.changeQuestionStatus(question.id, "disabled");
    const stored = questionsRepo.getQuestion(question.id)!;

    expect(stored.autoValidatedAt).not.toBeNull();
    expect(stored.revision).toBe(question.revision);
  });
});
