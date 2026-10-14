import os from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

// 使用獨立暫存資料庫，並以本地示範生成代替真實 LLM（不會發出網絡請求）
const testDbPath = path.join(os.tmpdir(), `hist-test-ai-practice-${process.pid}.db`);
process.env.APP_DATABASE_PATH = testDbPath;
process.env.LLM_PROVIDER = "mock";

type PracticeService = typeof import("@/server/services/practice-service");
type QuestionRepository = typeof import("@/server/repositories/questions");
type MaterialService = typeof import("@/server/services/material-service");
type TopicService = typeof import("@/server/services/topic-service");
type Seed = typeof import("@/server/seed");
type Types = typeof import("@/lib/types");

let practice: PracticeService;
let questionsRepo: QuestionRepository;
let materialService: MaterialService;
let topicService: TopicService;
let seed: Seed;
let types: Types;

const LEARNER = "ai-mode-learner";
const SECTIONS = ["topic-5-renaissance-features", "topic-5-industrial-development"];

beforeAll(async () => {
  practice = await import("@/server/services/practice-service");
  questionsRepo = await import("@/server/repositories/questions");
  materialService = await import("@/server/services/material-service");
  topicService = await import("@/server/services/topic-service");
  seed = await import("@/server/seed");
  types = await import("@/lib/types");
  seed.ensureBootstrap();
  // 即時出題需要教材內容作依據，因此匯入課題5的書本內容
  const imported = await materialService.importPilotMaterialFromDisk({
    runOcr: false,
  });
  if (!imported) throw new Error("找不到課題5的教材檔案，無法測試 AI 出題模式");
});

describe("AI 即時出題模式", () => {
  it("按所選分節分配題數", () => {
    expect([...practice.distributeQuestionCount(6, ["a", "b", "c"]).entries()]).toEqual([
      ["a", 2],
      ["b", 2],
      ["c", 2],
    ]);
    expect([...practice.distributeQuestionCount(5, ["a", "b"]).entries()]).toEqual([
      ["a", 3],
      ["b", 2],
    ]);
    expect([...practice.distributeQuestionCount(2, ["a", "b", "c"]).entries()]).toEqual([
      ["a", 1],
      ["b", 1],
    ]);
  });

  it("questionSource 預設為 bank，未指定時沿用題庫流程", () => {
    expect(types.practiceSetupSchema.parse({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: SECTIONS,
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 2,
    }).questionSource).toBe("bank");
  });

  it("即時生成的題目只存在於練習快照內，題庫不會增加題目", async () => {
    const before = questionsRepo.listQuestions({ topicId: "topic-5" }).length;

    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: SECTIONS,
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 2,
      mode: "standard",
      questionSource: "ai",
      sourceSessionId: null,
    });

    expect(assembled.questions.length).toBeGreaterThan(0);
    expect(assembled.session.origin).toBe("generated");
    expect(assembled.notice).toContain("本地示範生成");

    // 題目（含答案）仍可在練習快照中找回，供作答及查看成績
    const stored = practice.getPracticeView(assembled.session.id, LEARNER);
    expect(stored.questions.length).toBe(assembled.questions.length);
    expect(questionsRepo.getQuestion(assembled.questions[0].id)).toBeNull();

    expect(questionsRepo.listQuestions({ topicId: "topic-5" }).length).toBe(before);
  });

  it("不在題庫的即時生成題目也可以重做錯題", async () => {
    const first = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: SECTIONS,
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 2,
      mode: "standard",
      questionSource: "ai",
      sourceSessionId: null,
    });

    for (const question of first.questions) {
      await practice.submitAnswer(first.session.id, LEARNER, question.id, "刻意答錯");
    }

    const retry = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: SECTIONS,
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 2,
      mode: "wrong-only",
      questionSource: "ai",
      sourceSessionId: first.session.id,
    });

    expect(retry.questions.length).toBeGreaterThan(0);
    expect(retry.notice).toContain("答錯");
    const retryIds = retry.questions.map((question) => question.id);
    expect(retryIds.every((id) => first.questions.some((item) => item.id === id))).toBe(true);
  });
});

describe("分節可用性（介面顯示用，取代容易誤解的題目數量）", () => {
  it("匯入教材後，分節（含子分節）會回報教材段落數", () => {
    const overview = topicService.getTopicDetail("topic-5", null);
    expect(overview).not.toBeNull();

    const renaissance = overview!.sections.find((section) => section.id === "topic-5-renaissance");
    expect(renaissance).toBeDefined();
    expect(renaissance!.materialBlockCount).toBeGreaterThan(0);
    expect(renaissance!.children.length).toBeGreaterThan(0);
    // 每個主題都有自己的教材段落，因此學生可以逐個主題選取
    expect(renaissance!.children.every((child) => child.materialBlockCount > 0)).toBe(true);
    expect(renaissance!.children.every((child) => types.isSectionPractisable(child))).toBe(true);
  });

  it("沒有教材亦沒有題目的分節不可出題，有其一即可", () => {
    expect(types.isSectionPractisable({ publishedQuestionCount: 0, materialBlockCount: 0 })).toBe(
      false,
    );
    expect(types.isSectionPractisable({ publishedQuestionCount: 0, materialBlockCount: 3 })).toBe(
      true,
    );
    expect(types.isSectionPractisable({ publishedQuestionCount: 2, materialBlockCount: 0 })).toBe(
      true,
    );
  });

  it("課題的主題數以子分節計算，沒有子分節時以分節本身計算", () => {
    const overview = topicService.getTopicDetail("topic-5", null);
    expect(overview).not.toBeNull();
    const expected = overview!.sections.reduce(
      (total, section) => total + (section.children.length > 0 ? section.children.length : 1),
      0,
    );
    expect(types.countPracticeThemes(overview!)).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });
});
