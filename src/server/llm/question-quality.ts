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
import type { MaterialUnit } from "./provider";

export type QualityIssueCode =
  | "ambiguous-options"
  | "option-overlap"
  | "option-kind-mismatch"
  | "stem-answer-type-mismatch"
  | "answer-in-stem"
  | "answer-not-in-material"
  | "explanation-unsupported"
  | "copied-source";

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
 * 選擇題答案獲接納為「教材支持的改寫」所需的最低重疊率（與教材共用的二字片段比例）。
 *
 * 真實模型（DeepSeek 試點）寫選擇題時，正確選項往往是教材語句的改寫而不是原文，
 * 逐字比對會令 9 格選擇題中有 6 格被丟棄。試點量測：合格改寫的重疊率為 0.67–0.95，
 * 杜撰選項（「條約內容使各國經濟繁榮，並促成永久和平」）為 0.41–0.64，故取 0.6。
 */
const MC_PARAPHRASE_MIN_COVERAGE = 0.6;
/** 只有完整句子的答案才可用改寫方式支持；短答案（詞語）必須逐字見於教材 */
const MC_PARAPHRASE_MIN_LENGTH = 8;

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
 * 選擇題答案是否可視為「教材支持的改寫」（非逐字引用）。
 *
 * 三項條件同時成立才接納，任何一項不成立即維持原本的丟棄行為（fail-closed）：
 *   1. 只有選擇題：短答案仍必須逐字見於教材；
 *   2. 答案不可帶有教材沒有的具體事實標記（年份、數字、《》標題）；
 *   3. 與教材的二字片段重疊率達 `MC_PARAPHRASE_MIN_COVERAGE`。
 */
function paraphraseSupport(
  questionType: string,
  normalizedKey: string,
  rawKey: string,
  materialText: string,
  excerptText: string,
): { coverage: number } | null {
  if (questionType !== "mc") return null;
  if (normalizedKey.length < MC_PARAPHRASE_MIN_LENGTH) return null;
  if (unsupportedFactTokens(rawKey, materialText).length > 0) return null;
  const coverage = Math.max(
    bigramCoverage(normalizedKey, materialText),
    bigramCoverage(normalizedKey, excerptText),
  );
  return coverage >= MC_PARAPHRASE_MIN_COVERAGE ? { coverage } : null;
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
 * 題幹是否只是抄錄教材原文（沒有構成可作答的問題）。
 * 挖空式題目（＿＿＿）本身就是由教材句子改寫而成，不屬此類。
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

/** 題幹本身是否已包含標準答案（洩露答案） */function answerLeakReason(candidate: QualityCandidate): string | null {
  const key = normalizeForMatch(candidate.correctAnswer);
  if (key.length < 2) return null;
  const stem = normalizeForMatch(candidate.question);
  if (!stem.includes(key)) return null;
  // 題幹以「引號引述定義，再問是哪一個詞語」是正常問法：答案在題幹中只是引述內容
  const evidence = normalizeForMatch(stemEvidenceText(candidate.question));
  const quoted = /「[^」]{2,}」/.test(candidate.question);
  if (quoted && evidence.includes(key) && /是指/.test(candidate.question)) return null;
  return `題幹已出現標準答案「${candidate.correctAnswer}」`;
}

export function checkQuestionQuality(
  candidate: QualityCandidate,
  units: MaterialUnit[],
): QualityResult {
  const issues: QualityIssue[] = [];
  const blocking = (code: QualityIssueCode, message: string): void => {
    issues.push({ code, message, severity: "blocking" });
  };

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
          `標準答案「${truncateForMessage(key)}」是教材語句的改寫（教材用語重疊率 ${Math.round(paraphrase.coverage * 100)}%），` +
          "並非教材原文，未能確定答案依據，須由教師核對後才可發布",
        severity: "uncertain",
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

  return { ok: !issues.some((issue) => issue.severity === "blocking"), issues };
}
