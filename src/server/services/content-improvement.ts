/**
 * 內容改進（解釋補寫、技能標籤）的工作清單與批次標記服務。
 *
 * 分工：
 *   - **工作清單**：唯讀。只讀題庫並產生「建議」，不寫入任何東西。輸出可重複執行
 *     （相同資料 → 相同內容，題目按 ID 排序）。
 *   - **批次標記**：把教師的決定寫入 `question_content_flags`（只可新增）。
 *     預設 `dryRun: true`，必須明確要求才會寫入。
 *
 * 三條不可跨越的界線：
 *   1. **不改考核答案**：本模組沒有任何改寫 `correct_answer`／選項的路徑。
 *   2. **不改題目內容**：不呼叫 `updateQuestion`，因此 `revision` 不變、既有覆核紀錄
 *      不會因為「標記」而失效。
 *   3. **不自動寫入技能**：技能建議只出現在工作清單；寫入只會經教師逐題確認
 *      （`updateManualQuestion`），本模組不提供「把建議技能寫入題目」的路徑。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { getQuestion } from "../repositories/questions";
import { insertContentFlagEvent, listContentFlagEvents } from "../repositories/content-flags";
import { questionFingerprint } from "../quality/question-fingerprint";
import { classifyExplanation, type ExplanationClass } from "../quality/explanation-quality";
import {
  CONTENT_FLAGS,
  CONTENT_TODO_FLAGS,
  deriveFlagStatuses,
  type ContentFlag,
  type ContentFlagStatus,
} from "../quality/content-flags";
import {
  IMPROVEMENT_TYPE_LABELS,
  looksLikeSourcePassage,
  suggestExplanationImprovement,
  suggestSkills,
  summariseStem,
  type ImprovementType,
  type SkillSuggestion,
} from "../quality/explanation-improvement";

/** 會被納入「解釋待重寫」的分類 */
const IMPROVEMENT_CLASSES: readonly ExplanationClass[] = [
  "placeholder",
  "answer_only",
  "insufficient",
  "potentially_inconsistent",
];

export interface WorkItemExplanation {
  class: ExplanationClass;
  improvement: ImprovementType;
  improvementLabel: string;
  alsoConsider: ImprovementType[];
  alsoConsiderLabels: string[];
  rationale: string;
  hasSourcePassage: boolean;
}

export interface WorkItemSkill {
  suggestions: SkillSuggestion[];
}

export interface ContentWorkItem {
  questionId: string;
  revision: number;
  topicId: string;
  topicTitle: string;
  sectionId: string;
  sectionTitle: string;
  questionType: string;
  stemSummary: string;
  currentExplanation: string;
  correctAnswer: string;
  currentSkill: string | null;
  knowledgePoint: string;
  sourceExcerpt: string;
  sourceLocation: string;
  /** 需要改寫解釋時為非 null */
  explanation: WorkItemExplanation | null;
  /** 技能標籤空白時為非 null */
  skill: WorkItemSkill | null;
}

/** 工作清單報告的固定位置（CLI 輸出與教師端讀取共用同一個常數，避免兩邊不同步） */
export const CONTENT_WORKLIST_REPORT_PATH =
  "docs/quality/explanation-skill-worklist-2026-10-20.json";

export interface ContentWorklistTotals {
  questions: number;
  published: number;
  explanationByClass: Record<ExplanationClass, number>;
  explanationByImprovement: Partial<Record<ImprovementType, number>>;
  skillMissing: number;
  needsWork: number;
  skillSuggestionByConfidence: Record<"high" | "medium" | "low", number>;
}

export interface ContentWorklistPayload {
  generatedAt: string;
  notice: string;
  inputFingerprint: string;
  totals: ContentWorklistTotals;
  items: ContentWorkItem[];
}

const READ_ONLY_NOTICE =
  "唯讀工作清單：只讀取題庫並提供建議，沒有修改任何題目、答案、覆核或發布狀態；不含學生資料。";

interface QuestionRow {
  id: string;
  topic_id: string;
  section_id: string;
  question_type: string;
  question: string;
  options_json: string | null;
  correct_answer: string;
  accepted_answers_json: string | null;
  explanation: string;
  knowledge_point: string;
  source_excerpt: string;
  source_location: string;
  skill: string | null;
  status: string;
  revision: number;
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function emptyClassCounts(): Record<ExplanationClass, number> {
  return {
    placeholder: 0,
    answer_only: 0,
    insufficient: 0,
    potentially_inconsistent: 0,
    not_assessed: 0,
  };
}

/**
 * 產生內容改進工作清單（唯讀）。
 *
 * 以獨立的唯讀連線讀取，**不會**執行 migration，也不會建立資料庫檔案。
 */
export function buildContentWorklist(databasePath: string): ContentWorklistPayload {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `SELECT id, topic_id, section_id, question_type, question, options_json, correct_answer,
                accepted_answers_json, explanation, knowledge_point, source_excerpt, source_location,
                skill, status, revision
           FROM questions
          WHERE status != 'disabled'
          ORDER BY id ASC`,
      )
      .all() as unknown as QuestionRow[];
    const topics = db.prepare("SELECT id, title FROM topics").all() as unknown as {
      id: string;
      title: string;
    }[];
    const sections = db.prepare("SELECT id, title FROM sections").all() as unknown as {
      id: string;
      title: string;
    }[];

    const topicTitle = new Map(topics.map((topic) => [topic.id, topic.title]));
    const sectionTitle = new Map(sections.map((section) => [section.id, section.title]));

    const items: ContentWorkItem[] = [];
    const explanationByClass = emptyClassCounts();
    const explanationByImprovement: Partial<Record<ImprovementType, number>> = {};
    const skillSuggestionByConfidence = { high: 0, medium: 0, low: 0 };
    let skillMissing = 0;
    let published = 0;
    let needsWork = 0;
    const hash = createHash("sha256");

    for (const row of rows) {
      const explanationClass = classifyExplanation({
        explanation: row.explanation,
        correctAnswer: row.correct_answer,
        acceptedAnswers: parseJsonArray(row.accepted_answers_json),
        options: parseJsonArray(row.options_json),
        hasHumanReview: false,
      }).class;
      explanationByClass[explanationClass] += 1;
      if (row.status === "published") published += 1;

      const needsExplanation = IMPROVEMENT_CLASSES.includes(explanationClass);
      const needsSkill = row.skill === null || row.skill.trim().length === 0;
      if (!needsExplanation && !needsSkill) continue;

      const hasSourcePassage = looksLikeSourcePassage(row.source_excerpt, row.question);
      let explanation: WorkItemExplanation | null = null;
      if (needsExplanation) {
        const suggestion = suggestExplanationImprovement({
          explanationClass,
          questionType: row.question_type,
          question: row.question,
          explanation: row.explanation,
          correctAnswer: row.correct_answer,
          options: parseJsonArray(row.options_json),
          sourceExcerpt: row.source_excerpt,
          knowledgePoint: row.knowledge_point,
        });
        explanation = {
          class: explanationClass,
          improvement: suggestion.primary,
          improvementLabel: IMPROVEMENT_TYPE_LABELS[suggestion.primary],
          alsoConsider: suggestion.alsoConsider,
          alsoConsiderLabels: suggestion.alsoConsider.map(
            (type) => IMPROVEMENT_TYPE_LABELS[type],
          ),
          rationale: suggestion.rationale,
          hasSourcePassage,
        };
        explanationByImprovement[suggestion.primary] =
          (explanationByImprovement[suggestion.primary] ?? 0) + 1;
      }

      let skill: WorkItemSkill | null = null;
      if (needsSkill) {
        skillMissing += 1;
        const suggestions = suggestSkills({
          questionType: row.question_type,
          question: row.question,
          explanation: row.explanation,
          correctAnswer: row.correct_answer,
          knowledgePoint: row.knowledge_point,
        });
        skillSuggestionByConfidence[suggestions[0]?.confidence ?? "low"] += 1;
        skill = { suggestions };
      }

      needsWork += 1;
      hash.update(
        [
          row.id,
          row.revision,
          explanationClass,
          explanation?.improvement ?? "",
          skill?.suggestions[0]?.skill ?? "",
          row.skill ?? "",
        ].join("|"),
      );

      items.push({
        questionId: row.id,
        revision: row.revision,
        topicId: row.topic_id,
        topicTitle: topicTitle.get(row.topic_id) ?? row.topic_id,
        sectionId: row.section_id,
        sectionTitle: sectionTitle.get(row.section_id) ?? row.section_id,
        questionType: row.question_type,
        stemSummary: summariseStem(row.question),
        currentExplanation: row.explanation,
        correctAnswer: row.correct_answer,
        currentSkill: row.skill,
        knowledgePoint: row.knowledge_point,
        sourceExcerpt: row.source_excerpt,
        sourceLocation: row.source_location,
        explanation,
        skill,
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      notice: READ_ONLY_NOTICE,
      inputFingerprint: hash.digest("hex"),
      totals: {
        questions: rows.length,
        published,
        explanationByClass,
        explanationByImprovement,
        skillMissing,
        needsWork,
        skillSuggestionByConfidence,
      },
      items,
    };
  } finally {
    db.close();
  }
}

/* ------------------------------------------------------------------ */
/* 當前標記                                                           */
/* ------------------------------------------------------------------ */

export interface CurrentFlagView extends ContentFlagStatus {
  questionId: string;
}

/** 讀取指定題目（或全部）的現行標記狀態 */
export function listCurrentFlags(questionIds?: string[]): CurrentFlagView[] {
  const events = listContentFlagEvents(questionIds ? { questionIds } : {});
  const byQuestion = new Map<string, typeof events>();
  for (const event of events) {
    const list = byQuestion.get(event.questionId) ?? [];
    list.push(event);
    byQuestion.set(event.questionId, list);
  }
  const views: CurrentFlagView[] = [];
  for (const [questionId, questionEvents] of byQuestion) {
    const question = getQuestion(questionId);
    const current = question
      ? { revision: question.revision, fingerprint: questionFingerprint(question) }
      : null;
    for (const [key, status] of deriveFlagStatuses(questionEvents, current)) {
      if (!key.startsWith(`${questionId}::`)) continue;
      views.push({ questionId, ...status });
    }
  }
  return views.sort(
    (left, right) =>
      left.questionId.localeCompare(right.questionId) || left.flag.localeCompare(right.flag),
  );
}

/** 快速查詢：某題某標記是否仍為 open（供其他服務判斷，例如是否暫緩派發） */
export function hasOpenFlag(questionId: string, flag: ContentFlag): boolean {
  const views = listCurrentFlags([questionId]);
  return views.some((view) => view.flag === flag && view.state === "open");
}

/** 已標記的題目 ID（只計 `state = open`；不計已解除者） */
export function openFlaggedQuestionIds(flag: ContentFlag): Set<string> {
  const views = listCurrentFlags();
  return new Set(
    views.filter((view) => view.flag === flag && view.state === "open").map((view) => view.questionId),
  );
}

/* ------------------------------------------------------------------ */
/* 批次標記                                                           */
/* ------------------------------------------------------------------ */

export interface ContentFlagActor {
  email: string;
  role: string;
}

export interface ContentFlagRequest {
  questionId: string;
  flag: ContentFlag;
  action: "mark" | "clear";
  reason: string;
}

export type ContentFlagOutcome = "applied" | "planned" | "already-applied" | "skipped" | "failed";

export interface ContentFlagResult {
  questionId: string;
  flag: ContentFlag;
  action: "mark" | "clear";
  outcome: ContentFlagOutcome;
  detail: string;
}

export interface ContentFlagReport {
  dryRun: boolean;
  results: ContentFlagResult[];
  applied: number;
  planned: number;
  alreadyApplied: number;
  skipped: number;
  failed: number;
}

export interface ApplyContentFlagsOptions {
  dryRun: boolean;
  actor: ContentFlagActor;
  /**
   * 預設 `true`：任何一條失敗即完全不寫入。
   * 批次標記不應留下半完成的狀態（同一批的老師會以為全部已標記）。
   */
  atomic?: boolean;
  /**
   * 容許標記「已不需要改寫」的題目（例如教師認為某題解釋可以接受）。
   * 預設 `false`：這類題目會被跳過並回報，避免把已完成的工作重新排入佇列。
   */
  force?: boolean;
}

interface PlannedFlag {
  request: ContentFlagRequest;
  outcome: ContentFlagOutcome;
  detail: string;
  /** 需要寫入時的事件內容 */
  write: {
    revision: number;
    fingerprint: string;
    state: "open" | "cleared";
  } | null;
}

function planFlag(request: ContentFlagRequest, force: boolean): PlannedFlag {
  const base = { request };
  if (!request.reason.trim()) {
    return { ...base, outcome: "failed", detail: "必須提供理由（供日後追溯）", write: null };
  }
  const question = getQuestion(request.questionId);
  if (!question) {
    return { ...base, outcome: "failed", detail: "找不到指定的題目", write: null };
  }
  const fingerprint = questionFingerprint(question);
  const state = request.action === "mark" ? "open" : "cleared";
  const write = { revision: question.revision, fingerprint, state } as const;

  const existing = listCurrentFlags([request.questionId]).find(
    (view) => view.flag === request.flag,
  );
  if (request.action === "clear") {
    if (!existing || existing.state === "cleared") {
      return { ...base, outcome: "already-applied", detail: "此標記本來已解除", write: null };
    }
    return { ...base, outcome: "planned", detail: "解除標記", write };
  }

  if (existing && existing.state === "open" && !existing.contentChangedSinceFlag) {
    return { ...base, outcome: "already-applied", detail: "此標記已存在（同一版本）", write: null };
  }

  // 避免把已完成的工作重新排入佇列：題目已不再屬於需要改寫／需要確認的狀態時跳過。
  if (!force) {
    if (request.flag === "explanation_needs_rewrite") {
      const explanationClass = classifyExplanation({
        explanation: question.explanation,
        correctAnswer: question.correctAnswer,
        acceptedAnswers: question.acceptedAnswers,
        options: question.options,
        hasHumanReview: false,
      }).class;
      if (!IMPROVEMENT_CLASSES.includes(explanationClass)) {
        return {
          ...base,
          outcome: "skipped",
          detail: `解釋已不屬需改寫分類（${explanationClass}）；如仍要標記請加 --force`,
          write: null,
        };
      }
    }
    if (request.flag === "skill_needs_confirmation" && question.skill !== null) {
      return {
        ...base,
        outcome: "skipped",
        detail: `已標示技能「${question.skill}」；如仍要標記請加 --force`,
        write: null,
      };
    }
  }

  return { ...base, outcome: "planned", detail: "標記為待處理", write };
}

/**
 * 套用（或模擬）一批標記。
 *
 * **預設呼叫端必須傳 `dryRun: true`**；`--apply` 只在 CLI 明確指定時才傳 `false`。
 * atomic 模式下有任何一條 failed，整批都不會寫入。
 */
export function applyContentFlags(
  requests: ContentFlagRequest[],
  options: ApplyContentFlagsOptions,
): ContentFlagReport {
  const atomic = options.atomic ?? true;
  const planned = requests.map((request) => planFlag(request, options.force ?? false));
  const failureCount = planned.filter((entry) => entry.outcome === "failed").length;

  // 模擬，或 atomic 模式下有失敗 → 一律不寫入
  const writeEnabled = !options.dryRun && !(atomic && failureCount > 0);
  const results: ContentFlagResult[] = [];

  for (const entry of planned) {
    if (entry.outcome !== "planned" || entry.write === null) {
      results.push({
        questionId: entry.request.questionId,
        flag: entry.request.flag,
        action: entry.request.action,
        outcome: entry.outcome,
        detail: entry.detail,
      });
      continue;
    }
    if (!writeEnabled) {
      results.push({
        questionId: entry.request.questionId,
        flag: entry.request.flag,
        action: entry.request.action,
        outcome: "planned",
        detail: `${entry.detail}（模擬，未寫入）`,
      });
      continue;
    }
    const { created } = insertContentFlagEvent({
      questionId: entry.request.questionId,
      revision: entry.write.revision,
      questionFingerprint: entry.write.fingerprint,
      flag: entry.request.flag,
      state: entry.write.state,
      reason: entry.request.reason.trim(),
      actorEmail: options.actor.email,
      actorRole: options.actor.role,
    });
    results.push({
      questionId: entry.request.questionId,
      flag: entry.request.flag,
      action: entry.request.action,
      outcome: created ? "applied" : "already-applied",
      detail: created ? entry.detail : "相同事件已存在，沒有重複寫入",
    });
  }

  return {
    dryRun: !writeEnabled,
    results,
    applied: results.filter((result) => result.outcome === "applied").length,
    planned: results.filter((result) => result.outcome === "planned").length,
    alreadyApplied: results.filter((result) => result.outcome === "already-applied").length,
    skipped: results.filter((result) => result.outcome === "skipped").length,
    failed: failureCount,
  };
}

/** 把工作清單項目轉成「標記請求」（CLI 與教師端共用同一規則） */
export function flagRequestsForWorklist(
  items: ContentWorkItem[],
  options: {
    flag: ContentFlag;
    reason: string;
    limit?: number;
  },
): ContentFlagRequest[] {
  const filtered = items.filter((item) => {
    if (options.flag === "explanation_needs_rewrite") return item.explanation !== null;
    return item.skill !== null;
  });
  const limited =
    options.limit !== undefined && options.limit > 0 ? filtered.slice(0, options.limit) : filtered;
  return limited.map((item) => ({
    questionId: item.questionId,
    flag: options.flag,
    action: "mark" as const,
    reason: options.reason,
  }));
}

/** 標記的允許值（供 CLI 及 route 驗證共用） */
export function isContentFlag(value: string): value is ContentFlag {
  return (CONTENT_FLAGS as readonly string[]).includes(value);
}

/** 這個標記是否屬「待辦」（見 `CONTENT_TODO_FLAGS`） */
export function isTodoFlag(flag: ContentFlag): boolean {
  return (CONTENT_TODO_FLAGS as readonly string[]).includes(flag);
}

/* ------------------------------------------------------------------ */
/* 教師端佇列（讀取已產生的工作清單）                                  */
/* ------------------------------------------------------------------ */

/** 每頁最多項目數（與評核佇列一致，不把 1,800 題送到瀏覽器） */
export const MAX_CONTENT_QUEUE_PAGE_SIZE = 50;

/** 單次批次標記的題目上限（避免一次請求改動過多題目） */
export const MAX_BATCH_FLAG_SIZE = 200;

export type ContentQueueStatus = "unflagged" | "flagged" | "all";

export interface ContentQueueQuery {
  flag?: ContentFlag;
  explanationClass?: ExplanationClass;
  improvement?: ImprovementType;
  status?: ContentQueueStatus;
  page?: number;
  pageSize?: number;
}

export interface ContentQueueItem extends ContentWorkItem {
  /** 現行標記（`state = open` 才算未完成） */
  openFlags: ContentFlag[];
  /** 內容自上一個標記後已改變，需重新判斷 */
  contentChangedSinceFlag: boolean;
}

export interface ContentQueuePage {
  available: boolean;
  limitation: string | null;
  asOf: string | null;
  reportPath: string;
  total: number;
  page: number;
  pageSize: number;
  counts: {
    needsExplanation: number;
    skillMissing: number;
    byClass: Record<string, number>;
    byImprovement: Record<string, number>;
    flagged: Record<ContentFlag, number>;
  };
  items: ContentQueueItem[];
}

interface CachedReport {
  absolutePath: string;
  mtimeMs: number;
  payload: ContentWorklistPayload;
}

let reportCache: CachedReport | null = null;

function readWorklistReport(absolutePath: string): {
  payload: ContentWorklistPayload | null;
  error: string | null;
} {
  if (!fs.existsSync(absolutePath)) {
    return {
      payload: null,
      error: `找不到工作清單 ${CONTENT_WORKLIST_REPORT_PATH}；請先執行 \`npm run audit:explanation-worklist\`。`,
    };
  }
  const { mtimeMs } = fs.statSync(absolutePath);
  if (
    reportCache !== null &&
    reportCache.absolutePath === absolutePath &&
    reportCache.mtimeMs === mtimeMs
  ) {
    return { payload: reportCache.payload, error: null };
  }
  try {
    const payload = JSON.parse(fs.readFileSync(absolutePath, "utf8")) as ContentWorklistPayload;
    reportCache = { absolutePath, mtimeMs, payload };
    return { payload, error: null };
  } catch (error) {
    return {
      payload: null,
      error: `工作清單 ${CONTENT_WORKLIST_REPORT_PATH} 無法解析：${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * 教師端佇列（唯讀）。
 *
 * 只讀已產生的報告及現行標記，不會重新分類或改動任何題目；報告不存在時回報
 * `available: false` 及原因，不用替代數字假裝有資料。
 */
export function listContentImprovementQueue(
  query: ContentQueueQuery = {},
  options: { repoRoot?: string } = {},
): ContentQueuePage {
  const repoRoot = options.repoRoot ?? process.cwd();
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const pageSize = Math.min(
    MAX_CONTENT_QUEUE_PAGE_SIZE,
    Math.max(1, Math.floor(query.pageSize ?? 20)),
  );
  const { payload, error } = readWorklistReport(path.resolve(repoRoot, CONTENT_WORKLIST_REPORT_PATH));

  const flagsByQuestion = new Map<string, ContentFlagStatus[]>();
  const flaggedCounts = Object.fromEntries(CONTENT_FLAGS.map((flag) => [flag, 0])) as Record<
    ContentFlag,
    number
  >;
  if (payload !== null) {
    for (const view of listCurrentFlags()) {
      if (view.state !== "open") continue;
      flaggedCounts[view.flag] += 1;
      if (!isTodoFlag(view.flag)) continue;
      const list = flagsByQuestion.get(view.questionId) ?? [];
      list.push(view);
      flagsByQuestion.set(view.questionId, list);
    }
  }

  if (payload === null) {
    return {
      available: false,
      limitation: error,
      asOf: null,
      reportPath: CONTENT_WORKLIST_REPORT_PATH,
      total: 0,
      page,
      pageSize,
      counts: {
        needsExplanation: 0,
        skillMissing: 0,
        byClass: {},
        byImprovement: {},
        flagged: flaggedCounts,
      },
      items: [],
    };
  }

  const status = query.status ?? "unflagged";
  const filtered = payload.items.filter((item) => {
    const openFlags = (flagsByQuestion.get(item.questionId) ?? []).filter(
      (view) => view.state === "open" && isTodoFlag(view.flag),
    );
    const isFlagged = openFlags.some((view) => (query.flag ? view.flag === query.flag : true));
    if (status === "flagged" && !isFlagged) return false;
    if (status === "unflagged" && isFlagged) return false;
    if (query.flag === "explanation_needs_rewrite" && item.explanation === null) return false;
    if (query.flag === "skill_needs_confirmation" && item.skill === null) return false;
    if (query.explanationClass && item.explanation?.class !== query.explanationClass) return false;
    if (query.improvement && item.explanation?.improvement !== query.improvement) return false;
    return true;
  });

  const byClass: Record<string, number> = {};
  const byImprovement: Record<string, number> = {};
  for (const item of filtered) {
    if (!item.explanation) continue;
    byClass[item.explanation.class] = (byClass[item.explanation.class] ?? 0) + 1;
    byImprovement[item.explanation.improvement] =
      (byImprovement[item.explanation.improvement] ?? 0) + 1;
  }

  const start = (page - 1) * pageSize;
  const items: ContentQueueItem[] = filtered.slice(start, start + pageSize).map((item) => {
    const statuses = flagsByQuestion.get(item.questionId) ?? [];
    return {
      ...item,
      openFlags: statuses.filter((view) => view.state === "open").map((view) => view.flag),
      contentChangedSinceFlag: statuses.some((view) => view.contentChangedSinceFlag),
    };
  });

  return {
    available: true,
    limitation: null,
    asOf: payload.generatedAt,
    reportPath: CONTENT_WORKLIST_REPORT_PATH,
    total: filtered.length,
    page,
    pageSize,
    counts: {
      needsExplanation: payload.items.filter((item) => item.explanation !== null).length,
      skillMissing: payload.totals.skillMissing,
      byClass,
      byImprovement,
      flagged: flaggedCounts,
    },
    items,
  };
}
