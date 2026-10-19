/**
 * Sprint 12：發布控制加固測試。
 *
 * 契約：
 *   1. 條件式狀態更新（TOCTOU）：版本不符時不改變狀態。
 *   2. 批次發布／批次覆核的候選清單會排除結構不可作答的題目（不可繞過可作答性）。
 *   3. 舊練習快照中**未作答**的題目，若題庫題目已被隔離或結構不可作答，不可再作答；
 *      已作答的題目仍可查看原本的歷史回饋。
 *   4. 沒有題目資料時，發布閘門的內容項目一律 INSUFFICIENT_EVIDENCE（不是 PASS）。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("release-controls");
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

type Seed = typeof import("@/server/seed");
type QuestionService = typeof import("@/server/services/question-service");
type QuestionRepo = typeof import("@/server/repositories/questions");
type PracticeService = typeof import("@/server/services/practice-service");
type ReleaseGates = typeof import("@/server/quality/release-gates");

let seed: Seed;
let service: QuestionService;
let repo: QuestionRepo;
let practice: PracticeService;
let gates: ReleaseGates;

const TEACHER = { email: "teacher@example.com", role: "teacher" };

function sectionRef() {
  const sample = repo.listQuestions({}).find((question) => question.status === "published");
  if (!sample) throw new Error("示範題庫尚未建立");
  return { topicId: sample.topicId, sectionId: sample.sectionId };
}

function createMcQuestion(suffix: string, stem: string) {
  const { topicId, sectionId } = sectionRef();
  return service.createManualQuestion({
    topicId,
    sectionId,
    questionType: "mc",
    difficulty: "basic",
    question: stem,
    options: ["人文主義", "重商主義", "軍國主義", "封建主義"],
    correctAnswer: "人文主義",
    acceptedAnswers: [],
    explanation: "課本指出文藝復興重視人文主義。",
    knowledgePoint: `加固測試（${suffix}）`,
    sourceExcerpt: "文藝復興重視人文主義",
    sourceLocation: "測試用來源位置",
    sourceBlockIds: [],
    gradingPoints: [],
    qualityWarnings: [],
    origin: "manual",
    status: "draft",
    skill: "從歷史資料中作出歸納和推論",
  });
}

/** 結構不可作答：選項引用 i／ii／iii，但題幹沒有標示 */
function createUnservableQuestion(suffix: string) {
  const { topicId, sectionId } = sectionRef();
  return service.createManualQuestion({
    topicId,
    sectionId,
    questionType: "mc",
    difficulty: "basic",
    question: `加固測試（${suffix}）：下列哪些屬於一手資料？ 日記 錄像 事件發生時的報導 學術論文`,
    options: ["i、ii及iii", "ii、iii及iv", "i、iii及iv", "i、ii及iv"],
    correctAnswer: "i、ii及iii",
    acceptedAnswers: [],
    explanation: "日記與事發時的報導屬一手資料。",
    knowledgePoint: `加固測試知識點（${suffix}）`,
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

beforeAll(async () => {
  seed = await import("@/server/seed");
  service = await import("@/server/services/question-service");
  repo = await import("@/server/repositories/questions");
  practice = await import("@/server/services/practice-service");
  gates = await import("@/server/quality/release-gates");
  seed.ensureBootstrap();
});

describe("條件式狀態更新（TOCTOU）", () => {
  it("版本不符時不改變狀態，符合時才更新", () => {
    const question = createMcQuestion("toctou", "文藝復興的核心思想是甚麼？");
    expect(question.revision).toBe(1);

    expect(repo.setQuestionStatusIfRevision(question.id, "published", 99)).toBeNull();
    expect(repo.getQuestion(question.id)?.status).toBe("draft");

    const updated = repo.setQuestionStatusIfRevision(question.id, "published", 1);
    expect(updated?.status).toBe("published");
  });

  it("舊版本核准不能把已被修改的新版本發布（服務層 409）", async () => {
    const question = createMcQuestion("toctou-service", "文藝復興的核心思想是甚麼？");
    expect(() =>
      service.recordQuestionReview({
        questionId: question.id,
        decision: "approved",
        expectedRevision: question.revision + 1,
        actor: TEACHER,
      }),
    ).toThrow(/已被修改/);
    expect(repo.getQuestion(question.id)?.status).toBe("draft");
  });
});

describe("批次候選清單不可繞過可作答性", () => {
  it("結構不可作答的草稿題目不會進入批次發布或批次覆核候選", () => {
    const unservable = createUnservableQuestion("batch");
    const publishCandidates = service.listOwnerPublicationCandidates({});
    expect(publishCandidates.publishable.map((item) => item.id)).not.toContain(unservable.id);
    expect(publishCandidates.held.map((item) => item.id)).toContain(unservable.id);

    const approvalCandidates = service.listOwnerApprovalCandidates({});
    expect(approvalCandidates.approvable.map((item) => item.id)).not.toContain(unservable.id);
    expect(approvalCandidates.held.map((item) => item.id)).toContain(unservable.id);
  });
});

describe("舊練習快照不可成為隔離題目的入口", () => {
  it("未作答的題目在題庫被隔離後不可再作答；已作答題目仍可查看歷史回饋", async () => {
    const question = createMcQuestion("snapshot", "文藝復興的核心思想是甚麼？");
    service.recordQuestionReview({
      questionId: question.id,
      decision: "approved",
      expectedRevision: question.revision,
      actor: TEACHER,
    });
    expect(repo.getQuestion(question.id)?.status).toBe("published");

    // 建立只包含這題的練習快照
    const assembled = await practice.createPractice({
      learnerId: "learner-snapshot",
      topicId: question.topicId,
      sectionIds: [question.sectionId],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 1,
      mode: "standard",
      questionSource: "bank",
      sourceSessionId: null,
    } as never);
    const snapshotQuestion = assembled.questions[0];
    expect(snapshotQuestion.id).toBeDefined();

    // 先作答一次，之後把它隔離
    await practice.submitAnswer(
      assembled.session.id,
      "learner-snapshot",
      snapshotQuestion.id,
      "人文主義",
    );
    repo.setTeacherConfirmationRequired(snapshotQuestion.id, true);

    // 已作答：仍可取得原本的歷史回饋（不會 409）
    const replay = await practice.submitAnswer(
      assembled.session.id,
      "learner-snapshot",
      snapshotQuestion.id,
      "人文主義",
    );
    expect(replay.recorded).toBe(false);
    expect(replay.feedback.correctAnswer).toBe("人文主義");

    // 另一題（未作答）在題庫被隔離後不可再作答
    const second = createMcQuestion("snapshot-2", "文藝復興興起於哪個國家？");
    service.recordQuestionReview({
      questionId: second.id,
      decision: "approved",
      expectedRevision: second.revision,
      actor: TEACHER,
    });
    const secondPractice = await practice.createPractice({
      learnerId: "learner-snapshot-2",
      topicId: second.topicId,
      sectionIds: [second.sectionId],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 1,
      mode: "standard",
      questionSource: "bank",
      sourceSessionId: null,
    } as never);
    const pendingQuestion = secondPractice.questions[0];
    repo.setTeacherConfirmationRequired(pendingQuestion.id, true);

    await expect(
      practice.submitAnswer(
        secondPractice.session.id,
        "learner-snapshot-2",
        pendingQuestion.id,
        "人文主義",
      ),
    ).rejects.toThrow(/覆核/);
  });
});

describe("發布閘門 fail-closed：沒有題目資料", () => {
  function emptyAudit() {
    return {
      generatedAt: new Date().toISOString(),
      inputFingerprint: "empty",
      totals: {
        questions: 0,
        published: 0,
        teacherConfirmationRequired: 0,
        notServable: 0,
        releasable: 0,
        canServe: 0,
      },
      source: {
        counts: { traceable: 0, partial: 0, unknown: 0, pending_verification: 0 },
        missingDocumentRecord: 0,
        missingQuestionNumber: 0,
        missingSourceHash: 0,
        hasImportBatch: 0,
        staleBlockReferences: 0,
        byOrigin: {},
      },
      explanation: {
        counts: {
          placeholder: 0,
          answer_only: 0,
          insufficient: 0,
          potentially_inconsistent: 0,
          not_assessed: 0,
        },
        reviewedButLowQuality: 0,
        automationApprovalsRecordedAsHuman: 0,
        unknownReviewOrigin: 0,
        byTopic: {},
      },
      metadata: {
        byCode: {},
        bySeverity: { blocking: 0, needs_review: 0, warning: 0 },
        skillMissing: 0,
        difficulty: {},
        blockingReferences: 0,
      },
      policy: {
        byCategory: { hard_block: 0, teacher_review: 0, warning: 0, policy_pending: 0 },
        questionsWithHardBlock: 0,
        questionsWithTeacherReview: 0,
        questionsReleasable: 0,
      },
      questions: [],
    } as never;
  }

  it("0 題資料時內容閘門是 INSUFFICIENT_EVIDENCE，整體 NOT READY", () => {
    const report = gates.evaluateReleaseGates({
      audit: emptyAudit(),
      answerProvenance: { affected: 0, unresolved: 0, reportFound: true },
      teacherDecisions: { pendingCurrentRevision: 0, openReports: 0 },
      reviewProvenance: {
        teacherAdjudicated: 0,
        ownerBatchOnly: 0,
        automationOnly: 0,
        noEvidence: 0,
      },
      servabilityIssues: {},
      servabilityAdjudication: {
        unservable: 0,
        originalEvidenceChecked: 0,
        labelsOnlyRepairCandidates: 0,
        teacherDecisions: 0,
        awaitingTeacherDecision: 0,
      },
      provenanceRisk: { reportFound: true, p0: 0, p1: 0, p2: 0, p3: 0 },
      goldenApproval: { approved: 0, pending: 0, stale: 0 },
      copyright: {
        documents: 0,
        distributable: 0,
        rightsRecorded: 0,
        ownerAttestation: true,
      },
      golden: { questions: 0, reviewed: 0 },
      tests: { evidenceProvided: true, failures: 0, skipped: 0, commands: ["npm test"] },
      deployment: { evidenceProvided: true, notes: [] },
      previous: null,
    });
    const byId = new Map(report.gates.map((gate) => [gate.id, gate]));
    for (const id of [
      "question-isolation",
      "question-servability",
      "teacher-decisions",
      "review-provenance",
    ]) {
      expect(byId.get(id)?.status, id).toBe("INSUFFICIENT_EVIDENCE");
    }
    expect(report.verdict).toBe("NOT READY");
  });
});
