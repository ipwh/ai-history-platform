import os from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

// 使用獨立暫存資料庫，並以本地示範生成代替真實 LLM（不會發出網絡請求）
//
// 這個檔案曾偶爾失敗（生成 0 題）。**根因已找到並修正**：
// 測試資料庫以 `${process.pid}` 命名但從不刪除，而作業系統會回收 PID，因此有時會
// 沿用上一次執行留下的資料庫。當時 topic-5 的題目已由上次執行補齊，`generateQuestionBank`
// 便正確地判定「無需生成」，回報 created = 0（實測約 4% 機率、55 毫秒內失敗）。
// 這是**測試隔離缺陷，不是產品缺陷**。
//
// 修法（兩層）：
//   1. 本檔在開啟資料庫**之前**先刪除自己的暫存資料庫，令每次執行都由空白狀態開始；
//   2. `tests/global-setup.ts` 於整套測試開始前清除所有遺留的暫存資料庫（其他檔案同理）。
// 依 Sprint 3／4 的要求，**沒有**加入 retry 掩蓋問題。
import fs from "node:fs";

const testDbPath = path.join(os.tmpdir(), `hist-test-bank-${process.pid}.db`);
for (const suffix of ["", "-wal", "-shm"]) {
  fs.rmSync(`${testDbPath}${suffix}`, { force: true });
}
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

  // 明確驗證教材真的成功擷取：若擷取失敗（例如檔案讀取或解析問題），
  // 之後的「生成 0 題」會難以診斷。這裡先擋下來，令失敗原因一目了然。
  if (imported.outcome.document.status !== "ready") {
    throw new Error(
      `課題5 教材擷取失敗（status=${imported.outcome.document.status}）：${
        imported.outcome.document.errorMessage ?? "沒有錯誤訊息"
      }`,
    );
  }
  if (imported.outcome.blocks.length === 0) {
    throw new Error("課題5 教材擷取成功但沒有段落，無法生成題目");
  }
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
    // 若這裡失敗，訊息會直接指出是「分節已夠題目」還是「教材不足」，
    // 令將來的隔離問題（例如沿用了舊資料庫）不會再表現成難以診斷的 created = 0。
    expect(
      report.created,
      `生成 0 題（分節已夠題目：${report.duplicateSections.length}；教材不足：${report.insufficientSections.length}）`,
    ).toBeGreaterThan(0);
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
