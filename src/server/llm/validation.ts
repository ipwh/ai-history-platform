/**
 * LLM 輸出的驗證。
 *
 * 模型輸出永不被直接信任：
 *   1. 逐題通過 zod schema 檢查。
 *   2. 檢查題型是否符合要求、選擇題答案是否在選項內；correctAnswerIndex 與
 *      correctAnswer 互相矛盾（指向不同選項）時丟棄整條題目，不會靜默改寫答案。
 *   3. 檢查教材依據：sourceBlockIds 必須是我們提供的段落，而且 sourceExcerpt 必須
 *      真的出現在「所引用段落」的文字中；在其他段落找到相同文字不算依據。
 *   4. 題目歸入提供節錄的段落所屬分節，令同時生成多個分節時題目分類正確。
 *   5. 杜撰檢查：題目、答案、解釋及得分要點出現的年份必須見於教材段落，
 *      否則整條題目被丟棄。
 *   6. 人名及條約／文件名稱杜撰檢查：未見於教材時只記錄品質警告，交由教師核對，
 *      不會丟棄題目（人名沒有固定寫法，偵測可能出錯，見 findUnverifiedNames）。
 *   7. 填充題答案的「歷史元素」檢查（見 historical-answer.ts）：答案是說明、形容詞或
 *      教材欄位名稱（例如「展開時間」、「為生方法」）時丟棄整條題目；只是未能確認屬
 *      歷史元素時記錄品質警告，交由教師核對。
 *   8. 移除題目文字中「根據教材」等不應出現的提示語。
 *   9. 檔內重複題目會被丟棄。
 *
 * 通過驗證的題目才會轉成內部 Question 格式，狀態一律為 draft（未經教師核對）。
 * 「教材依據成立」只代表文字對得上原文，**不代表史實正確**：史實正確性是人工作業，
 * 系統只會提出 qualityWarnings 提示教師核對，不會代替教師判斷。
 */
import {
  HISTORY_SKILLS,
  llmQuestionSchema,
  questionSchema,
  type Difficulty,
  type HistorySkill,
  type Question,
  type QuestionOrigin,
  type QuestionType,
} from "../../lib/types";
import { normalizeForMatch, stripMarkdownArtifacts, truncate } from "../materials/text-utils";
import { checkHistoricalAnswer } from "./historical-answer";
import type { MaterialUnit } from "./provider";

/**
 * 把模型回報的技能名稱對應到固定清單。
 * 模型可能改寫或自創名稱（例如「時序理解」），這種情況一律視為未標示（null）
 * 並記錄警告，而不是把自創名稱寫入資料庫令技能統計失真。
 */
function resolveSkill(raw: string | null): { skill: HistorySkill | null; warning: string | null } {
  if (raw === null) return { skill: null, warning: null };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { skill: null, warning: null };
  const matched = HISTORY_SKILLS.find((skill) => skill === trimmed);
  if (matched) return { skill: matched, warning: null };
  return {
    skill: null,
    warning: `模型的技能標示「${truncate(trimmed, 20)}」不在課程技能清單內，已略過該標示（請教師自行標示）。`,
  };
}

/**
 * 找出會令「只有一個正確答案」不成立的選項組合：
 *   1. 某個錯誤選項包含標準答案的文字（例如答案「馬丁路德」，選項「馬丁路德和加爾文」）
 *      —— 該選項在語意上也算正確，學生選它不應被判錯。
 *   2. 兩個選項互相包含（例如「文藝復興」與「文藝復興時期」），同樣無法分辨。
 * 這類情況以警告交教師核對，不自動丟棄：判定的寬鬆程度會有誤差，
 * 而且題目只有經教師發布才會給學生作答。
 */
function findAmbiguousOptions(options: string[], correctAnswer: string): string[] {
  const warnings: string[] = [];
  const key = (value: string) => normalizeForMatch(value);
  const answerKey = key(correctAnswer);

  if (answerKey.length >= 2) {
    for (const option of options) {
      const optionKey = key(option);
      if (optionKey === answerKey) continue;
      if (optionKey.includes(answerKey)) {
        warnings.push(
          `選項「${truncate(option, 24)}」包含標準答案的文字，學生選它未必算錯，請確認答案是否唯一。`,
        );
      }
    }
  }

  const keys = options.map((option) => ({ option, key: key(option) }));
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      const a = keys[i];
      const b = keys[j];
      if (a.key.length < 2 || b.key.length < 2) continue;
      if (a.key === b.key) continue;
      if (a.key.includes(b.key) || b.key.includes(a.key)) {
        warnings.push(
          `選項「${truncate(a.option, 16)}」與「${truncate(b.option, 16)}」互相包含，意思可能重疊，請確認只有一個正確答案。`,
        );
      }
    }
  }
  return warnings;
}

export interface ValidationResult {
  accepted: Question[];
  discardedReasons: string[];
}

export interface ValidationContext {
  topicId: string;
  /** 題目歸屬的分節；多分節生成時作為無法判定時的後備值（見 resolveQuestionSectionId） */
  sectionId: string;
  /** 本次要求的所有分節；提供時會用來核對每條題目的歸屬分節 */
  sectionIds?: string[];
  questionTypes: QuestionType[];
  difficulty: Difficulty;
  origin: QuestionOrigin;
  units: MaterialUnit[];
  now: string;
  idFor: (index: number) => string;
}

/**
 * 這條題目應該歸入哪個分節。
 *
 * 一次生成可以同時涵蓋多個分節，但每條題目只依據其中一段教材，因此以「提供節錄的
 * 段落所屬分節」為準（見 MaterialUnit.sectionId）。該分節必須在本次要求的分節之內：
 * 分節沒有直接對應段落而回退使用整個課題教材時，沿用呼叫端指定的分節，避免題目被歸入
 * 教師沒有要求的分節。
 */
function resolveQuestionSectionId(
  context: ValidationContext,
  groundedUnit: MaterialUnit,
): string {
  const sectionId = groundedUnit.sectionId ?? null;
  if (sectionId === null) return context.sectionId;
  if (context.sectionIds !== undefined && !context.sectionIds.includes(sectionId)) {
    return context.sectionId;
  }
  return sectionId;
}

/**
 * 題目開頭引用教材的引導語。連同其後的標點一併移除，避免留下「所述，…」這類殘句；
 * 其他位置的教材提示語不會被硬刪，而是令整條題目被丟棄（見 MATERIAL_REFERENCE）。
 */
const LEADING_MATERIAL_PREFIXES: RegExp[] = [
  /^(試)?(綜合|根據|依據)(上述)?教材([^，,。；：]{0,30})?[，,：:]\s*/,
  /^(試)?(綜合|根據|依據)(上述)?(課本|上文|上載文件)([^，,。；：]{0,30})?[，,：:]\s*/,
  /^(教材|課本|上文)([^，,。；：]{0,30})?[，,：:]\s*/,
];

/**
 * 學生作答時不會看到教材，因此題目不可要求學生參考「教材」、「上文」或「標題」。
 * 只有「根據教材，…」這類開頭引導語可以安全移除，其餘一律丟棄整條題目。
 */
const MATERIAL_REFERENCE = /教材|課本|上載文件|上文|標題/;

/** 年份寫法（例如 1517年、公元前221年） */
const YEAR_PATTERN = /\d{3,4}\s*年/g;

/**
 * 條約、宣言、法典等文件的名稱：《》內的文字，以及《》以外、以「條約」等字尾命名的名稱。
 * 《》以外的名稱只在句首或標點之後（即前面不是中文字）才會比對，避免把
 * 「簽訂條約」這類包含動作詞的片段當成文件名稱。
 */
const DOCUMENT_TITLE_PATTERN = /《([^《》\n]{1,40})》/g;
/**
 * 《》內含有填充題空格標記（例如《＿＿＿憲章》）時無法核對，
 * 一律略過，避免把空格記號當成文件名稱。
 */
const BLANK_PLACEHOLDER = /[＿_]/;
const DOCUMENT_SUFFIX_PATTERN =
  /(?<![\u4e00-\u9fa5])[\u4e00-\u9fa5]{2,4}(?:條約|公約|宣言|法典|憲章|協定|議定書|聲明|法令|法案|公報|論證|計劃)/g;
/** 文件名稱或人名前常見的動作詞、判斷詞及連接詞（例如「簽訂凡爾賽條約」、「是指華沙公約」、「與羅斯福」） */
const LEADING_NOISE_PATTERN =
  /^(?:(?:簽訂|簽署|通過|頒布|頒行|發表|訂立|締結|加入|推行|實施|宣布|是指|即是|就是|是|即|名為|稱為|叫做)|[與和及又亦則並且同或])+/;
/** 屬一般類別而非特定文件名稱的詞語，不會當作杜撰（避免製造無意義警告） */
const NON_DOCUMENT_WORDS = new Set([
  "不平等條約",
  "國際條約",
  "和平條約",
  "國際公約",
  "世界公約",
  "貿易協定",
  "停戰協定",
  "短期計劃",
  "長期計劃",
]);

/** 人物稱謂：名詞後接稱謂（例如「拿破崙皇帝」、「漢武帝」） */
const PERSON_TITLE_SUFFIXES = [
  "皇帝",
  "國王",
  "女王",
  "女皇",
  "大帝",
  "總統",
  "首相",
  "主席",
  "總理",
  "將軍",
  "元帥",
  "法老",
  "可汗",
  "教宗",
  "教皇",
  "神學家",
  "思想家",
  "科學家",
  "發明家",
  "航海家",
  "探險家",
  "政治家",
  "哲學家",
  "文學家",
  "藝術家",
];
const PERSON_TITLE_PATTERN = new RegExp(
  `[\\u4e00-\\u9fa5]{2,8}(?:${PERSON_TITLE_SUFFIXES.join("|")})`,
  "g",
);

/** 人物常見行為動詞：緊接在前的詞語多數是人物姓名 */
const PERSON_ACTION_PATTERN =
  /[\u4e00-\u9fa5]{2,4}(?=(?:提出|發表|發明|創立|創辦|創建|設立|領導|率領|發現|主張|推行|撰寫|編寫|頒布|下令|統治|在位|逝世|生於|出生|認為|指出|改革|宣稱|征服|抨擊|批判|質疑|東征|西征))/g;

/** 名字後附生卒年（例如「邱吉爾 (1874-1965)」） */
const PERSON_LIFE_DATES_PATTERN = /([\u4e00-\u9fa5]{2,5})\s*[（(]\s*\d{3,4}\s*[-–—~]\s*\d{0,4}\s*[)）]/g;

/** 符合句式但不是人名的常見詞語（政府下令、學者提出等） */
const NON_PERSON_WORDS = new Set([
  "政府",
  "國家",
  "朝廷",
  "帝國",
  "王朝",
  "王國",
  "公國",
  "城邦",
  "社會",
  "人民",
  "人們",
  "人類",
  "農民",
  "工人",
  "商人",
  "官員",
  "軍隊",
  "教會",
  "宗教",
  "學校",
  "大學",
  "國會",
  "議會",
  "法庭",
  "法院",
  "制度",
  "政策",
  "法律",
  "條文",
  "經濟",
  "文化",
  "思想",
  "科學",
  "技術",
  "藝術",
  "文學",
  "歷史",
  "學生",
  "教師",
  "學者",
  "領袖",
  "統治者",
  "歐洲",
  "亞洲",
  "非洲",
  "美洲",
  "美國",
  "英國",
  "法國",
  "德國",
  "中國",
  "日本",
  "香港",
  "羅馬",
  "希臘",
  "埃及",
  "印度",
  "世界",
  "全球",
  "當時",
  "後來",
  "其後",
  "首先",
  "於是",
  "因此",
  "同時",
  "此外",
  "然而",
  "不過",
  "而且",
  "並且",
  "因為",
  "所以",
  "如果",
  "雖然",
  "他們",
  "我們",
  "你們",
  "自己",
  "其他",
  "全部",
  "市民",
  "居民",
  "群眾",
  "後世",
  "後人",
  "古希臘",
  "古羅馬",
  "皇帝",
  "國王",
  "女王",
  "女皇",
  "總統",
  "首相",
  "主席",
  "總理",
  "將軍",
  "元帥",
  "法老",
  "可汗",
  "教宗",
  "教皇",
]);

/** 語句連接詞：出現在詞語中即代表它多數不是人名或文件名稱 */
const NON_NAME_CHARS = /[的是了指即稱叫為們等及與和在有所其這那就都也很更最把被從對]/;

/** 警告訊息中最多列出的名稱數目 */
const MAX_NAMES_PER_WARNING = 5;

/**
 * 找出文字中出現、但未見於已提供教材段落的年份。
 * 模型有時會自行補上教材沒有交代的年份（例如把 1919 年寫成 1914 年），
 * 學生無法察覺這類杜撰，因此整條題目會被丟棄。
 */
export function findFabricatedYears(text: string, materialText: string): string[] {
  const normalizedMaterial = normalizeForMatch(materialText);
  const years = [...new Set((text.match(YEAR_PATTERN) ?? []).map((year) => year.trim()))];
  return years.filter((year) => !normalizedMaterial.includes(normalizeForMatch(year)));
}

export interface UnverifiedNames {
  /** 未見於教材的人名 */
  persons: string[];
  /** 未見於教材的條約／文件／著作名稱 */
  documents: string[];
}

/** 完全比對（忽略標點及空白） */
function isExactMention(candidate: string, normalizedMaterial: string): boolean {
  const normalized = normalizeForMatch(candidate);
  return normalized.length >= 2 && normalizedMaterial.includes(normalized);
}

/**
 * 比對詞語的字尾部分。
 * 以行為動詞偵測人名時，詞語可能連帶前面的修飾語
 * （例如「德意志神學家馬丁路德」會先取到「德意志神學家」），
 * 因此容許只用字尾比對，以減少誤報。
 */
function isMentionedAsSuffix(candidate: string, normalizedMaterial: string): boolean {
  const normalized = normalizeForMatch(candidate);
  for (let length = normalized.length; length >= 2; length -= 1) {
    if (normalizedMaterial.includes(normalized.slice(normalized.length - length))) return true;
  }
  return false;
}

/** 去掉詞語末的稱謂（「拿破崙皇帝」→「拿破崙」）；沒有稱謂時回傳原詞 */
function stripPersonTitle(token: string): string {
  for (const suffix of PERSON_TITLE_SUFFIXES) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 2) {
      return token.slice(0, token.length - suffix.length);
    }
  }
  return token;
}

/**
 * 去掉候選詞語開頭不屬名稱的部分：
 * 動作詞（「簽訂凡爾賽條約」→「凡爾賽條約」）、判斷詞（「是指華沙公約」→「華沙公約」）
 * 及連接詞（「與羅斯福」→「羅斯福」）。
 */
function trimCandidate(candidate: string): string {
  return candidate.replace(LEADING_NOISE_PATTERN, "");
}

function isPersonLike(candidate: string): boolean {
  if (candidate.length < 2 || candidate.length > 6) return false;
  if (NON_PERSON_WORDS.has(candidate)) return false;
  return !NON_NAME_CHARS.test(candidate);
}

/** 文件名稱只會是專有名詞：太短或包含語句連接詞的片段都不是名稱 */
function isDocumentNameLike(candidate: string): boolean {
  if (candidate.length < 3) return false;
  if (NON_DOCUMENT_WORDS.has(candidate)) return false;
  return !NON_NAME_CHARS.test(candidate);
}

/**
 * 找出文字中出現、但未見於已提供教材段落的人名及條約／文件名稱。
 *
 * 人名沒有固定的寫法，只能用句式推測（稱謂、常見行為動詞、生卒年），
 * 因此結果是**警告**而不是判錯：出現這類名稱的題目仍然會被保留，
 * 只會在教師介面標示，提醒教師核對教材後才發布（見 README「生成流程與驗證」）。
 */
export function findUnverifiedNames(text: string, materialText: string): UnverifiedNames {
  const material = normalizeForMatch(materialText);
  const persons = new Set<string>();
  const documents = new Set<string>();

  for (const match of text.matchAll(DOCUMENT_TITLE_PATTERN)) {
    const title = match[1].trim();
    // 只有一個字的標題，以及含填充題空格標記（《＿＿＿憲章》）的標題，都不是可核對的名稱
    if (title.length < 2 || BLANK_PLACEHOLDER.test(title)) continue;
    if (!isExactMention(title, material)) documents.add(`《${title}》`);
  }
  for (const match of text.matchAll(DOCUMENT_SUFFIX_PATTERN)) {
    const name = trimCandidate(match[0]);
    // 與《》內的項目重複時不重複記錄
    if (match.index > 0 && text[match.index - 1] === "《") continue;
    if (!isDocumentNameLike(name)) continue;
    if (!isExactMention(name, material)) documents.add(name);
  }
  for (const match of text.matchAll(PERSON_TITLE_PATTERN)) {
    const name = trimCandidate(stripPersonTitle(match[0]));
    if (!isPersonLike(name)) continue;
    if (isExactMention(name, material) || isMentionedAsSuffix(name, material)) continue;
    persons.add(name);
  }
  for (const match of text.matchAll(PERSON_LIFE_DATES_PATTERN)) {
    const name = trimCandidate(match[1]);
    if (!isPersonLike(name)) continue;
    if (isExactMention(name, material) || isMentionedAsSuffix(name, material)) continue;
    persons.add(name);
  }
  for (const match of text.matchAll(PERSON_ACTION_PATTERN)) {
    const name = trimCandidate(match[0]);
    if (!isPersonLike(name)) continue;
    if (isMentionedAsSuffix(name, material)) continue;
    persons.add(name);
  }

  return { persons: [...persons], documents: [...documents] };
}

function formatNameList(names: string[]): string {
  if (names.length <= MAX_NAMES_PER_WARNING) return names.join("、");
  return `${names.slice(0, MAX_NAMES_PER_WARNING).join("、")} 等 ${names.length} 項`;
}

/** 把未見於教材的人名及文件名稱組成教師可見的品質警告 */
function buildNameWarnings(names: UnverifiedNames): string[] {
  const warnings: string[] = [];
  if (names.persons.length > 0) {
    warnings.push(
      `題目出現教材未提及的人名（${formatNameList(names.persons)}），可能是杜撰人物，請核對教材後才發布`,
    );
  }
  if (names.documents.length > 0) {
    warnings.push(
      `題目出現教材未提及的條約／文件或著作名稱（${formatNameList(names.documents)}），可能是杜撰名稱，請核對教材後才發布`,
    );
  }
  return warnings;
}

export function sanitizeQuestionText(text: string): string {
  let cleaned = stripMarkdownArtifacts(text);
  for (const pattern of LEADING_MATERIAL_PREFIXES) {
    cleaned = cleaned.replace(pattern, "");
  }
  return cleaned.replace(/^[，、,。\s]+/, "").trim();
}

/** 把模型輸出（可能是字串或已解析物件）轉成陣列 */
export function parseLlmJson(raw: string): unknown {
  const trimmed = raw.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    // 嘗試抽出第一個完整的 JSON 物件
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(withoutFence.slice(start, end + 1));
    }
    throw new Error("模型回應不是有效的 JSON");
  }
}

function normalizeRawQuestions(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    for (const key of ["questions", "items", "data", "results"]) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  throw new Error("模型回應缺少 questions 陣列");
}

export function validateLlmQuestions(raw: unknown, context: ValidationContext): ValidationResult {
  const unitMap = new Map(context.units.map((unit) => [unit.blockId, unit]));
  /** 已提供的教材原文，用於核對題目中的年份是否有教材依據 */
  const providedText = context.units.map((unit) => unit.text).join("\n");
  const accepted: Question[] = [];
  const discardedReasons: string[] = [];
  const seen = new Set<string>();

  let rawQuestions: unknown[];
  try {
    rawQuestions = normalizeRawQuestions(raw);
  } catch (error) {
    return {
      accepted: [],
      discardedReasons: [error instanceof Error ? error.message : String(error)],
    };
  }

  rawQuestions.forEach((item, index) => {
    const parsed = llmQuestionSchema.safeParse(item);
    if (!parsed.success) {
      discardedReasons.push(
        `第 ${index + 1} 題資料不完整或格式不符：${parsed.error.issues
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("；")}`,
      );
      return;
    }
    const candidate = parsed.data;

    if (!context.questionTypes.includes(candidate.questionType)) {
      discardedReasons.push(`第 ${index + 1} 題的題型不在要求之內（${candidate.questionType}）`);
      return;
    }

    const question = sanitizeQuestionText(candidate.question);
    if (question.length < 6) {
      discardedReasons.push(`第 ${index + 1} 題在移除提示語後內容不足`);
      return;
    }

    // 學生作答時不會看到教材：題目不可要求學生參考教材／上文／標題
    if (MATERIAL_REFERENCE.test(question)) {
      discardedReasons.push(
        `第 ${index + 1} 題要求學生參考教材／上文／標題，但學生作答時不會看到教材`,
      );
      return;
    }

    // 教材依據：段落編號必須存在，節錄必須真的出現在該段落中
    const missingBlocks = candidate.sourceBlockIds.filter((blockId) => !unitMap.has(blockId));
    if (missingBlocks.length > 0) {
      discardedReasons.push(
        `第 ${index + 1} 題引用了不存在的教材段落（${missingBlocks.join("、")}）`,
      );
      return;
    }

    const excerptKey = normalizeForMatch(candidate.sourceExcerpt);
    if (excerptKey.length < 8) {
      discardedReasons.push(`第 ${index + 1} 題的教材節錄太短，無法確認依據`);
      return;
    }
    // 同一個教材段落可能拆成多個單位（清單逐項、表格逐列都會共用同一個 blockId），
    // 因此「引用的段落」是擁有這些 blockId 的所有單位，而不是每個 blockId 只取一個。
    const referencedBlockIds = new Set(candidate.sourceBlockIds);
    const referenced = context.units.filter((unit) => referencedBlockIds.has(unit.blockId));
    // 節錄必須出自這條題目指明的段落。在其他段落找到相同文字不算依據，否則模型只要
    // 抄錄一段與本題無關的教材，就能通過教材依據檢查（而它引用的段落可能根本沒有這段話）。
    const groundedUnit = referenced.find((unit) => normalizeForMatch(unit.text).includes(excerptKey));
    if (!groundedUnit) {
      discardedReasons.push(
        `第 ${index + 1} 題的答案沒有教材依據（節錄未能對應指定段落 ${candidate.sourceBlockIds.join(
          "、",
        )} 的原文）`,
      );
      return;
    }

    let options = candidate.options
      .map((option) => stripMarkdownArtifacts(option.trim()))
      .filter((option) => option.length > 0);
    let correctAnswer = stripMarkdownArtifacts(candidate.correctAnswer.trim());
    const gradingPoints = candidate.gradingPoints
      .map((point) => stripMarkdownArtifacts(point))
      .filter((point) => point.length > 0);
    // 只提示教師核對、不會丟棄題目的品質警告
    const qualityWarnings: string[] = [];

    if (candidate.questionType === "mc") {
      if (options.length < 2) {
        discardedReasons.push(`第 ${index + 1} 題是選擇題但選項不足`);
        return;
      }
      const indexedAnswer =
        candidate.correctAnswerIndex !== null &&
        candidate.correctAnswerIndex >= 0 &&
        candidate.correctAnswerIndex < options.length
          ? options[candidate.correctAnswerIndex]
          : null;

      if (indexedAnswer === null) {
        if (!options.includes(correctAnswer)) {
          discardedReasons.push(`第 ${index + 1} 題的標準答案不在選項之內`);
          return;
        }
      } else if (
        correctAnswer.length > 0 &&
        normalizeForMatch(indexedAnswer) !== normalizeForMatch(correctAnswer)
      ) {
        // correctAnswerIndex 與 correctAnswer 互相矛盾時，不可逕自採用其中一個：
        // 兩者都可能才是模型的原意，靜默覆寫等於由系統改寫標準答案。
        // 這類題目一律丟棄，由教師重新生成或手動建立。
        discardedReasons.push(
          `第 ${index + 1} 題的 correctAnswerIndex 與 correctAnswer 不一致（索引 ${
            candidate.correctAnswerIndex as number
          } 指向「${indexedAnswer}」，但 correctAnswer 為「${correctAnswer}」）`,
        );
        return;
      } else {
        correctAnswer = indexedAnswer;
      }

      // 選項以正規化後的文字去重：除了完全相同的選項，連「1517年」與「1517 年」
      // 這類只差標點或空白的選項也視為重複，避免同一題出現兩個等同的選項。
      const uniqueOptions: string[] = [];
      const seenOptions = new Set<string>();
      let droppedOptions = 0;
      for (const option of options) {
        const key = normalizeForMatch(option);
        if (seenOptions.has(key)) {
          droppedOptions += 1;
          continue;
        }
        seenOptions.add(key);
        uniqueOptions.push(option);
      }
      options = uniqueOptions;
      if (options.length < 2) {
        discardedReasons.push(`第 ${index + 1} 題的選項重複，無法作答`);
        return;
      }
      if (droppedOptions > 0) {
        // 選項本身仍然可用（正確答案以文字記載，不受去重影響），只提示教師核對
        qualityWarnings.push(
          `選擇題有 ${droppedOptions} 個重複或等同的選項，系統已自動去除；請確認餘下選項仍然合理。`,
        );
      }
      if (options.some((option) => MATERIAL_REFERENCE.test(option))) {
        discardedReasons.push(
          `第 ${index + 1} 題的選項提及教材／上文／標題，學生作答時不會看到教材`,
        );
        return;
      }
      // 只有一個正確答案的檢查（以警告交教師核對，不自動丟棄）
      qualityWarnings.push(...findAmbiguousOptions(options, correctAnswer));
    } else {
      options = [];
    }

    // 杜撰檢查：題目、參考答案、解釋及得分要點出現的年份，都必須見於已提供的教材段落。
    // 錯誤選項不在此限（錯誤年份本來就是錯誤的，只要不是憑空杜撰的人物、事件或年份即可）。
    const explanationText = stripMarkdownArtifacts(candidate.explanation.trim());
    const answerText = [question, correctAnswer, explanationText, ...gradingPoints].join("\n");
    const fabricatedYears = findFabricatedYears(answerText, providedText);
    if (fabricatedYears.length > 0) {
      discardedReasons.push(
        `第 ${index + 1} 題出現教材沒有交代的年份（${fabricatedYears.join("、")}），疑似杜撰史實`,
      );
      return;
    }

    // 人名及條約／文件名稱同樣不可杜撰，但人名沒有固定寫法，偵測可能出錯，
    // 因此只記錄警告交由教師核對，不會丟棄題目（見 findUnverifiedNames）。
    qualityWarnings.push(...buildNameWarnings(findUnverifiedNames(answerText, providedText)));

    // 技能標示：只接受課程技能清單內的寫法，自創名稱一律略過並記錄警告
    const resolvedSkill = resolveSkill(candidate.skill);
    if (resolvedSkill.warning !== null) qualityWarnings.push(resolvedSkill.warning);

    if (candidate.questionType === "short") {
      if (gradingPoints.length === 0) {
        discardedReasons.push(`第 ${index + 1} 題是短答題但沒有得分要點`);
        return;
      }
      // 部分模型會把短答題的 correctAnswer 留空，此時以得分要點組成參考答案，
      // 避免整條題目因為格式問題而被丟棄。
      if (correctAnswer.length === 0) {
        correctAnswer = gradingPoints.join("；");
      }
    } else if (correctAnswer.length === 0) {
      discardedReasons.push(`第 ${index + 1} 題沒有提供標準答案`);
      return;
    }

    // 填充題的答案必須是具有歷史意義的元素（事件名稱、人物、年份、國家、地點、條約、
    // 神祇、思想、政治制度等），見 historical-answer.ts。明顯不合格者丟棄整條題目；
    // 只是未能確認屬歷史元素者標示品質警告，交由教師核對。
    if (candidate.questionType === "fill") {
      const answerCheck = checkHistoricalAnswer(correctAnswer, providedText);
      if (answerCheck.definite) {
        discardedReasons.push(`第 ${index + 1} 題：${answerCheck.reason}`);
        return;
      }
      if (answerCheck.reason !== null) qualityWarnings.push(answerCheck.reason);
    }

    const duplicateKey = `${normalizeForMatch(question)}|${normalizeForMatch(correctAnswer)}`;
    if (seen.has(duplicateKey)) {
      discardedReasons.push(`第 ${index + 1} 題與本次生成的其他題目重複`);
      return;
    }
    seen.add(duplicateKey);

    const built = questionSchema.safeParse({
      id: context.idFor(accepted.length),
      topicId: context.topicId,
      sectionId: resolveQuestionSectionId(context, groundedUnit),
      questionType: candidate.questionType,
      difficulty: context.difficulty,
      question,
      options,
      correctAnswer,
      acceptedAnswers: [],
      explanation: explanationText,
      knowledgePoint: stripMarkdownArtifacts(candidate.knowledgePoint.trim()),
      sourceExcerpt: candidate.sourceExcerpt.trim(),
      sourceLocation: groundedUnit.sourceLocation,
      sourceBlockIds: candidate.sourceBlockIds,
      gradingPoints,
      origin: context.origin,
      status: "draft",
      sourceVerified: true,
      qualityWarnings,
      skill: resolvedSkill.skill,
      createdAt: context.now,
    });

    if (!built.success) {
      discardedReasons.push(
        `第 ${index + 1} 題通過教材依據檢查，但欄位仍不合規：${built.error.issues
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("；")}`,
      );
      return;
    }

    accepted.push(built.data);
  });

  return { accepted, discardedReasons };
}
