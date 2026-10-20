/**
 * 解釋補寫的套用流程（批次、可模擬、原子）。
 *
 * 背景：2026-10-20 內容診斷顯示 1,875 題的解釋全部屬「佔位文字」（1,329）或「只列答案」（546）。
 * 產品負責人已決定由 AI 逐題補寫、並維持題目可派發（不啟用 `EXPLANATION_HOLD_POLICY`）。
 *
 * 這個模組**只改 `explanation`**：
 *   - 不傳入、也不修改 `correctAnswer`、`acceptedAnswers`、`options`、題幹或空格；
 *   - 保留 `status`（已發布的仍然發布）與 `teacherConfirmationRequired`；
 *   - 經 `updateQuestion()` 寫入，因此 `revision` 會 +1、`question_fingerprint` 改變，
 *     舊的人工覆核紀錄**如實變成「已失效」**（不會被偽造成仍然有效）。
 *
 * 為甚麼不寫 `question_reviews`：覆核紀錄代表「有人確認過這一版題目」。由程式改寫解釋
 * 不是教師覆核，把它記成 `approved` 會令覆核證據失真。改寫紀錄寫入
 * `question_content_flags`（`explanation_rewritten`），並同時解除該題原本的
 * `explanation_needs_rewrite` 標記。
 */
import { getQuestion, updateQuestion } from "../repositories/questions";
import { insertContentFlagEvent, listContentFlagEvents } from "../repositories/content-flags";
import { classifyExplanation } from "../quality/explanation-quality";
import { deriveFlagStatuses, type ContentFlag } from "../quality/content-flags";
import { questionFingerprint } from "../quality/question-fingerprint";

export interface ExplanationRewriteEntry {
  questionId: string;
  /** 產生這段文字時看到的現有解釋；與資料庫不同即代表題目已被改動，跳過不寫 */
  expectedExplanation: string;
  newExplanation: string;
  /** 這題補寫時的依據說明（寫入紀錄，例如「依課題1 課文 A 節」） */
  note?: string;
}

export type ExplanationRewriteOutcome =
  | "applied"
  | "planned"
  | "already-applied"
  | "skipped"
  | "failed";

export interface ExplanationRewriteResult {
  questionId: string;
  outcome: ExplanationRewriteOutcome;
  detail: string;
  before?: string;
  after?: string;
}

export interface ExplanationRewriteReport {
  dryRun: boolean;
  results: ExplanationRewriteResult[];
  applied: number;
  planned: number;
  alreadyApplied: number;
  skipped: number;
  failed: number;
}

export interface ApplyExplanationRewritesOptions {
  dryRun: boolean;
  /** 批次標題（寫入紀錄，例如「課題1 解釋補寫（第 1 批）」） */
  batchTitle: string;
  actorEmail: string;
  actorRole: string;
  /** 預設 true：任何一條失敗即整批不寫入 */
  atomic?: boolean;
}

/** 解釋不可包含的內部用語（出現即代表仍是評卷參考或佔位文字） */
const FORBIDDEN_PHRASES = ["評卷參考", "答案依", "填充題答案", "校內試題", "見課本"];

const MIN_EXPLANATION_LENGTH = 25;
const MAX_EXPLANATION_LENGTH = 220;

interface PlannedRewrite {
  entry: ExplanationRewriteEntry;
  outcome: ExplanationRewriteOutcome;
  detail: string;
  /** 需要寫入時的目標解釋 */
  target: string | null;
  /** 寫入前的解釋 */
  before: string | null;
  /** 寫入時應被解除的標記 */
  clearFlag: ContentFlag | null;
}

function planRewrite(entry: ExplanationRewriteEntry): PlannedRewrite {
  const base = { entry, before: null as string | null, clearFlag: null as ContentFlag | null };
  const question = getQuestion(entry.questionId);
  if (!question) {
    return { ...base, outcome: "failed", detail: "找不到指定的題目", target: null };
  }
  const before = question.explanation;
  const target = entry.newExplanation.trim();

  if (before === target) {
    return {
      ...base,
      before,
      outcome: "already-applied",
      detail: "解釋已是這段文字，沒有需要寫入",
      target: null,
    };
  }
  if (before !== entry.expectedExplanation) {
    return {
      ...base,
      before,
      outcome: "skipped",
      detail: "現有解釋與清單記錄不同（題目已被其他人修改），不覆寫",
      target: null,
    };
  }
  if (target.length < MIN_EXPLANATION_LENGTH) {
    return {
      ...base,
      before,
      outcome: "failed",
      detail: `新解釋只有 ${target.length} 字（最少 ${MIN_EXPLANATION_LENGTH} 字）`,
      target: null,
    };
  }
  if (target.length > MAX_EXPLANATION_LENGTH) {
    return {
      ...base,
      before,
      outcome: "failed",
      detail: `新解釋有 ${target.length} 字（上限 ${MAX_EXPLANATION_LENGTH} 字）`,
      target: null,
    };
  }
  const forbidden = FORBIDDEN_PHRASES.find((phrase) => target.includes(phrase));
  if (forbidden !== undefined) {
    return {
      ...base,
      before,
      outcome: "failed",
      detail: `新解釋仍含內部用語「${forbidden}」`,
      target: null,
    };
  }
  // 用同一套分類器檢查：仍然是佔位／只列答案／過短／與答案矛盾 → 不接受
  const classification = classifyExplanation({
    explanation: target,
    correctAnswer: question.correctAnswer,
    acceptedAnswers: question.acceptedAnswers,
    options: question.options,
    hasHumanReview: false,
  }).class;
  if (classification !== "not_assessed") {
    return {
      ...base,
      before,
      outcome: "failed",
      detail: `新解釋仍被分類為 ${classification}（未達可使用的標準）`,
      target: null,
    };
  }

  const openFlags = deriveFlagStatuses(
    listContentFlagEvents({ questionIds: [question.id] }),
    null,
  );
  const needsRewriteOpen = [...openFlags.values()].some(
    (status) => status.flag === "explanation_needs_rewrite" && status.state === "open",
  );

  return {
    ...base,
    before,
    outcome: "planned",
    detail: "將寫入新解釋（只改 explanation）",
    target,
    clearFlag: needsRewriteOpen ? "explanation_needs_rewrite" : null,
  };
}

/**
 * 套用一批解釋補寫。
 *
 * **呼叫端必須預設 `dryRun: true`**；只有 CLI／教師明確要求時才傳 `false`。
 * atomic 模式下任何一條 failed，整批都不寫入（避免題庫半完成）。
 */
export function applyExplanationRewrites(
  entries: ExplanationRewriteEntry[],
  options: ApplyExplanationRewritesOptions,
): ExplanationRewriteReport {
  const atomic = options.atomic ?? true;
  const planned = entries.map(planRewrite);
  const failureCount = planned.filter((entry) => entry.outcome === "failed").length;
  const writeEnabled = !options.dryRun && !(atomic && failureCount > 0);

  const results: ExplanationRewriteResult[] = [];

  for (const plan of planned) {
    const base = {
      questionId: plan.entry.questionId,
      before: plan.before ?? undefined,
      after: plan.outcome === "planned" && writeEnabled ? (plan.target ?? undefined) : undefined,
    };
    if (plan.outcome !== "planned" || plan.target === null) {
      results.push({ ...base, outcome: plan.outcome, detail: plan.detail });
      continue;
    }
    if (!writeEnabled) {
      results.push({
        ...base,
        after: plan.target,
        outcome: "planned",
        detail: `${plan.detail}（模擬，未寫入）`,
      });
      continue;
    }

    const current = getQuestion(plan.entry.questionId);
    if (!current) {
      results.push({ ...base, outcome: "failed", detail: "寫入前題目已消失" });
      continue;
    }
    const updated = updateQuestion(current.id, {
      ...current,
      explanation: plan.target,
    });

    const reasonParts = [options.batchTitle];
    if (plan.entry.note) reasonParts.push(plan.entry.note);
    const reason = reasonParts.join("：");

    insertContentFlagEvent({
      questionId: updated.id,
      revision: updated.revision,
      questionFingerprint: fingerprintOf(updated),
      flag: "explanation_rewritten",
      state: "open",
      reason,
      actorEmail: options.actorEmail,
      actorRole: options.actorRole,
    });
    if (plan.clearFlag !== null) {
      insertContentFlagEvent({
        questionId: updated.id,
        revision: updated.revision,
        questionFingerprint: fingerprintOf(updated),
        flag: plan.clearFlag,
        state: "cleared",
        reason: `${reason}（原標記自動解除）`,
        actorEmail: options.actorEmail,
        actorRole: options.actorRole,
      });
    }

    results.push({ ...base, outcome: "applied", detail: plan.detail });
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

function fingerprintOf(question: Parameters<typeof updateQuestion>[1]): string {
  // 與 question-service 共用同一指紋定義（純函式），避免兩處算法不同
  return questionFingerprint(question);
}
