import { beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabasePath } from "./test-database";

// 使用獨立暫存資料庫，避免影響本機示範資料
const testDbPath = freshTestDatabasePath("practice");
process.env.APP_DATABASE_PATH = testDbPath;
process.env.LLM_PROVIDER = "mock";

type PracticeService = typeof import("@/server/services/practice-service");
type QuestionRepository = typeof import("@/server/repositories/questions");
type Seed = typeof import("@/server/seed");
type LearnerRepository = typeof import("@/server/repositories/learners");
type RecordsService = typeof import("@/server/services/practice-records");
type PracticeRepository = typeof import("@/server/repositories/practice");

let practice: PracticeService;
let questionsRepo: QuestionRepository;
let seed: Seed;
let learners: LearnerRepository;
let recordsService: RecordsService;
let practiceRepo: PracticeRepository;

const LEARNER = "test-learner-1";
const SECTION = "topic-5-renaissance-reformation";

beforeAll(async () => {
  practice = await import("@/server/services/practice-service");
  questionsRepo = await import("@/server/repositories/questions");
  seed = await import("@/server/seed");
  learners = await import("@/server/repositories/learners");
  recordsService = await import("@/server/services/practice-records");
  practiceRepo = await import("@/server/repositories/practice");
  seed.ensureBootstrap();
});

describe("結構上無法作答的題目不會派給學生", () => {
  function insertFill(options: {
    id: string;
    question: string;
    correctAnswer: string;
  }): void {
    questionsRepo.insertQuestion({
      id: options.id,
      topicId: "topic-5",
      sectionId: SECTION,
      questionType: "fill",
      difficulty: "basic",
      question: options.question,
      options: [],
      correctAnswer: options.correctAnswer,
      acceptedAnswers: [],
      explanation: "測試用解釋。",
      knowledgePoint: "測試",
      sourceExcerpt: options.question,
      sourceLocation: "測試",
      sourceBlockIds: [],
      gradingPoints: [],
      origin: "school-paper",
      status: "published",
      sourceVerified: false,
      qualityWarnings: [],
      skill: null,
      revision: 1,
      autoValidatedAt: null,
      autoValidatedRevision: null,
      autoValidatedFingerprint: null,
      teacherConfirmationRequired: false,
      createdAt: "2026-10-18T00:00:00.000Z",
    });
  }

  it("題幹有多個空格但只有一個答案的填充題不會派給學生（其餘空格沒有答案可對）", async () => {
    insertFill({
      id: "q-test-good-fill",
      question: "人類歷史中，文字發明以前、沒有文字紀錄的時期稱為＿＿＿。",
      correctAnswer: "史前時期",
    });
    insertFill({
      id: "q-test-multiblank",
      question: "＿＿＿＿是第一個空格，＿＿＿＿是第二個空格。",
      correctAnswer: "甲",
    });

    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["fill"],
      difficulty: "basic",
      questionCount: 30,
      mode: "standard",
      sourceSessionId: null,
    });

    expect(assembled.questions.some((question) => question.id === "q-test-multiblank")).toBe(false);
    expect(assembled.questions.some((question) => question.id === "q-test-good-fill")).toBe(true);
  });

  it("答案仍出現在題幹其他位置的填充題不會派給學生（可直接抄寫）", async () => {
    insertFill({
      id: "q-test-leaking",
      question: "教士＿＿＿＿的信徒被稱為「聶斯托利派」。",
      correctAnswer: "聶斯托利",
    });

    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["fill"],
      difficulty: "basic",
      questionCount: 30,
      mode: "standard",
      sourceSessionId: null,
    });

    expect(assembled.questions.some((question) => question.id === "q-test-leaking")).toBe(false);
  });

  it("答案欄混入空格標記或整句內容的填充題不會派給學生（答案無法輸入）", async () => {
    insertFill({
      id: "q-test-corrupt-answer",
      question: "法國的極端民族主義鼓吹報復＿＿＿。",
      correctAnswer: "阿爾薩斯—洛林 1919年，戰勝國召開______________，並與德國簽訂條約。",
    });

    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["fill"],
      difficulty: "basic",
      questionCount: 30,
      mode: "standard",
      sourceSessionId: null,
    });

    expect(assembled.questions.some((question) => question.id === "q-test-corrupt-answer")).toBe(false);
  });

  it("選項以 i／ii 指涉題幹、但題幹沒有標示的選擇題不會派給學生（無法對應）", async () => {
    questionsRepo.insertQuestion({
      id: "q-test-roman-unlabelled",
      topicId: "topic-5",
      sectionId: SECTION,
      questionType: "mc",
      difficulty: "basic",
      question: "下列哪些屬於一手資料？ 日記 錄像 事件發生時的報章報道 學術論文",
      options: ["i、ii和iii", "i、ii和iv", "i、iii和iv", "ii、iii和iv"],
      correctAnswer: "i、ii和iii",
      acceptedAnswers: [],
      explanation: "測試用解釋。",
      knowledgePoint: "測試",
      sourceExcerpt: "測試",
      sourceLocation: "測試",
      sourceBlockIds: [],
      gradingPoints: [],
      origin: "school-paper",
      status: "published",
      sourceVerified: false,
      qualityWarnings: [],
      skill: null,
      revision: 1,
      autoValidatedAt: null,
      autoValidatedRevision: null,
      autoValidatedFingerprint: null,
      teacherConfirmationRequired: false,
      createdAt: "2026-10-18T00:00:00.000Z",
    });

    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 30,
      mode: "standard",
      sourceSessionId: null,
    });

    expect(assembled.questions.some((question) => question.id === "q-test-roman-unlabelled")).toBe(false);
  });
});

describe("課題發布狀態", () => {
  it("未發布的課題不可建立新練習（學生不能以 topicId 繞過發布狀態）", async () => {
    const topicsRepo = await import("@/server/repositories/topics");
    const original = topicsRepo.getTopic("topic-5");
    expect(original).not.toBeNull();

    topicsRepo.setTopicPublished("topic-5", false);
    try {
      await expect(
        practice.createPractice({
          learnerId: LEARNER,
          topicId: "topic-5",
          sectionIds: [SECTION],
          questionTypes: ["mc"],
          difficulty: "basic",
          questionCount: 1,
          mode: "standard",
          sourceSessionId: null,
        }),
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      topicsRepo.setTopicPublished("topic-5", original!.published);
    }
  });
});

describe("同時提交（雙擊／重複請求）", () => {
  it("同一題同時提交兩次只會有一筆作答記錄，分數不會重複計算", async () => {
    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 1,
      mode: "standard",
      sourceSessionId: null,
    });
    const question = assembled.questions[0];

    await Promise.all([
      practice.submitAnswer(assembled.session.id, LEARNER, question.id, "第一個答案"),
      practice.submitAnswer(assembled.session.id, LEARNER, question.id, "第二個答案"),
    ]);

    const attempts = practiceRepo
      .listAttempts(assembled.session.id)
      .filter((attempt) => attempt.questionId === question.id);
    expect(attempts).toHaveLength(1);

    // 已作答題數不會超過題目總數（重複計算會令成績失真）
    const result = practice.getPracticeResult(assembled.session.id, LEARNER);
    expect(result.answeredCount).toBeLessThanOrEqual(result.totalQuestions);
    expect(result.gradedCount).toBeLessThanOrEqual(result.totalQuestions);
  });
});

describe("學生練習流程（整合測試）", () => {
  it("沒有匯入教材時，仍可使用內建示範題庫建立練習", async () => {
    const result = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 2,
      mode: "standard",
      sourceSessionId: null,
    });

    expect(result.questions.length).toBeGreaterThan(0);
    expect(result.session.origin).toBe("demo");
    expect(result.notice).toContain("示範題庫");
  });

  it("作答前不會洩露答案", async () => {
    const result = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 1,
      mode: "standard",
      sourceSessionId: null,
    });

    const first = result.questions[0] as Record<string, unknown>;
    expect(first.correctAnswer).toBeUndefined();
    expect(first.explanation).toBeUndefined();
    expect(first.gradingPoints).toBeUndefined();
    expect(first.sourceExcerpt).toBeUndefined();
  });

  it("提交答案後會回傳答案、解釋、知識點及教材來源，重複提交不會改變分數", async () => {
    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 2,
      mode: "standard",
      sourceSessionId: null,
    });

    const sessionId = assembled.session.id;
    const [firstQuestion, secondQuestion] = assembled.questions;
    const firstCorrect = questionsRepo.getQuestion(firstQuestion.id);
    const secondCorrect = questionsRepo.getQuestion(secondQuestion.id);
    expect(firstCorrect).not.toBeNull();
    expect(secondCorrect).not.toBeNull();

    const correctSubmit = await practice.submitAnswer(
      sessionId,
      LEARNER,
      firstQuestion.id,
      firstCorrect!.correctAnswer,
    );
    expect(correctSubmit.recorded).toBe(true);
    expect(correctSubmit.feedback.isCorrect).toBe(true);
    expect(correctSubmit.feedback.explanation.length).toBeGreaterThan(0);
    expect(correctSubmit.feedback.knowledgePoint.length).toBeGreaterThan(0);
    expect(correctSubmit.feedback.sourceLocation ?? "").toEqual(expect.any(String));
    expect(correctSubmit.feedback.sourceWithheld).toBe(false);

    // 已看到答案後再提交，分數不會改變
    const repeated = await practice.submitAnswer(
      sessionId,
      LEARNER,
      firstQuestion.id,
      firstCorrect!.correctAnswer,
    );
    expect(repeated.recorded).toBe(false);

    const wrongSubmit = await practice.submitAnswer(
      sessionId,
      LEARNER,
      secondQuestion.id,
      "錯誤答案",
    );
    expect(wrongSubmit.feedback.isCorrect).toBe(false);

    const result = practice.getPracticeResult(sessionId, LEARNER);
    expect(result.totalQuestions).toBe(2);
    expect(result.answeredCount).toBe(2);
    expect(result.gradedCount).toBe(2);
    expect(result.correctCount).toBe(1);
    expect(result.accuracy).toBe(0.5);
    expect(result.knowledgePointsToReview.length).toBe(1);
  });

  it("可以針對錯題再練習", async () => {
    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 2,
      mode: "standard",
      sourceSessionId: null,
    });

    for (const question of assembled.questions) {
      await practice.submitAnswer(assembled.session.id, LEARNER, question.id, "刻意答錯");
    }
    const result = practice.getPracticeResult(assembled.session.id, LEARNER);
    expect(result.correctCount).toBe(0);

    const retry = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 5,
      mode: "wrong-only",
      sourceSessionId: assembled.session.id,
    });

    expect(retry.session.mode).toBe("wrong-only");
    expect(retry.questions.length).toBeGreaterThan(0);
    expect(retry.notice).toContain("答錯");
  });

  it("拒絕存取其他學習者的練習記錄", async () => {
    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 1,
      mode: "standard",
      sourceSessionId: null,
    });

    expect(() => practice.getPracticeView(assembled.session.id, "other-learner")).toThrow(/其他學習者/);
  });

  it("選擇題選項次序會被打亂，正確答案不會固定在第一個位置", async () => {
    const positions = new Set<number>();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const assembled = await practice.createPractice({
        learnerId: LEARNER,
        topicId: "topic-5",
        sectionIds: [SECTION],
        questionTypes: ["mc"],
        difficulty: "basic",
        questionCount: 1,
        mode: "standard",
        sourceSessionId: null,
      });

      const student = assembled.questions[0];
      const full = questionsRepo.getQuestion(student.id);
      expect(full).not.toBeNull();

      const index = student.options.indexOf(full!.correctAnswer);
      expect(index).toBeGreaterThanOrEqual(0);
      // 打亂後仍然只包含原本的選項
      expect([...student.options].sort()).toEqual([...full!.options].sort());
      positions.add(index);
    }

    expect(positions.size).toBeGreaterThan(1);
  });

  it("練習記錄會留檔，並可由教師端查閱（含作答日期、課題、題型及答對／答錯）", () => {
    const progress = learners.getLearnerProgress(LEARNER, "topic-5");
    expect(progress.completedSessions).toBeGreaterThan(0);

    const records = recordsService.listPracticeRecords({ learnerId: LEARNER });
    expect(records.length).toBeGreaterThan(0);

    const record = records[0];
    expect(record.learnerId).toBe(LEARNER);
    expect(record.createdAt.length).toBeGreaterThan(0);
    expect(record.topicTitle.length).toBeGreaterThan(0);
    expect(record.questionTypeLabels.length).toBeGreaterThan(0);
    expect(record.questions).toHaveLength(record.totalQuestions);
    expect(record.correctCount + record.wrongCount).toBeLessThanOrEqual(record.totalQuestions);
  });

  it("練習記錄可匯出 CSV，欄位包含作答日期、課題、題型及結果", () => {
    const csv = recordsService.buildRecordsCsv(
      recordsService.listPracticeRecords({ learnerId: LEARNER }),
    );
    expect(csv).toContain("作答日期");
    expect(csv).toContain("課題");
    expect(csv).toContain("題型");
    expect(csv).toContain("結果");
  });
});
