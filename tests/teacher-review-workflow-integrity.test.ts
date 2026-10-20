/**
 * 人工覆核流程的完整性（Sprint 8.6 第二階段）。
 *
 * 這一組測試鎖定「覆核是人的決定」這件事：
 *   1. 覆核者身分不可留空（服務層拒絕空白電郵／角色）。
 *   2. 正式環境不會以「示範模式：未登入」身分寫入覆核紀錄（即使設定了不安全示範開關）。
 *   3. 未登入的示範環境只會記錄如實的示範身分，不會假裝有教師帳戶；紀錄可稽核。
 *   4. 人工覆核不會改變教材的版權／來源可見性規則：覆核通過一題，不會令未核實的節錄
 *      或未開放的教材對學生顯示。
 *   5. 機器驗證不能清除暫緩標記（Sprint 8.5 已修正，這裡由流程角度再確認一次）。
 *
 * 全部使用測試資料庫，不呼叫任何付費 AI、不接觸正式資源。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("teacher-review-integrity");
process.env.LLM_PROVIDER = "mock";
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
delete process.env.ADMIN_TOKEN;
delete process.env.K_SERVICE;
delete process.env.HISTORY_ALLOW_UNSAFE_DEMO_MODE;

type MaterialsRepo = typeof import("@/server/repositories/materials");
type QuestionRepo = typeof import("@/server/repositories/questions");
type QuestionService = typeof import("@/server/services/question-service");
type SeedModule = typeof import("@/server/seed");
type ReviewRoute = typeof import("@/app/api/teacher/questions/[questionId]/review/route");

let materialsRepo: MaterialsRepo;
let questions: QuestionRepo;
let questionService: QuestionService;
let seed: SeedModule;
let reviewRoute: ReviewRoute;

beforeAll(async () => {
  materialsRepo = await import("@/server/repositories/materials");
  questions = await import("@/server/repositories/questions");
  questionService = await import("@/server/services/question-service");
  seed = await import("@/server/seed");
  reviewRoute = await import("@/app/api/teacher/questions/[questionId]/review/route");
  seed.ensureBootstrap();
});

afterEach(() => {
  delete process.env.K_SERVICE;
  delete process.env.HISTORY_ALLOW_UNSAFE_DEMO_MODE;
  vi.restoreAllMocks();
});

/** 建立一份合成教材文件（kind = demo，可向學生發布） */
function createDemoDocument(sourceNote: string) {
  const document = materialsRepo.createDocument({
    fileName: `合成教材（覆核流程） ${sourceNote}.docx`,
    kind: "demo",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 1024,
    status: "ready",
    topicId: "topic-1",
    sourceNote,
  });
  const blocks = materialsRepo.insertBlocks([
    {
      documentId: document.id,
      topicId: "topic-1",
      sectionId: "topic-1-stone-age",
      order: 0,
      type: "paragraph",
      level: null,
      text: "合成教材：古人類最早在非洲出現，其後逐步遷徙至亞洲及歐洲。",
      table: null,
      sourceLocation: `${document.fileName} · 第 1 段（段落）`,
    },
  ]);
  return { document, blockId: blocks[0]!.id };
}

function createQuestion(id: string, input: { blockId: string; sourceVerified: boolean }) {
  return questions.insertQuestion({
    id,
    topicId: "topic-1",
    sectionId: "topic-1-stone-age",
    questionType: "mc",
    difficulty: "basic",
    question: "合成問題：古人類最早在哪一洲出現？",
    options: ["非洲", "亞洲", "歐洲", "美洲"],
    correctAnswer: "非洲",
    acceptedAnswers: [],
    explanation: "合成解釋：教材指出古人類最早在非洲出現，因此答案為非洲。",
    knowledgePoint: "合成知識點",
    sourceExcerpt: "古人類最早在非洲出現",
    sourceLocation: "合成教材 · 第 1 段（段落）",
    sourceBlockIds: input.sourceVerified ? [input.blockId] : [],
    gradingPoints: [],
    origin: "manual",
    status: "draft",
    sourceVerified: input.sourceVerified,
    skill: null,
    qualityWarnings: [],
    autoValidatedAt: null,
    autoValidatedRevision: null,
    autoValidatedFingerprint: null,
    teacherConfirmationRequired: true,
    revision: 1,
    createdAt: new Date().toISOString(),
  });
}

describe("覆核者身分不可留空（服務層）", () => {
  it("沒有覆核者電郵時拒絕記錄，並保留題目原狀", () => {
    const { blockId } = createDemoDocument("blank-reviewer");
    const question = createQuestion("fx-review-blank", { blockId, sourceVerified: true });

    expect(() =>
      questionService.recordQuestionReview({
        questionId: question.id,
        decision: "approved",
        expectedRevision: question.revision,
        actor: { email: "   ", role: "teacher" },
      }),
    ).toThrowError(/缺少覆核者身分/);

    expect(() =>
      questionService.recordQuestionReview({
        questionId: question.id,
        decision: "approved",
        expectedRevision: question.revision,
        actor: { email: "teacher@example.com", role: "" },
      }),
    ).toThrowError(/缺少覆核者身分/);

    expect(questions.listQuestionReviews(question.id)).toHaveLength(0);
    const stored = questions.getQuestion(question.id)!;
    expect(stored.status).toBe("draft");
    expect(stored.teacherConfirmationRequired).toBe(true);
  });

  it("有效的覆核者會留下可稽核的紀錄（版本、指紋、身分、時間）", () => {
    const { blockId } = createDemoDocument("audit-record");
    const question = createQuestion("fx-review-audit", { blockId, sourceVerified: true });

    const result = questionService.recordQuestionReview({
      questionId: question.id,
      decision: "approved",
      expectedRevision: question.revision,
      actor: { email: "teacher@example.com", role: "teacher" },
    });
    expect(result.created).toBe(true);

    const reviews = questions.listQuestionReviews(question.id);
    expect(reviews).toHaveLength(1);
    const review = reviews[0]!;
    expect(review.decision).toBe("approved");
    expect(review.reviewerEmail).toBe("teacher@example.com");
    expect(review.reviewerRole).toBe("teacher");
    expect(review.revision).toBe(1);
    expect(review.questionFingerprint.length).toBeGreaterThan(10);
    expect(new Date(review.createdAt).toString()).not.toBe("Invalid Date");
  });

  it("題目在提交覆核前被修改：拒絕覆核，不會把決定記到未看過的版本（Sprint 8.7）", () => {
    const { blockId } = createDemoDocument("stale-review");
    const question = createQuestion("fx-review-stale", { blockId, sourceVerified: true });
    // 教師看到第 1 版；另一位教師其後修改了題目（版本變成 2）
    questionService.updateManualQuestion(question.id, {
      ...question,
      questionType: "mc",
      difficulty: "basic",
      question: "合成問題（已修改）：古人類最早在哪一洲出現？",
      options: ["非洲", "亞洲", "歐洲", "美洲"],
      correctAnswer: "非洲",
      acceptedAnswers: [],
      explanation: "合成解釋：教材指出古人類最早在非洲出現，因此答案為非洲。",
      knowledgePoint: "合成知識點",
      sourceExcerpt: "古人類最早在非洲出現",
      sourceLocation: "合成教材 · 第 1 段（段落）",
      sourceBlockIds: [blockId],
      gradingPoints: [],
      skill: null,
      status: "draft",
    });
    const current = questions.getQuestion(question.id)!;
    expect(current.revision).toBe(2);

    // 教師的頁面仍顯示第 1 版 → 提交時必須被拒絕（409），且不留下任何覆核紀錄
    expect(() =>
      questionService.recordQuestionReview({
        questionId: question.id,
        decision: "approved",
        expectedRevision: 1,
        actor: { email: "teacher@example.com", role: "teacher" },
      }),
    ).toThrowError(/已被修改/);

    expect(questions.listQuestionReviews(question.id)).toHaveLength(0);
    const stored = questions.getQuestion(question.id)!;
    expect(stored.status).toBe("draft");
    expect(stored.teacherConfirmationRequired).toBe(true);

    // 重新載入後（第 2 版）才可覆核
    const reviewed = questionService.recordQuestionReview({
      questionId: question.id,
      decision: "approved",
      expectedRevision: stored.revision,
      actor: { email: "teacher@example.com", role: "teacher" },
    });
    expect(reviewed.created).toBe(true);
    expect(questions.getQuestion(question.id)!.status).toBe("published");
  });

  it("缺少或無效的 expectedRevision 會被拒絕（400），不會靜默接受", () => {
    const { blockId } = createDemoDocument("missing-revision");
    const question = createQuestion("fx-review-missing-rev", { blockId, sourceVerified: true });

    for (const expectedRevision of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        questionService.recordQuestionReview({
          questionId: question.id,
          decision: "approved",
          expectedRevision,
          actor: { email: "teacher@example.com", role: "teacher" },
        }),
      ).toThrowError(/expectedRevision|版本/);
    }
    expect(questions.listQuestionReviews(question.id)).toHaveLength(0);
    expect(questions.getQuestion(question.id)!.status).toBe("draft");
  });

  it("同一版本重複提交相同決定不會重複記錄；不同決定另成新紀錄（可稽核）", () => {
    const { blockId } = createDemoDocument("repeat-and-conflict");
    const question = createQuestion("fx-review-repeat", { blockId, sourceVerified: true });

    const first = questionService.recordQuestionReview({
      questionId: question.id,
      decision: "approved",
      expectedRevision: question.revision,
      actor: { email: "teacher@example.com", role: "teacher" },
    });
    expect(first.created).toBe(true);

    const repeat = questionService.recordQuestionReview({
      questionId: question.id,
      decision: "approved",
      expectedRevision: question.revision,
      actor: { email: "teacher@example.com", role: "teacher" },
    });
    expect(repeat.created).toBe(false);
    expect(questions.listQuestionReviews(question.id)).toHaveLength(1);

    // 另一位教師其後認為要退回：會新增一筆紀錄並把題目帶回草稿（歷史不覆寫）
    const returned = questionService.recordQuestionReview({
      questionId: question.id,
      decision: "returned",
      reason: "解釋需要補充",
      expectedRevision: question.revision,
      actor: { email: "second-teacher@example.com", role: "teacher" },
    });
    expect(returned.created).toBe(true);
    const reviews = questions.listQuestionReviews(question.id);
    expect(reviews).toHaveLength(2);
    expect(reviews.map((review) => review.decision).sort()).toEqual(["approved", "returned"]);
    expect(questions.getQuestion(question.id)!.status).toBe("draft");
  });

  it("覆核通過也可以記錄理由（Sprint 8.8）：理由與版本、覆核者一併保存", () => {
    const { blockId } = createDemoDocument("approval-rationale");
    const question = createQuestion("fx-review-rationale", { blockId, sourceVerified: true });

    questionService.recordQuestionReview({
      questionId: question.id,
      decision: "approved",
      reason: "答案與引用段落一致，選項互不重疊",
      expectedRevision: question.revision,
      actor: { email: "teacher@example.com", role: "teacher" },
    });
    const approved = questions.listQuestionReviews(question.id)[0]!;
    expect(approved.decision).toBe("approved");
    expect(approved.reason).toBe("答案與引用段落一致，選項互不重疊");
    expect(approved.revision).toBe(question.revision);

    // 不填理由仍然可以通過（理由屬可選），但紀錄不得假造內容
    const { blockId: secondBlock } = createDemoDocument("approval-no-rationale");
    const quiet = createQuestion("fx-review-no-rationale", {
      blockId: secondBlock,
      sourceVerified: true,
    });
    questionService.recordQuestionReview({
      questionId: quiet.id,
      decision: "approved",
      expectedRevision: quiet.revision,
      actor: { email: "teacher@example.com", role: "teacher" },
    });
    expect(questions.listQuestionReviews(quiet.id)[0]!.reason).toBeNull();
  });
});

describe("覆核路由不會以示範身分寫入部署環境", () => {
  it("部署環境（K_SERVICE 已設定、非本機網址）沒有工作階段時拒絕覆核，且不寫入任何紀錄", async () => {
    const { blockId } = createDemoDocument("production-review");
    const question = createQuestion("fx-review-production", { blockId, sourceVerified: true });
    process.env.K_SERVICE = "history-platform";
    process.env.HISTORY_ALLOW_UNSAFE_DEMO_MODE = "true";

    const response = await reviewRoute.POST(
      new Request(
        `https://history-self-study-example.run.app/api/teacher/questions/${question.id}/review`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision: "approved", expectedRevision: question.revision }),
        },
      ),
      { params: Promise.resolve({ questionId: question.id }) },
    );

    expect(response.status).toBe(403);
    expect(questions.listQuestionReviews(question.id)).toHaveLength(0);
    expect(questions.getQuestion(question.id)!.status).toBe("draft");
  });

  it("本機（loopback）的示範流程仍可記錄覆核，但身分會如實標示為示範", async () => {
    const { blockId } = createDemoDocument("local-production-mode");
    const question = createQuestion("fx-review-local", { blockId, sourceVerified: true });
    process.env.K_SERVICE = "history-platform";
    process.env.HISTORY_ALLOW_UNSAFE_DEMO_MODE = "true";

    const response = await reviewRoute.POST(
      new Request(`http://127.0.0.1:3000/api/teacher/questions/${question.id}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "approved", expectedRevision: question.revision }),
      }),
      { params: Promise.resolve({ questionId: question.id }) },
    );

    expect(response.status).toBe(200);
    const reviews = questions.listQuestionReviews(question.id);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.reviewerRole).toBe("unauthenticated-demo");
    expect(reviews[0]!.reviewerEmail).not.toContain("@");
  });

  it("非正式環境的示範模式會如實記錄示範身分（不會假裝有教師帳戶）", async () => {
    const { blockId } = createDemoDocument("demo-review");
    const question = createQuestion("fx-review-demo", { blockId, sourceVerified: true });

    const response = await reviewRoute.POST(
      new Request(`http://localhost/api/teacher/questions/${question.id}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "approved", expectedRevision: question.revision }),
      }),
      { params: Promise.resolve({ questionId: question.id }) },
    );

    expect(response.status).toBe(200);
    const reviews = questions.listQuestionReviews(question.id);
    expect(reviews).toHaveLength(1);
    // 示範身分明顯不是真實帳戶：沒有 @，而且角色標示為未登入示範
    expect(reviews[0]!.reviewerEmail).not.toContain("@");
    expect(reviews[0]!.reviewerEmail).toContain("示範模式");
    expect(reviews[0]!.reviewerRole).toBe("unauthenticated-demo");
  });
});

describe("覆核路由對版本與參數的檢查（Sprint 8.7）", () => {
  it("提交的版本已過時：回 409，且不寫入紀錄、不改變題目狀態", async () => {
    const { blockId } = createDemoDocument("route-stale-revision");
    const question = createQuestion("fx-review-route-stale", { blockId, sourceVerified: true });
    questionService.updateManualQuestion(question.id, {
      ...question,
      question: "合成問題（已修改）：古人類最早在哪一洲出現？",
    });
    const current = questions.getQuestion(question.id)!;
    expect(current.revision).toBe(2);

    const response = await reviewRoute.POST(
      new Request(`http://localhost/api/teacher/questions/${question.id}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "approved", expectedRevision: 1 }),
      }),
      { params: Promise.resolve({ questionId: question.id }) },
    );

    expect(response.status).toBe(409);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain("已被修改");
    expect(questions.listQuestionReviews(question.id)).toHaveLength(0);
    expect(questions.getQuestion(question.id)!.status).toBe("draft");
  });

  it("缺少 expectedRevision：回 400，而不是默默接受", async () => {
    const { blockId } = createDemoDocument("route-missing-revision");
    const question = createQuestion("fx-review-route-missing", { blockId, sourceVerified: true });

    const response = await reviewRoute.POST(
      new Request(`http://localhost/api/teacher/questions/${question.id}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "approved" }),
      }),
      { params: Promise.resolve({ questionId: question.id }) },
    );

    expect(response.status).toBe(400);
    expect(questions.listQuestionReviews(question.id)).toHaveLength(0);
    expect(questions.getQuestion(question.id)!.status).toBe("draft");
  });
});

describe("人工覆核不會繞過來源可見性及暫緩規則", () => {
  it("覆核通過一題不會令未開放教材的節錄對學生顯示", () => {
    const { blockId, document } = createDemoDocument("copyright-gate");
    // 預設 student_distribution = 0（未確認版權）：即使教師覆核通過，節錄仍然不對學生顯示
    const question = createQuestion("fx-review-copyright", { blockId, sourceVerified: true });

    questionService.recordQuestionReview({
      questionId: question.id,
      decision: "approved",
      expectedRevision: question.revision,
      actor: { email: "teacher@example.com", role: "teacher" },
    });

    const stored = questions.getQuestion(question.id)!;
    expect(stored.status).toBe("published");
    // 教材文件仍然是「未開放」：覆核題目不會改變版權決定
    expect(materialsRepo.getDocument(document.id)!.studentDistribution).toBe(false);
    expect(materialsRepo.listStudentDistributableDocumentIds().has(document.id)).toBe(false);
  });

  it("機器重新驗證不能清除暫緩標記（需由人決定）", () => {
    const { blockId } = createDemoDocument("hold-preserved");
    const question = createQuestion("fx-review-hold", { blockId, sourceVerified: true });

    const revalidated = questionService.revalidateQuestion(question.id);
    expect(revalidated.autoValidated).toBe(false);
    expect(questions.getQuestion(question.id)!.teacherConfirmationRequired).toBe(true);
    expect(questions.listQuestionReviews(question.id)).toHaveLength(0);

    // 只有人工覆核（帶身分）會清除標記
    questionService.recordQuestionReview({
      questionId: question.id,
      decision: "approved",
      expectedRevision: question.revision,
      actor: { email: "teacher@example.com", role: "teacher" },
    });
    expect(questions.getQuestion(question.id)!.teacherConfirmationRequired).toBe(false);
  });
});
