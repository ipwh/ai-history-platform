import { beforeAll, describe, expect, it } from "vitest";

import { freshTestDatabasePath } from "./test-database";

/**
 * 「重新檢查」寫入表面線索警告的資料庫層測試（Sprint 24）。
 *
 * 要證明的事：
 *   1. 教師按「重新檢查」後，題目會取得帶版本標記的表面線索警告；
 *   2. 題幹、選項、正確答案、revision、狀態及既有覆核紀錄**完全不變**；
 *   3. 內容指紋不變（因此既有覆核不會變成 stale-approval）；
 *   4. 重複執行不會累積重複警告；
 *   5. 其他品質警告（例如「解釋太短」）不會被移除。
 */
const testDbPath = freshTestDatabasePath("revalidate-option-warning");
process.env.APP_DATABASE_PATH = testDbPath;
process.env.LLM_PROVIDER = "mock";

type QuestionService = typeof import("@/server/services/question-service");
type QuestionRepository = typeof import("@/server/repositories/questions");
type MaterialRepository = typeof import("@/server/repositories/materials");
type FindingsRepository = typeof import("@/server/repositories/question-quality-findings");
type Seed = typeof import("@/server/seed");
type Fingerprint = typeof import("@/server/quality/question-fingerprint");

let service: QuestionService;
let questions: QuestionRepository;
let materials: MaterialRepository;
let findings: FindingsRepository;
let seed: Seed;
let fingerprint: Fingerprint["questionFingerprint"];

const TOPIC = "topic-5";
const SECTION = "topic-5-renaissance";
const QUESTION_ID = "q-revalidate-option-warning";
const EXISTING_WARNING = "品質檢查提示：解釋太短，未能說明答案的依據";
const LONG_STATEMENT =
  "這是一段刻意寫得較長的說明文字，用來模擬 AI 生成題目中過度詳細的正確選項";

beforeAll(async () => {
  service = await import("@/server/services/question-service");
  questions = await import("@/server/repositories/questions");
  materials = await import("@/server/repositories/materials");
  findings = await import("@/server/repositories/question-quality-findings");
  seed = await import("@/server/seed");
  fingerprint = (await import("@/server/quality/question-fingerprint")).questionFingerprint;

  seed.ensureBootstrap();

  const document = materials.createDocument({
    fileName: "synthetic-test.docx",
    kind: "uploaded",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 1024,
    status: "ready",
    topicId: TOPIC,
  });
  const [block] = materials.insertBlocks([
    {
      documentId: document.id,
      topicId: TOPIC,
      sectionId: SECTION,
      order: 0,
      type: "paragraph",
      text: `在合成測試樣本中，甲城位於河谷，乙城位於海旁。${LONG_STATEMENT}。`,
      sourceLocation: "合成測試段落",
    },
  ]);

  questions.insertQuestion({
    id: QUESTION_ID,
    topicId: TOPIC,
    sectionId: SECTION,
    questionType: "mc",
    difficulty: "basic",
    question: "在合成測試樣本中，哪一項最能說明河谷的情況？",
    options: [LONG_STATEMENT, "甲城", "乙城", "丙城"],
    correctAnswer: LONG_STATEMENT,
    acceptedAnswers: [],
    explanation: "因為樣本刻意把正確選項寫得更長，用來測試警告的寫入行為。",
    knowledgePoint: "合成測試",
    sourceExcerpt: LONG_STATEMENT,
    sourceLocation: "合成測試段落",
    sourceBlockIds: [block.id],
    gradingPoints: [],
    origin: "material-ai",
    status: "published",
    sourceVerified: true,
    qualityWarnings: [EXISTING_WARNING],
    skill: null,
    revision: 3,
    autoValidatedAt: "2026-10-23T00:00:00.000Z",
    autoValidatedRevision: 3,
    autoValidatedFingerprint: null,
    teacherConfirmationRequired: false,
    createdAt: "2026-10-23T00:00:00.000Z",
  });

  const question = questions.getQuestion(QUESTION_ID);
  if (question === null) throw new Error("測試題目未成功寫入");
  questions.insertQuestionReview({
    id: "review-option-warning-1",
    questionId: QUESTION_ID,
    revision: 3,
    decision: "approved",
    reason: "合成樣本的教師覆核紀錄（測試用）",
    reviewerEmail: "reviewer@example.test",
    reviewerRole: "reviewer",
    questionFingerprint: fingerprint(question),
    createdAt: "2026-10-23T00:30:00.000Z",
  });
});

describe("重新檢查會寫入可追溯的表面線索警告", () => {
  it("只加警告：內容、版本、狀態、指紋及覆核紀錄不變", () => {
    const before = questions.getQuestion(QUESTION_ID);
    expect(before).not.toBeNull();
    const reviewsBefore = questions.listQuestionReviews(QUESTION_ID, 50);
    expect(reviewsBefore.length).toBe(1);

    const result = service.revalidateQuestion(QUESTION_ID);
    expect(result.decision).toBe("auto-validated");

    const after = questions.getQuestion(QUESTION_ID);
    expect(after).not.toBeNull();

    // 內容完全不變
    expect(after!.question).toBe(before!.question);
    expect(after!.options).toEqual(before!.options);
    expect(after!.correctAnswer).toBe(before!.correctAnswer);
    expect(after!.explanation).toBe(before!.explanation);
    expect(after!.sourceBlockIds).toEqual(before!.sourceBlockIds);

    // 版本、狀態、指紋不變（因此既有覆核不會失效）
    expect(after!.revision).toBe(before!.revision);
    expect(after!.status).toBe(before!.status);
    expect(fingerprint(after!)).toBe(fingerprint(before!));

    // 覆核紀錄不變（沒有新增、沒有改寫）
    const reviewsAfter = questions.listQuestionReviews(QUESTION_ID, 50);
    expect(reviewsAfter.length).toBe(reviewsBefore.length);
    expect(reviewsAfter[0]?.id).toBe(reviewsBefore[0]?.id);
    expect(reviewsAfter[0]?.reviewerEmail).toBe(reviewsBefore[0]?.reviewerEmail);

    // 警告：既有警告保留，新的表面線索警告帶版本標記
    expect(after!.qualityWarnings).toContain(EXISTING_WARNING);
    const optionWarnings = after!.qualityWarnings.filter((warning) =>
      warning.includes("option-quality/v"),
    );
    expect(optionWarnings.length).toBeGreaterThan(0);
    expect(optionWarnings.every((warning) => warning.startsWith("品質檢查提示："))).toBe(true);

    // 結構化診斷（Sprint 25）：同一批判定寫入 question_quality_findings，
    // 記錄來源、規則版本、判定時的 revision；不影響題目內容。
    const rows = findings.listFindingsForQuestion(QUESTION_ID);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.origin === "revalidation")).toBe(true);
    expect(rows.every((row) => row.ruleVersion === "option-quality/v1")).toBe(true);
    expect(rows.every((row) => row.questionRevision === 3)).toBe(true);
    expect(new Set(rows.map((row) => row.code))).toEqual(
      new Set(optionWarnings.map((warning) => /· ([a-z-]+)）/u.exec(warning)?.[1])),
    );
  });

  it("重複執行不會累積重複警告或重複診斷", () => {
    const firstWarnings = questions.getQuestion(QUESTION_ID)!.qualityWarnings;
    const firstFindings = findings.listFindingsForQuestion(QUESTION_ID).length;
    const second = service.revalidateQuestion(QUESTION_ID);
    expect(second.decision).toBe("auto-validated");
    const after = questions.getQuestion(QUESTION_ID);
    expect(after!.qualityWarnings).toEqual(firstWarnings);
    expect(findings.listFindingsForQuestion(QUESTION_ID).length).toBe(firstFindings);
  });

  it("警告不是教師批准或史實已核實的證據（覆核狀態仍由既有紀錄決定）", () => {
    const after = questions.getQuestion(QUESTION_ID);
    expect(after!.teacherConfirmationRequired).toBe(false);
    const view = service.teacherQuestionView(after!);
    // 覆核狀態仍來自 question_reviews，不會因為有警告而改變
    expect(view.latestReview?.id).toBe("review-option-warning-1");
    expect(view.latestReview?.revision).toBe(3);
  });
});
