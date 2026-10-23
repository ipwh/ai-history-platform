/**
 * 選擇題「表面線索」的確定性診斷（Sprint 23）。
 *
 * 背景：Sprint 22 的唯讀審核證實，AI 生成的選擇題有可利用的表面線索。以本機
 * 2026-10-23 生產快照副本計算（1,210 條 `origin=material-ai` 四選一題目）：
 *
 *   - 正確選項「唯一最長」佔 59.8%，而匯入的學校試卷只有 15.5%；
 *   - 學生若一律選「唯一最長」的選項，命中率 72.5%（998 題可判斷，95% CI 69.7–75.2），
 *     基準應為 25%；學生實際收到的即時生成題更高達 84.3%；
 *   - 干擾項出現「一定／必然／完全／所有／永遠／必定／唯一」的比例遠高於正確答案
 *     （含絕對化用語的選項只有 6.3% 是正確答案，不含的則有 26.3%）。
 *
 * 這裡只做**診斷**：輸出可解釋的警告訊息，供教師在審核介面看到題目的風險，
 * 並供測試與離線評測量度。本模組：
 *
 *   - 不修改題目、選項、正確答案或解釋（純函式，輸入不被改動）；
 *   - 不判定題目對錯（長度只是風險訊號，不是歷史正確性的證據）；
 *   - 不要求所有選項等長（那會迫使模型刪去判斷所需的歷史資料）。
 *
 * 為甚麼不把「正確答案最長」當成阻擋條件：以 Sprint 22 的門檻敏感度計算，
 * 「正確項唯一最長」會標記 59.8% 的 AI 題目——那不是缺陷率，而是模型行文的自然
 * 結果；若以此阻擋發布，等於把大量可用的題目丟棄或迫使学生等待教師逐題處理。
 * 因此預設只發出 `warning`（不影響 `qualityOutcome`、不觸發重寫、不改變發布政策）。
 */
import type { QuestionType } from "../../lib/types";

/**
 * 長度度量（全站唯一）：移除所有空白後的 Unicode 字元數。
 * 中文漢字、英文字母、數字及全形標點各計 1；不使用 token 計數，避免與模型 tokenizer 混淆。
 */
export function optionTextLength(text: string | null | undefined): number {
  if (text === null || text === undefined) return 0;
  return [...String(text).replace(/\s+/gu, "")].length;
}

/**
 * 「正確選項比最長干擾項長多少倍」才算明顯不對稱。
 *
 * 1.5 的依據（本機快照，`origin=material-ai`，n=1,210）：以「正確項 ≥ 1.5 × 最長干擾項」
 * 計算會標記 13.7%（166 題），屬教師可在合理時間內處理的佇列；用 1.25 會標記 46%，
 * 用「唯一最長（任何差距）」則標記 59.8%——後兩者都失去篩選意義。
 */
export const LENGTH_ASYMMETRY_RATIO = 1.5;

/**
 * 另外要求「多出的字元數」達此下限，避免把「三字 vs 兩字」這類短選項的
 * 比例差異當成缺陷（短選項的比例放大沒有實質資訊量差異）。
 */
export const LENGTH_ASYMMETRY_MIN_DELTA = 4;

/** 少於或等於此長度且不含句中標點的選項，視為「短標籤」（名詞／年份／人名） */
export const SHORT_OPTION_MAX_LENGTH = 8;

/**
 * 絕對化用語。Sprint 22 量度顯示：AI 生成的干擾項用這些字眼的比率遠高於正確答案，
 * 學生可用「刪去絕對化選項」的方式作答，毋須讀懂歷史內容。
 */
export const ABSOLUTE_TERMS: readonly string[] = [
  "一定",
  "必然",
  "完全",
  "所有",
  "永遠",
  "必定",
  "唯一",
];

export type OptionQualityCode =
  | "option-length-asymmetry"
  | "option-form-mismatch"
  | "option-absolutist-distractor"
  | "option-duplicate";

/** 全部代碼（供審核腳本及測試列舉，避免字串散落各處） */
export const OPTION_QUALITY_CODES: readonly OptionQualityCode[] = [
  "option-length-asymmetry",
  "option-form-mismatch",
  "option-absolutist-distractor",
  "option-duplicate",
];

/**
 * 規則版本（Sprint 24）。
 *
 * 為甚麼需要版本：警告會寫進資料庫（`questions.quality_warnings_json`）及練習快照
 * （`practice_sessions.question_snapshot_json`）。若日後調整門檻（例如把長度比例由
 * 1.5 改為 1.4），沒有版本就無法分辨一條舊警告是哪一版規則產生的，也無法比較
 * 「改門檻前後的警告率」。版本只在使用這組規則時遞增，不影響題目內容或覆核。
 */
export const OPTION_QUALITY_RULE_VERSION = "option-quality/v1";

/** 警告文字末端的人機可讀標記，例如「（規則 option-quality/v1 · option-length-asymmetry）」 */
export function optionQualityWarningTag(code: OptionQualityCode): string {
  return `（規則 ${OPTION_QUALITY_RULE_VERSION} · ${code}）`;
}

function withTag(finding: OptionQualityFinding): OptionQualityFinding {
  return { code: finding.code, message: `${finding.message}${optionQualityWarningTag(finding.code)}` };
}

/**
 * 從一句已儲存的警告中取出規則代碼及版本。
 *
 * 只認得本模組自己加上去的標記；其他警告（例如「解釋太短」）回傳 null，
 * 因此呼叫端可以安全地把「表面線索警告」與其他品質警告分開統計或替換。
 */
export function parseOptionQualityWarning(
  text: string,
): { code: OptionQualityCode; version: string } | null {
  const match = /（規則 (option-quality\/v\d+) · ([a-z-]+)）\s*$/.exec(String(text ?? ""));
  if (match === null) return null;
  const code = match[2] as OptionQualityCode;
  if (!OPTION_QUALITY_CODES.includes(code)) return null;
  return { code, version: match[1] };
}

/** 這條警告是否由本模組（任何版本）產生 */
export function isOptionQualityWarning(text: string): boolean {
  return parseOptionQualityWarning(text) !== null;
}

export interface OptionQualityWarningSummary {
  /** 每個代碼的警告數（同一題可能有多個代碼） */
  byCode: Record<OptionQualityCode, number>;
  /** 規則版本分佈（用於發現新舊版本混用） */
  byVersion: Record<string, number>;
  /** 帶有至少一條本模組警告的題目數 */
  questionsFlagged: number;
  /** 總題目數（分母；呼叫端須自行確保是「可分析」的題目） */
  questionsTotal: number;
}

/**
 * 把一批題目的 `qualityWarnings` 匯總成可報告的統計。
 *
 * 只用於診斷及報告；**不**代表題目已通過歷史事實審核，亦**不**改變任何發布狀態。
 */
export function summariseOptionQualityWarnings(
  warningsPerQuestion: readonly (readonly string[])[],
): OptionQualityWarningSummary {
  const byCode = Object.fromEntries(
    OPTION_QUALITY_CODES.map((code) => [code, 0]),
  ) as Record<OptionQualityCode, number>;
  const byVersion: Record<string, number> = {};
  let questionsFlagged = 0;

  for (const warnings of warningsPerQuestion) {
    let flagged = false;
    for (const warning of warnings) {
      const parsed = parseOptionQualityWarning(warning);
      if (parsed === null) continue;
      flagged = true;
      byCode[parsed.code] += 1;
      byVersion[parsed.version] = (byVersion[parsed.version] ?? 0) + 1;
    }
    if (flagged) questionsFlagged += 1;
  }

  return {
    byCode,
    byVersion,
    questionsFlagged,
    questionsTotal: warningsPerQuestion.length,
  };
}

/**
 * 以「最新一次的診斷結果」取代舊的表面線索警告，同時保留其他品質警告。
 *
 * 用途：教師按「重新檢查」時，題目會依目前版本重新評估；若沿用舊的表面線索警告，
 * 統計就會混入已修正或已改變門檻的結果。其他警告（例如「解釋太短」）不會被移除。
 */
export function mergeOptionQualityWarnings(
  existing: readonly string[],
  nextOptionWarnings: readonly string[],
): string[] {
  return [...existing.filter((warning) => !isOptionQualityWarning(warning)), ...nextOptionWarnings];
}

export interface OptionQualityFinding {
  code: OptionQualityCode;
  /** 給教師看的白話說明；不得包含「答案錯誤」這類未經核實的結論 */
  message: string;
}

export interface OptionLengthMetrics {
  /** 各選項長度，次序與 `options` 相同 */
  lengths: number[];
  correctIndex: number;
  correctLength: number;
  longestDistractorLength: number;
  shortestDistractorLength: number;
  /** 正確項長度 ÷ 最長干擾項長度（干擾項長度為 0 時為 Infinity） */
  ratioToLongestDistractor: number;
  uniquelyLongest: boolean;
  uniquelyShortest: boolean;
}

export interface OptionQualityResult {
  /** 非選擇題，或選項結構無法分析（<2 個選項、找不到正確選項）時為 false */
  applicable: boolean;
  metrics: OptionLengthMetrics | null;
  findings: OptionQualityFinding[];
}

const EMPTY_RESULT: OptionQualityResult = { applicable: false, metrics: null, findings: [] };

/**
 * 句式判定：是否像一句完整說明（而非名詞短語）。
 *
 * 與 `question-quality.ts` 的 `isExplanatoryDefinition` 刻意採用同一標準
 * （句末標點，或有句中標點且長度 ≥10），但兩者不可互相 import——`question-quality.ts`
 * 會反過來呼叫本模組，互相 import 會形成循環依賴。`tests/option-quality.test.ts`
 * 以樣本表比對兩者結果一致，任何一方改動都會令該測試失敗。
 */
export function looksLikeStatement(text: string): boolean {
  const trimmed = text.trim();
  if (/[。！？；]/.test(trimmed)) return true;
  return /[，、]/.test(trimmed) && trimmed.length >= 10;
}

function isShortLabel(option: string): boolean {
  return optionTextLength(option) <= SHORT_OPTION_MAX_LENGTH && !looksLikeStatement(option);
}

function normalizeOption(text: string): string {
  return text
    .replace(/[\uff01-\uff5e]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, "")
    .replace(/[，。、；：？！「」『』（）()《》〈〉"'’‘“”,.;:!?\-—–~～…]/g, "")
    .toLowerCase();
}

/**
 * 分析一道選擇題的表面線索。
 *
 * 只回傳診斷結果，不會改動輸入（呼叫端可安全地在寫入前／後各呼叫一次比對）。
 */
export function analyseOptionQuality(input: {
  questionType: QuestionType;
  options: readonly string[];
  correctAnswer: string;
}): OptionQualityResult {
  if (input.questionType !== "mc") return EMPTY_RESULT;

  const options = input.options.map((option) => String(option));
  if (options.length < 2) return EMPTY_RESULT;

  const answer = String(input.correctAnswer ?? "").trim();
  let correctIndex = options.findIndex((option) => option.trim() === answer);
  if (correctIndex < 0) {
    const matches = options
      .map((option, index) => (normalizeOption(option) === normalizeOption(answer) ? index : -1))
      .filter((index) => index >= 0);
    if (matches.length !== 1) return EMPTY_RESULT;
    correctIndex = matches[0];
  }

  const lengths = options.map((option) => optionTextLength(option));
  const correctLength = lengths[correctIndex];
  const distractorLengths = lengths.filter((_unused, index) => index !== correctIndex);
  const longestDistractorLength = Math.max(...distractorLengths);
  const shortestDistractorLength = Math.min(...distractorLengths);
  const ratio =
    longestDistractorLength === 0 ? Number.POSITIVE_INFINITY : correctLength / longestDistractorLength;

  const metrics: OptionLengthMetrics = {
    lengths,
    correctIndex,
    correctLength,
    longestDistractorLength,
    shortestDistractorLength,
    ratioToLongestDistractor: ratio,
    uniquelyLongest: correctLength > longestDistractorLength,
    uniquelyShortest: correctLength < shortestDistractorLength,
  };

  const findings: OptionQualityFinding[] = [];
  const correctOption = options[correctIndex];
  const distractors = options.filter((_unused, index) => index !== correctIndex);

  if (
    metrics.uniquelyLongest &&
    ratio >= LENGTH_ASYMMETRY_RATIO &&
    correctLength - longestDistractorLength >= LENGTH_ASYMMETRY_MIN_DELTA
  ) {
    findings.push({
      code: "option-length-asymmetry",
      message:
        `正確選項（${correctLength} 字）明顯長於最長的錯誤選項（${longestDistractorLength} 字），` +
        "學生可能只憑「哪一項最長」作答而毋須讀題。請確認各選項的資訊量相若；" +
        "這只是可讀性提示，未經核實前不代表答案有問題，也不可因此改寫正確答案。",
    });
  }

  const correctIsStatement = looksLikeStatement(correctOption);
  const distractorStatements = distractors.filter((option) => looksLikeStatement(option)).length;
  const correctIsLabel = isShortLabel(correctOption);
  const shortLabels = distractors.filter((option) => isShortLabel(option)).length;
  if ((correctIsStatement && shortLabels === distractors.length) || (correctIsLabel && distractorStatements >= 2)) {
    findings.push({
      code: "option-form-mismatch",
      message:
        correctIsStatement
          ? "正確選項是完整說明句，但其餘選項全部是短詞／名詞短語；句式不一致會令正確答案在形式上過於突出。"
          : "正確選項只是短詞，但多個錯誤選項是完整說明句；句式不一致會令正確答案在形式上過於突出。",
    });
  }

  const absoluteInCorrect = ABSOLUTE_TERMS.some((term) => correctOption.includes(term));
  const absoluteDistractors = distractors.filter((option) =>
    ABSOLUTE_TERMS.some((term) => option.includes(term)),
  );
  if (absoluteDistractors.length > 0 && !absoluteInCorrect) {
    findings.push({
      code: "option-absolutist-distractor",
      message:
        `有 ${absoluteDistractors.length} 個錯誤選項使用絕對化用語（${ABSOLUTE_TERMS.join("、")}），` +
        "而正確答案沒有；學生可用「刪去絕對化選項」的方式作答。建議把錯誤選項改寫為同類而具體錯誤的史實。",
    });
  }

  const seen = new Map<string, number>();
  for (const [index, option] of options.entries()) {
    const key = normalizeOption(option);
    if (key.length === 0) continue;
    const first = seen.get(key);
    if (first !== undefined) {
      findings.push({
        code: "option-duplicate",
        message: `選項 ${first + 1} 與選項 ${index + 1} 正規化後相同，學生無法分辨；此題不應派給學生。`,
      });
      break;
    }
    seen.set(key, index);
  }

  // 每條訊息都加上「規則版本 · 代碼」標記，令寫入資料庫／快照後仍可追溯是哪一版
  // 規則、哪一項檢查產生的（見 parseOptionQualityWarning）。
  return { applicable: true, metrics, findings: findings.map(withTag) };
}
