/**
 * 自動評分。選擇題及填充題以逐字比對（正規化後）自動評分。
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
      // \u2024-\u2027 是一點領導符（․）、兩點領導符（‥）等排版字元：教材原檔常用作
      // 「尤利烏斯․凱撒」的間隔符，學生輸入「·」或「•」時亦應視為相同答案。
      /[，。、；：？！「」『』（）()《》〈〉〔〕［］\[\]【】"'’‘“”,.;:!?—－・·\u2024\u2025\u2026\u2027\-–~～…⋯＊*｜|／/]/g,
      "",
    )
    .toLowerCase();
}

/**
 * 填充題的標準答案可能同時列出多個可接受寫法（例如「路德宗 / 信義宗」）。
 *
 * 正規化會移除「/」，令整串變成一個學生不可能剛好輸入的字串，結果任何一個
 * 有效寫法都會被判錯。因此比對前先按「/」拆開，逐一接受。
 */
export function answerAlternatives(correctAnswer: string): string[] {
  return correctAnswer
    .split(/\s*[／/]\s*/)
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0);
}

export interface GradeOutcome {
  autoGraded: boolean;
  isCorrect: boolean | null;
  /**
   * 評分結果不確定：學生的答案與某個可接受答案極為接近（只差一兩個字），但並非逐字相同。
   * 這種情況多數是錯別字或未列出的可接受寫法，系統無法可靠判斷，因此照原樣記錄
   * （不會改分），並標示交由教師覆核。
   */
  uncertain?: boolean;
}

/**
 * 兩個已正規化的答案是否「只差一個字」（取代、漏字或多字）。
 *
 * 做法：先扣掉共同的前綴與後綴，剩下未對齊的部分在兩個字串都只可以有一個字。
 * 這樣「九十五條論證」對「九十五論證」（漏「條」）、「馬丁路德」對「馬丁路德氏」
 * （多「氏」）及「文藝復興」對「文藝復與」（同一位置的錯別字）都會成立，
 * 而「馬丁路德」對「加爾文」不會。
 */
function isNearMiss(normalizedAnswer: string, normalizedAccepted: string): boolean {
  if (normalizedAnswer === normalizedAccepted) return false;
  if (Math.abs(normalizedAnswer.length - normalizedAccepted.length) > 1) return false;
  // 太短的答案（例如「封建」）差異意義不大，不標示為不確定
  if (Math.min(normalizedAnswer.length, normalizedAccepted.length) < 3) return false;

  let prefix = 0;
  while (
    prefix < normalizedAnswer.length &&
    prefix < normalizedAccepted.length &&
    normalizedAnswer[prefix] === normalizedAccepted[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < normalizedAnswer.length - prefix &&
    suffix < normalizedAccepted.length - prefix &&
    normalizedAnswer[normalizedAnswer.length - 1 - suffix] ===
      normalizedAccepted[normalizedAccepted.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const answerRemaining = normalizedAnswer.length - prefix - suffix;
  const acceptedRemaining = normalizedAccepted.length - prefix - suffix;
  return answerRemaining <= 1 && acceptedRemaining <= 1;
}

export function gradeAnswer(question: Question, answer: string): GradeOutcome {
  const normalizedAnswer = normalizeAnswer(answer);
  if (normalizedAnswer.length === 0) {
    return { autoGraded: true, isCorrect: false };
  }

  const accepted = [
    ...(question.questionType === "fill"
      ? answerAlternatives(question.correctAnswer)
      : [question.correctAnswer]),
    ...question.acceptedAnswers.flatMap((candidate) => answerAlternatives(candidate)),
  ]
    .map((candidate) => normalizeAnswer(candidate))
    .filter((candidate) => candidate.length > 0);

  if (accepted.includes(normalizedAnswer)) {
    return { autoGraded: true, isCorrect: true };
  }

  // 填充題：只差一個字的答案標示為不確定（不改分，交由教師覆核）
  if (question.questionType === "fill") {
    const nearMiss = accepted.some((candidate) => isNearMiss(normalizedAnswer, candidate));
    return { autoGraded: true, isCorrect: false, uncertain: nearMiss };
  }

  return { autoGraded: true, isCorrect: false };
}

/** 正確率（只計可自動評分的題目） */
export function calculateAccuracy(correctCount: number, gradedCount: number): number | null {
  if (gradedCount === 0) return null;
  return Number((correctCount / gradedCount).toFixed(4));
}
