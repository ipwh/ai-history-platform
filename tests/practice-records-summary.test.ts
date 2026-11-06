/**
 * 「學生練習記錄」統計及成績篩選。
 *
 * 迴歸重點（2026-11-06 審核）：
 *   - 舊版「本次查詢統計」以清單內的記錄加總，而清單受 API 預設上限（200 次）約束，
 *     因此練習次數最多只會顯示 200，答對／答錯題數亦只計算最新 200 次。
 *   - 新版的統計由 SQL 直接彙總整個查詢範圍；逐次練習清單仍可設上限。
 *   - 新增「答對題數」及「答對百分比」篩選，兩者必須與統計口徑一致。
 */
import { beforeAll, describe, expect, it } from "vitest";

import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("records-summary");
process.env.LLM_PROVIDER = "mock";

type PracticeService = typeof import("@/server/services/practice-service");
type Seed = typeof import("@/server/seed");
type PracticeRepositories = typeof import("@/server/repositories/practice");
type RecordsService = typeof import("@/server/services/practice-records");

let practice: PracticeService;
let seed: Seed;
let repository: PracticeRepositories;
let recordsService: RecordsService;

const LEARNER = "school:records-summary@pochiu.edu.hk";
const SECTION = "topic-5-renaissance-reformation";

interface CreatedSession {
  sessionId: string;
  questionCount: number;
  correctCount: number;
}

/** 完成一次練習：正確答案由練習快照讀取，因此可控制答對題數。 */
async function createSession(correct: number, wrong: number): Promise<CreatedSession> {
  const created = await practice.createPractice({
    learnerId: LEARNER,
    topicId: "topic-5",
    sectionIds: [SECTION],
    questionTypes: ["mc"],
    difficulty: "basic",
    questionCount: Math.max(correct + wrong, 1),
    mode: "standard",
    sourceSessionId: null,
  });
  const questions = repository.getSessionQuestions(created.session.id);
  let correctAnswered = 0;
  let wrongAnswered = 0;
  for (const question of questions) {
    const shouldBeCorrect = correctAnswered < correct;
    if (!shouldBeCorrect && wrongAnswered >= wrong) continue;
    const answer = shouldBeCorrect ? question.correctAnswer : `刻意答錯：${question.id}`;
    await practice.submitAnswer(created.session.id, LEARNER, question.id, answer);
    if (shouldBeCorrect) correctAnswered += 1;
    else wrongAnswered += 1;
  }
  return { sessionId: created.session.id, questionCount: questions.length, correctCount: correctAnswered };
}

beforeAll(async () => {
  practice = await import("@/server/services/practice-service");
  seed = await import("@/server/seed");
  repository = await import("@/server/repositories/practice");
  recordsService = await import("@/server/services/practice-records");
  seed.ensureBootstrap();
});

describe("練習記錄統計不受清單上限影響", () => {
  it("清單只取上限內的記錄，統計仍涵蓋整個查詢範圍", async () => {
    const first = await createSession(2, 0);
    const second = await createSession(2, 0);
    const third = await createSession(0, 2);

    const limited = repository.listSessionsForRecords({ learnerId: LEARNER, limit: 1 });
    expect(limited).toHaveLength(1);

    const summary = repository.summarizeSessionsForRecords({ learnerId: LEARNER });
    expect(summary.sessions).toBe(3);
    expect(summary.learners).toBe(1);
    expect(summary.correct).toBe(
      first.correctCount + second.correctCount + third.correctCount,
    );
    expect(summary.wrong).toBe(2);
    expect(summary.graded).toBe(summary.correct + summary.wrong);
    expect(summary.graded).toBeGreaterThan(limited.length);
  });
});

describe("答對題數及答對百分比篩選", () => {
  it("答對題數下限／上限只保留符合的練習", async () => {
    const all = recordsService.listPracticeRecords({ learnerId: LEARNER });
    const expected = all.filter((record) => record.correctCount >= 2);
    const filtered = recordsService.listPracticeRecords({
      learnerId: LEARNER,
      correctMin: 2,
    });
    expect(filtered.map((record) => record.sessionId).sort()).toEqual(
      expected.map((record) => record.sessionId).sort(),
    );

    const summary = repository.summarizeSessionsForRecords({ learnerId: LEARNER, correctMin: 2 });
    expect(summary.sessions).toBe(expected.length);
    // 兩次全對的練習各有 2 條答對題目
    expect(summary.correct).toBe(expected.length * 2);
    expect(summary.wrong).toBe(0);

    const none = repository.summarizeSessionsForRecords({ learnerId: LEARNER, correctMax: 0 });
    expect(none.sessions).toBe(1);
    expect(none.correct).toBe(0);
  });

  it("答對百分比篩選只計算有評分結果的練習", async () => {
    const perfect = repository.summarizeSessionsForRecords({ learnerId: LEARNER, accuracyMin: 100 });
    expect(perfect.sessions).toBe(2);
    expect(perfect.wrong).toBe(0);

    const lowest = repository.summarizeSessionsForRecords({ learnerId: LEARNER, accuracyMax: 50 });
    expect(lowest.sessions).toBe(1);
    expect(lowest.correct).toBe(0);

    const none = repository.summarizeSessionsForRecords({
      learnerId: LEARNER,
      accuracyMin: 90,
      accuracyMax: 10,
    });
    expect(none.sessions).toBe(0);
  });

  it("篩選條件同時套用於清單及統計", async () => {
    const list = recordsService.listPracticeRecords({
      learnerId: LEARNER,
      accuracyMin: 100,
      correctMin: 2,
    });
    const summary = repository.summarizeSessionsForRecords({
      learnerId: LEARNER,
      accuracyMin: 100,
      correctMin: 2,
    });
    expect(list).toHaveLength(2);
    expect(summary.sessions).toBe(2);
  });
});
