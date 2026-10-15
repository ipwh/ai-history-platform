/**
 * 題目生成與管理。
 *
 * 生成流程：
 *   1. 取得相關教材段落（只傳必要內容給 LLM）。
 *   2. 要求 LLM 以 JSON 回應。
 *   3. 驗證 schema、選項及答案。
 *   4. 驗證每題的教材來源依據；沒有依據的題目不會呈現。
 *   5. 若 LLM 不可用或輸出不合規，回報錯誤並可回退本地示範生成。
 */
import {
  CURRICULUM_LEVEL_LABELS,
  curriculumThemeText,
  questionGenerationRequestSchema,
  questionInputSchema,
  questionSchema,
  type GeneratedQuestionPreview,
  type LlmRequestType,
  type LlmUsage,
  type Question,
  type QuestionGenerationRequest,
  type QuestionInput,
  type QuestionOrigin,
  type QuestionReview,
  type QuestionReviewDecision,
  type QuestionReviewState,
  type QuestionReviewStatus,
  type QuestionStatus,
  type TeacherQuestionView,
} from "../../lib/types";
import { createHash } from "node:crypto";

import { nowIso, newId } from "../db/connection";
import { getServerConfig } from "../config";
import { resolveProvider } from "../llm";
import { LlmProviderError, type LlmProvider } from "../llm/provider";
import { validateLlmQuestions } from "../llm/validation";
import { categorizeLlmError, logLlmUsage } from "./llm-usage";
import {
  deleteQuestion,
  findAnyApprovedReview,
  findApprovedReview,
  getQuestion,
  insertQuestion,
  insertQuestionReview,
  listLatestReviews,
  listQuestionReviews,
  listQuestions,
  setQuestionStatus,
  updateQuestion,
} from "../repositories/questions";
import { expandSectionIds, getSection, getTopic, listSections } from "../repositories/topics";
import { normalizeForMatch, truncate } from "../materials/text-utils";
import { topicLearningFocusText } from "../seed/curriculum-focus";
import { buildMaterialUnits } from "./material-units";

export class QuestionServiceError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "QuestionServiceError";
    this.status = status;
  }
}

export interface GenerateOptions extends QuestionGenerationRequest {
  /** 是否允許在 LLM 失敗時回退本地示範生成 */
  allowMockFallback?: boolean;
  /**
   * 是否把生成的題目寫入題庫（預設 true）。
   * 學生練習時即時生成會設為 false：題目只存在於練習快照內，
   * 避免大量練習題目堆積在題庫，同時仍可作答、看成績及重做錯題。
   */
  persist?: boolean;
  /** 是否略過「與題庫現有題目重複」的檢查（練習時即時生成用） */
  allowBankDuplicates?: boolean;
  /**
   * LLM 用量記錄的請求類型（練習即時生成 = question-instant；教師／題庫生成 = question-bank）。
   * 預設為 question-bank。
   */
  requestType?: LlmRequestType;
}

export interface GenerationResult extends GeneratedQuestionPreview {
  /** 需要告知教師的訊息（例如已回退示範生成） */
  notice: string | null;
  /** 產生的題目是否可以直接給學生使用 */
  usable: boolean;
}

/**
 * 產生題目並寫入題庫（狀態為草稿，待教師查核後才發布）。
 */
export async function generateQuestions(options: GenerateOptions): Promise<GenerationResult> {
  const request = questionGenerationRequestSchema.parse(options);
  const topic = getTopic(request.topicId);
  if (!topic) throw new QuestionServiceError("找不到指定的課題", 404);

  const sectionIds = expandSectionIds(topic.id, request.sectionIds);
  if (sectionIds.length === 0) throw new QuestionServiceError("找不到指定的分節", 404);

  const units = buildMaterialUnits(topic.id, sectionIds);
  if (units.length === 0) {
    throw new QuestionServiceError(
      "此分節尚未匯入教材內容，無法生成有教材依據的題目。請先上載教材，或改用內建示範題庫。",
      409,
    );
  }

  // 同一課題其他分節的段落只會用於製作選擇題的錯誤選項
  const sectionBlockIds = new Set(units.map((unit) => unit.blockId));
  const distractorUnits = buildMaterialUnits(topic.id, []).filter(
    (unit) => !sectionBlockIds.has(unit.blockId),
  );

  if (distractorUnits.length === 0 && units.length < 6) {
    throw new QuestionServiceError(
      "此分節的教材內容太少，未能生成合乎要求的題目。請改選其他分節，或先在管理介面補充教材。",
      409,
    );
  }

  const sectionTitles = listSections(topic.id)
    .filter((section) => sectionIds.includes(section.id))
    .map((section) => section.title);

  // 讓模型掌握課程脈絡：年級（中一至中三）、教育局課程主題，以及該課題的學習重點
  const courseContext = {
    levelLabel: CURRICULUM_LEVEL_LABELS[topic.level] ?? "",
    themeText: topic.level === 0 ? "" : curriculumThemeText(topic.level),
    learningFocusText: topicLearningFocusText(topic.topicNumber),
  };

  const resolved = resolveProvider();
  const warnings: string[] = [];
  let questions: Question[] = [];
  let discardedReasons: string[] = [];
  let usedProvider = resolved.provider;

  const requestType: LlmRequestType = options.requestType ?? "question-bank";

  /** 記錄 LLM 用量（本地示範生成不使用外部 API，因此不記錄） */
  const logUsage = (input: {
    provider: LlmProvider;
    startedAt: number;
    success: boolean;
    usage: LlmUsage | null;
    errorType: string | null;
  }): void => {
    if (input.provider.name === "mock") return;
    logLlmUsage({
      requestType,
      provider: input.provider.name,
      model: getServerConfig().llm.model,
      topicId: topic.id,
      success: input.success,
      durationMs: Date.now() - input.startedAt,
      usage: input.usage,
      errorType: input.errorType,
    });
  };

  const generationInput = {
    topicTitle: topic.title,
    ...courseContext,
    sectionTitle: sectionTitles.join("、"),
    questionTypes: request.questionTypes,
    difficulty: request.difficulty,
    count: request.questionCount,
    materialUnits: units,
    distractorUnits,
  };

  const attempt = async (allowFallback: boolean): Promise<void> => {
    const startedAt = Date.now();
    try {
      const outcome = await resolved.provider.generateQuestions(generationInput);
      logUsage({
        provider: resolved.provider,
        startedAt,
        success: true,
        usage: outcome.usage,
        errorType: null,
      });

      const result = validateLlmQuestions(outcome.questions, {
        topicId: topic.id,
        sectionId: sectionIds[0],
        questionTypes: request.questionTypes,
        difficulty: request.difficulty,
        origin: resolved.provider.name === "mock" ? "material-mock" : "material-ai",
        sectionIds,
        units,
        now: nowIso(),
        idFor: () => newId("q"),
      });

      questions = result.accepted;
      discardedReasons = result.discardedReasons;
      if (resolved.notice) warnings.push(resolved.notice);
    } catch (error) {
      logUsage({
        provider: resolved.provider,
        startedAt,
        success: false,
        usage: null,
        errorType: categorizeLlmError(error),
      });

      if (!allowFallback) {
        throw error instanceof Error ? error : new Error(String(error));
      }
      const reason = error instanceof LlmProviderError ? error.message : String(error);
      warnings.push(`${reason}；已改用本地示範生成。`);

      const fallback = await resolveMockProvider();
      usedProvider = fallback;
      const outcome = await fallback.generateQuestions(generationInput);
      const result = validateLlmQuestions(outcome.questions, {
        topicId: topic.id,
        sectionId: sectionIds[0],
        questionTypes: request.questionTypes,
        difficulty: request.difficulty,
        origin: "material-mock",
        sectionIds,
        units,
        now: nowIso(),
        idFor: () => newId("q"),
      });
      questions = result.accepted;
      discardedReasons = result.discardedReasons;
    }
  };

  const allowFallback = options.allowMockFallback !== false && resolved.provider.name !== "mock";
  await attempt(allowFallback);

  const usable = questions.length > 0;
  if (!usable) {
    const reasons = discardedReasons.slice(0, 3).join("；");
    const mockHint =
      usedProvider.name === "mock"
        ? "本地示範生成只會產生答案唯一的題目（定義句、年份或引號詞語），因此部分以敘述為主的教材無法生成題目。可改用內建示範題庫、由教師手動建立題目，或設定真正的 LLM provider（見 README）。"
        : "可減少題目數量、改選其他題型或補充教材內容後重試。";
    throw new QuestionServiceError(
      `未能生成合乎要求的題目${reasons ? `（${reasons}）` : ""}。${mockHint}`,
      502,
    );
  }

  // 避免與題庫現有題目重複（同一課題內，題目文字相同者視為重複）
  // 練習時即時生成的題目（allowBankDuplicates）不受此限，否則學生重複練習時會被擋。
  const persist = options.persist !== false;
  let finalQuestions = questions;
  if (persist && options.allowBankDuplicates !== true) {
    const existing = listQuestions({ topicId: topic.id });
    const existingKeys = new Set(
      existing.map((question) => normalizeForMatch(question.question)),
    );
    finalQuestions = questions.filter((question) => {
      const key = normalizeForMatch(question.question);
      if (existingKeys.has(key)) {
        discardedReasons.push(`題目「${truncate(question.question, 24)}」與題庫現有題目重複，已略過`);
        return false;
      }
      existingKeys.add(key);
      return true;
    });

    if (finalQuestions.length === 0) {
      throw new QuestionServiceError(
        "生成結果與題庫現有題目重複，沒有新增題目。可改選其他分節、調整難度或題型後再試。",
        409,
      );
    }
  }

  const saved = persist ? finalQuestions.map((question) => insertQuestion(question)) : finalQuestions;

  return {
    provider: usedProvider.name,
    providerLabel: usedProvider.label,
    usedDemoFallback: usedProvider.name === "mock",
    discardedCount: discardedReasons.length,
    discardReasons: discardedReasons,
    questions: saved,
    notice: warnings.length > 0 ? warnings.join(" ") : null,
    usable,
  };
}

async function resolveMockProvider() {
  const { mockProvider } = await import("../llm/mock-provider");
  return mockProvider;
}

export interface QuestionListFilter {
  topicId: string;
  sectionId?: string;
  statuses?: QuestionStatus[];
  /** 題目來源（例如只看校內試卷，方便分批核對） */
  origins?: QuestionOrigin[];
}

export function listTopicQuestions(filter: QuestionListFilter): Question[] {
  return listQuestions({
    topicId: filter.topicId,
    sectionIds: filter.sectionId ? expandSectionIds(filter.topicId, [filter.sectionId]) : undefined,
    statuses: filter.statuses,
    origins: filter.origins,
  });
}

/**
 * 題目內容的指紋。
 *
 * 用來確認「覆核的就是這一版內容」：只涵蓋會影響學生作答的欄位
 * （分節、題型、題幹、選項、答案、可接受寫法、解釋、知識點、技能），
 * 不包含狀態、品質警告、建立時間等營運欄位——教師覆核後調整品質警告
 * 或停用／發布不應令覆核失效。
 */
export function questionFingerprint(question: Question): string {
  const payload = JSON.stringify({
    topicId: question.topicId,
    sectionId: question.sectionId,
    questionType: question.questionType,
    difficulty: question.difficulty,
    question: question.question,
    options: question.options,
    correctAnswer: question.correctAnswer,
    acceptedAnswers: question.acceptedAnswers,
    explanation: question.explanation,
    knowledgePoint: question.knowledgePoint,
    gradingPoints: question.gradingPoints,
    skill: question.skill,
  });
  return createHash("sha256").update(payload).digest("hex");
}

/** 這題目前版本對應的「已通過」覆核紀錄（沒有則為 null） */
function approvedReviewFor(question: Question): QuestionReview | null {
  return findApprovedReview(question.id, question.revision, questionFingerprint(question));
}

/**
 * 覆核狀態（由題目狀態、版本及覆核紀錄推導；見 questionReviewStateSchema）。
 *
 * 重點：`sourceVerified`（教材依據成立）**不會**影響這個狀態——自動驗證不等於人工覆核。
 */
export function reviewStateFor(question: Question): QuestionReviewState {
  if (question.status === "disabled") return "retired";
  const approved = approvedReviewFor(question);
  const latest = listQuestionReviews(question.id, 1)[0] ?? null;
  const anyApproved = findAnyApprovedReview(question.id);

  if (approved) {
    // 同一版曾被覆核，但教師之後把它下架（例如暫時隱藏）→ 狀態仍然清楚
    return question.status === "published" ? "approved" : "approved-unpublished";
  }
  if (anyApproved) {
    // 曾有覆核，但版本或內容已改 → 覆核失效，必須重新覆核
    return "stale-approval";
  }
  if (question.status === "published") {
    // 從未經人工覆核（例如示範題庫自動發布）→ 如實標示
    return "published-unreviewed";
  }
  if (latest && latest.revision === question.revision) {
    return latest.decision === "rejected" ? "rejected" : "returned";
  }
  return "pending-review";
}

/** 教師端題目檢視資料（題目 + 覆核狀態 + 最新／已通過的覆核紀錄） */
export function teacherQuestionView(question: Question): TeacherQuestionView {
  const reviews = listQuestionReviews(question.id, 1);
  return {
    question,
    reviewState: reviewStateFor(question),
    latestReview: reviews[0] ?? null,
    approvedReview: approvedReviewFor(question),
  };
}

export function teacherQuestionViews(questions: Question[]): TeacherQuestionView[] {
  const latest = listLatestReviews(questions.map((question) => question.id));
  return questions.map((question) => ({
    question,
    reviewState: reviewStateFor(question),
    latestReview: latest.get(question.id) ?? null,
    approvedReview: approvedReviewFor(question),
  }));
}

/** 題目清單用的覆核狀態（不重複題目內容） */
export function questionReviewStatuses(questions: Question[]): QuestionReviewStatus[] {
  return teacherQuestionViews(questions).map((view) => ({
    questionId: view.question.id,
    reviewState: view.reviewState,
    latestReview: view.latestReview,
    approvedReview: view.approvedReview,
  }));
}

export interface ReviewActor {
  /** 覆核者電郵；示範模式（未登入）時為說明字串，不會假裝有帳戶 */
  email: string;
  role: string;
}

/**
 * 記錄一次人工覆核決定。
 *
 * 規則：
 *   1. 只有教師或管理員可以呼叫（授權由 route handler 的守衛負責；此處只負責業務規則）。
 *   2. 覆核綁定「題目目前的版本 + 內容指紋」，因此覆核後再修改內容即自動失效。
 *   3. `rejected`／`returned` 必須提供原因。
 *   4. 重複提交相同決定不會產生重複紀錄（資料庫唯一索引），回傳 `created: false`。
 *   5. 通過覆核即發布（`status = published`）；退回或不可用則回到草稿（不會顯示給學生）。
 */
export function recordQuestionReview(input: {
  questionId: string;
  decision: QuestionReviewDecision;
  reason?: string | null;
  actor: ReviewActor;
}): { view: TeacherQuestionView; created: boolean } {
  const existing = getQuestion(input.questionId);
  if (!existing) throw new QuestionServiceError("找不到指定的題目", 404);

  const rawReason = input.reason?.trim() ?? "";
  if (input.decision !== "approved" && rawReason.length === 0) {
    throw new QuestionServiceError("退回或標示不可用時必須填寫原因，讓其他人知道要處理甚麼", 400);
  }

  const { review, created } = insertQuestionReview({
    id: newId("qrev"),
    questionId: existing.id,
    revision: existing.revision,
    decision: input.decision,
    reason: rawReason.length > 0 ? rawReason : null,
    reviewerEmail: input.actor.email,
    reviewerRole: input.actor.role,
    questionFingerprint: questionFingerprint(existing),
    createdAt: nowIso(),
  });
  void review;

  // 通過覆核 → 可發布；退回或不可用 → 回到草稿（立即不再對學生顯示）
  const nextStatus: QuestionStatus = input.decision === "approved" ? "published" : "draft";
  const updated = setQuestionStatus(existing.id, nextStatus);
  if (!updated) throw new QuestionServiceError("題目狀態更新失敗", 500);

  return { view: teacherQuestionView(updated), created };
}

export function changeQuestionStatus(questionId: string, status: QuestionStatus): TeacherQuestionView {
  const existing = getQuestion(questionId);
  if (!existing) throw new QuestionServiceError("找不到指定的題目", 404);

  // 發布關卡：學生可見的題目必須有對應**目前版本**的人工覆核紀錄。
  // 教援（自動）驗證或舊資料都不會令題目通過這個關卡。
  if (status === "published") {
    const approved = approvedReviewFor(existing);
    if (!approved) {
      const state = reviewStateFor(existing);
      const guidance =
        state === "stale-approval"
          ? "此題在覆核後已被修改，請重新覆核後再發布。"
          : "此題尚未有教師覆核紀錄，請先覆核（確認史實、用語、選項、答案及解釋）後再發布。";
      throw new QuestionServiceError(`無法發布：${guidance}`, 409);
    }
  }

  const updated = setQuestionStatus(questionId, status);
  if (!updated) throw new QuestionServiceError("題目狀態更新失敗", 500);
  return teacherQuestionView(updated);
}

/**
 * 自動發布由系統生成的題目（**未經人工覆核**）。
 *
 * 只用於 `DEMO_AUTO_PUBLISH_QUESTIONS=true` 的示範／首次建立流程：沒有教師在場時
 * 仍要能試用平台，因此這些題目會直接發布，但它們**不會**留下任何覆核紀錄，
 * 教師端及文件一律標示為「已發布（未經人工覆核）」。
 *
 * 教師手動發布必須走 `changeQuestionStatus`，那裡會要求對應目前版本的人工覆核紀錄。
 */
export function publishAutoGeneratedQuestion(questionId: string): Question {
  const existing = getQuestion(questionId);
  if (!existing) throw new QuestionServiceError("找不到指定的題目", 404);
  const updated = setQuestionStatus(questionId, "published");
  if (!updated) throw new QuestionServiceError("題目狀態更新失敗", 500);
  return updated;
}

/**
 * 修改題目內容。
 *
 * 版本會遞增（見 repositories/questions.ts），令舊的覆核紀錄自動失效；
 * 若題目原本已發布，會一併回到草稿——**絕不讓學生看到覆核後已改變的內容**。
 */
/**
 * 修改題目內容（教師手動編輯的路徑）。
 *
 * 版本會遞增（見 repositories/questions.ts），令舊的覆核紀錄自動失效；
 * 若題目原本已發布，會一併回到草稿——**絕不讓學生看到覆核後已改變的內容**。
 * 保留原本的來源類型及建立時間。
 */
export function updateManualQuestion(
  questionId: string,
  input: QuestionInput,
): TeacherQuestionView {
  const existing = getQuestion(questionId);
  if (!existing) throw new QuestionServiceError("找不到指定的題目", 404);
  const parsed = questionInputSchema.parse(input);
  const wasPublished = existing.status === "published";

  const updated = updateQuestion(questionId, {
    ...existing,
    ...parsed,
    id: questionId,
    origin: existing.origin,
    createdAt: existing.createdAt,
    sourceVerified: parsed.sourceBlockIds.length > 0 || existing.sourceBlockIds.length === 0,
    // 修改已發布的題目會即時下架，必須重新覆核後才可再次發布
    status: wasPublished ? "draft" : parsed.status,
  });
  return teacherQuestionView(updated);
}

export function removeQuestion(questionId: string): void {
  const existing = getQuestion(questionId);
  if (!existing) throw new QuestionServiceError("找不到指定的題目", 404);
  deleteQuestion(questionId);
}

/** 教師手動建立題目（origin = manual） */
export function createManualQuestion(input: QuestionInput, questionId?: string): Question {
  const parsed = questionInputSchema.parse(input);
  const question: Question = questionSchema.parse({
    ...parsed,
    id: questionId ?? newId("q"),
    sourceBlockIds: parsed.sourceBlockIds,
    sourceVerified: parsed.sourceBlockIds.length > 0,
    createdAt: nowIso(),
  });
  return insertQuestion(question);
}

/** 檢查題目的教材依據是否仍然有效（教材被重新匯入後可能失效） */
export function questionSectionTitle(questionId: string): string | null {
  const question = getQuestion(questionId);
  if (!question) return null;
  return getSection(question.sectionId)?.title ?? null;
}
