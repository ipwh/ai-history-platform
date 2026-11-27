import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { freshTestDatabasePath } from "./test-database";

let database: import("node:sqlite").DatabaseSync;
let service: typeof import("@/server/services/grade-makeup-report");

/**
 * 上週（11-16 至 11-20）配上本週（11-23 起）的欠交統計。
 *
 * 規則（2026-11-27）：上週每人 50 題、欠數 ×2；本週每工作日 10 題但**星期一不計**，
 * 星期一的作答仍計入本週已做總數；本週已做先滿足本週應做，超出部分才抵上週欠數。
 */
beforeAll(async () => {
  const connection = await import("@/server/db/connection");
  database = connection.createDatabase(freshTestDatabasePath("grade-makeup"));
  service = await import("@/server/services/grade-makeup-report");

  const insertRoster = database.prepare(
    `INSERT INTO roster_students
     (email, name, class_name, student_number, in_scope, updated_at)
     VALUES (?, ?, ?, ?, 1, '2026-11-23T00:00:00.000Z')`,
  );
  insertRoster.run("a@example.test", "甲同學", "4A", "1"); // 上週欠、本週有做
  insertRoster.run("b@example.test", "乙同學", "4A", "2"); // 上週達標、本週不足
  insertRoster.run("c@example.test", "丙同學", "4B", "1"); // 上週欠、本週只做星期一
  insertRoster.run("d@example.test", "丁同學", "4B", "2"); // 完全沒有練習

  const insertSession = database.prepare(
    `INSERT INTO practice_sessions
     (id, learner_id, topic_id, section_ids_json, question_types_json, difficulty,
      question_count, mode, source_session_id, origin, question_snapshot_json, notice,
      created_at, completed_at)
     VALUES (?, ?, 'topic-1', '[]', '["mc"]', 'basic', 10, ?, NULL, 'bank', '[]', NULL, ?, NULL)`,
  );
  const insertAttempt = database.prepare(
    `INSERT INTO attempts
     (id, session_id, question_id, learner_id, answer, auto_graded, is_correct,
      self_assessment, answered_at)
     VALUES (?, ?, ?, ?, ?, 1, 1, NULL, ?)`,
  );
  /** 建立一節練習並計入指定數量的已作答題目（其餘留空，模擬未作答） */
  const addSession = (
    id: string,
    learner: string,
    createdAt: string,
    answered: number,
    mode = "standard",
  ): void => {
    insertSession.run(id, `school:${learner}`, mode, createdAt);
    for (let index = 0; index < 10; index += 1) {
      insertAttempt.run(
        `${id}-${index}`,
        id,
        `q${index}`,
        `school:${learner}`,
        index < answered ? "答案" : "",
        createdAt,
      );
    }
  };

  // 甲：上週 30 題（欠 20 → 雙計 40）；本週一 20、本週二 40、本週三 0、本週四 0
  addSession("a-lw", "a@example.test", "2026-11-18T02:00:00.000Z", 10);
  addSession("a-lw2", "a@example.test", "2026-11-19T02:00:00.000Z", 10);
  addSession("a-lw3", "a@example.test", "2026-11-20T02:00:00.000Z", 10);
  addSession("a-mon1", "a@example.test", "2026-11-23T02:00:00.000Z", 10);
  addSession("a-mon2", "a@example.test", "2026-11-23T03:00:00.000Z", 10);
  addSession("a-tue", "a@example.test", "2026-11-24T02:00:00.000Z", 10);
  addSession("a-tue2", "a@example.test", "2026-11-24T03:00:00.000Z", 10);
  addSession("a-tue3", "a@example.test", "2026-11-24T04:00:00.000Z", 10);
  addSession("a-tue4", "a@example.test", "2026-11-24T05:00:00.000Z", 10);

  // 乙：上週 50 題（達標）；本週只做 10 題（星期二）
  for (let index = 0; index < 5; index += 1) {
    addSession(`b-lw${index}`, "b@example.test", `2026-11-${16 + index}T02:00:00.000Z`, 10);
  }
  addSession("b-tue", "b@example.test", "2026-11-24T02:00:00.000Z", 10);

  // 丙：上週 10 題（欠 40 → 雙計 80）；本週只在星期一做 30 題
  addSession("c-lw", "c@example.test", "2026-11-17T02:00:00.000Z", 10);
  addSession("c-mon1", "c@example.test", "2026-11-23T02:00:00.000Z", 10);
  addSession("c-mon2", "c@example.test", "2026-11-23T03:00:00.000Z", 10);
  addSession("c-mon3", "c@example.test", "2026-11-23T04:00:00.000Z", 10);
  // 重溫錯題必須完全排除
  addSession("c-wrong", "c@example.test", "2026-11-24T02:00:00.000Z", 10, "wrong-only");
});

afterAll(() => {
  database.close();
});

const query: import("@/server/services/grade-makeup-report").GradeMakeupQuery = {
  formLevel: "4",
  lastWeekFrom: "2026-11-16",
  lastWeekTo: "2026-11-20",
  countedDays: ["2026-11-24", "2026-11-25", "2026-11-26"],
  creditedDays: ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26"],
  mondayDate: "2026-11-23",
};

describe("上週欠交＋本週每日配額", () => {
  it("上週欠數雙計，本週應做只計星期二至四", () => {
    const report = service.buildGradeMakeupReport(database, { ...query, activeOnly: false });
    const first = report.rows.find((row) => row.name === "甲同學")!;
    expect(first.lastWeekAnswered).toBe(30);
    expect(first.lastWeekShortfall).toBe(20);
    expect(first.weeklyMakeup).toBe(40);
    expect(first.currentWeekDue).toBe(30);
    // 本週一 20 ＋ 本週二 40（題目已扣重溫錯題）
    expect(first.currentWeekAnswered).toBe(60);
    expect(first.currentWeekShortfall).toBe(0);
    // 超出本週應做的 30 題才可抵上週 40 題欠數 → 全數抵清
    expect(first.creditedAgainstMakeup).toBe(30);
    expect(first.remaining).toBe(10);
    expect(first.remainingSessions).toBe(1);
  });

  it("達標學生的上週欠數為 0，只計本週不足", () => {
    const report = service.buildGradeMakeupReport(database, { ...query, activeOnly: false });
    const second = report.rows.find((row) => row.name === "乙同學")!;
    expect(second.weeklyMakeup).toBe(0);
    expect(second.currentWeekAnswered).toBe(10);
    expect(second.currentWeekShortfall).toBe(20);
    expect(second.remaining).toBe(20);
    expect(second.remainingSessions).toBe(2);
  });

  it("星期一不計入本週配額，但星期一的作答仍計入本週已做", () => {
    const report = service.buildGradeMakeupReport(database, { ...query, activeOnly: false });
    const third = report.rows.find((row) => row.name === "丙同學")!;
    expect(third.lastWeekAnswered).toBe(10);
    expect(third.weeklyMakeup).toBe(80);
    // 星期一 30 題全部計入本週已做（30），剛好滿足本週應做 30 → 無餘數抵上週
    expect(third.currentWeekAnswered).toBe(30);
    expect(third.currentWeekShortfall).toBe(0);
    expect(third.creditedAgainstMakeup).toBe(0);
    expect(third.remaining).toBe(80);
    expect(third.remainingSessions).toBe(8);
  });

  it("重溫錯題不計入任何數字", () => {
    const report = service.buildGradeMakeupReport(database, { ...query, activeOnly: false });
    const third = report.rows.find((row) => row.name === "丙同學")!;
    // 星期二那節 wrong-only 有 10 題作答，但不得出現在本週逐日統計
    expect(third.dailyAnswered.find((entry) => entry.date === "2026-11-24")?.answered).toBe(0);
  });

  it("預設只列有練習紀錄的學生，並保留名冊人數供核對", () => {
    const report = service.buildGradeMakeupReport(database, query);
    expect(report.rows.map((row) => row.name)).toEqual(["甲同學", "乙同學", "丙同學"]);
    expect(report.totals.students).toBe(3);
    expect(report.totals.rosterStudents).toBe(4);
    expect(report.totals.studentsOwing).toBe(3);
    expect(report.totals.remaining).toBe(10 + 20 + 80);
  });

  it("按班別及班號排序", () => {
    const report = service.buildGradeMakeupReport(database, { ...query, activeOnly: false });
    expect(report.rows.map((row) => `${row.className}-${row.studentNumber}`)).toEqual([
      "4A-1",
      "4A-2",
      "4B-1",
      "4B-2",
    ]);
  });
});
