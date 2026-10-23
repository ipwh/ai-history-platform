import { beforeAll, describe, expect, it } from "vitest";

import { freshTestDatabasePath } from "./test-database";

/**
 * `question_quality_findings` 的 schema 及 repository 契約（Sprint 25）。
 *
 * 驗證：
 *   1. migration 建立預期的欄位、索引及 CHECK 約束；
 *   2. 重新檢查的診斷以「整體替換」語意更新（已解決的項目會消失），重複執行冪等；
 *   3. 不同題目、不同來源（instant）互不影響；
 *   4. 同一批輸入若有非法值，整個交易回滾（不會留下半套診斷）；
 *   5. 題目被刪除後不會留下孤兒列；
 *   6. 匯總函式可按代碼／版本／來源統計。
 *
 * 本檔案全程使用暫存資料庫，不連接正式資料庫。
 */
const testDbPath = freshTestDatabasePath("question-quality-findings");
process.env.APP_DATABASE_PATH = testDbPath;
process.env.LLM_PROVIDER = "mock";

type FindingsRepo = typeof import("@/server/repositories/question-quality-findings");
type QuestionsRepo = typeof import("@/server/repositories/questions");
type Connection = typeof import("@/server/db/connection");
type Seed = typeof import("@/server/seed");

let findings: FindingsRepo;
let questions: QuestionsRepo;
let connection: Connection;
let seed: Seed;

const TOPIC = "topic-5";
const SECTION = "topic-5-renaissance";

function insertQuestion(id: string): void {
  questions.insertQuestion({
    id,
    topicId: TOPIC,
    sectionId: SECTION,
    questionType: "mc",
    difficulty: "basic",
    question: `（合成測試題 ${id}）下列哪一項是這座城市的別稱？`,
    options: ["甲城", "乙城", "丙城", "丁城"],
    correctAnswer: "甲城",
    acceptedAnswers: [],
    explanation: "測試用解釋：只用來驗證診斷資料表，不是歷史題目。",
    knowledgePoint: "測試",
    sourceExcerpt: "合成測試段落",
    sourceLocation: "測試",
    sourceBlockIds: [],
    gradingPoints: [],
    origin: "material-ai",
    status: "published",
    sourceVerified: false,
    qualityWarnings: [],
    skill: null,
    revision: 2,
    autoValidatedAt: null,
    autoValidatedRevision: null,
    autoValidatedFingerprint: null,
    teacherConfirmationRequired: false,
    createdAt: "2026-10-23T00:00:00.000Z",
  });
}

beforeAll(async () => {
  findings = await import("@/server/repositories/question-quality-findings");
  questions = await import("@/server/repositories/questions");
  connection = await import("@/server/db/connection");
  seed = await import("@/server/seed");
  seed.ensureBootstrap();
  insertQuestion("q-findings-a");
  insertQuestion("q-findings-b");
});

describe("schema", () => {
  it("欄位、索引及 CHECK 約束存在", () => {
    const db = connection.getDb();
    const columns = (
      db.prepare("PRAGMA table_info(question_quality_findings)").all() as unknown as {
        name: string;
      }[]
    ).map((row) => row.name);
    expect(columns).toEqual([
      "id",
      "code",
      "rule_version",
      "severity",
      "origin",
      "question_id",
      "question_revision",
      "session_id",
      "snapshot_question_id",
      "detected_at",
    ]);

    const indexes = (
      db.prepare("PRAGMA index_list(question_quality_findings)").all() as unknown as {
        name: string;
      }[]
    ).map((row) => row.name);
    expect(indexes).toContain("idx_question_quality_findings_question");
    expect(indexes).toContain("idx_question_quality_findings_session");
    expect(indexes).toContain("idx_question_quality_findings_code");
    expect(indexes).toContain("idx_question_quality_findings_time");

    // CHECK：空的 code 不可寫入；origin 只接受兩個已知值
    expect(() =>
      db
        .prepare(
          `INSERT INTO question_quality_findings
             (id, code, rule_version, severity, origin, question_id, question_revision, detected_at)
           VALUES ('x1', '  ', 'option-quality/v1', 'warning', 'revalidation', 'q-findings-a', 1, '2026-10-23T00:00:00.000Z')`,
        )
        .run(),
    ).toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO question_quality_findings
             (id, code, rule_version, severity, origin, question_id, question_revision, detected_at)
           VALUES ('x2', 'option-duplicate', 'option-quality/v1', 'warning', 'unknown', 'q-findings-a', 1, '2026-10-23T00:00:00.000Z')`,
        )
        .run(),
    ).toThrow();
  });
});

describe("重新檢查的診斷（整體替換）", () => {
  it("寫入、冪等、以及已解決項目的移除", () => {
    const first = findings.replaceRevalidationFindings({
      questionId: "q-findings-a",
      questionRevision: 2,
      findings: [
        { code: "option-length-asymmetry", ruleVersion: "option-quality/v1" },
        { code: "option-absolutist-distractor", ruleVersion: "option-quality/v1" },
      ],
    });
    expect(first).toBe(2);
    expect(findings.listFindingsForQuestion("q-findings-a")).toHaveLength(2);

    // 重複執行同一批：不會累積
    findings.replaceRevalidationFindings({
      questionId: "q-findings-a",
      questionRevision: 2,
      findings: [
        { code: "option-length-asymmetry", ruleVersion: "option-quality/v1" },
        { code: "option-absolutist-distractor", ruleVersion: "option-quality/v1" },
      ],
    });
    expect(findings.listFindingsForQuestion("q-findings-a")).toHaveLength(2);

    // 其中一項已修正：只剩一列
    findings.replaceRevalidationFindings({
      questionId: "q-findings-a",
      questionRevision: 2,
      findings: [{ code: "option-length-asymmetry", ruleVersion: "option-quality/v1" }],
    });
    const remaining = findings.listFindingsForQuestion("q-findings-a");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.code).toBe("option-length-asymmetry");
    expect(remaining[0]?.questionRevision).toBe(2);

    // 全部解決：零列
    findings.replaceRevalidationFindings({
      questionId: "q-findings-a",
      questionRevision: 2,
      findings: [],
    });
    expect(findings.listFindingsForQuestion("q-findings-a")).toHaveLength(0);
  });

  it("只影響目標題目及自己來源，不會刪除其他題目或 instant 來源的列", () => {
    findings.replaceRevalidationFindings({
      questionId: "q-findings-a",
      questionRevision: 2,
      findings: [{ code: "option-duplicate", ruleVersion: "option-quality/v1" }],
    });
    findings.replaceRevalidationFindings({
      questionId: "q-findings-b",
      questionRevision: 2,
      findings: [{ code: "option-form-mismatch", ruleVersion: "option-quality/v1" }],
    });
    findings.recordSessionFindings({
      sessionId: "session-1",
      findings: [
        {
          code: "option-length-asymmetry",
          ruleVersion: "option-quality/v1",
          snapshotQuestionId: "q-instant-1",
        },
      ],
    });

    // 重新檢查 q-findings-a（換成空集合）不應影響 b 或 instant
    findings.replaceRevalidationFindings({
      questionId: "q-findings-a",
      questionRevision: 2,
      findings: [],
    });
    expect(findings.listFindingsForQuestion("q-findings-a")).toHaveLength(0);
    expect(findings.listFindingsForQuestion("q-findings-b")).toHaveLength(1);
    expect(findings.listFindingsForSession("session-1")).toHaveLength(1);
  });

  it("同一批有非法值時整批回滾，舊診斷不受影響", () => {
    findings.replaceRevalidationFindings({
      questionId: "q-findings-b",
      questionRevision: 2,
      findings: [{ code: "option-form-mismatch", ruleVersion: "option-quality/v1" }],
    });
    expect(findings.listFindingsForQuestion("q-findings-b")).toHaveLength(1);

    expect(() =>
      findings.replaceRevalidationFindings({
        questionId: "q-findings-b",
        questionRevision: 2,
        findings: [
          { code: "option-duplicate", ruleVersion: "option-quality/v1" },
          { code: "   ", ruleVersion: "option-quality/v1" },
        ],
      }),
    ).toThrow();

    // 交易回滾：刪除也被撤銷，原有那一列仍在，新的兩列都沒有寫入
    const after = findings.listFindingsForQuestion("q-findings-b");
    expect(after).toHaveLength(1);
    expect(after[0]?.code).toBe("option-form-mismatch");
  });
});

describe("即時生成題的診斷（預設不啟用）", () => {
  it("寫入需要 session 及快照題目 ID；重複寫入不會產生重複列", () => {
    const inserted = findings.recordSessionFindings({
      sessionId: "session-2",
      findings: [
        { code: "option-length-asymmetry", ruleVersion: "option-quality/v1", snapshotQuestionId: "q-x" },
        { code: "option-length-asymmetry", ruleVersion: "option-quality/v1", snapshotQuestionId: "q-x" },
        { code: "option-length-asymmetry", ruleVersion: "option-quality/v1", snapshotQuestionId: null },
      ],
    });
    // 第一列新增、第二列被 unique index 忽略、第三列因缺少快照題目 ID 被略過
    expect(inserted).toBe(1);
    const rows = findings.listFindingsForSession("session-2");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.questionId).toBeNull();
    expect(rows[0]?.snapshotQuestionId).toBe("q-x");
    expect(rows[0]?.origin).toBe("instant");
  });
});

describe("清理與匯總", () => {
  it("刪除題目時一併清除其診斷，孤兒列可由維護函式清理", () => {
    insertQuestion("q-findings-orphan");
    findings.replaceRevalidationFindings({
      questionId: "q-findings-orphan",
      questionRevision: 2,
      findings: [{ code: "option-duplicate", ruleVersion: "option-quality/v1" }],
    });
    expect(findings.listFindingsForQuestion("q-findings-orphan")).toHaveLength(1);

    questions.deleteQuestion("q-findings-orphan");
    expect(findings.listFindingsForQuestion("q-findings-orphan")).toHaveLength(0);

    // 直接製造孤兒列（模擬舊資料或繞過 repository 的刪除），確認維護函式可清理
    connection
      .getDb()
      .prepare(
        `INSERT INTO question_quality_findings
           (id, code, rule_version, severity, origin, question_id, question_revision, detected_at)
         VALUES ('qqf-orphan', 'option-duplicate', 'option-quality/v1', 'warning', 'revalidation', 'q-does-not-exist', 1, '2026-10-23T00:00:00.000Z')`,
      )
      .run();
    expect(findings.purgeOrphanedFindings()).toBe(1);
    // instant 來源（question_id 為 NULL）不受影響
    expect(findings.listFindingsForSession("session-1")).toHaveLength(1);
  });

  it("可按代碼／版本／來源匯總", () => {
    const summary = findings.summariseFindings();
    expect(summary.some((row) => row.code === "option-form-mismatch" && row.origin === "revalidation")).toBe(
      true,
    );
    expect(summary.some((row) => row.origin === "instant")).toBe(true);
    expect(summary.every((row) => row.ruleVersion.startsWith("option-quality/"))).toBe(true);
  });
});
