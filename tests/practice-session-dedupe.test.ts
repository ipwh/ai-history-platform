/**
 * 學生回報（本機練習 sess_c1c25eb90c2c4f86）的端到端迴歸測試。
 *
 * 回報內容：同一份練習的填充題第 1、2 題答案重複，第 4、5 題答案重複，題目相似度太高。
 * 成因是舊的重複判定只比對「題幹字串完全相同」，模型把同一件史實改寫成兩條略有不同的
 * 題幹後便全部放行。
 *
 * 這份測試由 createPractice 實際建立一次即時生成練習（本地示範生成，不發出網絡請求），
 * 再逐題讀回練習快照，確保整份練習——包括平行生成的多個分節，以及補題的第二次呼叫——
 * 不會出現兩條答案相同的填充題。單元層的判定測試見 question-dedupe.test.ts。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { openDocumentForStudents } from "./material-distribution";
import { freshTestDatabasePath } from "./test-database";
import { importTestPilotMaterial } from "./fixtures/pilot-material";

import { questionStemKey } from "@/server/llm/question-dedupe";
import { normalizeForMatch } from "@/server/materials/text-utils";

const testDbPath = freshTestDatabasePath("practice-dedupe");
process.env.APP_DATABASE_PATH = testDbPath;
process.env.LLM_PROVIDER = "mock";

type PracticeService = typeof import("@/server/services/practice-service");
type PracticeRepo = typeof import("@/server/repositories/practice");
type MaterialsRepo = typeof import("@/server/repositories/materials");
type Seed = typeof import("@/server/seed");

let practice: PracticeService;
let practiceRepo: PracticeRepo;
let materialsRepo: MaterialsRepo;
let seed: Seed;

const SECTIONS = ["topic-5-industrial", "topic-5-industrial"];

beforeAll(async () => {
  practice = await import("@/server/services/practice-service");
  practiceRepo = await import("@/server/repositories/practice");
  materialsRepo = await import("@/server/repositories/materials");
  seed = await import("@/server/seed");
  seed.ensureBootstrap();
  await importTestPilotMaterial();
  // 學生自行觸發即時生成只可使用已確認可向學生發布的教材
  for (const block of materialsRepo.listGroundingBlocksForSections("topic-5", [])) {
    openDocumentForStudents(materialsRepo, block.documentId);
  }
});

async function createFillSession(options: {
  learnerId: string;
  sectionIds: string[];
  questionCount: number;
}) {
  const assembled = await practice.createPractice({
    learnerId: options.learnerId,
    topicId: "topic-5",
    sectionIds: options.sectionIds,
    questionTypes: ["fill"],
    difficulty: "basic",
    questionCount: options.questionCount,
    mode: "standard",
    questionSource: "ai",
    sourceSessionId: null,
  });
  return { assembled, snapshot: practiceRepo.getSessionQuestions(assembled.session.id) };
}

describe("練習快照：同一份練習不出現重複的填充題答案", () => {
  it("單一分節：所有填充題的答案與題幹都不重複", async () => {
    const { snapshot } = await createFillSession({
      learnerId: "dedupe-single",
      sectionIds: [SECTIONS[0]],
      questionCount: 6,
    });

    expect(snapshot.length).toBeGreaterThan(0);
    expect(snapshot.every((question) => question.questionType === "fill")).toBe(true);

    const answers = snapshot.map((question) => question.correctAnswer);
    expect(new Set(answers).size).toBe(answers.length);

    const stems = snapshot.map((question) => question.question);
    expect(new Set(stems).size).toBe(stems.length);

    // 每條題目仍然要有教材依據
    expect(snapshot.every((question) => (question.sourceBlockIds ?? []).length > 0)).toBe(true);
  });

  it("多個分節（平行生成）：跨分節也不會出現相同答案", async () => {
    const { snapshot } = await createFillSession({
      learnerId: "dedupe-multi",
      sectionIds: SECTIONS,
      questionCount: 6,
    });

    const answers = snapshot.map((question) => question.correctAnswer);
    expect(new Set(answers).size).toBe(answers.length);
  });

  it("題目數不足時如實告知學生，而不是用重複題目補足", async () => {
    const requested = 8;
    const { assembled, snapshot } = await createFillSession({
      learnerId: "dedupe-shortfall",
      sectionIds: [SECTIONS[0]],
      questionCount: requested,
    });

    const answers = snapshot.map((question) => question.correctAnswer);
    expect(new Set(answers).size).toBe(answers.length);
    expect(snapshot.length).toBe(assembled.questions.length);

    // 本地示範生成的可用史實有限，補題用盡後會少於原定題數；此時必須有說明，
    // 而且少了的題數不可用「同樣答案的另一條題目」填補（上一行的斷言已保證）。
    if (snapshot.length < requested) {
      expect(assembled.notice ?? "").toContain("原定");
    }
  });

  it("學生看到的題幹忽略標點／空白後也不重複（相似題目不可同時出現）", async () => {
    const { snapshot } = await createFillSession({
      learnerId: "dedupe-normalized",
      sectionIds: SECTIONS,
      questionCount: 6,
    });

    // 以去重模組自己的正規化方式比對，避免「只改標點或全形半形」的題目同時出現
    const stemKeys = snapshot.map((question) => questionStemKey(question.question));
    expect(new Set(stemKeys).size).toBe(stemKeys.length);

    const answerKeys = snapshot.map((question) => normalizeForMatch(question.correctAnswer));
    expect(new Set(answerKeys).size).toBe(answerKeys.length);
  });
});
