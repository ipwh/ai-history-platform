/**
 * 學生端題目脫敏（防作弊）測試。
 *
 * 驗證：
 *   1. 學生端序列化只包含白名單欄位，標準答案、解釋、教材節錄等一律不出現。
 *   2. 真實路由處理器（POST /api/practice、GET /api/practice/{id}）的回應中
 *      沒有任何敏感欄位——包括日後題目結構新增欄位的情況。
 *   3. 練習結果端點在作答前不會回傳答案（未作答的題目沒有回饋）。
 *   4. 作答後才取得正確答案及解釋（伺服器批改）。
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  QUESTION_CONFIDENTIAL_FIELDS,
  STUDENT_QUESTION_ALLOWED_FIELDS,
  findConfidentialQuestionFields,
  toStudentQuestion,
} from "@/lib/student-question";
import { studentQuestionSchema } from "@/lib/types";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("sanitization");
process.env.LLM_PROVIDER = "mock";
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;

type PracticeService = typeof import("@/server/services/practice-service");
type QuestionRepository = typeof import("@/server/repositories/questions");
type Seed = typeof import("@/server/seed");

let practice: PracticeService;
let questionsRepo: QuestionRepository;
let seed: Seed;

const LEARNER = "test-learner-sanitize";
const SECTION = "topic-5-renaissance-reformation";

interface PracticeResponse {
  session: { id: string };
  questions: Record<string, unknown>[];
  notice: string | null;
}

async function startPractice(questionCount = 5): Promise<PracticeResponse> {
  const { POST } = await import("@/app/api/practice/route");
  const response = await POST(
    new Request("http://localhost:3000/api/practice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        learnerId: LEARNER,
        topicId: "topic-5",
        sectionIds: [SECTION],
        questionTypes: ["mc", "fill"],
        difficulty: "basic",
        questionCount,
        mode: "standard",
        questionSource: "bank",
        sourceSessionId: null,
      }),
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json()) as PracticeResponse;
}

beforeAll(async () => {
  practice = await import("@/server/services/practice-service");
  questionsRepo = await import("@/server/repositories/questions");
  seed = await import("@/server/seed");
  seed.ensureBootstrap();
});

describe("學生端題目序列化", () => {
  it("只包含白名單欄位，且沒有敏感欄位", () => {
    const question = questionsRepo.listQuestions({ statuses: ["published"] })[0];
    expect(question).toBeDefined();

    const dto = toStudentQuestion(question!);
    expect(Object.keys(dto).sort()).toEqual([...STUDENT_QUESTION_ALLOWED_FIELDS].sort());
    for (const field of QUESTION_CONFIDENTIAL_FIELDS) {
      expect(dto).not.toHaveProperty(field);
    }
  });

  it("即使直接解析完整題目，zod schema 亦不會保留敏感欄位", () => {
    const question = questionsRepo.listQuestions({ statuses: ["published"] })[0]!;
    const parsed = studentQuestionSchema.parse(question) as Record<string, unknown>;
    expect(findConfidentialQuestionFields(parsed)).toEqual([]);
    expect(parsed.correctAnswer).toBeUndefined();
    expect(parsed.explanation).toBeUndefined();
  });
});

describe("練習 API 不會回傳答案", () => {
  it("建立練習的回應不含任何敏感欄位", async () => {
    const payload = await startPractice();

    expect(payload.questions.length).toBeGreaterThan(0);
    expect(findConfidentialQuestionFields(payload.questions)).toEqual([]);

    for (const question of payload.questions) {
      expect(Object.keys(question).sort()).toEqual([...STUDENT_QUESTION_ALLOWED_FIELDS].sort());
    }

    // 連標準答案的實際文字都不應出現在序列化結果內（選擇題的答案本身就是其中一個
    // 選項，屬正常內容，因此只檢查填充題；題幹或知識點本身含該詞時不屬於外洩）
    const serialized = JSON.stringify(payload.questions);
    for (const question of payload.questions) {
      const bank = questionsRepo.getQuestion(String(question.id));
      if (!bank) continue;
      const answerLeaks = bank.question.includes(bank.correctAnswer);
      if (bank.questionType === "fill" && bank.correctAnswer.length >= 2 && !answerLeaks) {
        expect(JSON.stringify(question)).not.toContain(bank.correctAnswer);
      }
      expect(serialized).not.toContain(bank.explanation);
    }
  });

  it("讀取練習（作答頁）的回應同樣不含敏感欄位", async () => {
    const created = await startPractice();
    const { GET } = await import("@/app/api/practice/[sessionId]/route");
    const response = await GET(
      new Request(`http://localhost:3000/api/practice/${created.session.id}?learnerId=${LEARNER}`),
      { params: Promise.resolve({ sessionId: created.session.id }) },
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as PracticeResponse & { feedback: unknown[] };
    expect(findConfidentialQuestionFields(payload.questions)).toEqual([]);
    expect(payload.feedback).toEqual([]);
  });

  it("未作答前，練習結果端點不會回傳任何答案", async () => {
    const created = await startPractice();
    const { GET } = await import("@/app/api/practice/[sessionId]/result/route");
    const response = await GET(
      new Request(
        `http://localhost:3000/api/practice/${created.session.id}/result?learnerId=${LEARNER}`,
      ),
      { params: Promise.resolve({ sessionId: created.session.id }) },
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      feedback: unknown[];
      totalQuestions: number;
      answeredCount: number;
    };
    expect(payload.totalQuestions).toBe(created.questions.length);
    expect(payload.answeredCount).toBe(0);
    // 關鍵：未作答時不會有逐題回饋，因此無法提前取得標準答案
    expect(payload.feedback).toEqual([]);
  });

  it("作答後才回傳該題的答案及解釋（其他未作答題目仍然沒有回饋）", async () => {
    const created = await startPractice();
    const first = created.questions[0];
    const bank = questionsRepo.getQuestion(String(first.id))!;

    await practice.submitAnswer(created.session.id, LEARNER, bank.id, "一個錯誤的答案");

    const result = practice.getPracticeResult(created.session.id, LEARNER);
    expect(result.feedback).toHaveLength(1);
    expect(result.feedback[0]?.questionId).toBe(bank.id);
    expect(result.feedback[0]?.correctAnswer).toBe(bank.correctAnswer);
    expect(result.feedback[0]?.explanation.length).toBeGreaterThan(0);
  });
});
