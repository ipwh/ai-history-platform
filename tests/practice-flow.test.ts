import os from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

// 使用獨立暫存資料庫，避免影響本機示範資料
const testDbPath = path.join(os.tmpdir(), `hist-test-practice-${process.pid}.db`);
process.env.APP_DATABASE_PATH = testDbPath;
process.env.LLM_PROVIDER = "mock";

type PracticeService = typeof import("@/server/services/practice-service");
type QuestionRepository = typeof import("@/server/repositories/questions");
type Seed = typeof import("@/server/seed");
type LearnerRepository = typeof import("@/server/repositories/learners");
type RecordsService = typeof import("@/server/services/practice-records");

let practice: PracticeService;
let questionsRepo: QuestionRepository;
let seed: Seed;
let learners: LearnerRepository;
let recordsService: RecordsService;

const LEARNER = "test-learner-1";
const SECTION = "topic-5-renaissance-features";

beforeAll(async () => {
  practice = await import("@/server/services/practice-service");
  questionsRepo = await import("@/server/repositories/questions");
  seed = await import("@/server/seed");
  learners = await import("@/server/repositories/learners");
  recordsService = await import("@/server/services/practice-records");
  seed.ensureBootstrap();
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
    expect(correctSubmit.feedback.sourceLocation.length).toBeGreaterThan(0);

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

  it("短答題不會自動評分，並可標記需要重溫", async () => {
    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["short"],
      difficulty: "advanced",
      questionCount: 1,
      mode: "standard",
      sourceSessionId: null,
    });

    const question = assembled.questions[0];
    const submit = await practice.submitAnswer(
      assembled.session.id,
      LEARNER,
      question.id,
      "我的答案",
    );
    expect(submit.feedback.autoGraded).toBe(false);
    expect(submit.feedback.isCorrect).toBeNull();
    expect(submit.feedback.gradingPoints.length).toBeGreaterThan(0);
    // 本地示範模式沒有 AI，因此不會有語意批改結果
    expect(submit.feedback.aiGrading).toBeNull();

    const feedback = practice.setSelfAssessment(
      assembled.session.id,
      LEARNER,
      question.id,
      "needs-review",
    );
    expect(feedback.selfAssessment).toBe("needs-review");

    const result = practice.getPracticeResult(assembled.session.id, LEARNER);
    expect(result.selfReviewKnowledgePoints.length).toBe(1);
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
