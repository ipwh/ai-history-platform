/**
 * 題目內容修正（純函式）：處理題幹、選項、標準答案、可接受答案及解釋的明確錯誤。
 *
 * 背景：
 *   - 2026-10-21 逐題核對「需核對課本依據」的題目時，發現題幹有黏連或漏字、
 *     答案混入了 1986 年才成立的機關等，與自動修復無關；
 *   - 同日逐題核對全部答案時，再發現原卷的個別選項與教材矛盾、解釋與答案不一致，
 *     以及部分題目因選項設計而出現多於一個正確答案。這些需要同時修改選項或解釋，
 *     單靠「只改題幹或標準答案」無法修正。
 *
 * 界線（重要）：
 *   - **必須**同時提供每個欄位的 `from`（現值）及 `to`（修正值），現值不符即拒絕，
 *     避免覆蓋其他人的修改；已套用者回報「已是最新」，可重複執行。
 *   - 修正後必須重新通過可作答性檢查（選擇題的答案須仍存在於選項中）；不通過即拒絕。
 *   - 不改知識點、來源、難度或狀態；不寫入任何 `question_reviews`。
 */
import { checkQuestionServable } from "./question-servability";
import type { Question } from "../../lib/types";

export interface QuestionContentFix {
  questionId: string;
  /** 為何要改（至少 10 字，會寫入紀錄） */
  reason: string;
  question?: { from: string; to: string };
  options?: { from: string[]; to: string[] };
  correctAnswer?: { from: string; to: string };
  acceptedAnswers?: { from: string[]; to: string[] };
  explanation?: { from: string; to: string };
}

export type QuestionContentFixStatus = "planned" | "already-applied" | "missing" | "conflict" | "unservable";

export interface QuestionContentFixPlan {
  questionId: string;
  status: QuestionContentFixStatus;
  detail: string;
  newQuestion: string | null;
  newOptions: string[] | null;
  newCorrectAnswer: string | null;
  newAcceptedAnswers: string[] | null;
  newExplanation: string | null;
}

function sameArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function planQuestionContentFix(
  question: Question | null,
  fix: QuestionContentFix,
): QuestionContentFixPlan {
  const base: QuestionContentFixPlan = {
    questionId: fix.questionId,
    status: "planned",
    detail: "",
    newQuestion: null,
    newOptions: null,
    newCorrectAnswer: null,
    newAcceptedAnswers: null,
    newExplanation: null,
  };
  if (!question) return { ...base, status: "missing", detail: "資料庫內找不到此題目" };
  if (fix.reason.trim().length < 10) {
    return { ...base, status: "conflict", detail: "沒有提供足夠理由（至少 10 字）" };
  }
  if (
    !fix.question &&
    !fix.options &&
    !fix.correctAnswer &&
    !fix.acceptedAnswers &&
    !fix.explanation
  ) {
    return { ...base, status: "conflict", detail: "沒有指定要修正的欄位" };
  }

  let questionText = question.question;
  if (fix.question) {
    if (questionText === fix.question.to) {
      // 已修正過：可重複執行
    } else if (questionText !== fix.question.from) {
      return {
        ...base,
        status: "conflict",
        detail: `題幹與記錄不同（現值「${questionText.slice(0, 24)}…」），不覆寫`,
      };
    } else {
      base.newQuestion = fix.question.to;
      questionText = fix.question.to;
    }
  }

  let options = question.options;
  if (fix.options) {
    if (sameArray(options, fix.options.to)) {
      // 已修正過
    } else if (!sameArray(options, fix.options.from)) {
      return {
        ...base,
        status: "conflict",
        detail: "選項與記錄不同，不覆寫",
      };
    } else {
      base.newOptions = fix.options.to;
      options = fix.options.to;
    }
  }

  let answer = question.correctAnswer;
  if (fix.correctAnswer) {
    if (answer === fix.correctAnswer.to) {
      // 已修正過
    } else if (answer !== fix.correctAnswer.from) {
      return {
        ...base,
        status: "conflict",
        detail: `答案與記錄不同（現值「${answer.slice(0, 24)}」），不覆寫`,
      };
    } else {
      base.newCorrectAnswer = fix.correctAnswer.to;
      answer = fix.correctAnswer.to;
    }
  }

  let acceptedAnswers = question.acceptedAnswers;
  if (fix.acceptedAnswers) {
    if (sameArray(acceptedAnswers, fix.acceptedAnswers.to)) {
      // 已修正過
    } else if (!sameArray(acceptedAnswers, fix.acceptedAnswers.from)) {
      return {
        ...base,
        status: "conflict",
        detail: "可接受答案與記錄不同，不覆寫",
      };
    } else {
      base.newAcceptedAnswers = fix.acceptedAnswers.to;
      acceptedAnswers = fix.acceptedAnswers.to;
    }
  }

  let explanation = question.explanation;
  if (fix.explanation) {
    if (explanation === fix.explanation.to) {
      // 已修正過
    } else if (explanation !== fix.explanation.from) {
      return {
        ...base,
        status: "conflict",
        detail: "解釋與記錄不同，不覆寫",
      };
    } else if (fix.explanation.to.trim().length === 0) {
      return { ...base, status: "conflict", detail: "解釋不可改為空白" };
    } else {
      base.newExplanation = fix.explanation.to;
      explanation = fix.explanation.to;
    }
  }

  const servability = checkQuestionServable({
    questionType: question.questionType,
    question: questionText,
    options,
    correctAnswer: answer,
  });
  if (!servability.ok) {
    return { ...base, status: "unservable", detail: servability.reason ?? "修正後仍不可作答" };
  }

  if (
    base.newQuestion === null &&
    base.newOptions === null &&
    base.newCorrectAnswer === null &&
    base.newAcceptedAnswers === null &&
    base.newExplanation === null
  ) {
    return { ...base, status: "already-applied", detail: "已是修正後的內容，沒有需要寫入" };
  }
  base.detail = [
    base.newQuestion !== null ? "修正題幹文字" : null,
    base.newOptions !== null ? "修正選項" : null,
    base.newCorrectAnswer !== null ? "修正標準答案" : null,
    base.newAcceptedAnswers !== null ? "修正可接受答案" : null,
    base.newExplanation !== null ? "修正解釋" : null,
  ]
    .filter(Boolean)
    .join("；");
  return base;
}
