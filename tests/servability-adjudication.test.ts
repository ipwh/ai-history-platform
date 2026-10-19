/**
 * 結構不可作答題目的教師裁決流程（Sprint 11）。
 *
 * 驗證的契約：
 *   1. 裁決只能由教師／管理員記錄；未登入 401、學生 403。
 *   2. 每種裁決都綁定題目目前的版本；版本已被修改時回 409，不記錄任何決定。
 *   3. `keep_quarantined` 保留待教師確認標記，題目留在草稿，不會派發。
 *   4. `reject` 標示不可用並留在草稿；`return_to_draft`／`request_more_evidence`
 *      記錄退回理由。
 *   5. 結構上不可作答的題目**不能**經覆核核准而發布；教師必須先修正內容。
 *   6. 裁決不會刪除或改寫既有覆核紀錄。
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("servability-adjudication");
process.env.LLM_PROVIDER = "mock";
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_TEACHER_EMAILS = "teacher@example.com";
process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
process.env.HISTORY_REVIEWER_EMAILS = "teacher@example.com";
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
delete process.env.ADMIN_TOKEN;
delete process.env.K_SERVICE;

type SessionModule = typeof import("@/server/auth/session");
type SeedModule = typeof import("@/server/seed");
type QuestionService = typeof import("@/server/services/question-service");
type QuestionRepo = typeof import("@/server/repositories/questions");
type Connection = typeof import("@/server/db/connection");

let session: SessionModule;
let seed: SeedModule;
let service: QuestionService;
let repo: QuestionRepo;
let getDb: Connection["getDb"];

const TEACHER = {
  email: "teacher@example.com",
  name: "歷史科教師",
  role: "teacher" as const,
  learnerId: "teacher:teacher@example.com",
  pictureUrl: null,
};
const STUDENT = {
  email: "s2024146@pochiu.edu.hk",
  name: "學生",
  role: "student" as const,
  learnerId: "school:s2024146@pochiu.edu.hk",
  pictureUrl: null,
};

function cookieFor(user: typeof TEACHER | typeof STUDENT): string {
  return `hk-history-session=${encodeURIComponent(session.encodeSession(user))}`;
}

/** 選項以羅馬數字指涉題幹，但題幹沒有 i／ii／iii／iv 標示 → 結構上不可作答 */
function createUnservableQuestion(suffix: string) {
  const sample = repo.listQuestions({}).find((question) => question.status === "published");
  if (!sample) throw new Error("示範題庫尚未建立，無法進行裁決測試");
  return service.createManualQuestion({
    topicId: sample.topicId,
    sectionId: sample.sectionId,
    questionType: "mc",
    difficulty: "basic",
    question: `裁決測試（${suffix}）：下列哪些屬於一手資料？ 日記 錄像 事件發生時的報導 學術論文`,
    options: ["i、ii及iii", "ii、iii及iv", "i、iii及iv", "i、ii及iv"],
    correctAnswer: "i、ii及iii",
    acceptedAnswers: [],
    explanation: "日記與事發時的報導屬一手資料。",
    knowledgePoint: `裁決測試知識點（${suffix}）`,
    sourceExcerpt: "一手資料的例子",
    sourceLocation: "測試用來源位置",
    sourceBlockIds: [],
    gradingPoints: [],
    qualityWarnings: [],
    origin: "manual",
    status: "draft",
    skill: "從歷史資料中作出歸納和推論",
  });
}

async function callServability(
  questionId: string,
  body: Record<string, unknown>,
  cookie?: string,
): Promise<Response> {
  const { POST } = await import("@/app/api/teacher/questions/[questionId]/servability/route");
  const current = repo.getQuestion(questionId);
  return POST(
    new Request(`http://localhost:3000/api/teacher/questions/${questionId}/servability`, {
      method: "POST",
      headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: current?.revision ?? 1, ...body }),
    }),
    { params: Promise.resolve({ questionId }) },
  );
}

async function callReview(
  questionId: string,
  body: Record<string, unknown>,
  cookie?: string,
): Promise<Response> {
  const { POST } = await import("@/app/api/teacher/questions/[questionId]/review/route");
  const current = repo.getQuestion(questionId);
  return POST(
    new Request(`http://localhost:3000/api/teacher/questions/${questionId}/review`, {
      method: "POST",
      headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: current?.revision ?? 1, ...body }),
    }),
    { params: Promise.resolve({ questionId }) },
  );
}

function reviewRows(questionId: string) {
  return getDb()
    .prepare(
      "SELECT revision, decision, reason, reviewer_email, reviewer_role, question_fingerprint FROM question_reviews WHERE question_id = ? ORDER BY created_at",
    )
    .all(questionId) as Array<{
    revision: number;
    decision: string;
    reason: string | null;
    reviewer_email: string;
    reviewer_role: string;
    question_fingerprint: string;
  }>;
}

beforeAll(async () => {
  session = await import("@/server/auth/session");
  seed = await import("@/server/seed");
  service = await import("@/server/services/question-service");
  repo = await import("@/server/repositories/questions");
  getDb = (await import("@/server/db/connection")).getDb;
  seed.ensureBootstrap();
});

beforeEach(() => {
  getDb().prepare("DELETE FROM question_reviews").run();
});

describe("裁決權限", () => {
  it("未登入回 401，學生回 403，且不留下任何紀錄", async () => {
    const question = createUnservableQuestion("authz");

    const anonymous = await callServability(question.id, {
      decision: "return_to_draft",
      reason: "題幹缺少標示",
    });
    expect(anonymous.status).toBe(401);

    const student = await callServability(
      question.id,
      { decision: "keep_quarantined", reason: "題幹缺少標示" },
      cookieFor(STUDENT),
    );
    expect(student.status).toBe(403);

    expect(reviewRows(question.id)).toHaveLength(0);
    expect(repo.getQuestion(question.id)?.status).toBe("draft");
  });
});

describe("裁決選項", () => {
  it("保留隔離：留在草稿、保留待教師確認標記，理由記錄結構問題代碼", async () => {
    const question = createUnservableQuestion("quarantine");
    const response = await callServability(
      question.id,
      { decision: "keep_quarantined", reason: "原文缺少 i、ii、iii 標示，需教師核對原卷" },
      cookieFor(TEACHER),
    );
    expect(response.status).toBe(200);

    const stored = repo.getQuestion(question.id);
    expect(stored?.status).toBe("draft");
    expect(stored?.teacherConfirmationRequired).toBe(true);

    const rows = reviewRows(question.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].decision).toBe("returned");
    expect(rows[0].reviewer_email).toBe(TEACHER.email);
    expect(rows[0].revision).toBe(stored?.revision);
    expect(rows[0].question_fingerprint).toBeTruthy();
    expect(rows[0].reason).toContain("MCQ_ROMAN_LABEL_MISSING");
    expect(rows[0].reason).toContain("保留隔離");
    expect(rows[0].reason).toContain("需教師核對原卷");
  });

  it("退回草稿及要求補充證據：記錄退回理由，不設定待確認標記", async () => {
    const returned = createUnservableQuestion("return");
    const response = await callServability(
      returned.id,
      { decision: "return_to_draft", reason: "請依原卷補回題幹標示" },
      cookieFor(TEACHER),
    );
    expect(response.status).toBe(200);
    expect(repo.getQuestion(returned.id)?.status).toBe("draft");
    expect(repo.getQuestion(returned.id)?.teacherConfirmationRequired).toBe(false);
    expect(reviewRows(returned.id)[0].reason).toContain("退回草稿");

    const evidence = createUnservableQuestion("evidence");
    const second = await callServability(
      evidence.id,
      { decision: "request_more_evidence", reason: "找不到原始文件，請提供該頁掃描" },
      cookieFor(TEACHER),
    );
    expect(second.status).toBe(200);
    expect(reviewRows(evidence.id)[0].reason).toContain("要求補充證據");
  });

  it("標示不可用：紀錄 rejected，題目留在草稿", async () => {
    const question = createUnservableQuestion("reject");
    const response = await callServability(
      question.id,
      { decision: "reject", reason: "無法從原卷還原題幹，該題不採用" },
      cookieFor(TEACHER),
    );
    expect(response.status).toBe(200);
    expect(repo.getQuestion(question.id)?.status).toBe("draft");
    expect(reviewRows(question.id)[0].decision).toBe("rejected");
  });

  it("缺少理由或理由過短時回 400", async () => {
    const question = createUnservableQuestion("reason");
    const response = await callServability(
      question.id,
      { decision: "return_to_draft", reason: "短" },
      cookieFor(TEACHER),
    );
    expect(response.status).toBe(400);
    expect(reviewRows(question.id)).toHaveLength(0);
  });
});

describe("版本衝突與歷史保留", () => {
  it("題目已被修改時，舊版本的裁決回 409 且不記錄", async () => {
    const question = createUnservableQuestion("stale");
    const first = await callServability(
      question.id,
      { decision: "return_to_draft", reason: "第一次退回" },
      cookieFor(TEACHER),
    );
    expect(first.status).toBe(200);

    const before = reviewRows(question.id).length;
    // 教師端修改內容 → 版本遞增
    const current = repo.getQuestion(question.id)!;
    service.updateManualQuestion(question.id, {
      topicId: current.topicId,
      sectionId: current.sectionId,
      questionType: current.questionType,
      difficulty: current.difficulty,
      question: current.question,
      options: current.options,
      correctAnswer: current.correctAnswer,
      acceptedAnswers: current.acceptedAnswers,
      explanation: current.explanation,
      knowledgePoint: current.knowledgePoint,
      sourceExcerpt: current.sourceExcerpt,
      sourceLocation: current.sourceLocation,
      sourceBlockIds: current.sourceBlockIds,
      gradingPoints: current.gradingPoints,
      qualityWarnings: current.qualityWarnings,
      skill: current.skill,
      origin: current.origin,
      status: current.status,
    });

    const stale = await callServability(
      question.id,
      { decision: "reject", reason: "用舊版本裁決", expectedRevision: 1 },
      cookieFor(TEACHER),
    );
    expect(stale.status).toBe(409);
    expect(reviewRows(question.id)).toHaveLength(before);
    expect(repo.getQuestion(question.id)?.revision).toBe(2);
  });

  it("新裁決不會刪除或改寫既有覆核紀錄", async () => {
    const question = createUnservableQuestion("history");
    await callServability(
      question.id,
      { decision: "request_more_evidence", reason: "先要求補充來源" },
      cookieFor(TEACHER),
    );
    await callServability(
      question.id,
      { decision: "keep_quarantined", reason: "來源仍未補回，繼續隔離" },
      cookieFor(TEACHER),
    );
    const rows = reviewRows(question.id);
    expect(rows).toHaveLength(2);
    expect(rows[0].reason).toContain("要求補充證據");
    expect(rows[1].reason).toContain("保留隔離");
  });
});

describe("核准不能繞過可作答性", () => {  it("結構不可作答的題目按下通過會被拒絕，仍留在草稿", async () => {
    const question = createUnservableQuestion("blocked-approval");
    const response = await callReview(question.id, { decision: "approved" }, cookieFor(TEACHER));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error?: string };
    expect(body.error ?? "").toContain("不可作答");
    expect(repo.getQuestion(question.id)?.status).toBe("draft");
    expect(reviewRows(question.id)).toHaveLength(0);
  });

  it("修正題幹標示後（版本遞增）才可核准並發布", async () => {
    const question = createUnservableQuestion("repaired");
    const current = repo.getQuestion(question.id)!;
    service.updateManualQuestion(question.id, {
      topicId: current.topicId,
      sectionId: current.sectionId,
      questionType: current.questionType,
      difficulty: current.difficulty,
      question:
        "下列哪些屬於一手資料？ i. 日記 ii. 錄像 iii. 事件發生時的報導 iv. 學術論文",
      options: current.options,
      correctAnswer: current.correctAnswer,
      acceptedAnswers: current.acceptedAnswers,
      explanation: current.explanation,
      knowledgePoint: current.knowledgePoint,
      sourceExcerpt: current.sourceExcerpt,
      sourceLocation: current.sourceLocation,
      sourceBlockIds: current.sourceBlockIds,
      gradingPoints: current.gradingPoints,
      qualityWarnings: current.qualityWarnings,
      skill: current.skill,
      origin: current.origin,
      status: current.status,
    });

    const approved = await callReview(question.id, { decision: "approved" }, cookieFor(TEACHER));
    expect(approved.status).toBe(200);
    const stored = repo.getQuestion(question.id);
    expect(stored?.status).toBe("published");
    expect(stored?.revision).toBe(2);
    expect(reviewRows(question.id)[0].revision).toBe(2);
  });

  it("`approve_after_verified_repair`：未修復時 409，修復後才核准並發布", async () => {
    const question = createUnservableQuestion("servability-approve");
    const blocked = await callServability(
      question.id,
      { decision: "approve_after_verified_repair", reason: "已按原卷修復" },
      cookieFor(TEACHER),
    );
    expect(blocked.status).toBe(409);
    expect(reviewRows(question.id)).toHaveLength(0);
    expect(repo.getQuestion(question.id)?.status).toBe("draft");

    const current = repo.getQuestion(question.id)!;
    service.updateManualQuestion(question.id, {
      topicId: current.topicId,
      sectionId: current.sectionId,
      questionType: current.questionType,
      difficulty: current.difficulty,
      question:
        "下列哪些屬於一手資料？ i. 日記 ii. 錄像 iii. 事件發生時的報導 iv. 學術論文",
      options: current.options,
      correctAnswer: current.correctAnswer,
      acceptedAnswers: current.acceptedAnswers,
      explanation: current.explanation,
      knowledgePoint: current.knowledgePoint,
      sourceExcerpt: current.sourceExcerpt,
      sourceLocation: current.sourceLocation,
      sourceBlockIds: current.sourceBlockIds,
      gradingPoints: current.gradingPoints,
      qualityWarnings: current.qualityWarnings,
      skill: current.skill,
      origin: current.origin,
      status: current.status,
    });

    const approved = await callServability(
      question.id,
      { decision: "approve_after_verified_repair", reason: "已按原卷補回題幹標示" },
      cookieFor(TEACHER),
    );
    expect(approved.status).toBe(200);
    expect(repo.getQuestion(question.id)?.status).toBe("published");
    const rows = reviewRows(question.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].decision).toBe("approved");
    expect(rows[0].reason).toContain("已修復並核准");
  });

  it("即使已有舊核准紀錄，直接改狀態發布結構不可作答的題目仍回 409", async () => {
    const question = createUnservableQuestion("legacy-approval");
    repo.insertQuestionReview({
      id: `qrev_legacy_${Date.now()}`,
      questionId: question.id,
      revision: question.revision,
      decision: "approved",
      reason: null,
      reviewerEmail: "legacy@example.com",
      reviewerRole: "admin",
      questionFingerprint: service.questionFingerprint(question),
      createdAt: new Date().toISOString(),
    });

    const { PATCH } = await import("@/app/api/teacher/questions/[questionId]/route");
    const response = await PATCH(
      new Request(`http://localhost:3000/api/teacher/questions/${question.id}`, {
        method: "PATCH",
        headers: { cookie: cookieFor(TEACHER), "content-type": "application/json" },
        body: JSON.stringify({ action: "status", status: "published" }),
      }),
      { params: Promise.resolve({ questionId: question.id }) },
    );
    expect(response.status).toBe(409);
    expect(repo.getQuestion(question.id)?.status).toBe("draft");
  });
});



describe("歷史科學科授權邊界（Sprint 12）", () => {
  it("不在名單的教師可以退回／隔離，但不可「已修復並核准」", async () => {
    const question = createUnservableQuestion("authz-approve");
    const original = process.env.HISTORY_REVIEWER_EMAILS;
    delete process.env.HISTORY_REVIEWER_EMAILS;
    try {
      const approved = await callServability(
        question.id,
        { decision: "approve_after_verified_repair", reason: "未經授權的核准" },
        cookieFor(TEACHER),
      );
      expect(approved.status).toBe(403);
      expect(reviewRows(question.id)).toHaveLength(0);

      const returned = await callServability(
        question.id,
        { decision: "return_to_draft", reason: "退回等待原卷" },
        cookieFor(TEACHER),
      );
      expect(returned.status).toBe(200);
      expect(reviewRows(question.id)).toHaveLength(1);
    } finally {
      if (original === undefined) delete process.env.HISTORY_REVIEWER_EMAILS;
      else process.env.HISTORY_REVIEWER_EMAILS = original;
    }
  });
});
