/**
 * 題目重複判定（單一事實來源）。
 *
 * 為甚麼需要獨立成一個模組：同一批生成（一次 LLM 呼叫）與整個練習組題（多次呼叫、
 * 多個分節）都需要同一套「重複」定義。若兩邊各自實作，就會出現「同一次呼叫內擋得住、
 * 跨分節擋不住」的漏洞——實際例子（2026-10-16 本機練習 sess_c1c25eb90c2c4f86）：
 * 兩條填充題都挖空同一段教材的同一詞語（答案同為「蒸汽時代」），題幹只是把
 * 「因此這一時期又被稱為」改成「因此又被稱為」，舊的「題幹完全相同的字串」比對
 * 因此全部放行，學生在同一次練習看到兩條幾乎一樣的題目。
 *
 * 重複的定義（任一成立即屬重複）：
 *   1. 題幹正規化後相同（忽略標點、空白、大小寫）。
 *   2. **同一教材依據已用過相同答案**：題型、標準答案及來源依據（引用的教材段落 ID；
 *      沒有段落 ID 時用節錄全文）全部相同。這代表「同一件史實問了兩次」，
 *      即使模型把題幹改寫得多麼不同，都不可在同一批／同一份練習中出現兩次。
 *   3. **填充題已用過相同答案**（不分教材依據）：填充題要學生自行輸入答案，
 *      答案相同就等於同一件史實問了兩次——書中不同段落都出現同一個詞語或年份時，
 *      舊寫法會在同一份練習出兩題（實測可見「十八世紀中葉」×2、「家庭手工業制度」×2）。
 *      選擇題不受此限：同一份試卷不同題目共用同一個正確答案屬正常，因此仍只按
 *      題型、答案與教材依據一起比對。
 *
 * 只在同一批或同一份練習之內比較；不同練習之間不比較（學生重做時可以再遇到同一題）。
 */
import type { QuestionType } from "../../lib/types";
import { normalizeForMatch } from "../materials/text-utils";

/** 判斷重複所需的最少欄位（Question 及待驗證的候選題目都符合） */
export interface QuestionBasis {
  questionType: QuestionType;
  correctAnswer: string;
  sourceBlockIds: string[];
  sourceExcerpt: string;
}

export interface DedupeCandidate extends QuestionBasis {
  question: string;
}

/** 題幹比對用的鍵：忽略標點、空白及大小寫 */
export function questionStemKey(question: string): string {
  return normalizeForMatch(question);
}

/**
 * 教材依據比對用的鍵：題型 + 標準答案 + 來源依據。
 * 有段落 ID 時用排序後的 ID 清單；沒有時退回節錄全文（含題庫匯入的題目）。
 */
export function questionBasisKey(part: QuestionBasis): string {
  const answer = normalizeForMatch(part.correctAnswer);
  if (answer.length === 0) return `${part.questionType}|no-answer`;
  const blockIds = part.sourceBlockIds
    .map((blockId) => blockId.trim())
    .filter((blockId) => blockId.length > 0)
    .sort()
    .join(",");
  const basis = blockIds.length > 0 ? `blocks:${blockIds}` : `excerpt:${normalizeForMatch(part.sourceExcerpt)}`;
  return `${part.questionType}|${answer}|${basis}`;
}

export interface DuplicateTracker {
  /** 是否已出現過相同題幹、同一教材依據已用相同答案，或填充題已用相同答案 */
  isDuplicate(candidate: DedupeCandidate): boolean;
  /** 記錄已接受的題目 */
  add(candidate: DedupeCandidate): void;
  /** 已使用的標準答案（去重、保留原寫法），供補題時提示模型避免重複 */
  usedAnswers(): string[];
}

/**
 * 填充題答案的重複鍵（其他題型回傳 null＝不設此限）。
 * 回傳正規化後的答案；空答案不由這裡判定（另有規則處理）。
 */
export function questionFillAnswerKey(part: QuestionBasis): string | null {
  if (part.questionType !== "fill") return null;
  const answer = normalizeForMatch(part.correctAnswer);
  return answer.length > 0 ? answer : null;
}

export function createDuplicateTracker(): DuplicateTracker {
  const stems = new Set<string>();
  const bases = new Set<string>();
  const fillAnswers = new Set<string>();
  const answers: string[] = [];
  const seenAnswers = new Set<string>();

  return {
    isDuplicate(candidate) {
      const fillAnswer = questionFillAnswerKey(candidate);
      return (
        stems.has(questionStemKey(candidate.question)) ||
        bases.has(questionBasisKey(candidate)) ||
        (fillAnswer !== null && fillAnswers.has(fillAnswer))
      );
    },
    add(candidate) {
      stems.add(questionStemKey(candidate.question));
      bases.add(questionBasisKey(candidate));
      const fillAnswer = questionFillAnswerKey(candidate);
      if (fillAnswer !== null) fillAnswers.add(fillAnswer);
      const answer = candidate.correctAnswer.trim();
      const key = normalizeForMatch(answer);
      if (answer.length > 0 && !seenAnswers.has(key)) {
        seenAnswers.add(key);
        answers.push(answer);
      }
    },
    usedAnswers() {
      return [...answers];
    },
  };
}
