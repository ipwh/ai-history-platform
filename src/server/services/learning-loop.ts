/**
 * 學習循環服務：課題進度、技能進度、重溫排程及下一步建議。
 *
 * 三個部分都在這裡集中實作，令規則可被單獨測試，不會散落在 React 元件內。
 *
 * ── 計數規則（counting contract）──────────────────────────────────────────
 * 1. **只計算已發布的題庫題目**：學生即時生成（只存在於練習快照、從未經教師核對）的題目、
 *    草稿、已停用及已刪除的題目一律不計入進度（見 listPublishedAttemptsForLearner）。
 * 2. **一題只算一次**：同一題即使在不同練習重複作答（不同 session 會各有一筆記錄），
 *    進度只取該題**最新一次**作答結果（`answered_at` 最大者），因此重複練習同一題
 *    不會令「已作答題數」增加。
 * 3. **不作歷史重詮釋**：不確定（近似答案）的判定在批改當時已寫入 `attempts.uncertain`，
 *    不會因為題目的答案之後被修改而改變。
 * 4. **不確定 ≠ 正確，亦 ≠ 明確錯誤**：不確定只會歸入「需要重溫」，不會計入已掌握，
 *    亦不會被當成技能較弱。
 * 5. **掌握門檻**：同一課題（或同一技能）需有**至少 2 條不同題目**的最新作答為正確，
 *    才顯示「已多次答對」；單題答對不足以顯示掌握。
 * 6. **技能標示無效時不判斷**：`skill` 為 null 或不在 HISTORY_SKILLS 內的題目不會計入
 *    任何技能，亦不會顯示為弱項。
 * 7. **沒有作答不預設進度**：沒有任何作答時，狀態為「未開始」，數值為 0。
 *
 * ── 重溫排程（scheduling contract）──────────────────────────────────────
 * 間隔依「該題最新一次作答結果」決定（不是歷史最佳）：
 *   - 明確答錯：1 天
 *   - 不確定（近似答案）：1 天（未成功提取，因此視同需要盡快重溫）
 *   - 最新答對：3 天（之前曾答錯過）；7 天（一直都答對）
 * 到期判斷：`現在 - 最新作答時間 >= 間隔天數`，以 UTC 計算，避免時區邊界差異。
 * 時間戳缺失或格式錯誤：不加入佇列，並計入 `dataIssues`（不猜測其到期日）。
 * 時間戳在未來：視為剛作答（未到期），不會即時湧入佇列。
 * 佇列以題目 ID 去重；同一題只會出現一次。
 *
 * **限制**：以上間隔是為避免「一試定生死」的簡單規則，**並非**經實證驗證的最佳間隔，
 * 亦不是 SM-2 等演算法的實作。
 */
import {
  HISTORY_SKILLS,
  LEARNING_STATE_LABELS,
  type HistorySkill,
  type LearningState,
  type RecommendationKind,
  type ReviewReason,
} from "../../lib/types";
import {
  listPublishedAttemptsForLearner,
  listPublishedQuestionsForProgress,
  type LearnerQuestionAttempt,
} from "../repositories/practice";
import { listSections, listTopics } from "../repositories/topics";

/** 顯示「已多次答對」所需的最少不同題目數（見計數規則 5） */
export const DEMONSTRATED_MIN_QUESTIONS = 2;

/** 重溫間隔（天）。刻意寫成單一來源方便測試及說明。 */
export const REVIEW_INTERVALS = {
  /** 明確答錯 */
  incorrect: 1,
  /** 近似答案（不確定）：未成功提取，因此與答錯同樣盡快重溫 */
  uncertain: 1,
  /** 最新答對，但之前曾答錯 */
  correctAfterMistake: 3,
  /** 一直答對 */
  correct: 7,
} as const;

/**
 * 課題／技能的學習狀態、重溫原因及建議類別的型別與中文標示集中在
 * src/lib/types.ts（前端與伺服器共用同一套定義），這裡只負責判定邏輯。
 */
export { LEARNING_STATE_LABELS };

export interface TopicProgress {
  topicId: string;
  /** 課題內已發布、可作答的題目數（0 = 未有可用題目） */
  eligibleQuestions: number;
  /** 學生已作答的**不同**題目數 */
  attemptedQuestions: number;
  /** 最新作答為正確的不同題目數 */
  correctQuestions: number;
  /** 最新作答為錯誤的不同題目數 */
  incorrectQuestions: number;
  /** 最新作答為「不確定」的不同題目數 */
  uncertainQuestions: number;
  state: LearningState;
}

export interface SkillProgress {
  skill: HistorySkill;
  /** 該技能已發布的題目數 */
  eligibleQuestions: number;
  attemptedQuestions: number;
  correctQuestions: number;
  incorrectQuestions: number;
  state: LearningState;
  /** 證據是否足夠：不足時不可顯示為弱項（見計數規則 5、6） */
  sufficientEvidence: boolean;
}

export interface ReviewItem {
  questionId: string;
  topicId: string;
  sectionId: string;
  /** 為何現在要重溫（供學生理解） */
  reason: ReviewReason;
  /** 距上次作答的天數 */
  daysSince: number;
  /** 已超過到期時間的天數（0 = 今天到期） */
  daysOverdue: number;
  lastAnsweredAt: string;
}

export interface ReviewQueue {
  dueItems: ReviewItem[];
  dueCount: number;
  /** 因時間戳缺失或格式錯誤而無法排程的作答數（不會猜測） */
  dataIssues: number;
}

export interface Recommendation {
  kind: RecommendationKind;
  title: string;
  /** 依據：必須來自真實的作答記錄 */
  reason: string;
  href: string;
}

/** 預設時鐘（可注入以便測試，見 getReviewQueue 的 now 參數） */
const DAY_MS = 24 * 60 * 60 * 1000;

interface QuestionOutcome {
  questionId: string;
  topicId: string;
  sectionId: string;
  skill: string | null;
  answeredAt: string;
  isCorrect: boolean | null;
  uncertain: boolean;
  /** 更早的作答中是否曾答錯 */
  hadEarlierMistake: boolean;
}

/**
 * 把作答記錄整理成「每題最新一次」的結果。
 *
 * - 同一題只保留最新一筆（計數規則 2）
 * - 同時記錄該題之前是否曾答錯（用於重溫間隔）
 * - 時間戳格式錯誤的記錄不會被採用
 */
function latestOutcomeByQuestion(
  attempts: LearnerQuestionAttempt[],
  now: number,
): { outcomes: Map<string, QuestionOutcome>; dataIssues: number } {
  const outcomes = new Map<string, QuestionOutcome>();
  let dataIssues = 0;

  for (const attempt of attempts) {
    const timestamp = Date.parse(attempt.answeredAt);
    if (Number.isNaN(timestamp)) {
      dataIssues += 1;
      continue;
    }

    const existing = outcomes.get(attempt.questionId);
    const hadEarlierMistake =
      (existing?.hadEarlierMistake ?? false) || attempt.isCorrect === false;

    // 未來時間視為剛作答（避免未來時間戳令項目一直顯示為已逾期）
    const normalised = Math.min(timestamp, now);

    if (existing !== undefined && Date.parse(existing.answeredAt) >= normalised) {
      existing.hadEarlierMistake = existing.hadEarlierMistake || attempt.isCorrect === false;
      continue;
    }

    outcomes.set(attempt.questionId, {
      questionId: attempt.questionId,
      topicId: attempt.topicId,
      sectionId: attempt.sectionId,
      skill: attempt.skill,
      answeredAt: new Date(normalised).toISOString(),
      isCorrect: attempt.isCorrect,
      uncertain: attempt.uncertain,
      hadEarlierMistake,
    });
  }

  return { outcomes, dataIssues };
}

function stateFromCounts(
  attempted: number,
  correct: number,
  needsReview: number,
): LearningState {
  if (attempted === 0) return "not-started";
  if (needsReview > 0) return "needs-review";
  if (correct >= DEMONSTRATED_MIN_QUESTIONS) return "repeatedly-demonstrated";
  return "in-progress";
}

/** 課題層面的進度 */
export function getTopicProgress(learnerId: string, topicId: string, now = Date.now()): TopicProgress {
  const eligible = listPublishedQuestionsForProgress(topicId);
  const attempts = listPublishedAttemptsForLearner(learnerId, topicId);
  const { outcomes } = latestOutcomeByQuestion(attempts, now);

  let correct = 0;
  let incorrect = 0;
  let uncertain = 0;
  for (const outcome of outcomes.values()) {
    if (outcome.uncertain) uncertain += 1;
    else if (outcome.isCorrect === true) correct += 1;
    else incorrect += 1;
  }

  const attempted = outcomes.size;
  return {
    topicId,
    eligibleQuestions: eligible.length,
    attemptedQuestions: attempted,
    correctQuestions: correct,
    incorrectQuestions: incorrect,
    uncertainQuestions: uncertain,
    state: stateFromCounts(attempted, correct, incorrect + uncertain),
  };
}

/** 技能層面的進度：只計算 HISTORY_SKILLS 內的有效標示 */
export function getSkillProgress(learnerId: string, topicId: string, now = Date.now()): SkillProgress[] {
  const eligible = listPublishedQuestionsForProgress(topicId);
  const attempts = listPublishedAttemptsForLearner(learnerId, topicId);
  const { outcomes } = latestOutcomeByQuestion(attempts, now);

  const skillOfQuestion = new Map(eligible.map((question) => [question.id, question.skill]));
  const validSkills = new Set<string>(HISTORY_SKILLS);

  return HISTORY_SKILLS.map((skill) => {
    const eligibleCount = eligible.filter((question) => question.skill === skill).length;

    let attempted = 0;
    let correct = 0;
    let incorrect = 0;
    let uncertain = 0;

    for (const outcome of outcomes.values()) {
      // 以題庫現況為準：題目已停用或技能被改動時不會沿用舊標示
      const currentSkill = skillOfQuestion.get(outcome.questionId) ?? null;
      if (currentSkill !== skill) continue;
      if (!validSkills.has(skill)) continue;

      attempted += 1;
      if (outcome.uncertain) uncertain += 1;
      else if (outcome.isCorrect === true) correct += 1;
      else incorrect += 1;
    }

    return {
      skill,
      eligibleQuestions: eligibleCount,
      attemptedQuestions: attempted,
      correctQuestions: correct,
      incorrectQuestions: incorrect,
      state: stateFromCounts(attempted, correct, incorrect + uncertain),
      // 只有一條題目的作答不足以判斷強弱（計數規則 5、6）
      sufficientEvidence: attempted >= DEMONSTRATED_MIN_QUESTIONS,
    };
  });
}

/** 依「每題最新結果」建立重溫佇列（去重、只含已發布題目） */
export function getReviewQueue(
  learnerId: string,
  options: { topicId?: string; now?: number } = {},
): ReviewQueue {
  const now = options.now ?? Date.now();
  const attempts = listPublishedAttemptsForLearner(learnerId, options.topicId);
  const { outcomes, dataIssues } = latestOutcomeByQuestion(attempts, now);

  const dueItems: ReviewItem[] = [];
  for (const outcome of outcomes.values()) {
    // 最新作答為正確，且一直答對 → 不需重溫
    if (!outcome.uncertain && outcome.isCorrect === true && !outcome.hadEarlierMistake) {
      const daysSince = Math.floor((now - Date.parse(outcome.answeredAt)) / DAY_MS);
      if (daysSince < REVIEW_INTERVALS.correct) continue;
      dueItems.push({
        questionId: outcome.questionId,
        topicId: outcome.topicId,
        sectionId: outcome.sectionId,
        reason: "due",
        daysSince,
        daysOverdue: daysSince - REVIEW_INTERVALS.correct,
        lastAnsweredAt: outcome.answeredAt,
      });
      continue;
    }

    const interval = outcome.uncertain
      ? REVIEW_INTERVALS.uncertain
      : outcome.isCorrect === true
        ? REVIEW_INTERVALS.correctAfterMistake
        : REVIEW_INTERVALS.incorrect;
    const reason: ReviewItem["reason"] = outcome.uncertain
      ? "uncertain"
      : outcome.isCorrect === true
        ? "due-after-mistake"
        : "incorrect";

    const daysSince = Math.floor((now - Date.parse(outcome.answeredAt)) / DAY_MS);
    if (daysSince < interval) continue;

    dueItems.push({
      questionId: outcome.questionId,
      topicId: outcome.topicId,
      sectionId: outcome.sectionId,
      reason,
      daysSince,
      daysOverdue: daysSince - interval,
      lastAnsweredAt: outcome.answeredAt,
    });
  }

  // 最需要重溫的排在前面：先依已逾期天數，再依題目 ID（確保輸出穩定）
  dueItems.sort(
    (left, right) =>
      right.daysOverdue - left.daysOverdue || left.questionId.localeCompare(right.questionId),
  );

  return { dueItems, dueCount: dueItems.length, dataIssues };
}

/**
 * 下一步建議：最多 3 項，每項都有可追溯的理由。
 * 資料不足時回傳中性的建議，不會憑空診斷學生的弱點。
 */
export function getRecommendations(
  learnerId: string,
  options: { now?: number; limit?: number } = {},
): Recommendation[] {
  const now = options.now ?? Date.now();
  const limit = options.limit ?? 3;
  const recommendations: Recommendation[] = [];

  const topics = listTopics().filter((topic) => topic.published && topic.level !== 0);

  // 1. 已到期的重溫題目（最優先：有明確證據顯示已遺忘或未掌握）
  const queue = getReviewQueue(learnerId, { now });
  if (queue.dueCount > 0) {
    recommendations.push({
      kind: "review-due",
      title: `重溫 ${queue.dueCount} 條到期的題目`,
      reason:
        queue.dueItems.some((item) => item.reason === "incorrect" || item.reason === "uncertain")
          ? `你有 ${queue.dueCount} 條題目已到重溫時間（部分之前答錯或答案未能確定），現在重做效果最好。`
          : `你有 ${queue.dueCount} 條之前答對的題目已到重溫時間，重做可以鞏固記憶。`,
      href: "/review",
    });
  }

  // 2. 有答錯但未到期的題目 → 建議重做錯題
  for (const topic of topics) {
    const progress = getTopicProgress(learnerId, topic.id, now);
    if (progress.incorrectQuestions + progress.uncertainQuestions > 0) {
      recommendations.push({
        kind: "redo-wrong",
        title: `重做「${topic.title}」的錯題`,
        reason: `你在這個課題有 ${
          progress.incorrectQuestions + progress.uncertainQuestions
        } 條題目未答對（答錯或答案未能確定），重做可以釐清概念。`,
        href: `/practice/new?topic=${topic.id}`,
      });
      break;
    }
  }

  // 3. 有足夠證據顯示較弱的技能 → 建議針對該技能練習
  for (const topic of topics) {
    const skills = getSkillProgress(learnerId, topic.id, now)
      .filter((skill) => skill.sufficientEvidence && skill.incorrectQuestions > 0)
      .sort((left, right) => right.incorrectQuestions - left.incorrectQuestions);
    const weakest = skills[0];
    if (weakest !== undefined) {
      recommendations.push({
        kind: "practise-skill",
        title: `練習技能「${weakest.skill}」`,
        reason: `你在「${topic.title}」的「${weakest.skill}」有 ${weakest.incorrectQuestions} 條題目未答對（已作答 ${weakest.attemptedQuestions} 條）。`,
        href: `/practice/new?topic=${topic.id}`,
      });
      break;
    }
  }

  // 4. 完全未開始且可練習的課題 → 建議先閱讀教材再練習
  const unattempted = topics.find(
    (topic) => getTopicProgress(learnerId, topic.id, now).attemptedQuestions === 0,
  );
  if (unattempted !== undefined) {
    recommendations.push({
      kind: "read-lesson",
      title: `開始「${unattempted.title}」`,
      reason: "你尚未在這個課題作答。可先閱讀教材，再嘗試練習；閱讀本身不計算為已掌握。",
      href: `/practice/new?topic=${unattempted.id}`,
    });
  } else if (topics.length > 0) {
    recommendations.push({
      kind: "try-topic",
      title: "繼續練習其他課題",
      reason: "你在已開始的課題都已有記錄，繼續練習其他課題可以擴闊覆蓋範圍。",
      href: "/",
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      kind: "neutral",
      title: "選擇一個課題開始練習",
      reason: "目前沒有足夠的作答記錄可以提出建議，先完成一次練習即可獲得個人化建議。",
      href: "/",
    });
  }

  return recommendations.slice(0, limit);
}

/** 課題及分節名稱（介面顯示用；只回傳已發布課題） */
export function listProgressTopics(): { id: string; title: string }[] {
  return listTopics()
    .filter((topic) => topic.published && topic.level !== 0)
    .map((topic) => ({ id: topic.id, title: topic.title }));
}

/** 分節標題對照（重溫佇列顯示用） */
export function sectionTitles(topicId: string): Map<string, string> {
  return new Map(listSections(topicId).map((section) => [section.id, section.title]));
}
