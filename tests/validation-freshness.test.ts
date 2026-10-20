/**
 * Sprint 7.8 發行前審計：自動驗證的新鮮度、發布安全、作答完整性及 migration 相容性。
 *
 * 驗證的契約（全部以實際行為測試，不只是欄位存在）：
 *   1. 自動驗證紀錄綁定**版本 + 內容指紋**；題幹／選項／答案／解釋／教材依據任一改動即失效，
 *      失效後不可發布（409）。
 *   2. 舊資料（migration 0019 之前）或對應舊版本的紀錄不可授權發布。
 *   3. 撤回（withdrawn）後不能再發布，重新驗證**不會**自動令題目復活。
 *   4. 作答記錄版本用於標示「以舊版批改」的作答，而且歷史作答不會被任何流程改寫
 *      （包括學生回報、教師下架、重新驗證）。
 *   5. 舊列（report／attempt／question 沒有新欄位）在 migration 0019 之後仍可讀取及查詢。
 */
import { beforeAll, describe, expect, it } from "vitest";

import type { Question } from "@/lib/types";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("release-audit");
process.env.LLM_PROVIDER = "mock";
delete process.env.K_SERVICE;

type Connection = typeof import("@/server/db/connection");
type QuestionService = typeof import("@/server/services/question-service");
type QuestionRepo = typeof import("@/server/repositories/questions");
type PracticeRepo = typeof import("@/server/repositories/practice");
type ReportsRepo = typeof import("@/server/repositories/reports");
type ReportService = typeof import("@/server/services/question-report-service");
type PracticeService = typeof import("@/server/services/practice-service");
type MaterialService = typeof import("@/server/services/material-service");
type Seed = typeof import("@/server/seed");

let getDb: Connection["getDb"];
let questions: QuestionService;
let questionsRepo: QuestionRepo;
let practiceRepo: PracticeRepo;
let reportsRepo: ReportsRepo;
let reportService: ReportService;
let practice: PracticeService;
let materialService: MaterialService;
let seed: Seed;

const SECTION = "topic-5-industrial";
const LEARNER = "audit-learner";

function toInput(question: ReturnType<QuestionRepo["getQuestion"]>) {
  const stored = question!;
  return {
    topicId: stored.topicId,
    sectionId: stored.sectionId,
    questionType: stored.questionType,
    difficulty: stored.difficulty,
    question: stored.question,
    options: stored.options,
    correctAnswer: stored.correctAnswer,
    acceptedAnswers: stored.acceptedAnswers,
    explanation: stored.explanation,
    knowledgePoint: stored.knowledgePoint,
    sourceExcerpt: stored.sourceExcerpt,
    sourceLocation: stored.sourceLocation,
    sourceBlockIds: stored.sourceBlockIds,
    gradingPoints: stored.gradingPoints,
    qualityWarnings: stored.qualityWarnings,
    skill: stored.skill,
    origin: stored.origin,
    status: "draft" as const,
  };
}

/** 生成一條已自動驗證並發布的題目 */
async function createValidatedQuestion(): Promise<string> {
  const generated = await questions.generateQuestions({
    topicId: "topic-5",
    sectionIds: [SECTION],
    questionTypes: ["mc"],
    difficulty: "basic",
    questionCount: 1,
    persist: true,
    allowBankDuplicates: true,
    requestType: "question-bank",
  });
  const created = generated.questions[0];
  expect(created.autoValidatedAt).not.toBeNull();
  expect(created.status).toBe("published");
  return created.id;
}

beforeAll(async () => {
  const connection = await import("@/server/db/connection");
  getDb = connection.getDb;
  questions = await import("@/server/services/question-service");
  questionsRepo = await import("@/server/repositories/questions");
  practiceRepo = await import("@/server/repositories/practice");
  reportsRepo = await import("@/server/repositories/reports");
  reportService = await import("@/server/services/question-report-service");
  practice = await import("@/server/services/practice-service");
  materialService = await import("@/server/services/material-service");
  seed = await import("@/server/seed");
  seed.ensureBootstrap();
  const imported = await materialService.importPilotMaterialFromDisk({ runOcr: false });
  if (!imported) throw new Error("找不到課題5的教材檔案");
});

describe("自動驗證必須對應目前的版本與內容", () => {
  it("驗證紀錄包含版本及指紋，且與題目現況一致", async () => {
    const questionId = await createValidatedQuestion();
    const stored = questionsRepo.getQuestion(questionId)!;

    expect(stored.autoValidatedRevision).toBe(stored.revision);
    expect(stored.autoValidatedFingerprint).toBe(questions.questionFingerprint(stored));
    expect(questions.autoValidationIsCurrent(stored)).toBe(true);
    expect(questions.isStudentPracticeEligible(stored)).toBe(true);
  });

  it("改動題幹、選項、答案或解釋都會令驗證失效，失效後不可發布（409）", async () => {
    const mutations: { label: string; apply: (question: Question) => Question }[] = [
      { label: "題幹", apply: (q) => ({ ...q, question: `${q.question}（補充字眼）` }) },
      { label: "選項", apply: (q) => ({ ...q, options: [...q.options].reverse() }) },
      { label: "答案", apply: (q) => ({ ...q, correctAnswer: q.options[1] }) },
      { label: "解釋", apply: (q) => ({ ...q, explanation: `${q.explanation} 補充說明。` }) },
      {
        label: "教材依據",
        apply: (q) => ({ ...q, sourceExcerpt: `${q.sourceExcerpt.slice(0, 8)}（改）` }),
      },
    ];

    for (const mutation of mutations) {
      const questionId = await createValidatedQuestion();
      const current = questionsRepo.getQuestion(questionId)!;
      const changed = questions.updateManualQuestion(questionId, toInput(mutation.apply(current)));

      // 內容改變 → 版本遞增、狀態回到草稿、舊的自動驗證不再適用
      expect(changed.question.revision, mutation.label).toBeGreaterThan(current.revision);
      expect(changed.question.status, mutation.label).toBe("draft");
      expect(questions.autoValidationIsCurrent(changed.question), mutation.label).toBe(false);

      // 沒有覆核、亦沒有對應目前版本的自動驗證 → 不可發布
      expect(() => questions.changeQuestionStatus(questionId, "published"), mutation.label).toThrowError(
        /無法發布/,
      );
      expect(questionsRepo.getQuestion(questionId)?.status, mutation.label).toBe("draft");
    }
  });

  it("舊資料（沒有自動驗證欄位）不可發布；指向舊版本的紀錄亦不可發布", async () => {
    // 模擬 migration 0019 之前的列：三個新欄位為 NULL
    const legacyId = "audit-legacy-question";
    const template = questionsRepo.listQuestions({ topicId: "topic-5" })[0];
    getDb()
      .prepare(
        `INSERT INTO questions
          (id, topic_id, section_id, question_type, difficulty, question, options_json, correct_answer,
           accepted_answers_json, explanation, knowledge_point, source_excerpt, source_location,
           source_block_ids_json, grading_points_json, origin, status, source_verified,
           quality_warnings_json, skill, revision, created_at)
         VALUES (?, ?, ?, 'mc', 'basic', ?, ?, ?, '[]', ?, ?, ?, ?, ?, '[]', 'material-ai', 'draft', 1,
                 '[]', NULL, 1, ?)`,
      )
      .run(
        legacyId,
        template.topicId,
        template.sectionId,
        "舊資料題目：文藝復興的核心思想是甚麼？",
        JSON.stringify(["人文主義", "重商主義", "軍國主義", "封建主義"]),
        "人文主義",
        "教材指出文藝復興重視人文主義。",
        template.knowledgePoint,
        template.sourceExcerpt,
        template.sourceLocation,
        JSON.stringify(template.sourceBlockIds),
        new Date().toISOString(),
      );

    const legacy = questionsRepo.getQuestion(legacyId)!;
    expect(legacy.autoValidatedAt).toBeNull();
    expect(legacy.autoValidatedRevision).toBeNull();
    expect(legacy.autoValidatedFingerprint).toBeNull();
    expect(questions.autoValidationIsCurrent(legacy)).toBe(false);
    expect(() => questions.changeQuestionStatus(legacyId, "published")).toThrowError(/無法發布/);

    // 指向舊版本的自動驗證紀錄（版本已經不同）同樣不可發布
    const questionId = await createValidatedQuestion();
    const stored = questionsRepo.getQuestion(questionId)!;
    // 先記錄一次驗證，再把題目改動（版本 +1），令紀錄停留在舊版本
    questions.updateManualQuestion(questionId, toInput({ ...stored, explanation: "（第二版解釋）" }));
    questionsRepo.recordQuestionAutoValidation({
      questionId,
      revision: stored.revision,
      fingerprint: questions.questionFingerprint(stored),
      validatedAt: new Date().toISOString(),
    });
    const stale = questionsRepo.getQuestion(questionId)!;
    expect(stale.revision).toBeGreaterThan(stored.revision);
    expect(questions.autoValidationIsCurrent(stale)).toBe(false);
    expect(() => questions.changeQuestionStatus(questionId, "published")).toThrowError(/無法發布/);
  });

  it("題目撤回後，重新驗證不會自動令它回復發布（需要明確的發布動作）", async () => {
    const questionId = await createValidatedQuestion();
    questions.changeQuestionStatus(questionId, "disabled");
    expect(questionsRepo.getQuestion(questionId)?.status).toBe("disabled");

    const result = questions.revalidateQuestion(questionId);

    expect(result.autoValidated).toBe(true);
    // 重新驗證只記錄結果，不會自行發布；撤回狀態保持
    expect(questionsRepo.getQuestion(questionId)?.status).toBe("disabled");
    expect(questions.isStudentPracticeEligible(questionsRepo.getQuestion(questionId)!)).toBe(false);

    // 教師明確發布後才回復可用
    questions.changeQuestionStatus(questionId, "published");
    expect(questions.isStudentPracticeEligible(questionsRepo.getQuestion(questionId)!)).toBe(true);
  });
});

describe("作答與批改的完整性", () => {
  it("回報、下架及重新驗證都不會改寫學生的歷史作答", async () => {
    const questionId = await createValidatedQuestion();
    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 20,
      mode: "standard",
      questionSource: "bank",
      sourceSessionId: null,
    });
    await practice.submitAnswer(assembled.session.id, LEARNER, questionId, "（刻意的錯誤答案）");
    const attemptBefore = practiceRepo.getAttempt(assembled.session.id, questionId)!;
    expect(attemptBefore.questionRevision).toBe(questionsRepo.getQuestion(questionId)!.revision);

    const report = reportService.submitQuestionReport(LEARNER, {
      questionId,
      sessionId: assembled.session.id,
      attemptId: attemptBefore.id,
      reason: "answer-disputed",
      detail: "答案有爭議",
    });
    reportService.withdrawQuestionFromReport(report.reportId, "teacher@example.com");
    questions.revalidateQuestion(questionId);

    const attemptAfter = practiceRepo.getAttempt(assembled.session.id, questionId)!;
    expect(attemptAfter).toEqual(attemptBefore);
    expect(attemptAfter.answer).toBe("（刻意的錯誤答案）");
    expect(attemptAfter.isCorrect).toBe(false);
  });

  it("撤回只影響新練習：學生自己那次練習的凍結試卷仍可作答（既有設計）", async () => {
    const questionId = await createValidatedQuestion();
    const assembled = await practice.createPractice({
      learnerId: `${LEARNER}-frozen`,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 20,
      mode: "standard",
      questionSource: "bank",
      sourceSessionId: null,
    });
    expect(assembled.questions.map((question) => question.id)).toContain(questionId);
    await practice.submitAnswer(assembled.session.id, `${LEARNER}-frozen`, questionId, "錯的答案");

    questions.changeQuestionStatus(questionId, "disabled");

    // 新的題庫練習不會再包含這條題目
    const next = await practice.createPractice({
      learnerId: `${LEARNER}-frozen`,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 20,
      mode: "standard",
      questionSource: "bank",
      sourceSessionId: null,
    });
    expect(next.questions.map((question) => question.id)).not.toContain(questionId);

    // 但該次既有練習的快照（學生當時看到的試卷）仍然可以查看及重做錯題：
    // 這是刻意的——凍結快照是學生當時的試卷，撤回不會追溯改寫歷史。
    const retry = await practice.createPractice({
      learnerId: `${LEARNER}-frozen`,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 20,
      mode: "wrong-only",
      questionSource: "bank",
      sourceSessionId: assembled.session.id,
    });
    expect(retry.questions.map((question) => question.id)).toContain(questionId);
  });

  it("舊版作答的標示以版本比較為準，且不會因重新驗證而改變", async () => {
    const questionId = await createValidatedQuestion();
    const assembled = await practice.createPractice({
      learnerId: `${LEARNER}-drift`,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 20,
      mode: "standard",
      questionSource: "bank",
      sourceSessionId: null,
    });
    await practice.submitAnswer(assembled.session.id, `${LEARNER}-drift`, questionId, "人文主義");
    expect(questions.teacherQuestionView(questionsRepo.getQuestion(questionId)!).staleAttempts).toBe(0);

    const current = questionsRepo.getQuestion(questionId)!;
    questions.updateManualQuestion(questionId, toInput({ ...current, explanation: "修正後的解釋。" }));

    expect(questions.teacherQuestionView(questionsRepo.getQuestion(questionId)!).staleAttempts).toBe(1);
    // 重新驗證只影響發布狀態，不會改變「這筆作答是按舊版批改」的事實
    questions.revalidateQuestion(questionId);
    expect(questions.teacherQuestionView(questionsRepo.getQuestion(questionId)!).staleAttempts).toBe(1);
  });
});

describe("Migration 0019 的向後相容", () => {  it("舊的回報列（沒有版本／指紋）仍可讀取、列出及重複檢查", () => {
    const legacyReportId = "audit-legacy-report";
    getDb()
      .prepare(
        `INSERT INTO question_reports
          (id, question_id, session_id, learner_id, topic_id, reason, detail, status, created_at)
         VALUES (?, 'audit-legacy-question', NULL, ?, 'topic-5', 'other', '', 'open', ?)`,
      )
      .run(legacyReportId, LEARNER, new Date().toISOString());

    const report = reportsRepo.getReport(legacyReportId)!;
    expect(report.questionRevision).toBeNull();
    expect(report.questionFingerprint).toBeNull();
    expect(report.attemptId).toBeNull();
    expect(report.resolutionAction).toBeNull();

    // 教師端清單仍可顯示（版本未知時不誤報「版本已改變」）
    const listed = reportService.listQuestionReports({ questionId: "audit-legacy-question" });
    expect(listed.some((item) => item.id === legacyReportId)).toBe(true);
    expect(listed.find((item) => item.id === legacyReportId)!.revisionChanged).toBe(false);

    // 舊列的「未處理」狀態仍會阻止同一學生重複回報
    expect(reportsRepo.hasOpenReport("audit-legacy-question", LEARNER, 1)).toBe(true);
  });

  it("舊的作答列（沒有版本）不會被當成舊版作答", async () => {
    // attempts 有指向練習記錄的外鍵，因此先建立一次真實練習
    const legacySession = practiceRepo.createSession({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["mc"],
      difficulty: "basic",
      mode: "standard",
      sourceSessionId: null,
      origin: "bank",
      questions: [],
      notice: null,
    });
    getDb()
      .prepare(
        `INSERT INTO attempts
          (id, session_id, question_id, learner_id, answer, auto_graded, is_correct, answered_at)
         VALUES (?, ?, 'audit-legacy-question', ?, '人文主義', 1, 1, ?)`,
      )
      .run("audit-legacy-attempt", legacySession.id, LEARNER, new Date().toISOString());

    const attempt = practiceRepo.getAttemptById("audit-legacy-attempt")!;
    expect(attempt.questionRevision).toBeNull();

    // 沒有版本資料 → 不計入 staleAttempts（不確定的事情不當成確定）
    const drift = practiceRepo.countQuestionRevisionDrift("audit-legacy-question", 2);
    expect(drift.staleAttempts).toBe(0);
    expect(drift.totalAttempts).toBe(1);
  });
});
