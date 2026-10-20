/**
 * 回報 → 教師補救流程測試（Sprint 7.8，Task 4／5）。
 *
 * 契約：
 *   1. 回報綁定**當時的題目版本與內容指紋**，以及相關的作答紀錄（學生當時的答案）。
 *   2. 題目被修正後，回報會標示版本已改變（教師能分辨舊版回報與現行版本）。
 *   3. 同一學生對同一版本的重複回報不會產生新記錄（避免回報量失控）。
 *   4. 不可回報他人的作答，亦不可把不相關的作答連到題目上。
 *   5. 教師可從回報一鍵下架題目（不刪除）或重新執行自動品質驗證，並記錄實際行動。
 *   6. 回報本身不會自動被當成錯誤證明（題目狀態不變，除非教師採取行動）。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("report-revision");
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
type ReportService = typeof import("@/server/services/question-report-service");
type ReportsRepo = typeof import("@/server/repositories/reports");

let session: SessionModule;
let seed: SeedModule;
let questions: QuestionService;
let questionsRepo: QuestionRepo;
let practiceRepo: PracticeRepo;
let reports: ReportService;
let reportsRepo: ReportsRepo;

const SECTIONS = ["topic-5-industrial"];

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
const OTHER_STUDENT = {
  email: "s2024150@pochiu.edu.hk",
  name: "另一位學生",
  role: "student" as const,
  learnerId: "school:s2024150@pochiu.edu.hk",
  pictureUrl: null,
};

function cookieFor(user: typeof TEACHER | typeof STUDENT | typeof OTHER_STUDENT): string {
  return `hk-history-session=${encodeURIComponent(session.encodeSession(user))}`;
}

async function callTeacherReports(
  body: Record<string, unknown>,
  reportId: string,
  cookie: string,
): Promise<Response> {
  const { PATCH } = await import("@/app/api/teacher/reports/route");
  return PATCH(
    new Request(`http://localhost:3000/api/teacher/reports?reportId=${reportId}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** 建立一條已發布、已通過自動驗證的題目（引用真實教材段落，令來源核對可以通過） */
async function createPublishedQuestion(suffix: string): Promise<string> {
  const { buildMaterialUnits } = await import("@/server/services/material-units");
  const units = buildMaterialUnits("topic-5", [SECTIONS[0]], { audience: "staff" });
  const unit = units[0];
  if (!unit) throw new Error("測試資料庫沒有教材段落，無法建立題目");
  const key = unit.text.trim().slice(0, 16);
  const created = questions.createManualQuestion({
    topicId: "topic-5",
    sectionId: SECTIONS[0],
    questionType: "mc",
    difficulty: "basic",
    question: `以下哪一項是教材提及的內容？（${suffix}）`,
    options: [key, "重商主義", "軍國主義", "封建主義"],
    correctAnswer: key,
    acceptedAnswers: [],
    explanation: `教材原文提及「${key}」。`,
    knowledgePoint: `回報測試知識點（${suffix}）`,
    sourceExcerpt: unit.text.trim().slice(0, 40),
    sourceLocation: unit.sourceLocation,
    sourceBlockIds: [unit.blockId],
    gradingPoints: [],
    qualityWarnings: [],
    skill: null,
    origin: "manual",
    status: "draft",
  });
  // 模擬「這一版已通過自動品質驗證」：手動題目不會經生成流程驗證
  const stored = questionsRepo.getQuestion(created.id)!;
  questionsRepo.recordQuestionAutoValidation({
    questionId: created.id,
    revision: stored.revision,
    fingerprint: questions.questionFingerprint(stored),
    validatedAt: new Date().toISOString(),
  });
  questions.changeQuestionStatus(created.id, "published");
  return created.id;
}

beforeAll(async () => {
  session = await import("@/server/auth/session");
  seed = await import("@/server/seed");
  questions = await import("@/server/services/question-service");
  questionsRepo = await import("@/server/repositories/questions");
  practiceRepo = await import("@/server/repositories/practice");
  reports = await import("@/server/services/question-report-service");
  reportsRepo = await import("@/server/repositories/reports");
  seed.ensureBootstrap();
  // 題目需要引用真實教材段落（重新驗證會核對段落是否存在及節錄是否仍在其中）
  const materialService = await import("@/server/services/material-service");
  const imported = await materialService.importPilotMaterialFromDisk({ runOcr: false });
  if (!imported) throw new Error("找不到課題5的教材檔案");
});

describe("回報綁定題目版本與作答", () => {
  it("回報會記下版本、內容指紋及相關作答（學生當時的答案）", async () => {
    const questionId = await createPublishedQuestion("版本");
    // 題目已發布（可用），而且沒有任何人工覆核紀錄
    expect(questionsRepo.getQuestion(questionId)?.status).toBe("published");

    const practice = await import("@/server/services/practice-service");
    const assembled = await practice.createPractice({
      learnerId: STUDENT.learnerId,
      topicId: "topic-5",
      sectionIds: SECTIONS,
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 1,
      mode: "standard",
      questionSource: "bank",
      sourceSessionId: null,
    });
    // 以題庫題目作答（快照內的題目），確保作答記錄存在
    const sessionQuestions = practiceRepo.getSessionQuestions(assembled.session.id);
    const target = sessionQuestions[0];
    await practice.submitAnswer(assembled.session.id, STUDENT.learnerId, target.id, "重商主義");
    const attempt = practiceRepo.getAttempt(assembled.session.id, target.id)!;

    const result = reports.submitQuestionReport(STUDENT.learnerId, {
      questionId: target.id,
      sessionId: assembled.session.id,
      attemptId: attempt.id,
      reason: "answer-disputed",
      detail: "答案有爭議",
    });
    expect(result.alreadyReported).toBe(false);

    const stored = reportsRepo.getReport(result.reportId)!;
    expect(stored.questionRevision).toBe(target.revision);
    expect(stored.questionFingerprint).not.toBeNull();
    expect(stored.attemptId).toBe(attempt.id);

    // 教師端看到相關作答及版本狀態
    const teacherView = reports
      .listQuestionReports({ questionId: target.id })
      .find((item) => item.id === result.reportId)!;
    expect(teacherView.attemptAnswer).toBe("重商主義");
    expect(teacherView.attemptIsCorrect).toBe(false);
    expect(teacherView.revisionChanged).toBe(false);
  });

  it("同一學生對同一版本的重複回報不會產生新記錄", async () => {
    const questionId = await createPublishedQuestion("重複");
    const first = reports.submitQuestionReport(STUDENT.learnerId, {
      questionId,
      reason: "unclear",
      detail: "題目不清楚",
    });
    const second = reports.submitQuestionReport(STUDENT.learnerId, {
      questionId,
      reason: "unclear",
      detail: "再交一次",
    });

    expect(first.alreadyReported).toBe(false);
    expect(second.alreadyReported).toBe(true);
    expect(reportsRepo.listReports({ questionId }).length).toBe(1);
  });

  it("題目被修正後，舊回報會標示版本已改變，並可再次回報新版本", async () => {
    const questionId = await createPublishedQuestion("修正");
    const first = reports.submitQuestionReport(STUDENT.learnerId, {
      questionId,
      reason: "answer-disputed",
      detail: "答案有爭議",
    });
    const before = questionsRepo.getQuestion(questionId)!;

    // 教師修正題目（版本遞增；已發布題目會回到草稿等待重新驗證／覆核）
    questions.updateManualQuestion(questionId, {
      ...before,
      status: "draft",
      explanation: "教材原文提及正確的歷史詞語，因此答案為該詞語。",
    });
    const after = questionsRepo.getQuestion(questionId)!;
    expect(after.revision).toBeGreaterThan(before.revision);

    const teacherView = reports
      .listQuestionReports({ questionId })
      .find((item) => item.id === first.reportId)!;
    expect(teacherView.revisionChanged).toBe(true);

    // 新版本可以再次回報（舊版本的回報不會阻止）
    const second = reports.submitQuestionReport(STUDENT.learnerId, {
      questionId,
      reason: "explanation-unclear",
      detail: "解釋不清楚",
    });
    expect(second.alreadyReported).toBe(false);
  });

  it("不可把其他學生的作答連到自己的回報", async () => {
    const practice = await import("@/server/services/practice-service");
    const assembled = await practice.createPractice({
      learnerId: OTHER_STUDENT.learnerId,
      topicId: "topic-5",
      sectionIds: SECTIONS,
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 1,
      mode: "standard",
      questionSource: "bank",
      sourceSessionId: null,
    });
    const target = practiceRepo.getSessionQuestions(assembled.session.id)[0];
    await practice.submitAnswer(assembled.session.id, OTHER_STUDENT.learnerId, target.id, "封建主義");
    const otherAttempt = practiceRepo.getAttempt(assembled.session.id, target.id)!;

    expect(() =>
      reports.submitQuestionReport(STUDENT.learnerId, {
        questionId: target.id,
        sessionId: assembled.session.id,
        attemptId: otherAttempt.id,
        reason: "other",
        detail: "",
      }),
    ).toThrowError(/不能回報其他學習者/);

    // 亦不可把不相關的作答連到題目上。這條題目必須在作答**之後**才建立：題庫抽題會打亂
    // 次序（practice-service 的 shuffle 使用 Math.random），而先建立的題目同樣符合抽題條件
    // （同課題／分節／題型／難度且已發布），有機會被抽中，令「不相關」的作答其實屬於同一條
    // 題目，斷言就會隨機失敗（2026-10-16 實測：單獨執行 20 次約 20% 失敗）。
    const unrelatedQuestionId = await createPublishedQuestion("不相關");
    expect(() =>
      reports.submitQuestionReport(OTHER_STUDENT.learnerId, {
        questionId: unrelatedQuestionId,
        attemptId: otherAttempt.id,
        reason: "other",
        detail: "",
      }),
    ).toThrowError(/不屬於這條題目/);
  });
});

describe("教師補救流程", () => {
  it("回報本身不會改動題目狀態（未經查證不算證明）", async () => {
    const questionId = await createPublishedQuestion("未查證");
    reports.submitQuestionReport(STUDENT.learnerId, {
      questionId,
      reason: "answer-disputed",
      detail: "我覺得答案有問題",
    });
    expect(questionsRepo.getQuestion(questionId)?.status).toBe("published");
  });

  it("教師可從回報下架題目，並記錄實際行動", async () => {
    const questionId = await createPublishedQuestion("下架");
    const submitted = reports.submitQuestionReport(STUDENT.learnerId, {
      questionId,
      reason: "answer-disputed",
      detail: "答案有爭議",
    });

    const result = reports.withdrawQuestionFromReport(submitted.reportId, TEACHER.email);

    expect(result.action).toBe("withdraw-question");
    expect(questionsRepo.getQuestion(questionId)?.status).toBe("disabled");
    const stored = reportsRepo.getReport(submitted.reportId)!;
    expect(stored.status).toBe("resolved");
    expect(stored.resolutionAction).toBe("withdraw-question");
    expect(stored.resolvedBy).toBe(TEACHER.email);
    // 下架不是刪除：題目仍在題庫，版本與自動驗證紀錄保留
    expect(questionsRepo.getQuestion(questionId)).not.toBeNull();
  });

  it("教師可重新執行自動品質驗證，通過後題目可再次發布", async () => {
    const questionId = await createPublishedQuestion("重新驗證");
    const submitted = reports.submitQuestionReport(STUDENT.learnerId, {
      questionId,
      reason: "source-problem",
      detail: "教材來源有問題",
    });
    questions.changeQuestionStatus(questionId, "draft");

    const result = reports.revalidateQuestionFromReport(submitted.reportId, TEACHER.email);

    expect(result.action).toBe("revalidate-question");
    expect(result.autoValidated).toBe(true);
    expect(questions.autoValidationIsCurrent(questionsRepo.getQuestion(questionId)!)).toBe(true);
    // 重新驗證後教師可以發布（自動驗證紀錄已對應目前版本）
    questions.changeQuestionStatus(questionId, "published");
    expect(questionsRepo.getQuestion(questionId)?.status).toBe("published");
    // 過程中沒有偽造任何人工覆核紀錄
    expect(questionsRepo.listQuestionReviews(questionId)).toEqual([]);
  });

  it("教材依據失效時重新驗證會失敗並回報原因（不誤報通過）", async () => {
    const questionId = await createPublishedQuestion("來源失效");
    const submitted = reports.submitQuestionReport(STUDENT.learnerId, {
      questionId,
      reason: "source-problem",
      detail: "",
    });
    const current = questionsRepo.getQuestion(questionId)!;
    questions.updateManualQuestion(questionId, {
      ...current,
      status: "draft",
      sourceBlockIds: ["blk_missing_source"],
      sourceExcerpt: "不存在的教材節錄",
    });

    const result = reports.revalidateQuestionFromReport(submitted.reportId, TEACHER.email);

    expect(result.action).toBe("revalidate-failed");
    expect(result.autoValidated).toBe(false);
    expect(result.issues.join(" ")).toContain("不存在");
    // 未通過驗證的版本不會被標示為已驗證
    expect(questions.autoValidationIsCurrent(questionsRepo.getQuestion(questionId)!)).toBe(false);
  });

  it("教師處理回報的 API 拒絕學生（403）", async () => {
    const questionId = await createPublishedQuestion("權限");
    const submitted = reports.submitQuestionReport(STUDENT.learnerId, {
      questionId,
      reason: "other",
      detail: "",
    });

    const response = await callTeacherReports(
      { status: "resolved" },
      submitted.reportId,
      cookieFor(STUDENT),
    );
    expect(response.status).toBe(403);
  });
});
