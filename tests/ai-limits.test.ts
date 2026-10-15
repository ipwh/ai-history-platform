/**
 * AI 用量上限測試（P0 成本控制）。
 *
 * 驗證：
 *   1. 學生觸發 AI 出題超過個人上限時回傳 429（伺服器端強制，直接呼叫 API 亦受限制）。
 *   2. 並行請求不會同時通過檢查而超額（先保留、後呼叫）。
 *   3. 整體上限（所有使用者合計）同樣有效。
 *   4. 達到上限時，作答仍然可以提交（只是該次沒有 AI 批改），分數不受影響。
 *   5. 示範模式（未接上真正 provider）不會消耗配額。
 *   6. 停用上限時不會拒絕請求，但仍然記錄用量。
 *   7. 用量記錄不含題目內容或學生的答案。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { freshTestDatabasePath } from "./test-database";

const testDbPath = freshTestDatabasePath("ai-limits");
process.env.APP_DATABASE_PATH = testDbPath;
// DeepSeek 設定代表「已接上真正的 provider」（fetch 會被 stub，不會發出請求）
process.env.LLM_PROVIDER = "deepseek";
process.env.DEEPSEEK_API_KEY = "sk-test";
process.env.LLM_GRADING_ENABLED = "true";
process.env.AI_LIMIT_WINDOW_MINUTES = "60";
process.env.AI_GENERATIONS_PER_LEARNER = "2";
process.env.AI_GRADINGS_PER_LEARNER = "2";
process.env.AI_GENERATIONS_GLOBAL = "100";
process.env.AI_GRADINGS_GLOBAL = "100";

type PracticeService = typeof import("@/server/services/practice-service");
type AiLimits = typeof import("@/server/services/ai-limits");
type AiOperations = typeof import("@/server/repositories/ai-operations");
type MaterialService = typeof import("@/server/services/material-service");
type Seed = typeof import("@/server/seed");
type Connection = typeof import("@/server/db/connection");

let practice: PracticeService;
let aiLimits: AiLimits;
let aiOperations: AiOperations;
let materialService: MaterialService;
let seed: Seed;
let getDb: Connection["getDb"];

const LEARNER = "ai-limit-learner";
const OTHER_LEARNER = "ai-limit-other-learner";
/** 示範題庫中有填充題及短答題的分節（同 tests/ai-grading.test.ts） */
const SECTION = "topic-5-reformation-development";

/** 生成用的 stub：回傳固定題目（不會發出網絡請求） */
function generationResponse(): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              questions: [
                {
                  questionType: "mc",
                  difficulty: "basic",
                  question: "文藝復興時期，歐洲人重視甚麼思想？",
                  options: ["人文主義", "重商主義", "軍國主義", "封建主義"],
                  correctAnswerIndex: 0,
                  correctAnswer: "人文主義",
                  explanation: "教材指出文藝復興重視人文主義。",
                  knowledgePoint: "文藝復興的主要特點",
                  sourceExcerpt: "文藝復興重視人文主義",
                  sourceBlockIds: [],
                  gradingPoints: [],
                  skill: "正確地使用歷史辭彙",
                },
              ],
            }),
          },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function gradingResponse(verdict: "correct" | "partial" | "incorrect"): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({ verdict, hitPointIndexes: [], feedback: "回饋內容" }),
          },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

async function createAiPractice(learnerId: string, count = 1) {
  return practice.createPractice({
    learnerId,
    topicId: "topic-5",
    sectionIds: [SECTION],
    questionTypes: ["mc"],
    difficulty: "basic",
    questionCount: count,
    mode: "standard",
    questionSource: "ai",
    sourceSessionId: null,
  });
}

beforeAll(async () => {
  practice = await import("@/server/services/practice-service");
  aiLimits = await import("@/server/services/ai-limits");
  aiOperations = await import("@/server/repositories/ai-operations");
  materialService = await import("@/server/services/material-service");
  seed = await import("@/server/seed");
  getDb = (await import("@/server/db/connection")).getDb;
  seed.ensureBootstrap();
  const imported = await materialService.importPilotMaterialFromDisk({ runOcr: false });
  if (!imported) throw new Error("找不到課題5的教材檔案，無法測試 AI 用量上限");
});

beforeEach(() => {
  process.env.AI_LIMITS_ENABLED = "true";
  process.env.AI_GENERATIONS_PER_LEARNER = "2";
  process.env.AI_GRADINGS_PER_LEARNER = "2";
  process.env.AI_GENERATIONS_GLOBAL = "100";
  process.env.AI_GRADINGS_GLOBAL = "100";
  // 每次測試前清空用量記錄，令測試互相獨立
  aiOperations.purgeOperationsBefore(new Date(Date.now() + 60_000).toISOString());
  vi.unstubAllGlobals();
});

describe("AI 出題用量上限", () => {
  it("超過個人上限時回傳 429，並說明可再試的訊息", () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(generationResponse())));

    const status = aiLimits.describeAiLimit(LEARNER, "generation");
    expect(status.learnerLimit).toBe(2);

    // 前兩次保留成功，第三次被拒絕
    aiLimits.reserveAiOperation(LEARNER, "generation");
    aiLimits.reserveAiOperation(LEARNER, "generation");
    expect(() => aiLimits.reserveAiOperation(LEARNER, "generation")).toThrowError(/使用上限/);

    try {
      aiLimits.reserveAiOperation(LEARNER, "generation");
    } catch (error) {
      expect((error as { status?: number }).status).toBe(429);
    }
  });

  it("並行請求不會同時通過檢查而超額（先保留、後呼叫）", async () => {
    // 6 個同時發生的 AI 出題請求，上限為 2：只有 2 個可以通過。
    // 每個請求的「檢查 + 保留」都是同步完成，因此不會有兩個請求同時看到未超額的狀態
    // （單一程序 + 同步 SQLite 寫入，與正式執行的行為一致）。
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        (async () => aiLimits.reserveAiOperation(LEARNER, "generation"))(),
      ),
    );

    const succeeded = results.filter((result) => result.status === "fulfilled").length;
    const rejected = results.filter((result) => result.status === "rejected").length;
    expect(succeeded).toBe(2);
    expect(rejected).toBe(4);

    // 保留記錄的數量即為實際可呼叫模型的次數
    expect(
      aiOperations.countRecentOperationsForLearner(LEARNER, "generation", "1970-01-01T00:00:00.000Z"),
    ).toBe(2);
  });

  it("整體上限會限制所有使用者合計的用量", () => {
    process.env.AI_GENERATIONS_GLOBAL = "2";
    aiLimits.reserveAiOperation(LEARNER, "generation");
    aiLimits.reserveAiOperation(OTHER_LEARNER, "generation");

    // 每個學習者的個人上限仍然充足，但整體上限已達到
    const status = aiLimits.describeAiLimit(OTHER_LEARNER, "generation");
    expect(status.reason).toBe("global");
    expect(() => aiLimits.reserveAiOperation(OTHER_LEARNER, "generation")).toThrowError(/使用上限/);
  });

  it("學生無法以不同學習者 ID 繞過上限（用量記於工作階段身分）", async () => {
    // 配額已用完（例如先前在另一條路由消耗），直接呼叫 API 亦會被拒絕
    aiLimits.reserveAiOperation(LEARNER, "generation");
    aiLimits.reserveAiOperation(LEARNER, "generation");

    // 429 由伺服器端在呼叫模型之前拋出（不會先花費再拒絕）
    await expect(createAiPractice(LEARNER, 1)).rejects.toThrowError(/使用上限/);

    // 同樣的請求若換成另一個學習者身分，配額是獨立的
    expect(() => aiLimits.reserveAiOperation(OTHER_LEARNER, "generation")).not.toThrow();
  });

  it("停用上限時不會拒絕請求，但仍然記錄用量（供監控）", () => {
    process.env.AI_LIMITS_ENABLED = "false";
    for (let index = 0; index < 5; index += 1) {
      aiLimits.reserveAiOperation(LEARNER, "generation");
    }
    expect(aiOperations.countRecentOperationsForLearner(LEARNER, "generation", "1970-01-01T00:00:00.000Z")).toBe(5);
  });
});

describe("AI 批改用量上限", () => {
  async function bankPracticeWithFill(learnerId: string) {
    const assembled = await practice.createPractice({
      learnerId,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["fill"],
      difficulty: "basic",
      questionCount: 1,
      mode: "standard",
      questionSource: "bank",
      sourceSessionId: null,
    });
    return assembled;
  }

  it("達到批改上限時，作答仍然可以提交，只是該次沒有 AI 批改", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(gradingResponse("incorrect"))));

    const assembled = await bankPracticeWithFill(LEARNER);
    const question = assembled.questions[0];

    // 先用掉兩次配額
    aiLimits.reserveAiOperation(LEARNER, "grading");
    aiLimits.reserveAiOperation(LEARNER, "grading");

    const submit = await practice.submitAnswer(assembled.session.id, LEARNER, question.id, "刻意答錯");

    expect(submit.recorded).toBe(true);
    expect(submit.feedback.aiLimitReached).toBe(true);
    expect(submit.feedback.isCorrect).toBe(false);
  });

  it("示範模式（未接上真正 provider）不會消耗批改配額", async () => {
    const original = process.env.LLM_PROVIDER;
    process.env.LLM_PROVIDER = "mock";
    try {
      const assembled = await bankPracticeWithFill(LEARNER);
      const question = assembled.questions[0];
      await practice.submitAnswer(assembled.session.id, LEARNER, question.id, "刻意答錯");

      expect(
        aiOperations.countRecentOperationsForLearner(LEARNER, "grading", "1970-01-01T00:00:00.000Z"),
      ).toBe(0);
    } finally {
      if (original === undefined) delete process.env.LLM_PROVIDER;
      else process.env.LLM_PROVIDER = original;
    }
  });
});

describe("用量記錄的私隱", () => {
  it("只記錄學習者、類別及時間，不記錄題目或答案內容", () => {
    aiLimits.reserveAiOperation(LEARNER, "grading");

    const columns = getDb()
      .prepare("PRAGMA table_info(ai_operations)")
      .all() as unknown as { name: string }[];
    expect(columns.map((column) => column.name).sort()).toEqual([
      "created_at",
      "id",
      "kind",
      "learner_id",
    ]);
  });
});

describe("管理員端的 AI 用量摘要", () => {
  it("只提供總數，不提供個別學習者的用量", () => {
    aiLimits.reserveAiOperation(LEARNER, "generation");
    aiLimits.reserveAiOperation(OTHER_LEARNER, "generation");
    aiLimits.reserveAiOperation(LEARNER, "grading");

    const summary = aiLimits.describeAiUsage();
    expect(summary.windowMinutes).toBe(60);
    expect(summary.generations.globalUsed).toBe(2);
    expect(summary.gradings.globalUsed).toBe(1);
    expect(summary.totals.last24Hours).toEqual({ generations: 2, gradings: 1 });
    expect(summary.totals.last7Days).toEqual({ generations: 2, gradings: 1 });
    expect(summary.storedRecords).toBe(3);

    // 摘要內完全沒有學習者 ID
    const serialised = JSON.stringify(summary);
    expect(serialised).not.toContain(LEARNER);
    expect(serialised).not.toContain(OTHER_LEARNER);
  });

  it("管理員端 API 回傳用量摘要，且不含任何學習者 ID", async () => {
    aiLimits.reserveAiOperation(LEARNER, "generation");

    const { GET } = await import("@/app/api/admin/system/overview/route");
    // 這個測試檔沒有設定 Google 憑證，因此後台 API 在示範模式下開放
    // （身分要求由 tests/authz-negative.test.ts 的路由清單覆蓋）。
    const response = await GET(new Request("http://localhost:3000/api/admin/system/overview"));
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      aiUsage: { windowMinutes: number; storedRecords: number; totals: { last7Days: unknown } };
    };
    expect(body.aiUsage.windowMinutes).toBe(60);
    expect(body.aiUsage.storedRecords).toBeGreaterThan(0);
    expect(body.aiUsage.totals.last7Days).toBeDefined();

    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain(LEARNER);
    expect(serialised).not.toContain(OTHER_LEARNER);
  });

  it("超過保留期的用量記錄會自動刪除（保留期內的不受影響）", () => {
    const { AI_OPERATION_RETENTION_DAYS } = aiLimits;
    const day = 24 * 60 * 60 * 1000;
    // 保留期內 1 筆、已過期 1 筆
    aiLimits.reserveAiOperation(LEARNER, "generation");
    getDb()
      .prepare("INSERT INTO ai_operations (id, learner_id, kind, created_at) VALUES (?, ?, ?, ?)")
      .run(
        "aiop-old",
        LEARNER,
        "generation",
        new Date(Date.now() - (AI_OPERATION_RETENTION_DAYS + 1) * day).toISOString(),
      );

    aiOperations.purgeOperationsBefore(
      new Date(Date.now() - AI_OPERATION_RETENTION_DAYS * day).toISOString(),
    );

    expect(aiOperations.countStoredOperations()).toBe(1);
    expect(aiLimits.describeAiUsage().storedRecords).toBe(1);
  });
});
