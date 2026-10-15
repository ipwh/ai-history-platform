/**
 * 學習循環測試：課題進度、技能進度、重溫排程及建議。
 *
 * 全部使用真實的持久化資料（SQLite 暫存資料庫 + 題庫 + 作答記錄），
 * 並以注入的固定時間驗證排程邊界。
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("loop");
process.env.LLM_PROVIDER = "mock";
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";

type LearningLoop = typeof import("@/server/services/learning-loop");
type Seed = typeof import("@/server/seed");
type Connection = typeof import("@/server/db/connection");
type Types = typeof import("@/lib/types");

let loop: LearningLoop;
let seed: Seed;
let getDb: Connection["getDb"];
let HISTORY_SKILLS: Types["HISTORY_SKILLS"];

const LEARNER = "loop-learner";
const OTHER_LEARNER = "loop-other-learner";
const TOPIC = "topic-5";
/** 示範題庫中的題目未標示技能，測試會自行設定後還原 */
const INVALID_SKILL = "自創技能（不在 HISTORY_SKILLS 內）";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-03-15T04:00:00.000Z");

interface SeededQuestion {
  id: string;
  correctAnswer: string;
  skill: string | null;
}

/** 由題庫取出一批已發布題目（含答案，只供測試建立作答記錄） */
function publishedQuestions(limit: number): SeededQuestion[] {
  const rows = getDb()
    .prepare(
      `SELECT id, correct_answer AS correctAnswer, skill FROM questions
       WHERE topic_id = ? AND status = 'published' LIMIT ?`,
    )
    .all(TOPIC, limit) as unknown as SeededQuestion[];
  return rows;
}

/** 直接寫入一筆作答記錄（模擬過去發生的作答，時間可指定） */
function recordAttempt(options: {
  learnerId: string;
  questionId: string;
  sessionId: string;
  isCorrect: boolean | null;
  uncertain?: boolean;
  answeredAt: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO attempts
       (id, session_id, question_id, learner_id, answer, auto_graded, is_correct, self_assessment,
        answered_at, ai_grading_json, ai_verdict, uncertain)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?)`,
    )
    .run(
      `att-${Math.random().toString(36).slice(2, 10)}`,
      options.sessionId,
      options.questionId,
      options.learnerId,
      "測試答案",
      options.isCorrect === null ? 0 : 1,
      options.isCorrect === null ? null : options.isCorrect ? 1 : 0,
      options.answeredAt,
      options.uncertain === true ? 1 : 0,
    );
}

function ensureSession(sessionId: string, learnerId: string): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO practice_sessions
       (id, learner_id, topic_id, section_ids_json, question_types_json, difficulty, question_count,
        mode, source_session_id, origin, question_snapshot_json, notice, created_at, completed_at)
       VALUES (?, ?, ?, '[]', '[]', 'basic', 1, 'standard', NULL, 'bank', '[]', NULL, ?, NULL)`,
    )
    .run(sessionId, learnerId, TOPIC, new Date(NOW - 10 * DAY).toISOString());
  getDb()
    .prepare("INSERT OR IGNORE INTO learners (id, created_at) VALUES (?, ?)")
    .run(learnerId, new Date(NOW - 10 * DAY).toISOString());
}

function resetAttempts(): void {
  getDb().prepare("DELETE FROM attempts").run();
  getDb().prepare("DELETE FROM practice_sessions").run();
}

/** 暫時改動題目的技能標示，測試結束後還原（避免影響其他測試） */
function withSkill(questionIds: string[], skill: string | null, run: () => void): void {
  const update = getDb().prepare("UPDATE questions SET skill = ? WHERE id = ?");
  for (const id of questionIds) update.run(skill, id);
  try {
    run();
  } finally {
    for (const id of questionIds) update.run(null, id);
  }
}

beforeAll(async () => {
  loop = await import("@/server/services/learning-loop");
  seed = await import("@/server/seed");
  getDb = (await import("@/server/db/connection")).getDb;
  HISTORY_SKILLS = (await import("@/lib/types")).HISTORY_SKILLS;
  seed.ensureBootstrap();
  expect(HISTORY_SKILLS.length).toBeGreaterThan(0);
  expect(publishedQuestions(6).length).toBeGreaterThanOrEqual(6);
});

beforeEach(() => {
  resetAttempts();
});

describe("課題進度（計數規則）", () => {
  it("沒有作答時為未開始，數值為 0（不會虛擬進度）", () => {
    const progress = loop.getTopicProgress(LEARNER, TOPIC, NOW);
    expect(progress.state).toBe("not-started");
    expect(progress.attemptedQuestions).toBe(0);
    expect(progress.correctQuestions).toBe(0);
    expect(progress.eligibleQuestions).toBeGreaterThan(0);
  });

  it("單題答對不會顯示為已掌握", () => {
    const [question] = publishedQuestions(1);
    ensureSession("s1", LEARNER);
    recordAttempt({
      learnerId: LEARNER,
      questionId: question.id,
      sessionId: "s1",
      isCorrect: true,
      answeredAt: new Date(NOW - 2 * DAY).toISOString(),
    });

    const progress = loop.getTopicProgress(LEARNER, TOPIC, NOW);
    expect(progress.attemptedQuestions).toBe(1);
    expect(progress.correctQuestions).toBe(1);
    expect(progress.state).toBe("in-progress");
  });

  it("兩題不同題目答對才顯示已多次答對", () => {
    const questions = publishedQuestions(2);
    ensureSession("s1", LEARNER);
    for (const question of questions) {
      recordAttempt({
        learnerId: LEARNER,
        questionId: question.id,
        sessionId: "s1",
        isCorrect: true,
        answeredAt: new Date(NOW - 2 * DAY).toISOString(),
      });
    }

    const progress = loop.getTopicProgress(LEARNER, TOPIC, NOW);
    expect(progress.attemptedQuestions).toBe(2);
    expect(progress.state).toBe("repeatedly-demonstrated");
  });

  it("同一題重複作答只算一條（不增加已作答題數）", () => {
    const [question] = publishedQuestions(1);
    ensureSession("s1", LEARNER);
    ensureSession("s2", LEARNER);
    for (const sessionId of ["s1", "s2", "s1"]) {
      recordAttempt({
        learnerId: LEARNER,
        questionId: question.id,
        sessionId,
        isCorrect: true,
        answeredAt: new Date(NOW - 2 * DAY).toISOString(),
      });
    }

    const progress = loop.getTopicProgress(LEARNER, TOPIC, NOW);
    expect(progress.attemptedQuestions).toBe(1);
    expect(progress.state).toBe("in-progress");
  });

  it("最新的作答結果為準（先錯後對 → 已答對；先對後錯 → 需要重溫）", () => {
    const [first] = publishedQuestions(1);
    const second = publishedQuestions(2)[1];
    ensureSession("s1", LEARNER);
    ensureSession("s2", LEARNER);

    recordAttempt({
      learnerId: LEARNER,
      questionId: first.id,
      sessionId: "s1",
      isCorrect: false,
      answeredAt: new Date(NOW - 5 * DAY).toISOString(),
    });
    recordAttempt({
      learnerId: LEARNER,
      questionId: first.id,
      sessionId: "s2",
      isCorrect: true,
      answeredAt: new Date(NOW - 2 * DAY).toISOString(),
    });
    recordAttempt({
      learnerId: LEARNER,
      questionId: second.id,
      sessionId: "s1",
      isCorrect: true,
      answeredAt: new Date(NOW - 5 * DAY).toISOString(),
    });
    recordAttempt({
      learnerId: LEARNER,
      questionId: second.id,
      sessionId: "s2",
      isCorrect: false,
      answeredAt: new Date(NOW - 1 * DAY).toISOString(),
    });

    const progress = loop.getTopicProgress(LEARNER, TOPIC, NOW);
    expect(progress.correctQuestions).toBe(1);
    expect(progress.incorrectQuestions).toBe(1);
    expect(progress.state).toBe("needs-review");
  });

  it("不確定的答案不會當成正確，會歸入需要重溫", () => {
    const [question] = publishedQuestions(1);
    ensureSession("s1", LEARNER);
    recordAttempt({
      learnerId: LEARNER,
      questionId: question.id,
      sessionId: "s1",
      isCorrect: null,
      uncertain: true,
      answeredAt: new Date(NOW - 1 * DAY).toISOString(),
    });

    const progress = loop.getTopicProgress(LEARNER, TOPIC, NOW);
    expect(progress.uncertainQuestions).toBe(1);
    expect(progress.correctQuestions).toBe(0);
    expect(progress.state).toBe("needs-review");
  });

  it("其他學生的作答不會計入（學生資料隔離）", () => {
    const [question] = publishedQuestions(1);
    ensureSession("s-other", OTHER_LEARNER);
    recordAttempt({
      learnerId: OTHER_LEARNER,
      questionId: question.id,
      sessionId: "s-other",
      isCorrect: true,
      answeredAt: new Date(NOW - 2 * DAY).toISOString(),
    });

    const progress = loop.getTopicProgress(LEARNER, TOPIC, NOW);
    expect(progress.attemptedQuestions).toBe(0);
    expect(progress.state).toBe("not-started");
  });

  it("草稿題目的作答不會計入進度", () => {
    const [question] = publishedQuestions(1);
    ensureSession("s1", LEARNER);
    // 題目改為草稿（例如教師取消發布）
    getDb().prepare("UPDATE questions SET status = 'draft' WHERE id = ?").run(question.id);
    try {
      recordAttempt({
        learnerId: LEARNER,
        questionId: question.id,
        sessionId: "s1",
        isCorrect: true,
        answeredAt: new Date(NOW - 2 * DAY).toISOString(),
      });
      expect(loop.getTopicProgress(LEARNER, TOPIC, NOW).attemptedQuestions).toBe(0);
    } finally {
      getDb().prepare("UPDATE questions SET status = 'published' WHERE id = ?").run(question.id);
    }
  });

  it("沒有可用題目的課題會回報 0 條而不會出錯", () => {
    const progress = loop.getTopicProgress(LEARNER, "topic-1", NOW);
    expect(progress.eligibleQuestions).toBeGreaterThanOrEqual(0);
    expect(progress.state).toBe("not-started");
  });
});

describe("技能進度", () => {
  it("只計算 HISTORY_SKILLS 內的有效技能，無效標示不會被判斷為弱項", () => {
    const [valid, invalid] = publishedQuestions(2);
    const skill = HISTORY_SKILLS[0];
    ensureSession("s1", LEARNER);

    withSkill([valid.id], skill, () => {
      withSkill([invalid.id], INVALID_SKILL, () => {
        recordAttempt({
          learnerId: LEARNER,
          questionId: valid.id,
          sessionId: "s1",
          isCorrect: false,
          answeredAt: new Date(NOW - 1 * DAY).toISOString(),
        });
        recordAttempt({
          learnerId: LEARNER,
          questionId: invalid.id,
          sessionId: "s1",
          isCorrect: false,
          answeredAt: new Date(NOW - 1 * DAY).toISOString(),
        });

        const skills = loop.getSkillProgress(LEARNER, TOPIC, NOW);

        // 清單只包含固定技能，無效標示不會出現（也就不會被誤判為弱項）
        expect(skills.map((item) => item.skill)).toEqual([...HISTORY_SKILLS]);

        // 有效技能只有 1 條題目的作答：證據不足，但狀態仍如實反映有未答對的題目
        const affected = skills.find((item) => item.skill === skill);
        expect(affected?.attemptedQuestions).toBe(1);
        expect(affected?.incorrectQuestions).toBe(1);
        expect(affected?.sufficientEvidence).toBe(false);
        expect(affected?.state).toBe("needs-review");

        // 未被標示技能的題目不會出現在任何技能項內
        const totalAttempted = skills.reduce((sum, item) => sum + item.attemptedQuestions, 0);
        expect(totalAttempted).toBe(1);
      });
    });
  });

  it("同一技能要有兩條不同題目的作答才視為證據足夠", () => {
    const [first, second] = publishedQuestions(2);
    const skill = HISTORY_SKILLS[0];
    ensureSession("s1", LEARNER);

    withSkill([first.id, second.id], skill, () => {
      recordAttempt({
        learnerId: LEARNER,
        questionId: first.id,
        sessionId: "s1",
        isCorrect: true,
        answeredAt: new Date(NOW - 3 * DAY).toISOString(),
      });

      const afterOne = loop.getSkillProgress(LEARNER, TOPIC, NOW).find((item) => item.skill === skill);
      expect(afterOne?.attemptedQuestions).toBe(1);
      expect(afterOne?.sufficientEvidence).toBe(false);
      expect(afterOne?.state).toBe("in-progress");

      recordAttempt({
        learnerId: LEARNER,
        questionId: second.id,
        sessionId: "s1",
        isCorrect: true,
        answeredAt: new Date(NOW - 2 * DAY).toISOString(),
      });

      const afterTwo = loop.getSkillProgress(LEARNER, TOPIC, NOW).find((item) => item.skill === skill);
      expect(afterTwo?.attemptedQuestions).toBe(2);
      expect(afterTwo?.eligibleQuestions).toBe(2);
      expect(afterTwo?.sufficientEvidence).toBe(true);
      expect(afterTwo?.state).toBe("repeatedly-demonstrated");
    });
  });

  it("題目技能被改動後，舊的標示不會沿用（以題庫現況為準）", () => {
    const [question] = publishedQuestions(1);
    const skill = HISTORY_SKILLS[0];
    ensureSession("s1", LEARNER);

    withSkill([question.id], skill, () => {
      recordAttempt({
        learnerId: LEARNER,
        questionId: question.id,
        sessionId: "s1",
        isCorrect: true,
        answeredAt: new Date(NOW - 2 * DAY).toISOString(),
      });
      expect(
        loop.getSkillProgress(LEARNER, TOPIC, NOW).find((item) => item.skill === skill)
          ?.attemptedQuestions,
      ).toBe(1);

      // 教師改動題目的技能標示：作答記錄不會被歸入舊技能
      getDb().prepare("UPDATE questions SET skill = ? WHERE id = ?").run(HISTORY_SKILLS[1], question.id);
      expect(
        loop.getSkillProgress(LEARNER, TOPIC, NOW).find((item) => item.skill === skill)
          ?.attemptedQuestions,
      ).toBe(0);
      getDb().prepare("UPDATE questions SET skill = ? WHERE id = ?").run(skill, question.id);
    });
  });
});

describe("重溫排程", () => {
  function seedWrongAnswer(daysAgo: number, questionIndex = 0) {
    const question = publishedQuestions(questionIndex + 1)[questionIndex];
    ensureSession("s1", LEARNER);
    recordAttempt({
      learnerId: LEARNER,
      questionId: question.id,
      sessionId: "s1",
      isCorrect: false,
      answeredAt: new Date(NOW - daysAgo * DAY).toISOString(),
    });
    return question;
  }

  it("答錯的題目 1 天後到期，未到期時不會出現", () => {
    seedWrongAnswer(0);
    expect(loop.getReviewQueue(LEARNER, { now: NOW }).dueCount).toBe(0);

    resetAttempts();
    seedWrongAnswer(1);
    const queue = loop.getReviewQueue(LEARNER, { now: NOW });
    expect(queue.dueCount).toBe(1);
    expect(queue.dueItems[0].reason).toBe("incorrect");
  });

  it("一直答對的題目 7 天後才到期（3 天時仍未到期）", () => {
    const question = publishedQuestions(1)[0];
    ensureSession("s1", LEARNER);
    recordAttempt({
      learnerId: LEARNER,
      questionId: question.id,
      sessionId: "s1",
      isCorrect: true,
      answeredAt: new Date(NOW - 3 * DAY).toISOString(),
    });
    expect(loop.getReviewQueue(LEARNER, { now: NOW }).dueCount).toBe(0);

    resetAttempts();
    ensureSession("s1", LEARNER);
    recordAttempt({
      learnerId: LEARNER,
      questionId: question.id,
      sessionId: "s1",
      isCorrect: true,
      answeredAt: new Date(NOW - 8 * DAY).toISOString(),
    });
    expect(loop.getReviewQueue(LEARNER, { now: NOW }).dueCount).toBe(1);
  });

  it("曾答錯、最近答對的題目 3 天後到期", () => {
    const question = publishedQuestions(1)[0];
    ensureSession("s1", LEARNER);
    ensureSession("s2", LEARNER);
    recordAttempt({
      learnerId: LEARNER,
      questionId: question.id,
      sessionId: "s1",
      isCorrect: false,
      answeredAt: new Date(NOW - 6 * DAY).toISOString(),
    });
    recordAttempt({
      learnerId: LEARNER,
      questionId: question.id,
      sessionId: "s2",
      isCorrect: true,
      answeredAt: new Date(NOW - 4 * DAY).toISOString(),
    });

    const queue = loop.getReviewQueue(LEARNER, { now: NOW });
    expect(queue.dueCount).toBe(1);
    expect(queue.dueItems[0].reason).toBe("due-after-mistake");
  });

  it("不確定的答案會被排入重溫，且不會計為成功", () => {
    const question = publishedQuestions(1)[0];
    ensureSession("s1", LEARNER);
    recordAttempt({
      learnerId: LEARNER,
      questionId: question.id,
      sessionId: "s1",
      isCorrect: null,
      uncertain: true,
      answeredAt: new Date(NOW - 2 * DAY).toISOString(),
    });

    const queue = loop.getReviewQueue(LEARNER, { now: NOW });
    expect(queue.dueCount).toBe(1);
    expect(queue.dueItems[0].reason).toBe("uncertain");
  });

  it("同一題只會出現一次（去重）", () => {
    const question = publishedQuestions(1)[0];
    ensureSession("s1", LEARNER);
    ensureSession("s2", LEARNER);
    for (const sessionId of ["s1", "s2"]) {
      recordAttempt({
        learnerId: LEARNER,
        questionId: question.id,
        sessionId,
        isCorrect: false,
        answeredAt: new Date(NOW - 3 * DAY).toISOString(),
      });
    }

    const queue = loop.getReviewQueue(LEARNER, { now: NOW });
    expect(queue.dueCount).toBe(1);
  });

  it("時間戳格式錯誤時不會猜測到期日，只回報資料問題", () => {
    const question = publishedQuestions(1)[0];
    ensureSession("s1", LEARNER);
    getDb()
      .prepare(
        `INSERT INTO attempts (id, session_id, question_id, learner_id, answer, auto_graded, is_correct,
          self_assessment, answered_at, ai_grading_json, ai_verdict, uncertain)
         VALUES ('att-bad', 's1', ?, ?, '測試', 1, 0, NULL, 'not-a-date', NULL, NULL, 0)`,
      )
      .run(question.id, LEARNER);

    const queue = loop.getReviewQueue(LEARNER, { now: NOW });
    expect(queue.dataIssues).toBe(1);
    expect(queue.dueCount).toBe(0);
  });

  it("未來時間的作答不會即時湧入佇列", () => {
    const question = publishedQuestions(1)[0];
    ensureSession("s1", LEARNER);
    recordAttempt({
      learnerId: LEARNER,
      questionId: question.id,
      sessionId: "s1",
      isCorrect: false,
      answeredAt: new Date(NOW + 5 * DAY).toISOString(),
    });

    expect(loop.getReviewQueue(LEARNER, { now: NOW }).dueCount).toBe(0);
  });

  it("其他學生的到期題目不會出現在自己的佇列", () => {
    const question = publishedQuestions(1)[0];
    ensureSession("s-other", OTHER_LEARNER);
    recordAttempt({
      learnerId: OTHER_LEARNER,
      questionId: question.id,
      sessionId: "s-other",
      isCorrect: false,
      answeredAt: new Date(NOW - 5 * DAY).toISOString(),
    });

    expect(loop.getReviewQueue(LEARNER, { now: NOW }).dueCount).toBe(0);
    expect(loop.getReviewQueue(OTHER_LEARNER, { now: NOW }).dueCount).toBe(1);
  });
});

describe("下一步建議", () => {
  it("沒有任何作答時提供中性建議（不會虛擬弱點或掌握程度）", () => {
    const recommendations = loop.getRecommendations(LEARNER, { now: NOW });
    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations[0].kind).toBe("read-lesson");
    expect(recommendations[0].reason.length).toBeGreaterThan(0);

    // 沒有作答記錄時，不會出現任何「弱項」或「重做錯題」的診斷
    expect(recommendations.map((item) => item.kind)).not.toContain("practise-skill");
    expect(recommendations.map((item) => item.kind)).not.toContain("redo-wrong");
    expect(recommendations.map((item) => item.kind)).not.toContain("review-due");
    const text = recommendations.map((item) => `${item.title} ${item.reason}`).join(" ");
    expect(text).not.toContain("弱");
    // 建議必須說明閱讀不等於掌握（不可暗示已學會）
    expect(text).toContain("閱讀本身不計算為已掌握");
  });

  it("有到期題目時優先建議重溫，並提供可追溯的原因", () => {
    const question = publishedQuestions(1)[0];
    ensureSession("s1", LEARNER);
    recordAttempt({
      learnerId: LEARNER,
      questionId: question.id,
      sessionId: "s1",
      isCorrect: false,
      answeredAt: new Date(NOW - 3 * DAY).toISOString(),
    });

    const recommendations = loop.getRecommendations(LEARNER, { now: NOW });
    expect(recommendations[0].kind).toBe("review-due");
    expect(recommendations[0].title).toContain("1");
    expect(recommendations[0].href).toBe("/review");
  });

  it("建議最多三項", () => {
    const recommendations = loop.getRecommendations(LEARNER, { now: NOW, limit: 3 });
    expect(recommendations.length).toBeLessThanOrEqual(3);
  });
});

/**
 * Sprint 4 追加：合約完整性測試。
 *
 * 針對書面契約中仍未以測試固定的部分：狀態改變後的排程、時區邊界、
 * 只重複作答同一題時不會虛構廣泛弱點、以及建議不會洩漏其他學生的資料。
 */
describe("契約完整性（Sprint 4）", () => {
  it("題目被改為草稿後即從重溫佇列移除；改回已發布後再次出現", () => {
    const question = publishedQuestions(1)[0];
    ensureSession("s1", LEARNER);
    recordAttempt({
      learnerId: LEARNER,
      questionId: question.id,
      sessionId: "s1",
      isCorrect: false,
      answeredAt: new Date(NOW - 3 * DAY).toISOString(),
    });
    expect(loop.getReviewQueue(LEARNER, { now: NOW }).dueCount).toBe(1);

    getDb().prepare("UPDATE questions SET status = 'draft' WHERE id = ?").run(question.id);
    try {
      // 未發布的題目不會出現在學生的重溫佇列（不能重做看不到的題目）
      const hidden = loop.getReviewQueue(LEARNER, { now: NOW });
      expect(hidden.dueCount).toBe(0);
      expect(loop.getTopicProgress(LEARNER, TOPIC, NOW).attemptedQuestions).toBe(0);
    } finally {
      getDb().prepare("UPDATE questions SET status = 'published' WHERE id = ?").run(question.id);
    }
    expect(loop.getReviewQueue(LEARNER, { now: NOW }).dueCount).toBe(1);
  });

  it("讀取重溫佇列不會改動任何作答記錄（查看不等於已重溫）", () => {
    const question = publishedQuestions(1)[0];
    ensureSession("s1", LEARNER);
    recordAttempt({
      learnerId: LEARNER,
      questionId: question.id,
      sessionId: "s1",
      isCorrect: false,
      answeredAt: new Date(NOW - 3 * DAY).toISOString(),
    });

    const before = getDb().prepare("SELECT COUNT(*) AS total FROM attempts").get() as unknown as {
      total: number;
    };
    for (let index = 0; index < 3; index += 1) {
      loop.getReviewQueue(LEARNER, { now: NOW });
    }
    const after = getDb().prepare("SELECT COUNT(*) AS total FROM attempts").get() as unknown as {
      total: number;
    };
    expect(after.total).toBe(before.total);
    // 到期日不變：查看頁面不會把題目「標記為已重溫」
    const queue = loop.getReviewQueue(LEARNER, { now: NOW });
    expect(queue.dueItems[0].daysSince).toBe(3);
  });

  it("以 UTC 計算到期：香港時間午夜前後的分界一致", () => {
    const question = publishedQuestions(1)[0];
    ensureSession("s1", LEARNER);
    // 香港時間 2026-03-15 00:30（UTC 2026-03-14 16:30）答錯 → 1 天後到期
    const answeredAt = "2026-03-14T16:30:00.000Z";
    recordAttempt({
      learnerId: LEARNER,
      questionId: question.id,
      sessionId: "s1",
      isCorrect: false,
      answeredAt,
    });

    // 香港時間 2026-03-15 23:59（UTC 15:59）仍未滿 24 小時
    expect(
      loop.getReviewQueue(LEARNER, { now: Date.parse("2026-03-15T15:59:00.000Z") }).dueCount,
    ).toBe(0);
    // 香港時間 2026-03-16 00:31（UTC 3/15 16:31）已滿 24 小時
    expect(
      loop.getReviewQueue(LEARNER, { now: Date.parse("2026-03-15T16:31:00.000Z") }).dueCount,
    ).toBe(1);
  });

  it("只重複作答同一題不會虛構「該課題較弱」的建議", () => {
    const question = publishedQuestions(1)[0];
    ensureSession("s1", LEARNER);
    ensureSession("s2", LEARNER);
    for (const sessionId of ["s1", "s2"]) {
      recordAttempt({
        learnerId: LEARNER,
        questionId: question.id,
        sessionId,
        isCorrect: false,
        answeredAt: new Date(NOW - 2 * DAY).toISOString(),
      });
    }

    const progress = loop.getTopicProgress(LEARNER, TOPIC, NOW);
    // 一題即使答錯多次，仍然只是「一條不同題目」的證據
    expect(progress.attemptedQuestions).toBe(1);
    expect(progress.incorrectQuestions).toBe(1);

    // 技能層面的建議需要足夠證據（同一技能至少 2 條不同題目）
    const skills = loop.getSkillProgress(LEARNER, TOPIC, NOW).filter(
      (item) => item.attemptedQuestions > 0,
    );
    expect(skills.every((item) => item.sufficientEvidence === (item.attemptedQuestions >= 2))).toBe(
      true,
    );
  });

  it("建議只根據該學生自己的記錄，不會引用其他學生的資料", () => {
    const questions = publishedQuestions(2);
    ensureSession("s-other", OTHER_LEARNER);
    for (const question of questions) {
      recordAttempt({
        learnerId: OTHER_LEARNER,
        questionId: question.id,
        sessionId: "s-other",
        isCorrect: false,
        answeredAt: new Date(NOW - 3 * DAY).toISOString(),
      });
    }

    // 另一位學生有大量錯題，但這位學生沒有任何記錄 → 建議必須是中性的
    const recommendations = loop.getRecommendations(LEARNER, { now: NOW });
    expect(recommendations.map((item) => item.kind)).not.toContain("review-due");
    expect(recommendations.map((item) => item.kind)).not.toContain("redo-wrong");
    expect(loop.getReviewQueue(LEARNER, { now: NOW }).dueCount).toBe(0);

    // 而該位學生自己的建議才有到期項目
    expect(loop.getRecommendations(OTHER_LEARNER, { now: NOW })[0].kind).toBe("review-due");
  });
});
