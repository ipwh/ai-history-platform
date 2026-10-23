/**
 * 批次題幹修正：原子性、操作者稽核與過期清單（Sprint 20）。
 *
 * 背景（2026-10-23 CI 檢視）：`scripts/fix-chronology-stem-years.ts` 先在交易外逐項
 * 核對，再逐項呼叫 `updateManualQuestion`。若第 N 項在寫入階段失敗，前 N-1 項已經
 * 寫入，工具卻會說「整批不會寫入」。同一個工具亦只列印 `--actor`，沒有把操作者寫入
 * 任何地方。
 *
 * 本檔驗證修補後的契約：
 *   1. 交易內任何一項失敗（含領域檢查失敗）→ 前面已寫入的項目一併回滾。
 *   2. 交易內重新核對題幹／版本／狀態：清單過期即拒絕，且不留下任何變更。
 *   3. 成功批次：全部題目改為草稿、版本 +1，併寫入 `question_mutations`（操作者、
 *      工具、改動前後版本／指紋／題幹）。
 *   4. 重跑同一份（已過期的）清單會安全失敗，不會重複修改。
 *   5. 整個過程**不會**產生任何 `question_reviews` 紀錄（腳本改寫不是教師覆核）。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { freshTestDatabasePath } from "./test-database";

const testDbPath = freshTestDatabasePath("chrono-batch");
process.env.APP_DATABASE_PATH = testDbPath;
process.env.LLM_PROVIDER = "mock";
delete process.env.K_SERVICE;

type QuestionRepo = typeof import("@/server/repositories/questions");
type QuestionService = typeof import("@/server/services/question-service");
type Mutations = typeof import("@/server/repositories/question-mutations");
type Connection = typeof import("@/server/db/connection");

let repo: QuestionRepo;
let service: QuestionService;
let mutations: Mutations;
let getDb: Connection["getDb"];

const TSX_CLI = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const SCRIPT = path.join(process.cwd(), "scripts", "fix-chronology-stem-years.ts");
const ACTOR = "owner@example.com";

/** 三個結構上可作答、不含年份的合成題目（原創文字，不使用真實教材） */
const SEEDS = [
  {
    id: "q-chrono-1",
    question: "合成題一：哪個國家最早展開合成工業化？",
    next: "合成題一（修正）：哪一個國家最早展開合成工業化？",
  },
  {
    id: "q-chrono-2",
    question: "合成題二：哪一項是合成革命的特點？",
    next: "合成題二（修正）：以下哪一項是合成革命的特點？",
  },
  {
    id: "q-chrono-3",
    question: "合成題三：哪個人物與合成條約有關？",
    next: "合成題三（修正）：哪一位人物與合成條約有關？",
  },
];

function insertSyntheticQuestion(seed: { id: string; question: string }, revision = 1): void {
  repo.insertQuestion({
    id: seed.id,
    topicId: "topic-chrono",
    sectionId: "section-chrono",
    questionType: "mc",
    difficulty: "basic",
    question: seed.question,
    options: ["合成選項甲", "合成選項乙", "合成選項丙", "合成選項丁"],
    correctAnswer: "合成選項甲",
    acceptedAnswers: [],
    explanation: "合成解釋：教材段落指出合成選項甲成立。",
    knowledgePoint: "合成知識點",
    sourceExcerpt: "合成教材節錄內容",
    sourceLocation: "合成教材 第 1 段",
    sourceBlockIds: [],
    gradingPoints: [],
    origin: "manual",
    status: "published",
    sourceVerified: false,
    qualityWarnings: [],
    skill: null,
    revision,
    autoValidatedAt: null,
    autoValidatedRevision: null,
    autoValidatedFingerprint: null,
    teacherConfirmationRequired: false,
    createdAt: "2026-10-23T00:00:00.000Z",
  });
}

function writeManifest(changes: Array<{ questionId: string; before: string; after: string }>): string {
  const file = path.join(
    os.tmpdir(),
    `hist-chrono-manifest-${process.pid}-${Math.random().toString(36).slice(2)}.json`,
  );
  fs.writeFileSync(
    file,
    `${JSON.stringify(
      {
        generatedAt: "2026-10-23T00:00:00.000Z",
        reason: "合成測試：批次題幹修正",
        changes,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return file;
}

function runScript(manifestPath: string, extra: string[] = []) {
  return spawnSync(
    process.execPath,
    [TSX_CLI, SCRIPT, "--database", testDbPath, "--manifest", manifestPath, ...extra],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, APP_DATABASE_PATH: testDbPath, LLM_PROVIDER: "mock", NODE_ENV: "test" },
    },
  );
}

function snapshot(): Array<{ id: string; revision: number; status: string; question: string }> {
  return SEEDS.map((seed) => {
    const question = repo.getQuestion(seed.id)!;
    return {
      id: question.id,
      revision: question.revision,
      status: question.status,
      question: question.question,
    };
  });
}

function mutationCount(): number {
  return (
    getDb().prepare("SELECT COUNT(*) AS c FROM question_mutations").get() as { c: number }
  ).c;
}

function reviewCount(): number {
  return (
    getDb().prepare("SELECT COUNT(*) AS c FROM question_reviews").get() as { c: number }
  ).c;
}

beforeAll(async () => {
  const connection = await import("@/server/db/connection");
  getDb = connection.getDb;
  repo = await import("@/server/repositories/questions");
  service = await import("@/server/services/question-service");
  mutations = await import("@/server/repositories/question-mutations");
  expect(fs.existsSync(TSX_CLI), "tsx CLI 存在").toBe(true);
  expect(fs.existsSync(SCRIPT), "腳本存在").toBe(true);
  getDb().prepare("DELETE FROM question_mutations").run();
});

beforeEach(() => {
  getDb().prepare("DELETE FROM question_reviews").run();
  getDb().prepare("DELETE FROM question_mutations").run();
  getDb().prepare("DELETE FROM questions").run();
  getDb().prepare("DELETE FROM sections").run();
  getDb().prepare("DELETE FROM topics").run();
  const now = "2026-10-23T00:00:00.000Z";
  getDb()
    .prepare(
      `INSERT INTO topics (id, title, description, published, sort_order, created_at, updated_at)
       VALUES ('topic-chrono', '合成課題', '', 1, 0, ?, ?)`,
    )
    .run(now, now);
  getDb()
    .prepare(
      `INSERT INTO sections (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       VALUES ('section-chrono', 'topic-chrono', NULL, '合成分節', '', '[]', 0, ?, ?)`,
    )
    .run(now, now);
  for (const seed of SEEDS) insertSyntheticQuestion(seed);
});

describe("交易原子性", () => {
  it("第二項領域檢查失敗時，第一項不會留在已修改狀態", () => {
    const before = snapshot();

    expect(() =>
      service.applyQuestionStemBatch({
        changes: SEEDS.map((seed) => ({
          questionId: seed.id,
          expectedQuestion: seed.question,
          expectedRevision: 1,
          expectedStatus: "published" as const,
          nextQuestion: seed.next,
        })),
        actor: { email: ACTOR, role: "automation" },
        source: "tests/chronology-stem-batch.test.ts",
        reason: "合成測試",
        validate: (_question, nextQuestion) =>
          nextQuestion.includes("合成題二") ? "合成的刻意失敗（第二項）" : null,
      }),
    ).toThrow(/合成的刻意失敗/);

    // 第一項在交易內已寫入，然後隨整個交易回滾
    expect(snapshot()).toEqual(before);
    expect(snapshot()[0]!.revision).toBe(1);
    expect(snapshot()[0]!.status).toBe("published");
    expect(mutationCount()).toBe(0);
    expect(reviewCount()).toBe(0);
  });

  it("交易內發現清單過期（版本／題幹／狀態已改變）時不寫入任何變更", () => {
    const before = snapshot();
    // 模擬「列出清單之後、套用之前」被另一個人修改
    const changed = repo.updateQuestion(SEEDS[1]!.id, {
      ...repo.getQuestion(SEEDS[1]!.id)!,
      question: `${SEEDS[1]!.question}（他人修改）`,
    });
    expect(changed.revision).toBe(2);
    const afterOthersEdit = snapshot();

    expect(() =>
      service.applyQuestionStemBatch({
        changes: SEEDS.map((seed) => ({
          questionId: seed.id,
          expectedQuestion: seed.question,
          expectedRevision: 1,
          expectedStatus: "published" as const,
          nextQuestion: seed.next,
        })),
        actor: { email: ACTOR, role: "automation" },
        source: "tests/chronology-stem-batch.test.ts",
      }),
    ).toThrow(/題幹與清單不同|版本已改變/);

    expect(snapshot()).toEqual(afterOthersEdit);
    expect(snapshot()[0]).toEqual(before[0]);
    expect(mutationCount()).toBe(0);
    expect(reviewCount()).toBe(0);
  });
});

describe("成功批次與稽核紀錄", () => {
  it("全部題目改為草稿、版本 +1，並為每題寫入一筆具名變更紀錄", () => {
    const manifest = writeManifest(
      SEEDS.map((seed) => ({ questionId: seed.id, before: seed.question, after: seed.next })),
    );

    const run = runScript(manifest, ["--actor", ACTOR, "--apply"]);
    expect(run.status, run.stderr).toBe(0);

    for (const seed of SEEDS) {
      const question = repo.getQuestion(seed.id)!;
      expect(question.question).toBe(seed.next);
      expect(question.revision).toBe(2);
      expect(question.status).toBe("draft");
    }

    expect(mutationCount()).toBe(SEEDS.length);
    const rows = mutations.listQuestionMutations(SEEDS[0]!.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      questionId: SEEDS[0]!.id,
      action: "update-question-stem",
      beforeRevision: 1,
      afterRevision: 2,
      beforeQuestion: SEEDS[0]!.question,
      afterQuestion: SEEDS[0]!.next,
      actorEmail: ACTOR,
      actorRole: "automation",
      source: "scripts/fix-chronology-stem-years.ts",
      reason: "合成測試：批次題幹修正",
    });
    expect(rows[0]!.beforeFingerprint).not.toBe(rows[0]!.afterFingerprint);

    // 內容變更不是教師覆核：不可留下任何覆核紀錄
    expect(reviewCount()).toBe(0);

    fs.rmSync(manifest, { force: true });
  });
});

describe("過期清單重跑", () => {
  it("同一份清單再跑一次會安全失敗，不會再修改或新增紀錄", () => {
    const manifest = writeManifest(
      SEEDS.map((seed) => ({ questionId: seed.id, before: seed.question, after: seed.next })),
    );
    expect(runScript(manifest, ["--actor", ACTOR, "--apply"]).status).toBe(0);
    const afterFirstRun = snapshot();
    expect(mutationCount()).toBe(SEEDS.length);

    const second = runScript(manifest, ["--actor", ACTOR, "--apply"]);
    expect(second.status).toBe(1);
    expect(`${second.stdout}${second.stderr}`).toContain("整批不會寫入");

    expect(snapshot()).toEqual(afterFirstRun);
    expect(mutationCount()).toBe(SEEDS.length);
    expect(reviewCount()).toBe(0);

    fs.rmSync(manifest, { force: true });
  });
});
