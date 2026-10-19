/**
 * 內容稽核的整合測試：唯讀、可重複、分類正確。
 */
import { beforeAll, describe, expect, it } from "vitest";

import { questionSchema, type Question } from "@/lib/types";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("content-audit");
process.env.LLM_PROVIDER = "mock";
delete process.env.K_SERVICE;

const QUESTION_ID = "q-content-audit-1";

function buildQuestion(): Question {
  return questionSchema.parse({
    id: QUESTION_ID,
    topicId: "topic-5",
    sectionId: "topic-5-renaissance-features",
    questionType: "fill",
    difficulty: "basic",
    question: "文藝復興首先在＿＿＿興起。",
    options: [],
    correctAnswer: "意大利",
    acceptedAnswers: [],
    explanation: "答案依校內試題檔的評卷參考。",
    knowledgePoint: "D. iii、iv",
    sourceExcerpt: "文藝復興首先在意大利興起。",
    sourceLocation: "課題5_填充題.docx · 第 7 題 · D. iii、iv",
    sourceBlockIds: [],
    gradingPoints: [],
    origin: "school-paper",
    status: "published",
    sourceVerified: false,
    qualityWarnings: [],
    skill: null,
    revision: 1,
    autoValidatedAt: null,
    autoValidatedRevision: null,
    autoValidatedFingerprint: null,
    teacherConfirmationRequired: false,
    createdAt: "2026-10-19T00:00:00.000Z",
  });
}

describe("內容稽核（整合）", () => {
  type Repo = typeof import("@/server/repositories/questions");
  type Audit = typeof import("@/server/quality/content-audit");
  let repo: Repo;
  let audit: Audit;

  beforeAll(async () => {
    repo = await import("@/server/repositories/questions");
    audit = await import("@/server/quality/content-audit");
    const seed = await import("@/server/seed");
    seed.ensureBootstrap();
    repo.insertQuestion(buildQuestion());
  });

  it("分類來源、解釋及元數據，並標示待決政策", () => {
    const payload = audit.loadContentAudit(process.env.APP_DATABASE_PATH!);
    const item = payload.questions.find((question) => question.id === QUESTION_ID);
    expect(item).toBeDefined();
    expect(item!.source.status).toBe("pending_verification");
    expect(item!.explanation.class).toBe("placeholder");
    expect(item!.metadata.issues.map((issue) => issue.code)).toContain(
      "KNOWLEDGE_POINT_LAYOUT_RESIDUE",
    );
    expect(item!.policy.counts.policy_pending).toBe(1);
    expect(item!.policy.canServe).toBe(true);
    expect(item!.policy.releasable).toBe(false);
  });

  it("相同資料重跑會得到相同的內容指紋", () => {
    const first = audit.loadContentAudit(process.env.APP_DATABASE_PATH!);
    const second = audit.loadContentAudit(process.env.APP_DATABASE_PATH!);
    expect(first.inputFingerprint).toBe(second.inputFingerprint);
    expect(first.source.counts).toEqual(second.source.counts);
    expect(first.explanation.counts).toEqual(second.explanation.counts);
  });

  it("稽核不會修改題目或版本", () => {
    const before = repo.getQuestion(QUESTION_ID);
    audit.loadContentAudit(process.env.APP_DATABASE_PATH!);
    const after = repo.getQuestion(QUESTION_ID);
    expect(after).toEqual(before);
  });

  it("輸出不含學生資料或秘密欄位", () => {
    const payload = audit.loadContentAudit(process.env.APP_DATABASE_PATH!);
    const serialised = JSON.stringify(payload);
    expect(serialised).not.toContain("learnerId");
    expect(serialised).not.toContain("AUTH_SECRET");
    expect(serialised).not.toContain("apiKey");
  });
});
