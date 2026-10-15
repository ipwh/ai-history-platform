/**
 * 學生練習流程：組題、作答、看答案、看成績、重做錯題。
 *
 * 每次練習都會凍結當下的題目快照，之後重看結果內容一致。
 * 學生的答案不會傳送給 LLM。
 */
import {
  practiceSetupSchema,
  studentQuestionSchema,
  type AiGrading,
  type AssembledPractice,
  type Difficulty,
  type PracticeResult,
  type PracticeSetupInput,
  type Question,
  type QuestionFeedback,
  type QuestionType,
  type StudentQuestion,
} from "../../lib/types";
import { ensureBootstrap } from "../seed";
import { ensureLearner, getLearnerProgress } from "../repositories/learners";
import { ApiRouteError } from "../http";
import { getServerConfig } from "../config";
import { reserveAiOperation } from "./ai-limits";
import { getBlocksByIds } from "../repositories/materials";
import { normalizeForMatch } from "../materials/text-utils";
import {
  createSession,
  getAttempt,
  getSession,
  getSessionNotice,
  getSessionQuestions,
  listAttempts,
  listWrongAttempts,
  markSessionCompleted,
  saveAttempt,
  type WrongAttemptRef,
} from "../repositories/practice";
import { listQuestions } from "../repositories/questions";
import { expandSectionIds, getTopic, sectionTitleMap } from "../repositories/topics";
import { calculateAccuracy, gradeAnswer, type GradeOutcome } from "./grading";
import { gradeWithAi } from "./ai-grading";
import { generateQuestions } from "./question-service";

export class PracticeServiceError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PracticeServiceError";
    this.status = status;
  }
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

/**
 * 打亂選擇題的選項次序。
 * 題庫及 AI 生成都習慣把正確答案放在第一個選項，若沿用原本次序，
 * 學生每次選 A 就會答對大部分題目。標準答案以文字儲存，打亂選項不影響評分。
 */
function shuffleQuestionOptions(question: Question): Question {
  if (question.questionType !== "mc" || question.options.length < 2) return question;
  return { ...question, options: shuffle(question.options) };
}

function toStudentQuestion(question: Question): StudentQuestion {
  return studentQuestionSchema.parse(question);
}

export function buildFeedback(
  question: Question,
  answer: string,
  attempt: {
    autoGraded: boolean;
    isCorrect: boolean | null;
    selfAssessment: "understood" | "needs-review" | null;
    aiGrading?: AiGrading | null;
  } | null,
  sourceFromOcr = false,
  reviewFlag: "uncertain-answer" | null = null,
  aiLimitReached = false,
): QuestionFeedback {
  return {
    questionId: question.id,
    answer,
    autoGraded: attempt?.autoGraded ?? question.questionType !== "short",
    isCorrect: attempt?.isCorrect ?? null,
    correctAnswer: question.correctAnswer,
    acceptedAnswers: question.acceptedAnswers,
    explanation: question.explanation,
    knowledgePoint: question.knowledgePoint,
    gradingPoints: question.gradingPoints,
    sourceExcerpt: question.sourceExcerpt,
    sourceLocation: question.sourceLocation,
    sourceBlockIds: question.sourceBlockIds,
    sourceFromOcr,
    aiGrading: attempt?.aiGrading ?? null,
    selfAssessment: attempt?.selfAssessment ?? null,
    reviewFlag,
    aiLimitReached,
  };
}

/** 檢查題目的教材依據是否包含 OCR 辨識文字（介面會提示教師核對） */
function questionUsesOcr(question: Question): boolean {
  if (question.sourceBlockIds.length === 0) return false;
  try {
    return getBlocksByIds(question.sourceBlockIds).some(
      (block) => block.extractionMethod === "ocr",
    );
  } catch {
    return false;
  }
}

/**
 * 這個答案是否需要交給 AI 批改（與 gradeWithAiIfNeeded 的判斷一致）。
 * 用來決定是否要保留 AI 用量額度：已答對的填充題不會呼叫模型，毋須消耗額度；
 * 未接上真正的 provider（示範模式）時亦不會呼叫模型，同樣不應消耗額度。
 */
function needsAiGrading(question: Question, outcome: GradeOutcome): boolean {
  if (!getServerConfig().llm.gradingEnabled) return false;
  if (question.questionType === "mc") return false;
  if (question.questionType === "fill" && outcome.isCorrect === true) return false;
  return true;
}

/**
 * 需要時以 AI 按語意批改答案：
 *   - 短答題一律嘗試（原本不會自動評分，只由學生自我檢查）
 *   - 填充題只在逐字比對不合格時嘗試（已答對就毋須再花時間及費用）
 *   - 選擇題不適用
 */
async function gradeWithAiIfNeeded(
  question: Question,
  topicId: string,
  answer: string,
  outcome: GradeOutcome,
  sessionId: string,
): Promise<AiGrading | null> {
  if (question.questionType === "mc") return null;
  if (question.questionType === "fill" && outcome.isCorrect === true) return null;

  const topic = getTopic(topicId);
  return gradeWithAi({
    question,
    topicTitle: topic?.title ?? "",
    topicId,
    sessionId,
    studentAnswer: answer,
  });
}

/**
 * 由練習快照收集需要重做的錯題。
 * 即時生成的題目只存在於練習快照內，因此不可依賴題庫查詢。
 */
function collectQuestionsFromWrongAttempts(
  wrongAttempts: WrongAttemptRef[],
  sectionIds: string[],
  questionTypes: QuestionType[],
): Question[] {
  const snapshotCache = new Map<string, Question[]>();
  const selectedSectionIds = new Set(sectionIds);
  const collected = new Map<string, Question>();

  for (const attempt of wrongAttempts) {
    if (collected.has(attempt.questionId)) continue;
    let snapshot = snapshotCache.get(attempt.sessionId);
    if (snapshot === undefined) {
      snapshot = getSessionQuestions(attempt.sessionId);
      snapshotCache.set(attempt.sessionId, snapshot);
    }
    const question = snapshot.find((item) => item.id === attempt.questionId);
    if (!question) continue;
    if (!selectedSectionIds.has(question.sectionId)) continue;
    if (!questionTypes.includes(question.questionType)) continue;
    collected.set(question.id, question);
  }

  return [...collected.values()];
}

/** 把題目數量平均分配到各分節，確保每個揀選的主題都有題目 */
export function distributeQuestionCount(total: number, sectionIds: string[]): Map<string, number> {
  const allocation = new Map<string, number>();
  if (sectionIds.length === 0) return allocation;

  const base = Math.floor(total / sectionIds.length);
  let remainder = total % sectionIds.length;
  sectionIds.forEach((sectionId) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    const count = base + extra;
    if (count > 0) allocation.set(sectionId, count);
  });
  return allocation;
}

interface SectionGenerationOutcome {
  sectionId: string;
  generated: Awaited<ReturnType<typeof generateQuestions>> | null;
  error: unknown;
}

/** 依分節平行生成題目，個別分節失敗不會影響其他分節 */
async function generateForSections(options: {
  topicId: string;
  allocation: Map<string, number>;
  questionTypes: QuestionType[];
  difficulty: Difficulty;
}): Promise<SectionGenerationOutcome[]> {
  return Promise.all(
    [...options.allocation.entries()].map(async ([sectionId, count]) => {
      try {
        const generated = await generateQuestions({
          topicId: options.topicId,
          sectionIds: [sectionId],
          questionTypes: options.questionTypes,
          difficulty: options.difficulty,
          questionCount: count,
          persist: false,
          allowBankDuplicates: true,
          requestType: "question-instant",
        });
        return { sectionId, generated, error: null };
      } catch (error) {
        console.warn("[practice] 即時生成題目失敗", sectionId, error);
        return { sectionId, generated: null, error };
      }
    }),
  );
}

/**
 * 依所選分節即時生成題目（每題都必須有教材依據）。
 *
 * 先把題數平均分配到各分節，確保每個揀選的主題都有題目；
 * 若個別分節因教材內容不足而未能出題，會再由其他分節補足題數，
 * 盡量做到「選 N 題就拿到 N 題」。
 */
async function generatePracticeQuestions(options: {
  topicId: string;
  sectionIds: string[];
  questionTypes: QuestionType[];
  difficulty: Difficulty;
  questionCount: number;
}): Promise<{ questions: Question[]; notices: string[] }> {
  const outcomes = await generateForSections({
    topicId: options.topicId,
    allocation: distributeQuestionCount(options.questionCount, options.sectionIds),
    questionTypes: options.questionTypes,
    difficulty: options.difficulty,
  });

  const notices: string[] = [];
  const questions: Question[] = [];
  const usedKeys = new Set<string>();
  const sectionsWithQuestions = new Set<string>();
  let usedDemoFallback = false;
  let firstError: unknown = null;

  const collect = (results: SectionGenerationOutcome[]): number => {
    let added = 0;
    for (const outcome of results) {
      if (outcome.generated === null) {
        firstError = firstError ?? outcome.error;
        continue;
      }
      usedDemoFallback = usedDemoFallback || outcome.generated.usedDemoFallback;
      if (outcome.generated.notice !== null) notices.push(outcome.generated.notice);
      for (const question of outcome.generated.questions) {
        const key = normalizeForMatch(question.question);
        if (usedKeys.has(key)) continue;
        usedKeys.add(key);
        questions.push(question);
        sectionsWithQuestions.add(outcome.sectionId);
        added += 1;
      }
    }
    return added;
  };

  collect(outcomes);

  // 由已成功出題的分節補足不足的題數（只補一次，避免無限重試）
  let missing = options.questionCount - questions.length;
  if (missing > 0) {
    const fallbackSections = [...sectionsWithQuestions];
    if (fallbackSections.length > 0) {
      const topUp = await generateForSections({
        topicId: options.topicId,
        allocation: distributeQuestionCount(missing, fallbackSections),
        questionTypes: options.questionTypes,
        difficulty: options.difficulty,
      });
      collect(topUp);
      missing = options.questionCount - questions.length;
    }
  }

  if (questions.length === 0) {
    // 詳細原因（例如教材不足以出題）只記錄在伺服器日誌，學生端只顯示可行動的建議
    const reason = firstError instanceof Error ? firstError.message : "";
    if (reason.length > 0) console.warn("[practice] 即時生成題目失敗原因", reason);
    throw new PracticeServiceError(
      "未能為所選主題生成題目。請試試其他主題、減少題目數量，或改用「使用題庫題目」。",
      502,
    );
  }

  notices.unshift(
    usedDemoFallback
      ? "這次練習的題目由本地示範生成（未使用 AI），並已核對教材依據。"
      : "這次練習的題目由 AI 按你揀選的主題即時生成，並已核對教材依據。",
  );

  const emptySections = options.sectionIds.filter(
    (sectionId) => !sectionsWithQuestions.has(sectionId),
  );
  if (emptySections.length > 0) {
    notices.push(
      `有 ${emptySections.length} 個主題的教材內容暫時未能出題，這次練習只包含其餘主題的題目。`,
    );
  }
  if (missing > 0) {
    notices.push(
      `AI 這次準備了 ${questions.length} 題（原定 ${options.questionCount} 題），可以相同設定再練習一次以取得新題目。`,
    );
  }

  return { questions, notices };
}

/**
 * 組題並建立練習記錄。
 * 出題方式：
 *   bank（預設）：先使用題庫（示範題／教師已發布題目），不足時才即時生成。
 *   ai：依所選分節即時生成有教材依據的題目，讓學生揀選主題後由 AI 出題。
 */
export async function createPractice(setup: PracticeSetupInput): Promise<AssembledPractice> {
  ensureBootstrap();
  const parsed = practiceSetupSchema.parse(setup);
  ensureLearner(parsed.learnerId);

  const topic = getTopic(parsed.topicId);
  if (!topic) throw new PracticeServiceError("找不到指定的課題", 404);

  const sectionIds = expandSectionIds(topic.id, parsed.sectionIds);
  if (sectionIds.length === 0) throw new PracticeServiceError("找不到指定的分節", 404);

  const notices: string[] = [];
  let selected: Question[] = [];
  let origin: AssembledPractice["session"]["origin"] = "bank";

  if (parsed.mode === "wrong-only") {
    const wrongAttempts = listWrongAttempts({
      learnerId: parsed.learnerId,
      topicId: topic.id,
      sourceSessionId: parsed.sourceSessionId,
    });
    if (wrongAttempts.length === 0) {
      throw new PracticeServiceError(
        "目前沒有找到需要重做的錯題。請先完成一次練習，或選擇「完整練習」。",
        409,
      );
    }
    selected = shuffle(
      collectQuestionsFromWrongAttempts(wrongAttempts, sectionIds, parsed.questionTypes),
    ).slice(0, parsed.questionCount);
    if (selected.length === 0) {
      throw new PracticeServiceError(
        "之前的錯題不在這次選擇的主題內，請改選其他主題後再試。",
        409,
      );
    }
    notices.push("這次練習只包含你之前答錯或標記需要重溫的題目。");
  } else if (parsed.questionSource === "ai") {
    // AI 用量上限：在呼叫模型之前先保留額度，超過上限即回 429（不會先花費再拒絕）
    reserveAiOperation(parsed.learnerId, "generation");
    const generated = await generatePracticeQuestions({
      topicId: topic.id,
      sectionIds,
      questionTypes: parsed.questionTypes,
      difficulty: parsed.difficulty,
      questionCount: parsed.questionCount,
    });
    selected = shuffle(generated.questions).slice(0, parsed.questionCount);
    origin = "generated";
    notices.push(...generated.notices);
  } else {
    const bankAll = listQuestions({
      topicId: topic.id,
      sectionIds,
      questionTypes: parsed.questionTypes,
      statuses: ["published"],
    });

    const sameDifficulty = shuffle(bankAll.filter((item) => item.difficulty === parsed.difficulty));
    selected = sameDifficulty.slice(0, parsed.questionCount);

    if (selected.length < parsed.questionCount) {
      const others = shuffle(
        bankAll.filter(
          (item) =>
            item.difficulty !== parsed.difficulty &&
            !selected.some((chosen) => chosen.id === item.id),
        ),
      );
      const supplement = others.slice(0, parsed.questionCount - selected.length);
      if (supplement.length > 0) {
        selected = [...selected, ...supplement];
        notices.push(`所選難度的題目不足，已加入其他難度的題目補足。`);
      }
    }

    if (selected.length < parsed.questionCount) {
      const missing = parsed.questionCount - selected.length;
      try {
        const generated = await generateQuestions({
          topicId: topic.id,
          sectionIds,
          questionTypes: parsed.questionTypes,
          difficulty: parsed.difficulty,
          questionCount: missing,
          requestType: "question-instant",
        });
        if (generated.questions.length > 0) {
          selected = [...selected, ...generated.questions];
          origin = "generated";
          notices.push(
            generated.usedDemoFallback
              ? "題庫題目不足，已即時按教材內容生成題目（本地示範生成模式）。"
              : "題庫題目不足，已即時按教材內容生成題目。",
          );
          if (generated.notice) notices.push(generated.notice);
        }
      } catch (error) {
        // 學生端只顯示簡短說明，詳細原因（例如教材不足以生成題目）留給教師後台
        console.warn("[practice] 生成額外題目失敗", error);
        notices.push(
          "未能即時生成額外題目，這次只提供題庫中已有的題目。教師可在「題目管理」補充題目或設定 AI provider。",
        );
      }
    }

    if (selected.length === 0) {
      const hasMaterial = sectionIds.some((sectionId) =>
        listQuestions({ topicId: topic.id, sectionIds: [sectionId] }).length > 0,
      );
      throw new PracticeServiceError(
        hasMaterial
          ? "此分節在目前題型及難度下沒有可用題目，請嘗試其他題型或難度。"
          : "此分節暫時沒有可用題目。請教師先匯入教材並發布題目，或改用內建示範題庫的分節。",
        409,
      );
    }

    if (parsed.questionCount > selected.length) {
      notices.push(`可用的題目只有 ${selected.length} 題，因此本次練習為 ${selected.length} 題。`);
    }
  }

  const demonstrate = selected.some((question) => question.origin === "demo");
  if (demonstrate && origin === "bank") {
    origin = "demo";
    notices.push("部分題目來自內建示範題庫，並附有教材節錄供你核對。");
  }

  // 凍結題目快照前先打亂選擇題選項，令正確答案平均分佈於各選項位置
  const prepared = selected.map(shuffleQuestionOptions);

  const session = createSession({
    learnerId: parsed.learnerId,
    topicId: topic.id,
    sectionIds,
    questionTypes: parsed.questionTypes,
    difficulty: parsed.difficulty,
    mode: parsed.mode,
    sourceSessionId: parsed.sourceSessionId,
    origin,
    questions: prepared,
    notice: notices.length > 0 ? notices.join(" ") : null,
  });

  return {
    session,
    questions: prepared.map(toStudentQuestion),
    notice: session ? (notices.length > 0 ? notices.join(" ") : null) : null,
  };
}

export interface PracticeView {
  session: NonNullable<ReturnType<typeof getSession>>;
  questions: StudentQuestion[];
  notice: string | null;
  /** 已作答題目的回饋（讓學生重新載入頁面後仍可查看答案） */
  feedback: QuestionFeedback[];
}

export function getPracticeView(sessionId: string, learnerId: string): PracticeView {
  const session = getSession(sessionId);
  if (!session) throw new PracticeServiceError("找不到這次練習記錄", 404);
  if (session.learnerId !== learnerId) {
    throw new PracticeServiceError("不能讀取其他學習者的練習記錄", 403);
  }

  const questions = getSessionQuestions(sessionId);
  const attempts = listAttempts(sessionId);
  const attemptByQuestion = new Map(attempts.map((attempt) => [attempt.questionId, attempt]));

  return {
    session,
    questions: questions.map(toStudentQuestion),
    notice: getSessionNotice(sessionId),
    feedback: questions
      .filter((question) => attemptByQuestion.has(question.id))
      .map((question) => {
        const attempt = attemptByQuestion.get(question.id)!;
        return buildFeedback(question, attempt.answer, attempt, questionUsesOcr(question));
      }),
  };
}

export interface SubmitAnswerResult {
  feedback: QuestionFeedback;
  /** 這次提交是否已即時記錄（重複提交不會改變分數） */
  recorded: boolean;
  /** 已完成題數／總題數 */
  answeredCount: number;
  totalQuestions: number;
}

export async function submitAnswer(
  sessionId: string,
  learnerId: string,
  questionId: string,
  answer: string,
): Promise<SubmitAnswerResult> {
  const session = getSession(sessionId);
  if (!session) throw new PracticeServiceError("找不到這次練習記錄", 404);
  if (session.learnerId !== learnerId) {
    throw new PracticeServiceError("不能修改其他學習者的練習記錄", 403);
  }

  const questions = getSessionQuestions(sessionId);
  const question = questions.find((item) => item.id === questionId);
  if (!question) throw new PracticeServiceError("這條題目不屬於本次練習", 404);

  const existing = getAttempt(sessionId, questionId);
  if (existing) {
    // 已提交過的題目不會再改變分數，避免看到答案後重覆作答影響成績。
    // 重新整理頁面時亦要顯示相同的覆核標示，因此重新計算一次（純字串比對，成本極低）。
    const storedOutcome = gradeAnswer(question, existing.answer);
    const storedNearMiss =
      storedOutcome.uncertain === true && existing.aiGrading?.verdict !== "correct"
        ? "uncertain-answer"
        : null;
    return {
      feedback: buildFeedback(
        question,
        existing.answer,
        existing,
        questionUsesOcr(question),
        storedNearMiss,
      ),
      recorded: false,
      answeredCount: listAttempts(sessionId).length,
      totalQuestions: questions.length,
    };
  }

  const trimmed = answer.trim();
  if (trimmed.length === 0) {
    throw new PracticeServiceError("請先作答再提交。", 400);
  }

  const outcome = gradeAnswer(question, trimmed);

  // 填充題在逐字比對不合格，以及所有短答題，都會以 AI 按語意再判斷一次，
  // 避免因為用字、詞序或補充說明等與答案無關的差異而被判錯。
  //
  // AI 用量上限：只有在真的會呼叫模型時才保留用量（已比對成功的填充題不會，
  // 否則會白白消耗額度）。達到上限時仍然記錄作答（沿用字詞比對結果），
  // 並在回饋中說明 AI 批改暫時不可用，學生不會因此無法提交答案。
  let aiLimitReached = false;
  let aiGrading: AiGrading | null = null;
  if (needsAiGrading(question, outcome)) {
    try {
      reserveAiOperation(learnerId, "grading");
      aiGrading = await gradeWithAiIfNeeded(question, session.topicId, trimmed, outcome, sessionId);
    } catch (error) {
      if (error instanceof ApiRouteError && error.status === 429) {
        aiLimitReached = true;
      } else {
        throw error;
      }
    }
  }

  const isCorrect =
    outcome.isCorrect === null ? null : outcome.isCorrect || aiGrading?.verdict === "correct";

  // 逐字比對不合格但答案極為接近（可能是錯別字），且 AI 亦未判定為正確時，
  // 標示為需要教師覆核，讓學生知道這個判斷未必準確。
  const nearMiss =
    outcome.uncertain === true && aiGrading?.verdict !== "correct" ? "uncertain-answer" : null;

  const attempt = saveAttempt({
    sessionId,
    questionId,
    learnerId,
    answer: trimmed,
    autoGraded: outcome.autoGraded,
    isCorrect,
    aiGrading,
    // 把「近似答案」的判定寫入記錄：進度及重溫排程需要區分不確定與明確錯誤，
    // 而且之後題目答案若被修改，不應重新詮釋這筆歷史作答。
    uncertain: nearMiss !== null,
  });

  const answeredCount = listAttempts(sessionId).length;
  if (answeredCount >= questions.length) markSessionCompleted(sessionId);

  return {
    feedback: buildFeedback(question, trimmed, attempt, questionUsesOcr(question), nearMiss, aiLimitReached),
    recorded: true,
    answeredCount,
    totalQuestions: questions.length,
  };
}

export function setSelfAssessment(
  sessionId: string,
  learnerId: string,
  questionId: string,
  selfAssessment: "understood" | "needs-review",
): QuestionFeedback {
  const session = getSession(sessionId);
  if (!session) throw new PracticeServiceError("找不到這次練習記錄", 404);
  if (session.learnerId !== learnerId) {
    throw new PracticeServiceError("不能修改其他學習者的練習記錄", 403);
  }

  const question = getSessionQuestions(sessionId).find((item) => item.id === questionId);
  if (!question) throw new PracticeServiceError("這條題目不屬於本次練習", 404);
  if (question.questionType !== "short") {
    throw new PracticeServiceError("只有短答題需要自我檢查。", 400);
  }

  const existing = getAttempt(sessionId, questionId);
  const attempt = saveAttempt({
    sessionId,
    questionId,
    learnerId,
    answer: existing?.answer ?? "（未輸入答案）",
    autoGraded: false,
    isCorrect: null,
    selfAssessment,
  });

  return buildFeedback(question, attempt.answer, attempt, questionUsesOcr(question));
}

export function getPracticeResult(sessionId: string, learnerId: string): PracticeResult {
  const session = getSession(sessionId);
  if (!session) throw new PracticeServiceError("找不到這次練習記錄", 404);
  if (session.learnerId !== learnerId) {
    throw new PracticeServiceError("不能讀取其他學習者的練習記錄", 403);
  }

  const questions = getSessionQuestions(sessionId);
  const attempts = listAttempts(sessionId);
  const attemptByQuestion = new Map(attempts.map((attempt) => [attempt.questionId, attempt]));
  const titles = sectionTitleMap(session.topicId);

  const feedback = questions.map((question) => {
    const attempt = attemptByQuestion.get(question.id) ?? null;
    return buildFeedback(question, attempt?.answer ?? "", attempt, questionUsesOcr(question));
  });

  const graded = feedback.filter((item) => item.autoGraded);
  const correctCount = graded.filter((item) => item.isCorrect === true).length;

  const toReview = new Map<string, { knowledgePoint: string; sectionTitle: string; questionIds: string[] }>();
  questions.forEach((question) => {
    const attempt = attemptByQuestion.get(question.id);
    const needsReview =
      attempt?.isCorrect === false || attempt?.selfAssessment === "needs-review";
    if (!needsReview) return;
    const key = question.knowledgePoint;
    const entry = toReview.get(key) ?? {
      knowledgePoint: key,
      sectionTitle: titles.get(question.sectionId) ?? "",
      questionIds: [],
    };
    entry.questionIds.push(question.id);
    toReview.set(key, entry);
  });

  const selfReviewKnowledgePoints = feedback
    .filter((item) => item.selfAssessment === "needs-review")
    .map((item) => item.knowledgePoint);

  return {
    session,
    totalQuestions: questions.length,
    answeredCount: attempts.length,
    gradedCount: graded.length,
    correctCount,
    accuracy: calculateAccuracy(correctCount, graded.length),
    knowledgePointsToReview: [...toReview.values()],
    selfReviewKnowledgePoints: [...new Set(selfReviewKnowledgePoints)],
    feedback,
  };
}

export function completePractice(sessionId: string, learnerId: string): PracticeResult {
  const session = getSession(sessionId);
  if (!session) throw new PracticeServiceError("找不到這次練習記錄", 404);
  if (session.learnerId !== learnerId) {
    throw new PracticeServiceError("不能修改其他學習者的練習記錄", 403);
  }
  markSessionCompleted(sessionId);
  return getPracticeResult(sessionId, learnerId);
}

/** 需要重溫的知識點（跨練習記錄的累積統計） */
export function getTopicProgress(learnerId: string, topicId: string) {
  return getLearnerProgress(learnerId, topicId);
}
