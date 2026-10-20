/**
 * 內容改進標記（append-only 事件）及教師端佇列測試。
 *
 * 驗證的契約：
 *   1. **dry-run 不寫入**：模擬模式不會產生任何事件，也不會改動題目。
 *   2. **不改題目**：標記前後的題目內容、答案、技能、版本及發布狀態完全不變。
 *   3. **冪等**：同一版本重複標記不會產生重複事件。
 *   4. **只可新增**：解除標記是新增事件，歷史（誰、何時、理由）仍然保留。
 *   5. **atomic**：任何一條失敗，整批都不寫入。
 *   6. **不重複排入佇列**：已回答的題目（技能已標示、解釋已達標）會被跳過，除非 --force。
 *   7. **佇列不假裝有資料**：報告不存在時回報 available: false。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("content-flags");
process.env.LLM_PROVIDER = "mock";
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
delete process.env.K_SERVICE;
delete process.env.EXPLANATION_HOLD_POLICY;

type Service = typeof import("@/server/services/content-improvement");
type Repo = typeof import("@/server/repositories/questions");
type Connection = typeof import("@/server/db/connection");
type Types = typeof import("@/lib/types");

let service: Service;
let repo: Repo;
let getDb: Connection["getDb"];
let types: Types;

const ACTOR = { email: "teacher@example.com", role: "teacher" };

beforeAll(async () => {
  service = await import("@/server/services/content-improvement");
  repo = await import("@/server/repositories/questions");
  ({ getDb } = await import("@/server/db/connection"));
  types = await import("@/lib/types");
  const seed = await import("@/server/seed");
  seed.ensureBootstrap();
});

function firstTopicAndSection(): { topicId: string; sectionId: string } {
  const row = getDb()
    .prepare("SELECT id, topic_id FROM sections ORDER BY topic_id, id LIMIT 1")
    .get() as unknown as { id: string; topic_id: string } | undefined;
  if (!row) throw new Error("測試資料庫沒有分節（seed 未執行）");
  return { topicId: row.topic_id, sectionId: row.id };
}

function insertQuestion(overrides: {
  id: string;
  explanation: string;
  skill?: string | null;
  status?: "draft" | "published";
}): void {
  const { topicId, sectionId } = firstTopicAndSection();
  const question = types.questionSchema.parse({
    id: overrides.id,
    topicId,
    sectionId,
    questionType: "fill",
    difficulty: "basic",
    question: "＿＿＿是文字出現前，沒有文字紀錄的時期。",
    options: [],
    correctAnswer: "史前時期",
    acceptedAnswers: [],
    explanation: overrides.explanation,
    knowledgePoint: "A. 石器時代的演進",
    sourceExcerpt: "＿＿＿是文字出現前，沒有文字紀錄的時期。",
    sourceLocation: "校內試題 · 第 1 題",
    sourceBlockIds: [],
    gradingPoints: [],
    origin: "school-paper",
    status: overrides.status ?? "published",
    sourceVerified: false,
    qualityWarnings: [],
    skill: overrides.skill ?? null,
    revision: 1,
    createdAt: new Date().toISOString(),
  });
  repo.insertQuestion(question);
}

function flagEventCount(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS total FROM question_content_flags")
    .get() as unknown as { total: number };
  return row.total;
}

beforeEach(() => {
  getDb().exec("DELETE FROM question_content_flags");
  getDb().exec("DELETE FROM questions");
  insertQuestion({
    id: "q-placeholder",
    explanation: "答案依校內試題檔的評卷參考。",
  });
  insertQuestion({
    id: "q-good",
    explanation: "因為史前時期沒有人類文字紀錄，所以歷史學家稱這段時期為史前時期，反映文字是劃分信史與史前的關鍵。",
  });
  insertQuestion({
    id: "q-skilled",
    explanation: "答案依校內試題檔的評卷參考。",
    skill: "正確地使用歷史辭彙",
  });
});

describe("applyContentFlags（模擬模式）", () => {
  it("dry-run 不會寫入任何事件，也不會改動題目", () => {
    const before = repo.getQuestion("q-placeholder");
    const report = service.applyContentFlags(
      [
        {
          questionId: "q-placeholder",
          flag: "explanation_needs_rewrite",
          action: "mark",
          reason: "2026-10 內容稽核：解釋為佔位文字",
        },
      ],
      { dryRun: true, actor: ACTOR },
    );

    expect(report.dryRun).toBe(true);
    expect(report.applied).toBe(0);
    expect(report.planned).toBe(1);
    expect(flagEventCount()).toBe(0);
    expect(repo.getQuestion("q-placeholder")).toEqual(before);
  });

  it("模擬模式的回報文字明確說明未寫入", () => {
    const report = service.applyContentFlags(
      [
        {
          questionId: "q-placeholder",
          flag: "explanation_needs_rewrite",
          action: "mark",
          reason: "理由",
        },
      ],
      { dryRun: true, actor: ACTOR },
    );
    expect(report.results[0].outcome).toBe("planned");
    expect(report.results[0].detail).toContain("未寫入");
  });
});

describe("applyContentFlags（套用）", () => {
  it("寫入事件並保留標記者、理由及題目版本", () => {
    const report = service.applyContentFlags(
      [
        {
          questionId: "q-placeholder",
          flag: "explanation_needs_rewrite",
          action: "mark",
          reason: "2026-10 內容稽核：解釋為佔位文字",
        },
      ],
      { dryRun: false, actor: ACTOR },
    );

    expect(report.applied).toBe(1);
    const [view] = service.listCurrentFlags(["q-placeholder"]);
    expect(view.state).toBe("open");
    expect(view.flag).toBe("explanation_needs_rewrite");
    expect(view.actorEmail).toBe(ACTOR.email);
    expect(view.reason).toContain("佔位文字");
    expect(view.revision).toBe(1);
    expect(view.contentChangedSinceFlag).toBe(false);
  });

  it("不改動題目內容、答案、技能、版本或發布狀態", () => {
    const before = repo.getQuestion("q-placeholder");
    service.applyContentFlags(
      [
        {
          questionId: "q-placeholder",
          flag: "explanation_needs_rewrite",
          action: "mark",
          reason: "理由",
        },
      ],
      { dryRun: false, actor: ACTOR },
    );
    expect(repo.getQuestion("q-placeholder")).toEqual(before);
  });

  it("重複標記同一版本不會產生重複事件（冪等）", () => {
    const request = {
      questionId: "q-placeholder",
      flag: "explanation_needs_rewrite" as const,
      action: "mark" as const,
      reason: "理由",
    };
    service.applyContentFlags([request], { dryRun: false, actor: ACTOR });
    const second = service.applyContentFlags([request], { dryRun: false, actor: ACTOR });

    expect(second.alreadyApplied).toBe(1);
    expect(second.applied).toBe(0);
    expect(flagEventCount()).toBe(1);
  });

  it("解除標記是新增事件，原有歷史仍然保留", () => {
    service.applyContentFlags(
      [
        {
          questionId: "q-placeholder",
          flag: "explanation_needs_rewrite",
          action: "mark",
          reason: "先標記",
        },
      ],
      { dryRun: false, actor: ACTOR },
    );
    service.applyContentFlags(
      [
        {
          questionId: "q-placeholder",
          flag: "explanation_needs_rewrite",
          action: "clear",
          reason: "已按課本補寫解釋",
        },
      ],
      { dryRun: false, actor: ACTOR },
    );

    expect(flagEventCount()).toBe(2);
    const [view] = service.listCurrentFlags(["q-placeholder"]);
    expect(view.state).toBe("cleared");
    expect(service.hasOpenFlag("q-placeholder", "explanation_needs_rewrite")).toBe(false);
  });

  it("缺少理由時失敗，而且不會寫入", () => {
    const report = service.applyContentFlags(
      [
        {
          questionId: "q-placeholder",
          flag: "explanation_needs_rewrite",
          action: "mark",
          reason: "   ",
        },
      ],
      { dryRun: false, actor: ACTOR },
    );
    expect(report.failed).toBe(1);
    expect(flagEventCount()).toBe(0);
  });

  it("atomic：任何一條失敗，整批都不寫入", () => {
    const report = service.applyContentFlags(
      [
        {
          questionId: "q-placeholder",
          flag: "explanation_needs_rewrite",
          action: "mark",
          reason: "理由",
        },
        {
          questionId: "missing-question",
          flag: "explanation_needs_rewrite",
          action: "mark",
          reason: "理由",
        },
      ],
      { dryRun: false, actor: ACTOR },
    );

    expect(report.failed).toBe(1);
    expect(report.applied).toBe(0);
    expect(flagEventCount()).toBe(0);
  });

  it("解釋已達標的題目會被跳過，加 force 才可標記", () => {
    const skipped = service.applyContentFlags(
      [
        {
          questionId: "q-good",
          flag: "explanation_needs_rewrite",
          action: "mark",
          reason: "理由",
        },
      ],
      { dryRun: false, actor: ACTOR },
    );
    expect(skipped.skipped).toBe(1);
    expect(flagEventCount()).toBe(0);

    const forced = service.applyContentFlags(
      [
        {
          questionId: "q-good",
          flag: "explanation_needs_rewrite",
          action: "mark",
          reason: "理由",
        },
      ],
      { dryRun: false, actor: ACTOR, force: true },
    );
    expect(forced.applied).toBe(1);
  });

  it("已標示技能的題目不會再排入「技能待確認」，加 force 才可標記", () => {
    const skipped = service.applyContentFlags(
      [
        {
          questionId: "q-skilled",
          flag: "skill_needs_confirmation",
          action: "mark",
          reason: "理由",
        },
      ],
      { dryRun: false, actor: ACTOR },
    );
    expect(skipped.skipped).toBe(1);

    const forced = service.applyContentFlags(
      [
        {
          questionId: "q-skilled",
          flag: "skill_needs_confirmation",
          action: "mark",
          reason: "理由",
        },
      ],
      { dryRun: false, actor: ACTOR, force: true },
    );
    expect(forced.applied).toBe(1);
  });

  it("題目內容被改寫後，舊標記會標示為「內容已改，需重新判斷」而不會靜默清除", () => {
    service.applyContentFlags(
      [
        {
          questionId: "q-placeholder",
          flag: "explanation_needs_rewrite",
          action: "mark",
          reason: "理由",
        },
      ],
      { dryRun: false, actor: ACTOR },
    );

    const current = repo.getQuestion("q-placeholder");
    if (!current) throw new Error("測試題目不存在");
    repo.updateQuestion("q-placeholder", {
      ...current,
      explanation: "新的解釋內容，說明史前時期沒有人類文字紀錄。",
    });

    const [view] = service.listCurrentFlags(["q-placeholder"]);
    expect(view.state).toBe("open");
    expect(view.contentChangedSinceFlag).toBe(true);
  });
});

describe("listContentImprovementQueue", () => {
  function writeReport(root: string, items: unknown[]): void {
    const dir = path.join(root, "docs", "quality");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "explanation-skill-worklist-2026-10-20.json"),
      JSON.stringify({
        generatedAt: "2026-10-20T00:00:00.000Z",
        notice: "測試",
        inputFingerprint: "test",
        totals: {
          questions: items.length,
          published: items.length,
          explanationByClass: { placeholder: items.length },
          explanationByImprovement: { add_concept_definition: items.length },
          skillMissing: items.length,
          needsWork: items.length,
          skillSuggestionByConfidence: { high: 0, medium: 0, low: items.length },
        },
        items,
      }),
      "utf8",
    );
  }

  function workItem(questionId: string) {
    return {
      questionId,
      revision: 1,
      topicId: "topic-1",
      topicTitle: "課題1",
      sectionId: "topic-1-paleolithic",
      sectionTitle: "石器時代",
      questionType: "fill",
      stemSummary: "＿＿＿是文字出現前……",
      currentExplanation: "答案依校內試題檔的評卷參考。",
      correctAnswer: "史前時期",
      currentSkill: null,
      knowledgePoint: "A. 石器時代的演進",
      sourceExcerpt: "＿＿＿是文字出現前……",
      sourceLocation: "校內試題 · 第 1 題",
      explanation: {
        class: "placeholder",
        improvement: "add_concept_definition",
        improvementLabel: "需補概念定義",
        alsoConsider: [],
        alsoConsiderLabels: [],
        rationale: "理由",
        hasSourcePassage: false,
      },
      skill: { suggestions: [] },
    };
  }

  it("報告不存在時回報 available: false，不用替代數字", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hist-queue-missing-"));
    const page = service.listContentImprovementQueue({}, { repoRoot: root });
    expect(page.available).toBe(false);
    expect(page.items).toHaveLength(0);
    expect(page.limitation).toContain("audit:explanation-worklist");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("讀取報告、分頁，並合併現行標記", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hist-queue-"));
    writeReport(root, [workItem("q-placeholder"), workItem("q-good"), workItem("q-skilled")]);

    const firstPage = service.listContentImprovementQueue(
      { pageSize: 2 },
      { repoRoot: root },
    );
    expect(firstPage.available).toBe(true);
    expect(firstPage.total).toBe(3);
    expect(firstPage.items).toHaveLength(2);

    service.applyContentFlags(
      [
        {
          questionId: "q-placeholder",
          flag: "explanation_needs_rewrite",
          action: "mark",
          reason: "理由",
        },
      ],
      { dryRun: false, actor: ACTOR },
    );

    const unflagged = service.listContentImprovementQueue(
      { status: "unflagged", pageSize: 10 },
      { repoRoot: root },
    );
    expect(unflagged.items.map((item) => item.questionId)).not.toContain("q-placeholder");
    expect(unflagged.counts.flagged.explanation_needs_rewrite).toBe(1);

    const flagged = service.listContentImprovementQueue(
      { status: "flagged", flag: "explanation_needs_rewrite", pageSize: 10 },
      { repoRoot: root },
    );
    expect(flagged.items.map((item) => item.questionId)).toEqual(["q-placeholder"]);
    expect(flagged.items[0].openFlags).toContain("explanation_needs_rewrite");

    fs.rmSync(root, { recursive: true, force: true });
  });
});
