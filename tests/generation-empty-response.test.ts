/**
 * 生成器「空回應」的重試契約。
 *
 * 背景（2026-10-20 模擬學生使用時發現）：真實模型偶爾一個題目都沒有回傳
 * （空回應或全部無法解析）。此時 `discardedReasons` 是空的，舊的「全部未達要求才重試」
 * 條件不會成立，整節直接以 502 失敗——即使再問一次就能取得題目。
 * 現在只要沒有可用題目就會重試一次。
 *
 * 測試以 stub 的 HTTP 回應取代 provider（與 tests/practice-withheld-delivery.test.ts 同一手法）：
 * 第一次回傳 0 題，第二次回傳 1 題，驗證真的重試了而且學生拿到題目。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { freshTestDatabasePath } from "./test-database";
import { openDocumentForStudents } from "./material-distribution";
import { importTestPilotMaterial } from "./fixtures/pilot-material";

const testDbPath = freshTestDatabasePath("generation-empty-response");
process.env.APP_DATABASE_PATH = testDbPath;
process.env.LLM_PROVIDER = "openai-compatible";
process.env.LLM_API_KEY = "test-key-not-a-secret";
process.env.LLM_BASE_URL = "https://llm.test.invalid";
process.env.LLM_MODEL = "test-model";
delete process.env.K_SERVICE;

type PracticeService = typeof import("@/server/services/practice-service");
type PracticeRepo = typeof import("@/server/repositories/practice");
type MaterialsRepo = typeof import("@/server/repositories/materials");
type MaterialUnits = typeof import("@/server/services/material-units");
type TextUtils = typeof import("@/server/materials/text-utils");
type TopicsRepo = typeof import("@/server/repositories/topics");
type Seed = typeof import("@/server/seed");

let practice: PracticeService;
let practiceRepo: PracticeRepo;
let materialsRepo: MaterialsRepo;
let materialUnits: MaterialUnits;
let textUtils: TextUtils;
let topicsRepo: TopicsRepo;
let seed: Seed;

const TOPIC = "topic-5";
const LEARNER = "empty-response-learner";

let sectionId: string;
let excerpt: string;
let blockId: string;

/** provider 回應：第一次 0 題，之後 1 題（答案逐字見於教材） */
function fetchStub(callCounter: { count: number }): typeof fetch {
  return (async () => {
    callCounter.count += 1;
    const questions =
      callCounter.count === 1
        ? []
        : [
            {
              questionType: "mc",
              difficulty: "basic",
              question: "以下哪一項描述最符合這個課題的內容？",
              options: [excerpt, "與本題無關的敘述甲", "與本題無關的敘述乙", "與本題無關的敘述丙"],
              correctAnswerIndex: 0,
              correctAnswer: excerpt,
              explanation: `課文原文這樣說明：${excerpt}`,
              knowledgePoint: "工業發展",
              sourceExcerpt: excerpt,
              sourceBlockIds: [blockId],
              gradingPoints: [],
            },
          ];
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ questions }) } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

beforeAll(async () => {
  practice = await import("@/server/services/practice-service");
  practiceRepo = await import("@/server/repositories/practice");
  materialsRepo = await import("@/server/repositories/materials");
  materialUnits = await import("@/server/services/material-units");
  textUtils = await import("@/server/materials/text-utils");
  topicsRepo = await import("@/server/repositories/topics");
  seed = await import("@/server/seed");

  seed.ensureBootstrap();
  await importTestPilotMaterial();
  for (const block of materialsRepo.listGroundingBlocksForSections(TOPIC, [])) {
    openDocumentForStudents(materialsRepo, block.documentId);
  }

  const candidates = topicsRepo.listSections(TOPIC).map((section) => section.id);
  let best: { id: string; units: ReturnType<MaterialUnits["buildMaterialUnits"]> } | null = null;
  for (const candidate of candidates) {
    const expanded = topicsRepo.expandSectionIds(TOPIC, [candidate]);
    const units = materialUnits.buildMaterialUnits(TOPIC, expanded, { audience: "student" });
    if (units.length > 0 && (best === null || units.length > best.units.length)) {
      best = { id: candidate, units };
    }
  }
  if (best === null) throw new Error("課題5找不到有學生可用教材的測試分節");
  sectionId = best.id;

  const sentence = best.units
    .flatMap((unit) => textUtils.splitSentences(unit.text).map((part) => ({ unit, part: part.trim() })))
    .find(({ part }) => part.length >= 16 && part.length <= 40 && !part.includes("＿"));
  if (!sentence) throw new Error("找不到可用的測試句子");
  excerpt = sentence.part;
  blockId = sentence.unit.blockId;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("生成器空回應", () => {
  it("第一次沒有回傳題目時會重試一次，學生仍然取得題目", async () => {
    const counter = { count: 0 };
    vi.stubGlobal("fetch", fetchStub(counter));

    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: TOPIC,
      sectionIds: [sectionId],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 1,
      mode: "standard",
      questionSource: "ai",
      sourceSessionId: null,
    });

    const delivered = practiceRepo.getSessionQuestions(assembled.session.id);
    expect(delivered.length).toBe(1);
    // 第一次（0 題）＋ 第二次（1 題）＝ 兩次 provider 呼叫
    expect(counter.count).toBe(2);
  });
});
