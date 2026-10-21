/**
 * 題目內容修正（純函式）：只處理「題幹文字損壞」及「答案明顯有誤」兩種情況。
 *
 * 背景：2026-10-21 逐題核對「需核對課本依據」的題目時，發現三類其實是**匯入或原卷本身的錯字／
 * 錯誤答案**，與自動修復無關：
 *   - 題幹有黏連或漏字（例如「抨擊教會及教士的腐章運動」應為「腐敗」）；
 *   - 答案混入了 1986 年才成立的機關，令 1983 年的敘述不成立。
 *
 * 界線（重要）：
 *   - **必須**同時提供 `from`（現值）及 `to`（修正值），現值不符即拒絕，避免覆蓋其他人的修改。
 *   - 修正前必須重新通過可作答性檢查；修正後仍不可作答即拒絕。
 *   - 只改題幹或標準答案；選項、可接受答案、知識點、來源一律不動。
 *   - 不寫入任何 `question_reviews`。
 */
import { checkQuestionServable } from "./question-servability";
import type { Question } from "../../lib/types";

export interface QuestionContentFix {
  questionId: string;
  /** 為何要改（至少 10 字，會寫入紀錄） */
  reason: string;
  question?: { from: string; to: string };
  correctAnswer?: { from: string; to: string };
}

export type QuestionContentFixStatus = "planned" | "already-applied" | "missing" | "conflict" | "unservable";

export interface QuestionContentFixPlan {
  questionId: string;
  status: QuestionContentFixStatus;
  detail: string;
  newQuestion: string | null;
  newCorrectAnswer: string | null;
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
    newCorrectAnswer: null,
  };
  if (!question) return { ...base, status: "missing", detail: "資料庫內找不到此題目" };
  if (fix.reason.trim().length < 10) {
    return { ...base, status: "conflict", detail: "沒有提供足夠理由（至少 10 字）" };
  }
  if (!fix.question && !fix.correctAnswer) {
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

  const servability = checkQuestionServable({
    questionType: question.questionType,
    question: questionText,
    options: question.options,
    correctAnswer: answer,
  });
  if (!servability.ok) {
    return { ...base, status: "unservable", detail: servability.reason ?? "修正後仍不可作答" };
  }

  if (base.newQuestion === null && base.newCorrectAnswer === null) {
    return { ...base, status: "already-applied", detail: "已是修正後的內容，沒有需要寫入" };
  }
  base.detail = [
    base.newQuestion !== null ? "修正題幹文字" : null,
    base.newCorrectAnswer !== null ? "修正標準答案" : null,
  ]
    .filter(Boolean)
    .join("；");
  return base;
}
