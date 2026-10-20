/**
 * 解釋補寫套用測試。
 *
 * 驗證的契約（產品負責人 2026-10-20 決定由 AI 逐題補寫解釋，因此這些界線必須寫成測試）：
 *   1. **只改 explanation**：`correctAnswer`、`acceptedAnswers`、`options`、題幹完全不變。
 *   2. **保留發布狀態**：已發布的仍然發布（不啟用暫緩派發）。
 *   3. **版本如實遞增**：內容真的變了，`revision` +1，舊覆核如實失效（不偽造覆核）。
 *   4. **不寫 `question_reviews`**：改寫紀錄寫入 `question_content_flags`。
 *   5. **預設模擬**：`dryRun: true` 時零寫入。
 *   6. **atomic**：任何一條不合格，整批不寫入。
 *   7. **冪等與競態**：已是同一段文字 → `already-applied`；與清單記錄不符 → 跳過不覆寫。
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { freshTestDatabasePath } from "./test-database";
import { questionSchema, type Question } from "@/lib/types";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("explanation-rewrite");
process.env.LLM_PROVIDER = "mock";
delete process.env.K_SERVICE;

type Service = typeof import("@/server/services/explanation-rewrite");
type Repo = typeof import("@/server/repositories/questions");
type Connection = typeof import("@/server/db/connection");

let service: Service;
let repo: Repo;
let getDb: Connection["getDb"];

const ACTOR = { actorEmail: "ai-copilot-test", actorRole: "automation" };
const GOOD_EXPLANATION =
  "文字發明前人類沒有文字紀錄，只能靠考古發現認識當時生活，因此這段時期稱為史前時期。";

beforeAll(async () => {
  service = await import("@/server/services/explanation-rewrite");
  repo = await import("@/server/repositories/questions");
  ({ getDb } = await import("@/server/db/connection"));
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

function insertQuestion(id: string, explanation: string): Question {
  const { topicId, sectionId } = firstTopicAndSection();
  const question = questionSchema.parse({
    id,
    topicId,
    sectionId,
    questionType: "mc",
    difficulty: "basic",
    question: "以下哪項的出現標誌着「信史時期」的展開？",
    options: ["文字", "農業", "金屬", "石器"],
    correctAnswer: "文字",
    acceptedAnswers: ["文字"],
    explanation,
    knowledgePoint: "A. 石器時代的演進",
    sourceExcerpt: "約公元前3200年，人類發明文字以作記錄及溝通之用。",
    sourceLocation: "課題1 填充題 · 第 1 題",
    sourceBlockIds: [],
    gradingPoints: [],
    origin: "school-paper",
    status: "published",
    sourceVerified: false,
    qualityWarnings: [],
    skill: null,
    revision: 1,
    createdAt: new Date().toISOString(),
  });
  return repo.insertQuestion(question);
}

function countRows(table: string): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as unknown as {
    total: number;
  };
  return row.total;
}

beforeEach(() => {
  getDb().exec("DELETE FROM question_content_flags");
  getDb().exec("DELETE FROM question_reviews");
  getDb().exec("DELETE FROM questions");
  insertQuestion("q-placeholder", "答案依校內試題檔的評卷參考。");
});

describe("applyExplanationRewrites", () => {
  it("模擬模式不會寫入，也不會改動題目", () => {
    const before = repo.getQuestion("q-placeholder");
    const report = service.applyExplanationRewrites(
      [
        {
          questionId: "q-placeholder",
          expectedExplanation: "答案依校內試題檔的評卷參考。",
          newExplanation: GOOD_EXPLANATION,
        },
      ],
      { dryRun: true, batchTitle: "測試批次", ...ACTOR },
    );

    expect(report.dryRun).toBe(true);
    expect(report.planned).toBe(1);
    expect(report.applied).toBe(0);
    expect(repo.getQuestion("q-placeholder")).toEqual(before);
    expect(countRows("question_content_flags")).toBe(0);
  });

  it("套用後只改 explanation，答案、選項、題幹及發布狀態不變", () => {
    const before = repo.getQuestion("q-placeholder");
    if (!before) throw new Error("測試題目不存在");

    service.applyExplanationRewrites(
      [
        {
          questionId: "q-placeholder",
          expectedExplanation: before.explanation,
          newExplanation: GOOD_EXPLANATION,
        },
      ],
      { dryRun: false, batchTitle: "測試批次", ...ACTOR },
    );

    const after = repo.getQuestion("q-placeholder");
    if (!after) throw new Error("題目在寫入後消失");
    expect(after.explanation).toBe(GOOD_EXPLANATION);
    expect(after.correctAnswer).toBe(before.correctAnswer);
    expect(after.acceptedAnswers).toEqual(before.acceptedAnswers);
    expect(after.options).toEqual(before.options);
    expect(after.question).toBe(before.question);
    expect(after.status).toBe("published");
    expect(after.teacherConfirmationRequired).toBe(before.teacherConfirmationRequired);
    // 內容真的變了 → 版本如實 +1
    expect(after.revision).toBe(before.revision + 1);
  });

  it("不寫 question_reviews（改寫不是教師覆核）", () => {
    service.applyExplanationRewrites(
      [
        {
          questionId: "q-placeholder",
          expectedExplanation: "答案依校內試題檔的評卷參考。",
          newExplanation: GOOD_EXPLANATION,
        },
      ],
      { dryRun: false, batchTitle: "測試批次", ...ACTOR },
    );
    expect(countRows("question_reviews")).toBe(0);
  });

  it("改寫紀錄寫入 question_content_flags 並保留批次標題", () => {
    service.applyExplanationRewrites(
      [
        {
          questionId: "q-placeholder",
          expectedExplanation: "答案依校內試題檔的評卷參考。",
          newExplanation: GOOD_EXPLANATION,
          note: "依課題1 課文",
        },
      ],
      { dryRun: false, batchTitle: "課題1 測試批次", ...ACTOR },
    );

    const rows = getDb()
      .prepare("SELECT flag, state, reason, actor_email, actor_role FROM question_content_flags")
      .all() as unknown as {
      flag: string;
      state: string;
      reason: string;
      actor_email: string;
      actor_role: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].flag).toBe("explanation_rewritten");
    expect(rows[0].state).toBe("open");
    expect(rows[0].reason).toContain("課題1 測試批次");
    expect(rows[0].reason).toContain("依課題1 課文");
    expect(rows[0].actor_email).toBe(ACTOR.actorEmail);
    expect(rows[0].actor_role).toBe(ACTOR.actorRole);
  });

  it("不合格的新解釋會失敗：分類仍屬不足（過短且沒有說明性用語）", () => {
    const report = service.applyExplanationRewrites(
      [
        {
          questionId: "q-placeholder",
          expectedExplanation: "答案依校內試題檔的評卷參考。",
          newExplanation: "這是歷史上的重要事件",
        },
      ],
      { dryRun: false, batchTitle: "測試批次", ...ACTOR },
    );
    expect(report.failed).toBe(1);
    expect(countRows("question_content_flags")).toBe(0);
  });

  it("不合格的新解釋會失敗：只重複答案", () => {
    const report = service.applyExplanationRewrites(
      [
        {
          questionId: "q-placeholder",
          expectedExplanation: "答案依校內試題檔的評卷參考。",
          newExplanation: "文字。",
        },
      ],
      { dryRun: false, batchTitle: "測試批次", ...ACTOR },
    );
    expect(report.failed).toBe(1);
  });

  it("atomic：任何一條失敗，整批都不寫入", () => {
    insertQuestion("q-placeholder-2", "答案依校內試題檔的評卷參考。");
    const report = service.applyExplanationRewrites(
      [
        {
          questionId: "q-placeholder",
          expectedExplanation: "答案依校內試題檔的評卷參考。",
          newExplanation: GOOD_EXPLANATION,
        },
        {
          questionId: "q-placeholder-2",
          expectedExplanation: "答案依校內試題檔的評卷參考。",
          newExplanation: "太短",
        },
      ],
      { dryRun: false, batchTitle: "測試批次", ...ACTOR },
    );

    expect(report.failed).toBe(1);
    expect(report.applied).toBe(0);
    expect(repo.getQuestion("q-placeholder")?.explanation).toBe("答案依校內試題檔的評卷參考。");
    expect(countRows("question_content_flags")).toBe(0);
  });

  it("現有解釋與清單記錄不同時跳過，不覆寫別人的修改", () => {
    const report = service.applyExplanationRewrites(
      [
        {
          questionId: "q-placeholder",
          expectedExplanation: "另一位老師已改過的解釋內容，但清單仍記錄舊的佔位文字。",
          newExplanation: GOOD_EXPLANATION,
        },
      ],
      { dryRun: false, batchTitle: "測試批次", ...ACTOR },
    );
    expect(report.skipped).toBe(1);
    expect(repo.getQuestion("q-placeholder")?.explanation).toBe("答案依校內試題檔的評卷參考。");
  });

  it("重跑同一批不會重複寫入（已是最新）", () => {
    const entry = {
      questionId: "q-placeholder",
      expectedExplanation: "答案依校內試題檔的評卷參考。",
      newExplanation: GOOD_EXPLANATION,
    };
    service.applyExplanationRewrites([entry], { dryRun: false, batchTitle: "第一批", ...ACTOR });
    const second = service.applyExplanationRewrites([entry], {
      dryRun: false,
      batchTitle: "第一批",
      ...ACTOR,
    });

    expect(second.alreadyApplied).toBe(1);
    expect(second.applied).toBe(0);
    expect(countRows("question_content_flags")).toBe(1);
  });
});
