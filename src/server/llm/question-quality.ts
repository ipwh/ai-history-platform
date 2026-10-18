/**
 * 題目品質閘門（Sprint 7.8）：檢查**完整題目**，而不是個別段落或孤立的答案字串。
 *
 * 為甚麼需要這一層：學生自學不再等待教師逐題預先批准，因此「機器可以判斷的品質問題」
 * 必須在生成階段就擋住。現有的 schema／教材依據核對只證明「欄位齊全、節錄出自教材」，
 * 不足以證明「這一題只有一個站得住的答案」——實際例子：學生回報的
 * 「「歐洲的中古時代結束，進入近代」是指以下哪一個詞語？」同時把**年份**（公元1453年）
 * 及**時期**（文藝復興期間）列為選項，而教材兩者都與中古時代的終結有關，學生無法判斷。
 *
 * 這裡只做**確定性**檢查（不呼叫 AI、不產生費用），並且每一項都必須有教材證據支持，
 * 不會因為「答案和某個選項同類」就一律丟棄（例如「年份 vs 時期」本身不是理由，
 * 要有教材同時把兩者連繫到同一件事才成立）。
 *
 * 回傳的 `blocking` 問題會令題目被丟棄（見 validation.ts）；`warning` 問題只記錄，
 * 交由教師覆核跟進。
 */
import type { QuestionType } from "../../lib/types";
import { normalizeForMatch, splitSentences } from "../materials/text-utils";
import {
  analyseMaterial,
  type MaterialAnalysis,
  type MaterialDimension,
  type MaterialLimitationCode,
} from "./material-analysis";
import type { MaterialUnit } from "./provider";

export type QualityIssueCode =
  | "ambiguous-options"
  | "option-overlap"
  | "option-kind-mismatch"
  | "stem-answer-type-mismatch"
  | "answer-in-stem"
  | "answer-not-in-material"
  | "explanation-unsupported"
  | "copied-source"
  /* Sprint 8.5：教學品質（語意閘門） */
  | "excessive-verbatim"
  | "mechanical-deletion"
  | "explanation-restates-answer"
  | "explanation-off-topic"
  | "answer-incomplete"
  | "dimension-unsupported"
  | "unsupported-causation"
  | "approximate-date-overprecision"
  | "asserted-inference"
  | "unsupported-evaluation";

export interface QualityIssue {
  code: QualityIssueCode;
  message: string;
  /**
   * blocking：結構上不可用，直接丟棄。
   * uncertain：**未確定**——無法確認答案依據或正確性，亦不足以直接丟棄（例如答案只是
   *   教材語句的改寫）。題目會保留在題庫，但自動發布被暫緩，等待教師確認
   *   （見 question-service 的三條發布路徑及 questions.teacher_confirmation_required）。
   * warning：不妨礙答案或教材依據的提示，可照常自動發布。
   */
  severity: "blocking" | "uncertain" | "warning";
}

/** 閘門結果是否含未確定項目（自動發布必須暫緩） */
export function hasUncertainIssue(issues: QualityIssue[]): boolean {
  return issues.some((issue) => issue.severity === "uncertain");
}

export interface QualityCandidate {
  questionType: QuestionType;
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  sourceExcerpt: string;
  sourceBlockIds: string[];
  gradingPoints?: string[];
}

export interface QualityResult {
  ok: boolean;
  issues: QualityIssue[];
  /**
   * 閘門判定（Sprint 8.5）。對應**既有機制**，不新增資料庫狀態：
   *   - `pass`：沒有 blocking，也沒有需要修訂的項目 → 照既有流程（自動驗證／教師覆核）。
   *     注意：`pass` **只代表這裡列出的自動檢查全部通過**（教材依據、答案一致性、
   *     抄錄幅度、解釋是否說明推理、教材是否支持題目要求的思考面向等）。
   *     它**不代表**史實正確、不代表符合課程要求、亦不代表教學價值已獲認可——
   *     那些判斷只能由歷史科教師作出（見 docs/teacher-review/README.md）。
   *   - `revise`：可修正的品質問題（例如解釋只是重複答案、題幹過度抄錄、短答題得分要點不足）
   *     或需要人工判斷的未確定項目 → 題目**不可自動發布**，保留待教師確認；
   *     生成流程可在**既有成本控制**下有限次重試（見 question-service）。
   *   - `reject`：結構性缺陷（多於一個站得住的答案、答案不見於教材等）→ 丟棄該題。
   */
  outcome: QualityOutcome;
}

export type QualityOutcome = "pass" | "revise" | "reject";

/**
 * 「可以由生成流程修正」的問題代碼：這些問題不需要教師作史實判斷，
 * 只要模型再寫一次（帶同修訂指示）即可改善，因此屬 `revise`。
 * 未確定（uncertain）項目一樣屬 `revise`：題目保留但暫緩自動發布，交教師確認。
 *
 * 注意：列在這裡只代表「系統可以再試一次」，不代表問題不重要，也不代表重寫後會有教師把關
 * ——重寫後仍不合格者一律保留為草稿交教師確認（見 question-service）。
 */
const REVISABLE_ISSUE_CODES: ReadonlySet<QualityIssueCode> = new Set<QualityIssueCode>([
  "excessive-verbatim",
  "mechanical-deletion",
  "explanation-restates-answer",
  "explanation-off-topic",
  "answer-incomplete",
]);

/** 由問題清單得出判定（blocking → reject；可修正或未確定 → revise；其餘 → pass） */
export function qualityOutcome(issues: QualityIssue[]): QualityOutcome {
  if (issues.some((issue) => issue.severity === "blocking")) return "reject";
  if (
    issues.some(
      (issue) => issue.severity === "uncertain" || REVISABLE_ISSUE_CODES.has(issue.code),
    )
  ) {
    return "revise";
  }
  return "pass";
}

/**
 * 這批問題是否屬「機器可以自行修正」的一類（生成流程可有限次重寫）。
 *
 * 只有這一類才會觸發重試；未確定（uncertain）項目需要教師作史實判斷，重試不會解決，
 * 因此不列入（題目會保留並暫緩自動發布，由教師處理）。
 */
/** 這批問題是否屬「機器可以自行修正」的一類（生成流程可有限次重寫）。 */
export function isMachineRevisable(issues: QualityIssue[]): boolean {
  if (issues.some((issue) => issue.severity === "blocking")) return false;
  return issues.filter(isMachineRevisableIssue).length > 0;
}

/**
 * 單一問題是否屬「生成流程可自行修正」的一類。
 *
 * 這一類問題（以及未確定項目）都令判定成為 `revise`：**機器檢查不可視為已解決**，
 * 因此也不能藉「重新驗證」清除教師確認的暫緩標記（見 question-service.revalidateQuestion）。
 */
export function isMachineRevisableIssue(issue: QualityIssue): boolean {
  return issue.severity !== "uncertain" && REVISABLE_ISSUE_CODES.has(issue.code);
}

/** 「詞語：說明」的冒號後是否為解釋句，而不是同級標題／名詞短語（見 mock-provider 的用法） */
export function isExplanatoryDefinition(text: string): boolean {
  const trimmed = text.trim();
  // 句末標點：明確的完整句子
  if (/[。！？；]/.test(trimmed)) return true;
  // 否則至少要像句子：有句中標點（逗號／頓號）而且不是兩三個字的名詞短語
  return /[，、]/.test(trimmed) && trimmed.length >= 10;
}

/** 年份／世紀等時間指稱（「公元1453年」、「十八世紀中葉」、「公元前」）：生成器與閘門共用同一把尺 */
export function isTimeDesignation(text: string): boolean {
  return /\d{3,4}\s*年|公元前|公元|世紀/.test(text);
}

/** 時期用語（「文藝復興期間」、「中古時代」、「十九世紀」等） */
function isPeriodLike(text: string): boolean {
  return isTimeDesignation(text) || /(期間|時代|時期|階段|年代|早期|中期|後期|前期)/.test(text);
}

/** 取正規化文字的所有 2 字元片段，用於判斷「兩段文字是否在講同一件事」 */
function bigrams(text: string): Set<string> {
  const normalized = normalizeForMatch(text);
  const grams = new Set<string>();
  for (let index = 0; index + 2 <= normalized.length; index += 1) {
    grams.add(normalized.slice(index, index + 2));
  }
  return grams;
}

function sharedBigrams(left: string, right: string): number {
  const leftGrams = bigrams(left);
  let shared = 0;
  for (const gram of bigrams(right)) {
    if (leftGrams.has(gram)) shared += 1;
  }
  return shared;
}

/** 同一份教材中「兩段文字在講同一件事」的門檻：至少兩個共用的二字片段 */
const SAME_SUBJECT_THRESHOLD = 2;

/**
 * 答案獲接納為「教材支持的改寫」所需的最低重疊率（與教材共用的二字片段比例）。
 *
 * 真實模型（DeepSeek 試點）寫選擇題時，正確選項往往是教材語句的改寫而不是原文，
 * 逐字比對會令 9 格選擇題中有 6 格被丟棄。試點量測：合格改寫的重疊率為 0.67–0.95，
 * 杜撰選項（「條約內容使各國經濟繁榮，並促成永久和平」）為 0.41–0.64，故取 0.6。
 *
 * 2026-10-18 放寬（擁有者指示）：達門檻的改寫**不再暫緩自動發布**，只記錄警告；
 * 門檻本身維持 0.6，因為試點量測顯示杜撰選項落在 0.41–0.64，調低會令杜撰答案過關。
 */
const PARAPHRASE_MIN_COVERAGE = 0.6;
/** 只有完整句子的答案才可用改寫方式支持；短答案（詞語）必須逐字見於教材 */
const PARAPHRASE_MIN_LENGTH = 8;

/** 文字與教材共用的二字片段比例 */
function bigramCoverage(text: string, haystack: string): number {
  const grams = bigrams(text);
  if (grams.size === 0) return 0;
  let shared = 0;
  for (const gram of grams) {
    if (haystack.includes(gram)) shared += 1;
  }
  return shared / grams.size;
}

/**
 * 兩段文字的**對稱**重疊：共用片段 ÷ 較短一方的片段數。
 *
 * `bigramCoverage` 只量度「第一段有多少比例見於第二段」，長句對短句時會低估
 * （例如解釋比教材句子更長）。判斷「解釋是否在講教材同一件事」時，短的一方
 * 才是關鍵，因此用這一條。
 */
function bigramOverlapRatio(left: string, right: string): { shared: number; ratio: number } {
  const leftGrams = bigrams(left);
  const rightGrams = bigrams(right);
  const smaller = leftGrams.size <= rightGrams.size ? leftGrams : rightGrams;
  const larger = smaller === leftGrams ? right : left;
  if (smaller.size === 0) return { shared: 0, ratio: 0 };
  let shared = 0;
  for (const gram of smaller) {
    if (larger.includes(gram)) shared += 1;
  }
  return { shared, ratio: shared / smaller.size };
}

/** 答案中的具體事實標記（年份、數字、書名號標題）：未見於教材時不可當作改寫 */
function unsupportedFactTokens(text: string, materialText: string): string[] {
  const tokens = new Set<string>();
  for (const match of text.matchAll(/《[^《》]{1,30}》|\d{2,4}\s*年|公元前|\d+/g)) {
    const token = normalizeForMatch(match[0]);
    if (token.length > 0 && !materialText.includes(token)) tokens.add(match[0].trim());
  }
  return [...tokens];
}

/**
 * 答案是否可視為「教材支持的改寫」（非逐字引用）。
 *
 * 三項條件同時成立才接納，任何一項不成立即維持原本的丟棄行為（fail-closed）：
 *   1. 只有完整句子的答案才適用：短答案（詞語）仍必須逐字見於教材；
 *   2. 答案不可帶有教材沒有的具體事實標記（年份、數字、《》標題）；
 *   3. 與教材的二字片段重疊率達 `PARAPHRASE_MIN_COVERAGE`。
 *
 * 選擇題與填充題共用同一把尺（填充題的長答案同樣可能是教材句子的改寫）。
 */
function paraphraseSupport(
  questionType: string,
  normalizedKey: string,
  rawKey: string,
  materialText: string,
  excerptText: string,
): { coverage: number } | null {
  if (questionType !== "mc" && questionType !== "fill") return null;
  if (normalizedKey.length < PARAPHRASE_MIN_LENGTH) return null;
  if (unsupportedFactTokens(rawKey, materialText).length > 0) return null;
  const coverage = Math.max(
    bigramCoverage(normalizedKey, materialText),
    bigramCoverage(normalizedKey, excerptText),
  );
  return coverage >= PARAPHRASE_MIN_COVERAGE ? { coverage } : null;
}

/**
 * 答案是否獲教材支持（逐字或可接受的改寫）。
 *
 * 供「填充題的空格必須對應答案」等下游檢查共用同一把尺，避免品質閘門接受改寫、
 * 而下一步又用逐字比對把它丟棄（兩套標準會令可用的題目白白流失）。
 */
export function answerSupportedByMaterial(answer: string, materialText: string): boolean {
  const key = normalizeForMatch(answer);
  const material = normalizeForMatch(materialText);
  if (key.length === 0 || material.length === 0) return false;
  if (material.includes(key)) return true;
  return (
    key.length >= PARAPHRASE_MIN_LENGTH &&
    bigramCoverage(key, material) >= PARAPHRASE_MIN_COVERAGE
  );
}

/** 題幹中引號內的詞語／定義（「…」），沒有引號時退回整條題幹 */
export function stemEvidenceText(question: string): string {
  const match = /「([^」]{2,})」/.exec(question);
  return match ? match[1] : question;
}

/**
 * 去掉只作修飾用的時期／範圍字眼，用於判斷兩個選項是否其實是同一個答案。
 * 例如「文藝復興」與「文藝復興時期」對學生而言是同一個答案。
 */
const OPTION_MODIFIERS = ["期間", "時期", "時代", "階段", "年代", "前夕", "之前", "前後", "的"];
function stripModifiers(text: string): string {
  let result = text.trim();
  for (const modifier of OPTION_MODIFIERS) {
    result = result.split(modifier).join("");
  }
  return result;
}

/**
 * 題目是否只是抄錄教材原文（沒有構成可作答的問題）。
 * 挖空式題目（＿＿＿）本身就是由教材句子改寫而成，不屬此類。
 *
 * 比對用的是**文字重疊率**（二字片段），只反映用字相似程度，不是正確性或教學價值的評分。
 */
function copiedSourceReason(candidate: QualityCandidate): string | null {
  if (/[＿_]{2,}/.test(candidate.question)) return null;
  const normalizedStem = normalizeForMatch(candidate.question);
  const normalizedExcerpt = normalizeForMatch(candidate.sourceExcerpt);
  if (normalizedStem.length >= 10 && normalizedStem === normalizedExcerpt) {
    return "題幹只是抄錄教材原文，沒有構成可作答的問題";
  }
  return null;
}

function truncateForMessage(text: string): string {
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

/**
 * 移除教材一側的括號附註（「第二次世界大戰（二戰）」→「第二次世界大戰」）。
 *
 * 真實模型第 2 輪試點：完全正確的答案因教材以（二戰）／（一戰）附註簡稱而被判為
 * 「非逐字依據」而暫緩。比對時忽略教材的附註寫法，但**不**忽略答案自行添加的內容，
 * 因此答案多加的資料仍然必須見於教材。
 */
function stripParentheticals(text: string): string {
  return text.replace(/[（(][^）)]{1,20}[）)]/g, "");
}

function questionLines(units: MaterialUnit[]): string[] {
  return units.flatMap((unit) => {
    const sentences = splitSentences(unit.text);
    return sentences.length > 0 ? sentences : [unit.text];
  });
}

/** 教材中有沒有出現這個選項文字（整句計） */
function materialMentions(lines: string[], text: string): string[] {
  const key = normalizeForMatch(text);
  if (key.length === 0) return [];
  return lines.filter((line) => normalizeForMatch(line).includes(key));
}

/**
 * 選擇題是否有多於一個站得住的答案。
 *
 * 三種獨立證據，任何一種成立即屬「有多個可辯解的答案」：
 *   1. 同一段教材把**另一個選項**連繫到題幹所講的同一件事（例如教材同時以年份及
 *      時期說明中古時代的終結）。
 *   2. 題幹是「挖空」式選擇題，而某個錯誤選項本身也見於該題引用的教材節錄
 *      （即同一個空可以填兩個選項）。
 *   3. 兩個選項互相包含或只差無意義的修飾語（等同選項）。
 */
interface AmbiguityCheck {
  /** 有值＝答案不唯一（丟棄題目） */
  blocking: string | null;
  /** 其他選項寫得不夠好的提示（只記錄，交教師核對） */
  warnings: string[];
}

function ambiguousOptionReason(
  candidate: QualityCandidate,
  units: MaterialUnit[],
): AmbiguityCheck {
  const warnings: string[] = [];
  const options = candidate.options.map((option) => option.trim()).filter((option) => option.length > 0);
  if (options.length < 2) return { blocking: null, warnings };
  const key = candidate.correctAnswer.trim();
  const others = options.filter((option) => normalizeForMatch(option) !== normalizeForMatch(key));
  if (others.length === 0) return { blocking: null, warnings };

  // 3. 選項互相包含：只差修飾語（「文藝復興」／「文藝復興時期」）等於同一個答案 → 丟棄；
  //    其他包含情況（「馬丁路德」／「馬丁路德與加爾文」）只是選項寫得不好，
  //    現有做法是提出品質警告交教師核對，這裡維持不變。
  for (const option of others) {
    if (!option.includes(key) && !key.includes(option)) continue;
    if (normalizeForMatch(stripModifiers(option)) === normalizeForMatch(stripModifiers(key))) {
      return {
        blocking: `選項「${option}」與標準答案「${key}」只差修飾語，等於同一個答案`,
        warnings,
      };
    }
    warnings.push(`選項「${option}」包含標準答案「${key}」，請核對是否同樣說得通`);
  }

  const evidence = stemEvidenceText(candidate.question);
  const lines = questionLines(units);

  // 2. 挖空式選擇題：錯誤選項也見於本題引用的教材節錄
  const blankStyle = /[＿_]{2,}/.test(candidate.question);
  if (blankStyle) {
    const excerpt = normalizeForMatch(candidate.sourceExcerpt);
    for (const option of others) {
      const normalized = normalizeForMatch(option);
      if (normalized.length >= 2 && excerpt.includes(normalized)) {
        return {
          blocking: `題幹挖空處在引用教材中也可以填「${option}」，答案並非唯一`,
          warnings,
        };
      }
    }
  }

  // 1. 同一段教材把另一個選項連繫到題幹所講的同一件事——但只在「一個是日期／世紀，
  //    另一個是時期用語」時才屬歧義：教材同時以年份與時期說明同一件事時，學生無法判斷
  //    要答日期還是時期（例如中古時代的終結既是公元1453年，也是「文藝復興期間」）。
  //    兩個同類的年份（十八世紀中葉／十九世紀初）不屬此類：教材各自的定義句已經把它們分開。
  //    挖空題另有第 2 項判定；生命年份之類的短題幹不會套用。
  if (isPeriodLike(key) && !blankStyle && normalizeForMatch(evidence).length >= 8) {
    const keyIsYear = isTimeDesignation(key);
    for (const option of others) {
      if (!isPeriodLike(option)) continue;
      const optionIsYear = isTimeDesignation(option);
      const dateVersusPeriod = keyIsYear !== optionIsYear;
      if (!dateVersusPeriod) continue;
      const mentioning = materialMentions(lines, option);
      const linked = mentioning.find(
        (line) => sharedBigrams(line, evidence) >= SAME_SUBJECT_THRESHOLD,
      );
      if (linked !== undefined) {
        return {
          blocking: `教材在講同一件事時同時以年份及時期（「${option}」）說明，答案不是唯一`,
          warnings,
        };
      }
    }
  }

  return { blocking: null, warnings };
}

/** 題幹問「說明」時，每個選項都必須是說明句；問「詞語」時，選項不可長如段落 */
function optionKindReason(candidate: QualityCandidate): string | null {
  if (candidate.questionType !== "mc") return null;
  const options = candidate.options.filter((option) => option.trim().length > 0);
  if (options.length === 0) return null;

  if (/的說明？?$/.test(candidate.question.trim())) {
    const label = options.find((option) => !isExplanatoryDefinition(option));
    if (label !== undefined) {
      return `題幹問「說明」，但選項「${label}」只是標題或名詞短語，學生無從判斷哪一項才算說明`;
    }
  }
  if (/是指(以下)?哪一個詞語？?$/.test(candidate.question.trim())) {
    const statement = options.find((option) => isExplanatoryDefinition(option) && option.length > 40);
    if (statement !== undefined) {
      return `題幹問「哪一個詞語」，但選項「${statement.slice(0, 20)}…」是一整句說明`;
    }
  }
  return null;
}

/**
 * 題幹要求的答案類型與標準答案是否相符。
 *
 * 學生（尤其照字面理解題目的學生）會依題幹作答：「是指以下哪一個詞語？」要求一個**詞語**，
 * 若標準答案是一個**年份**（例如「公元1453年」），題目本身已經問錯——這與答案是否見於教材無關。
 * 反向亦然：題幹問「哪一年」而答案是時期／事件名稱。
 *
 * 這是確定性的字面檢查（2026-10-16 學生模擬審計確認的缺陷）：
 * 只靠「多個答案都成立」的檢查不足，因為類型不符的題目可能剛好沒有其他可辯解的選項。
 */
function stemAnswerTypeReason(candidate: QualityCandidate): string | null {
  const stem = candidate.question.trim();
  const key = candidate.correctAnswer.trim();
  if (key.length === 0) return null;

  const asksForTerm = /(?:哪一個|哪個|哪一種|那一個)?詞語/.test(stem) && stem.includes("詞語");
  const asksForYear = /(?:哪一年|哪個年份|哪一個年份|甚麼年份|什麼年份|何年)/.test(stem);

  if (asksForTerm && isTimeDesignation(key)) {
    return `題幹問「哪一個詞語」，但標準答案「${key}」是一個年份；應改寫成明確問年份的題目（或改問對應的歷史詞語）`;
  }
  if (asksForYear && !isTimeDesignation(key) && isPeriodLike(key)) {
    return `題幹問「哪一年」，但標準答案「${key}」是一個時期而非年份`;
  }
  return null;
}

/** 數字用字（用於判斷答案是否只是「更長數字」的一部分） */
const NUMERAL_CHARS = /[0-9一二三四五六七八九十百千萬億兆兩零〇廿]/;

/**
 * 題幹本身是否已包含標準答案（洩露答案）。
 *
 * Sprint 8.6（真實題目校準發現的誤報）：填充題的答案若只是題幹中**另一個數字**的一部分，
 * 不屬洩露。例如題幹「……由1941年約一百六十多萬人銳減至1945年約多少萬人？」的答案是
 * 「六十多萬人」：字面上「六十多萬人」出現在「一百六十多萬人」之內，但兩者是不同的數目，
 * 學生不能因此抄到答案。因此每一次出現都要檢查前一個字是否為數字用字。
 */
function answerLeakReason(candidate: QualityCandidate): string | null {
  const key = normalizeForMatch(candidate.correctAnswer);
  if (key.length < 2) return null;
  const stem = normalizeForMatch(candidate.question);
  if (!stem.includes(key)) return null;
  // 題幹以「引號引述定義，再問是哪一個詞語」是正常問法：答案在題幹中只是引述內容
  const evidence = normalizeForMatch(stemEvidenceText(candidate.question));
  const quoted = /「[^」]{2,}」/.test(candidate.question);
  if (quoted && evidence.includes(key) && /是指/.test(candidate.question)) return null;

  let index = stem.indexOf(key);
  let genuineLeak = false;
  while (index !== -1) {
    const preceding = index > 0 ? stem[index - 1]! : "";
    // 前一個字是數字用字 → 這次出現屬於更長的數字（例如「一百六十多萬人」），不是洩露
    if (preceding === "" || !NUMERAL_CHARS.test(preceding)) {
      genuineLeak = true;
      break;
    }
    index = stem.indexOf(key, index + 1);
  }
  if (!genuineLeak) return null;
  return `題幹已出現標準答案「${candidate.correctAnswer}」`;
}

/* ------------------------------------------------------------------ */
/* Sprint 8.5：教學品質（語意）檢查                                     */
/* ------------------------------------------------------------------ */

/** 題幹是否與教材某一句高度重疊（表格列／句子為單位） */
function highOverlapSentence(
  candidate: QualityCandidate,
  units: MaterialUnit[],
): { sentence: string; coverage: number } | null {
  const stem = normalizeForMatch(candidate.question);
  if (stem.length < 10) return null;
  let best: { sentence: string; coverage: number } | null = null;
  for (const sentence of questionLines(units)) {
    const normalized = normalizeForMatch(sentence);
    if (normalized.length === 0) continue;
    if (!normalized.includes(stem) && !stem.includes(normalized)) continue;
    const coverage = bigramCoverage(candidate.question, sentence);
    if (best === null || coverage > best.coverage) best = { sentence, coverage };
  }
  return best;
}

/**
 * 過度抄錄：題幹與教材某一句高度重疊（≥ 0.9）而**沒有加上提問的框架**。
 *
 * 為甚麼不是 blocking：題目使用教材的關鍵詞語、專有名詞、年份或短引文是必要的，
 * 而且高重疊本身不等於教學價值低（例如教材的定義句就是最精確的表述）。
 * 這裡只提出提示交由教師／修訂流程跟進，不會把題目當成無效
 * （分工：整句完全相同＝沒有構成可作答的問題，由既有 `copied-source` 擋下）。
 *
 * 挖空式題目（填充題）**不適用**：平台的填充題本來就以教材句子為本，
 * 並已由既有規則約束（剛好一個空格、答案必須是歷史元素、不可在題幹重現、長度上限）。
 */
function excessiveVerbatimReason(
  candidate: QualityCandidate,
  units: MaterialUnit[],
): string | null {
  if (/[＿_]{2,}/.test(candidate.question)) return null;
  if (candidate.questionType === "fill") return null;
  const overlap = highOverlapSentence(candidate, units);
  if (overlap === null || overlap.coverage < 0.9) return null;
  // 題幹加上自己的提問框架（例如「試比較」、「為甚麼」、「哪一項」）即不算純抄錄
  if (
    /(試說明|試比較|試舉例|試述|試析|為甚麼|為什麼|何以見得|哪一項|哪一個|哪一年|以下哪|有何|有甚麼|如何)/.test(
      candidate.question,
    )
  ) {
    return null;
  }
  return `題幹與教材原文高度重疊（${Math.round(overlap.coverage * 100)}%）：「${truncateForMessage(overlap.sentence)}」；請確認題目是否只是抄錄教材句子而非考核歷史理解`;
}

/**
 * 挖空式題目：空格以外的線索太少，學生無從判斷答案。
 *
 * 只針對「只有空格、沒有情境」的題目（例如整條題幹只有一個空格）；
 * 一般填充題（空格前後有教材脈絡）不受影響。
 */
function thinContextFillReason(candidate: QualityCandidate): string | null {
  if (candidate.questionType !== "fill") return null;
  if (!/[＿_]{2,}/.test(candidate.question)) return null;
  const withoutBlank = normalizeForMatch(candidate.question.replace(/[＿_]{2,}/g, ""));
  if (withoutBlank.length >= 8) return null;
  return "題幹除了空格以外沒有足夠線索，學生無從由教材判斷答案；請把情境寫進題幹";
}

/** 解釋與節錄比對的長度下限（太短的解釋由既有的「解釋太短」處理） */
const MIN_EXPLANATION_COPY_LENGTH = 12;

/**
 * 生成器常在解釋前加上來源標籤（「教材原文：」、「課文引文：」）。這些標籤本身沒有
 * 解釋作用，但會令抄錄的字面重疊率略低於門檻（第 2 輪試點觀察到「教材原文：＋整句節錄」
 * 因此逃過檢查），所以比較前先移除標籤，令判定看實際內容。
 */
const SOURCE_LABEL_PREFIX = /^(?:教材|課文|原文|引文|節錄|資料)(?:原文|內容|出處)?\s*[:：]\s*/;

/**
 * 解釋是否只重複答案或抄錄教材原文，沒有說明「為甚麼」。
 *
 * 學生看解釋是為了理解推理，因此「解釋＝答案」或「解釋＝教材原文（例如加上『教材原文：』）」
 * 屬可修正的品質問題：生成流程可以重寫；未修正前不應自動發布（見 QualityOutcome.revise）。
 */
function explanationRestatesReason(
  candidate: QualityCandidate,
  units: MaterialUnit[],
): string | null {
  const explanation = candidate.explanation.trim();
  if (explanation.length === 0) return null; // 空解釋由既有檢查處理
  const body = explanation.replace(SOURCE_LABEL_PREFIX, "").trim();
  const normalizedExplanation = normalizeForMatch(body);
  if (normalizedExplanation.length < 4) return null;
  const normalizedAnswer = normalizeForMatch(candidate.correctAnswer);
  if (normalizedAnswer.length >= 2 && normalizedExplanation === normalizedAnswer) {
    return "解釋只是重複標準答案，沒有說明理由";
  }
  if (
    normalizedExplanation.length >= MIN_EXPLANATION_COPY_LENGTH &&
    bigramCoverage(body, candidate.sourceExcerpt) >= 0.95
  ) {
    return "解釋只是抄錄教材節錄，沒有說明答案與教材的關係";
  }
  if (
    normalizedExplanation.length >= MIN_EXPLANATION_COPY_LENGTH &&
    bigramCoverage(body, candidate.question) >= 0.95
  ) {
    return "解釋與題幹幾乎相同，沒有說明為甚麼這是答案";
  }
  void units;
  return null;
}

/** 題幹明確要求的思考面向（只在教材完全沒有相應內容時才提出） */
const DIMENSION_DEMANDS: { dimension: MaterialDimension; pattern: RegExp; label: string }[] = [
  {
    dimension: "comparison",
    pattern: /(試比較|比較|相比|有何異同|有甚麼異同|不同之處|相同之處)/,
    label: "比較",
  },
  {
    dimension: "cause-consequence",
    pattern: /(為甚麼|為什麼|原因|成因|導致|引致|造成|促成|有何影響|有甚麼影響|影響是)/,
    label: "因果",
  },
  {
    dimension: "change-continuity",
    pattern: /(有何轉變|有甚麼轉變|有甚麼變化|轉變為|演變為)/,
    label: "轉變",
  },
  {
    dimension: "chronology",
    // 只有**明確要求排序／先後次序**的寫法才算時序考核：「最早」通常修飾地點或行為者
    // （「工業革命最早在英國展開」），並非要求學生排列事件，因此不列入。
    pattern: /(先後次序|先後順序|時間順序|排序|何者較早|何者較遲|哪一項較早|哪一項較遲|較早發生|較遲發生)/,
    label: "時序",
  },
];

/**
 * 題幹要求的思考面向是否真的由教材支持（語意閘門的核心）。
 *
 * 教材只交代一件事件時，不可能出比較兩件事的題目；教材沒有交代因果時，
 * 「為甚麼」的題目只能靠學生自行推論。定義方式：題幹出現該面向的提問用語，
 * 但**整份提供的教材**都沒有相應內容（見 material-analysis.ts 的 dimensions）→ 未確定，
 * 交教師確認（不直接丟棄：提問用語的判讀可能有誤，而且題目仍可能由教師判定為可用）。
 */
function unsupportedDimensionReason(
  candidate: QualityCandidate,
  analysis: MaterialAnalysis,
): string | null {
  for (const demand of DIMENSION_DEMANDS) {
    if (!demand.pattern.test(candidate.question)) continue;
    if (analysis.hasDimensionInBlocks(demand.dimension, candidate.sourceBlockIds)) continue;
    if (analysis.dimensions[demand.dimension]) continue;
    const limitation = analysis.limitations.find((item) => item.code === LIMITATION_FOR_DIMENSION[demand.dimension]);
    return (
      `題目要求「${demand.label}」的思考，但教材沒有提供相應內容` +
      (limitation ? `（${limitation.message}）` : "") +
      "；請改為考核教材明確交代的內容"
    );
  }
  return null;
}

const LIMITATION_FOR_DIMENSION: Record<MaterialDimension, MaterialLimitationCode> = {
  comparison: "no-comparison-material",
  "cause-consequence": "no-causal-relation",
  "change-continuity": "no-change-relation",
  chronology: "no-dated-events",
  significance: "no-significance-statement",
};

/**
 * 題目／答案／解釋是否有**斷言因果**的寫法。
 *
 * 「教材只交代時序或相關性，題目卻寫成因果」是最常見的歷史思維錯誤之一：
 * 教材先講 A 再講 B，不等於 A 導致 B。這裡只偵測字面的因果連接詞；
 * 如果教材完全沒有因果標記（見 material-analysis.ts 的 dimensions），
 * 那麼題目中的因果斷言就是**推論**而非教材交代的內容 → 未確定，交教師確認。
 *
 * 為甚麼不是 blocking：因果連接詞的判讀（例如「因為」出現在解釋的推理句）
 * 有誤判可能，而且教材沒有因果標記不等於答案一定錯；交教師確認比直接丟棄安全。
 */
const CAUSAL_ASSERTION_PATTERN =
  /(導致|引致|促成|引發|觸發|造成|帶來|因而|因此|所以|由於|因為|源於|歸因|使得|令到|使到|結果是|埋下)/;

/** 指向題目本身的用語：這些子句是解題語，不是歷史因果斷言 */
const ANSWER_META_PATTERN = /(答案|本題|這題|題目|題幹|選項|得分要點)/;

/**
 * 在文字中找出**歷史因果斷言**的標記，找不到時回 null。
 *
 * 逐個子句檢查，並略過提到「答案／本題／選項」的子句：生成器常以
 * 「……因此答案是 X」的句式收結，句中的「因此」是解題語，不是「A 導致 B」的歷史斷言。
 */
function causalAssertionMarker(text: string): string | null {
  for (const clause of text.split(/[。；，,、！？!?：:]/)) {
    if (ANSWER_META_PATTERN.test(clause)) continue;
    const match = CAUSAL_ASSERTION_PATTERN.exec(clause);
    if (match) return match[0];
  }
  return null;
}

function unsupportedCausationReason(
  candidate: QualityCandidate,
  analysis: MaterialAnalysis,
): string | null {
  const fields = [candidate.question, candidate.correctAnswer, candidate.explanation];
  const markers = fields.map((field) => causalAssertionMarker(field)).filter((marker) => marker !== null);
  if (markers.length === 0) return null;
  if (analysis.hasDimensionInBlocks("cause-consequence", candidate.sourceBlockIds)) return null;
  if (analysis.dimensions["cause-consequence"]) return null;
  const limitation = analysis.limitations.find((item) => item.code === "no-causal-relation");
  return (
    `題目或答案以因果寫法（「${markers[0]}」）連結兩件事，但教材沒有交代它們的因果關係` +
    (limitation ? `（${limitation.message}）` : "") +
    "；教材只是先後提及或並列兩件事時，不可寫成因果，請改為考核教材明確交代的內容"
  );
}

/** 題幹是否要求學生答出**準確年份** */
const EXACT_YEAR_DEMAND_PATTERN = /(哪一年|哪年|於哪一年|在何年|年份是|哪個年份|年代是哪一年)/;

/**
 * 教材只寫「十八世紀」或「約公元前3,200年」時，不可要求學生答出準確年份。
 *
 * 這是「不要用系統自己的換算代替教材」的具體檢查：`MaterialPeriod` 刻意不把世紀
 * 轉成單一年份（見 material-analysis.ts），因此這裡直接查引用段落有沒有明確年份。
 */
function approximateDateOverprecisionReason(
  candidate: QualityCandidate,
  analysis: MaterialAnalysis,
): string | null {
  if (!EXACT_YEAR_DEMAND_PATTERN.test(candidate.question)) return null;
  if (analysis.hasExactYearInBlocks(candidate.sourceBlockIds)) return null;
  const approximate = analysis.events
    .filter(
      (event) =>
        !event.period.exact &&
        (candidate.sourceBlockIds.length === 0 || candidate.sourceBlockIds.includes(event.evidence.blockId)),
    )
    .slice(0, 3)
    .map((event) => event.time);
  return (
    "題目要求學生答出準確年份，但教材只交代" +
    (approximate.length > 0 ? `「${approximate.join("」「")}」等` : "世紀或約數") +
    "，沒有明確年份；請改為考核教材寫出的時間範圍，不要要求學生推算出年份"
  );
}

/**
 * 解釋是否只是把教材的**推測語氣**當成事實（教材說「可能／相信」，解釋說「就是」）。
 *
 * 只在使用同一批字詞時才提出（二字片段重疊率 ≥ 0.5，且至少共用 4 個片段），避免誤判。
 *
 * 界線：只認明確的推測語（可能／或許／似乎／大概／相信／估計／一說）。
 * 教材寫「學者認為……」屬**歸屬**（把說法歸於某人）而不是推測語，語氣拿捏需要教師判斷，
 * 因此不在此檢查之內（見 README「哪些判斷仍屬人工」）。
 */
const HEDGE_WORDS = ["可能", "或許", "似乎", "大概", "相信", "估計", "一說"];

function assertedInferenceReason(
  candidate: QualityCandidate,
  analysis: MaterialAnalysis,
): { reason: string; statement: string } | null {
  const explanation = candidate.explanation.trim();
  if (explanation.length < MIN_EXPLANATION_COPY_LENGTH) return null;
  if (HEDGE_WORDS.some((word) => explanation.includes(word))) return null;
  for (const claim of analysis.claims) {
    if (claim.kind !== "inference") continue;
    if (normalizeForMatch(claim.statement).length < 12) continue;
    if (!HEDGE_WORDS.some((marker) => claim.statement.includes(marker))) continue;
    // 去掉推測語氣後再比對：解釋若在講教材同一件事，就屬「把推測寫成事實」
    const asserted = HEDGE_WORDS.reduce((text, marker) => text.split(marker).join(""), claim.statement).replace(
      /[，,。；;、]/g,
      "",
    );
    const overlap = bigramOverlapRatio(explanation, asserted);
    if (overlap.shared < 4 || overlap.ratio < 0.5) continue;
    return {
      reason:
        `教材只以推測語氣交代這段內容（「${truncateForMessage(claim.statement)}」），` +
        "但解釋把它寫成確定的史實；請保留教材的語氣，或改為考核教材明確交代的內容",
      statement: claim.statement,
    };
  }
  return null;
}

/**
 * 解釋是否答非所問（與題幹、答案及節錄都沒有共同的重要詞語）。
 *
 * 只提出提示（warning）：這是粗疏的檢查，目的是攔住明顯貼錯段的解釋，
 * 而不是判斷解釋是否教得好（那需要人）。
 */
function explanationOffTopicReason(candidate: QualityCandidate): string | null {
  const explanation = candidate.explanation.trim();
  const normalized = normalizeForMatch(explanation);
  if (normalized.length < MIN_EXPLANATION_COPY_LENGTH) return null;
  const references = [candidate.question, candidate.correctAnswer, candidate.sourceExcerpt];
  const shared = references.some((reference) => bigramCoverage(explanation, reference) > 0);
  if (shared) return null;
  return "解釋與題幹、答案及教材節錄都沒有共同的用語，可能是答非所問或貼錯了內容；請核對解釋是否回應本題";
}

/**
 * 題目／答案是否作了教材沒有支持的**評價或排他**斷言（「最重要」「唯一」「最早」）。
 *
 * 這類斷言是歷史科常見的難點：學生被問「哪一項最重要」，但教材只並列了幾項因素，
 * 沒有交代輕重。系統不能替教材下判斷，因此只在教材**完全沒有**同一說法時提出，
 * 並交教師確認（可能是教師認為教材已足夠支持，只因用字不同）。
 *
 * 同義寫法視為同一判斷：「最早」接受教材的「率先／首先／最先」，
 * 否則教材寫「工業革命率先在英國展開」時，題目寫「最早在英國展開」會被誤判。
 */
const EVALUATION_CLAIMS: { term: string; supportedBy: string[] }[] = [
  { term: "最重要", supportedBy: ["最重要", "最主要", "最關鍵", "首要", "關鍵", "決定性"] },
  { term: "最主要", supportedBy: ["最主要", "最重要", "首要", "關鍵"] },
  { term: "最關鍵", supportedBy: ["最關鍵", "最重要", "關鍵", "決定性"] },
  { term: "最決定性", supportedBy: ["最決定性", "決定性", "最關鍵", "最重要"] },
  { term: "最嚴重", supportedBy: ["最嚴重", "嚴重", "慘重"] },
  { term: "規模最大", supportedBy: ["規模最大", "最大", "最多"] },
  { term: "最大", supportedBy: ["最大", "最多", "規模最大"] },
  { term: "唯一", supportedBy: ["唯一", "僅有", "只有"] },
  { term: "最早", supportedBy: ["最早", "率先", "首先", "最先", "首次", "首個"] },
  { term: "最晚", supportedBy: ["最晚", "最後", "末期", "晚期"] },
  { term: "首先", supportedBy: ["首先", "率先", "最早", "最先"] },
  { term: "決定性", supportedBy: ["決定性", "關鍵", "最重要"] },
];

function unsupportedEvaluationReason(
  candidate: QualityCandidate,
  units: MaterialUnit[],
): string | null {
  // 判斷範圍是**整批提供的教材**：題幹可以用自己的文字交代背景（例如「文藝復興首先在
  // 意大利半島興起」），該說法只要在教材任何一處出現，就不是系統或學生自行添加的判斷。
  // （Sprint 8.6 以真實題目校準後調整：只看引用段落會把「題幹背景句取自另一段」誤判。）
  const material = normalizeForMatch(units.map((unit) => unit.text).join("\n"));
  const fields: [string, string][] = [
    ["題目", candidate.question],
    ["標準答案", candidate.correctAnswer],
    ["解釋", candidate.explanation],
  ];
  for (const [label, field] of fields) {
    const used = EVALUATION_CLAIMS.find(
      (claim) =>
        field.includes(claim.term) &&
        !claim.supportedBy.some((alternative) => material.includes(normalizeForMatch(alternative))),
    );
    if (used !== undefined) {
      return (
        `${label}用了「${used.term}」這種比較或排他寫法，但所引用的教材段落沒有交代這項判斷；` +
        "教材只是並列幾項資料時，不可由系統或學生代為判斷哪一項最重要或最早，" +
        "請改為考核教材明確交代的內容"
      );
    }
  }
  return null;
}

export function checkQuestionQuality(
  candidate: QualityCandidate,
  units: MaterialUnit[],
  analysis?: MaterialAnalysis,
): QualityResult {
  const issues: QualityIssue[] = [];
  const blocking = (code: QualityIssueCode, message: string): void => {
    issues.push({ code, message, severity: "blocking" });
  };
  const note = (code: QualityIssueCode, message: string, severity: "uncertain" | "warning"): void => {
    issues.push({ code, message, severity });
  };
  // 教學品質檢查需要教材的結構化分析（語意閘門）。呼叫端已經算好時直接沿用，
  // 否則即場由同一批段落計算（確定性、不呼叫 AI）。
  const materialAnalysis = analysis ?? analyseMaterial({ units });

  const key = candidate.correctAnswer.trim();
  const materialText = normalizeForMatch(units.map((unit) => unit.text).join("\n"));
  // 教材以括號附註簡稱時（「第二次世界大戰（二戰）」），答案通常只寫全稱；
  // 這種情況屬「逐字見於教材」，不應因為教材的註解寫法而被當成改寫。
  const materialTextWithoutNotes = normalizeForMatch(
    stripParentheticals(units.map((unit) => unit.text).join("\n")),
  );
  // 節錄本身已由其他檢查證明出自教材段落；答案較長時生成器可能截短，
  // 因此「教材支持答案」也接受節錄作為證據（否則長說明的題目會被誤判）。
  const excerptText = normalizeForMatch(candidate.sourceExcerpt);
  const normalizedKey = normalizeForMatch(key);
  // 只有客觀答案（選擇題／填充題）必須逐字見於教材；短答題的參考答案本來就會
  // 綜合教材內容並加入補充，缺字只作提示（與既有品質警告一致）。
  const keyMustAppearInMaterial =
    candidate.questionType === "mc" || candidate.questionType === "fill";

  if (keyMustAppearInMaterial && normalizedKey.length > 0 && materialText.length > 0) {
    const literal =
      materialText.includes(normalizedKey) ||
      materialTextWithoutNotes.includes(normalizedKey) ||
      (normalizedKey.length >= 20 && excerptText.includes(normalizedKey.slice(0, 20)));
    const paraphrase = literal ? null : paraphraseSupport(candidate.questionType, normalizedKey, candidate.correctAnswer, materialText, excerptText);
    if (!literal && paraphrase === null) {
      blocking("answer-not-in-material", `標準答案「${key}」未見於提供的教材，無法確認依據`);
    } else if (paraphrase !== null) {
      issues.push({
        code: "answer-not-in-material",
        message:
          `標準答案「${truncateForMessage(key)}」是教材語句的改寫（與教材用語的文字重疊率 ${Math.round(paraphrase.coverage * 100)}%；` +
          "這只是用字相似程度，不是答案正確性的評分），" +
          "並非教材原文；已記錄為警告供教師覆核，不會因此暫緩或丟棄",
        severity: "warning",
      });
    }
  } else if (!keyMustAppearInMaterial && normalizedKey.length > 0 && materialText.length > 0) {
    const supported =
      materialText.includes(normalizedKey) || excerptText.includes(normalizedKey.slice(0, 12));
    if (!supported) {
      // 短答題的參考答案本來就會綜合教材內容，因此缺字本身只作提示；但若參考答案
      // **引入了教材沒有的具體事實**（年份、數字、書名號標題），就屬未確定：
      // 學生看到的自評依據可能包含杜撰內容，必須先由教師確認。
      const fabricated = unsupportedFactTokens(key, materialText);
      if (fabricated.length > 0) {
        issues.push({
          code: "answer-not-in-material",
          message:
            `參考答案「${truncateForMessage(key)}」未見於提供的教材，並包含教材未交代的具體資料` +
            `（${fabricated.slice(0, 3).join("、")}），未能確定依據，須由教師核對後才可發布`,
          severity: "uncertain",
        });
      } else {
        issues.push({
          code: "answer-not-in-material",
          message: `參考答案「${truncateForMessage(key)}」未見於提供的教材，請教師核對`,
          severity: "warning",
        });
      }
    }
  }

  const ambiguity = ambiguousOptionReason(candidate, units);
  if (ambiguity.blocking !== null) blocking("ambiguous-options", ambiguity.blocking);
  for (const warning of ambiguity.warnings) {
    issues.push({ code: "option-overlap", message: warning, severity: "warning" });
  }

  const kind = optionKindReason(candidate);
  if (kind !== null) blocking("option-kind-mismatch", kind);

  const typeMismatch = stemAnswerTypeReason(candidate);
  if (typeMismatch !== null) blocking("stem-answer-type-mismatch", typeMismatch);

  const leak = answerLeakReason(candidate);
  if (leak !== null) blocking("answer-in-stem", leak);

  const explanation = candidate.explanation.trim();
  if (explanation.length === 0) {
    blocking("explanation-unsupported", "沒有解釋，學生無法從錯誤中學習");
  } else if (normalizeForMatch(explanation) === normalizeForMatch(candidate.question)) {
    blocking("explanation-unsupported", "解釋只是重複題幹，沒有說明為甚麼這是答案");
  } else if (explanation.length < 6) {
    issues.push({
      code: "explanation-unsupported",
      message: "解釋太短，未能說明答案的依據",
      severity: "warning",
    });
  }

  const copied = copiedSourceReason(candidate);
  if (copied !== null) blocking("copied-source", copied);

  // 教學品質（Sprint 8.5）：抄錄幅度、解釋是否只重述、答案是否足以回應題目、
  // 以及題目要求的思考面向是否真的由教材支持。
  const excessive = excessiveVerbatimReason(candidate, units);
  if (excessive !== null) note("excessive-verbatim", excessive, "warning");

  const thinContext = thinContextFillReason(candidate);
  if (thinContext !== null) note("mechanical-deletion", thinContext, "warning");

  const restates = explanationRestatesReason(candidate, units);
  if (restates !== null) note("explanation-restates-answer", restates, "warning");

  const unsupported = unsupportedDimensionReason(candidate, materialAnalysis);
  if (unsupported !== null) note("dimension-unsupported", unsupported, "uncertain");

  const causation = unsupportedCausationReason(candidate, materialAnalysis);
  if (causation !== null) note("unsupported-causation", causation, "uncertain");

  const overprecision = approximateDateOverprecisionReason(candidate, materialAnalysis);
  if (overprecision !== null) {
    note("approximate-date-overprecision", overprecision, "uncertain");
  }

  const asserted = assertedInferenceReason(candidate, materialAnalysis);
  if (asserted !== null) note("asserted-inference", asserted.reason, "uncertain");

  const evaluation = unsupportedEvaluationReason(candidate, units);
  if (evaluation !== null) note("unsupported-evaluation", evaluation, "uncertain");

  const offTopic = explanationOffTopicReason(candidate);
  if (offTopic !== null) note("explanation-off-topic", offTopic, "warning");

  return {
    ok: !issues.some((issue) => issue.severity === "blocking"),
    issues,
    outcome: qualityOutcome(issues),
  };
}
