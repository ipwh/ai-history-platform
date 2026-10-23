/**
 * `generate:questions` 的發布政策（Sprint 20 迴歸覆蓋）。
 *
 * 背景：2026-10-23 實際發生「`--draft-only` 名不副實」——旗標只停用了示範模式自動發布，
 * 但 `recordAutoValidationAndPublish` 仍會把通過自動驗證的題目直接發布（14 題）。
 * 之後加入 `autoPublish: false` 修正，但當時只有服務層測試；本檔在**CLI 邊界**鎖定
 * 同一契約（旗標 → 服務 → 資料庫狀態）。
 *
 * 本檔說明各條路徑的發布行為（與 README「題目發布政策」一致）：
 *
 *   | 路徑 | 會否自動發布 | 條件 |
 *   | --- | --- | --- |
 *   | `generate:questions`（預設） | 會（只限通過自動品質驗證的題目） | `AUTO_PUBLISH_VALIDATED_QUESTIONS=true`（預設）|
 *   | `generate:questions --draft-only` | **不會** | 旗標本身；連自動驗證路線亦停用 |
 *   | 示範題庫自動發布 | 會 | 非正式環境 **且** `DEMO_AUTO_PUBLISH_QUESTIONS=true` |
 *   | 品質閘門「未確定」 | **不會** | 一律保留草稿，須教師逐題確認 |
 *   | 人工覆核 | 會 | 教師 approved（唯一會留下 `question_reviews` 的路徑）|
 *
 * 自動品質驗證**不是**歷史事實核對：它只代表機器檢查（教材依據、答案一致、結構可作答）
 * 通過，不代表史實正確。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { freshTestDatabasePath } from "./test-database";
import { importTestPilotMaterial } from "./fixtures/pilot-material";

const testDbPath = freshTestDatabasePath("generate-draft-only");
process.env.APP_DATABASE_PATH = testDbPath;
process.env.LLM_PROVIDER = "mock";
delete process.env.K_SERVICE;

type Connection = typeof import("@/server/db/connection");

let getDb: Connection["getDb"];

const TSX_CLI = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const SCRIPT = path.join(process.cwd(), "scripts", "generate-question-bank.ts");

function runGenerator(extra: string[]) {
  return spawnSync(process.execPath, [TSX_CLI, SCRIPT, ...extra], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      APP_DATABASE_PATH: testDbPath,
      LLM_PROVIDER: "mock",
      NODE_ENV: "test",
    },
  });
}

function ids(): Set<string> {
  return new Set(
    (getDb().prepare("SELECT id FROM questions").all() as { id: string }[]).map((row) => row.id),
  );
}

function questionRow(id: string): { status: string; autoValidatedAt: string | null } {
  return getDb()
    .prepare("SELECT status, auto_validated_at AS autoValidatedAt FROM questions WHERE id = ?")
    .get(id) as { status: string; autoValidatedAt: string | null };
}

function reviewCount(): number {
  return (getDb().prepare("SELECT COUNT(*) AS c FROM question_reviews").get() as { c: number }).c;
}

beforeAll(async () => {
  getDb = (await import("@/server/db/connection")).getDb;
  const seed = await import("@/server/seed");
  seed.ensureBootstrap();
  await importTestPilotMaterial();
  expect(fs.existsSync(TSX_CLI), "tsx CLI 存在").toBe(true);
  expect(fs.existsSync(SCRIPT), "生成腳本存在").toBe(true);
});

describe("發布政策（CLI 邊界）", () => {
  it("--draft-only：新增題目全部為草稿，即使通過自動驗證亦不會發布", () => {
    const before = ids();
    const reviewsBefore = reviewCount();

    const run = runGenerator(["--topic", "topic-5", "--count", "2", "--draft-only"]);
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);

    const created = [...ids()].filter((id) => !before.has(id));
    expect(created.length, "應有新題目").toBeGreaterThan(0);
    for (const id of created) {
      const row = questionRow(id);
      expect(row.status, `題目 ${id} 應保持草稿`).toBe("draft");
    }
    // 草稿仍可保留自動驗證紀錄（那是機器檢查的證據），但不可藉此發布
    expect(reviewCount()).toBe(reviewsBefore);
  });

  it("重複執行不會重複新增（已達目標的分節會被略過）", () => {
    const before = ids();
    const run = runGenerator(["--topic", "topic-5", "--count", "2", "--draft-only"]);
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    const created = [...ids()].filter((id) => !before.has(id));
    expect(created.length).toBe(0);
  });

  it("預設模式：通過自動驗證的題目會即時供學生練習，但不會留下覆核紀錄", () => {
    // 前兩個測試已把 topic-5 的目標題數填滿；清空後才能觀察「新題目」的發布行為
    getDb().prepare("DELETE FROM questions WHERE topic_id = 'topic-5'").run();
    const before = ids();
    const reviewsBefore = reviewCount();

    const run = runGenerator(["--topic", "topic-5", "--count", "2"]);
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);

    const created = [...ids()].filter((id) => !before.has(id));
    expect(created.length, "應有新題目").toBeGreaterThan(0);

    const published = created.filter((id) => questionRow(id).status === "published");
    for (const id of published) {
      // 已發布者必須有**目前版本**的自動驗證紀錄（機器檢查通過才可發布）
      expect(questionRow(id).autoValidatedAt).not.toBeNull();
    }
    // 自動驗證不是教師覆核：這條路徑不可留下任何 question_reviews
    expect(reviewCount()).toBe(reviewsBefore);
  });
});
