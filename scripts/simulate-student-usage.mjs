/**
 * 模擬學生使用情況（透過 HTTP 呼叫正在運行的網站）。
 *
 * 用法：
 *   node scripts/simulate-student-usage.mjs                     # 預設 http://127.0.0.1:3101
 *   node scripts/simulate-student-usage.mjs --base-url http://127.0.0.1:3000
 *   node scripts/simulate-student-usage.mjs --random 10         # 額外隨機組合次數
 *   node scripts/simulate-student-usage.mjs --no-ai             # 跳過即時生成
 *   node scripts/simulate-student-usage.mjs --no-matrix         # 跳過 [J] 系統化組合矩陣
 *   node scripts/simulate-student-usage.mjs --report-md out.md  # 另存 Markdown 報告
 *
 * 覆蓋範圍：
 *   1. 12 個課題 × 不同題型組合（選擇題／填充題／兩者混合）× 三種難度 × 不同題目數量，
 *      走完「建立練習 → 逐題作答 → 完成練習 → 查看成績」的完整學生流程。
 *   2. 題目內容契約：題型、分節歸屬、選項、空格、是否派發未發布／待教師確認的題目。
 *   3. 評分契約：正確答案必須判為正確、錯誤答案不可判為正確、重複提交不可改變分數、
 *      空白答案不可提交、不可提交不屬於這次練習的題目、不可讀取他人的練習。
 *      等價寫法（前後空白、全角空格、句號、全形英數）同樣必須判為正確。
 *   4. 重做錯題（題庫練習及即時生成練習之後）、學生回報（全部原因）、學習進度、重溫佇列。
 *   5. 部分作答後完成（未作答題目不可當成答錯）、併發重複提交（只可記錄一次且分數一致）。
 *   6. 邊界與錯誤輸入：題數 0／31、不存在的題型／難度／課題／分節、沒有題目的分節。
 *   7. [J] 系統化組合矩陣：每年級一個代表課題 × 單／多分節 × 題型 × 難度 × 題數
 *      （1／5／10／超過庫存）× 作答模式（全對／部分／全錯），並核對未發布課題不可
 *      出現在學生清單或建立練習、學生身分不可呼叫教師／管理員 API。
 *
 * 任何異常都會列印原因及相關詳情，並以非零狀態結束；完整報告寫入 --report（JSON）
 * 及 --report-md（Markdown，內含組合矩陣結果、異常、疑似內容問題清單）。
 * 「題目內容」有疑點時只記錄 question_id 及現象，**不會**修改答案或解釋。
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
/** 是否執行 [J] 系統化組合矩陣（預設執行；--no-matrix 可跳過） */
const RUN_MATRIX = !args.includes("--no-matrix");
/** 組合矩陣只用的隨機組合數量上限（避免無限增長） */
const MATRIX_TOPIC_LIMIT = Number.parseInt(arg("--matrix-topics", "4"), 10);

const anomalies = [];
const info = [];
/**
 * 「疑似題目內容問題」：只記錄題目 ID 及現象，**不會**修改答案或解釋。
 * 題目在上載時已由科組審核，因此這裡只供擁有者抽樣覆核。
 */
const contentSuspects = [];
/**
 * [J] 組合矩陣的逐個案結果（課題、參數、HTTP 狀態、要求／實際題數、是否誤派不可作答題目）。
 */
const matrixCases = [];
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

/**
 * 填充題的標準答案可能同時列出多個可接受寫法（例如「門羅主義 / 門羅宣言」）。
 * 平台會按「/」拆開逐一接受（見 grading.ts 的 answerAlternatives），因此學生**不會**
 * 也不可能輸入整串「A / B」。模擬提交答案時要用其中一個寫法，否則會誤報「標準答案
 * 被判錯」（2026-10-23 在正式資料上誤報 2 題）。
 */
function answerAlternatives(correctAnswer) {
  const alternatives = correctAnswer
    .split(/\s*[／/]\s*/)
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0);
  return alternatives.length > 0 ? alternatives : [correctAnswer];
}

/** 這次要用哪一個寫法當「標準答案」（輪流使用，令每個同義寫法都被測到） */
function canonicalAnswer(questionType, correctAnswer, index) {
  if (questionType !== "fill") return correctAnswer;
  const alternatives = answerAlternatives(correctAnswer);
  return alternatives[index % alternatives.length];
}

/* ------------------------------------------------------------------ */
/* 課題與分節                                                          */
/* ------------------------------------------------------------------ */

async function loadTopics() {
  const response = await call("GET", `/api/topics?learnerId=${LEARNER}`);
  check(response.status === 200, "topics", `GET /api/topics 回應 ${response.status}`);
  // 只模擬學生實際可見（已發布）的課題；高中課題在匯入教材及出題前不會發布。
  const topics = (response.payload?.topics ?? []).filter((topic) => topic.published);
  check(topics.length >= 12, "topics", `已發布課題應至少 12 個，實際 ${topics.length}`);

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
  /** 結構上無法作答的題目（會被介面或 checkQuestionServable 攔下的那一類） */
  const unservable = new Set();
  const markUnservable = (questionId, phenomenon) => {
    unservable.add(questionId);
    contentSuspects.push({ questionId, phenomenon });
  };

  if (questions.length === 0) {
    anomaly("zero-questions", `練習建立了 0 題：${label}`, { notice: practice.notice ?? null });
    return { questions, unservable: [] };
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
      markUnservable(question.id, "題目沒有題幹");
    }
    if (textOf(question.sectionId).length === 0) {
      anomaly("empty-field", `題目 ${question.id} 沒有分節：${label}`);
      markUnservable(question.id, "題目沒有分節");
    }

    if (question.questionType === "mc") {
      const options = question.options ?? [];
      if (options.length < 2) {
        anomaly("mc-options", `選擇題 ${question.id} 只有 ${options.length} 個選項：${label}`);
        markUnservable(question.id, `選擇題只有 ${options.length} 個選項`);
      }
      if (new Set(options.map((option) => textOf(option))).size !== options.length) {
        anomaly("mc-options", `選擇題 ${question.id} 有重複選項：${label}`, options);
        markUnservable(question.id, "選擇題有重複選項");
      }
      if (options.some((option) => textOf(option).length === 0)) {
        anomaly("mc-options", `選擇題 ${question.id} 有空選項：${label}`);
        markUnservable(question.id, "選擇題有空白的選項");
      }
    } else if (question.questionType === "fill") {
      if (!/[_＿]{2,}/.test(question.question)) {
        anomaly("fill-blank", `填充題 ${question.id} 沒有空格：${question.question}`);
        markUnservable(question.id, "填充題題幹沒有空格標記");
      }
    } else {
      anomaly("wrong-type", `出現未知題型 ${question.questionType}：${question.id}`);
      markUnservable(question.id, `未知題型 ${question.questionType}`);
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

  return { questions, unservable: [...unservable] };
}

/* ------------------------------------------------------------------ */
/* 作答、評分與完成                                                    */
/* ------------------------------------------------------------------ */

async function submitAnswers(practice, { answerMode, learner = LEARNER }) {
  const questions = practice.questions ?? [];
  const sessionId = practice.session.id;
  const snapshot = snapshotOf(sessionId) ?? [];
  const snapshotById = new Map(snapshot.map((question) => [question.id, question]));
  const wrongIds = [];
  let expectedCorrectCount = 0;
  let unexpectedResults = 0;

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
        contentSuspects.push({
          questionId: studentQuestion.id,
          phenomenon: `填充題題幹有 ${blankCount} 個空格，但只有一個答案欄位`,
        });
      } else if (correctAnswer.length >= 2 && stem.replace(/[＿_]{2,}/g, "").includes(correctAnswer)) {
        anomaly("fill-leak", `填充題的答案仍出現在題幹：${studentQuestion.id}`, {
          answer: correctAnswer,
          question: stem.slice(0, 80),
        });
        contentSuspects.push({
          questionId: studentQuestion.id,
          phenomenon: "填充題的標準答案仍出現在題幹其他位置（可直接抄寫）",
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
        contentSuspects.push({
          questionId: studentQuestion.id,
          phenomenon: "選擇題的標準答案已出現在題幹（答案直接外洩）",
        });
      }
      if (!options.includes(correctAnswer)) {
        anomaly("mc-answer", `選擇題的答案不在選項內：${studentQuestion.id}`, {
          answer: correctAnswer,
          options,
        });
        contentSuspects.push({
          questionId: studentQuestion.id,
          phenomenon: "選擇題的標準答案不在選項之內（無法作答）",
        });
      }
    }

    // 錯誤答案：選擇題必須選另一個選項；填充題必須與標準答案明顯不同。
    let wrongAnswer = "";
    if (questionType === "mc") {
      const options = studentQuestion.options ?? [];
      wrongAnswer = options.find((option) => textOf(option) !== correctAnswer) ?? "";
    } else {
      wrongAnswer = `${correctAnswer}XYZ錯誤`;
    }

    let answer;
    /** null = 不檢查分數；true／false = 預期這次提交的判定 */
    let expectedCorrect = null;
    const standardAnswer = canonicalAnswer(questionType, correctAnswer, index);
    if (answerMode === "correct") {
      answer = standardAnswer;
      expectedCorrect = true;
    } else if (answerMode === "partial") {
      // 部分答對：偶數題答對、奇數題答錯（模擬學生只懂一半內容）
      const useCorrect = index % 2 === 0;
      answer = useCorrect ? standardAnswer : wrongAnswer;
      expectedCorrect = useCorrect;
    } else {
      answer = wrongAnswer;
      expectedCorrect = false;
    }
    if (!answer) {
      anomaly("cannot-answer", `無法為題目 ${studentQuestion.id} 構造答案（缺少標準答案）`, {
        snapshotFound: snapshotById.has(studentQuestion.id),
      });
      continue;
    }

    const submitted = await call("POST", `/api/practice/${sessionId}/answers`, {
      learnerId: learner,
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

    if (expectedCorrect !== null) {
      if (feedback.isCorrect !== expectedCorrect) {
        unexpectedResults += 1;
        anomaly(
          "grading",
          expectedCorrect
            ? `提交標準答案卻未被判為正確（${questionType}）：${studentQuestion.question.slice(0, 40)}`
            : `提交錯誤答案卻被判為正確（${questionType}）：${studentQuestion.question.slice(0, 40)}`,
          { answer, correctAnswer: feedback.correctAnswer, reviewFlag: feedback.reviewFlag, aiGrading: feedback.aiGrading ?? null },
        );
      } else if (expectedCorrect) {
        expectedCorrectCount += 1;
      }
    }
    if (!expectedCorrect) wrongIds.push(studentQuestion.id);

    if (!feedback.explanation) {
      anomaly("feedback", `作答後沒有解釋：${studentQuestion.id}`);
    }
    if (correctAnswer && textOf(feedback.correctAnswer) !== correctAnswer) {
      anomaly("feedback", `回饋的標準答案與練習快照不一致：${studentQuestion.id}`);
    }

    if (index === 0) {
      const repeat = await call("POST", `/api/practice/${sessionId}/answers`, {
        learnerId: learner,
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

  return { wrongIds, expectedCorrectCount, unexpectedResults };
}

async function runPractice(topic, setup, options = {}) {
  practicesRun += 1;
  const learner = options.learner ?? LEARNER;
  const otherLearner = `${learner}-other`;
  const created = await call("POST", "/api/practice", {
    learnerId: learner,
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
    } else if (created.status === 429) {
      // AI 用量上限（見 ai-limits.ts）：這是設計中的防濫用行為，不是缺陷；
      // 但訊息必須可行動（說明上限、何時可再試、可以向誰反映）。
      note(`AI 用量上限拒絕建立練習（429）：${label}`);
      check(
        errorText.length > 20 && /上限/.test(errorText) && /(稍後|再試)/.test(errorText),
        "http-429",
        `429 回應缺少可行動的說明：${label}`,
        errorText,
      );
    } else if (created.status >= 500) {
      anomaly("http-5xx", `建立練習回應 ${created.status}：${label}`, { error: errorText });
    } else if (created.status === 409) {
      note(`建立練習被拒（409：${errorText.slice(0, 50)}…）：${label}`);
    } else {
      anomaly("create-rejected", `建立練習失敗（HTTP ${created.status}）：${label}`, { error: errorText });
    }
    if (options.matrixCase) {
      matrixCases.push({
        ...options.matrixCase,
        status: created.status,
        requested: setup.questionCount,
        delivered: 0,
        outcome: "rejected",
        error: errorText.slice(0, 200),
        unservable: 0,
      });
    }
    return null;
  }

  const practice = created.payload;
  const validation = validateQuestions(practice, setup, topic.sections);
  const questions = validation.questions;
  if (options.matrixCase) {
    options.matrixCase.status = created.status;
    options.matrixCase.requested = setup.questionCount;
    options.matrixCase.delivered = questions.length;
    options.matrixCase.unservable = validation.unservable.length;
    options.matrixCase.notice = textOf(practice.notice).slice(0, 400);
  }
  if (validation.unservable.length > 0) {
    check(
      false,
      "unservable-served",
      `派發了 ${validation.unservable.length} 條結構上無法作答的題目：${label}`,
      validation.unservable.slice(0, 5),
    );
  }
  if (questions.length === 0) {
    if (options.matrixCase) options.matrixCase.outcome = "zero-questions";
    return null;
  }

  // 空白答案必須在「未作答」時才被拒絕；已作答的題目會回傳原有結果。
  const blank = await call("POST", `/api/practice/${practice.session.id}/answers`, {
    learnerId: learner,
    questionId: practice.questions[0].id,
    answer: "",
  });
  if (blank.status === 200) {
    anomaly("blank-answer", `空白答案被接受：${practice.questions[0].id}`);
  }

  const { wrongIds, expectedCorrectCount, unexpectedResults } = await submitAnswers(practice, {
    answerMode: options.answerMode ?? "correct",
    learner,
  });

  const completed = await call("POST", `/api/practice/${practice.session.id}/complete`, { learnerId: learner });
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
    if (
      (options.answerMode === "correct" || options.answerMode === "partial") &&
      result.correctCount !== expectedCorrectCount
    ) {
      anomaly("result-count", `成績的答對數 ${result.correctCount} 與預期 ${expectedCorrectCount} 不符：${label}`, {
        reviewFlags: (result.feedback ?? []).filter((item) => item.reviewFlag).length,
      });
    }
    if (!Array.isArray(result.feedback) || result.feedback.length !== questions.length) {
      anomaly("result-count", `成績缺少部分題目回饋：${label}`);
    }
    if (options.matrixCase) {
      options.matrixCase.correctCount = result.correctCount;
      options.matrixCase.expectedCorrectCount = expectedCorrectCount;
      options.matrixCase.unexpectedResults = unexpectedResults;
    }

    // 重新載入練習頁及成績頁時內容要一致（學生會重新整理）
    const reopened = await call("GET", `/api/practice/${practice.session.id}?learnerId=${learner}`);
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
      `/api/practice/${practice.session.id}/result?learnerId=${learner}`,
    );
    check(resultView.status === 200, "result-view", `讀取成績頁回應 ${resultView.status}：${label}`);
    if (resultView.status === 200 && (resultView.payload?.feedback ?? []).length !== questions.length) {
      anomaly("result-view", `成績頁的題目回饋數目不符：${label}`);
    }
  }

  const stolen = await call("GET", `/api/practice/${practice.session.id}?learnerId=${otherLearner}`);
  check(stolen.status === 403, "isolation", `其他學習者可讀取練習記錄（HTTP ${stolen.status}）`, {
    sessionId: practice.session.id,
  });
  const stolenComplete = await call("POST", `/api/practice/${practice.session.id}/complete`, { learnerId: otherLearner });
  check(stolenComplete.status === 403, "isolation", `其他學習者可完成練習（HTTP ${stolenComplete.status}）`);

  const foreign = await call("POST", `/api/practice/${practice.session.id}/answers`, {
    learnerId: learner,
    questionId: "q_not_in_session",
    answer: "測試",
  });
  check(foreign.status === 404, "submit-scope", `提交不屬於練習的題目回應 ${foreign.status}（應為 404）`);

  if (options.matrixCase) {
    options.matrixCase.outcome = "ok";
    options.matrixCase.sessionId = practice.session.id;
  }

  return { sessionId: practice.session.id, questions, wrongIds };
}

/* ------------------------------------------------------------------ */
/* 答案寫法、部分作答及併發提交                                        */
/* ------------------------------------------------------------------ */

/** 全形化英文字母及數字（模擬學生用全形輸入法作答） */
function toFullWidth(value) {
  return value.replace(/[!-~]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) + 0xfee0),
  );
}

/**
 * 與正規化結果相同的答案寫法（前後空白、全角空格、句號、全形英數）。
 * 這些寫法在 `grading.ts` 的正規化下與標準答案相同，必須判為正確；
 * 任何一項被判錯，都是學生用正常輸入法作答卻被扣分。
 */
function equivalentAnswerVariants(answer) {
  const variants = [
    { label: "原樣", value: answer },
    { label: "前後空白", value: `   ${answer}\u3000` },
    { label: "加句號", value: `${answer}。` },
  ];
  if (/[A-Za-z0-9]/.test(answer)) {
    variants.push({ label: "全形英數", value: toFullWidth(answer) });
  }
  return variants;
}

/** 學生以不同但等價的寫法作答（每題用一種寫法） */
async function checkAnswerFormats(topic) {
  console.log("\n[G] 答案寫法差異（等價寫法必須判為正確）");
  const created = await call("POST", "/api/practice", {
    learnerId: LEARNER,
    topicId: topic.id,
    sectionIds: pickSections(topic, "single"),
    questionTypes: ["mc", "fill"],
    difficulty: "basic",
    questionCount: 10,
  });
  if (created.status !== 201) {
    anomaly("answer-format", `建立練習失敗（HTTP ${created.status}）：${topic.id}`, {
      error: textOf(created.payload?.error) || created.text,
    });
    return;
  }
  const practice = created.payload;
  const snapshotById = new Map(
    (snapshotOf(practice.session.id) ?? []).map((question) => [question.id, question]),
  );
  let variantIndex = 0;

  for (const studentQuestion of practice.questions) {
    const snapshotQuestion = snapshotById.get(studentQuestion.id);
    const correctAnswer = textOf(snapshotQuestion?.correctAnswer);
    if (!correctAnswer) continue;
    const standardAnswer = canonicalAnswer(
      studentQuestion.questionType,
      correctAnswer,
      variantIndex,
    );
    const variants = equivalentAnswerVariants(standardAnswer);
    const variant = variants[variantIndex % variants.length];
    variantIndex += 1;

    const submitted = await call("POST", `/api/practice/${practice.session.id}/answers`, {
      learnerId: LEARNER,
      questionId: studentQuestion.id,
      answer: variant.value,
    });
    answersRun += 1;
    if (submitted.status !== 200) {
      anomaly(
        "answer-format",
        `「${variant.label}」提交失敗（HTTP ${submitted.status}）：${studentQuestion.id}`,
        { answer: variant.value, error: textOf(submitted.payload?.error) || submitted.text },
      );
      continue;
    }
    check(
      submitted.payload?.feedback?.isCorrect === true,
      "answer-format",
      `「${variant.label}」被判為錯誤（${studentQuestion.questionType}）：${variant.value}`,
      { correctAnswer },
    );
  }
  await call("POST", `/api/practice/${practice.session.id}/complete`, { learnerId: LEARNER });
}

/** 只作答部分題目便完成練習：成績須只計已作答的題目 */
async function checkPartialCompletion(topic) {
  console.log("\n[H] 部分作答後完成");
  const created = await call("POST", "/api/practice", {
    learnerId: LEARNER,
    topicId: topic.id,
    sectionIds: pickSections(topic, "single"),
    questionTypes: ["mc"],
    difficulty: "basic",
    questionCount: 5,
  });
  if (created.status !== 201) {
    anomaly("partial-completion", `建立練習失敗（HTTP ${created.status}）：${topic.id}`);
    return;
  }
  const practice = created.payload;
  const snapshotById = new Map(
    (snapshotOf(practice.session.id) ?? []).map((question) => [question.id, question]),
  );
  for (const [index, studentQuestion] of practice.questions.slice(0, 2).entries()) {
    const snapshotQuestion = snapshotById.get(studentQuestion.id);
    await call("POST", `/api/practice/${practice.session.id}/answers`, {
      learnerId: LEARNER,
      questionId: studentQuestion.id,
      answer: canonicalAnswer(
        studentQuestion.questionType,
        textOf(snapshotQuestion?.correctAnswer),
        index,
      ),
    });
    answersRun += 1;
  }
  const completed = await call("POST", `/api/practice/${practice.session.id}/complete`, {
    learnerId: LEARNER,
  });
  if (completed.status !== 200) {
    anomaly("partial-completion", `完成練習失敗（HTTP ${completed.status}）`);
    return;
  }
  const result = completed.payload;
  check(result.answeredCount === 2, "partial-completion", `已作答 ${result.answeredCount} 題（應為 2）`);
  check(result.correctCount === 2, "partial-completion", `答對 ${result.correctCount} 題（應為 2）`);
  const unanswered = (result.feedback ?? []).filter((item) => item.isCorrect === null);
  check(unanswered.length === 3, "partial-completion", `未作答題目 ${unanswered.length} 題（應為 3）`);
}

/**
 * 併發重複提交：學生連按兩次「提交答案」時，兩次請求幾乎同時到達。
 * 只可記錄一次，而且兩次回傳的分數必須一致（否則畫面會前後矛盾）。
 */
async function checkConcurrentSubmit(topic) {
  console.log("\n[I] 併發重複提交");
  const created = await call("POST", "/api/practice", {
    learnerId: LEARNER,
    topicId: topic.id,
    sectionIds: pickSections(topic, "single"),
    questionTypes: ["mc"],
    difficulty: "basic",
    questionCount: 5,
  });
  if (created.status !== 201) {
    anomaly("concurrency", `建立練習失敗（HTTP ${created.status}）：${topic.id}`);
    return;
  }
  const practice = created.payload;
  const question = practice.questions[0];
  const snapshotById = new Map(
    (snapshotOf(practice.session.id) ?? []).map((item) => [item.id, item]),
  );
  const correctAnswer = textOf(snapshotById.get(question.id)?.correctAnswer);
  const wrongAnswer =
    (question.options ?? []).find((option) => textOf(option) !== correctAnswer) ?? "錯誤答案";

  const [first, second] = await Promise.all([
    call("POST", `/api/practice/${practice.session.id}/answers`, {
      learnerId: LEARNER,
      questionId: question.id,
      answer: correctAnswer,
    }),
    call("POST", `/api/practice/${practice.session.id}/answers`, {
      learnerId: LEARNER,
      questionId: question.id,
      answer: wrongAnswer,
    }),
  ]);
  answersRun += 2;
  check(
    first.status === 200 && second.status === 200,
    "concurrency",
    `併發提交回應 ${first.status}／${second.status}`,
    { first: textOf(first.payload?.error), second: textOf(second.payload?.error) },
  );
  if (first.status === 200 && second.status === 200) {
    const recorded = [first, second].filter((item) => item.payload?.recorded !== false).length;
    check(recorded === 1, "concurrency", `兩次併發提交中記錄了 ${recorded} 次（應為 1）`);
    check(
      first.payload?.feedback?.isCorrect === second.payload?.feedback?.isCorrect,
      "concurrency",
      "兩次併發提交回傳不同分數",
    );
  }
  await call("POST", `/api/practice/${practice.session.id}/complete`, { learnerId: LEARNER });
}

/* ------------------------------------------------------------------ */
/* 系統化組合矩陣                                                      */
/* ------------------------------------------------------------------ */

function sectionsWithQuestions(topic) {
  return topic.sections.filter((section) => section.publishedQuestionCount > 0);
}

/**
 * 依年級抽取代表課題：每個年級取一個（有題目分節最多者優先），
 * 確保矩陣覆蓋不同年級／類型的課題，而不是集中測試同一個課題。
 */
function selectMatrixTopics(topics) {
  const byLevel = new Map();
  for (const topic of topics) {
    const level = topic.level ?? 0;
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level).push(topic);
  }
  const picked = [];
  for (const level of [...byLevel.keys()].sort((a, b) => a - b)) {
    const best = [...byLevel.get(level)].sort(
      (a, b) => sectionsWithQuestions(b).length - sectionsWithQuestions(a).length,
    )[0];
    if (best) picked.push(best);
  }
  return picked.slice(0, Math.max(1, MATRIX_TOPIC_LIMIT));
}

/**
 * 組合矩陣的固定個案：分節數目（1／多個）× 題型（MC／填充／混合）×
 * 難度（基礎／進階／挑戰）× 題數（1／5／10／超過庫存）× 作答模式（全對／部分／全錯）。
 *
 * 每個個案使用**獨立學習者 ID**：AI 出題有每人用量上限（ai-limits.ts），
 * 共用同一個學習者會令後面的個案全部收到 429，令矩陣只測到「上限」而不是出題流程。
 */
const MATRIX_CASES = [
  {
    key: "single-mc-basic-1",
    description: "單分節／選擇題／基礎／1 題（題數下限）",
    sections: "single",
    questionTypes: ["mc"],
    difficulty: "basic",
    questionCount: 1,
    answerMode: "correct",
  },
  {
    key: "single-fill-advanced-5",
    description: "單分節／填充題／進階／5 題（部分答對）",
    sections: "single",
    questionTypes: ["fill"],
    difficulty: "advanced",
    questionCount: 5,
    answerMode: "partial",
  },
  {
    key: "multi-mixed-challenge-10",
    description: "多分節／選擇題＋填充題／挑戰／10 題（全對）",
    sections: "few",
    questionTypes: ["mc", "fill"],
    difficulty: "challenge",
    questionCount: 10,
    answerMode: "correct",
  },
  {
    key: "multi-mc-basic-30",
    description: "多分節／選擇題／基礎／30 題（超過庫存，全錯）",
    sections: "few",
    questionTypes: ["mc"],
    difficulty: "basic",
    questionCount: 30,
    answerMode: "wrong",
  },
];

async function runMatrix(topics) {
  console.log("\n[J] 系統化組合矩陣（分節×題型×難度×題數×作答模式）");
  const selected = selectMatrixTopics(topics);
  if (selected.length === 0) {
    anomaly("matrix", "沒有可用的已發布課題，無法執行組合矩陣");
    return;
  }
  info.push(
    `組合矩陣課題：${selected.map((topic) => `${topic.id}（${topic.level} 級）`).join("、")}`,
  );

  for (const [topicIndex, topic] of selected.entries()) {
    if (sectionsWithQuestions(topic).length === 0) {
      info.push(`課題 ${topic.id} 沒有已發布題目，矩陣個案只會測到「沒有題目」的降級路徑`);
    }
    console.log(`  · ${topic.id}（${topic.level} 級）`);
    for (const [caseIndex, testCase] of MATRIX_CASES.entries()) {
      const learner = `${LEARNER}-m${topicIndex}${caseIndex}`;
      const record = {
        topicId: topic.id,
        level: topic.level,
        caseKey: testCase.key,
        description: testCase.description,
        questionTypes: testCase.questionTypes.join("+"),
        difficulty: testCase.difficulty,
        answerMode: testCase.answerMode,
        unservable: 0,
      };
      await runPractice(
        topic,
        {
          topicId: topic.id,
          sectionIds:
            testCase.sections === "single"
              ? pickSections(topic, "single")
              : pickSections(topic, "few"),
          questionTypes: testCase.questionTypes,
          difficulty: testCase.difficulty,
          questionCount: testCase.questionCount,
        },
        { answerMode: testCase.answerMode, learner, matrixCase: record },
      );
      matrixCases.push(record);
      const statusText =
        record.outcome === "ok"
          ? `${record.delivered}/${record.requested} 題`
          : `HTTP ${record.status ?? "?"}（${record.outcome ?? "unknown"}）`;
      console.log(`      ${testCase.key}：${statusText}`);
    }
  }

  // 空錯題：全新學習者沒有任何作答記錄，「重做錯題」必須被拒並說明如何繼續
  const emptyWrongTopic = selected[0];
  const emptyWrong = await call("POST", "/api/practice", {
    learnerId: `${LEARNER}-empty`,
    topicId: emptyWrongTopic.id,
    sectionIds: pickSections(emptyWrongTopic, "single"),
    questionTypes: ["mc", "fill"],
    difficulty: "basic",
    questionCount: 5,
    mode: "wrong-only",
  });
  const emptyWrongMessage = textOf(emptyWrong.payload?.error);
  check(
    emptyWrong.status === 409,
    "wrong-only",
    `沒有錯題時重做錯題回應 ${emptyWrong.status}（應為 409）`,
    emptyWrongMessage,
  );
  check(
    emptyWrongMessage.length > 10 && /(練習|錯誤|完整)/.test(emptyWrongMessage),
    "wrong-only",
    "沒有錯題時的回應缺少可行動說明",
    emptyWrongMessage,
  );

  // 未發布課題不可出現在學生清單，也不可直接建立練習
  const unpublished = db
    .prepare("SELECT id FROM topics WHERE published = 0")
    .all()
    .map((row) => row.id);
  if (unpublished.length > 0) {
    const publishedOnly = await call(
      "GET",
      `/api/topics?learnerId=${LEARNER}&publishedOnly=true`,
    );
    const listed = new Set((publishedOnly.payload?.topics ?? []).map((topic) => topic.id));
    for (const topicId of unpublished) {
      check(
        !listed.has(topicId),
        "unpublished-topic",
        `未發布課題 ${topicId} 出現在學生課題清單`,
      );
    }
    const firstUnpublished = unpublished[0];
    const blocked = await call("POST", "/api/practice", {
      learnerId: LEARNER,
      topicId: firstUnpublished,
      sectionIds: ["unknown-section"],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 3,
    });
    check(
      blocked.status === 404,
      "unpublished-topic",
      `未發布課題 ${firstUnpublished} 仍可建立練習（HTTP ${blocked.status}，應為 404）`,
      textOf(blocked.payload?.error) || null,
    );
  }

  // 學生身分呼叫教師／管理員 API 必須被拒（請求未帶 x-admin-token）
  for (const endpoint of [
    "/api/teacher/overview",
    "/api/teacher/records",
    "/api/teacher/questions",
    "/api/teacher/review-queue",
    "/api/admin/system/overview",
    "/api/admin/materials",
  ]) {
    const response = await call("GET", endpoint);
    check(
      [401, 403].includes(response.status),
      "authz",
      `未授權的學生請求 ${endpoint} 回應 ${response.status}（應為 401／403）`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* 報告                                                               */
/* ------------------------------------------------------------------ */

function buildMarkdownReport(generatedAt) {
  const lines = [];
  lines.push("# 學生使用模擬報告（自動產生）");
  lines.push("");
  lines.push(`- 產生時間：${generatedAt}`);
  lines.push(`- 伺服器：${BASE_URL}`);
  lines.push(`- 模擬學習者：${LEARNER}`);
  lines.push(`- 練習次數：${practicesRun}；作答次數：${answersRun}；檢查項目：${checksRun}`);
  lines.push("");
  lines.push("## 組合矩陣結果");
  lines.push("");
  const passed = matrixCases.filter(
    (item) => item.outcome === "ok" && (item.unexpectedResults ?? 0) === 0 && item.unservable === 0,
  ).length;
  lines.push(`- 執行組合數：${matrixCases.length}`);
  lines.push(`- 通過：${passed}`);
  lines.push(`- 需跟進：${matrixCases.length - passed}`);
  lines.push("");
  if (matrixCases.length > 0) {
    lines.push("| 課題 | 年級 | 組合 | 題型 | 難度 | 作答 | 要求題數 | 實際題數 | 不可作答題 | HTTP | 結果 |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const item of matrixCases) {
      const ok =
        item.outcome === "ok" && (item.unexpectedResults ?? 0) === 0 && item.unservable === 0;
      lines.push(
        `| ${item.topicId} | ${item.level ?? ""} | ${item.caseKey} | ${item.questionTypes} | ${item.difficulty} | ${item.answerMode} | ${item.requested ?? "-"} | ${item.delivered ?? 0} | ${item.unservable} | ${item.status ?? "-"} | ${ok ? "通過" : "需跟進"} |`,
      );
    }
    lines.push("");
  }

  lines.push("## 異常（程式層面）");
  lines.push("");
  if (anomalies.length === 0) {
    lines.push("沒有發現異常。");
    lines.push("");
  } else {
    const byCategory = new Map();
    for (const item of anomalies) {
      if (!byCategory.has(item.category)) byCategory.set(item.category, []);
      byCategory.get(item.category).push(item);
    }
    for (const [category, items] of byCategory) {
      lines.push(`### \`${category}\`（${items.length} 項）`);
      lines.push("");
      for (const item of items) {
        lines.push(`- ${item.message}`);
        if (item.detail) {
          lines.push(`  - 詳情：\`${JSON.stringify(item.detail).slice(0, 300)}\``);
        }
      }
      lines.push("");
    }
  }

  lines.push("## 疑似題目內容問題（只記錄，不會自動修改）");
  lines.push("");
  if (contentSuspects.length === 0) {
    lines.push("沒有發現。");
  } else {
    const unique = new Map();
    for (const item of contentSuspects) {
      unique.set(`${item.questionId}|${item.phenomenon}`, item);
    }
    lines.push("| question_id | 現象 |");
    lines.push("| --- | --- |");
    for (const item of unique.values()) {
      lines.push(`| ${item.questionId} | ${item.phenomenon} |`);
    }
    lines.push("");
    lines.push(
      "> 題目內容在上載時已由科組逐題審核；以上僅供擁有者／教師抽樣覆核，模擬流程不會改寫答案或解釋。",
    );
  }
  lines.push("");

  lines.push("## 題數少於要求（平台已如實告知，非錯誤）");
  lines.push("");
  if (shortfalls.length === 0) {
    lines.push("所有練習均取足要求的題數。");
  } else {
    lines.push(`共 ${shortfalls.length} 項：`);
    lines.push("");
    for (const item of shortfalls) {
      lines.push(
        `- ${item.label}：要求 ${item.requested} 題，實際 ${item.delivered} 題${item.notice ? `（${item.notice.slice(0, 160)}）` : ""}`,
      );
    }
  }
  lines.push("");

  lines.push("## 已知／可接受的降級");
  lines.push("");
  if (info.length === 0) {
    lines.push("無。");
  } else {
    for (const message of info) lines.push(`- ${message}`);
  }
  lines.push("");
  return lines.join("\n");
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
    default: {
      // 分節可以完全沒有題庫題目（例如高中課題在生成題目前），
      // 此時仍要選出可分節，否則會送出空的 sectionIds（API 會回 400）。
      const candidates = withQuestions.length > 0 ? withQuestions : topic.sections;
      return candidates.slice(0, 3).map((section) => section.id);
    }
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

  // 即時生成的題目只存在於練習快照內（persist = false），重做錯題時必須由快照取回，
  // 不能因為題庫沒有這些題目而當成「沒有錯題」。
  if (INCLUDE_AI) {
    const aiBase = await runPractice(
      firstTopic,
      {
        topicId: firstTopic.id,
        sectionIds: pickSections(firstTopic, "single"),
        questionTypes: ["mc", "fill"],
        difficulty: "basic",
        questionCount: 5,
        questionSource: "ai",
      },
      { answerMode: "wrong" },
    );
    if (aiBase) {
      const aiRetry = await runPractice(firstTopic, {
        topicId: firstTopic.id,
        sectionIds: pickSections(firstTopic, "single"),
        questionTypes: ["mc", "fill"],
        difficulty: "basic",
        questionCount: 5,
        mode: "wrong-only",
        sourceSessionId: aiBase.sessionId,
      });
      if (aiRetry) {
        const wrongSet = new Set(aiBase.wrongIds);
        const outside = aiRetry.questions.filter((question) => !wrongSet.has(question.id));
        if (outside.length > 0) {
          anomaly("wrong-only", `AI 練習後重做錯題出現 ${outside.length} 題不是之前答錯的`, {
            ids: outside.map((question) => question.id).slice(0, 5),
          });
        }
      }
    }
  }

  console.log("\n[D] 學生回報題目");
  const reportTarget = base?.questions?.[0];
  if (reportTarget) {
    // 每一種回報原因學生都可能用到；原因清單由介面提供，伺服器必須全部接受。
    for (const reason of ["unclear", "answer-disputed", "explanation-unclear", "source-problem", "other"]) {
      const report = await call("POST", "/api/reports", {
        learnerId: LEARNER,
        questionId: reportTarget.id,
        sessionId: base.sessionId,
        attemptId: null,
        reason,
        detail: `模擬測試回報（${reason}）`,
      });
      check(
        [200, 201].includes(report.status),
        "report",
        `回報原因 ${reason} 回應 ${report.status}`,
        report.payload,
      );
    }
    const invalid = await call("POST", "/api/reports", {
      learnerId: LEARNER,
      questionId: reportTarget.id,
      sessionId: base.sessionId,
      attemptId: null,
      reason: "not-a-real-reason",
      detail: "模擬測試：無效原因",
    });
    check(invalid.status === 400, "report", `無效回報原因回應 ${invalid.status}（應為 400）`);
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

  await checkAnswerFormats(firstTopic);
  await checkPartialCompletion(firstTopic);
  await checkConcurrentSubmit(firstTopic);

  console.log("\n[F] 邊界與錯誤輸入");
  const boundary = [
    { label: "題數 0", body: { questionCount: 0 }, expect: 400 },
    { label: "題數 31", body: { questionCount: 31 }, expect: 400 },
    { label: "題型短答（已移除）", body: { questionTypes: ["short"] }, expect: 400 },
    { label: "無效難度", body: { difficulty: "impossible" }, expect: 400 },
    { label: "沒有分節", body: { sectionIds: [] }, expect: 400 },
    { label: "不存在的課題", body: { topicId: "topic-does-not-exist" }, expect: 404 },
    { label: "其他課題的分節", body: { topicId: "topic-1", sectionIds: ["topic-5-renaissance-reformation"] }, expect: 404 },
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

  // 題目數會隨練習增加的即時生成題目變動，因此這項檢查必須用**即時**的課題資料，
  // 不可用 [A] 開始時的舊快照（否則會誤用一條已經有題目的分節）。
  const freshTopics = await loadTopics();
  const emptySection = freshTopics
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

  if (RUN_MATRIX) await runMatrix(topics);

  console.log("\n──────── 結果 ────────");
  console.log(`練習次數：${practicesRun}，作答次數：${answersRun}，檢查項目：${checksRun}`);
  if (matrixCases.length > 0) {
    const matrixPassed = matrixCases.filter(
      (item) => item.outcome === "ok" && (item.unexpectedResults ?? 0) === 0 && item.unservable === 0,
    ).length;
    console.log(
      `組合矩陣：${matrixCases.length} 個組合，通過 ${matrixPassed}，需跟進 ${matrixCases.length - matrixPassed}`,
    );
  }
  if (contentSuspects.length > 0) {
    console.log(`\n疑似題目內容問題（只記錄，不會自動修改）：${contentSuspects.length} 項`);
    for (const item of contentSuspects.slice(0, 20)) {
      console.log(`  - ${item.questionId}：${item.phenomenon}`);
    }
    if (contentSuspects.length > 20) console.log(`  …其餘 ${contentSuspects.length - 20} 項`);
  }
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
  const nodePath = await import("node:path");
  const os = await import("node:os");
  // 預設報告放在作業系統的暫存目錄：模擬是臨時產物，不應留在專案的 data/ 之內。
  const reportPath = arg("--report", nodePath.join(os.tmpdir(), "hist-sim-report.json"));
  const markdownPath = arg(
    "--report-md",
    nodePath.join(os.tmpdir(), "hist-sim-report-simulation.md"),
  );
  fs.mkdirSync(nodePath.dirname(reportPath), { recursive: true });
  fs.mkdirSync(nodePath.dirname(markdownPath), { recursive: true });
  const generatedAt = new Date().toISOString();
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        baseUrl: BASE_URL,
        learner: LEARNER,
        generatedAt,
        practicesRun,
        answersRun,
        checksRun,
        matrixCases,
        anomalies,
        shortfalls,
        contentSuspects,
        info,
      },
      null,
      2,
    ),
    "utf8",
  );
  fs.writeFileSync(markdownPath, buildMarkdownReport(generatedAt), "utf8");
  console.log(`\n報告：${reportPath}`);
  console.log(`報告（Markdown）：${markdownPath}`);
  db.close();
  process.exit(anomalies.length === 0 ? 0 : 1);
}

await main();
