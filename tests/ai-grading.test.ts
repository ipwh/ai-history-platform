import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// 使用獨立暫存資料庫，並以 DeepSeek 設定模擬「已接上 AI」的情況（fetch 會被 stub，不會真的發送請求）
const testDbPath = path.join(os.tmpdir(), `hist-test-ai-grading-${process.pid}.db`);
process.env.APP_DATABASE_PATH = testDbPath;
process.env.LLM_PROVIDER = "deepseek";
process.env.DEEPSEEK_API_KEY = "sk-test";
process.env.LLM_GRADING_ENABLED = "true";

type PracticeService = typeof import("@/server/services/practice-service");
type QuestionRepository = typeof import("@/server/repositories/questions");
type GraderModule = typeof import("@/server/llm/grader");
type Seed = typeof import("@/server/seed");

let practice: PracticeService;
let questionsRepo: QuestionRepository;
let grader: GraderModule;
let seed: Seed;

const LEARNER = "ai-grading-learner";
/** 示範題庫中有填充題及短答題的分節（各一題） */
const SECTION = "topic-5-reformation-development";
/** 示範題庫中有選擇題的分節 */
const MC_SECTION = "topic-5-renaissance-features";

function gradingResponse(payload: unknown): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

beforeAll(async () => {
  practice = await import("@/server/services/practice-service");
  questionsRepo = await import("@/server/repositories/questions");
  grader = await import("@/server/llm/grader");
  seed = await import("@/server/seed");
  seed.ensureBootstrap();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AI 語意批改結果的驗證", () => {
  it("短答題以達到要點的比例決定判斷，並列出未達到的要點", () => {
    const result = grader.parseGradingResult(
      { verdict: "incorrect", hitPointIndexes: [0, 5], feedback: "已提到人文主義。" },
      { questionType: "short", gradingPoints: ["重視人文主義", "復興古典文化", "重視理性"] },
    );
    expect(result).not.toBeNull();
    expect(result!.hitPoints).toEqual(["重視人文主義"]);
    // 達 1 / 3 個要點 → 部分達到（即使模型原本判為 incorrect）
    expect(result!.verdict).toBe("partial");
    expect(result!.missingPoints).toEqual(["復興古典文化", "重視理性"]);
  });

  it("全部要點達到即當作正確，全部未達到即當作未達到", () => {
    const all = grader.parseGradingResult(
      { verdict: "partial", hitPointIndexes: [0, 1], feedback: "很好。" },
      { questionType: "short", gradingPoints: ["甲", "乙"] },
    );
    expect(all!.verdict).toBe("correct");

    const none = grader.parseGradingResult(
      { verdict: "partial", hitPointIndexes: [], feedback: "未達到。" },
      { questionType: "short", gradingPoints: ["甲", "乙"] },
    );
    expect(none!.verdict).toBe("incorrect");
  });

  it("越界的要點索引不會出錯，填充題不會回傳要點", () => {
    const result = grader.parseGradingResult(
      { verdict: "correct", hitPointIndexes: [7, -1], feedback: "意思相同。" },
      { questionType: "fill", gradingPoints: [] },
    );
    expect(result!.hitPoints).toEqual([]);
    expect(result!.missingPoints).toEqual([]);
    expect(result!.verdict).toBe("correct");
  });

  it("短答題沒有回饋文字時視為不可用", () => {
    expect(
      grader.parseGradingResult(
        { verdict: "correct", hitPointIndexes: [], feedback: "   " },
        { questionType: "short", gradingPoints: ["甲"] },
      ),
    ).toBeNull();
  });

  it("填充題的判斷不會被要點影響，並提供預設回饋", () => {
    const result = grader.parseGradingResult(
      { verdict: "correct", hitPointIndexes: [], feedback: "" },
      { questionType: "fill", gradingPoints: [] },
    );
    expect(result!.verdict).toBe("correct");
    expect(result!.feedback.length).toBeGreaterThan(0);
  });
});

describe("提交答案時的 AI 語意批改", () => {
  it("填充題用字不同但 AI 判定意思相同時，會當作答對", async () => {
    let submittedAnswer = "";
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as {
          messages: { role: string; content: string }[];
        };
        const userMessage = body.messages.find((message) => message.role === "user");
        submittedAnswer = userMessage?.content ?? "";
        return Promise.resolve(
          gradingResponse({ verdict: "correct", hitPointIndexes: [], feedback: "意思與標準答案相同。" }),
        );
      }),
    );

    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["fill"],
      difficulty: "basic",
      questionCount: 1,
      mode: "standard",
      sourceSessionId: null,
    });

    const question = questionsRepo.getQuestion(assembled.questions[0].id);
    expect(question).not.toBeNull();

    // 故意用不同的字（尾隨補充說明），逐字比對會判定錯誤
    const submit = await practice.submitAnswer(
      assembled.session.id,
      LEARNER,
      assembled.questions[0].id,
      `${question!.correctAnswer}（補充說明）`,
    );

    expect(submit.recorded).toBe(true);
    expect(submit.feedback.isCorrect).toBe(true);
    expect(submit.feedback.aiGrading?.verdict).toBe("correct");
    // 批改提示要包含標準答案以外的資訊，證明真的送出了學生答案
    expect(submittedAnswer).toContain("補充說明");
    expect(submittedAnswer.toLowerCase()).toContain("json");

    // 重新讀取時仍然有 AI 批改結果（已寫入作答記錄）
    const view = practice.getPracticeView(assembled.session.id, LEARNER);
    expect(view.feedback[0].aiGrading?.verdict).toBe("correct");
  });

  it("短答題不會自動評分，但會附上 AI 依得分要點的批改", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          gradingResponse({
            verdict: "correct",
            hitPointIndexes: [0],
            feedback: "你提到人文主義，方向正確。",
          }),
        ),
      ),
    );

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
      "文藝復興重視人的價值。",
    );

    expect(submit.feedback.autoGraded).toBe(false);
    expect(submit.feedback.isCorrect).toBeNull();
    expect(submit.feedback.aiGrading).not.toBeNull();
    expect(submit.feedback.aiGrading!.hitPoints.length).toBeGreaterThan(0);
    expect(submit.feedback.aiGrading!.missingPoints.length).toBeGreaterThan(0);

    // 正確率不受短答題影響（只有 1 題短答題 → 沒有可自動評分的題目）
    const result = practice.getPracticeResult(assembled.session.id, LEARNER);
    expect(result.gradedCount).toBe(0);
    expect(result.accuracy).toBeNull();
  });

  it("批改失敗時不會影響提交，並提示只提供參考答案", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));

    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["fill"],
      difficulty: "basic",
      questionCount: 1,
      mode: "standard",
      sourceSessionId: null,
    });

    const question = assembled.questions[0];
    const submit = await practice.submitAnswer(
      assembled.session.id,
      LEARNER,
      question.id,
      "完全不同的答案",
    );

    expect(submit.recorded).toBe(true);
    expect(submit.feedback.isCorrect).toBe(false);
    expect(submit.feedback.aiGrading?.note).toContain("暫時無法使用");
  });

  it("選擇題不會呼叫 AI 批改", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(gradingResponse({ verdict: "correct" })));
    vi.stubGlobal("fetch", fetchMock);

    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [MC_SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 1,
      mode: "standard",
      sourceSessionId: null,
    });

    const question = assembled.questions[0];
    const correct = questionsRepo.getQuestion(question.id);
    const submit = await practice.submitAnswer(
      assembled.session.id,
      LEARNER,
      question.id,
      correct!.correctAnswer,
    );

    expect(submit.feedback.isCorrect ?? false).toBe(true);
    expect(submit.feedback.aiGrading).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
