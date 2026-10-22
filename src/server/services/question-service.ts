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
  SENIOR_SECONDARY_LEVEL,
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
import { questionFingerprint as fingerprint } from "../quality/question-fingerprint";

import { nowIso, newId } from "../db/connection";
import { getServerConfig, isProductionRuntime } from "../config";
import { resolveProvider } from "../llm";
import { analyseMaterial } from "../llm/material-analysis";
import { LlmProviderError, type LlmProvider } from "../llm/provider";
import type { QuestionGenerationInput } from "../llm/provider";
import { checkQuestionQuality, isMachineRevisableIssue, qualityOutcome } from "../llm/question-quality";
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
  recordQuestionAutoValidation,
  setQuestionStatusIfRevision,
  setTeacherConfirmationRequired,
  setQualityWarnings,
  updateQuestion,
} from "../repositories/questions";
import { getBlocksByIds } from "../repositories/materials";
import { countQuestionRevisionDrift } from "../repositories/practice";
import { expandSectionIds, getSection, getTopic, listSections } from "../repositories/topics";
import { normalizeForMatch, truncate } from "../materials/text-utils";
import { learningFocusTextForTopic } from "../seed/curriculum-focus";
import { buildMaterialUnits } from "./material-units";
import { studentExcerptVisibility } from "./source-visibility";
import { checkQuestionServable } from "./question-servability";
import { AUTO_QUARANTINE_PREFIX } from "./question-repair";

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
  /**
   * 教材來源的取用範圍。
   *
   *   - `staff`（預設）：教師／管理員／題庫腳本使用，可取用所有教材段落。
   *   - `student`：學生自行觸發的即時生成，**只**取用已確認可向學生發布且非教師專用的
   *     段落（fail-closed）。沒有可用段落時會回 409 並說明原因，而不是改用未確認的內容。
   *
   * 學生練習路徑必須傳 `student`，否則「教材版權閘門」會被 AI 出題繞過。
   */
  audience?: "student" | "staff";
  /**
   * 已用過的標準答案（例如同一份練習已出過的題目）。
   *
   * 只用於「補題」：提示模型改出其他史實，避免把同一題改寫後再交一次。
   * 這不是強制條件——最終仍由 `question-dedupe.ts` 的共用判定把重複題目擋下。
   */
  avoidAnswers?: string[];
  /**
   * 額外多生成的題數（預設 0）。
   *
   * 真實模型偶爾寫出違反題幹規則的題目（答案仍留在題幹、題幹過長），令整次生成
   * 沒有可用題目。練習路徑會多要求 1–2 題作備用：通過檢查的題目只會使用所需數量，
   * 其餘不會派給學生（呼叫端會截取），但足以令「一題不合格」不再等於「整節沒有題目」。
   * 成本只增加同一請求的輸出 token，不會增加請求次數。
   */
  overGenerate?: number;
}

export interface GenerationResult extends GeneratedQuestionPreview {
  /** 需要告知教師的訊息（例如已回退示範生成） */
  notice: string | null;
  /** 產生的題目是否可以直接給學生使用 */
  usable: boolean;
}

/**
 * 產生題目並寫入題庫。
 *
 * Sprint 7.8 起：通過驗證的題目會記錄自動品質驗證並即時發布供學生自學
 * （`AUTO_PUBLISH_VALIDATED_QUESTIONS`，預設開啟），毋須教師逐題預先批准；
 * 未通過驗證的題目維持草稿，由教師覆核、修正或重新驗證。
 */
export async function generateQuestions(options: GenerateOptions): Promise<GenerationResult> {
  const request = questionGenerationRequestSchema.parse(options);
  const topic = getTopic(request.topicId);
  if (!topic) throw new QuestionServiceError("找不到指定的課題", 404);

  const sectionIds = expandSectionIds(topic.id, request.sectionIds);
  if (sectionIds.length === 0) throw new QuestionServiceError("找不到指定的分節", 404);

  const audience = options.audience ?? "staff";
  const units = buildMaterialUnits(topic.id, sectionIds, { audience });
  if (units.length === 0) {
    throw new QuestionServiceError(
      audience === "student"
        ? "這個分節的教材尚未開放學生使用，因此未能即時生成題目。平台不會在未確認版權的情況下把教材內容（或其衍生的題目）提供給學生；請改用題庫題目，或聯絡歷史科教師／管理員確認教材。"
        : "此分節尚未匯入教材內容，無法生成有教材依據的題目。請先上載教材，或改用內建示範題庫。",
      409,
    );
  }

  // 同一課題其他分節的段落只會用於製作選擇題的錯誤選項
  const sectionBlockIds = new Set(units.map((unit) => unit.blockId));
  const distractorUnits = buildMaterialUnits(topic.id, [], { audience }).filter(
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

  // 讓模型掌握課程脈絡：階段（初中／高中）、課程主題，以及該課題的學習重點
  const courseContext = {
    stage: topic.level === SENIOR_SECONDARY_LEVEL ? ("senior" as const) : ("junior" as const),
    levelLabel: CURRICULUM_LEVEL_LABELS[topic.level] ?? "",
    themeText: curriculumThemeText(topic.level, topic.curriculumTheme),
    learningFocusText: learningFocusTextForTopic(topic),
  };

  const resolved = resolveProvider();
  const warnings: string[] = [];
  let questions: Question[] = [];
  let discardedReasons: string[] = [];
  let usedProvider = resolved.provider;

  // 教材的結構化語意分析（Sprint 8.5）：先整理教材實際交代的歷史內容
  // （關鍵詞語、時序、因果、轉變、比較、意義，以及教材**沒有**交代的面向），
  // 再把同一份分析同時交給提示詞與品質閘門，令模型與閘門看到同一份材料。
  const analysis = analyseMaterial({
    units,
    topicTitle: topic.title,
    sectionTitle: sectionTitles.join("、"),
    ...courseContext,
  });

  const requestType: LlmRequestType = options.requestType ?? "question-bank";

  /** 向模型要求的題數：練習路徑會多要求 1–2 題作備用（見 GenerateOptions.overGenerate） */
  const requestedCount = Math.min(
    30,
    request.questionCount + Math.max(0, options.overGenerate ?? 0),
  );

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
    count: requestedCount,
    materialUnits: units,
    distractorUnits,
    avoidAnswers: options.avoidAnswers ?? [],
    // 教材的結構化語意分析（Sprint 8.5）：模型先看到教材的歷史脈絡（關鍵詞語、時序、
    // 因果、轉變、比較、意義，以及教材沒有交代的面向），才設計題目。
    materialAnalysis: analysis,
  } satisfies QuestionGenerationInput;

  const validationContext = {
    topicId: topic.id,
    sectionId: sectionIds[0],
    questionTypes: request.questionTypes,
    difficulty: request.difficulty,
    origin: resolved.provider.name === "mock" ? ("material-mock" as const) : ("material-ai" as const),
    sectionIds,
    units,
    analysis,
    now: nowIso(),
    idFor: () => newId("q"),
  };

  /** 每輪驗證的品質判定（用於決定是否需要有限次重寫） */
  let qualityOutcomes: Awaited<ReturnType<typeof validateLlmQuestions>>["qualityOutcomes"] = [];

  const attempt = async (allowFallback: boolean, revisionNotes: string[] = []): Promise<void> => {
    const startedAt = Date.now();
    const run = async (provider: LlmProvider, origin: QuestionOrigin): Promise<void> => {
      const outcome = await provider.generateQuestions({
        ...generationInput,
        ...(revisionNotes.length > 0 ? { revisionNotes } : {}),
      });
      logUsage({
        provider,
        startedAt,
        success: true,
        usage: outcome.usage,
        errorType: null,
      });
      const result = validateLlmQuestions(outcome.questions, { ...validationContext, origin });
      questions = result.accepted;
      discardedReasons = result.discardedReasons;
      qualityOutcomes = result.qualityOutcomes;
    };

    try {
      await run(resolved.provider, resolved.provider.name === "mock" ? "material-mock" : "material-ai");
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
      await run(fallback, "material-mock");
    }
  };

  const allowFallback = options.allowMockFallback !== false && resolved.provider.name !== "mock";
  await attempt(allowFallback);

  // 有限次重寫（Sprint 8.5）：只在出現「機器可自行修正」的教學品質問題時再問一次。
  // 成本控制：合共最多 2 次 provider 呼叫；本地示範生成是確定性的，不重試。
  // 合併方式：保留第一輪沒有問題的題目，只以第二輪補上（同一題幹不重複）。
  const revisableIds = new Set(
    qualityOutcomes.filter((entry) => entry.machineRevisable).map((entry) => entry.questionId),
  );
  if (revisableIds.size > 0 && resolved.provider.name !== "mock") {
    const cleanFromFirstRound = questions.filter((question) => !revisableIds.has(question.id));
    const notes = [
      ...new Set(
        qualityOutcomes
          .filter((entry) => entry.machineRevisable)
          .flatMap((entry) => entry.notes),
      ),
    ].slice(0, 5);
    warnings.push(
      `有 ${revisableIds.size} 條題目的教學品質需要改善（例如解釋只是抄錄教材原文），已要求重寫一次。`,
    );
    try {
      await attempt(false, notes);
      const accepted = [...cleanFromFirstRound];
      const seenStems = new Set(accepted.map((question) => normalizeForMatch(question.question)));
      for (const question of questions) {
        const key = normalizeForMatch(question.question);
        if (seenStems.has(key)) continue;
        seenStems.add(key);
        accepted.push(question);
      }
      questions = accepted;
      // 重寫後仍然有問題的題目：交回教師（品質警告已寫入題目，自動發布已被暫緩）
      const remaining = qualityOutcomes.filter((entry) => entry.machineRevisable).length;
      if (remaining > 0) {
        warnings.push(`重寫後仍有 ${remaining} 條題目未達教學品質要求，已保留為草稿交由教師處理。`);
      }
    } catch (error) {
      // 重寫只是**額外**的一次嘗試：若 provider 在第二次呼叫時出錯，第一輪已通過
      // 結構與教材依據檢查的題目仍然可用（它們已標記為需要教師確認），
      // 不應因為這個可選步驟失敗而令教師失去整批題目。
      warnings.push(
        `重寫時 provider 再次回報錯誤（${error instanceof Error ? error.message : String(error)}），` +
          "已保留第一輪的題目，並交由教師確認。",
      );
    }
  }

  // 完全沒有可用題目時再試一次（2026-10-18 由模擬學生使用發現）：真實模型偶爾
  // 每一題都違反題幹規則（答案在題幹重複出現、題幹超過長度上限），令整次生成失敗、
  // 學生拿不到任何題目。這裡把上一輪的丟棄原因當作修訂指示重試**一次**，
  // 只在「本來會完全失敗」時發生，因此成本有上限（每次生成最多 3 次 provider 呼叫）。
  //
  // 2026-10-20 修正：模型有時**一個題目都沒有回傳**（空回應或全部無法解析），
  // 此時 discardedReasons 是空的，舊條件（`discardedReasons.length > 0`）不會重試，
  // 整節直接當作失敗——模擬學生使用時實際出現於「課題5 科學革命」一節。
  // 現在只要沒有可用題目就重試一次；沒有丟棄原因時提示模型只輸出合格式的題目。
  if (questions.length === 0 && resolved.provider.name !== "mock") {
    const notes = [...new Set(discardedReasons)].slice(0, 5);
    warnings.push(
      notes.length > 0
        ? "第一輪生成的題目全部未達要求，已按丟棄原因重試一次。"
        : "第一輪生成沒有回傳可用題目，已重試一次。",
    );
    try {
      await attempt(
        false,
        notes.length > 0
          ? notes
          : ["上一次回應沒有任何可用題目，請只輸出符合指定格式的題目。"],
      );
    } catch (error) {
      warnings.push(
        `重試時 provider 回報錯誤（${error instanceof Error ? error.message : String(error)}），本次沒有可用題目。`,
      );
    }
  }

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

  const saved = persist
    ? finalQuestions.map((question) => {
        const inserted = insertQuestion(question);
        // 通過驗證的題目立即記錄自動品質驗證（並在設定允許時發布），
        // 學生因此毋須等待教師逐題預先批准即可練習（Sprint 7.8）。
        return recordAutoValidationAndPublish(inserted.id);
      })
    : finalQuestions;

  // Sprint 7.9：未確定項目（例如題目要求的思考面向未見於教材）不會自動發布，
  // 只保留為草稿等待教師確認；其他題目不受影響。
  const heldCount = saved.filter((question) => question.teacherConfirmationRequired).length;
  if (heldCount > 0) {
    warnings.push(
      `有 ${heldCount} 條題目的品質檢查有未確定項目（例如題目要求的思考面向未見於教材），` +
        "已保留為草稿並交教師確認，不會自動發布；其他題目不受影響。",
    );
  }

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
 * 題目內容的指紋（實作移至 `../quality/question-fingerprint` 的純函式模組，
 * 讓 audit／export CLI 不需要載入 repositories）。
 */
export function questionFingerprint(question: Question): string {
  return fingerprint(question);
}

/** 這題目前版本對應的「已通過」覆核紀錄（沒有則為 null） */
function approvedReviewFor(question: Question): QuestionReview | null {
  return findApprovedReview(question.id, question.revision, questionFingerprint(question));
}

/**
 * 這題目前版本是否已通過**自動品質驗證**（Sprint 7.8）。
 *
 * 與人工覆核紀錄一樣綁定版本及內容指紋：內容一改（`revision` 遞增或指紋不同）即失效。
 * 自動驗證**不是**人工覆核，兩者分開記錄，教師端因此可以分辨。
 */
export function autoValidationIsCurrent(question: Question): boolean {
  return (
    question.autoValidatedAt !== null &&
    question.autoValidatedRevision === question.revision &&
    question.autoValidatedFingerprint === questionFingerprint(question)
  );
}

/**
 * 較嚴格的「學生可否練習」判定：狀態、暫緩標記**及**目前版本的驗證紀錄全部符合。
 *
 * **這不是讀取路徑的實際過濾條件**（Sprint 8.8 查明）：學生練習由 practice-service 以
 * `status = published` 及 `teacher_confirmation_required = 0` 取題，發布關卡只在**發布動作**
 * 時檢查驗證紀錄，因此歷史上已發布而沒有任何驗證紀錄的題目仍然可見（本機 788 條即屬此類）。
 * 本函式用在需要「最嚴格」語意的地方（測試及稽核），把兩者統一是產品決定，不可在此靜默更改。
 */
export function isStudentPracticeEligible(question: Question): boolean {
  return (
    question.status === "published" &&
    // 未確定項目尚未由教師確認前，任何自動驗證紀錄都不足以讓學生看到這一題
    !question.teacherConfirmationRequired &&
    (approvedReviewFor(question) !== null || autoValidationIsCurrent(question))
  );
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

/** 教師端題目檢視資料（題目 + 覆核狀態 + 最新／已通過的覆核紀錄 + 舊版作答提示） */
export function teacherQuestionView(question: Question): TeacherQuestionView {
  const reviews = listQuestionReviews(question.id, 1);
  const drift = countQuestionRevisionDrift(question.id, question.revision);
  return {
    question,
    reviewState: reviewStateFor(question),
    latestReview: reviews[0] ?? null,
    approvedReview: approvedReviewFor(question),
    staleAttempts: drift.staleAttempts,
    totalAttempts: drift.totalAttempts,
  };
}

export function teacherQuestionViews(questions: Question[]): TeacherQuestionView[] {
  const latest = listLatestReviews(questions.map((question) => question.id));
  return questions.map((question) => {
    const drift = countQuestionRevisionDrift(question.id, question.revision);
    return {
      question,
      reviewState: reviewStateFor(question),
      latestReview: latest.get(question.id) ?? null,
      approvedReview: approvedReviewFor(question),
      staleAttempts: drift.staleAttempts,
      totalAttempts: drift.totalAttempts,
    };
  });
}

/** 題目清單用的覆核狀態（不重複題目內容） */
export function questionReviewStatuses(questions: Question[]): QuestionReviewStatus[] {
  return teacherQuestionViews(questions).map((view) => {
    // 教師端要看到「學生其實看不到節錄」及原因，否則會誤以為已顯示教材依據。
    // 判定與學生端完全共用（source-visibility.ts），不會出現兩套標準。
    const visibility = studentExcerptVisibility(view.question);
    const servability = checkQuestionServable(view.question);
    return {
      questionId: view.question.id,
      reviewState: view.reviewState,
      latestReview: view.latestReview,
      approvedReview: view.approvedReview,
      sourceExcerptHiddenFromStudents: !visibility.visible,
      sourceExcerptHiddenReason: visibility.reason,
      studentServable: servability.ok,
      studentServableReason: servability.reason,
      staleAttempts: view.staleAttempts,
      autoValidated: autoValidationIsCurrent(view.question),
    };
  });
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
 *
 * Sprint 8.6：**覆核者身分不可留空**。身分只可由伺服器端工作階段提供；空白的電郵或角色
 * 會被拒絕（400），不會默默寫入一筆沒有覆核者的「已覆核」紀錄。
 *
 * Sprint 8.7：**`expectedRevision` 是必填的樂觀鎖**。教師在介面上看到第 N 版並按下覆核，
 * 若在提交之前題目已被其他人修改（版本變成 N+1），伺服器必須拒絕（409），而不是把
 * 覆核記到教師**沒有看過**的新版本上。這填補了「同一頁面停留太久或另一位教師同時修改」
 * 的縫隙。
 */
export function recordQuestionReview(input: {
  questionId: string;
  decision: QuestionReviewDecision;
  reason?: string | null;
  /** 教師實際審閱的版本（必須與資料庫目前版本一致） */
  expectedRevision: number;
  actor: ReviewActor;
  /** 同一版本、同一決定但理由不同時仍要留下新紀錄（例如兩次不同的裁決理由） */
  forceNew?: boolean;
}): { view: TeacherQuestionView; created: boolean } {
  const existing = getQuestion(input.questionId);
  if (!existing) throw new QuestionServiceError("找不到指定的題目", 404);

  const reviewerEmail = input.actor.email.trim();
  const reviewerRole = input.actor.role.trim();
  if (reviewerEmail.length === 0 || reviewerRole.length === 0) {
    throw new QuestionServiceError(
      "缺少覆核者身分，無法記錄覆核。覆核者只可由伺服器端工作階段提供。",
      400,
    );
  }

  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision <= 0) {
    throw new QuestionServiceError("缺少要覆核的題目版本（expectedRevision），無法記錄覆核。", 400);
  }
  if (input.expectedRevision !== existing.revision) {
    throw new QuestionServiceError(
      `題目已被修改（目前第 ${existing.revision} 版，你正在覆核的是第 ${input.expectedRevision} 版），` +
        "請重新載入題目並確認最新內容後再覆核。這次沒有記錄任何覆核決定。",
      409,
    );
  }

  const rawReason = input.reason?.trim() ?? "";
  if (input.decision !== "approved" && rawReason.length === 0) {
    throw new QuestionServiceError("退回或標示不可用時必須填寫原因，讓其他人知道要處理甚麼", 400);
  }

  // 核准不能繞過可作答性：結構上不可作答的題目（例如選擇題選項以 i、ii、iii
  // 指涉題幹，但題幹沒有相應標示）即使有人按下「通過」，也不得因此發布給學生。
  // 教師必須先修正內容（版本遞增）並重新檢查，或退回／保留隔離。
  if (input.decision === "approved") {
    const servability = checkQuestionServable(existing);
    if (!servability.ok) {
      throw new QuestionServiceError(
        `無法核准：題目結構上不可作答（${servability.reason}）。請先修正題目內容並重新檢查，` +
          "或退回草稿／保留隔離。這次沒有記錄任何覆核決定。",
        409,
      );
    }
  }

  const { review, created } = insertQuestionReview({
    id: newId("qrev"),
    questionId: existing.id,
    revision: existing.revision,
    decision: input.decision,
    reason: rawReason.length > 0 ? rawReason : null,
    reviewerEmail,
    reviewerRole,
    questionFingerprint: questionFingerprint(existing),
    createdAt: nowIso(),
    // 題目帶「待教師確認」時，這次決定是在疑問出現之後作出的，必須留下新紀錄，
    // 即使同一版先前已有相同決定的紀錄（例如批次授權核准）。
    forceNew: existing.teacherConfirmationRequired || input.forceNew === true,
  });
  void review;

  // 通過覆核 → 可發布；退回或不可用 → 回到草稿（立即不再對學生顯示）
  const nextStatus: QuestionStatus = input.decision === "approved" ? "published" : "draft";
  const published = setQuestionStatusIfRevision(existing.id, nextStatus, existing.revision);
  if (!published) {
    throw new QuestionServiceError(
      `題目在覆核期間已被修改（目前不是第 ${existing.revision} 版），這次覆核沒有套用到新版本。請重新載入題目後再覆核。`,
      409,
    );
  }

  // 教師明確通過覆核＝未確定的品質疑問已由人解決，清除自動發布暫緩標記
  // （Sprint 7.9：只有人工確認或重新驗證通過可以清除，警告本身不能）。
  const updated =
    input.decision === "approved" && published.teacherConfirmationRequired
      ? (setTeacherConfirmationRequired(published.id, false) ?? published)
      : published;

  // 隔離警告描述的是「暫緩派發、待教師確認」的狀態；教師已核准即代表該狀態結束，
  // 移除警告（不改版本，否則剛寫入的覆核會立即失效）。其他警告保留。
  if (input.decision === "approved") {
    const remaining = updated.qualityWarnings.filter(
      (warning) => !warning.startsWith(AUTO_QUARANTINE_PREFIX),
    );
    if (remaining.length !== updated.qualityWarnings.length) {
      const cleaned = setQualityWarnings(updated.id, remaining) ?? updated;
      return { view: teacherQuestionView(cleaned), created };
    }
  }

  return { view: teacherQuestionView(updated), created };
}

export function changeQuestionStatus(questionId: string, status: QuestionStatus): TeacherQuestionView {
  const existing = getQuestion(questionId);
  if (!existing) throw new QuestionServiceError("找不到指定的題目", 404);

  // 發布關卡（Sprint 7.8）：學生可見的題目必須有對應**目前版本**的
  //   - 人工覆核紀錄（教師確認），或
  //   - 自動品質驗證紀錄（機器檢查通過，毋須等待教師預先批准）。
  // 兩者都沒有時不可發布；舊資料或教材依據自動核對（sourceVerified）都不算。
  if (status === "published") {
    // 「待教師確認」代表有**較後出現**的疑問（例如自動修復改變了被考核的答案，或
    // 匯入時的正規化改變了考核重點）。即使同一版仍留有較早的覆核紀錄，也不可以只
    // 切換狀態就發布：必須由教師重新覆核（`recordQuestionReview` 的 approved 會清除
    // 標記），令決定在疑問出現之後作出。
    if (existing.teacherConfirmationRequired) {
      throw new QuestionServiceError(
        "無法發布：此題的品質檢查有未確定項目（待教師確認）。例如輔助修復可能改變了被考核的答案；請由教師在題目管理重新覆核並核准後再發布。",
        409,
      );
    }
    // Sprint 11：結構上不可作答的題目不可發布。派發層本來就會攔下，但發布狀態本身
    // 也是錯誤訊號（教師與報告會以為題目可用），因此這裡一併擋住。
    const servability = checkQuestionServable(existing);
    if (!servability.ok) {
      throw new QuestionServiceError(
        `無法發布：題目結構上不可作答（${servability.reason}）。請先修正內容，或保持草稿／隔離狀態。`,
        409,
      );
    }
    const approved = approvedReviewFor(existing);
    // Sprint 7.9：閘門判定「未確定」的題目不可經自動驗證發布——警告（或自動驗證紀錄）
    // 不得覆蓋未解決的依據問題。教師人工覆核後發布則屬已解決疑問的正式決定。
    if (!approved && !autoValidationIsCurrent(existing)) {
      const state = reviewStateFor(existing);
      const guidance =
        state === "stale-approval"
          ? "此題在覆核後已被修改，請重新覆核（或重新執行自動品質驗證）後再發布。"
          : "此題尚未有教師覆核紀錄，亦未通過自動品質驗證，請先重新執行自動品質驗證，或由教師覆核後再發布。";
      throw new QuestionServiceError(`無法發布：${guidance}`, 409);
    }
  }

  const updated = setQuestionStatusIfRevision(questionId, status, existing.revision);
  if (!updated) {
    throw new QuestionServiceError(
      "題目在狀態更新期間已被修改，請重新載入後再試（這次沒有更改任何狀態）。",
      409,
    );
  }
  return teacherQuestionView(updated);
}

/**
 * 自動發布由系統生成的題目。
 *
 * 兩條路徑（Sprint 7.8）：
 *   1. **通過自動品質驗證**（`AUTO_PUBLISH_VALIDATED_QUESTIONS`，預設開啟）：題目在
 *      生成階段已通過 schema、教材依據及 question-quality.ts 的品質閘門，因此可以在
 *      **任何環境**（包括正式環境）立即供學生自學——學生自學不應等待教師逐題預先批准。
 *      這條路徑只寫入自動驗證紀錄，**不會**留下任何人工覆核紀錄。
 *   2. 示範模式（`DEMO_AUTO_PUBLISH_QUESTIONS=true`，只限非正式環境）：沒有教師在場時
 *      仍要能試用平台，未經任何驗證的示範題目亦可發布，同樣不會偽造覆核紀錄。
 *
 * 兩者都不成立時 fail-closed：題目留在草稿，由教師處理（覆核、修正或重新驗證）。
 * 教師手動發布走 `changeQuestionStatus`，那裡同樣接受「人工覆核」或「自動驗證」任一紀錄。
 */
export function publishAutoGeneratedQuestion(questionId: string): Question {
  const existing = getQuestion(questionId);
  if (!existing) throw new QuestionServiceError("找不到指定的題目", 404);

  const validated =
    getServerConfig().autoPublishValidatedQuestions &&
    autoValidationIsCurrent(existing) &&
    !existing.teacherConfirmationRequired;
  const demoPublished =
    !existing.teacherConfirmationRequired &&
    !isProductionRuntime() &&
    getServerConfig().autoPublishMockQuestions;

  if (!validated && !demoPublished) {
    throw new QuestionServiceError(
      existing.teacherConfirmationRequired
        ? "已拒絕自動發布：品質檢查有未確定項目，須由教師核對內容後手動發布。"
        : autoValidationIsCurrent(existing)
        ? "已拒絕自動發布：自動發布已關閉（AUTO_PUBLISH_VALIDATED_QUESTIONS），請由教師在「題目管理」發布。"
        : "已拒絕自動發布：題目未通過自動品質驗證，且示範自動發布不適用（DEMO_AUTO_PUBLISH_QUESTIONS／正式環境），請由教師核對後發布。",
      409,
    );
  }

  const updated = setQuestionStatusIfRevision(questionId, "published", existing.revision);
  if (!updated) {
    throw new QuestionServiceError(
      "題目在自動發布期間已被修改，這次沒有更改發布狀態；請重新檢查後再發布。",
      409,
    );
  }
  return updated;
}

/**
 * 擁有者授權的批次發布（`scripts/publish-draft-questions.ts`）可用的候選題目。
 *
 * 這個腳本刻意繞過「逐題人工覆核」的關卡（見腳本說明），但**不可**繞過「未確定
 * （uncertain）項目須由教師確認」的關卡：`teacher_confirmation_required` 代表品質閘門
 * 無法確認題目的答案依據，自動發布已被暫緩，批次發布不能代替教師確認
 * （Sprint 7.9，見 migrations 0020 及 `changeQuestionStatus`）。
 *
 * `held` 的題目必須由教師在「題目管理」核對後逐題發布（人工覆核或重新執行自動品質驗證）。
 */
export function listOwnerPublicationCandidates(
  filter: { origins?: QuestionOrigin[]; topicId?: string } = {},
): {
  publishable: Question[];
  held: Question[];
} {
  const drafts = listQuestions({
    statuses: ["draft"],
    ...(filter.origins && filter.origins.length > 0 ? { origins: filter.origins } : {}),
    ...(filter.topicId ? { topicId: filter.topicId } : {}),
  });
  return {
    publishable: drafts.filter(
      (question) => !question.teacherConfirmationRequired && checkQuestionServable(question).ok,
    ),
    // held = 待教師確認 **或** 結構上不可作答（Sprint 12：批次發布不可繞過可作答性）
    held: drafts.filter(
      (question) => question.teacherConfirmationRequired || !checkQuestionServable(question).ok,
    ),
  };
}

/**
 * 擁有者授權的批次**覆核**（`scripts/approve-questions.ts`）可用的候選題目。
 *
 * 與批次發布一樣，批次覆核**不可**繞過「待教師確認」的關卡：當題目因品質閘門、
 * 自動修復改變考核內容或隔離標記而暫緩時，只有教師的人工決定可以清除標記。
 * 批次腳本只會處理 `approvable`，`held` 一律原樣保留並在輸出中列出。
 */
export function listOwnerApprovalCandidates(
  filter: { origins?: QuestionOrigin[]; topicId?: string } = {},
): {
  approvable: Question[];
  held: Question[];
} {
  const questions = listQuestions({
    ...(filter.origins && filter.origins.length > 0 ? { origins: filter.origins } : {}),
    ...(filter.topicId ? { topicId: filter.topicId } : {}),
  });
  return {
    approvable: questions.filter(
      (question) => !question.teacherConfirmationRequired && checkQuestionServable(question).ok,
    ),
    // held = 待教師確認 **或** 結構上不可作答（Sprint 12：批次覆核不可繞過可作答性）
    held: questions.filter(
      (question) => question.teacherConfirmationRequired || !checkQuestionServable(question).ok,
    ),
  };
}

/**
 * 記錄「這一版題目通過自動品質驗證」，並在設定允許時立即發布供學生自學。
 *
 * 由生成流程呼叫（題目在寫入題庫前已通過 validateLlmQuestions 的所有檢查，
 * 包括 question-quality.ts 的品質閘門）。回傳更新後的題目；發布失敗只會令題目
 * 留在草稿，不會令生成流程失敗（教師之後可以重新驗證或覆核）。
 */
export function recordAutoValidationAndPublish(questionId: string): Question {
  const existing = getQuestion(questionId);
  if (!existing) throw new QuestionServiceError("找不到指定的題目", 404);

  const validated = recordQuestionAutoValidation({
    questionId: existing.id,
    revision: existing.revision,
    fingerprint: questionFingerprint(existing),
    validatedAt: nowIso(),
  });
  if (!validated) throw new QuestionServiceError("自動驗證紀錄寫入失敗", 500);

  if (!getServerConfig().autoPublishValidatedQuestions) return validated;
  // 未確定項目（例如題目要求的思考面向未見於教材）即使已記錄自動驗證，也不得自動發布：
  // 題目保留為草稿，等待教師確認（見 changeQuestionStatus 及 0020 migration）。
  if (validated.teacherConfirmationRequired) return validated;
  const published = setQuestionStatusIfRevision(validated.id, "published", validated.revision);
  return published ?? validated;
}

/**
 * 重新執行自動品質驗證（教師端的「重新檢查」動作）。
 *
 * 只做機器檢查：教材依據（引用的段落仍然存在、節錄仍出自該段落）及完整題目品質
 * （question-quality.ts）。通過時記錄自動驗證結果（因此可以發布，毋須等待人工覆核），
 * **不會**建立任何人工覆核紀錄。不通過時回報原因，由教師修正後再試。
 */
export function revalidateQuestion(questionId: string): {
  autoValidated: boolean;
  /**
   * 機器檢查的結論（Sprint 8.6）：
   *   - `auto-validated`：機器檢查全部通過，已記錄自動驗證（可經既有發布關卡發布）。
   *   - `awaiting-teacher-confirmation`：機器檢查通過，但題目仍帶「待教師確認」標記；
   *     標記只可由教師的人工覆核決定清除，機器動作不會代為解除。
   *   - `blocked`：教材依據或品質檢查不通過（見 `sourceIssues`／`qualityIssues`）。
   */
  decision: "auto-validated" | "awaiting-teacher-confirmation" | "blocked";
  sourceIssues: string[];
  qualityIssues: string[];
  view: TeacherQuestionView;
} {
  const existing = getQuestion(questionId);
  if (!existing) throw new QuestionServiceError("找不到指定的題目", 404);

  const units = buildMaterialUnits(existing.topicId, [existing.sectionId], {
    audience: "staff",
  });
  const blocks = getBlocksByIds(existing.sourceBlockIds);

  const sourceIssues: string[] = [];
  if (existing.sourceBlockIds.length === 0) {
    sourceIssues.push("題目沒有引用任何教材段落，無法核對教材依據");
  } else {
    const missing = existing.sourceBlockIds.filter(
      (blockId) => !blocks.some((block) => block.id === blockId),
    );
    if (missing.length > 0) sourceIssues.push(`引用的教材段落已不存在：${missing.join("、")}`);
    const excerpt = normalizeForMatch(existing.sourceExcerpt);
    const linked = blocks.some((block) => normalizeForMatch(block.text).includes(excerpt));
    if (!linked) sourceIssues.push("節錄文字已不在所引用的教材段落之中（教材可能已重新匯入）");
  }

  const quality = checkQuestionQuality(
    {
      questionType: existing.questionType,
      question: existing.question,
      options: existing.options,
      correctAnswer: existing.correctAnswer,
      explanation: existing.explanation,
      sourceExcerpt: existing.sourceExcerpt,
      sourceBlockIds: existing.sourceBlockIds,
      gradingPoints: existing.gradingPoints,
    },
    units.length > 0
      ? units
      : blocks.map((block) => ({
          blockId: block.id,
          sourceLocation: block.sourceLocation ?? "",
          text: block.text,
        })),
  );
  const blockingIssues = quality.issues.filter((issue) => issue.severity === "blocking");
  // 教師看到的問題清單：BLOCKING、未確定，以及**可修正的教學品質問題**
  // （例如解釋只重複答案）。純提示（例如選項重疊警告）不列入，因為它們不影響判定。
  const qualityIssues = quality.issues
    .filter((issue) => issue.severity !== "warning" || isMachineRevisableIssue(issue))
    .map((issue) => issue.message);

  if (sourceIssues.length > 0 || blockingIssues.length > 0) {
    return {
      autoValidated: false,
      decision: "blocked",
      sourceIssues,
      qualityIssues,
      view: teacherQuestionView(existing),
    };
  }

  // 未確定項目（例如題目要求的思考面向未見於教材）或可修正的教學品質問題（例如解釋只重複答案）：
  // 即使沒有 BLOCKING 問題，仍不可由**機器檢查**清除暫緩標記。
  //
  // Sprint 8.5 修正的繞過路徑：以往這裡只檢查「未確定」項目，於是生成時被判 `revise`
  // （例如解釋只是重複答案）而暫緩的題目，教師按一次「重新執行品質驗證」就可以被發布——
  // 同一道閘門在生成時攔下、在同一個動作下放行。現在判定沿用生成流程的同一套規則
  // （qualityOutcome），`revise` 一律保持暫緩；只有教師的人工覆核決定
  // （changeQuestionStatus 的 approved 紀錄）可以清除標記。
  if (qualityOutcome(quality.issues) !== "pass") {
    const held = setTeacherConfirmationRequired(existing.id, true) ?? existing;
    return {
      autoValidated: false,
      decision: "blocked",
      sourceIssues,
      qualityIssues,
      view: teacherQuestionView(held),
    };
  }

  // Sprint 8.6：暫緩標記**只**可以由教師的人工覆核決定清除。
  //
  // 「重新執行品質驗證」是機器動作：即使它現在找不到問題，也不能代替人的決定——
  // 題目之所以暫緩，可能是因為較早版本的閘門判定、教材重新匯入，或某項需要人判斷的
  // 疑問；那些疑問不會因為機器這次沒有偵測到就消失。這與 README 已記錄的契約一致：
  // 修改題目內容不會清除標記（fail-closed），必須由教師解決。
  if (existing.teacherConfirmationRequired) {
    return {
      autoValidated: false,
      decision: "awaiting-teacher-confirmation",
      sourceIssues,
      qualityIssues: [
        ...qualityIssues,
        "此題仍待教師確認（自動發布暫緩）：機器檢查通過不代表疑問已解決，請由教師覆核後再發布。",
      ],
      view: teacherQuestionView(existing),
    };
  }

  const validated = recordQuestionAutoValidation({
    questionId: existing.id,
    revision: existing.revision,
    fingerprint: questionFingerprint(existing),
    validatedAt: nowIso(),
  });
  if (!validated) throw new QuestionServiceError("自動驗證紀錄寫入失敗", 500);
  return {
    autoValidated: true,
    decision: "auto-validated",
    sourceIssues: [],
    qualityIssues: [],
    view: teacherQuestionView(validated),
  };
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

  // 發布只能經由覆核關卡（見 changeQuestionStatus）。編輯題目內容一律回到草稿：
  // 內容已改變，先前的覆核紀錄（對應舊版本及舊指紋）随即可失效。
  assertNoPublishRequest(parsed.status, "編輯題目內容");

  const updated = updateQuestion(questionId, {
    ...existing,
    ...parsed,
    id: questionId,
    origin: existing.origin,
    createdAt: existing.createdAt,
    sourceVerified: parsed.sourceBlockIds.length > 0 || existing.sourceBlockIds.length === 0,
    status: "draft",
  });
  return teacherQuestionView(updated);
}

export function removeQuestion(questionId: string): void {
  const existing = getQuestion(questionId);
  if (!existing) throw new QuestionServiceError("找不到指定的題目", 404);
  deleteQuestion(questionId);
}

/**
 * 建立或編輯題目時**不可**直接發布。
 *
 * 這是修補一個實際的繞過途徑：`questionInputSchema` 的 `status` 來自請求內容，
 * 因此 `POST /api/teacher/questions`（或 `PATCH … action: "edit"`）只要在 body 帶
 * `status: "published"` 就可以不經人工覆核直接發布，繞過 `changeQuestionStatus`
 * 的關卡。現在改為明確拒絕（409），而不是靜默忽略，令呼叫端知道要走覆核流程。
 */
function assertNoPublishRequest(status: Question["status"], action: string): void {
  if (status !== "published") return;
  throw new QuestionServiceError(
    `無法在「${action}」時直接發布題目：發布必須先有對應目前版本的人工覆核紀錄。` +
      "請先儲存為草稿，完成覆核後再以發布動作（action: status）發布。",
    409,
  );
}

/** 教師手動建立題目（origin = manual）：一律以草稿建立，發布須經覆核 */
export function createManualQuestion(input: QuestionInput, questionId?: string): Question {
  const parsed = questionInputSchema.parse(input);
  assertNoPublishRequest(parsed.status, "建立題目");
  const question: Question = questionSchema.parse({
    ...parsed,
    id: questionId ?? newId("q"),
    sourceBlockIds: parsed.sourceBlockIds,
    sourceVerified: parsed.sourceBlockIds.length > 0,
    // 手動建立一律由草稿開始，避免繞過覆核關卡
    status: "draft",
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
