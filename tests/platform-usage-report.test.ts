import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { freshTestDatabasePath } from "./test-database";

let database: import("node:sqlite").DatabaseSync;
let report: typeof import("@/server/services/platform-usage-report");

beforeAll(async () => {
  const connection = await import("@/server/db/connection");
  database = connection.createDatabase(freshTestDatabasePath("platform-usage-report"));
  report = await import("@/server/services/platform-usage-report");

  database
    .prepare(
      `INSERT INTO roster_students
       (email, name, class_name, student_number, in_scope, updated_at)
       VALUES ('student@example.test', '測試學生', '2A', '12', 1, '2026-11-18T00:00:00.000Z')`,
    )
    .run();
  const insertSession = database.prepare(
    `INSERT INTO practice_sessions
     (id, learner_id, topic_id, section_ids_json, question_types_json, difficulty,
      question_count, mode, source_session_id, origin, question_snapshot_json, notice,
      created_at, completed_at)
     VALUES (?, ?, 'topic-1', '[]', '["mc"]', 'basic', ?, ?, ?, ?, '[]', NULL, ?, NULL)`,
  );
  insertSession.run(
    "session-standard",
    "school:student@example.test",
    2,
    "standard",
    null,
    "generated",
    "2026-11-17T16:00:00.000Z",
  );
  insertSession.run(
    "session-review",
    "school:student@example.test",
    1,
    "wrong-only",
    "session-standard",
    "bank",
    "2026-11-18T01:00:00.000Z",
  );

  const insertAttempt = database.prepare(
    `INSERT INTO attempts
     (id, session_id, question_id, learner_id, answer, auto_graded, is_correct,
      self_assessment, answered_at)
     VALUES (?, ?, ?, 'school:student@example.test', ?, 1, ?, NULL, ?)`,
  );
  insertAttempt.run(
    "attempt-1",
    "session-standard",
    "question-1",
    "錯誤答案",
    0,
    "2026-11-17T16:05:00.000Z",
  );
  insertAttempt.run(
    "attempt-2",
    "session-standard",
    "question-2",
    "正確答案",
    1,
    "2026-11-17T16:06:00.000Z",
  );
  insertAttempt.run(
    "attempt-review",
    "session-review",
    "question-1",
    "正確答案",
    1,
    "2026-11-18T01:05:00.000Z",
  );
});

afterAll(() => {
  database.close();
});

describe("Copilot 平台使用情況報告", () => {
  it("按練習場次避免被逐題 join 重複計數", () => {
    const result = report.buildPlatformUsageReport(database);

    expect(result.overall).toEqual({
      sessions: 2,
      learners: 1,
      assignedQuestions: 3,
      answeredQuestions: 3,
      gradedQuestions: 3,
      correct: 2,
      wrong: 1,
      accuracy: 0.6667,
    });
    expect(result.byStudent[0]).toMatchObject({
      learnerId: "school:student@example.test",
      name: "測試學生",
      className: "2A",
      studentNumber: "12",
      sessions: 2,
    });
  });

  it("分開重溫錯題與一般練習的題目來源", () => {
    const result = report.buildPlatformUsageReport(database);
    const standard = result.byMode.find((row) => row.mode === "standard");
    const review = result.byMode.find((row) => row.mode === "wrong-only");

    expect(standard).toMatchObject({ sessions: 1, label: "一般練習" });
    expect(review).toMatchObject({ sessions: 1, label: "重溫錯題" });
    expect(result.byOrigin).toEqual([
      expect.objectContaining({ origin: "generated", label: "AI 即時生成", sessions: 1 }),
    ]);
  });

  it("統計重溫後由錯轉對及香港日期篩選", () => {
    const result = report.buildPlatformUsageReport(database, {
      from: "2026-11-18",
      to: "2026-11-18",
    });

    expect(result.overall.sessions).toBe(2);
    expect(result.byDay).toHaveLength(1);
    expect(result.reviewEffectiveness).toEqual({
      sessions: 1,
      answeredQuestions: 1,
      correct: 1,
      matchedPriorQuestions: 1,
      improvedQuestions: 1,
      accuracy: 1,
      improvementRate: 1,
    });
  });
});
