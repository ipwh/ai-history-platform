/**
 * 題庫不足時的補題路徑（2026-10-20 模擬學生使用時發現）。
 *
 * 契約：學生要求 N 題時，交付的題目**不可多於 N 題**。題庫不足而改為即時生成時，
 * 生成流程會超額產生（overGenerate），舊程式碼把全部生成結果附加到已選題目之後，
 * 於是出現「要求 5 題卻交付 7 題」。這裡鎖定該行為。
 */
import { beforeAll, describe, expect, it } from "vitest";

import { openDocumentForStudents } from "./material-distribution";
import { freshTestDatabasePath } from "./test-database";
import { importTestPilotMaterial } from "./fixtures/pilot-material";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("bank-topup-count");
process.env.LLM_PROVIDER = "mock";

type PracticeService = typeof import("@/server/services/practice-service");
type QuestionRepo = typeof import("@/server/repositories/questions");
type MaterialsRepo = typeof import("@/server/repositories/materials");
type Seed = typeof import("@/server/seed");

let practice: PracticeService;
let questionsRepo: QuestionRepo;
let materialsRepo: MaterialsRepo;
let seed: Seed;

const LEARNER = "bank-topup-learner";
const TOPIC = "topic-5";
const SECTION = "topic-5-french-revolution";

beforeAll(async () => {
  practice = await import("@/server/services/practice-service");
  questionsRepo = await import("@/server/repositories/questions");
  materialsRepo = await import("@/server/repositories/materials");
  seed = await import("@/server/seed");

  seed.ensureBootstrap();
  await importTestPilotMaterial();
  for (const block of materialsRepo.listGroundingBlocksForSections(TOPIC, [])) {
    openDocumentForStudents(materialsRepo, block.documentId);
  }
});

describe("題庫不足時的補題", () => {
  it("即時生成超額產生的題目不會令交付題數多於學生要求", async () => {
    // 清空該主題的選擇題，令題庫一定不足，從而強制走「即時生成補足」這條路徑
    for (const question of questionsRepo.listQuestions({
      topicId: TOPIC,
      sectionIds: [SECTION],
      questionTypes: ["mc"],
    })) {
      questionsRepo.deleteQuestion(question.id);
    }
    expect(
      questionsRepo.listQuestions({
        topicId: TOPIC,
        sectionIds: [SECTION],
        questionTypes: ["mc"],
        statuses: ["published"],
      }).length,
    ).toBe(0);

    const requested = 3;
    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: TOPIC,
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: requested,
      mode: "standard",
      questionSource: "bank",
      sourceSessionId: null,
    });

    expect(assembled.questions.length).toBeGreaterThan(0);
    expect(assembled.questions.length).toBeLessThanOrEqual(requested);
    // 確認真的走了「題庫不足 → 即時生成補足」這條路徑（否則這個測試會變成空轉）
    expect(assembled.notice ?? "").toContain("題庫題目不足");
  });
});
