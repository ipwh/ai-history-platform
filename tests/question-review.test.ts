/**
 * 教師人工覆核與發布治理測試（Sprint 4，P0）。
 *
 * 驗證的契約：
 *   1. **發布需要覆核**：沒有對應目前版本的人工覆核紀錄就不可發布（409），
 *      教材依據自動驗證（`sourceVerified`）不會令題目通過這個關卡。
 *   2. **覆核綁定版本**：修改題目後版本遞增，舊覆核立即失效；已發布的題目修改後
 *      會自動下架，學生不會看到覆核後已改變的內容。
 *   3. **覆核者身分取自工作階段**：前端提供的覆核者欄位不會被採用；未登入的示範模式
 *      如實標示，不會假裝有教師帳號。學生及未登入者不可覆核（403／401）。
 *   4. **冪等**：重複提交相同決定不會產生重複的覆核事件。
 *   5. **退回需原因**：退回或標示不可用必須提供原因。
 *   6. **狀態一致**：退回／不可用（草稿）不會出現在學生練習組題及進度統計；
 *      通過覆核（已發布）才可見。
 *   7. **覆核紀錄不可修改**：API 沒有提供任何更新或刪除覆核紀錄的路徑。
 *   8. 自動發布（示範模式）不會偽造覆核紀錄，只會標示為「已發布（未經人工覆核）」。
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("review");
process.env.LLM_PROVIDER = "mock";
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_TEACHER_EMAILS = "teacher@example.com";
process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
delete process.env.ADMIN_TOKEN;
delete process.env.K_SERVICE;

type SessionModule = typeof import("@/server/auth/session");
type SeedModule = typeof import("@/server/seed");
type QuestionService = typeof import("@/server/services/question-service");
type QuestionRepo = typeof import("@/server/repositories/questions");
type PracticeRepo = typeof import("@/server/repositories/practice");
type Connection = typeof import("@/server/db/connection");

let session: SessionModule;
let seed: SeedModule;
let service: QuestionService;
let repo: QuestionRepo;
let practiceRepo: PracticeRepo;
let getDb: Connection["getDb"];

const TEACHER = {
  email: "teacher@example.com",
  name: "歷史科教師",
  role: "teacher" as const,
  learnerId: "teacher:teacher@example.com",
  pictureUrl: null,
};
const ADMIN = {
  email: "admin@example.com",
  name: "管理員",
  role: "admin" as const,
  learnerId: "admin:admin@example.com",
  pictureUrl: null,
};
const STUDENT = {
  email: "s2024146@pochiu.edu.hk",
  name: "學生",
  role: "student" as const,
  learnerId: "school:s2024146@pochiu.edu.hk",
  pictureUrl: null,
};

function cookieFor(user: typeof TEACHER | typeof ADMIN | typeof STUDENT): string {
  return `hk-history-session=${encodeURIComponent(session.encodeSession(user))}`;
}

async function callReview(
  questionId: string,
  body: Record<string, unknown>,
  cookie?: string,
): Promise<Response> {
  const { POST } = await import("@/app/api/teacher/questions/[questionId]/review/route");
  return POST(
    new Request(`http://localhost:3000/api/teacher/questions/${questionId}/review`, {
      method: "POST",
      headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ questionId }) },
  );
}

async function callStatus(
  questionId: string,
  status: string,
  cookie?: string,
): Promise<Response> {
  const { PATCH } = await import("@/app/api/teacher/questions/[questionId]/route");
  return PATCH(
    new Request(`http://localhost:3000/api/teacher/questions/${questionId}`, {
      method: "PATCH",
      headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json" },
      body: JSON.stringify({ action: "status", status }),
    }),
    { params: Promise.resolve({ questionId }) },
  );
}

/** 建立一條教師手動題目（草稿），用於覆核流程測試 */
function createDraftQuestion(suffix: string) {
  const section = repo.listQuestions({}).find((question) => question.status === "published");
  if (!section) throw new Error("示範題庫尚未建立，無法進行覆核測試");
  return service.createManualQuestion({
    topicId: section.topicId,
    sectionId: section.sectionId,
    questionType: "mc",
    difficulty: "basic",
    question: `覆核測試題目（${suffix}）：文藝復興的核心思想是甚麼？`,
    options: ["人文主義", "重商主義", "軍國主義", "封建主義"],
    correctAnswer: "人文主義",
    acceptedAnswers: [],
    explanation: "教材指出文藝復興重視人文主義。",
    knowledgePoint: `覆核測試知識點（${suffix}）`,
    sourceExcerpt: "文藝復興重視人文主義",
    sourceLocation: "測試用來源位置",
    sourceBlockIds: [],
    gradingPoints: [],
    qualityWarnings: [],
    origin: "manual",
    status: "draft",
    skill: "正確地使用歷史辭彙",
  });
}

beforeAll(async () => {
  session = await import("@/server/auth/session");
  seed = await import("@/server/seed");
  service = await import("@/server/services/question-service");
  repo = await import("@/server/repositories/questions");
  practiceRepo = await import("@/server/repositories/practice");
  getDb = (await import("@/server/db/connection")).getDb;
  seed.ensureBootstrap();
});

beforeEach(() => {
  // 每個測試獨立：清空覆核紀錄（題目本身由各測試自行建立）
  getDb().prepare("DELETE FROM question_reviews").run();
});

describe("發布關卡：沒有覆核就不可發布", () => {
  it("未覆核的題目不可發布（409），訊息說明要先覆核", async () => {
    const question = createDraftQuestion("no-review");
    const response = await callStatus(question.id, "published", cookieFor(TEACHER));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error?: string };
    expect(body.error ?? "").toContain("覆核");
    expect(repo.getQuestion(question.id)?.status).toBe("draft");
  });

  it("通過覆核後即可發布，且覆核紀錄對應目前版本", async () => {
    const question = createDraftQuestion("approve");
    const reviewed = await callReview(question.id, { decision: "approved" }, cookieFor(TEACHER));
    expect(reviewed.status).toBe(200);
    const body = (await reviewed.json()) as {
      view: {
        reviewState: string;
        question: { status: string; revision: number };
        approvedReview: { reviewerEmail: string; revision: number } | null;
      };
      created: boolean;
    };
    expect(body.created).toBe(true);
    expect(body.view.reviewState).toBe("approved");
    expect(body.view.question.status).toBe("published");
    expect(body.view.question.revision).toBe(1);
    expect(body.view.approvedReview?.revision).toBe(1);
    expect(body.view.approvedReview?.reviewerEmail).toBe(TEACHER.email);

    // 已通過覆核的題目再次發布不會被關卡阻擋
    const republish = await callStatus(question.id, "published", cookieFor(TEACHER));
    expect(republish.status).toBe(200);
  });

  it("教材依據自動驗證（sourceVerified）不會令題目通過發布關卡", async () => {
    const question = createDraftQuestion("auto-verified");
    const verified = repo.updateQuestion(question.id, { ...question, sourceVerified: true });
    expect(verified.sourceVerified).toBe(true);
    const response = await callStatus(question.id, "published", cookieFor(TEACHER));
    expect(response.status).toBe(409);
  });
});

describe("覆核綁定題目版本", () => {
  it("修改題目後版本遞增，舊覆核失效，且已發布的題目會自動下架", async () => {
    const question = createDraftQuestion("version");
    await callReview(question.id, { decision: "approved" }, cookieFor(TEACHER));
    expect(repo.getQuestion(question.id)?.status).toBe("published");

    // 教師修改題目內容（已發布 → 回到草稿，必須重新覆核）。
    // 注意：編輯請求本身不可要求 published（會被 409 拒絕），因此帶 draft。
    const { PATCH } = await import("@/app/api/teacher/questions/[questionId]/route");
    const edited = await PATCH(
      new Request(`http://localhost:3000/api/teacher/questions/${question.id}`, {
        method: "PATCH",
        headers: { cookie: cookieFor(TEACHER), "content-type": "application/json" },
        body: JSON.stringify({
          action: "edit",
          question: {
            ...question,
            question: "修改後的題目：文藝復興的核心思想是甚麼？（已修改）",
            status: "draft",
          },
        }),
      }),
      { params: Promise.resolve({ questionId: question.id }) },
    );
    expect(edited.status).toBe(200);
    const body = (await edited.json()) as {
      view: { reviewState: string; question: { status: string; revision: number } };
    };
    expect(body.view.question.revision).toBe(2);
    expect(body.view.question.status).toBe("draft");
    expect(body.view.reviewState).toBe("stale-approval");

    // 覆核後修改 → 不可再發布，必須重新覆核
    const blocked = await callStatus(question.id, "published", cookieFor(TEACHER));
    expect(blocked.status).toBe(409);

    // 重新覆核（第 2 版）後可再次發布
    const reReviewed = await callReview(question.id, { decision: "approved" }, cookieFor(ADMIN));
    expect(reReviewed.status).toBe(200);
    const reBody = (await reReviewed.json()) as {
      view: { reviewState: string; approvedReview: { revision: number; reviewerEmail: string } };
    };
    expect(reBody.view.reviewState).toBe("approved");
    expect(reBody.view.approvedReview.revision).toBe(2);
    expect(reBody.view.approvedReview.reviewerEmail).toBe(ADMIN.email);

    // 兩次覆核都保留在紀錄中（第 1 版由教師、第 2 版由管理員）
    const history = repo.listQuestionReviews(question.id);
    expect(history.map((entry) => entry.revision).sort()).toEqual([1, 2]);
  });

  it("修改未發布的題目不會產生假覆核狀態，仍為待覆核", () => {
    const question = createDraftQuestion("draft-edit");
    const view = service.updateManualQuestion(question.id, {
      ...question,
      question: "草稿修改：文藝復興的核心思想是甚麼？（草稿）",
    });
    expect(view.question.revision).toBe(2);
    expect(view.question.status).toBe("draft");
    expect(view.reviewState).toBe("pending-review");
  });
});

describe("覆核決定、身分與冪等", () => {
  it("重複提交相同決定不會產生重複紀錄（冪等）", async () => {
    const question = createDraftQuestion("idempotent");
    const first = await callReview(question.id, { decision: "approved" }, cookieFor(TEACHER));
    const second = await callReview(question.id, { decision: "approved" }, cookieFor(TEACHER));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const body = (await second.json()) as { created: boolean };
    expect(body.created).toBe(false);
    expect(repo.listQuestionReviews(question.id)).toHaveLength(1);
  });

  it("退回與不可用都必須提供原因", async () => {
    const question = createDraftQuestion("reason-required");
    const noReason = await callReview(question.id, { decision: "returned" }, cookieFor(TEACHER));
    expect(noReason.status).toBe(400);

    const withReason = await callReview(
      question.id,
      { decision: "returned", reason: "選項 2 與 3 意思相近，請改寫" },
      cookieFor(TEACHER),
    );
    expect(withReason.status).toBe(200);
    const body = (await withReason.json()) as {
      view: { reviewState: string; question: { status: string }; latestReview: { reason: string } };
    };
    expect(body.view.reviewState).toBe("returned");
    expect(body.view.question.status).toBe("draft");
    expect(body.view.latestReview.reason).toContain("意思相近");

    // 退回後仍不可發布
    const blocked = await callStatus(question.id, "published", cookieFor(TEACHER));
    expect(blocked.status).toBe(409);
  });

  it("標示不可用的題目不會發布，狀態為 rejected", async () => {
    const question = createDraftQuestion("rejected");
    const response = await callReview(
      question.id,
      { decision: "rejected", reason: "教材未提及此史實，題目不可用" },
      cookieFor(TEACHER),
    );
    const body = (await response.json()) as { view: { reviewState: string; question: { status: string } } };
    expect(body.view.reviewState).toBe("rejected");
    expect(body.view.question.status).toBe("draft");
  });

  it("學生及未登入者不可覆核（403／401）", async () => {
    const question = createDraftQuestion("authz");
    const asStudent = await callReview(question.id, { decision: "approved" }, cookieFor(STUDENT));
    expect(asStudent.status).toBe(403);
    const anonymous = await callReview(question.id, { decision: "approved" });
    expect(anonymous.status).toBe(401);
    expect(repo.listQuestionReviews(question.id)).toEqual([]);
    expect(repo.getQuestion(question.id)?.status).toBe("draft");
  });

  it("前端提供的覆核者欄位不會被採用", async () => {
    const question = createDraftQuestion("forged-reviewer");
    const response = await callReview(
      question.id,
      { decision: "approved", reviewerEmail: "attacker@example.com", actor: "attacker" },
      cookieFor(TEACHER),
    );
    expect(response.status).toBe(200);
    expect(repo.listQuestionReviews(question.id)[0].reviewerEmail).toBe(TEACHER.email);
  });

  it("不存在的題目回 404，不會留下紀錄", async () => {
    const response = await callReview("missing-question", { decision: "approved" }, cookieFor(TEACHER));
    expect(response.status).toBe(404);
    expect(repo.listQuestionReviews("missing-question")).toEqual([]);
  });
});

describe("發布繞過途徑（Sprint 5 修正）", () => {
  it("POST /api/teacher/questions 不可在請求中直接發布（409）", async () => {
    const { POST } = await import("@/app/api/teacher/questions/route");
    const response = await POST(
      new Request("http://localhost:3000/api/teacher/questions", {
        method: "POST",
        headers: { cookie: cookieFor(TEACHER), "content-type": "application/json" },
        body: JSON.stringify({
          topicId: "topic-5",
          sectionId: "topic-5-renaissance-features",
          questionType: "mc",
          difficulty: "basic",
          question: "繞過測試：文藝復興的核心思想是甚麼？",
          options: ["人文主義", "重商主義", "軍國主義", "封建主義"],
          correctAnswer: "人文主義",
          acceptedAnswers: [],
          explanation: "教材指出文藝復興重視人文主義。",
          knowledgePoint: "繞過測試知識點",
          sourceExcerpt: "文藝復興重視人文主義",
          sourceLocation: "測試來源",
          sourceBlockIds: [],
          gradingPoints: [],
          qualityWarnings: [],
          origin: "manual",
          status: "published",
        }),
      }),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error?: string };
    expect(body.error ?? "").toContain("覆核");
  });

  it("手動建立的題目一律由草稿開始，即使請求沒有指定狀態", async () => {
    const before = repo.countQuestions({ topicId: "topic-5" });
    const created = service.createManualQuestion({
      topicId: "topic-5",
      sectionId: "topic-5-renaissance-features",
      questionType: "mc",
      difficulty: "basic",
      question: "建立測試：文藝復興的核心思想是甚麼？",
      options: ["人文主義", "重商主義", "軍國主義", "封建主義"],
      correctAnswer: "人文主義",
      acceptedAnswers: [],
      explanation: "教材指出文藝復興重視人文主義。",
      knowledgePoint: "建立測試知識點",
      sourceExcerpt: "文藝復興重視人文主義",
      sourceLocation: "測試來源",
      sourceBlockIds: [],
      gradingPoints: [],
      qualityWarnings: [],
      skill: null,
      origin: "manual",
      status: "draft",
    });
    expect(created.status).toBe("draft");
    expect(created.revision).toBe(1);
    expect(repo.listQuestionReviews(created.id)).toEqual([]);
    expect(repo.countQuestions({ topicId: "topic-5" })).toBe(before + 1);
  });

  it("PATCH action:edit 不可在請求中直接發布（409），且不會改動題目", async () => {
    const question = createDraftQuestion("edit-publish");
    const { PATCH } = await import("@/app/api/teacher/questions/[questionId]/route");
    const response = await PATCH(
      new Request(`http://localhost:3000/api/teacher/questions/${question.id}`, {
        method: "PATCH",
        headers: { cookie: cookieFor(TEACHER), "content-type": "application/json" },
        body: JSON.stringify({
          action: "edit",
          question: { ...question, status: "published" },
        }),
      }),
      { params: Promise.resolve({ questionId: question.id }) },
    );
    expect(response.status).toBe(409);
    const after = repo.getQuestion(question.id);
    expect(after?.status).toBe("draft");
    expect(after?.revision).toBe(1);
  });

  it("編輯題目內容一律回到草稿（即使原本已發布且已覆核）", async () => {
    const question = createDraftQuestion("edit-after-approve");
    await callReview(question.id, { decision: "approved" }, cookieFor(TEACHER));
    expect(repo.getQuestion(question.id)?.status).toBe("published");

    const view = service.updateManualQuestion(question.id, {
      ...question,
      question: "已修改：文藝復興的核心思想是甚麼？（第二版）",
      status: "draft",
    });
    expect(view.question.status).toBe("draft");
    expect(view.question.revision).toBe(2);
    expect(view.reviewState).toBe("stale-approval");
    expect(service.reviewStateFor(repo.getQuestion(question.id)!)).toBe("stale-approval");
  });

  it("修訂版本或內容指紋不同的覆核紀錄不會令題目通過發布關卡", async () => {
    const question = createDraftQuestion("fingerprint");
    // 直接寫入一筆「approved」但指紋不符的紀錄（模擬資料被改動）
    getDb()
      .prepare(
        `INSERT INTO question_reviews
         (id, question_id, revision, decision, reason, reviewer_email, reviewer_role,
          question_fingerprint, created_at)
         VALUES ('rev-forged', ?, 1, 'approved', NULL, 'someone@example.com', 'teacher',
                 'wrong-fingerprint', ?)`,
      )
      .run(question.id, new Date().toISOString());

    const blocked = await callStatus(question.id, "published", cookieFor(TEACHER));
    expect(blocked.status).toBe(409);
    expect(repo.getQuestion(question.id)?.status).toBe("draft");
  });

  it("只有明確帶 approved 的紀錄才算通過（returned／rejected 不算）", async () => {
    const question = createDraftQuestion("not-approved");
    await callReview(
      question.id,
      { decision: "returned", reason: "選項需改寫" },
      cookieFor(TEACHER),
    );
    const blocked = await callStatus(question.id, "published", cookieFor(TEACHER));
    expect(blocked.status).toBe(409);
    expect(repo.getQuestion(question.id)?.status).toBe("draft");
  });
});

describe("發布狀態在所有面向保持一致", () => {
  it("退回的題目不會出現在學生組題及進度統計中，重新覆核後才可見", async () => {
    const question = createDraftQuestion("consistency");

    const { POST: createPractice } = await import("@/app/api/practice/route");
    const before = await createPractice(
      new Request("http://localhost:3000/api/practice", {
        method: "POST",
        headers: { cookie: cookieFor(STUDENT), "content-type": "application/json" },
        body: JSON.stringify({
          learnerId: "irrelevant",
          topicId: question.topicId,
          sectionIds: [question.sectionId],
          questionTypes: ["mc"],
          difficulty: "basic",
          questionCount: 5,
        }),
      }),
    );
    expect(before.status).toBe(201);
    const beforeBody = (await before.json()) as { questions: { id: string }[] };
    expect(beforeBody.questions.some((item) => item.id === question.id)).toBe(false);

    // 通過覆核（發布）後，題目才可以出現在學生組題內
    await callReview(question.id, { decision: "approved" }, cookieFor(TEACHER));
    const after = await createPractice(
      new Request("http://localhost:3000/api/practice", {
        method: "POST",
        headers: { cookie: cookieFor(STUDENT), "content-type": "application/json" },
        body: JSON.stringify({
          learnerId: "irrelevant",
          topicId: question.topicId,
          sectionIds: [question.sectionId],
          questionTypes: ["mc"],
          difficulty: "basic",
          questionCount: 5,
        }),
      }),
    );
    const afterBody = (await after.json()) as { questions: { id: string }[] };
    expect(afterBody.questions.some((item) => item.id === question.id)).toBe(true);

    // 進度統計只計算已發布題目
    const eligible = practiceRepo.listPublishedQuestionsForProgress(question.topicId);
    expect(eligible.some((item) => item.id === question.id)).toBe(true);

    // 撤回發布（回到草稿）後，立即不再是進度統計的合格題目
    await callStatus(question.id, "draft", cookieFor(TEACHER));
    const afterRetire = practiceRepo.listPublishedQuestionsForProgress(question.topicId);
    expect(afterRetire.some((item) => item.id === question.id)).toBe(false);
    expect(repo.getQuestion(question.id)?.status).toBe("draft");
  });

  it("示範模式的自動發布不會偽造覆核紀錄", () => {
    const question = createDraftQuestion("auto-publish");
    service.publishAutoGeneratedQuestion(question.id);
    expect(repo.getQuestion(question.id)?.status).toBe("published");
    expect(repo.listQuestionReviews(question.id)).toEqual([]);
    // 沒有覆核紀錄，因此如實標示為「已發布（未經人工覆核）」
    expect(service.reviewStateFor(repo.getQuestion(question.id)!)).toBe("published-unreviewed");
  });

  it("覆核紀錄沒有可修改或刪除的 API 路徑", async () => {
    const question = createDraftQuestion("immutable");
    await callReview(question.id, { decision: "approved" }, cookieFor(TEACHER));
    const route = await import("@/app/api/teacher/questions/[questionId]/review/route");
    const exported = Object.keys(route).filter((key) => /^[A-Z]+$/.test(key));
    expect(exported.sort()).toEqual(["GET", "POST"]);
    expect(repo.listQuestionReviews(question.id)).toHaveLength(1);
  });
});
