import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { freshTestDatabasePath } from "./test-database";

let database: import("node:sqlite").DatabaseSync;
let service: typeof import("@/server/services/grade-practice-export");

beforeAll(async () => {
  const connection = await import("@/server/db/connection");
  database = connection.createDatabase(freshTestDatabasePath("grade-practice-export"));
  service = await import("@/server/services/grade-practice-export");

  const insertRoster = database.prepare(
    `INSERT INTO roster_students
     (email, name, class_name, student_number, in_scope, updated_at)
     VALUES (?, ?, ?, ?, ?, '2026-11-19T00:00:00.000Z')`,
  );
  insertRoster.run("s1@example.test", "甲同學", "4A", "2", 1);
  insertRoster.run("s2@example.test", "乙同學", "4A", "10", 1);
  insertRoster.run("s3@example.test", "丙同學", "4B", "1", 1);
  insertRoster.run("out@example.test", "校外", "4A", "99", 0);

  const insertSession = database.prepare(
    `INSERT INTO practice_sessions
     (id, learner_id, topic_id, section_ids_json, question_types_json, difficulty,
      question_count, mode, source_session_id, origin, question_snapshot_json, notice,
      created_at, completed_at)
     VALUES (?, ?, 'topic-1', '[]', '["mc"]', 'basic', ?, ?, ?, 'bank', '[]', NULL, ?, NULL)`,
  );
  // 4A 甲：一般練習 2 題（1 對 1 錯）
  insertSession.run("sess-a1", "school:s1@example.test", 2, "standard", null, "2026-11-19T01:00:00.000Z");
  // 4A 甲：重溫錯題（必須完全排除）
  insertSession.run("sess-a2", "school:s1@example.test", 5, "wrong-only", "sess-a1", "2026-11-19T02:00:00.000Z");
  // 4B 丙：一般練習 1 題（答對）
  insertSession.run("sess-b1", "school:s3@example.test", 1, "standard", null, "2026-11-19T03:00:00.000Z");
  // 4B 丙：非統計日期（前一天）
  insertSession.run("sess-b2", "school:s3@example.test", 3, "standard", null, "2026-11-18T03:00:00.000Z");

  const insertAttempt = database.prepare(
    `INSERT INTO attempts
     (id, session_id, question_id, learner_id, answer, auto_graded, is_correct,
      self_assessment, answered_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, NULL, ?)`,
  );
  insertAttempt.run("a1", "sess-a1", "q1", "school:s1@example.test", "答案", 1, "2026-11-19T01:05:00.000Z");
  insertAttempt.run("a2", "sess-a1", "q2", "school:s1@example.test", "答案", 0, "2026-11-19T01:06:00.000Z");
  for (let index = 0; index < 5; index += 1) {
    insertAttempt.run(
      `a3-${index}`,
      "sess-a2",
      `q${index}`,
      "school:s1@example.test",
      "答案",
      1,
      "2026-11-19T02:05:00.000Z",
    );
  }
  insertAttempt.run("b1", "sess-b1", "q1", "school:s3@example.test", "答案", 1, "2026-11-19T03:05:00.000Z");
  for (let index = 0; index < 3; index += 1) {
    insertAttempt.run(
      `b2-${index}`,
      "sess-b2",
      `q${index}`,
      "school:s3@example.test",
      "答案",
      0,
      "2026-11-18T03:05:00.000Z",
    );
  }
});

afterAll(() => {
  database.close();
});

describe("按級別每日匯出", () => {
  it("排除重溫錯題，並按班別及班號排序", () => {
    const report = service.buildGradePracticeExport(database, {
      formLevel: "4",
      from: "2026-11-19",
      to: "2026-11-19",
    });

    expect(report.rows.map((row) => `${row.className}-${row.studentNumber}`)).toEqual([
      "4A-2",
      "4A-10",
      "4B-1",
    ]);
    const first = report.rows[0]!;
    expect(first).toMatchObject({
      name: "甲同學",
      sessions: 1,
      assignedQuestions: 2,
      answeredQuestions: 2,
      correct: 1,
      wrong: 1,
      accuracy: 0.5,
    });
    expect(report.rows[1]).toMatchObject({ name: "乙同學", sessions: 0, accuracy: null });
  });

  it("只統計指定香港日期，並彙總班別及全年級", () => {
    const report = service.buildGradePracticeExport(database, {
      formLevel: "4",
      from: "2026-11-18",
      to: "2026-11-19",
    });

    expect(report.totals).toEqual({
      students: 3,
      activeStudents: 2,
      sessions: 3,
      assignedQuestions: 6,
      answeredQuestions: 6,
      correct: 2,
      wrong: 4,
      accuracy: 0.3333,
    });
    expect(report.classes).toEqual([
      expect.objectContaining({ className: "4A", students: 2, activeStudents: 1, sessions: 1 }),
      expect.objectContaining({ className: "4B", students: 1, activeStudents: 1, sessions: 2 }),
    ]);
  });

  it("未列入名冊（in_scope = 0）的學生不會出現在匯出", () => {
    const report = service.buildGradePracticeExport(database, {
      formLevel: "4",
      from: "2026-11-16",
      to: "2026-11-19",
    });
    expect(report.rows.some((row) => row.name === "校外")).toBe(false);
  });

  it("香港日期不受伺服器時區影響", () => {
    expect(service.hongKongDate(new Date("2026-11-19T15:59:00.000Z"))).toBe("2026-11-19");
    // UTC 16:00 = 香港翌日 00:00
    expect(service.hongKongDate(new Date("2026-11-19T16:00:00.000Z"))).toBe("2026-11-20");
  });

  it("本週一以香港時間計算（星期一至日同屬一週）", () => {
    // 2026-11-20 是星期五；香港 07:57
    expect(service.hongKongWeekStart(new Date("2026-11-19T23:57:00.000Z"))).toBe("2026-11-16");
    // 2026-11-16 星期一 00:30（香港）→ 仍是同一日
    expect(service.hongKongWeekStart(new Date("2026-11-15T16:30:00.000Z"))).toBe("2026-11-16");
    // 2026-11-22 星期日（香港）→ 該週星期一仍是 11-16
    expect(service.hongKongWeekStart(new Date("2026-11-22T04:00:00.000Z"))).toBe("2026-11-16");
    // 2026-11-23 星期一（香港）→ 新一週
    expect(service.hongKongWeekStart(new Date("2026-11-22T16:30:00.000Z"))).toBe("2026-11-23");
  });

  it("電郵表格只列有練習的學生，並使用指定格式", () => {
    const report = service.buildGradePracticeExport(database, {
      formLevel: "4",
      from: "2026-11-19",
      to: "2026-11-19",
    });
    const lines = service.formatPracticeTable(report.rows).split("\n");

    expect(lines[0]).toBe("班別班號\t姓名\t練習\t獲派\t作答\t答對\t答錯\t準確率\t最後練習");
    // 只有甲同學（4A）及丙同學（4B）在 11-19 有練習；乙同學（0 次）不列出
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("4A-2\t甲同學\t1\t2\t2\t1\t1\t50.00%\t11-19");
    expect(lines[2]).toBe("4B-1\t丙同學\t1\t1\t1\t1\t0\t100.00%\t11-19");
  });

  it("沒有練習紀錄時只餘標題列（不會偽造數據）", () => {
    const report = service.buildGradePracticeExport(database, {
      formLevel: "4",
      from: "2026-11-10",
      to: "2026-11-10",
    });
    expect(report.rows.length).toBeGreaterThan(0);
    expect(service.formatPracticeTable(report.rows).split("\n")).toHaveLength(1);
  });
});
