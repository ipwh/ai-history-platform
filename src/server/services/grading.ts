/**
 * 自動評分。
 * 只有選擇題及填充題會自動評分；短答題一律由學生按得分要點自我檢查
 * （第一版不會將 AI 評分當作正式 HKDSE 分數）。
 */
import type { Question } from "../../lib/types";

/** 全形轉半形（處理英文字母及數字） */
function toHalfWidth(value: string): string {
  return value.replace(/[\uff01-\uff5e]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0),
  ).replace(/\u3000/g, " ");
}

/** 比對答案時使用的正規化：忽略大小寫、空白及標點 */
export function normalizeAnswer(value: string): string {
  return toHalfWidth(value)
    .replace(/\s+/g, "")
    .replace(
      /[，。、；：？！「」『』（）()《》〈〉〔〕［］\[\]【】"'’‘“”,.;:!?—－・·\-–~～…⋯＊*｜|／/]/g,
      "",
    )
    .toLowerCase();
}

export interface GradeOutcome {
  autoGraded: boolean;
  isCorrect: boolean | null;
}

export function gradeAnswer(question: Question, answer: string): GradeOutcome {
  if (question.questionType === "short") {
    return { autoGraded: false, isCorrect: null };
  }

  const normalizedAnswer = normalizeAnswer(answer);
  if (normalizedAnswer.length === 0) {
    return { autoGraded: true, isCorrect: false };
  }

  const accepted = [question.correctAnswer, ...question.acceptedAnswers]
    .map((candidate) => normalizeAnswer(candidate))
    .filter((candidate) => candidate.length > 0);

  return { autoGraded: true, isCorrect: accepted.includes(normalizedAnswer) };
}

/** 正確率（只計可自動評分的題目） */
export function calculateAccuracy(correctCount: number, gradedCount: number): number | null {
  if (gradedCount === 0) return null;
  return Number((correctCount / gradedCount).toFixed(4));
}
