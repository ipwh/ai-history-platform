/**
 * Golden Dataset v2 人工核准流程（Sprint 11）。
 *
 * 契約：
 *   1. 只有教師／管理員可記錄裁決；未登入 401、學生 403。
 *   2. 核准必須附上教師提供的評估內容（category、reasoning、預期 grading），
 *      沒有就不能只記「核准」。
 *   3. 裁決綁定題目版本及內容指紋；題目改動後舊裁決失效（status = stale）。
 *   4. 未核准的候選維持 pending；沒有真實教師核准時匯出 0 個 fixture。
 *   5. 匯出結果可重複（同一資料產生相同 fixture 內容）。
 *   6. 核准 Golden fixture 不會改變題目的發布狀態。
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("golden-approval");
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
type GoldenApproval = typeof import("@/server/services/golden-approval");

let session: SessionModule;
let seed: SeedModule;
let service: QuestionService;
let repo: QuestionRepo;
let golden: GoldenApproval;
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
  name: "???",
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

async function callGoldenDecision(
  questionId: string,
  body: Record<string, unknown>,
  cookie?: string,
): Promise<Response> {
  const { POST } = await import("@/app/api/teacher/golden/[questionId]/route");
  const current = repo.getQuestion(questionId);
  return POST(
    new Request(`http://localhost:3000/api/teacher/golden/${questionId}`, {
      method: "POST",
      headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: current?.revision ?? 1, ...body }),
    }),
    { params: Promise.resolve({ questionId }) },
  );
}

const FIXTURE_CONTENT = {
  category: "chronology",
  reasoning: "教師核對課本第 12 頁後確認此題考核文藝復興的核心思想。",
  grading: [{ answer: "人文主義", correct: true }],
  distractorNotes: [
    { option: "重商主義", why: "重商主義屬近代經濟政策，不是文藝復興核心思想" },
    { option: "軍國主義", why: "軍國主義與文藝復興的人文精神無關" },
    { option: "封建主義", why: "封建主義屬中古制度，非文藝復興核心思想" },
  ],
  knownEdgeCases: [],
  reference: "課本第 12 頁",
  level: 1,
};

let questionId = "";

function createQuestion(): string {
  const sample = repo.listQuestions({}).find((question) => question.status === "published");
  if (!sample) throw new Error("示範題庫尚未建立");
  const created = service.createManualQuestion({
    topicId: sample.topicId,
    sectionId: sample.sectionId,
    questionType: "mc",
    difficulty: "basic",
    question: "文藝復興的核心思想是甚麼？",
    options: ["人文主義", "重商主義", "軍國主義", "封建主義"],
    correctAnswer: "人文主義",
    acceptedAnswers: [],
    explanation: "課本指出文藝復興重視人文主義。",
    knowledgePoint: "文藝復興",
    sourceExcerpt: "文藝復興重視人文主義",
    sourceLocation: "課本第 12 頁",
    sourceBlockIds: [],
    gradingPoints: [],
    qualityWarnings: [],
    origin: "manual",
    status: "draft",
    skill: "從歷史資料中作出歸納和推論",
  });
  return created.id;
}

/** 只包含測試題目的候選清單，令測試不依賴 docs 內的實際候選檔 */
function candidatesFor(id: string) {
  const question = repo.getQuestion(id)!;
  return [
    {
      group: "test",
      selectionReason: "測試用候選",
      questionId: id,
      questionRevision: question.revision,
      questionFingerprint: service.questionFingerprint(question),
      stem: question.question,
      options: question.options,
      correctAnswer: question.correctAnswer,
      acceptedAnswers: question.acceptedAnswers,
      explanation: question.explanation,
      servable: true,
      evidence: {
        sourceExcerpt: question.sourceExcerpt,
        sourceLocation: question.sourceLocation,
        sourceBlockIds: question.sourceBlockIds,
        hasTraceableDocument: false,
      },
    },
  ];
}

beforeAll(async () => {
  session = await import("@/server/auth/session");
  seed = await import("@/server/seed");
  service = await import("@/server/services/question-service");
  repo = await import("@/server/repositories/questions");
  golden = await import("@/server/services/golden-approval");
  getDb = (await import("@/server/db/connection")).getDb;
  seed.ensureBootstrap();
});

beforeEach(() => {
  getDb().prepare("DELETE FROM golden_fixture_reviews").run();
  questionId = createQuestion();
});

describe("權限", () => {
  it("未登入 401、學生 403，且不留下裁決紀錄", async () => {
    const anonymous = await callGoldenDecision(questionId, {
      decision: "approved",
      reason: "測試核准",
      fixture: FIXTURE_CONTENT,
    });
    expect(anonymous.status).toBe(401);

    const student = await callGoldenDecision(
      questionId,
      { decision: "rejected", reason: "測試拒絕" },
      cookieFor(STUDENT),
    );
    expect(student.status).toBe(403);

    expect(golden.listGoldenCandidateViews(candidatesFor(questionId))[0].status).toBe(
      "pending-review",
    );
  });
});

describe("核准需要教師提供的評估內容", () => {
  it("沒有 fixture 內容時拒絕核准，狀態維持 pending", async () => {
    const response = await callGoldenDecision(
      questionId,
      { decision: "approved", reason: "只按核准" },
      cookieFor(TEACHER),
    );
    expect(response.status).toBe(400);
    expect(golden.listGoldenCandidateViews(candidatesFor(questionId))[0].status).toBe(
      "pending-review",
    );
  });

  it("有完整內容時核准，reviewer 取自工作階段並匯出可重現的 fixture", async () => {
    const response = await callGoldenDecision(
      questionId,
      { decision: "approved", reason: "教師核對課本後核准", fixture: FIXTURE_CONTENT },
      cookieFor(TEACHER),
    );
    expect(response.status).toBe(200);

    const views = golden.listGoldenCandidateViews(candidatesFor(questionId));
    expect(views[0].status).toBe("approved");
    expect(views[0].latestDecision?.reviewerEmail).toBe(TEACHER.email);

    const exported = golden.exportGoldenFixtures(candidatesFor(questionId));
    expect(exported.invalidated).toEqual([]);
    expect(exported.fixtures).toHaveLength(1);
    const fixture = exported.fixtures[0];
    expect(fixture.reviewer).toBe(TEACHER.email);
    expect(fixture.reviewedAt).toBeTruthy();
    expect(fixture.source.questionId).toBe(questionId);
    expect(fixture.source.revision).toBe(repo.getQuestion(questionId)?.revision);
    expect(fixture.source.fingerprint).toHaveLength(64);
    expect(fixture.expected.grading).toEqual(FIXTURE_CONTENT.grading);
    expect(fixture.category).toBe("chronology");

    // 匯出可重複：同一資料產生相同 fixture
    const again = golden.exportGoldenFixtures(candidatesFor(questionId));
    expect(again.fixtures).toEqual(exported.fixtures);

    // 不會改變題目發布狀態
    expect(repo.getQuestion(questionId)?.status).toBe("draft");
  });

  it("題目內容改變後舊核准失效，必須重新核准", async () => {
    await callGoldenDecision(
      questionId,
      { decision: "approved", reason: "教師核對課本後核准", fixture: FIXTURE_CONTENT },
      cookieFor(TEACHER),
    );
    const current = repo.getQuestion(questionId)!;
    service.updateManualQuestion(questionId, {
      topicId: current.topicId,
      sectionId: current.sectionId,
      questionType: current.questionType,
      difficulty: current.difficulty,
      question: "文藝復興高舉的核心思想是甚麼？",
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

    const views = golden.listGoldenCandidateViews(candidatesFor(questionId));
    expect(views[0].status).toBe("stale");
    const exported = golden.exportGoldenFixtures(candidatesFor(questionId));
    expect(exported.fixtures).toHaveLength(0);
    expect(exported.invalidated[0].reason).toContain("失效");
  });

  it("版本不符時回 409，不記錄裁決", async () => {
    const current = repo.getQuestion(questionId)!;
    service.updateManualQuestion(questionId, {
      topicId: current.topicId,
      sectionId: current.sectionId,
      questionType: current.questionType,
      difficulty: current.difficulty,
      question: "文藝復興所高舉的核心思想是甚麼？",
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
    const response = await callGoldenDecision(
      questionId,
      { decision: "approved", reason: "舊版本核准", fixture: FIXTURE_CONTENT, expectedRevision: 1 },
      cookieFor(TEACHER),
    );
    expect(response.status).toBe(409);
    const stored = getDb()
      .prepare("SELECT COUNT(*) AS count FROM golden_fixture_reviews")
      .get() as { count: number };
    expect(stored.count).toBe(0);
  });

  it("拒絕及要求修訂會記錄原因，且不會產生 fixture", async () => {
    const rejected = await callGoldenDecision(
      questionId,
      { decision: "rejected", reason: "來源無法追溯，不適合做評估基準" },
      cookieFor(TEACHER),
    );
    expect(rejected.status).toBe(200);
    expect(golden.listGoldenCandidateViews(candidatesFor(questionId))[0].status).toBe("rejected");
    expect(golden.exportGoldenFixtures(candidatesFor(questionId)).fixtures).toHaveLength(0);

    const revision = await callGoldenDecision(
      questionId,
      { decision: "revision_requested", reason: "請補上課本頁碼" },
      cookieFor(TEACHER),
    );
    expect(revision.status).toBe(200);
    expect(golden.listGoldenCandidateViews(candidatesFor(questionId))[0].status).toBe(
      "revision-requested",
    );
  });
});

describe("歷史科學科授權邊界（Sprint 12）", () => {
  it("admin 角色（不在歷史科審核者名單）不能核准 Golden fixture", async () => {
    const response = await callGoldenDecision(
      questionId,
      { decision: "approved", reason: "管理員按下核准", fixture: FIXTURE_CONTENT },
      cookieFor(ADMIN),
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: string };
    expect(body.error ?? "").toContain("歷史科");
    expect(golden.listGoldenCandidateViews(candidatesFor(questionId))[0].status).toBe(
      "pending-review",
    );
  });

  it("名單未設定時 fail-closed：即使是教師角色也不能核准", async () => {
    const original = process.env.HISTORY_REVIEWER_EMAILS;
    delete process.env.HISTORY_REVIEWER_EMAILS;
    try {
      const response = await callGoldenDecision(
        questionId,
        { decision: "approved", reason: "名單未設定的核准", fixture: FIXTURE_CONTENT },
        cookieFor(TEACHER),
      );
      expect(response.status).toBe(403);
    } finally {
      if (original === undefined) delete process.env.HISTORY_REVIEWER_EMAILS;
      else process.env.HISTORY_REVIEWER_EMAILS = original;
    }
  });

  it("重複提交相同裁決不會產生重複紀錄；理由不同則另立一筆（Sprint 15）", async () => {
    const first = await callGoldenDecision(
      questionId,
      { decision: "approved", reason: "教師核對課本後核准", fixture: FIXTURE_CONTENT },
      cookieFor(TEACHER),
    );
    expect(first.status).toBe(200);
    expect(((await first.json()) as { created: boolean }).created).toBe(true);

    const duplicate = await callGoldenDecision(
      questionId,
      { decision: "approved", reason: "教師核對課本後核准", fixture: FIXTURE_CONTENT },
      cookieFor(TEACHER),
    );
    expect(duplicate.status).toBe(200);
    expect(((await duplicate.json()) as { created: boolean }).created).toBe(false);

    const rowsAfterDuplicate = getDb()
      .prepare("SELECT COUNT(*) AS count FROM golden_fixture_reviews")
      .get() as { count: number };
    expect(rowsAfterDuplicate.count).toBe(1);

    const differentReason = await callGoldenDecision(
      questionId,
      { decision: "rejected", reason: "再核對後發現來源不足", fixture: FIXTURE_CONTENT },
      cookieFor(TEACHER),
    );
    expect(differentReason.status).toBe(200);
    expect(((await differentReason.json()) as { created: boolean }).created).toBe(true);
    const rowsAfterChange = getDb()
      .prepare("SELECT COUNT(*) AS count FROM golden_fixture_reviews")
      .get() as { count: number };
    expect(rowsAfterChange.count).toBe(2);
    expect(golden.listGoldenCandidateViews(candidatesFor(questionId))[0].status).toBe("rejected");
  });
});
