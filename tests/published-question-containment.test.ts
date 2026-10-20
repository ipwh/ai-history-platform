/**
 * 已發布題目的風險與下架機制（Sprint 8.8 第一階段）。
 *
 * 這一組測試以合成教材重建 Sprint 8.6 重算判 `reject` 的兩條題目，鎖定三件事：
 *   1. 閘門的判定是**可重現**的：時間線標示 mc 題（題幹問「詞語」而答案是年份）
 *      會被 `stem-answer-type-mismatch` 擋下；填充題的答案出現在題幹會被 `answer-in-stem` 擋下。
 *   2. 下架是**即時生效**且可稽核的：`changeQuestionStatus(id, 'disabled')` 令題目即時
 *      離開學生題庫查詢，但教師仍可讀取內容，亦沒有刪除任何資料。
 *   3. 下架後**不可**靜默重新發布：沒有對應目前版本的驗證紀錄時一律 409。
 *
 * 這些測試只使用測試資料庫，不會接觸 `data/app.db`，亦不改動任何真實題目。
 */
import { beforeAll, describe, expect, it } from "vitest";

import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("published-containment");
process.env.LLM_PROVIDER = "mock";
delete process.env.K_SERVICE;

type MaterialsRepo = typeof import("@/server/repositories/materials");
type QuestionRepo = typeof import("@/server/repositories/questions");
type QuestionService = typeof import("@/server/services/question-service");
type Seed = typeof import("@/server/seed");
type Quality = typeof import("@/server/llm/question-quality");

let materialsRepo: MaterialsRepo;
let questions: QuestionRepo;
let questionService: QuestionService;
let seed: Seed;
let quality: Quality;

const TOPIC = "topic-12";
const SECTION = "topic-12-post-war-economy";

/** 與真實引用段落同形的時間線清單（合成文字，不是課本原文） */
const LIST_TEXT = [
  "經濟發展",
  "有利的內外因素促進經濟發展",
  "社會發展",
  "房屋方面：公營房屋的持續發展",
  "教育方面：免費教育與專上教育的發展",
  "管治與政制發展",
  "1960年代起：加強官民溝通",
  "1970年代起：打擊貪污與公務員本地化",
  "1980年代起：發展代議政制",
].join("\n");

let blockId = "";
let sectionTitle = "";

beforeAll(async () => {
  materialsRepo = await import("@/server/repositories/materials");
  questions = await import("@/server/repositories/questions");
  questionService = await import("@/server/services/question-service");
  seed = await import("@/server/seed");
  quality = await import("@/server/llm/question-quality");

  seed.ensureBootstrap();

  const topics = questions.listQuestions({}).length;
  void topics;

  const document = materialsRepo.createDocument({
    fileName: "合成教材（時間線清單）.docx",
    kind: "demo",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 1024,
    status: "ready",
    topicId: TOPIC,
    sourceNote: "Sprint 8.8 合成測試教材",
  });
  const [block] = materialsRepo.insertBlocks([
    {
      documentId: document.id,
      topicId: TOPIC,
      sectionId: SECTION,
      order: 0,
      type: "list",
      level: null,
      text: LIST_TEXT,
      table: null,
      sourceLocation: "合成教材（時間線清單）.docx · 第 1 段（清單）",
    },
  ]);
  blockId = block!.id;
  sectionTitle = document.fileName;
});

function units() {
  return [
    {
      blockId,
      sourceLocation: `${sectionTitle} · 第 1 段（清單）`,
      text: LIST_TEXT,
    },
  ];
}

/** 重建 q_058eda0378394d0f：時間線標示的選擇題 */
function insertTimelineQuestion(options: { id: string; status: "published" | "draft" }) {
  return questions.insertQuestion({
    id: options.id,
    topicId: TOPIC,
    sectionId: SECTION,
    questionType: "mc",
    difficulty: "basic",
    question: "「打擊貪污與公務員本地化」是指以下哪一個詞語？",
    options: ["1970年代起", "房屋方面", "教育方面", "1960年代起"],
    correctAnswer: "1970年代起",
    acceptedAnswers: [],
    explanation: "教材原文：1970年代起：打擊貪污與公務員本地化",
    knowledgePoint: "戰後香港的蛻變：經濟發展：1970年代起",
    sourceExcerpt: "1970年代起：打擊貪污與公務員本地化",
    sourceLocation: `${sectionTitle} · 第 1 段（清單）`,
    sourceBlockIds: [blockId],
    gradingPoints: [],
    origin: "material-mock",
    status: options.status,
    sourceVerified: true,
    qualityWarnings: [],
    skill: null,
    revision: 1,
    autoValidatedAt: null,
    autoValidatedRevision: null,
    autoValidatedFingerprint: null,
    teacherConfirmationRequired: false,
    createdAt: "2026-10-10T08:19:44.783Z",
  });
}

/** 重建 q_062fdfd516314f3d：答案出現在題幹的填充題 */
function insertAnswerInStemQuestion(id = "q-containment-answer-in-stem") {
  return questions.insertQuestion({
    id,
    topicId: "topic-5",
    sectionId: "topic-5-renaissance-reformation",
    questionType: "fill",
    difficulty: "basic",
    question:
      "文藝復興時期，歐洲人重視人文主義，不再凡事以神為本，這種思想強調以人為中心，重視彰顯人性、人類的價值，以及理解自然的能力，稱為＿＿＿＿＿＿。",
    options: [],
    correctAnswer: "人文主義",
    acceptedAnswers: [],
    explanation: "文藝復興時期歐洲人重視人文主義，強調以人為中心，彰顯人性及理解自然的能力。",
    knowledgePoint: "人文主義是文藝復興時期的重要思想",
    sourceExcerpt: "歐洲人重視人文主義，不再凡事以神為本。",
    sourceLocation: "合成教材 · 第 1 段（清單）",
    sourceBlockIds: [blockId],
    gradingPoints: ["答案須為人文主義，不可填寫其他主義或思想。"],
    origin: "material-ai",
    status: "draft",
    sourceVerified: false,
    qualityWarnings: [],
    skill: "正確地使用歷史辭彙",
    revision: 1,
    autoValidatedAt: null,
    autoValidatedRevision: null,
    autoValidatedFingerprint: null,
    teacherConfirmationRequired: false,
    createdAt: "2026-10-15T08:48:22.170Z",
  });
}

describe("閘門判定可重現（時間線標示題被判 reject，不是隨機結果）", () => {
  it("題幹問「詞語」而答案是年份／時期 → stem-answer-type-mismatch（blocking → reject）", () => {
    const question = insertTimelineQuestion({ id: "q-containment-timeline", status: "draft" });
    const result = quality.checkQuestionQuality(
      {
        questionType: question.questionType,
        question: question.question,
        options: question.options,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        sourceExcerpt: question.sourceExcerpt,
        sourceBlockIds: question.sourceBlockIds,
        gradingPoints: question.gradingPoints,
      },
      units(),
    );
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("stem-answer-type-mismatch");
    expect(result.outcome).toBe("reject");
    const issue = result.issues.find((entry) => entry.code === "stem-answer-type-mismatch");
    expect(issue?.severity).toBe("blocking");
    expect(issue?.message).toContain("1970年代起");
  });

  it("填充題的標準答案出現在題幹 → answer-in-stem（blocking → reject）", () => {
    const question = insertAnswerInStemQuestion();
    const result = quality.checkQuestionQuality(
      {
        questionType: question.questionType,
        question: question.question,
        options: question.options,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        sourceExcerpt: question.sourceExcerpt,
        sourceBlockIds: question.sourceBlockIds,
        gradingPoints: question.gradingPoints,
      },
      units(),
    );
    expect(result.issues.map((issue) => issue.code)).toContain("answer-in-stem");
    expect(result.outcome).toBe("reject");
  });
});

describe("下架機制：即時、可稽核、不刪除內容", () => {
  it("disabled 會令題目即時離開學生題庫，但教師仍可讀取", () => {
    const question = insertTimelineQuestion({
      id: "q-containment-withdraw",
      status: "published",
    });
    const visibleBefore = questions
      .listQuestions({ topicId: TOPIC, sectionIds: [SECTION], statuses: ["published"] })
      .map((item) => item.id);
    expect(visibleBefore).toContain(question.id);

    const view = questionService.changeQuestionStatus(question.id, "disabled");
    expect(view.question.status).toBe("disabled");

    const visibleAfter = questions
      .listQuestions({ topicId: TOPIC, sectionIds: [SECTION], statuses: ["published"] })
      .map((item) => item.id);
    expect(visibleAfter).not.toContain(question.id);

    const stored = questions.getQuestion(question.id)!;
    expect(stored.question).toBe(question.question);
    expect(stored.correctAnswer).toBe(question.correctAnswer);
    expect(stored.explanation).toBe(question.explanation);
    expect(questionService.isStudentPracticeEligible(stored)).toBe(false);
    expect(questions.listQuestionReviews(question.id)).toHaveLength(0);
  });

  it("下架後不可靜默重新發布：沒有目前版本的驗證紀錄即 409", () => {
    const question = insertTimelineQuestion({
      id: "q-containment-republish",
      status: "published",
    });
    questionService.changeQuestionStatus(question.id, "disabled");
    expect(() => questionService.changeQuestionStatus(question.id, "published")).toThrowError(
      /無法發布/,
    );
    expect(questions.getQuestion(question.id)!.status).toBe("disabled");
  });

  it("草稿的答案是題幹文字（answer-in-stem）時，直接發布亦被拒絕", () => {
    const question = insertAnswerInStemQuestion("q-containment-answer-in-stem-publish");
    expect(() => questionService.changeQuestionStatus(question.id, "published")).toThrowError(
      /無法發布/,
    );
    expect(questions.getQuestion(question.id)!.status).toBe("draft");
  });

  it("教師覆核（帶版本）是解除下架並重新發布的唯一途徑", () => {
    const question = insertTimelineQuestion({
      id: "q-containment-review-then-publish",
      status: "published",
    });
    questionService.changeQuestionStatus(question.id, "disabled");
    const before = questions.getQuestion(question.id)!;

    questionService.recordQuestionReview({
      questionId: question.id,
      decision: "approved",
      reason: "合成測試：內容已由教師核對",
      expectedRevision: before.revision,
      actor: { email: "teacher@example.com", role: "teacher" },
    });

    const after = questions.getQuestion(question.id)!;
    expect(after.status).toBe("published");
    expect(after.teacherConfirmationRequired).toBe(false);
    const reviews = questions.listQuestionReviews(question.id);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.reason).toBe("合成測試：內容已由教師核對");
  });
});
