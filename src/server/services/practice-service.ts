/**
 * 學生練習流程：組題、作答、看答案、看成績、重做錯題。
 *
 * 每次練習都會凍結當下的題目快照，之後重看結果內容一致。
 * 學生的答案不會傳送給 LLM。
 */
import {
  practiceSetupSchema,
  studentQuestionSchema,
  QUESTION_TYPE_LABELS,
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
import { createDuplicateTracker } from "../llm/question-dedupe";
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
import { checkQuestionServable } from "./question-servability";
import { studentExcerptIsVisible } from "./source-visibility";

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
    aiGrading?: AiGrading | null;
  } | null,
  sourceFromOcr = false,
  reviewFlag: "uncertain-answer" | null = null,
  aiLimitReached = false,
): QuestionFeedback {
  // 教材節錄只在來源文件已確認可向學生發布時才顯示（見 sourceExcerptIsStudentVisible）
  const excerptVisible = sourceExcerptIsStudentVisible(question);

  return {
    questionId: question.id,
    answer,
    autoGraded: attempt?.autoGraded ?? true,
    isCorrect: attempt?.isCorrect ?? null,
    correctAnswer: question.correctAnswer,
    acceptedAnswers: question.acceptedAnswers,
    explanation: question.explanation,
    knowledgePoint: question.knowledgePoint,
    gradingPoints: question.gradingPoints,
    sourceExcerpt: excerptVisible ? question.sourceExcerpt : null,
    sourceLocation: excerptVisible ? question.sourceLocation : null,
    sourceBlockIds: excerptVisible ? question.sourceBlockIds : [],
    sourceWithheld: !excerptVisible,
    sourceFromOcr,
    aiGrading: attempt?.aiGrading ?? null,
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
 * 這條題目的教材節錄是否「可向學生顯示」。
 *
 * 實作已移至 `source-visibility.ts`（學生端回饋與教師端覆核清單共用同一個判定，
 * 避免兩邊政策不一致）。保留此名稱以免既有呼叫端及測試失效。
 */
export function sourceExcerptIsStudentVisible(question: Question): boolean {
  return studentExcerptIsVisible(question);
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
    // 結構上無法作答的題目（多個空格只有一個答案、選項失效等）不再派給學生
    if (!checkQuestionServable(question).ok) continue;
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

/**
 * 找出「有分配到題目、但最終沒有可用題目」的分節。
 *
 * 題目數量少於所選分節時，部分分節本來就不會分配到題目（例如選了 18 個分節、
 * 只要求 10 題），它們並非教材不足，不應計入「未能出題」的提示。
 */
export function countUnproductiveSections(
  allocation: Map<string, number>,
  sectionsWithQuestions: Iterable<string>,
): string[] {
  const produced = new Set(sectionsWithQuestions);
  return [...allocation.keys()].filter((sectionId) => !produced.has(sectionId));
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
  /** 已用過的答案：補題時提示生成器改出其他史實，避免同一題被改寫後再次出現 */
  avoidAnswers?: string[];
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
          // 多要求 1–2 題作備用：真實模型偶爾寫出違規題幹，多出的題目可補上，
          // 避免「一題不合格」令整節沒有題目（見 GenerateOptions.overGenerate）。
          // 只要求 1 題時多要 1 題（已是兩倍機會）；要求 2 題以上則多要 2 題。
          overGenerate: count <= 1 ? 1 : 2,
          persist: false,
          allowBankDuplicates: true,
          requestType: "question-instant",
          // 學生自行觸發：教材來源只可取用已確認可向學生發布的內容（fail-closed）
          audience: "student",
          avoidAnswers: options.avoidAnswers,
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
  const allocation = distributeQuestionCount(options.questionCount, options.sectionIds);
  const outcomes = await generateForSections({
    topicId: options.topicId,
    allocation,
    questionTypes: options.questionTypes,
    difficulty: options.difficulty,
  });

  const notices: string[] = [];
  const questions: Question[] = [];
  const used = createDuplicateTracker();
  const sectionsWithQuestions = new Set<string>();
  let usedDemoFallback = false;
  let firstError: unknown = null;
  // 已暫緩自動發布（待教師確認）而被抽起的題數。
  // 必須在 `collect` 第一次被呼叫**之前**宣告，否則 `collect` 內的 `withheld += 1`
  // 會擲出 TDZ ReferenceError，令整次練習以 500 失敗（而不是抽起該題）。
  let withheld = 0;

  const collect = (results: SectionGenerationOutcome[]): number => {
    let added = 0;
    for (const outcome of results) {
      if (outcome.generated === null) {
        firstError = firstError ?? outcome.error;
        continue;
      }
      usedDemoFallback = usedDemoFallback || outcome.generated.usedDemoFallback;
      if (outcome.generated.notice !== null) {
        // 生成服務每次呼叫都會附上「有 N 條題目未確定…」的訊息；這裡移除，
        // 改由下方以整次練習的總數統一說明，避免同一訊息重複顯示多次。
        const withoutHeld = outcome.generated.notice
          .replace(/有 \d+ 條題目的品質檢查有未確定項目[^。]*。\s*/g, "")
          .trim();
        if (withoutHeld.length > 0) notices.push(withoutHeld);
      }
      for (const question of outcome.generated.questions) {
        // 跨分節、跨呼叫的去重（見 question-dedupe.ts）：舊版只比對題幹完全相同的字串，
        // 令「同一教材依據、同一答案、題幹略作改寫」的題目同時出現在一份練習之中；
        // 填充題更進一步按答案去重（同一份練習不出兩條答案相同的填充題）。
        if (used.isDuplicate(question)) continue;
        // 已見過的題目（包括下面抽起的未確定題目）一律記錄，補題時才不會重複計算，
        // 亦會透過 avoidAnswers 提示模型改出其他答案。
        used.add(question);
        // Sprint 7.9：品質閘門判定「未確定」（仍待教師確認）的題目不提供給學生；
        // 其他題目照常進行，未確定的題目只影響它自己（見 withheld 計數）。
        if (question.teacherConfirmationRequired) {
          withheld += 1;
          continue;
        }
        questions.push(question);
        sectionsWithQuestions.add(outcome.sectionId);
        added += 1;
      }
    }
    return added;
  };

  collect(outcomes);

  // 由已成功出題的分節補足不足的題數。最多補兩輪（有進展才繼續），避免無限重試；
  // 2026-10-18 由「只補一次」放寬為兩輪：單輪補題常因個別分節無合適題材而不足，
  // 令學生明明還有可用題材卻只拿到部分題目。
  //
  // 補題的第二輪會把「第一輪完全出不到題目」的分節也納入（機會均等），因為單次生成
  // 失敗往往只是模型寫壞了一題，再試一次多數可以交出題目。
  let missing = options.questionCount - questions.length;
  const emptySectionIds = countUnproductiveSections(allocation, sectionsWithQuestions);
  for (let round = 0; round < 2 && missing > 0; round += 1) {
    const fallbackSections =
      round === 0 ? [...sectionsWithQuestions] : [...sectionsWithQuestions, ...emptySectionIds];
    if (fallbackSections.length === 0) break;
    const before = questions.length;
    const topUp = await generateForSections({
      topicId: options.topicId,
      allocation: distributeQuestionCount(missing, fallbackSections),
      questionTypes: options.questionTypes,
      difficulty: options.difficulty,
      avoidAnswers: used.usedAnswers(),
    });
    collect(topUp);
    missing = options.questionCount - questions.length;
    if (questions.length === before) break;
  }

  if (questions.length === 0) {
    // 詳細原因（例如教材不足以出題）只記錄在伺服器日誌，學生端只顯示可行動的建議
    const reason = firstError instanceof Error ? firstError.message : "";
    if (reason.length > 0) console.warn("[practice] 即時生成題目失敗原因", reason);
    // 版權閘門造成的失敗值得如實告知學生原因（不是「題目不足」，而是教材尚未開放），
    // 否則學生只會不斷重試同一分節而不知道要聯絡教師。
    if (reason.includes("尚未開放學生使用")) {
      throw new PracticeServiceError(reason, 409);
    }
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

  // 只列出「有分配到題目、但最終沒有可用題目」的分節；題目數量少於所選分節時，
  // 沒有分配到題目的分節並非教材不足，不應計入這個提示（否則 18 個分節、10 題時
  // 會誤報「15 個主題未能出題」）。
  const emptySections = countUnproductiveSections(allocation, sectionsWithQuestions);
  if (emptySections.length > 0) {
    notices.push(
      `有 ${emptySections.length} 個所選主題未能出題（教材不足或題目未通過檢查），這次練習只包含其餘主題的題目。`,
    );
  }
  if (missing > 0) {
    notices.push(
      `AI 這次準備了 ${questions.length} 題（原定 ${options.questionCount} 題），可以相同設定再練習一次以取得新題目。`,
    );
  }
  if (withheld > 0) {
    notices.push(
      `有 ${withheld} 條題目的品質檢查有未確定項目，暫時不會提供，已交教師確認；其他題目不受影響。`,
    );
  }

  return { questions, notices: [...new Set(notices)] };
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
      // Sprint 7.9：閘門判定未確定、仍待教師確認的題目不會進入學生練習，
      // 即使資料庫中因舊資料或人為操作而仍是 published。
    }).filter((item) => !item.teacherConfirmationRequired && checkQuestionServable(item).ok);

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
          overGenerate: 2,
          requestType: "question-instant",
          // 學生自行觸發：教材來源只可取用已確認可向學生發布的內容（fail-closed）
          audience: "student",
        });
        // 品質閘門判定「未確定」（仍待教師確認）的題目不得交付學生：這條路徑以往
        // 直接採用生成結果，會把「自動發布已暫緩」的題目寫進練習快照，令它繞過
        // 三條發布路徑的關卡（見 question-service 及 0020 migration）。
        const deliverable = generated.questions.filter(
          (question) => !question.teacherConfirmationRequired,
        );
        const heldCount = generated.questions.length - deliverable.length;
        if (deliverable.length > 0) {
          selected = [...selected, ...deliverable];
          origin = "generated";
          notices.push(
            generated.usedDemoFallback
              ? "題庫題目不足，已即時按教材內容生成題目（本地示範生成模式）。"
              : "題庫題目不足，已即時按教材內容生成題目。",
          );
          if (generated.notice) notices.push(generated.notice);
        }
        if (heldCount > 0) {
          notices.push(
            `有 ${heldCount} 條即時生成的題目品質檢查有未確定項目，暫時不會提供，已交教師確認；其他題目不受影響。`,
          );
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

  // 選了多於一種題型時，如實列出這次練習包含的題型及題數：
  // 題型是可多選的（選擇題預設已選），學生若只打算練一種題型，會在練習頁即時看到實際組合。
  if (parsed.questionTypes.length > 1) {
    const counts = new Map<QuestionType, number>();
    for (const question of prepared) {
      counts.set(question.questionType, (counts.get(question.questionType) ?? 0) + 1);
    }
    if (counts.size > 1) {
      notices.push(
        `這次練習包含 ${[...counts.entries()]
          .map(([type, count]) => `${QUESTION_TYPE_LABELS[type]} ${count} 題`)
          .join("、")}。`,
      );
    }
  }

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

  // 填充題在逐字比對不合格時，會以 AI 按語意再判斷一次，
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
    // 批改依據的題目版本（練習快照中凍結的那一版）：題目之後被修正時，
    // 教師才能指出哪些舊作答受影響，而不會靜默改寫學生的分數。
    questionRevision: question.revision,
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
    if (attempt?.isCorrect !== false) return;
    const key = question.knowledgePoint;
    const entry = toReview.get(key) ?? {
      knowledgePoint: key,
      sectionTitle: titles.get(question.sectionId) ?? "",
      questionIds: [],
    };
    entry.questionIds.push(question.id);
    toReview.set(key, entry);
  });

  return {
    session,
    totalQuestions: questions.length,
    answeredCount: attempts.length,
    gradedCount: graded.length,
    correctCount,
    accuracy: calculateAccuracy(correctCount, graded.length),
    knowledgePointsToReview: [...toReview.values()],
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
