/**
 * 模擬學生使用情況（透過 HTTP 呼叫正在運行的網站）。
 *
 * 用法：
 *   node scripts/simulate-student-usage.mjs                     # 預設 http://127.0.0.1:3101
 *   node scripts/simulate-student-usage.mjs --base-url http://127.0.0.1:3000
 *   node scripts/simulate-student-usage.mjs --random 10         # 額外隨機組合次數
 *   node scripts/simulate-student-usage.mjs --no-ai             # 跳過即時生成
 *
 * 覆蓋範圍：
 *   1. 12 個課題 × 不同題型組合（選擇題／填充題／兩者混合）× 三種難度 × 不同題目數量，
 *      走完「建立練習 → 逐題作答 → 完成練習 → 查看成績」的完整學生流程。
 *   2. 題目內容契約：題型、分節歸屬、選項、空格、是否派發未發布／待教師確認的題目。
 *   3. 評分契約：正確答案必須判為正確、錯誤答案不可判為正確、重複提交不可改變分數、
 *      空白答案不可提交、不可提交不屬於這次練習的題目、不可讀取他人的練習。
 *   4. 重做錯題、學生回報、學習進度、重溫佇列、閱讀教材。
 *   5. 邊界與錯誤輸入：題數 0／31、不存在的題型／難度／課題／分節、沒有題目的分節。
 *
 * 任何異常都會列印原因及相關詳情，並以非零狀態結束；完整報告寫入 --report。
 *
 * 需要讀取資料庫以核對「標準答案」及「題目狀態」（學生端 API 刻意不回傳這些資料），
 * 因此本腳本只可在本機測試環境執行；資料庫路徑由 --database 指定。
 */
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
function arg(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const BASE_URL = arg("--base-url", process.env.SIM_BASE_URL ?? "http://127.0.0.1:3101");
const DB_PATH = arg("--database", process.env.SIM_DATABASE ?? "data/tmp-sim/app.db");
const RANDOM_COUNT = Number.parseInt(arg("--random", "6"), 10);
const INCLUDE_AI = !args.includes("--no-ai");
/** 只測試即時生成（真實模型時可減少費用） */
const AI_ONLY = args.includes("--ai-only");
/** 只測試指定課題（例如 --topics topic-1,topic-5） */
const ONLY_TOPICS = (arg("--topics", "") ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
const LEARNER = arg("--learner", `sim-${Date.now().toString(36)}`);
const OTHER_LEARNER = `${LEARNER}-other`;

const anomalies = [];
const info = [];
/**
 * 「要求 N 題、實際較少」的個案。
 *
 * 這是平台**如實告知**的降級結果（教材不足或題目未通過檢查），不是錯誤，因此不計入
 * anomalies（不會令模擬失敗）；但必須逐項列出，否則「學生選 10 題只拿到 5 題」這類
 * 問題會在模擬中靜靜消失（2026-10-20 實際發生過）。
 */
const shortfalls = [];
let checksRun = 0;
let practicesRun = 0;
let answersRun = 0;

function anomaly(category, message, detail = null) {
  anomalies.push({ category, message, detail });
}

function note(message) {
  info.push(message);
}

function check(condition, category, message, detail = null) {
  checksRun += 1;
  if (!condition) anomaly(category, message, detail);
  return condition;
}

async function call(method, url, body) {
  const started = Date.now();
  let response;
  try {
    response = await fetch(`${BASE_URL}${url}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    anomaly("network", `${method} ${url} 無法連線`, String(error));
    return { status: 0, payload: null, ms: Date.now() - started, text: null };
  }
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  let payload = null;
  if (text.length > 0 && contentType.includes("json")) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { parseError: text.slice(0, 200) };
    }
  }
  return { status: response.status, payload, ms: Date.now() - started, text: payload ? null : text.slice(0, 200) };
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });

function bankQuestion(questionId) {
  return db
    .prepare(
      `SELECT id, question_type AS questionType, correct_answer AS correctAnswer,
              status, teacher_confirmation_required AS teacherConfirmationRequired
         FROM questions WHERE id = ?`,
    )
    .get(questionId);
}

function snapshotOf(sessionId) {
  const row = db
    .prepare("SELECT question_snapshot_json AS json FROM practice_sessions WHERE id = ?")
    .get(sessionId);
  if (!row) return null;
  try {
    return JSON.parse(row.json);
  } catch {
    return null;
  }
}

function sectionOfTopic(sectionId) {
  return db.prepare("SELECT topic_id AS topicId, title FROM sections WHERE id = ?").get(sectionId);
}

function textOf(value) {
  return typeof value === "string" ? value.trim() : "";
}

/* ------------------------------------------------------------------ */
/* 課題與分節                                                          */
/* ------------------------------------------------------------------ */

async function loadTopics() {
  const response = await call("GET", `/api/topics?learnerId=${LEARNER}`);
  check(response.status === 200, "topics", `GET /api/topics 回應 ${response.status}`);
  const topics = response.payload?.topics ?? [];
  check(topics.length === 12, "topics", `課題數應為 12，實際 ${topics.length}`);

  const details = [];
  for (const topic of topics) {
    const detail = await call("GET", `/api/topics/${topic.id}?learnerId=${LEARNER}`);
    if (detail.status !== 200) {
      anomaly("topics", `讀取課題 ${topic.id} 失敗（${detail.status}）`);
      continue;
    }
    const sections = [];
    for (const section of detail.payload.topic.sections ?? []) {
      sections.push({
        id: section.id,
        title: section.title,
        publishedQuestionCount: section.publishedQuestionCount ?? 0,
        parentId: null,
      });
      for (const child of section.children ?? []) {
        sections.push({
          id: child.id,
          title: child.title,
          publishedQuestionCount: child.publishedQuestionCount ?? 0,
          parentId: section.id,
        });
      }
    }
    details.push({ ...topic, sections });
  }
  return details;
}

function expandSections(topicSections, selectedIds) {
  const expanded = new Set();
  for (const id of selectedIds) {
    expanded.add(id);
    for (const section of topicSections) {
      if (section.parentId === id) expanded.add(section.id);
    }
  }
  return expanded;
}

/* ------------------------------------------------------------------ */
/* 練習內容檢查                                                        */
/* ------------------------------------------------------------------ */

function validateQuestions(practice, setup, topicSections) {
  const questions = practice.questions ?? [];
  const session = practice.session ?? {};
  const allowedSections = expandSections(topicSections, setup.sectionIds);
  const label = `${setup.topicId} ${setup.questionTypes.join("+")} ${setup.difficulty} ×${setup.questionCount}（${setup.questionSource ?? "bank"}）`;

  if (questions.length === 0) {
    anomaly("zero-questions", `練習建立了 0 題：${label}`, { notice: practice.notice ?? null });
    return questions;
  }
  if (questions.length > setup.questionCount) {
    anomaly("too-many-questions", `交付題數 ${questions.length} 多於要求的 ${setup.questionCount}：${label}`);
  }
  if (questions.length < setup.questionCount) {
    shortfalls.push({
      label,
      requested: setup.questionCount,
      delivered: questions.length,
      notice: practice.notice ?? null,
    });
  }
  if (session.questionCount !== questions.length) {
    anomaly("session-count-mismatch", `session.questionCount=${session.questionCount} 但實際交付 ${questions.length} 題：${label}`);
  }
  if (session.topicId !== setup.topicId) {
    anomaly("wrong-topic", `練習屬於 ${session.topicId}，要求的卻是 ${setup.topicId}`);
  }

  const seen = new Set();
  for (const question of questions) {
    if (seen.has(question.id)) {
      anomaly("duplicate-question", `同一份練習出現重複題目 ${question.id}：${label}`);
    }
    seen.add(question.id);

    if (!allowedSections.has(question.sectionId)) {
      anomaly("wrong-section", `題目 ${question.id} 屬於未選取的分節 ${question.sectionId}：${label}`, {
        selected: setup.sectionIds,
      });
    }
    if (!setup.questionTypes.includes(question.questionType)) {
      anomaly("wrong-type", `題目 ${question.id} 題型為 ${question.questionType}，不在要求的 ${setup.questionTypes.join("/")} 內`);
    }
    if (textOf(question.question).length === 0) {
      anomaly("empty-field", `題目 ${question.id} 沒有題幹：${label}`);
    }
    if (textOf(question.sectionId).length === 0) {
      anomaly("empty-field", `題目 ${question.id} 沒有分節：${label}`);
    }

    if (question.questionType === "mc") {
      const options = question.options ?? [];
      if (options.length < 2) {
        anomaly("mc-options", `選擇題 ${question.id} 只有 ${options.length} 個選項：${label}`);
      }
      if (new Set(options.map((option) => textOf(option))).size !== options.length) {
        anomaly("mc-options", `選擇題 ${question.id} 有重複選項：${label}`, options);
      }
      if (options.some((option) => textOf(option).length === 0)) {
        anomaly("mc-options", `選擇題 ${question.id} 有空選項：${label}`);
      }
    } else if (question.questionType === "fill") {
      if (!/[_＿]{2,}/.test(question.question)) {
        anomaly("fill-blank", `填充題 ${question.id} 沒有空格：${question.question}`);
      }
    } else {
      anomaly("wrong-type", `出現未知題型 ${question.questionType}：${question.id}`);
    }

    const row = bankQuestion(question.id);
    if (row) {
      if (row.status !== "published") {
        anomaly("unpublished-served", `題庫題目 ${question.id} 狀態為 ${row.status} 卻派給學生：${label}`);
      }
      if (row.teacherConfirmationRequired === 1) {
        anomaly("flagged-served", `標示「待教師確認」的題目 ${question.id} 卻派給學生：${label}`);
      }
    } else if ((setup.questionSource ?? "bank") === "bank") {
      note(`題庫模式練習包含不在題庫的即時生成題目（${label}）`);
    }
  }

  const notice = practice.notice ?? "";
  const sentences = notice.split(/(?<=。)/).map((part) => part.trim()).filter((part) => part.length > 0);
  if (new Set(sentences).size !== sentences.length) {
    anomaly("notice-duplicate", `練習通知有重複句子：${label}`, notice);
  }

  const otherDifficulty = questions.filter((question) => question.difficulty !== setup.difficulty);
  if (otherDifficulty.length > 0 && !notice.includes("難度")) {
    anomaly("difficulty-silent", `題目難度與所選不同卻沒有說明：${label}`);
  }

  return questions;
}

/* ------------------------------------------------------------------ */
/* 作答、評分與完成                                                    */
/* ------------------------------------------------------------------ */

async function submitAnswers(practice, { answerMode }) {
  const questions = practice.questions ?? [];
  const sessionId = practice.session.id;
  const snapshot = snapshotOf(sessionId) ?? [];
  const snapshotById = new Map(snapshot.map((question) => [question.id, question]));
  const wrongIds = [];

  for (const [index, studentQuestion] of questions.entries()) {
    const source = snapshotById.get(studentQuestion.id) ?? {};
    const correctAnswer = textOf(source.correctAnswer);
    const questionType = studentQuestion.questionType;

    // 結構檢查（以練習快照的完整內容核對）：
    //   - 填充題必須剛好一個空格，且答案不可仍出現在題幹其他位置；
    //   - 選擇題的答案不可已出現在題幹，選項不可重複或空白。
    const stem = textOf(source.question ?? studentQuestion.question);
    const blankCount = (stem.match(/[＿_]{2,}/g) ?? []).length;
    if (questionType === "fill") {
      if (blankCount !== 1) {
        anomaly("fill-blank", `填充題的空格數為 ${blankCount}（應為 1）：${studentQuestion.id}`, {
          question: stem.slice(0, 80),
        });
      } else if (correctAnswer.length >= 2 && stem.replace(/[＿_]{2,}/g, "").includes(correctAnswer)) {
        anomaly("fill-leak", `填充題的答案仍出現在題幹：${studentQuestion.id}`, {
          answer: correctAnswer,
          question: stem.slice(0, 80),
        });
      }
    }
    if (questionType === "mc") {
      const options = (studentQuestion.options ?? []).map((option) => textOf(option));
      if (correctAnswer.length >= 2 && stem.includes(correctAnswer)) {
        anomaly("mc-leak", `選擇題的答案已印在題幹中：${studentQuestion.id}`, {
          answer: correctAnswer,
          question: stem.slice(0, 80),
        });
      }
      if (!options.includes(correctAnswer)) {
        anomaly("mc-answer", `選擇題的答案不在選項內：${studentQuestion.id}`, {
          answer: correctAnswer,
          options,
        });
      }
    }

    let answer;
    if (answerMode === "correct") {
      answer = correctAnswer;
    } else if (questionType === "mc") {
      const options = studentQuestion.options ?? [];
      answer = options.find((option) => textOf(option) !== correctAnswer) ?? options[0] ?? "";
    } else {
      answer = `${correctAnswer}XYZ錯誤`;
    }
    if (!answer) {
      anomaly("cannot-answer", `無法為題目 ${studentQuestion.id} 構造答案（缺少標準答案）`, {
        snapshotFound: snapshotById.has(studentQuestion.id),
      });
      continue;
    }

    const submitted = await call("POST", `/api/practice/${sessionId}/answers`, {
      learnerId: LEARNER,
      questionId: studentQuestion.id,
      answer,
    });
    answersRun += 1;
    if (submitted.status !== 200) {
      anomaly("submit-failed", `提交答案失敗（HTTP ${submitted.status}）：${textOf(submitted.payload?.error) || submitted.text || ""}`, {
        sessionId,
        questionId: studentQuestion.id,
        answer,
      });
      continue;
    }
    const feedback = submitted.payload?.feedback ?? {};

    if (answerMode === "correct") {
      check(
        feedback.isCorrect === true,
        "grading",
        `提交標準答案卻未被判為正確（${questionType}）：${studentQuestion.question.slice(0, 40)}`,
        { answer, correctAnswer: feedback.correctAnswer, reviewFlag: feedback.reviewFlag, aiGrading: feedback.aiGrading ?? null },
      );
    } else {
      if (feedback.isCorrect === true) {
        anomaly("grading", `提交錯誤答案卻被判為正確（${questionType}）：${studentQuestion.question.slice(0, 40)}`, {
          answer,
          correctAnswer: feedback.correctAnswer,
        });
      }
      wrongIds.push(studentQuestion.id);
    }

    if (!feedback.explanation) {
      anomaly("feedback", `作答後沒有解釋：${studentQuestion.id}`);
    }
    if (correctAnswer && textOf(feedback.correctAnswer) !== correctAnswer) {
      anomaly("feedback", `回饋的標準答案與練習快照不一致：${studentQuestion.id}`);
    }

    if (index === 0) {
      const repeat = await call("POST", `/api/practice/${sessionId}/answers`, {
        learnerId: LEARNER,
        questionId: studentQuestion.id,
        answer: answerMode === "correct" ? "另一個答案" : correctAnswer,
      });
      if (repeat.status !== 200) {
        anomaly("repeat-submit", `重複提交答案失敗（HTTP ${repeat.status}）：${studentQuestion.id}`);
      } else if (repeat.payload?.recorded !== false) {
        anomaly("repeat-submit", `重複提交被當成新作答（recorded=${repeat.payload?.recorded}）：${studentQuestion.id}`);
      } else if (repeat.payload?.feedback?.isCorrect !== feedback.isCorrect) {
        anomaly("repeat-submit", `重複提交改變了分數：${studentQuestion.id}`);
      }
    }
  }

  return { wrongIds };
}

async function runPractice(topic, setup, options = {}) {
  practicesRun += 1;
  const created = await call("POST", "/api/practice", {
    learnerId: LEARNER,
    topicId: topic.id,
    sectionIds: setup.sectionIds,
    questionTypes: setup.questionTypes,
    difficulty: setup.difficulty,
    questionCount: setup.questionCount,
    mode: setup.mode ?? "standard",
    ...(setup.questionSource ? { questionSource: setup.questionSource } : {}),
    ...(setup.sourceSessionId ? { sourceSessionId: setup.sourceSessionId } : {}),
  });

  const label = `${setup.topicId} ${setup.questionTypes.join("+")} ${setup.difficulty} ×${setup.questionCount}（${setup.questionSource ?? "bank"}）`;

  if (created.status !== 201) {
    const errorText = textOf(created.payload?.error) || created.text || "";
    const generationFailed =
      (setup.questionSource === "ai" || created.status === 502) &&
      /未能生成|未能為所選主題生成題目/.test(errorText);
    if (generationFailed) {
      // 真實模型的輸出未通過教材依據／品質檢查時，平台會如實回報「未能生成」並建議改用題庫。
      // 這是設計中的降級（不會派未核實的題目），只記錄次數，不當作缺陷。
      note(`即時生成未能提供題目（${label}）：${errorText.slice(0, 60)}…`);
    } else if (created.status >= 500) {
      anomaly("http-5xx", `建立練習回應 ${created.status}：${label}`, { error: errorText });
    } else if (created.status === 409) {
      note(`建立練習被拒（409：${errorText.slice(0, 50)}…）：${label}`);
    } else {
      anomaly("create-rejected", `建立練習失敗（HTTP ${created.status}）：${label}`, { error: errorText });
    }
    return null;
  }

  const practice = created.payload;
  const questions = validateQuestions(practice, setup, topic.sections);
  if (questions.length === 0) return null;

  // 空白答案必須在「未作答」時才被拒絕；已作答的題目會回傳原有結果。
  const blank = await call("POST", `/api/practice/${practice.session.id}/answers`, {
    learnerId: LEARNER,
    questionId: practice.questions[0].id,
    answer: "",
  });
  if (blank.status === 200) {
    anomaly("blank-answer", `空白答案被接受：${practice.questions[0].id}`);
  }

  const { wrongIds } = await submitAnswers(practice, { answerMode: options.answerMode ?? "correct" });

  const completed = await call("POST", `/api/practice/${practice.session.id}/complete`, { learnerId: LEARNER });
  if (completed.status !== 200) {
    anomaly("complete-failed", `完成練習失敗（HTTP ${completed.status}）：${label}`);
  } else {
    const result = completed.payload;
    if (result.totalQuestions !== questions.length) {
      anomaly("result-count", `成績的題目總數 ${result.totalQuestions} 與交付 ${questions.length} 不符：${label}`);
    }
    if (result.answeredCount !== questions.length) {
      anomaly("result-count", `成績的已作答數 ${result.answeredCount} 與交付 ${questions.length} 不符：${label}`);
    }
    if (options.answerMode === "correct" && result.correctCount !== questions.length) {
      anomaly("result-count", `全部答對但成績只有 ${result.correctCount}/${questions.length} 正確：${label}`, {
        reviewFlags: (result.feedback ?? []).filter((item) => item.reviewFlag).length,
      });
    }
    if (!Array.isArray(result.feedback) || result.feedback.length !== questions.length) {
      anomaly("result-count", `成績缺少部分題目回饋：${label}`);
    }

    // 重新載入練習頁及成績頁時內容要一致（學生會重新整理）
    const reopened = await call("GET", `/api/practice/${practice.session.id}?learnerId=${LEARNER}`);
    check(reopened.status === 200, "reopen", `重新載入練習回應 ${reopened.status}：${label}`);
    if (reopened.status === 200) {
      if ((reopened.payload?.questions ?? []).length !== questions.length) {
        anomaly("reopen", `重新載入後題目數目不符：${label}`);
      }
      if (textOf(reopened.payload?.notice) !== textOf(practice.notice)) {
        anomaly("reopen", `重新載入後練習通知改變：${label}`);
      }
    }
    const resultView = await call(
      "GET",
      `/api/practice/${practice.session.id}/result?learnerId=${LEARNER}`,
    );
    check(resultView.status === 200, "result-view", `讀取成績頁回應 ${resultView.status}：${label}`);
    if (resultView.status === 200 && (resultView.payload?.feedback ?? []).length !== questions.length) {
      anomaly("result-view", `成績頁的題目回饋數目不符：${label}`);
    }
  }

  const stolen = await call("GET", `/api/practice/${practice.session.id}?learnerId=${OTHER_LEARNER}`);
  check(stolen.status === 403, "isolation", `其他學習者可讀取練習記錄（HTTP ${stolen.status}）`, {
    sessionId: practice.session.id,
  });
  const stolenComplete = await call("POST", `/api/practice/${practice.session.id}/complete`, { learnerId: OTHER_LEARNER });
  check(stolenComplete.status === 403, "isolation", `其他學習者可完成練習（HTTP ${stolenComplete.status}）`);

  const foreign = await call("POST", `/api/practice/${practice.session.id}/answers`, {
    learnerId: LEARNER,
    questionId: "q_not_in_session",
    answer: "測試",
  });
  check(foreign.status === 404, "submit-scope", `提交不屬於練習的題目回應 ${foreign.status}（應為 404）`);

  return { sessionId: practice.session.id, questions, wrongIds };
}

/* ------------------------------------------------------------------ */
/* 情境                                                               */
/* ------------------------------------------------------------------ */

function pickSections(topic, mode) {
  const withQuestions = topic.sections.filter((section) => section.publishedQuestionCount > 0);
  switch (mode) {
    case "single":
      return [withQuestions[0]?.id ?? topic.sections[0].id];
    case "parent":
      return [topic.sections.find((section) => section.parentId === null)?.id ?? topic.sections[0].id];
    case "all":
      return topic.sections.filter((section) => section.parentId === null).map((section) => section.id);
    default:
      return withQuestions.slice(0, 3).map((section) => section.id);
  }
}

async function main() {
  console.log(`模擬學生使用：${BASE_URL}（學習者 ${LEARNER}，資料庫 ${DB_PATH}）`);
  const health = await call("GET", "/api/health");
  if (health.status !== 200) {
    console.error(`無法連線到 ${BASE_URL}（HTTP ${health.status}），請先啟動伺服器。`);
    process.exit(1);
  }
  note(`伺服器 LLM provider：${health.payload?.llmProvider}`);

  const topics = (await loadTopics()).filter(
    (topic) => ONLY_TOPICS.length === 0 || ONLY_TOPICS.includes(topic.id),
  );
  if (topics.length === 0) {
    console.error("沒有可練習的課題。");
    process.exit(1);
  }

  console.log(`\n[A] 逐課題測試（${topics.length} 個課題）`);
  for (const topic of topics) {
    const withQuestions = topic.sections.filter((section) => section.publishedQuestionCount > 0);
    console.log(`  · ${topic.id}（${withQuestions.length} 個有題目的分節）`);
    if (!AI_ONLY) {
      await runPractice(topic, {
        topicId: topic.id,
        sectionIds: pickSections(topic, "single"),
        questionTypes: ["mc"],
        difficulty: "basic",
        questionCount: 5,
      });
      await runPractice(topic, {
        topicId: topic.id,
        sectionIds: pickSections(topic, "few"),
        questionTypes: ["fill"],
        difficulty: "advanced",
        questionCount: 5,
      });
      await runPractice(topic, {
        topicId: topic.id,
        sectionIds: pickSections(topic, "parent"),
        questionTypes: ["mc", "fill"],
        difficulty: "challenge",
        questionCount: 10,
      });
    }
    if (INCLUDE_AI) {
      await runPractice(topic, {
        topicId: topic.id,
        sectionIds: pickSections(topic, "few"),
        questionTypes: ["mc", "fill"],
        difficulty: "basic",
        questionCount: 4,
        questionSource: "ai",
      });
    }
  }

  console.log("\n[B] 隨機混合組合");
  const difficulties = ["basic", "advanced", "challenge"];
  const typeSets = [["mc"], ["fill"], ["mc", "fill"]];
  for (let index = 0; index < RANDOM_COUNT; index += 1) {
    const topic = topics[index % topics.length];
    const setup = {
      topicId: topic.id,
      sectionIds: pickSections(topic, index % 4 === 0 ? "all" : "few"),
      questionTypes: typeSets[index % typeSets.length],
      difficulty: difficulties[index % difficulties.length],
      questionCount: [1, 3, 5, 8, 10, 15, 20, 30][index % 8],
      ...(AI_ONLY || (INCLUDE_AI && index % 3 === 2) ? { questionSource: "ai" } : {}),
    };
    console.log(
      `  · ${String(index + 1).padStart(2, "0")}. ${setup.topicId} ${setup.questionTypes.join("+")} ${setup.difficulty} ×${setup.questionCount}` +
        `${setup.questionSource === "ai" ? "（即時生成）" : ""}`,
    );
    await runPractice(topic, setup);
  }

  console.log("\n[C] 重做錯題");
  const firstTopic = topics[0];
  const base = await runPractice(
    firstTopic,
    {
      topicId: firstTopic.id,
      sectionIds: pickSections(firstTopic, "few"),
      questionTypes: ["mc", "fill"],
      difficulty: "basic",
      questionCount: 5,
    },
    { answerMode: "wrong" },
  );
  if (base) {
    const retry = await runPractice(firstTopic, {
      topicId: firstTopic.id,
      sectionIds: pickSections(firstTopic, "few"),
      questionTypes: ["mc", "fill"],
      difficulty: "basic",
      questionCount: 5,
      mode: "wrong-only",
      sourceSessionId: base.sessionId,
    });
    if (retry) {
      const wrongSet = new Set(base.wrongIds);
      const outside = retry.questions.filter((question) => !wrongSet.has(question.id));
      if (outside.length > 0) {
        anomaly("wrong-only", `重做錯題時出現之前沒有答錯的題目 ${outside.length} 題`, {
          ids: outside.map((question) => question.id).slice(0, 5),
        });
      }
    }
  }

  console.log("\n[D] 學生回報題目");
  const reportTarget = base?.questions?.[0];
  if (reportTarget) {
    const report = await call("POST", "/api/reports", {
      learnerId: LEARNER,
      questionId: reportTarget.id,
      sessionId: base.sessionId,
      attemptId: null,
      reason: "unclear",
      detail: "模擬測試回報",
    });
    check([200, 201].includes(report.status), "report", `回報題目回應 ${report.status}`, report.payload);
  }

  console.log("\n[E] 進度、重溫及閱讀教材");
  const progress = await call("GET", `/api/progress?learnerId=${LEARNER}`);
  check(progress.status === 200, "progress", `GET /api/progress 回應 ${progress.status}`);
  if (progress.status === 200) {
    const payload = progress.payload ?? {};
    check(!("recommendations" in payload), "progress", "學生端仍回傳已移除的「下一步建議」");
    const attempted = (payload.topics ?? []).filter((item) => item.attemptedQuestions > 0);
    check(attempted.length > 0, "progress", "完成多次練習後進度仍為 0", payload.topics?.slice(0, 3));
    const overAnswered = (payload.topics ?? []).filter(
      (item) => item.attemptedQuestions > item.eligibleQuestions,
    );
    if (overAnswered.length > 0) {
      anomaly("progress", "已作答題數多於可用題目數", overAnswered.slice(0, 3));
    }
    for (const item of payload.review?.dueItems ?? []) {
      if (!sectionOfTopic(item.sectionId)) {
        anomaly("review-queue", `重溫佇列包含不存在的分節 ${item.sectionId}`);
      }
      if (!item.sectionTitle) {
        anomaly("review-queue", `重溫佇列缺少分節名稱：${item.questionId}`);
      }
    }
  }

  for (const item of topics.slice(0, 4)) {
    // 學生端不再有閱讀教材頁；改為核對課題詳情中的學生可用教材段落數（AI 出題的唯一依據）
    const detail = await call("GET", `/api/topics/${item.id}?learnerId=${LEARNER}`);
    check(detail.status === 200, "topics", `課題詳情回應 ${detail.status}：${item.id}`);
    const studentBlocks = (detail.payload?.topic?.sections ?? []).reduce(
      (total, section) => total + (section.studentMaterialBlockCount ?? 0),
      0,
    );
    if (studentBlocks === 0) note(`課題 ${item.id} 沒有學生可用教材段落（即時出題會被版權閘門擋下）`);
  }

  // 學生實際會打開的頁面：必須可以載入（App Router 的頁面在匿名模式下不會被重導向）
  for (const page of ["/", "/practice/new", "/review"]) {
    const response = await call("GET", `${page}${page.includes("?") ? "&" : "?"}learnerId=${LEARNER}`);
    check(response.status === 200, "pages", `學生頁面 ${page} 回應 ${response.status}`);
  }

  console.log("\n[F] 邊界與錯誤輸入");
  const boundary = [
    { label: "題數 0", body: { questionCount: 0 }, expect: 400 },
    { label: "題數 31", body: { questionCount: 31 }, expect: 400 },
    { label: "題型短答（已移除）", body: { questionTypes: ["short"] }, expect: 400 },
    { label: "無效難度", body: { difficulty: "impossible" }, expect: 400 },
    { label: "沒有分節", body: { sectionIds: [] }, expect: 400 },
    { label: "不存在的課題", body: { topicId: "topic-does-not-exist" }, expect: 404 },
    { label: "其他課題的分節", body: { topicId: "topic-1", sectionIds: ["topic-5-renaissance"] }, expect: 404 },
  ];
  for (const item of boundary) {
    const response = await call("POST", "/api/practice", {
      learnerId: LEARNER,
      topicId: "topic-1",
      sectionIds: [pickSections(topics[0], "single")[0]],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 3,
      ...item.body,
    });
    check(
      response.status === item.expect,
      "boundary",
      `${item.label} 應回應 ${item.expect}，實際 ${response.status}`,
      textOf(response.payload?.error) || null,
    );
  }

  const emptySection = topics
    .flatMap((topic) => topic.sections.map((section) => ({ ...section, topicId: topic.id })))
    .find((section) => section.publishedQuestionCount === 0);
  if (emptySection) {
    const response = await call("POST", "/api/practice", {
      learnerId: LEARNER,
      topicId: emptySection.topicId,
      sectionIds: [emptySection.id],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 3,
    });
    if (response.status === 201) {
      // 題庫沒有題目時，平台會即時按教材生成（見 README「題庫優先」）——必須說明清楚
      const notice = textOf(response.payload?.notice);
      check(
        notice.includes("即時") || notice.includes("生成"),
        "boundary",
        "沒有題庫題目的分節即時生成題目，但練習通知沒有說明",
        notice,
      );
    } else {
      check(
        [404, 409].includes(response.status),
        "boundary",
        `沒有題目的分節回應 ${response.status}（應為 201 並說明即時生成，或 404／409）`,
      );
      if (response.status === 409) {
        const errorText = textOf(response.payload?.error);
        check(errorText.length > 8, "boundary", "沒有題目時的回應缺少可行動說明", errorText);
      }
    }
  }

  console.log("\n──────── 結果 ────────");
  console.log(`練習次數：${practicesRun}，作答次數：${answersRun}，檢查項目：${checksRun}`);
  if (shortfalls.length > 0) {
    console.log(
      `\n題數少於要求（${shortfalls.length} 項；平台已如實告知學生，非錯誤，但需留意）：`,
    );
    for (const item of shortfalls.slice(0, 20)) {
      console.log(`  - ${item.label}：要求 ${item.requested} 題，實際 ${item.delivered} 題`);
      if (item.notice) console.log(`    ${item.notice.slice(0, 200)}`);
    }
    if (shortfalls.length > 20) console.log(`  …其餘 ${shortfalls.length - 20} 項`);
  } else {
    console.log("\n所有練習均取足要求的題數。");
  }
  if (info.length > 0) {
    console.log(`\n已知／可接受的降級（${info.length} 項）：`);
    for (const message of info.slice(0, 20)) console.log(`  - ${message}`);
    if (info.length > 20) console.log(`  …其餘 ${info.length - 20} 項`);
  }
  if (anomalies.length === 0) {
    console.log("\n✓ 沒有發現異常。");
  } else {
    console.log(`\n✗ 發現 ${anomalies.length} 項異常：`);
    const byCategory = new Map();
    for (const item of anomalies) {
      if (!byCategory.has(item.category)) byCategory.set(item.category, []);
      byCategory.get(item.category).push(item);
    }
    for (const [category, items] of byCategory) {
      console.log(`\n[${category}] ${items.length} 項`);
      for (const item of items.slice(0, 6)) {
        console.log(`  · ${item.message}`);
        if (item.detail) console.log(`    ${JSON.stringify(item.detail).slice(0, 300)}`);
      }
      if (items.length > 6) console.log(`  …其餘 ${items.length - 6} 項`);
    }
  }

  const fs = await import("node:fs");
  fs.writeFileSync(
    arg("--report", "data/tmp-sim/report.json"),
    JSON.stringify(
      { baseUrl: BASE_URL, learner: LEARNER, practicesRun, answersRun, checksRun, anomalies, shortfalls, info },
      null,
      2,
    ),
    "utf8",
  );
  db.close();
  process.exit(anomalies.length === 0 ? 0 : 1);
}

await main();
