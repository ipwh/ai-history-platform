/**
 * 品質警告的存取測試。
 * 警告只供教師核對（例如題目出現教材未提及的人名／條約名），
 * 必須能寫入題庫、讀回，而且不可出現在學生端題目。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabasePath } from "./test-database";

const testDbPath = freshTestDatabasePath("warnings");
process.env.APP_DATABASE_PATH = testDbPath;

type QuestionRepository = typeof import("@/server/repositories/questions");
type Seed = typeof import("@/server/seed");

let questionsRepo: QuestionRepository;
let seed: Seed;
let types: typeof import("@/lib/types");

const WARNING = "題目出現教材未提及的人名（喀爾文），可能是杜撰人物，請核對教材後才發布";

beforeAll(async () => {
  questionsRepo = await import("@/server/repositories/questions");
  seed = await import("@/server/seed");
  types = await import("@/lib/types");
  seed.ensureBootstrap();
});

describe("題目的品質警告", () => {
  it("品質警告會寫入資料庫並可讀回", () => {
    const question = types.questionSchema.parse({
      id: "q-warning-demo",
      topicId: "topic-5",
      sectionId: "topic-5-renaissance-reformation",
      questionType: "fill",
      difficulty: "basic",
      question: "宗教改革期間，提出《基督教要義》的改革者是誰？",
      options: [],
      correctAnswer: "喀爾文",
      acceptedAnswers: [],
      explanation: "喀爾文在日內瓦推行宗教改革。",
      knowledgePoint: "宗教改革的發展",
      sourceExcerpt: "德意志神學家馬丁路德發表《九十五條論證》",
      sourceLocation: "教材 DOCX · 第 1 段",
      sourceBlockIds: ["blk_1"],
      gradingPoints: [],
      origin: "material-ai",
      status: "draft",
      sourceVerified: true,
      qualityWarnings: [WARNING],
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const saved = questionsRepo.insertQuestion(question);
    expect(saved.qualityWarnings).toEqual([WARNING]);
    expect(questionsRepo.getQuestion(question.id)?.qualityWarnings).toEqual([WARNING]);

    // 學生端的題目不含答案，也不含教師查核用的警告
    const student = types.studentQuestionSchema.parse(saved);
    expect(student).not.toHaveProperty("qualityWarnings");
    expect(student).not.toHaveProperty("correctAnswer");

    // 教師核對並修改題目後，警告會被清除
    questionsRepo.updateQuestion(question.id, { ...saved, qualityWarnings: [] });
    expect(questionsRepo.getQuestion(question.id)?.qualityWarnings).toEqual([]);
  });

  it("題庫內沒有警告的題目讀回空陣列", () => {
    const questions = questionsRepo.listQuestions({ topicId: "topic-5" });
    expect(questions.length).toBeGreaterThan(0);
    for (const question of questions) {
      expect(Array.isArray(question.qualityWarnings)).toBe(true);
    }
  });
});
