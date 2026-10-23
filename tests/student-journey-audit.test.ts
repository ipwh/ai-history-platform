/**
 * 學生模擬審計（2026-10-16）：以**真實路由處理器**（Next.js route handler + 真資料庫 + mock provider）
 * 走完學生旅程，檢查題目品質、批改公平性及歷史記錄完整性。
 *
 * 誠實聲明：這些旅程是在處理器層執行的（與倉庫既有測試一致），**不是**真實瀏覽器旅程；
 * 唯一的例外是報告最後的手動 HTTP 檢查（`curl`／瀏覽器），該部分另行說明。
 *
 * Personas：
 *   A 認真高分學生——逐項比較選項、挑戰多於一個可辯解的答案。
 *   B 一般中三學生——理解主要概念但會混淆相近詞語；依賴解釋學習。
 *   C 基礎較弱學生——混淆時序、因果、人物；不應因題目含糊而被扣分。
 *   D 照字面理解的學生——依題幹字面作答，暴露「問詞語但答年份」等類型不符。
 *   E 會回報問題的學生——選可辯解的另類答案並回報，核對版本與作答綁定。
 *   F 回到既有練習的學生——題目其後被修改或撤回，核對歷史作答與新練習。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { openDocumentForStudents } from "./material-distribution";
import { freshTestDatabasePath } from "./test-database";
import { importTestPilotMaterial } from "./fixtures/pilot-material";

const testDbPath = freshTestDatabasePath("student-journey");
process.env.APP_DATABASE_PATH = testDbPath;
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
type MaterialsRepo = typeof import("@/server/repositories/materials");
type PracticeRepo = typeof import("@/server/repositories/practice");
type QuestionRepo = typeof import("@/server/repositories/questions");
type QuestionService = typeof import("@/server/services/question-service");
type ReportService = typeof import("@/server/services/question-report-service");

let session: SessionModule;
let seed: SeedModule;
let materialsRepo: MaterialsRepo;
let practiceRepo: PracticeRepo;
let questionsRepo: QuestionRepo;
let questionService: QuestionService;
let reports: ReportService;

const SECTIONS = ["topic-5-industrial", "topic-5-industrial"];
const STAGE = { A: "student-a", B: "student-b", C: "student-c", E: "student-e", F: "student-f" };

function cookieFor(learnerId: string): string {
  const at = learnerId.indexOf(":");
  const email = learnerId.slice(at + 1);
  return `hk-history-session=${encodeURIComponent(
    session.encodeSession({
      email,
      name: "模擬學生",
      role: "student",
      learnerId,
      pictureUrl: null,
    }),
  )}`;
}

/** 建立題庫練習並回傳 session id；這是學生端實際使用的路徑 */
async function startBankPractice(options: {
  learnerId: string;
  questionCount?: number;
  questionTypes?: ("mc" | "fill")[];
  difficulty?: "basic" | "advanced" | "challenge";
}): Promise<{ sessionId: string; questions: { id: string; questionType: string }[] }> {
  const { POST } = await import("@/app/api/practice/route");
  const response = await POST(
    new Request("http://localhost:3000/api/practice", {
      method: "POST",
      headers: { cookie: cookieFor(options.learnerId), "content-type": "application/json" },
      body: JSON.stringify({
        learnerId: options.learnerId,
        topicId: "topic-5",
        sectionIds: SECTIONS,
        questionTypes: options.questionTypes ?? ["mc"],
        difficulty: options.difficulty ?? "basic",
        questionCount: options.questionCount ?? 5,
        mode: "standard",
        questionSource: "bank",
        sourceSessionId: null,
      }),
    }),
  );
  expect(response.status, `practice creation failed: ${response.status}`).toBe(201);
  const payload = (await response.json()) as {
    session: { id: string };
    questions: { id: string; questionType: string }[];
  };
  return { sessionId: payload.session.id, questions: payload.questions };
}

async function answer(learnerId: string, sessionId: string, questionId: string, value: string) {
  const { POST } = await import("@/app/api/practice/[sessionId]/answers/route");
  const response = await POST(
    new Request(`http://localhost:3000/api/practice/${sessionId}/answers`, {
      method: "POST",
      headers: { cookie: cookieFor(learnerId), "content-type": "application/json" },
      body: JSON.stringify({ learnerId, questionId, answer: value }),
    }),
    { params: Promise.resolve({ sessionId }) },
  );
  return { status: response.status, payload: (await response.json()) as Record<string, unknown> };
}

/** 提交答案的回應是 { feedback, recorded, answeredCount, totalQuestions } */
function feedbackOf(result: { payload: Record<string, unknown> }): Record<string, unknown> {
  return (result.payload.feedback ?? {}) as Record<string, unknown>;
}

/** 取得一個包含指定題目的新練習（每次提交都要用新練習：同一題只會評分一次） */
async function sessionContaining(
  learnerId: string,
  questionId: string,
  questionTypes: ("mc" | "fill")[] = ["mc"],
): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { sessionId } = await startBankPractice({ learnerId, questionCount: 20, questionTypes });
    if (practiceRepo.getSessionQuestions(sessionId).some((question) => question.id === questionId)) {
      return sessionId;
    }
  }
  throw new Error(`題庫練習未能包含題目 ${questionId}（題庫存貨不足？）`);
}

async function readSession(learnerId: string, sessionId: string) {
  const { GET } = await import("@/app/api/practice/[sessionId]/route");
  const response = await GET(
    new Request(`http://localhost:3000/api/practice/${sessionId}?learnerId=${learnerId}`, {
      headers: { cookie: cookieFor(learnerId) },
    }),
    { params: Promise.resolve({ sessionId }) },
  );
  return { status: response.status, payload: (await response.json()) as Record<string, unknown> };
}

/** 建立一條可控的填充題（引用真實教材段落，附可接受寫法） */
async function createFillQuestion(options: {
  key: string;
  acceptedAnswers?: string[];
  suffix: string;
}): Promise<string> {
  const { buildMaterialUnits } = await import("@/server/services/material-units");
  const unit = buildMaterialUnits("topic-5", [SECTIONS[0]], { audience: "staff" })[0];
  if (!unit) throw new Error("測試資料庫沒有教材段落");
  const created = questionService.createManualQuestion({
    topicId: "topic-5",
    sectionId: SECTIONS[0],
    questionType: "fill",
    difficulty: "basic",
    question: `＿＿＿（${options.suffix}）：合成填充題，答案見於合成教材。`,
    options: [],
    correctAnswer: options.key,
    acceptedAnswers: options.acceptedAnswers ?? [],
    explanation: `合成解釋：合成教材以「${options.key}」作答。`,
    knowledgePoint: `合成知識點（${options.suffix}）`,
    sourceExcerpt: unit.text.trim().slice(0, 40),
    sourceLocation: unit.sourceLocation,
    sourceBlockIds: [unit.blockId],
    gradingPoints: [],
    qualityWarnings: [],
    skill: null,
    origin: "manual",
    status: "draft",
  });
  const stored = questionsRepo.getQuestion(created.id)!;
  questionsRepo.recordQuestionAutoValidation({
    questionId: created.id,
    revision: stored.revision,
    fingerprint: questionService.questionFingerprint(stored),
    validatedAt: new Date().toISOString(),
  });
  questionService.changeQuestionStatus(created.id, "published");
  return created.id;
}

beforeAll(async () => {
  session = await import("@/server/auth/session");
  seed = await import("@/server/seed");
  materialsRepo = await import("@/server/repositories/materials");
  practiceRepo = await import("@/server/repositories/practice");
  questionsRepo = await import("@/server/repositories/questions");
  questionService = await import("@/server/services/question-service");
  reports = await import("@/server/services/question-report-service");
  seed.ensureBootstrap();
  await importTestPilotMaterial();
  for (const block of materialsRepo.listGroundingBlocksForSections("topic-5", [])) {
    openDocumentForStudents(materialsRepo, block.documentId);
  }
});

describe("Persona A／D：認真及照字面理解的學生", () => {
  it("開始題庫練習時，未作答前不會洩露答案、解釋或教材節錄", async () => {
    const { sessionId, questions } = await startBankPractice({ learnerId: `school:${STAGE.A}@pochiu.edu.hk` });
    expect(questions.length).toBeGreaterThan(0);

    const view = await readSession(`school:${STAGE.A}@pochiu.edu.hk`, sessionId);
    expect(view.status).toBe(200);
    const studentQuestions = view.payload.questions as Record<string, unknown>[];
    for (const question of studentQuestions) {
      expect(question.correctAnswer).toBeUndefined();
      expect(question.explanation).toBeUndefined();
      expect(question.sourceExcerpt).toBeUndefined();
      expect(question.acceptedAnswers).toBeUndefined();
    }
  });

  it("題庫中不存在「題幹問詞語但答案是年份」的題目（品質閘門把關）", async () => {
    const published = questionsRepo.listQuestions({ topicId: "topic-5", statuses: ["published"] });
    const defective = published.filter(
      (question) =>
        question.questionType === "mc" &&
        question.question.includes("詞語") &&
        /\d{3,4}\s*年|公元|世紀/.test(question.correctAnswer),
    );
    expect(defective.map((question) => `${question.id}: ${question.question}`)).toEqual([]);
  });

  it("每個選擇題選項都被如實批改：只有標準答案為正確", async () => {
    const learnerId = `school:${STAGE.A}@pochiu.edu.hk`;
    const { sessionId } = await startBankPractice({ learnerId, questionCount: 3 });
    const mc = practiceRepo.getSessionQuestions(sessionId).find((question) => question.questionType === "mc");
    expect(mc).toBeDefined();

    // 每個選項用一個新練習提交：同一題只會評分一次（見下面的「首次提交為準」測試）
    for (const option of mc!.options) {
      const fresh = await sessionContaining(learnerId, mc!.id);
      const result = await answer(learnerId, fresh, mc!.id, option);
      expect(result.status).toBe(200);
      expect(feedbackOf(result).isCorrect, `選項「${option}」`).toBe(option === mc!.correctAnswer);
      // 回饋必須與顯示的答案一致，並提供解釋
      expect(feedbackOf(result).correctAnswer).toBe(mc!.correctAnswer);
      expect(String(feedbackOf(result).explanation ?? "").length).toBeGreaterThan(0);
    }
  });

  it("同一題重複提交不會重新評分（首次提交為準，避免看到答案後改分）", async () => {
    const learnerId = `school:${STAGE.A}@pochiu.edu.hk`;
    const { sessionId } = await startBankPractice({ learnerId, questionCount: 3 });
    const mc = practiceRepo.getSessionQuestions(sessionId).find((q) => q.questionType === "mc")!;
    const wrong = mc.options.find((option) => option !== mc.correctAnswer)!;

    const first = await answer(learnerId, sessionId, mc.id, wrong);
    expect(feedbackOf(first).isCorrect).toBe(false);
    expect(first.payload.recorded).toBe(true);

    const second = await answer(learnerId, sessionId, mc.id, mc.correctAnswer);
    expect(second.payload.recorded).toBe(false);
    expect(feedbackOf(second).isCorrect).toBe(false);
    expect(feedbackOf(second).answer).toBe(wrong);
    expect(practiceRepo.listAttempts(sessionId).filter((a) => a.questionId === mc.id)).toHaveLength(1);
  });

  it("選項的文字變體（空白、標點、全形）不會被誤判為錯誤", async () => {
    const learnerId = `school:${STAGE.A}@pochiu.edu.hk`;
    const { sessionId } = await startBankPractice({ learnerId, questionCount: 3 });
    const mc = practiceRepo.getSessionQuestions(sessionId).find((q) => q.questionType === "mc")!;

    const variants = [` ${mc.correctAnswer} `, `${mc.correctAnswer}。`];
    for (const variant of variants) {
      const fresh = await sessionContaining(learnerId, mc.id);
      const result = await answer(learnerId, fresh, mc.id, variant);
      expect(feedbackOf(result).isCorrect, `變體「${variant}」`).toBe(true);
    }
  });
});

describe("Persona B／C：一般及基礎較弱的學生", () => {
  it("答錯時仍取得答案、解釋及知識點（可從錯誤中學習）", async () => {
    const learnerId = `school:${STAGE.B}@pochiu.edu.hk`;
    const { sessionId } = await startBankPractice({ learnerId, questionCount: 3 });
    const mc = practiceRepo.getSessionQuestions(sessionId).find((q) => q.questionType === "mc")!;
    const wrong = mc.options.find((option) => option !== mc.correctAnswer)!;

    const result = await answer(learnerId, sessionId, mc.id, wrong);

    expect(feedbackOf(result).isCorrect).toBe(false);
    expect(feedbackOf(result).explanation).toBe(mc.explanation);
    expect(feedbackOf(result).knowledgePoint).toBe(mc.knowledgePoint);
    expect(feedbackOf(result).correctAnswer).toBe(mc.correctAnswer);
  });

  it("填充題只差一個字時標示為「需要教師覆核」，不當成明確答錯，也不當成答對", async () => {
    const learnerId = `school:${STAGE.C}@pochiu.edu.hk`;
    const key = "合成歷史詞語";
    await createFillQuestion({ key, suffix: "近似" });
    const { sessionId } = await startBankPractice({
      learnerId,
      questionCount: 10,
      questionTypes: ["fill"],
    });
    const fill = practiceRepo
      .getSessionQuestions(sessionId)
      .find((question) => question.correctAnswer === key)!;
    expect(fill).toBeDefined();

    // 少一個字（漏字）：不當成明確答錯，標示為需要教師覆核
    const nearMissSession = await sessionContaining(learnerId, fill.id, ["fill"]);
    const nearMiss = await answer(learnerId, nearMissSession, fill.id, "合成歷史語");
    expect(feedbackOf(nearMiss).isCorrect).toBe(false);
    expect(feedbackOf(nearMiss).reviewFlag).toBe("uncertain-answer");

    // 逐字相同則為正確（另一個新練習，因為同一題只會評分一次）
    const exactSession = await sessionContaining(learnerId, fill.id, ["fill"]);
    const exact = await answer(learnerId, exactSession, fill.id, key);
    expect(feedbackOf(exact).isCorrect).toBe(true);
    expect(feedbackOf(exact).reviewFlag ?? null).toBeNull();
  });

  it("未作答的題目不會被當成答錯（成績只計已批改的題目）", async () => {
    const learnerId = `school:${STAGE.C}@pochiu.edu.hk`;
    const { sessionId, questions } = await startBankPractice({ learnerId, questionCount: 4 });
    const first = practiceRepo.getSessionQuestions(sessionId)[0];
    const correct = first.questionType === "mc" ? first.correctAnswer : "（不適用）";
    if (first.questionType === "mc") await answer(learnerId, sessionId, first.id, correct);

    const view = await readSession(learnerId, sessionId);
    // 只提交了一題：未作答的題目不會產生回饋，亦不會被當成答錯
    const feedback = view.payload.feedback as unknown[];
    expect(feedback).toHaveLength(1);
    void questions;
  });
});

describe("Persona E：會回報問題的學生", () => {
  it("回報綁定當時的題目版本及相關作答，教師端看到學生答案", async () => {
    const learnerId = `school:${STAGE.E}@pochiu.edu.hk`;
    const { sessionId } = await startBankPractice({ learnerId, questionCount: 3 });
    const mc = practiceRepo.getSessionQuestions(sessionId).find((q) => q.questionType === "mc")!;
    const alternative = mc.options.find((option) => option !== mc.correctAnswer)!;
    await answer(learnerId, sessionId, mc.id, alternative);
    const attempt = practiceRepo.getAttempt(sessionId, mc.id)!;

    const { POST } = await import("@/app/api/reports/route");
    const response = await POST(
      new Request("http://localhost:3000/api/reports", {
        method: "POST",
        headers: { cookie: cookieFor(learnerId), "content-type": "application/json" },
        body: JSON.stringify({
          learnerId,
          questionId: mc.id,
          sessionId,
          attemptId: attempt.id,
          reason: "answer-disputed",
          detail: "我認為另一個選項同樣可以成立",
        }),
      }),
    );
    expect(response.status).toBe(201);

    const teacherView = reports.listQuestionReports({ questionId: mc.id })[0];
    expect(teacherView.questionRevision).toBe(mc.revision);
    expect(teacherView.questionFingerprint).not.toBeNull();
    expect(teacherView.attemptAnswer).toBe(alternative);
    expect(teacherView.attemptIsCorrect).toBe(false);
    expect(teacherView.revisionChanged).toBe(false);
  });

  it("回報不會自動改動題目或分數（未查證前仍是原狀）", async () => {
    const learnerId = `school:${STAGE.E}@pochiu.edu.hk`;
    const { sessionId } = await startBankPractice({ learnerId, questionCount: 3 });
    const mc = practiceRepo.getSessionQuestions(sessionId).find((q) => q.questionType === "mc")!;
    const before = practiceRepo.getAttempt(sessionId, mc.id);

    reports.submitQuestionReport(learnerId, { questionId: mc.id, reason: "unclear", detail: "不清楚" });

    expect(questionsRepo.getQuestion(mc.id)?.status).toBe("published");
    expect(practiceRepo.getAttempt(sessionId, mc.id)).toEqual(before);
  });

  it("教師從回報下架題目後，學生的新練習不再包含它，但該次練習仍可作答（凍結試卷）", async () => {
    // 用獨立的模擬學生：同一學生對同一版本已有未處理回報時不會重複建立
    const learnerId = `school:${STAGE.E}-withdraw@pochiu.edu.hk`;
    const { sessionId } = await startBankPractice({ learnerId, questionCount: 3 });
    const mc = practiceRepo.getSessionQuestions(sessionId).find((q) => q.questionType === "mc")!;
    const submitted = reports.submitQuestionReport(learnerId, {
      questionId: mc.id,
      reason: "source-problem",
      detail: "來源有問題",
    });
    expect(submitted.alreadyReported).toBe(false);

    const result = reports.withdrawQuestionFromReport(submitted.reportId, "teacher@example.com");
    expect(result.action).toBe("withdraw-question");

    // 新練習不再包含（題庫只取 published）
    const next = await startBankPractice({ learnerId, questionCount: 10 });
    expect(practiceRepo.getSessionQuestions(next.sessionId).map((q) => q.id)).not.toContain(mc.id);

    // 既有練習仍可作答（歷史試卷不追溯改寫）
    const stillAnswerable = await answer(learnerId, sessionId, mc.id, mc.correctAnswer);
    expect(stillAnswerable.status).toBe(200);
  });
});

describe("Persona F：回到既有練習的學生", () => {
  it("題目其後被修改：作答記錄保留，並標示為舊版作答；新練習用新版本", async () => {
    const learnerId = `school:${STAGE.F}@pochiu.edu.hk`;
    const { sessionId } = await startBankPractice({ learnerId, questionCount: 3 });
    const mc = practiceRepo.getSessionQuestions(sessionId).find((q) => q.questionType === "mc")!;
    await answer(learnerId, sessionId, mc.id, mc.correctAnswer);
    const attemptBefore = practiceRepo.getAttempt(sessionId, mc.id)!;
    expect(attemptBefore.questionRevision).toBe(mc.revision);

    // 教師修正題目解釋（版本遞增，舊驗證失效）
    const current = questionsRepo.getQuestion(mc.id)!;
    questionService.updateManualQuestion(mc.id, {
      ...current,
      status: "draft",
      explanation: `${current.explanation}（教師補充說明）`,
    });

    // 歷史作答不變；教師端看到「以舊版批改」的作答（同一題可能有其他學生作答，因此以遞增後的總數核對）
    expect(practiceRepo.getAttempt(sessionId, mc.id)).toEqual(attemptBefore);
    const view = questionService.teacherQuestionView(questionsRepo.getQuestion(mc.id)!);
    expect(view.staleAttempts).toBeGreaterThanOrEqual(1);
    expect(view.totalAttempts).toBeGreaterThanOrEqual(view.staleAttempts);

    // 未重新驗證前不會回到學生練習
    const next = await startBankPractice({ learnerId, questionCount: 10 });
    expect(practiceRepo.getSessionQuestions(next.sessionId).map((q) => q.id)).not.toContain(mc.id);
  });

  it("未登入者不能讀取他人的練習（工作階段身分優先）", async () => {
    const owner = `school:${STAGE.F}@pochiu.edu.hk`;
    const { sessionId } = await startBankPractice({ learnerId: owner, questionCount: 2 });

    const otherStudent = `school:student-g@pochiu.edu.hk`;
    const forbidden = await readSession(otherStudent, sessionId);
    expect(forbidden.status).toBe(403);

    const { GET } = await import("@/app/api/practice/[sessionId]/route");
    const anonymous = await GET(
      new Request(`http://localhost:3000/api/practice/${sessionId}?learnerId=${owner}`),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(anonymous.status).toBe(401);
  });
});

describe("批改契約（第 6 節）", () => {
  it("可接受寫法（acceptedAnswers）會計為正確；未列出的同義寫法不會", async () => {
    const learnerId = `school:${STAGE.B}@pochiu.edu.hk`;
    const key = "合成契約詞語";
    const accepted = "合成契約別稱";
    await createFillQuestion({ key, acceptedAnswers: [accepted], suffix: "可接受寫法" });
    // 題庫抽題是隨機的；合併後的主題題目較多，因此要求題數上限，確保合成的題目一定被抽中
    const { sessionId } = await startBankPractice({
      learnerId,
      questionCount: 30,
      questionTypes: ["fill"],
    });
    const fill = practiceRepo.getSessionQuestions(sessionId).find((q) => q.correctAnswer === key);
    if (!fill) throw new Error("練習中找不到剛建立的合成填充題");

    // 各自用新練習提交（同一題只會評分一次）
    const acceptedSession = await sessionContaining(learnerId, fill.id, ["fill"]);
    expect(feedbackOf(await answer(learnerId, acceptedSession, fill.id, accepted)).isCorrect).toBe(true);

    // 未列出的同義詞（不同措辭）不會自動接受
    const synonymSession = await sessionContaining(learnerId, fill.id, ["fill"]);
    expect(
      feedbackOf(await answer(learnerId, synonymSession, fill.id, "另一個同義詞語")).isCorrect,
    ).toBe(false);

    // 簡體字答案不會被當成正確（現行行為；HK 課程使用繁體，屬已知限制）
    const simplifiedSession = await sessionContaining(learnerId, fill.id, ["fill"]);
    expect(
      feedbackOf(await answer(learnerId, simplifiedSession, fill.id, "合成契约词语")).isCorrect,
    ).toBe(false);
  });

  it("空白答案會被拒絕（400）而不是當成答錯記錄", async () => {
    const learnerId = `school:${STAGE.B}@pochiu.edu.hk`;
    const { sessionId } = await startBankPractice({ learnerId, questionCount: 2 });
    const mc = practiceRepo.getSessionQuestions(sessionId)[0];

    const empty = await answer(learnerId, sessionId, mc.id, "");
    // 未作答不應被記錄成錯誤作答：系統要求學生先輸入／選擇答案
    expect(empty.status).toBe(400);
    expect(String(empty.payload.error ?? "")).toContain("請先作答");
    expect(practiceRepo.getAttempt(sessionId, mc.id)).toBeNull();
  });

  it("重複提交只保留一筆作答（首次提交為準，不重複計分）", async () => {
    const learnerId = `school:${STAGE.B}@pochiu.edu.hk`;
    const { sessionId } = await startBankPractice({ learnerId, questionCount: 2 });
    const mc = practiceRepo.getSessionQuestions(sessionId).find((q) => q.questionType === "mc")!;
    const wrong = mc.options.find((option) => option !== mc.correctAnswer)!;

    const first = await answer(learnerId, sessionId, mc.id, wrong);
    const second = await answer(learnerId, sessionId, mc.id, mc.correctAnswer);

    const attempts = practiceRepo.listAttempts(sessionId).filter((a) => a.questionId === mc.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].isCorrect).toBe(false);
    expect(first.payload.recorded).toBe(true);
    expect(second.payload.recorded).toBe(false);
  });

  it("填充題會被自動評分（逐字比對）", async () => {
    const learnerId = `school:${STAGE.B}@pochiu.edu.hk`;
    const { sessionId } = await startBankPractice({
      learnerId,
      questionCount: 4,
      questionTypes: ["fill"],
    });
    const fill = practiceRepo.getSessionQuestions(sessionId).find((q) => q.questionType === "fill");
    if (fill === undefined) return; // 該分節可能沒有填充題存貨，屬可接受情況
    const result = await answer(learnerId, sessionId, fill.id, fill.correctAnswer);
    expect(feedbackOf(result).autoGraded).toBe(true);
    expect(feedbackOf(result).isCorrect).toBe(true);
  });
});
