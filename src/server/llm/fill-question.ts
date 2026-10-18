/**
 * 填充題的「題幹品質」共用規則（單一事實來源）。
 *
 * 為甚麼需要獨立成一個模組：題目可能來自 LLM 或本地示範生成（mock-provider），
 * 兩者都必須遵守同一套規則——**不可**只靠提示語要求模型自律。這裡只實作
 * 確定性、可測試的規則；史實正確與否仍然由歷史科教師判斷。
 *
 * 規則（全部 fail-closed）：
 *   1. 每條填充題必須**剛好一個**空格標記（`＿＿＿`；應用程式亦接受底線寫法）。
 *      沒有空格、多個空格或空格不對應答案的題目一律丟棄——學生無法知道要填甚麼。
 *   2. 標準答案在題幹中必須**已被挖空**：正規化（忽略空白及標點）後，答案不可
 *      仍然出現在題幹其餘位置（包括同一詞語在後文再次出現）。
 *   3. 題幹長度：正規化後以 120 個中文字為硬上限（`FILL_STEM_HARD_MAX`）。
 *      目標範圍是 20–70 字（`FILL_STEM_TARGET_*`），供提示語及生成模板使用；
 *      超過硬上限的題目代表直接把教材整句抄成題目，一律丟棄（不截斷——截斷可能
 *      刪去必要背景而改變題意）。2026-10-18 由 100 放寬至 120：真實模型常產出
 *      103–109 字的題幹，因而整節出不到填充題；120 字仍然遠低於整段教材。
 *
 * 只影響填充題；選擇題及短答題不受此模組約束。
 */
import { splitSentences } from "../materials/text-utils";

/** 標準的空格標記（學生介面顯示的寫法） */
export const FILL_BLANK = "＿＿＿";

/** 空格標記：兩個或以上的全形／半形底線視為一個空格（兼容教材原檔的寫法） */
const BLANK_RUN = /[＿_]{2,}/g;

/** 題幹長度目標範圍（提示語及生成模板使用） */
export const FILL_STEM_TARGET_MIN = 20;
export const FILL_STEM_TARGET_MAX = 70;
/** 題幹正規化後的硬上限：超過即丟棄 */
export const FILL_STEM_HARD_MAX = 120;

export interface FillStemCheck {
  /** 題幹是否合格（false = 必須丟棄） */
  ok: boolean;
  /** 不合格原因（繁體中文，供教師端及伺服器日誌顯示） */
  reason: string | null;
}

/** 把空白及零寬字元收斂為單一空白並去除首尾空白 */
export function normalizeStem(stem: string): string {
  return stem
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 題幹與答案的比對用正規化：移除所有空白及常見中英標點，
 * 令「1517 年」與「1517年」、「《九十五條論證》」與「九十五條論證」視為相同。
 * 這是保守比對：寧可多丟棄一題，也不要讓答案由標點差異漏出。
 */
export function normalizeForStemMatch(value: string): string {
  return normalizeStem(value)
    .replace(/[「」『』《》〈〉【】（）()［］\[\]｛｝{}]/g, "")
    .replace(/[，,。.、；;：:！!？?／/＼\\—–\-~～…·"'"'`|]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** 題幹內的空格標記數量（連續底線視為一個） */
export function countBlankMarkers(stem: string): number {
  return (stem.match(BLANK_RUN) ?? []).length;
}

/** 移除題幹內的空格標記，用於檢查答案是否仍在題幹其他位置出現 */
function stripBlankMarkers(stem: string): string {
  return stem.replace(BLANK_RUN, " ");
}

/**
 * 標準答案（或其核心部分）是否仍然出現在題幹中（即未被挖空）。
 * 只在答案長度足以比對時檢查，避免單字答案造成大量誤判。
 */
export function answerLeaksIntoStem(stem: string, answer: string): boolean {
  const visible = normalizeForStemMatch(stripBlankMarkers(stem));
  const normalizedAnswer = normalizeForStemMatch(answer);
  if (normalizedAnswer.length < 2) return false;
  return visible.includes(normalizedAnswer);
}

/**
 * 填充題題幹品質檢查（空格完整性、答案外洩、長度）。
 *
 * @param stem 學生可見的題幹（`question.question`）
 * @param correctAnswer 標準答案；未提供（空字串）時略過外洩檢查
 */
export function checkFillStem(stem: string, correctAnswer: string): FillStemCheck {
  const normalized = normalizeStem(stem);
  if (normalized.length === 0) {
    return { ok: false, reason: "填充題的題幹是空白" };
  }

  const blanks = countBlankMarkers(normalized);
  if (blanks === 0) {
    return {
      ok: false,
      reason: `填充題的題幹沒有空格標記（${FILL_BLANK}），學生無從得知要填寫甚麼`,
    };
  }
  if (blanks > 1) {
    return {
      ok: false,
      reason:
        `填充題的題幹有 ${blanks} 個空格標記，但標準答案只對應其中一個：` +
        "系統不會為同一題保留多個空格（避免只記錄部分答案），請改為單一空格的題目",
    };
  }

  if (normalized.length > FILL_STEM_HARD_MAX) {
    return {
      ok: false,
      reason:
        `填充題的題幹長度 ${normalized.length} 字超過上限 ${FILL_STEM_HARD_MAX} 字：` +
        "題幹過長通常代表直接把教材整句抄成題目，請由教材重點重新組成簡潔題幹",
    };
  }

  if (correctAnswer.trim().length > 0 && answerLeaksIntoStem(normalized, correctAnswer)) {
    return {
      ok: false,
      reason:
        `填充題的標準答案「${correctAnswer.trim()}」仍然出現在題幹其他位置（未被挖空），` +
        "學生可直接抄寫答案，必須改由教材中重新挖空",
    };
  }

  return { ok: true, reason: null };
}

export interface BlankedSpan {
  /** 挖空後的單句題幹（含空格標記） */
  stem: string;
  /** 被挖空的原文單句（供節錄／知識點使用） */
  sentence: string;
}

/**
 * 由教材原文建立**安全**的單空格題幹（本地示範生成使用）。
 *
 * 只在「同一句內剛好出現一次」該詞語時才挖空：若同一句出現兩次，該答案會在第二次
 * 出現時仍然可見（`String.replace` 只換第一處），因此必須選用其他單句或略過整個素材。
 * 句長超過硬上限者亦略過，避免把教材整句當成題目。
 */
export function buildBlankedStem(text: string, term: string): BlankedSpan | null {
  const trimmedTerm = term.trim();
  if (trimmedTerm.length === 0) return null;
  const candidates = splitSentences(normalizeStem(text))
    .map((sentence) => normalizeStem(sentence))
    .filter((sentence) => {
      if (!sentence.includes(trimmedTerm)) return false;
      const occurrences = sentence.split(trimmedTerm).length - 1;
      return occurrences === 1;
    })
    .filter((sentence) => sentence.length > trimmedTerm.length)
    .sort((a, b) => a.length - b.length);

  const sentence = candidates.find((candidate) => candidate.length <= FILL_STEM_TARGET_MAX) ??
    candidates.find((candidate) => candidate.length <= FILL_STEM_HARD_MAX);
  if (sentence === undefined) return null;

  const stem = normalizeStem(sentence.replace(trimmedTerm, FILL_BLANK));
  const check = checkFillStem(stem, trimmedTerm);
  if (!check.ok) return null;
  return { stem, sentence };
}
