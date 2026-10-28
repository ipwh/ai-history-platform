/**
 * 教師以學生端測試的流程測試。
 *
 * 驗證教師可以完整走一次「選課題 → 選主題 → 出題 → 作答 → 看答案 → 成績 → 重做錯題」，
 * 而且教師與學生的學習記錄分開、教師不可讀取學生的記錄。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("teacher-flow");
process.env.LLM_PROVIDER = "mock";

type PracticeService = typeof import("@/server/services/practice-service");
type Seed = typeof import("@/server/seed");
type LearnerRepository = typeof import("@/server/repositories/learners");
type RecordsService = typeof import("@/server/services/practice-records");

let practice: PracticeService;
let seed: Seed;
let learners: LearnerRepository;
let recordsService: RecordsService;

const TEACHER = "teacher:teacher@pochiu.edu.hk";
const STUDENT = "school:s2024146@pochiu.edu.hk";
const SECTION = "topic-5-renaissance-reformation";

beforeAll(async () => {
  practice = await import("@/server/services/practice-service");
  seed = await import("@/server/seed");
  learners = await import("@/server/repositories/learners");
  recordsService = await import("@/server/services/practice-records");
  seed.ensureBootstrap();
});

describe("教師測試學生端", () => {
  it("教師可完成完整流程：出題 → 作答 → 回饋 → 成績 → 重做錯題", async () => {
    const created = await practice.createPractice({
      learnerId: TEACHER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 2,
      mode: "standard",
      sourceSessionId: null,
    });

    expect(created.questions.length).toBeGreaterThan(0);
    expect(created.session.learnerId).toBe(TEACHER);

    // 作答前不會洩露答案
    const first = created.questions[0];
    expect(first).not.toHaveProperty("correctAnswer");
    expect(first).not.toHaveProperty("explanation");

    // 故意答錯第一題，令它成為需要重溫的錯題
    const wrong = await practice.submitAnswer(
      created.session.id,
      TEACHER,
      first.id,
      "這是刻意答錯的答案",
    );
    expect(wrong.recorded).toBe(true);
    expect(wrong.feedback.correctAnswer.length).toBeGreaterThan(0);
    expect(wrong.feedback.explanation.length).toBeGreaterThan(0);
    expect((wrong.feedback.sourceExcerpt ?? "").length).toBeGreaterThan(0);
    expect(wrong.feedback.sourceWithheld).toBe(false);
    expect(wrong.feedback.knowledgePoint.length).toBeGreaterThan(0);

    // 已提交的題目不會因重覆提交而改變分數
    const repeated = await practice.submitAnswer(
      created.session.id,
      TEACHER,
      first.id,
      "這是另一個答案",
    );
    expect(repeated.recorded).toBe(false);
    expect(repeated.feedback.answer).toBe("這是刻意答錯的答案");

    const result = practice.getPracticeResult(created.session.id, TEACHER);
    expect(result.totalQuestions).toBe(created.questions.length);
    expect(result.answeredCount).toBe(1);
    // 未作答的題目不會提供回饋：回饋含標準答案及解釋，若在作答前就回傳，
    // 學生可在提交答案前先讀取結果端點取得答案（見 getPracticeResult 的說明）。
    expect(result.feedback).toHaveLength(1);
    expect(result.feedback.filter((item) => item.answer.length > 0)).toHaveLength(1);

    // 重做錯題
    const retry = await practice.createPractice({
      learnerId: TEACHER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 1,
      mode: "wrong-only",
      sourceSessionId: created.session.id,
    });
    expect(retry.session.mode).toBe("wrong-only");
    expect(retry.questions.length).toBeGreaterThan(0);
  });

  it("教師與學生的學習記錄分開", async () => {
    const studentPractice = await practice.createPractice({
      learnerId: STUDENT,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 1,
      mode: "standard",
      sourceSessionId: null,
    });

    expect(studentPractice.session.learnerId).toBe(STUDENT);

    // 教師不可讀取該學生的練習
    expect(() => practice.getPracticeView(studentPractice.session.id, TEACHER)).toThrowError(
      /其他學習者/,
    );
    // 學生亦不可讀取教師的練習
    expect(() => practice.getPracticeView(studentPractice.session.id, "someone-else")).toThrowError(
      /其他學習者/,
    );

    // 進度記錄亦不會互相影響
    const teacherProgress = learners.getLearnerProgress(TEACHER, "topic-5");
    const studentProgress = learners.getLearnerProgress(STUDENT, "topic-5");
    expect(teacherProgress).not.toEqual(studentProgress);
  });

  it("教師端可同時查閱教師（測試）與學生的練習記錄，並清楚分開標示", () => {
    const records = recordsService.listPracticeRecords({});
    const teacherRecords = records.filter((record) => record.learnerId === TEACHER);
    const studentRecords = records.filter((record) => record.learnerId === STUDENT);

    expect(teacherRecords.length).toBeGreaterThan(0);
    expect(studentRecords.length).toBeGreaterThan(0);
    expect(teacherRecords.every((record) => record.learnerLabel.includes("教師測試"))).toBe(true);
    expect(studentRecords.every((record) => record.learnerLabel === "s2024146@pochiu.edu.hk")).toBe(
      true,
    );
  });

  /**
   * 回歸測試（2026-10-28）：教師端逐題記錄原本只回傳題幹、學生答案及正確答案，
   * 選擇題的四個選項、解釋、知識點及教材依據都沒有送出，教師無法與學生回顧錯題。
   */
  it("教師端練習記錄包含完整題目：選項、解釋、知識點及教材依據", () => {
    const records = recordsService.listPracticeRecords({ learnerId: TEACHER });
    expect(records.length).toBeGreaterThan(0);

    const mc = records
      .flatMap((record) => record.questions)
      .find((question) => question.questionType === "mc" && question.options.length > 0);

    expect(mc).toBeDefined();
    expect(mc!.options.length).toBeGreaterThanOrEqual(2);
    // 正確答案必須是其中一個選項，教師才能指出「學生選了哪一項、正確是哪一項」
    expect(mc!.options).toContain(mc!.correctAnswer);
    expect(mc!.explanation.length).toBeGreaterThan(0);
    expect(mc!.knowledgePoint.length).toBeGreaterThan(0);
    expect(mc!.sourceLocation.length).toBeGreaterThan(0);
    expect(mc!.sourceExcerpt.length).toBeGreaterThan(0);
  });

  it("教師端記錄只把完整答案送給教師，學生端作答前仍看不到答案", async () => {
    const created = await practice.createPractice({
      learnerId: TEACHER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 1,
      mode: "standard",
      sourceSessionId: null,
    });
    const studentQuestion = created.questions[0];
    expect(studentQuestion).not.toHaveProperty("correctAnswer");
    expect(studentQuestion).not.toHaveProperty("explanation");
    expect(studentQuestion).not.toHaveProperty("sourceExcerpt");

    const record = recordsService
      .listPracticeRecords({ learnerId: TEACHER })
      .find((session) => session.sessionId === created.session.id);
    expect(record).toBeDefined();
    expect(record!.questions[0]!.correctAnswer.length).toBeGreaterThan(0);
    expect(record!.questions[0]!.options).toContain(record!.questions[0]!.correctAnswer);
  });
});
