/**
 * 教材節錄顯示政策測試（Sprint 6）。
 *
 * 背景：教師版教材（`*_TE.docx`）含答案及評分參考。AI 命題與匯入的題目會引用教材
 * 段落，若直接把 `sourceExcerpt` 顯示給學生，等同把未確認的教材原文（可能是答案）
 * 外洩。因此學生端的回饋**只會在來源文件已由教師／管理員確認可向學生發布時**才顯示節錄。
 *
 * 驗證：
 *   1. fail-closed：來源文件未確認時，節錄、來源位置及段落 ID 都不會回傳（`sourceWithheld`）。
 *   2. 確認發行權後同一題會顯示節錄，撤回後即時恢復不顯示（沒有快取）。
 *   3. 教師版文件中被判定為教師專用的段落（答案、評分參考）永遠不顯示。
 *   4. 引用不存在的段落時 fail-closed。
 *   5. 沒有引用教材段落的題目（作者自行撰寫的節錄）維持顯示。
 *   6. 略去節錄不影響答案、解釋、學習記錄或教師端的完整資料。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { openDocumentForStudents } from "./material-distribution";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("source-excerpt");
process.env.LLM_PROVIDER = "mock";
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_TEACHER_EMAILS = "teacher@example.com";
process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
delete process.env.ADMIN_TOKEN;
delete process.env.K_SERVICE;

type MaterialsRepo = typeof import("@/server/repositories/materials");
type PracticeRepo = typeof import("@/server/repositories/practice");
type PracticeService = typeof import("@/server/services/practice-service");
type QuestionRepository = typeof import("@/server/repositories/questions");
type QuestionService = typeof import("@/server/services/question-service");
type SessionModule = typeof import("@/server/auth/session");
type SeedModule = typeof import("@/server/seed");
type TeacherContent = typeof import("@/server/materials/teacher-content");
type Types = typeof import("@/lib/types");

let materialsRepo: MaterialsRepo;
let practiceRepo: PracticeRepo;
let practice: PracticeService;
let questionsRepo: QuestionRepository;
let questionService: QuestionService;
let session: SessionModule;
let seed: SeedModule;
let teacherContent: TeacherContent;
let types: Types;

const LEARNER = "school:s2024146@pochiu.edu.hk";

/** 教師工作階段 cookie（用於驗證教師端路由；角色由目前設定重新判定） */
function teacherCookie(): string {
  return `hk-history-session=${encodeURIComponent(
    session.encodeSession({
      email: "teacher@example.com",
      name: "測試教師",
      role: "teacher",
      learnerId: "teacher:teacher@example.com",
      pictureUrl: null,
      studentNumber: null,
      className: null,
      rosterVerified: false,
    }),
  )}`;
}

const NORMAL_TEXT = "文藝復興時期，歐洲人重視人文主義。";
const TEACHER_ONLY_TEXT = "參考答案：人文主義（每個答案各佔 1 分）";

beforeAll(async () => {
  materialsRepo = await import("@/server/repositories/materials");
  practiceRepo = await import("@/server/repositories/practice");
  practice = await import("@/server/services/practice-service");
  questionsRepo = await import("@/server/repositories/questions");
  questionService = await import("@/server/services/question-service");
  session = await import("@/server/auth/session");
  seed = await import("@/server/seed");
  teacherContent = await import("@/server/materials/teacher-content");
  types = await import("@/lib/types");
  seed.ensureBootstrap();
});

/** 建立一份教材文件及其段落，回傳文件中第一個段落的 ID */
function createSourceDocument(fileName: string, text: string, kind: "demo" | "question-bank" = "demo") {
  const document = materialsRepo.createDocument({
    fileName,
    kind,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 1024,
    status: "ready",
    topicId: "topic-5",
    sourceNote: null,
  });
  const blocks = materialsRepo.insertBlocks([
    {
      documentId: document.id,
      topicId: "topic-5",
      sectionId: "topic-5-renaissance-features",
      order: 0,
      type: "paragraph",
      level: null,
      text,
      table: null,
      sourceLocation: "測試段落 1",
    },
  ]);
  return { document, blockId: blocks[0]!.id };
}

function makeQuestion(overrides: {
  id: string;
  sourceBlockIds: string[];
  sourceExcerpt: string;
}) {
  return types.questionSchema.parse({
    id: overrides.id,
    topicId: "topic-5",
    sectionId: "topic-5-renaissance-features",
    questionType: "mc",
    difficulty: "basic",
    question: "文藝復興時期歐洲人重視甚麼思想？",
    options: ["人文主義", "重商主義", "軍國主義", "自然主義"],
    correctAnswer: "人文主義",
    acceptedAnswers: [],
    explanation: "教材指出文藝復興重視人文主義。",
    knowledgePoint: "文藝復興人文主義",
    sourceExcerpt: overrides.sourceExcerpt,
    sourceLocation: "測試教材 第 1 段",
    sourceBlockIds: overrides.sourceBlockIds,
    gradingPoints: [],
    origin: "manual",
    status: "published",
    sourceVerified: true,
    createdAt: new Date().toISOString(),
  });
}

/** 建立一次只包含指定題目的練習 */
function sessionWith(question: ReturnType<typeof makeQuestion>): string {
  const session = practiceRepo.createSession({
    learnerId: LEARNER,
    topicId: "topic-5",
    sectionIds: ["topic-5-renaissance-features"],
    questionTypes: ["mc"],
    difficulty: "basic",
    mode: "standard",
    sourceSessionId: null,
    origin: "bank",
    questions: [question],
    notice: null,
  });
  return session.id;
}

describe("教材節錄顯示政策（fail-closed）", () => {
  it("來源文件未確認可向學生發布時，節錄、來源位置及段落 ID 都不會回傳", async () => {
    const { document, blockId } = createSourceDocument("HNC2A2E_T5_SN_TE.docx", NORMAL_TEXT);
    materialsRepo.setDocumentStudentDistribution(document.id, false);

    const question = makeQuestion({
      id: "excerpt-unconfirmed",
      sourceBlockIds: [blockId],
      sourceExcerpt: NORMAL_TEXT,
    });
    const sessionId = sessionWith(question);

    const result = await practice.submitAnswer(sessionId, LEARNER, question.id, "人文主義");

    expect(result.feedback.sourceWithheld).toBe(true);
    expect(result.feedback.sourceExcerpt).toBeNull();
    expect(result.feedback.sourceLocation).toBeNull();
    expect(result.feedback.sourceBlockIds).toEqual([]);
    // 略去節錄不影響評分、答案及解釋
    expect(result.feedback.isCorrect).toBe(true);
    expect(result.feedback.correctAnswer).toBe("人文主義");
    expect(result.feedback.explanation.length).toBeGreaterThan(0);
  });

  it("片段仍然保留在伺服器端的題目快照中（教師端及重看結果不受影響）", async () => {
    const { document, blockId } = createSourceDocument("HNC2A2E_T5_SN_TE2.docx", NORMAL_TEXT);
    materialsRepo.setDocumentStudentDistribution(document.id, false);

    const question = makeQuestion({
      id: "excerpt-kept-on-server",
      sourceBlockIds: [blockId],
      sourceExcerpt: NORMAL_TEXT,
    });
    const sessionId = sessionWith(question);
    await practice.submitAnswer(sessionId, LEARNER, question.id, "重商主義");

    const snapshot = practiceRepo.getSessionQuestions(sessionId)[0];
    expect(snapshot?.sourceExcerpt).toBe(NORMAL_TEXT);
    expect(snapshot?.sourceBlockIds).toEqual([blockId]);
  });

  it("確認發行權後會顯示節錄，撤回後即時恢復不顯示（沒有快取）", async () => {
    const { document, blockId } = createSourceDocument("HNC2A2E_T5_SN_TE3.docx", NORMAL_TEXT);
    materialsRepo.setDocumentStudentDistribution(document.id, false);

    const question = makeQuestion({
      id: "excerpt-toggle",
      sourceBlockIds: [blockId],
      sourceExcerpt: NORMAL_TEXT,
    });
    const sessionId = sessionWith(question);

    const hidden = await practice.submitAnswer(sessionId, LEARNER, question.id, "人文主義");
    expect(hidden.feedback.sourceWithheld).toBe(true);

    openDocumentForStudents(materialsRepo, document.id);
    const shown = await practice.submitAnswer(sessionId, LEARNER, question.id, "人文主義");
    expect(shown.recorded).toBe(false);
    expect(shown.feedback.sourceWithheld).toBe(false);
    expect(shown.feedback.sourceExcerpt).toBe(NORMAL_TEXT);
    expect(shown.feedback.sourceLocation).toBe("測試教材 第 1 段");
    expect(shown.feedback.sourceBlockIds).toEqual([blockId]);

    materialsRepo.setDocumentStudentDistribution(document.id, false);
    const hiddenAgain = await practice.submitAnswer(sessionId, LEARNER, question.id, "人文主義");
    expect(hiddenAgain.feedback.sourceWithheld).toBe(true);
    expect(hiddenAgain.feedback.sourceExcerpt).toBeNull();
  });

  it("教師專用段落（答案／評分參考）即使在已確認的文件中也不會顯示", async () => {
    expect(teacherContent.isTeacherOnlyBlockText(TEACHER_ONLY_TEXT)).toBe(true);
    expect(teacherContent.isTeacherOnlyBlockText(NORMAL_TEXT)).toBe(false);

    const { document, blockId } = createSourceDocument("HNC2A2E_T5_SN_TE4.docx", TEACHER_ONLY_TEXT);
    openDocumentForStudents(materialsRepo, document.id);

    const question = makeQuestion({
      id: "excerpt-teacher-only",
      sourceBlockIds: [blockId],
      sourceExcerpt: TEACHER_ONLY_TEXT,
    });
    const sessionId = sessionWith(question);

    const result = await practice.submitAnswer(sessionId, LEARNER, question.id, "人文主義");
    expect(result.feedback.sourceWithheld).toBe(true);
    expect(result.feedback.sourceExcerpt).toBeNull();
  });

  it("同一題只要有一段引用屬教師專用，整段節錄都不會顯示", async () => {
    const { document, blockId } = createSourceDocument("HNC2A2E_T5_SN_TE5.docx", NORMAL_TEXT);
    const second = materialsRepo.insertBlocks([
      {
        documentId: document.id,
        topicId: "topic-5",
        sectionId: "topic-5-renaissance-features",
        order: 1,
        type: "paragraph",
        level: null,
        text: TEACHER_ONLY_TEXT,
        table: null,
        sourceLocation: "測試段落 2",
      },
    ])[0]!;
    openDocumentForStudents(materialsRepo, document.id);

    const question = makeQuestion({
      id: "excerpt-mixed-blocks",
      sourceBlockIds: [blockId, second.id],
      sourceExcerpt: NORMAL_TEXT,
    });
    const sessionId = sessionWith(question);

    const result = await practice.submitAnswer(sessionId, LEARNER, question.id, "人文主義");
    expect(result.feedback.sourceWithheld).toBe(true);
    expect(result.feedback.sourceBlockIds).toEqual([]);
  });

  it("引用不存在的教材段落時 fail-closed", async () => {
    const question = makeQuestion({
      id: "excerpt-missing-block",
      sourceBlockIds: ["block-does-not-exist"],
      sourceExcerpt: NORMAL_TEXT,
    });
    const sessionId = sessionWith(question);

    const result = await practice.submitAnswer(sessionId, LEARNER, question.id, "人文主義");
    expect(result.feedback.sourceWithheld).toBe(true);
    expect(result.feedback.sourceExcerpt).toBeNull();
  });

  it("來自試題檔（question-bank）的段落永遠不會當作學生可讀來源", async () => {
    const { document, blockId } = createSourceDocument(
      "2023_F3_History_Paper.docx",
      NORMAL_TEXT,
      "question-bank",
    );
    openDocumentForStudents(materialsRepo, document.id);

    const question = makeQuestion({
      id: "excerpt-question-bank-doc",
      sourceBlockIds: [blockId],
      sourceExcerpt: NORMAL_TEXT,
    });
    const sessionId = sessionWith(question);

    const result = await practice.submitAnswer(sessionId, LEARNER, question.id, "人文主義");
    expect(result.feedback.sourceWithheld).toBe(true);
  });

  it("沒有引用教材段落的題目（作者自行撰寫的節錄）維持顯示", async () => {
    const question = makeQuestion({
      id: "excerpt-authored",
      sourceBlockIds: [],
      sourceExcerpt: "示範題庫的作者標註：文藝復興重視人文主義。",
    });
    const sessionId = sessionWith(question);

    const result = await practice.submitAnswer(sessionId, LEARNER, question.id, "人文主義");
    expect(result.feedback.sourceWithheld).toBe(false);
    expect(result.feedback.sourceExcerpt).toBe("示範題庫的作者標註：文藝復興重視人文主義。");
  });
});

/**
 * 教師端必須看到「學生其實看不到節錄」及其原因（Sprint 7.2）。
 * 判定與學生端共用同一個模組（source-visibility.ts），因此不會出現兩套標準：
 * 若這裡顯示可見，學生端一定看得到。
 */
describe("教師端節錄可見性提示（與學生端同一判定）", () => {
  it("未確認教材的題目：狀態帶有隱藏原因，且與學生端一致", async () => {
    const { document, blockId } = createSourceDocument("HNC2A2E_T5_SN_TE6.docx", NORMAL_TEXT);
    materialsRepo.setDocumentStudentDistribution(document.id, false);
    const question = makeQuestion({
      id: "review-hidden-unconfirmed",
      sourceBlockIds: [blockId],
      sourceExcerpt: NORMAL_TEXT,
    });
    questionsRepo.insertQuestion(question);

    const [status] = questionService.questionReviewStatuses([question]);
    expect(status?.sourceExcerptHiddenFromStudents).toBe(true);
    expect(status?.sourceExcerptHiddenReason).toBe("unconfirmed-material");
    // 學生端的實際結果必須相同
    expect(practice.sourceExcerptIsStudentVisible(question)).toBe(false);

    // 確認發行權後，教師端提示消失
    openDocumentForStudents(materialsRepo, document.id);
    const [afterOpen] = questionService.questionReviewStatuses([question]);
    expect(afterOpen?.sourceExcerptHiddenFromStudents).toBe(false);
    expect(afterOpen?.sourceExcerptHiddenReason).toBeNull();
    expect(practice.sourceExcerptIsStudentVisible(question)).toBe(true);
  });

  it("引用已不存在的段落：原因為 missing-source-blocks（教師需重新核對依據）", () => {
    const question = makeQuestion({
      id: "review-hidden-missing",
      sourceBlockIds: ["block-vanished"],
      sourceExcerpt: NORMAL_TEXT,
    });
    const [status] = questionService.questionReviewStatuses([question]);
    expect(status?.sourceExcerptHiddenFromStudents).toBe(true);
    expect(status?.sourceExcerptHiddenReason).toBe("missing-source-blocks");
  });

  it("教師專用段落：原因為 teacher-edition", () => {
    const { document, blockId } = createSourceDocument("HNC2A2E_T5_SN_TE7.docx", TEACHER_ONLY_TEXT);
    openDocumentForStudents(materialsRepo, document.id);
    const question = makeQuestion({
      id: "review-hidden-teacher-edition",
      sourceBlockIds: [blockId],
      sourceExcerpt: TEACHER_ONLY_TEXT,
    });
    const [status] = questionService.questionReviewStatuses([question]);
    expect(status?.sourceExcerptHiddenFromStudents).toBe(true);
    expect(status?.sourceExcerptHiddenReason).toBe("teacher-edition");
  });

  it("教師端 API 會回傳提示，而學生端題目物件不包含任何節錄欄位", async () => {
    const { document, blockId } = createSourceDocument("HNC2A2E_T5_SN_TE8.docx", NORMAL_TEXT);
    materialsRepo.setDocumentStudentDistribution(document.id, false);
    const question = makeQuestion({
      id: "review-hidden-route",
      sourceBlockIds: [blockId],
      sourceExcerpt: NORMAL_TEXT,
    });
    questionsRepo.insertQuestion(question);

    const { GET } = await import("@/app/api/teacher/questions/route");
    const response = await GET(
      new Request(
        `http://localhost:3000/api/teacher/questions?topicId=topic-5&sectionId=topic-5-renaissance-features&status=published`,
        { headers: { cookie: teacherCookie() } },
      ),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      questions: Record<string, unknown>[];
      reviews: { questionId: string; sourceExcerptHiddenFromStudents: boolean }[];
    };
    const review = payload.reviews.find((item) => item.questionId === question.id);
    expect(review?.sourceExcerptHiddenFromStudents).toBe(true);
    // 學生端：題目物件根本沒有節錄欄位（不只是隱藏）
    const studentQuestion = types.studentQuestionSchema.parse(question);
    expect("sourceExcerpt" in studentQuestion).toBe(false);
    expect("sourceLocation" in studentQuestion).toBe(false);
  });
});
