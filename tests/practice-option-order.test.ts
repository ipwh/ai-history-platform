import { beforeAll, describe, expect, it } from "vitest";

import { freshTestDatabasePath } from "./test-database";

/**
 * 選項次序、快照重現及「按答案身分評分」的端到端測試（Sprint 23）。
 *
 * 這一組測試刻意不使用「選項次序有變」作為唯一的成功條件：
 * 次序有變不代表分佈均勻，也不代表表面線索已解決（Sprint 22 已證實 shuffle 只會
 * 重新排列字串，最長選項的身分不變）。因此這裡驗證的是**可驗證的不變量**：
 *   1. 快照中的選項是題庫選項的排列（不多、不少、不改寫）；
 *   2. 不論正確答案在學生畫面中的哪個位置，以答案文字提交都會被判為正確；
 *   3. 重新讀取同一練習，選項次序不變（快照已凍結）；
 *   4. 學生端不會收到 `correctAnswer`／`explanation`；
 *   5. 錯題重做同樣經過打亂，而且仍然按答案身分評分。
 */
const testDbPath = freshTestDatabasePath("practice-option-order");
process.env.APP_DATABASE_PATH = testDbPath;
process.env.LLM_PROVIDER = "mock";

type PracticeService = typeof import("@/server/services/practice-service");
type QuestionRepository = typeof import("@/server/repositories/questions");
type Seed = typeof import("@/server/seed");

let practice: PracticeService;
let questionsRepo: QuestionRepository;
let seed: Seed;

const LEARNER = "test-learner-option-order";
const TOPIC = "topic-5";
/**
 * 用一個沒有示範題的分節（`topic-5-renaissance`；示範題庫只覆蓋
 * `topic-5-renaissance-reformation` 等分節），令這次練習的題目池剛好是下面四題，
 * 測試不必依賴隨機抽題結果。
 */
const SECTION = "topic-5-renaissance";

/**
 * 四個選項；每題刻意把正確答案放在題庫中的不同位置（A/B/C/D）。
 *
 * 題幹刻意**不含**正確答案：`checkQuestionServable` 會攔截「答案已出現在題幹」的題目，
 * 這種題目不會進入學生練習的題目池（測試若用這種題幹，會誤以為抽題邏輯壞了）。
 */
const BANK_QUESTIONS = [
  {
    id: "q-opt-order-a",
    correctIndex: 0,
    label: "Ａ",
    options: ["甲城", "乙城", "丙城", "丁城"],
  },
  {
    id: "q-opt-order-b",
    correctIndex: 1,
    label: "Ｂ",
    options: ["戊城", "己城", "庚城", "辛城"],
  },
  {
    id: "q-opt-order-c",
    correctIndex: 2,
    label: "Ｃ",
    options: ["壬城", "癸城", "子城", "丑城"],
  },
  {
    id: "q-opt-order-d",
    correctIndex: 3,
    label: "Ｄ",
    options: ["寅城", "卯城", "辰城", "巳城"],
  },
] as const;

function insertMcq(entry: (typeof BANK_QUESTIONS)[number]): void {
  questionsRepo.insertQuestion({
    id: entry.id,
    topicId: TOPIC,
    sectionId: SECTION,
    questionType: "mc",
    difficulty: "basic",
    question: `（合成測試題${entry.label}）下列哪一項是這座城市的別稱？`,
    options: [...entry.options],
    correctAnswer: entry.options[entry.correctIndex],
    acceptedAnswers: [],
    explanation: "測試用解釋：這題只用來驗證選項次序及評分，不是歷史題目。",
    knowledgePoint: "測試",
    sourceExcerpt: `（合成測試題${entry.label}）${entry.options.join("、")}`,
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
    createdAt: "2026-10-23T00:00:00.000Z",
  });
}

function sortedCopy(values: readonly string[]): string[] {
  return [...values].sort();
}

beforeAll(async () => {
  practice = await import("@/server/services/practice-service");
  questionsRepo = await import("@/server/repositories/questions");
  seed = await import("@/server/seed");
  seed.ensureBootstrap();
  for (const entry of BANK_QUESTIONS) insertMcq(entry);
});

describe("選項次序與評分", () => {
  it("快照保留全部選項、學生端不含答案，並按答案身分評分", async () => {
    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: TOPIC,
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 4,
      mode: "standard",
      sourceSessionId: null,
    });

    const sessionId = assembled.session.id;
    const sessionQuestions = assembled.questions.filter((question) =>
      BANK_QUESTIONS.some((entry) => entry.id === question.id),
    );
    expect(sessionQuestions).toHaveLength(BANK_QUESTIONS.length);

    for (const entry of BANK_QUESTIONS) {
      const bank = [...entry.options];
      const presented = sessionQuestions.find((question) => question.id === entry.id);
      expect(presented).toBeDefined();
      // 1. 選項是題庫的排列，沒有增減或改寫
      expect(sortedCopy(presented!.options)).toEqual(sortedCopy(bank));
      expect(presented!.options).toHaveLength(bank.length);
      // 4. 學生端永遠不會收到答案或解釋（屬性不存在，而不是值為空）
      expect(Object.hasOwn(presented!, "correctAnswer")).toBe(false);
      expect(Object.hasOwn(presented!, "explanation")).toBe(false);
    }

    // 2. 不論正確答案此刻在哪個位置，以答案文字提交都必須正確
    for (const entry of BANK_QUESTIONS) {
      const correctText = entry.options[entry.correctIndex];
      const result = await practice.submitAnswer(sessionId, LEARNER, entry.id, correctText);
      expect(result.feedback.isCorrect, entry.id).toBe(true);
    }
  });

  it("以錯誤選項提交會判為錯誤（不是「永遠答對」）", async () => {
    const assembled = await practice.createPractice({
      learnerId: "test-learner-wrong",
      topicId: TOPIC,
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 4,
      mode: "standard",
      sourceSessionId: null,
    });
    const entry = BANK_QUESTIONS[0];
    const wrongText = entry.options[(entry.correctIndex + 1) % entry.options.length];
    const result = await practice.submitAnswer(
      assembled.session.id,
      "test-learner-wrong",
      entry.id,
      wrongText,
    );
    expect(result.feedback.isCorrect).toBe(false);
  });

  it("重新讀取同一練習時，選項次序不變（快照已凍結）", async () => {
    const assembled = await practice.createPractice({
      learnerId: "test-learner-reload",
      topicId: TOPIC,
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 4,
      mode: "standard",
      sourceSessionId: null,
    });
    const sessionId = assembled.session.id;
    const first = practice.getPracticeView(sessionId, "test-learner-reload");
    const second = practice.getPracticeView(sessionId, "test-learner-reload");
    expect(second.questions).toEqual(first.questions);
    expect(second.questions.map((question) => question.options)).toEqual(
      first.questions.map((question) => question.options),
    );
  });

  it("學生端回應不含品質診斷或教師資訊（不外洩內部診斷）", async () => {
    const assembled = await practice.createPractice({
      learnerId: "test-learner-no-leak",
      topicId: TOPIC,
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 4,
      mode: "standard",
      sourceSessionId: null,
    });
    const view = practice.getPracticeView(assembled.session.id, "test-learner-no-leak");
    const payload = JSON.stringify({ questions: view.questions, notice: view.notice });
    expect(payload).not.toContain("qualityWarnings");
    expect(payload).not.toContain("option-quality/v");
    expect(payload).not.toContain("correctAnswer");
    expect(payload).not.toContain("explanation");
    expect(payload).not.toContain("teacherConfirmationRequired");
  });

  it("錯題重做同樣以答案身分評分，且選項仍是題庫的排列", async () => {
    const learnerId = "test-learner-retry";
    const first = await practice.createPractice({
      learnerId,
      topicId: TOPIC,
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 4,
      mode: "standard",
      sourceSessionId: null,
    });
    const entry = BANK_QUESTIONS[1];
    const wrongText = entry.options[(entry.correctIndex + 1) % entry.options.length];
    await practice.submitAnswer(first.session.id, learnerId, entry.id, wrongText);

    const retry = await practice.createPractice({
      learnerId,
      topicId: TOPIC,
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 4,
      mode: "wrong-only",
      sourceSessionId: first.session.id,
    });
    const retried = retry.questions.find((question) => question.id === entry.id);
    expect(retried).toBeDefined();
    expect(sortedCopy(retried!.options)).toEqual(sortedCopy(entry.options));

    const correct = await practice.submitAnswer(
      retry.session.id,
      learnerId,
      entry.id,
      entry.options[entry.correctIndex],
    );
    expect(correct.feedback.isCorrect).toBe(true);
  });
});
