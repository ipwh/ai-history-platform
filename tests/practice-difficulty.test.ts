/**
 * 選擇題難度必須跟隨學生的選擇（2026-10-21）。
 *
 * 背景：練習設定改為「一次只練一種題型」。選擇題可調節難度；填充題不設難度。
 * 題庫目前以基礎題為主，若沿用舊行為（先用其他難度補足、最後才生成），
 * 學生選「進階／挑戰」時只會拿到基礎題，難度選擇形同虛設。
 *
 * 這裡鎖定新的次序：
 *   1. 題庫有足夠所選難度 → 全部都是所選難度，不顯示補足通知；
 *   2. 所選難度不足 → 先嘗試以所選難度即時生成；
 *   3. 生成仍不足 → 才用其他難度補足，並**如實說明**（不可靜默替換）。
 * 填充題不設難度，沿用原本「先用題庫、最後才生成」的次序。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabasePath } from "./test-database";

const testDbPath = freshTestDatabasePath("practice-difficulty");
process.env.APP_DATABASE_PATH = testDbPath;
process.env.LLM_PROVIDER = "mock";
process.env.AI_LIMITS_ENABLED = "false";

type PracticeService = typeof import("@/server/services/practice-service");
type QuestionRepository = typeof import("@/server/repositories/questions");
type Seed = typeof import("@/server/seed");

let practice: PracticeService;
let questionsRepo: QuestionRepository;
let seed: Seed;

const LEARNER = "test-difficulty-learner";
const SECTION = "topic-5-renaissance-reformation";
let sequence = 0;

function insertMc(difficulty: "basic" | "advanced" | "challenge", stem: string): string {
  sequence += 1;
  const id = `q-difficulty-${sequence}`;
  questionsRepo.insertQuestion({
    id,
    topicId: "topic-5",
    sectionId: SECTION,
    questionType: "mc",
    difficulty,
    question: stem,
    options: ["意大利", "法國", "德國", "英國"],
    correctAnswer: "意大利",
    acceptedAnswers: [],
    explanation: "文藝復興最先在意大利城邦興起。",
    knowledgePoint: "文藝復興",
    sourceExcerpt: "文藝復興最先在意大利興起。",
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
    createdAt: "2026-10-21T00:00:00.000Z",
  });
  return id;
}

function insertFill(difficulty: "basic" | "advanced" | "challenge", stem: string, answer: string): string {
  sequence += 1;
  const id = `q-difficulty-${sequence}`;
  questionsRepo.insertQuestion({
    id,
    topicId: "topic-5",
    sectionId: SECTION,
    questionType: "fill",
    difficulty,
    question: stem,
    options: [],
    correctAnswer: answer,
    acceptedAnswers: [],
    explanation: "測試用解釋。",
    knowledgePoint: "文藝復興",
    sourceExcerpt: stem,
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
    createdAt: "2026-10-21T00:00:00.000Z",
  });
  return id;
}

beforeAll(async () => {
  practice = await import("@/server/services/practice-service");
  questionsRepo = await import("@/server/repositories/questions");
  seed = await import("@/server/seed");
  seed.ensureBootstrap();

  // 進階 2 題、挑戰 1 題、基礎 3 題；另有基礎填充題供對照
  insertMc("advanced", "文藝復興最先興起於下列哪一個地區？（進階一）");
  insertMc("advanced", "文藝復興最先興起於下列哪一個地區？（進階二）");
  insertMc("challenge", "文藝復興最先興起於下列哪一個地區？（挑戰一）");
  for (let index = 0; index < 3; index += 1) {
    insertMc("basic", `文藝復興最先興起於下列哪一個地區？（基礎${index + 1}）`);
  }
  insertFill("basic", "文藝復興最先興起於哪一個國家？＿＿＿", "意大利");
});

describe("選擇題難度跟隨學生選擇", () => {
  it("題庫有足夠所選難度時，全部題目都是所選難度，毋須補足", async () => {
    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "advanced",
      questionCount: 2,
      mode: "standard",
      sourceSessionId: null,
    });

    expect(assembled.questions).toHaveLength(2);
    expect(assembled.questions.every((question) => question.difficulty === "advanced")).toBe(true);
    expect(assembled.notice ?? "").not.toContain("其他難度");
  });

  it("所選難度不足時，先按所選難度生成；生成不足才用其他難度補足並如實說明", async () => {
    // 測試環境沒有教材段落，即時生成必定失敗 → 只可以退用其他難度，
    // 因此正好驗證「最後才補足」及通知措辭（不會靜默替換）。
    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "challenge",
      questionCount: 3,
      mode: "standard",
      sourceSessionId: null,
    });

    const challengeCount = assembled.questions.filter(
      (question) => question.difficulty === "challenge",
    ).length;
    expect(challengeCount).toBe(1);
    expect(assembled.questions).toHaveLength(3);
    expect(assembled.notice ?? "").toContain("所選難度的題目仍然不足，已加入其他難度的題目補足");
  });

  it("填充題不設難度：沿用原有次序，題庫不足時可直接以其他難度補足", async () => {
    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["fill"],
      difficulty: "advanced",
      questionCount: 1,
      mode: "standard",
      sourceSessionId: null,
    });

    expect(assembled.questions).toHaveLength(1);
    expect(assembled.questions[0]?.difficulty).toBe("basic");
    expect(assembled.notice ?? "").toContain("所選難度的題目不足，已加入其他難度的題目補足");
  });
});
