/**
 * 題目回報測試（學生回報 → 教師覆核）。
 *
 * 驗證：
 *   1. 學生可回報自己做過的題目，回報會令題目在教師端顯示「待覆核」。
 *   2. 同一學生重覆回報同一題目不會產生重複記錄。
 *   3. 教師可查看及處理回報（已處理／已略過／重設為待覆核），只影響回報，不會改動題目。
 *   4. 學生不可回報其他學生練習中的題目，亦不可處理回報（學生呼叫教師 API 會 403）。
 *   5. AI 即時生成的題目只存在於練習快照，也必須可以回報（教師端仍看到題目內容）。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("reports");
process.env.LLM_PROVIDER = "mock";
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
// 教師身分一律由設定推導（非校內網域的教師帳戶必須列在 AUTH_TEACHER_EMAILS）；
// 工作階段 cookie 只證明「已登入」，不再自行決定角色。
process.env.AUTH_TEACHER_EMAILS = "teacher@example.com";
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
delete process.env.ADMIN_TOKEN;

type PracticeService = typeof import("@/server/services/practice-service");
type ReportService = typeof import("@/server/services/question-report-service");
type SessionModule = typeof import("@/server/auth/session");
type Seed = typeof import("@/server/seed");
type QuestionRepository = typeof import("@/server/repositories/questions");

let practice: PracticeService;
let reports: ReportService;
let session: SessionModule;
let seed: Seed;
let questionsRepo: QuestionRepository;

const STUDENT = "school:s2024146@pochiu.edu.hk";
const OTHER_STUDENT = "school:s2024150@pochiu.edu.hk";
/** 每個測試使用不同的學習者，避免同一題目已有未處理回報而影響斷言 */
const THIRD_STUDENT = "school:s2024151@pochiu.edu.hk";
const FOURTH_STUDENT = "school:s2024152@pochiu.edu.hk";
const FIFTH_STUDENT = "school:s2024153@pochiu.edu.hk";
const TEACHER = "teacher:teacher@example.com";
const SECTION = "topic-5-renaissance-reformation";

const TEACHER_USER = {
  email: "teacher@example.com",
  name: "測試教師",
  role: "teacher" as const,
  learnerId: TEACHER,
  pictureUrl: null,
};

const STUDENT_USER = {
  email: "s2024146@pochiu.edu.hk",
  name: "測試學生",
  role: "student" as const,
  learnerId: STUDENT,
  pictureUrl: null,
};

beforeAll(async () => {
  practice = await import("@/server/services/practice-service");
  reports = await import("@/server/services/question-report-service");
  session = await import("@/server/auth/session");
  seed = await import("@/server/seed");
  questionsRepo = await import("@/server/repositories/questions");
  seed.ensureBootstrap();
});

async function createStudentPractice(learnerId: string) {
  return practice.createPractice({
    learnerId,
    topicId: "topic-5",
    sectionIds: [SECTION],
    questionTypes: ["mc"],
    difficulty: "basic",
    questionCount: 1,
    mode: "standard",
    sourceSessionId: null,
  });
}

describe("題目回報", () => {
  it("學生可回報題目，教師端會看到待覆核回報", async () => {
    const created = await createStudentPractice(STUDENT);
    const questionId = created.questions[0].id;

    const result = reports.submitQuestionReport(STUDENT, {
      questionId,
      sessionId: created.session.id,
      reason: "answer-disputed",
      detail: "我認為答案應該是文藝復興的人文主義。",
    });
    expect(result.alreadyReported).toBe(false);

    const list = reports.listQuestionReports({ status: "open" });
    const report = list.find((item) => item.id === result.reportId);
    expect(report).toBeDefined();
    expect(report?.reason).toBe("answer-disputed");
    expect(report?.detail).toContain("人文主義");
    expect(report?.question.length).toBeGreaterThan(0);
    expect(report?.topicTitle).toContain("課題5");
    expect(report?.openCountForQuestion).toBe(1);

    // 題目只會標示待覆核，狀態不會被自動改變
    const question = questionsRepo.getQuestion(questionId);
    expect(question?.status).not.toBe("disabled");

    // 同一學生重覆回報不會產生重複記錄
    const again = reports.submitQuestionReport(STUDENT, {
      questionId,
      sessionId: created.session.id,
      reason: "unclear",
      detail: "",
    });
    expect(again.alreadyReported).toBe(true);
    expect(reports.listQuestionReports({ questionId })).toHaveLength(1);
  });

  it("學生不可回報其他學生練習中的題目", async () => {
    const created = await createStudentPractice(OTHER_STUDENT);
    expect(() =>
      reports.submitQuestionReport(STUDENT, {
        questionId: created.questions[0].id,
        sessionId: created.session.id,
        reason: "unclear",
        detail: "",
      }),
    ).toThrowError(/其他學習者/);
  });

  it("教師可查看及處理回報（只影響回報記錄）", async () => {
    const created = await createStudentPractice(THIRD_STUDENT);
    const questionId = created.questions[0].id;
    const submitted = reports.submitQuestionReport(THIRD_STUDENT, {
      questionId,
      sessionId: created.session.id,
      reason: "source-problem",
      detail: "教材節錄與題目不符。",
    });
    expect(submitted.alreadyReported).toBe(false);

    const teacherList = reports.listQuestionReports({ status: "open" });
    expect(teacherList.some((item) => item.id === submitted.reportId)).toBe(true);

    const resolved = reports.resolveQuestionReport(submitted.reportId, "resolved", TEACHER_USER.email);
    expect(resolved?.status).toBe("resolved");
    expect(reports.listQuestionReports({ status: "open" }).some((item) => item.id === submitted.reportId)).toBe(
      false,
    );

    // 題目本身沒有被刪除或停用
    expect(questionsRepo.getQuestion(questionId)).not.toBeNull();

    const reopened = reports.resolveQuestionReport(submitted.reportId, "open", null);
    expect(reopened?.status).toBe("open");
  });

  it("學生呼叫教師回報 API 會收到 403（只有教師可處理回報）", async () => {
    const { GET, PATCH } = await import("@/app/api/teacher/reports/route");
    const cookie = `hk-history-session=${encodeURIComponent(session.encodeSession(STUDENT_USER))}`;

    const listResponse = await GET(
      new Request("http://localhost:3000/api/teacher/reports", { headers: { cookie } }),
    );
    expect(listResponse.status).toBe(403);

    const patchResponse = await PATCH(
      new Request("http://localhost:3000/api/teacher/reports?reportId=report_x", {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ status: "resolved" }),
      }),
    );
    expect(patchResponse.status).toBe(403);

    const teacherCookie = `hk-history-session=${encodeURIComponent(session.encodeSession(TEACHER_USER))}`;
    const teacherResponse = await GET(
      new Request("http://localhost:3000/api/teacher/reports", { headers: { cookie: teacherCookie } }),
    );
    expect(teacherResponse.status).toBe(200);
  });

  it("學生回報 API 會以工作階段的學習者身分記錄", async () => {
    const created = await createStudentPractice(FOURTH_STUDENT);
    const cookie = `hk-history-session=${encodeURIComponent(
      session.encodeSession({ ...STUDENT_USER, email: "s2024152@pochiu.edu.hk", learnerId: FOURTH_STUDENT }),
    )}`;

    const response = await (await import("@/app/api/reports/route")).POST(
      new Request("http://localhost:3000/api/reports", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          // 已登入時，前端傳來的 learnerId 必須被忽略
          learnerId: "attacker-controlled-learner",
          questionId: created.questions[0].id,
          sessionId: created.session.id,
          reason: "explanation-unclear",
          detail: "解釋太短。",
        }),
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { reportId: string };

    const stored = reports.listQuestionReports({ questionId: created.questions[0].id });
    expect(stored.some((item) => item.id === body.reportId && item.learnerId === FOURTH_STUDENT)).toBe(
      true,
    );
  });

  it("AI 即時生成的題目（只存在於練習快照）也可以回報，教師端仍看到題目內容", async () => {
    // 以題庫題目為藍本，模擬「只存在於練習快照」的即時生成題目（題庫沒有這個 id）
    const bankPractice = await createStudentPractice(FIFTH_STUDENT);
    const fullQuestion = questionsRepo.getQuestion(bankPractice.questions[0].id);
    if (!fullQuestion) throw new Error("測試前置條件失敗：題庫找不到題目");
    const instantQuestion = { ...fullQuestion, id: "q_instant_snapshot_test" };
    expect(questionsRepo.getQuestion(instantQuestion.id)).toBeNull();

    const practiceRepo = await import("@/server/repositories/practice");
    const session = practiceRepo.createSession({
      learnerId: FIFTH_STUDENT,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      mode: "standard",
      sourceSessionId: null,
      origin: "generated",
      questions: [instantQuestion],
      notice: null,
    });

    const result = reports.submitQuestionReport(FIFTH_STUDENT, {
      questionId: instantQuestion.id,
      sessionId: session.id,
      reason: "unclear",
      detail: "題目用語不清楚。",
    });
    expect(result.alreadyReported).toBe(false);

    const report = reports
      .listQuestionReports({ questionId: instantQuestion.id })
      .find((item) => item.id === result.reportId);
    expect(report?.inQuestionBank).toBe(false);
    expect(report?.question).toBe(instantQuestion.question);
    expect(report?.topicTitle).toContain("課題5");
    expect(report?.sectionTitle.length).toBeGreaterThan(0);

    // 題庫中的題目會標示 inQuestionBank = true（在此測試自行回報，避免依賴其他測試的資料）
    const bankReportResult = reports.submitQuestionReport(FIFTH_STUDENT, {
      questionId: bankPractice.questions[0].id,
      sessionId: bankPractice.session.id,
      reason: "unclear",
      detail: "題庫題目用語不清楚。",
    });
    const bankReport = reports
      .listQuestionReports({ questionId: bankPractice.questions[0].id })
      .find((item) => item.id === bankReportResult.reportId);
    expect(bankReport?.inQuestionBank).toBe(true);
  });
});
