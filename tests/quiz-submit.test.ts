/**
 * 獨立批改端點（POST /api/quiz/submit）測試。
 *
 * 驗證：
 *   1. 提交後才由伺服器比對標準答案，並回傳作答結果、正確答案及解釋。
 *   2. 歷史專名同義詞（江寧條約＝南京條約、WWI＝第一次世界大戰）在批改端點同樣生效。
 *   3. 未發布或不可作答的題目不可用作取得答案的入口。
 *   4. 帶練習場境的提交會記錄作答，重複提交不會改變分數。
 *   5. 多個空格的作答逐項比對。
 */
import { beforeAll, describe, expect, it } from "vitest";

import { gradeSubmittedAnswer } from "@/server/services/grading";
import { questionSchema, type Question } from "@/lib/types";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("quiz-submit");
process.env.LLM_PROVIDER = "mock";
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;

type QuestionRepository = typeof import("@/server/repositories/questions");
type PracticeService = typeof import("@/server/services/practice-service");
type Seed = typeof import("@/server/seed");

let questionsRepo: QuestionRepository;
let practice: PracticeService;
let seed: Seed;

const LEARNER = "test-learner-quiz";
const SECTION = "topic-5-renaissance-reformation";

interface QuizPayload {
  questionId: string;
  studentAnswer: string;
  isCorrect: boolean | null;
  autoGraded: boolean;
  correctAnswer: string;
  explanation: string;
  knowledgePoint: string;
  recorded: boolean;
  answeredCount: number | null;
  totalQuestions: number | null;
}

function buildQuestion(overrides: Partial<Question> & Pick<Question, "id">): Question {
  return questionSchema.parse({
    topicId: "topic-5",
    sectionId: SECTION,
    questionType: "fill",
    difficulty: "basic",
    question: "＿＿＿是文藝復興的核心思想。",
    options: [],
    correctAnswer: "人文主義",
    acceptedAnswers: [],
    explanation: "文藝復興重視人的價值。",
    knowledgePoint: "人文主義",
    sourceExcerpt: "教材節錄內容",
    sourceLocation: "測試位置",
    origin: "school-paper",
    status: "published",
    sourceVerified: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  });
}

async function submit(body: Record<string, unknown>): Promise<{
  status: number;
  payload: Record<string, unknown>;
}> {
  const { POST } = await import("@/app/api/quiz/submit/route");
  const response = await POST(
    new Request("http://localhost:3000/api/quiz/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ learnerId: LEARNER, ...body }),
    }),
  );
  return { status: response.status, payload: (await response.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  questionsRepo = await import("@/server/repositories/questions");
  practice = await import("@/server/services/practice-service");
  seed = await import("@/server/seed");
  seed.ensureBootstrap();

  questionsRepo.insertQuestion(
    buildQuestion({
      id: "q-quiz-fill-ww1",
      question: "＿＿＿是一場發生於1914至1918年的世界大戰。",
      correctAnswer: "第一次世界大戰",
      explanation: "1914至1918年的全球衝突稱為第一次世界大戰。",
      knowledgePoint: "第一次世界大戰",
    }),
  );
  questionsRepo.insertQuestion(
    buildQuestion({
      id: "q-quiz-fill-treaty",
      question: "1842年，清廷與英國簽訂《＿＿＿》。",
      correctAnswer: "南京條約",
      explanation: "南京條約是第一次鴉片戰爭後簽訂的條約。",
      knowledgePoint: "南京條約",
    }),
  );
  questionsRepo.insertQuestion(
    buildQuestion({
      id: "q-quiz-mc",
      questionType: "mc",
      question: "1939年至1945年間發生的是哪一場戰爭？",
      options: ["第一次世界大戰", "第二次世界大戰", "冷戰", "韓戰"],
      correctAnswer: "第二次世界大戰",
      explanation: "第二次世界大戰由1939年持續至1945年。",
      knowledgePoint: "第二次世界大戰",
    }),
  );
  questionsRepo.insertQuestion(
    buildQuestion({
      id: "q-quiz-draft",
      question: "＿＿＿是尚未發布的題目。",
      correctAnswer: "草稿",
      status: "draft",
    }),
  );
});

describe("獨立批改端點", () => {
  it("答對時回傳分數、正確答案及解釋", async () => {
    const result = await submit({
      questionId: "q-quiz-fill-ww1",
      studentAnswer: "第一次世界大戰",
    });

    expect(result.status).toBe(200);
    const payload = result.payload as unknown as QuizPayload;
    expect(payload.isCorrect).toBe(true);
    expect(payload.autoGraded).toBe(true);
    expect(payload.correctAnswer).toBe("第一次世界大戰");
    expect(payload.explanation.length).toBeGreaterThan(0);
    expect(payload.knowledgePoint.length).toBeGreaterThan(0);
    // 沒有練習場境：不寫入作答記錄，亦沒有進度
    expect(payload.recorded).toBe(false);
    expect(payload.answeredCount).toBeNull();
    expect(payload.totalQuestions).toBeNull();
  });

  it("答錯時仍然在批改後提供正確答案（供學生學習）", async () => {
    const result = await submit({
      questionId: "q-quiz-mc",
      studentAnswer: "冷戰",
    });

    expect(result.status).toBe(200);
    const payload = result.payload as unknown as QuizPayload;
    expect(payload.isCorrect).toBe(false);
    expect(payload.correctAnswer).toBe("第二次世界大戰");
  });

  it("接受歷史專名的同義詞及英文寫法", async () => {
    const treaty = await submit({
      questionId: "q-quiz-fill-treaty",
      studentAnswer: " 江寧條約。 ",
    });
    expect(treaty.status).toBe(200);
    expect((treaty.payload as unknown as QuizPayload).isCorrect).toBe(true);

    const war = await submit({ questionId: "q-quiz-fill-ww1", studentAnswer: "WWI" });
    expect(war.status).toBe(200);
    expect((war.payload as unknown as QuizPayload).isCorrect).toBe(true);
  });

  it("未發布的題目不可用作取得答案的入口", async () => {
    const result = await submit({ questionId: "q-quiz-draft", studentAnswer: "草稿" });
    expect(result.status).toBe(409);
    expect(String(result.payload.error)).toContain("不開放");
    expect(result.payload).not.toHaveProperty("correctAnswer");
  });

  it("找不到題目時回傳 404", async () => {
    const result = await submit({ questionId: "q-does-not-exist", studentAnswer: "答案" });
    expect(result.status).toBe(404);
  });

  it("空白作答會被拒絕", async () => {
    const result = await submit({ questionId: "q-quiz-fill-ww1", studentAnswer: "   " });
    expect(result.status).toBe(400);
  });

  it("回應不會重複使用練習流程的欄位名稱（answer），統一使用 studentAnswer", async () => {
    const result = await submit({ questionId: "q-quiz-fill-ww1", studentAnswer: "一戰" });
    expect(result.payload.studentAnswer).toBe("一戰");
    expect(result.payload).not.toHaveProperty("answer");
  });
});

describe("帶練習場境的提交", () => {
  it("記錄作答並回傳進度，重複提交不改變分數", async () => {
    const created = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 2,
      mode: "standard",
      sourceSessionId: null,
    });
    const target = created.questions[0];
    const bank = questionsRepo.getQuestion(target.id)!;

    const first = await submit({
      sessionId: created.session.id,
      questionId: target.id,
      studentAnswer: "刻意答錯",
    });
    expect(first.status).toBe(200);
    const firstPayload = first.payload as unknown as QuizPayload;
    expect(firstPayload.recorded).toBe(true);
    expect(firstPayload.answeredCount).toBe(1);
    expect(firstPayload.totalQuestions).toBe(created.questions.length);
    expect(firstPayload.isCorrect).toBe(false);

    // 同一題再提交一次：不會改變分數，亦不會重複記錄
    const second = await submit({
      sessionId: created.session.id,
      questionId: target.id,
      studentAnswer: bank.correctAnswer,
    });
    expect(second.status).toBe(200);
    const secondPayload = second.payload as unknown as QuizPayload;
    expect(secondPayload.recorded).toBe(false);
    expect(secondPayload.isCorrect).toBe(false);
    expect(secondPayload.answeredCount).toBe(1);
  });
});

describe("課題發布狀態", () => {
  it("未發布課題的題目不可透過批改端點取得答案", async () => {
    const topics = await import("@/server/repositories/topics");
    topics.setTopicPublished("topic-5", false);
    try {
      const result = await submit({
        questionId: "q-quiz-fill-ww1",
        studentAnswer: "第一次世界大戰",
      });
      expect(result.status).toBe(404);
      expect(result.payload).not.toHaveProperty("correctAnswer");
    } finally {
      topics.setTopicPublished("topic-5", true);
    }
  });
});

describe("多個空格的作答", () => {
  const question = buildQuestion({ id: "q-multi-blank", correctAnswer: "甲 / 乙" });

  it("全部填對才當作正確", () => {
    const correct = gradeSubmittedAnswer(question, ["甲", "乙"]);
    expect(correct.isCorrect).toBe(true);

    const wrong = gradeSubmittedAnswer(question, ["甲", "丙"]);
    expect(wrong.isCorrect).toBe(false);
  });

  it("只作答其中一個可接受寫法仍然正確（「/」代表可接受的替代寫法）", () => {
    expect(gradeSubmittedAnswer(question, ["甲"]).isCorrect).toBe(true);
  });

  it("項數與標準答案不一致時，串接後比對（不會誤判為正確）", () => {
    const single = buildQuestion({ id: "q-single-answer", correctAnswer: "人文主義" });
    expect(gradeSubmittedAnswer(single, ["人", "文"]).isCorrect).toBe(false);
  });

  it("單一答案與字串作答行為一致", () => {
    expect(gradeSubmittedAnswer(question, "甲").isCorrect).toBe(true);
    expect(gradeSubmittedAnswer(question, ["甲"]).isCorrect).toBe(true);
    expect(gradeSubmittedAnswer(question, "丙").isCorrect).toBe(false);
  });
});
