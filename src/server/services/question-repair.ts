/**
 * 題目修復規劃（單一事實來源）。
 *
 * 為甚麼需要獨立成一個模組：`scripts/repair-question-bank.ts` 會改寫題目內容，
 * 而改寫後**必須**如實描述改動，並確保改變了考核內容的題目不會被當作等價而自動發布。
 * 這裡只做確定性判斷（pure functions），不接觸資料庫，方便逐項測試。
 *
 * 三種結果：
 *   - `formatting-only`：只移除排版符號（選項開頭的項目符號），答案與選項文字不變。
 *   - `answer-preserved`：多空格填充題補回其餘空格的答案，**仍考核原第 1 個空格**，
 *     考核答案與題意不變。
 *   - `answer-affecting`：保留其他空格才能避免答案外洩，但這樣會令考核答案改變
 *     （原第 1 個空格 → 第 N 個空格）。**不改寫**原題，保留內容供教師比較，
 *     並標示為待教師確認；絕不自動通過。
 *
 * 任何無法確定等價的情況一律 fail-closed（`unrepairable` 或 `answer-affecting`）。
 */
import type { Question } from "../../lib/types";
import { countBlankMarkers } from "../llm/fill-question";
import { blankAnswersFromExplanation, normaliseMultiBlankFill } from "../materials/question-bank";
import { checkQuestionServable } from "./question-servability";

/** 舊版修復腳本寫入的品質警告前綴（仍視為「可自動清除」的標記） */
export const AUTO_PREFIX = "平台自動檢查：";
/** 本模組（修復規劃）寫入的品質警告前綴 */
export const AUTO_REPAIR_PREFIX = "平台自動檢查（修復）：";
/**
 * 隔離警告前綴：用於「已被證實改變考核答案」的題目。
 *
 * 刻意**不**以 `平台自動檢查：` 開頭，令 `nextTeacherConfirmationFlag()` 不會在
 * 下一次修復時自動清除這個標記——那類題目必須由教師明確確認。
 */
export const AUTO_QUARANTINE_PREFIX = "平台自動檢查（隔離）：";

function isRepairWarning(warning: string): boolean {
  return warning.startsWith(AUTO_REPAIR_PREFIX) || warning.startsWith(AUTO_PREFIX);
}

export type RepairClassification =
  | "unchanged"
  | "formatting-only"
  | "answer-preserved"
  | "answer-affecting"
  | "unrepairable"
  | "blocked-by-servability";

export interface RepairPlan {
  /** 建議寫入的題目內容（若答案會改變或無法修復，與原題相同） */
  question: Question;
  /** 內容是否有改動 */
  changed: boolean;
  /** 不可派給學生（結構問題或待教師確認） */
  blocked: boolean;
  /** 結構上無法作答（只有這類題目可被 --delete-unusable 刪除） */
  unusable: boolean;
  /** 因改變考核內容而待教師確認（不可刪除，須由教師核對原卷） */
  requiresReview: boolean;
  classification: RepairClassification;
  /** 準確描述這次處理的句子（不含前綴）；null = 沒有任何改動或問題 */
  note: string | null;
  /**
   * 可寫入覆核紀錄的理由。`null` 代表**不可**自動記錄覆核
   * （例如改變了考核內容，或只是結構失敗）。
   */
  reviewReason: string | null;
  before?: string;
  after?: string;
}

/** 由修復流程寫入的品質警告（可安全重新計算／清除） */
export function autoWarnings(question: Question): string[] {
  return question.qualityWarnings.filter(isRepairWarning);
}

/** 其他來源（教師、匯入流程、隔離標記）的品質警告 */
export function otherWarnings(question: Question): string[] {
  return question.qualityWarnings.filter((warning) => !isRepairWarning(warning));
}

/** 移除選項開頭殘留的項目符號（原檔寫成「A. . i和ii」） */
export function cleanBullet(value: string): string {
  return value.replace(/^[.．·•‧]\s*/, "").trim();
}

function describeBlanks(answers: string[]): string {
  return answers.map((answer) => `「${answer}」`).join("、");
}

/**
 * 規劃一道題目的修復。
 *
 * 只讀取傳入的題目，不會寫入任何內容。
 */
export function planQuestionRepair(question: Question): RepairPlan {
  let candidate = question;
  let changed = false;
  let classification: RepairClassification = "unchanged";
  let note: string | null = null;
  let reviewReason: string | null = null;
  let before: string | undefined;
  let after: string | undefined;
  let requiresReview = false;

  if (question.questionType === "fill") {
    const blanks = countBlankMarkers(question.question);
    if (blanks > 1) {
      const answers = [question.correctAnswer, ...question.gradingPoints]
        .map((answer) => answer.trim())
        .filter((answer) => answer.length > 0);
      const normalised =
        normaliseMultiBlankFill(question.question, answers) ??
        normaliseMultiBlankFill(question.question, blankAnswersFromExplanation(question.explanation));

      if (normalised === null) {
        classification = "unrepairable";
        note = `題幹有 ${blanks} 個空格，但只有 ${answers.length} 個答案，未能還原其餘空格的答案`;
      } else if (
        normalised.assessedBlankIndex === 1 &&
        normalised.correctAnswer.trim() === question.correctAnswer.trim()
      ) {
        candidate = {
          ...question,
          question: normalised.question,
          correctAnswer: normalised.correctAnswer,
        };
        changed = true;
        classification = "answer-preserved";
        before = question.question;
        after = normalised.question;
        note =
          `原題有 ${blanks} 個空格，已把其餘空格的答案（${describeBlanks(
            normalised.filled.map((entry) => entry.answer),
          )}）填入題幹，仍考核第 1 個空格；考核答案不變`;
        reviewReason =
          "[automation] 格式整理：把其餘空格的答案填入題幹，仍考核第 1 個空格；考核答案及題意不變";
      } else {
        // 保留其他空格才不會令答案外洩，但這會改變被考核的內容。
        // 不改寫原題：保留原版供教師比較，並暫緩派發。
        classification = "answer-affecting";
        requiresReview = true;
        note =
          `原題有 ${blanks} 個空格；若保留第 ${normalised.assessedBlankIndex} 個空格，` +
          `考核答案會由「${normalised.originalAnswer}」變為「${normalised.correctAnswer}」，` +
          "因此不會自動改寫";
        reviewReason = null;
      }
    }
  } else if (question.questionType === "mc") {
    const options = question.options.map(cleanBullet);
    const answer = cleanBullet(question.correctAnswer);
    const cleanupSafe = options.every((option) => option.length > 0) && answer.length > 0;
    if (
      cleanupSafe &&
      (answer !== question.correctAnswer ||
        options.some((option, index) => option !== question.options[index]))
    ) {
      candidate = { ...question, options, correctAnswer: answer };
      changed = true;
      classification = "formatting-only";
      before = question.options.join(" ／ ");
      after = options.join(" ／ ");
      note = "已移除選項開頭殘留的項目符號（原檔的排版符號）；答案及選項文字不變";
      reviewReason = "[automation] 格式整理：移除選項開頭殘留的項目符號；答案及選項文字不變";
    }
  }

  // 最後的結構檢查：這是「是否可以派給學生」的單一判斷來源。
  //
  // 改變考核內容的題目會保留原版（多個空格），因此必然通不過結構檢查；但它是
  // **可由教師處理**的題目，不是「無法修復」：不可被 --delete-unusable 刪除，
  // 亦要保留原本更清楚的說明（為甚麼需要教師確認）。
  const servability = checkQuestionServable(candidate);
  const structurallyUnservable = !servability.ok;
  const unusable = structurallyUnservable && !requiresReview;
  if (structurallyUnservable && !requiresReview) {
    if (classification === "unrepairable") {
      note = `${note ?? "題目結構不完整"}（${servability.reason ?? "結構檢查未通過"}）`;
    } else {
      note = servability.reason ?? "題目結構不完整";
      if (classification === "unchanged") classification = "blocked-by-servability";
    }
    reviewReason = null;
  }

  return {
    question: candidate,
    changed,
    blocked: structurallyUnservable || requiresReview,
    unusable,
    requiresReview,
    classification,
    note,
    reviewReason,
    before,
    after,
  };
}

/**
 * 套用修復規劃後的品質警告。
 *
 * `keepAuto` 保留其他來源的警告；本模組產生的警告一律重新計算，避免重複累積。
 */
export function repairWarnings(question: Question, plan: RepairPlan): string[] {
  const warnings = otherWarnings(question);
  if (plan.note === null) return warnings;
  const suffix = plan.unusable
    ? "；此題結構上無法作答，暫時不會派給學生，請按原卷修正。"
    : plan.requiresReview
      ? "；此題暫時不會派給學生，須由教師確認考核內容。"
      : "。";
  warnings.push(`${AUTO_REPAIR_PREFIX}${plan.note}${suffix}`);
  return warnings;
}

/** 這題是否帶有「已改變考核答案」的隔離標記（只有教師可以清除） */
export function hasQuarantineWarning(question: Question): boolean {
  return question.qualityWarnings.some((warning) =>
    warning.startsWith(AUTO_QUARANTINE_PREFIX),
  );
}

/**
 * 修復後是否仍應保持「待教師確認」。
 *
 * - 結構失敗或改變考核內容 → 必須為 true。
 * - 帶有隔離標記（已證實改變考核答案）→ 必須為 true，即使題目結構已可用。
 * - 由本腳本標示、而現在已恢復可用的題目 → 清除（其他來源的標記不動）。
 */
export function nextTeacherConfirmationFlag(question: Question, plan: RepairPlan): boolean {
  if (plan.blocked) return true;
  if (hasQuarantineWarning(question)) return true;
  const wasAutoFlagged = autoWarnings(question).length > 0 && question.teacherConfirmationRequired;
  return wasAutoFlagged ? false : question.teacherConfirmationRequired;
}
