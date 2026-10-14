import os from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

// 使用獨立暫存資料庫，並以本地示範生成代替真實 LLM（不會發出網絡請求）
const testDbPath = path.join(os.tmpdir(), `hist-test-bank-${process.pid}.db`);
process.env.APP_DATABASE_PATH = testDbPath;
process.env.LLM_PROVIDER = "mock";

type QuestionBankService = typeof import("@/server/services/question-bank");
type QuestionRepository = typeof import("@/server/repositories/questions");
type MaterialService = typeof import("@/server/services/material-service");
type Seed = typeof import("@/server/seed");

let bank: QuestionBankService;
let questionsRepo: QuestionRepository;
let materialService: MaterialService;
let seed: Seed;

beforeAll(async () => {
  bank = await import("@/server/services/question-bank");
  questionsRepo = await import("@/server/repositories/questions");
  materialService = await import("@/server/services/material-service");
  seed = await import("@/server/seed");
  seed.ensureBootstrap();
  // 題庫生成需要教材內容作依據，因此匯入課題5的書本內容
  const imported = await materialService.importPilotMaterialFromDisk({
    runOcr: false,
  });
  if (!imported) throw new Error("找不到課題5的教材檔案，無法測試題庫生成");
});

describe("題庫難度分配", () => {
  it("把每個分節的目標題數平均分配到三個難度", () => {
    expect([...bank.allocateByDifficulty(6).entries()]).toEqual([
      ["basic", 2],
      ["advanced", 2],
      ["challenge", 2],
    ]);
    expect([...bank.allocateByDifficulty(5).entries()]).toEqual([
      ["basic", 2],
      ["advanced", 2],
      ["challenge", 1],
    ]);
    expect([...bank.allocateByDifficulty(3).entries()]).toEqual([
      ["basic", 1],
      ["advanced", 1],
      ["challenge", 1],
    ]);
    // 目標題數少於難度數目時，先滿足較基礎的難度
    expect([...bank.allocateByDifficulty(2).entries()]).toEqual([
      ["basic", 1],
      ["advanced", 1],
    ]);
  });

  it("生成後題庫齊備基礎、進階及挑戰的題目", async () => {
    const report = await bank.generateQuestionBank({ topicId: "topic-5", perSection: 3 });
    expect(report.created).toBeGreaterThan(0);
    expect(
      report.createdByDifficulty.basic +
        report.createdByDifficulty.advanced +
        report.createdByDifficulty.challenge,
    ).toBe(report.created);

    const difficulties = new Set(
      questionsRepo.listQuestions({ topicId: "topic-5" }).map((question) => question.difficulty),
    );
    expect(difficulties.has("basic")).toBe(true);
    expect(difficulties.has("advanced")).toBe(true);
    expect(difficulties.has("challenge")).toBe(true);
  });
});
