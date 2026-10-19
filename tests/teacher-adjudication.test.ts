/**
 * 教師裁決與發布完整性（Sprint：History Teacher Adjudication & Release Integrity Gate）。
 *
 * 固定以下契約：
 *   1. 批次覆核／批次發布不可處理帶「待教師確認」標記的題目；
 *   2. 即使同一版留有較早的核准紀錄，標記未清除前不可只切換狀態就發布；
 *   3. 教師在疑問出現之後的重新確認，會留下帶新時間戳的獨立紀錄（不會被舊紀錄吞掉）；
 *   4. 覆核只對當時的版本有效（版本一改即失效，過期版本不可覆核）；
 *   5. 重做錯題（wrong-only）只可派出現行仍已發布、未隔離及可作答的題庫題目；
 *   6. 裁決套件本身不含任何已作出的決定（不得假造教師裁決）。
 */
import fs from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { questionSchema, type Question } from "@/lib/types";

import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("teacher-adjudication");
process.env.LLM_PROVIDER = "mock";
delete process.env.K_SERVICE;

const LEARNER = "teacher-adjudication-learner";
const TOPIC = "topic-5";
const SECTION = "topic-5-renaissance-features";

function buildQuestion(overrides: Partial<Question> & { id: string }): Question {
  return questionSchema.parse({
    topicId: TOPIC,
    sectionId: SECTION,
    questionType: "fill",
    difficulty: "basic",
    question: "文藝復興首先在＿＿＿興起。",
    options: [],
    correctAnswer: "意大利",
    acceptedAnswers: [],
    explanation: "測試用解釋。",
    knowledgePoint: "測試知識點",
    sourceExcerpt: "文藝復興首先在意大利興起。",
    sourceLocation: "測試 · 第 1 題",
    origin: "school-paper",
    status: "draft",
    sourceVerified: false,
    createdAt: "2026-10-19T00:00:00.000Z",
    ...overrides,
  });
}

describe("教師裁決與發布完整性", () => {
  type QuestionsRepo = typeof import("@/server/repositories/questions");
  type QuestionService = typeof import("@/server/services/question-service");
  type PracticeService = typeof import("@/server/services/practice-service");

  let repo: QuestionsRepo;
  let service: QuestionService;
  let practice: PracticeService;

  beforeAll(async () => {
    repo = await import("@/server/repositories/questions");
    service = await import("@/server/services/question-service");
    practice = await import("@/server/services/practice-service");
    const seed = await import("@/server/seed");
    seed.ensureBootstrap();
  });

  it("批次覆核候選會排除待教師確認的題目", () => {
    repo.insertQuestion(
      buildQuestion({ id: "q-adj-approvable", status: "draft", teacherConfirmationRequired: false }),
    );
    repo.insertQuestion(
      buildQuestion({ id: "q-adj-held", status: "published", teacherConfirmationRequired: true }),
    );

    const { approvable, held } = service.listOwnerApprovalCandidates({ topicId: TOPIC });
    expect(held.map((question) => question.id)).toContain("q-adj-held");
    expect(approvable.map((question) => question.id)).not.toContain("q-adj-held");
    expect(approvable.map((question) => question.id)).toContain("q-adj-approvable");
  });

  it("待教師確認的題目即使留有較早的核准紀錄，也不可只切換狀態發布", () => {
    repo.insertQuestion(buildQuestion({ id: "q-adj-status-gate" }));
    service.recordQuestionReview({
      questionId: "q-adj-status-gate",
      decision: "approved",
      expectedRevision: 1,
      actor: { email: "teacher@school.edu.hk", role: "teacher" },
    });
    expect(repo.getQuestion("q-adj-status-gate")?.status).toBe("published");

    // 模擬之後才出現的疑問（例如自動修復或匯入正規化改變了被考核的答案）
    repo.setTeacherConfirmationRequired("q-adj-status-gate", true);

    expect(() => service.changeQuestionStatus("q-adj-status-gate", "published")).toThrow(
      /待教師確認/,
    );
  });

  it("疑問出現後的重新確認會留下一筆帶新時間戳的紀錄", () => {
    repo.insertQuestion(buildQuestion({ id: "q-adj-reconfirm" }));
    const first = service.recordQuestionReview({
      questionId: "q-adj-reconfirm",
      decision: "approved",
      expectedRevision: 1,
      actor: { email: "teacher@school.edu.hk", role: "teacher" },
    });
    expect(first.created).toBe(true);
    const before = repo.listQuestionReviews("q-adj-reconfirm");
    expect(before).toHaveLength(1);

    repo.setTeacherConfirmationRequired("q-adj-reconfirm", true);
    const again = service.recordQuestionReview({
      questionId: "q-adj-reconfirm",
      decision: "approved",
      reason: "核對原卷後確認：現行空格及答案正確",
      expectedRevision: 1,
      actor: { email: "history-teacher@school.edu.hk", role: "teacher" },
    });

    expect(again.created).toBe(true);
    expect(again.view.question.teacherConfirmationRequired).toBe(false);
    const after = repo.listQuestionReviews("q-adj-reconfirm");
    expect(after).toHaveLength(2);
    expect(after[0]?.reviewerEmail).toBe("history-teacher@school.edu.hk");
    expect(after[0]?.reason).toContain("核對原卷後確認");
  });

  it("覆核只對當時的版本有效：內容改變後舊核准失效，過期版本不可覆核", () => {
    repo.insertQuestion(buildQuestion({ id: "q-adj-version" }));
    service.recordQuestionReview({
      questionId: "q-adj-version",
      decision: "approved",
      expectedRevision: 1,
      actor: { email: "teacher@school.edu.hk", role: "teacher" },
    });

    const current = repo.getQuestion("q-adj-version")!;
    repo.updateQuestion("q-adj-version", {
      ...current,
      question: "文藝復興首先在＿＿＿半島興起。",
    });
    expect(repo.getQuestion("q-adj-version")?.revision).toBe(2);

    // 版本已變：舊核准不再對應現行內容
    expect(() => service.changeQuestionStatus("q-adj-version", "published")).toThrow(/覆核/);
    // 以舊版本提交覆核會被拒絕（不可把決定記到沒看過的版本）
    expect(() =>
      service.recordQuestionReview({
        questionId: "q-adj-version",
        decision: "approved",
        expectedRevision: 1,
        actor: { email: "teacher@school.edu.hk", role: "teacher" },
      }),
    ).toThrow(/已被修改/);
  });

  it("重做錯題不會再派已隔離或已撤回的題庫題目", async () => {
    for (const index of [1, 2, 3]) {
      repo.insertQuestion(
        buildQuestion({
          id: `q-adj-wrong-${index}`,
          status: "published",
          question: `文藝復興測試題 ${index}：＿＿＿是答案。`,
        }),
      );
    }

    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: TOPIC,
      sectionIds: [SECTION],
      questionTypes: ["fill"],
      difficulty: "basic",
      questionCount: 1,
      mode: "standard",
      sourceSessionId: null,
    });
    const served = assembled.questions[0];
    expect(served).toBeDefined();
    await practice.submitAnswer(assembled.session.id, LEARNER, served.id, "明顯錯誤的答案");

    // 派發後才隔離：重做錯題不可再交付這一題
    repo.setTeacherConfirmationRequired(served.id, true);
    await expect(
      practice.createPractice({
        learnerId: LEARNER,
        topicId: TOPIC,
        sectionIds: [SECTION],
        questionTypes: ["fill"],
        difficulty: "basic",
        questionCount: 1,
        mode: "wrong-only",
        sourceSessionId: assembled.session.id,
      }),
    ).rejects.toThrow(/等待教師確認/);

    // 解除隔離後可以重做（凍結快照的內容保持不變）
    repo.setTeacherConfirmationRequired(served.id, false);
    const retried = await practice.createPractice({
      learnerId: LEARNER,
      topicId: TOPIC,
      sectionIds: [SECTION],
      questionTypes: ["fill"],
      difficulty: "basic",
      questionCount: 1,
      mode: "wrong-only",
      sourceSessionId: assembled.session.id,
    });
    expect(retried.questions.map((question) => question.id)).toEqual([served.id]);
  });

  it("撤回但未隔離的題目仍可依凍結快照重做（既有設計，刻意不變）", async () => {
    repo.insertQuestion(
      buildQuestion({ id: "q-adj-wrong-retired", status: "published", question: "撤回測試：＿＿＿。" }),
    );
    const learner = "teacher-adjudication-learner-2";
    const assembled = await practice.createPractice({
      learnerId: learner,
      topicId: TOPIC,
      sectionIds: [SECTION],
      questionTypes: ["fill"],
      difficulty: "basic",
      questionCount: 1,
      mode: "standard",
      sourceSessionId: null,
    });
    const served = assembled.questions[0];
    await practice.submitAnswer(assembled.session.id, learner, served.id, "錯誤答案");
    service.changeQuestionStatus(served.id, "disabled");

    const retried = await practice.createPractice({
      learnerId: learner,
      topicId: TOPIC,
      sectionIds: [SECTION],
      questionTypes: ["fill"],
      difficulty: "basic",
      questionCount: 1,
      mode: "wrong-only",
      sourceSessionId: assembled.session.id,
    });
    // 凍結快照是學生當時的試卷；撤回不會追溯改寫歷史（見 validation-freshness.test.ts）。
    // 隔離（teacherConfirmationRequired）則不同：上一條測試已固定它會阻止重做。
    expect(retried.questions.map((question) => question.id)).toEqual([served.id]);
  });

  it("核准隔離題目後會移除隔離警告，且不令版本遞增", () => {
    repo.insertQuestion(
      buildQuestion({
        id: "q-adj-warning",
        teacherConfirmationRequired: true,
        qualityWarnings: [
          "平台自動檢查（隔離）：考核空格由第 1 個改為第 2 個；須由教師核對原卷後確認，學生暫時不會收到這一題。",
          "其他保留的警告",
        ],
      }),
    );
    const before = repo.getQuestion("q-adj-warning")!;
    service.recordQuestionReview({
      questionId: "q-adj-warning",
      decision: "approved",
      expectedRevision: before.revision,
      actor: { email: "teacher@school.edu.hk", role: "teacher" },
    });

    const after = repo.getQuestion("q-adj-warning")!;
    expect(after.teacherConfirmationRequired).toBe(false);
    // 警告不是題目內容：移除時不可令版本遞增，否則這次核准會立即失效
    expect(after.revision).toBe(before.revision);
    expect(after.qualityWarnings).toEqual(["其他保留的警告"]);
  });

  it("裁決套件不含任何已作出的決定", () => {
    const packagePath = path.join(
      process.cwd(),
      "docs",
      "teacher-review",
      "repair-adjudication-2026-10-19.json",
    );
    const payload = JSON.parse(fs.readFileSync(packagePath, "utf8")) as {
      status: string;
      notice: string;
      items: {
        questionId: string;
        decision: { state: string; reviewedRevision: unknown; approvedBy: unknown };
      }[];
    };

    expect(payload.status).toBe("AWAITING_TEACHER_ADJUDICATION");
    expect(payload.notice).toContain("不是覆核紀錄");
    expect(payload.items.length).toBe(18);
    for (const item of payload.items) {
      expect(item.decision.state).toBe("unset");
      expect(item.decision.reviewedRevision).toBeNull();
      expect(item.decision.approvedBy).toBeNull();
    }
  });
});
