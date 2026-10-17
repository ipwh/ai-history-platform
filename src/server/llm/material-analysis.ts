/**
 * 教材的**結構化語意分析**（Sprint 8.5）：
 * 在生成題目之前，先把檢索到的教材整理成「可以支持甚麼題目」的結構化資料，
 * 令出題是由教材的歷史意義出發，而不是把單一句子挖空。
 *
 * 為甚麼需要這一層：
 *   1. 以往傳給模型的只有一連串互不相關的段落（`MaterialUnit[]`），
 *      模型看不到事件之間的因果、時序、轉變與比較關係，於是傾向把教材句子改寫成題目。
 *   2. 品質閘門只能檢查「答案是否見於教材」，無法判斷「教材是否真的支持這種題目」
 *      （例如教材只列出一件事件，卻出了要比較兩件事的題目）。
 *   3. 分析結果同時提供**來源位置**，與既有的 `sourceBlockIds`／節錄核對機制一致。
 *
 * 設計原則：
 *   - **確定性**：只用字面規則（標記詞、年份、引號、定義句式）分析，不呼叫 AI、不產生費用，
 *     因此可以逐項寫測試，亦不會把無法解釋的判斷混入發布流程。
 *   - **保守**：分析結果只用來「限制不可以出甚麼題目」以及提示模型；
 *     它不會把教材內容當成史料以外的知識來源，也不會自行推論教材沒有交代的史事。
 *   - **可追溯**：每一項分析都帶有 `blockId` 及 `sourceLocation`，教師可回查原文。
 *   - 教材沒有交代的面向**不會**被「補齊」；不足時改為記錄在 `limitations`，
 *     由生成流程選擇縮窄題目或拒絕生成。
 *
 * **這一層不是內容理解**：它只把教材的字面標記整理成可核對的結構，
 * 不能判斷史實是否正確、不能判斷題目是否教得好、也不能代替教師閱讀教材。
 * 所有判定都只可以說「按這些字面規則找不到問題」，不可以說「題目已獲認可」
 * （見 README「自動準則與教師判斷的分工」）。
 */
import { normalizeForMatch, splitSentences, stripPageReferences } from "../materials/text-utils";
import type { MaterialUnit } from "./provider";

/** 教材可以支持的歷史思考面向（只會在教材真的有相應內容時才成立） */
export type MaterialDimension =
  | "chronology"
  | "cause-consequence"
  | "change-continuity"
  | "comparison"
  | "significance";

export const MATERIAL_DIMENSION_LABELS: Record<MaterialDimension, string> = {
  chronology: "時序（先後次序）",
  "cause-consequence": "因果關係（原因與結果）",
  "change-continuity": "轉變與延續",
  comparison: "比較與對照",
  significance: "歷史意義與影響",
};

/** 分析所依據的教材原文 */
export interface MaterialEvidence {
  blockId: string;
  sourceLocation: string;
  text: string;
}

/** 教材出現的關鍵詞語（引號詞語、書名／條約名、定義句式的主語） */
export interface MaterialConcept {
  term: string;
  kind: "quoted" | "document" | "defined";
  evidence: MaterialEvidence;
}

/** 教材寫法的時間種類（決定可否要求學生答出準確年份） */
export type MaterialTimeKind = "year" | "bce-year" | "century" | "range" | "approximate";

/**
 * 教材交代的時間資料（Sprint 8.5）。
 *
 * **`sortKey` 只用於排序**（比較先後），**不是**已核實的準確年份：
 * 「十八世紀」的 `sortKey` 為 1700，意思是「由 1700 年開始的一段時間」，
 * **不是**「事件發生在 1700 年」。需要準確年份時必須查 `exact`；`startYear`／`endYear`
 * 表示教材文字實際支持的範圍（世紀 = 100 年；「約」= 約數）。
 * 這一層刻意不把世紀轉成單一年份，避免系統把「十八世紀」當成「1700 年」。
 */
export interface MaterialPeriod {
  /** 教材原樣的時間寫法（例如「十八世紀中葉」、「約公元前3,200年」） */
  text: string;
  kind: MaterialTimeKind;
  /** 排序用（= startYear；公元前為負）。只可比較先後，不可當作準確年份。 */
  sortKey: number;
  /** 教材文字支持的最早年份 */
  startYear: number;
  /** 教材文字支持的最晚年份（單一年份時與 startYear 相同） */
  endYear: number;
  /** 教材是否以「約／大約／左右」等約數寫法交代 */
  approximate: boolean;
  /** 是否為明確的單一年份（可以要求學生答出準確年份） */
  exact: boolean;
}

/** 教材交代的帶時間事件（用於時序題及「教材提到哪些年份」的核對） */
export interface MaterialEvent {
  /** 教材原樣的時間寫法（例如「1919年」、「公元前221年」、「十八世紀」） */
  time: string;
  /** 排序用（見 MaterialPeriod；不是準確年份） */
  sortKey: number;
  /** 時間的完整語意（範圍、約數、是否準確） */
  period: MaterialPeriod;
  /** 該時間所在的句子 */
  statement: string;
  evidence: MaterialEvidence;
}

/** 教材交代的歷史關係（成因、結果、轉變、比較、意義） */
export interface MaterialRelation {
  dimension: MaterialDimension;
  /** 教材中的標記詞（例如「導致」、「其後」、「相比」） */
  marker: string;
  /** 該標記所在的句子 */
  statement: string;
  evidence: MaterialEvidence;
}

/** 教材的陳述句：區分「教材明確交代」與「教材帶有推測語氣的說法」 */
export interface MaterialClaim {
  statement: string;
  kind: "explicit" | "inference";
  evidence: MaterialEvidence;
}

export type MaterialLimitationCode =
  | "too-little-material"
  | "single-document"
  | "ocr-only"
  | "no-dated-events"
  | "single-dated-event"
  | "ambiguous-event-order"
  | "no-causal-relation"
  | "no-change-relation"
  | "no-comparison-material"
  | "no-significance-statement";

export interface MaterialLimitation {
  code: MaterialLimitationCode;
  message: string;
}

export interface MaterialAnalysisInput {
  units: MaterialUnit[];
  /** 課題／分節名稱，只作為分析的標籤，不是史實依據 */
  topicTitle?: string;
  sectionTitle?: string;
  levelLabel?: string;
  themeText?: string;
  learningFocusText?: string;
}

export interface MaterialAnalysis {
  topicTitle: string;
  sectionTitle: string;
  levelLabel: string;
  themeText: string;
  learningFocusText: string;
  unitCount: number;
  documentCount: number;
  concepts: MaterialConcept[];
  events: MaterialEvent[];
  relations: MaterialRelation[];
  claims: MaterialClaim[];
  /** 只列出教材真的有相應內容的面向（沒有交代的不會出現 true） */
  dimensions: Record<MaterialDimension, boolean>;
  limitations: MaterialLimitation[];
  /** 供品質閘門查詢：某一組引用段落是否包含指定面向的教材內容 */
  hasDimensionInBlocks(dimension: MaterialDimension, blockIds: string[]): boolean;
  /**
   * 供品質閘門查詢：這組引用段落是否含**明確的單一年份**（不是世紀或約數）。
   *
   * 教材只寫「十八世紀」時，不可出要求學生答出準確年份的題目
   * （見 question-quality.ts 的 approximate-date-overprecision）。
   */
  hasExactYearInBlocks(blockIds: string[]): boolean;
}

/* ------------------------------------------------------------------ */
/* 標記詞                                                              */
/* ------------------------------------------------------------------ */

/** 因果標記：教材明確交代原因或結果 */
const CAUSE_MARKERS = [
  "導致",
  "引致",
  "促成",
  "引發",
  "觸發",
  "造成",
  "帶來",
  "因而",
  "因此",
  "所以",
  "由於",
  "因為",
  "結果",
  "源於",
  "歸因",
  // Sprint 8.6（真實題目校準）：教材常以「……的因素包括」、「有利的條件」列出成因或條件，
  // 這些寫法同樣支持「為甚麼／原因」的題目，即使句中沒有「導致／因此」。
  "因素",
  "條件",
  "有利於",
];

/**
 * 裸「因」（例如「德、意因接納了對本國不利的戰後安排，國內反政府的聲音高漲」）。
 *
 * 中文教材常用單字「因」表示「因為」，但「原因／因素／基因／因此／因而／因為」不是
 * 這一種用法，因此先剔除這些詞再檢查。
 */
function bareCausalYin(text: string): boolean {
  if (!text.includes("因")) return false;
  return text.replace(/原因|因素|基因|因此|因而|因為/g, "").includes("因");
}
/** 轉變與延續標記 */
const CHANGE_MARKERS = ["轉變", "改變", "變化", "演變", "變成", "轉為", "延續", "仍然", "持續", "保留", "改為"];
/** 比較與對照標記 */
const COMPARISON_MARKERS = ["相比", "比較", "對比", "異同", "不同", "差異", "相似", "同樣", "兩者"];
/** 歷史意義與影響標記 */
const SIGNIFICANCE_MARKERS = ["意義", "重要性", "影響深遠", "深遠", "象徵", "標誌", "奠定", "為日後", "影響"];
/** 推測語氣：教材沒有斷言，只是提出可能／他人的看法 */
const INFERENCE_MARKERS = ["可能", "或許", "大約", "相信", "認為", "估計", "似乎", "一說"];

const QUOTED_TERM_PATTERN = /「([^「」]{2,14})」/g;
const DOCUMENT_PATTERN = /《([^《》]{2,20})》/g;
const DEFINITION_PATTERN = /^([^：:]{2,16})[：:](.{6,})$/;
/**
 * 教材的時間寫法（Sprint 8.5 起保留範圍、約數及世紀修飾語，不再只取單一年份）。
 * 群組 1 = 約數標記，群組 2 = 時間文字（可為範圍）。
 */
const TIME_PATTERN =
  /(約\s*)?((?:公元前\s*[\d,]{1,6}\s*年|(?<![\u4e00-\u9fa5])前\s*[\d,]{1,6}\s*年|(?:公元)?\s*\d{3,4}\s*年)\s*(?:至|到|~|～|-|—|–)\s*(?:公元前\s*[\d,]{1,6}\s*年|(?:公元)?\s*\d{3,4}\s*年)|(?:[元前後]?(?:\d{1,2}|[一二三四五六七八九十兩]{1,3})\s*世紀)\s*(?:至|到|~|～|-|—|–)\s*(?:[元前後]?(?:\d{1,2}|[一二三四五六七八九十兩]{1,3})\s*世紀)|公元前\s*[\d,]{1,6}\s*年|(?<![\u4e00-\u9fa5])前\s*[\d,]{1,6}\s*年|(?:公元)?\s*\d{3,4}\s*年|[元前後]?(?:\d{1,2}|[一二三四五六七八九十兩]{1,3})\s*世紀(?:初|早期|前期|中葉|中期|後期|晚期|末)?)/;

/**
 * 中文數字（教材常用「十八世紀」、「二十世紀」）。
 * 只處理 1–99，與年份／世紀的實際寫法相符；無法解析時回 null。
 */
export function parseChineseNumeral(text: string): number | null {
  const digits: Record<string, number> = {
    一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (!/^[一二三四五六七八九十兩]+$/.test(trimmed)) return null;

  const tenIndex = trimmed.indexOf("十");
  if (tenIndex === -1) {
    if (trimmed.length !== 1) return null;
    return digits[trimmed] ?? null;
  }
  const tensPart = trimmed.slice(0, tenIndex);
  const onesPart = trimmed.slice(tenIndex + 1);
  const tens = tensPart.length === 0 ? 1 : digits[tensPart];
  if (tens === undefined) return null;
  if (onesPart.length === 0) return tens * 10;
  if (onesPart.length !== 1) return null;
  const ones = digits[onesPart];
  return ones === undefined ? null : tens * 10 + ones;
}

/* ------------------------------------------------------------------ */
/* 基本工具                                                            */
/* ------------------------------------------------------------------ */

function evidenceOf(unit: MaterialUnit): MaterialEvidence {
  return {
    blockId: unit.blockId,
    sourceLocation: unit.sourceLocation,
    text: stripPageReferences(unit.text).trim(),
  };
}

/** 段落的句子（沒有句末標點時以整段為一句） */
function sentencesOf(unit: MaterialUnit): string[] {
  const text = stripPageReferences(unit.text).trim();
  const sentences = splitSentences(text).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0);
  return sentences.length > 0 ? sentences : [text];
}

/** 取第一個命中的標記詞（沒有則 null） */
function firstMarker(text: string, markers: string[]): string | null {
  for (const marker of markers) {
    if (text.includes(marker)) return marker;
  }
  return null;
}

/**
 * 解析教材的時間寫法（Sprint 8.5）。
 *
 * 支援：明確年份（`1919年`、`公元1453年`）、公元前年份（`公元前221年`）、
 * 約數（`約公元前3,200年`）、世紀（`十八世紀`／`19世紀` 及前後期修飾語）、
 * 跨世紀或跨年份的範圍（`十四至十七世紀`、`1914至1918年`）。
 *
 * 重要：世紀**不會**被轉成單一年份；`startYear`／`endYear` 保留教材文字支持的範圍，
 * `exact` 標示是否為明確年份。無法解析時回傳 `null`。
 */
export function parseTimeExpression(time: string): MaterialPeriod | null {
  const text = time.replace(/\s+/g, "").replace(/,/g, "");
  const approximateInText = /約|大約|左右|前後約/.test(text);

  const bce = /公元前(\d{1,4})年/.exec(text);
  if (bce) {
    const year = Number(bce[1]);
    if (!Number.isFinite(year) || year <= 0) return null;
    const value = -year;
    return {
      text,
      kind: approximateInText ? "approximate" : "bce-year",
      sortKey: value,
      startYear: value,
      endYear: value,
      approximate: approximateInText,
      exact: !approximateInText,
    };
  }

  // 教材也會寫「前221年」（省略「公元」）。只在「前」不是複合詞的一部分時才當作公元前：
  // 「戰前1939年」、「目前2020年」等寫法的「前」前面有中文字，因此不會被誤判成公元前。
  const shortBce = /(?<![\u4e00-\u9fa5])前(\d{1,4})年/.exec(text);
  if (shortBce) {
    const year = Number(shortBce[1]);
    if (!Number.isFinite(year) || year <= 0) return null;
    const value = -year;
    return {
      text,
      kind: approximateInText ? "approximate" : "bce-year",
      sortKey: value,
      startYear: value,
      endYear: value,
      approximate: approximateInText,
      exact: !approximateInText,
    };
  }

  const ceYear = /(?:公元)?(\d{3,4})年/.exec(text);
  if (ceYear) {
    const year = Number(ceYear[1]);
    if (!Number.isFinite(year) || year <= 0) return null;
    return {
      text,
      kind: approximateInText ? "approximate" : "year",
      sortKey: year,
      startYear: year,
      endYear: year,
      approximate: approximateInText,
      exact: !approximateInText,
    };
  }

  const century = /([元前後]?)(\d{1,2}|[一二三四五六七八九十兩]{1,3})世紀(初|早期|前期|中葉|中期|後期|晚期|末)?/.exec(
    text,
  );
  if (century) {
    const raw = century[2]!;
    const digits = /^\d+$/.test(raw) ? Number(raw) : parseChineseNumeral(raw);
    if (digits === null || !Number.isFinite(digits) || digits <= 0) return null;
    const centuryStart = (digits - 1) * 100;
    const centuryEnd = centuryStart + 99;
    const modifier = century[3] ?? null;
    // 修飾語把可能的年份範圍收窄，但仍然不是明確年份
    const range: Record<string, [number, number]> = {
      初: [centuryStart, centuryStart + 19],
      早期: [centuryStart, centuryStart + 32],
      前期: [centuryStart, centuryStart + 32],
      中葉: [centuryStart + 30, centuryStart + 69],
      中期: [centuryStart + 30, centuryStart + 69],
      後期: [centuryStart + 66, centuryEnd],
      晚期: [centuryStart + 66, centuryEnd],
      末: [centuryStart + 80, centuryEnd],
    };
    const [startYear, endYear] = range[modifier ?? ""] ?? [centuryStart, centuryEnd];
    return {
      text,
      // 跨世紀範圍（十四至十七世紀）由呼叫端以 range 標示；單一世紀一律是 century
      kind: "century",
      sortKey: startYear,
      startYear,
      endYear,
      approximate: true,
      exact: false,
    };
  }

  return null;
}

/** 跨世紀／跨年份的範圍寫法（「十四至十七世紀」、「1914至1918年」、「十八至十九世紀」） */
export function parseTimeRange(time: string): MaterialPeriod | null {
  const text = time.replace(/\s+/g, "").replace(/,/g, "");
  const match = /^(.+?)(?:至|到|~|～|-|—|–)(.+)$/.exec(text);
  if (!match) return null;
  const left = match[1]!;
  const right = match[2]!;
  // 「十四至十七世紀」只寫了一次單位：把後半的單位（世紀／年）補到前半才可解析
  const unit = /(世紀|年)$/.exec(right)?.[1] ?? "";
  const normalizedLeft = unit !== "" && !left.endsWith(unit) ? `${left}${unit}` : left;
  const start = parseTimeExpression(normalizedLeft);
  const end = parseTimeExpression(right);
  if (!start || !end) return null;
  const startYear = Math.min(start.startYear, end.startYear);
  const endYear = Math.max(start.endYear, end.endYear);
  return {
    text,
    kind: "range",
    sortKey: startYear,
    startYear,
    endYear,
    approximate: start.approximate || end.approximate,
    exact: false,
  };
}

/** 解析時間寫法（先嘗試範圍，再嘗試單一時間） */
export function parseTimePeriod(time: string): MaterialPeriod | null {
  return parseTimeRange(time) ?? parseTimeExpression(time);
}

/**
 * 年份／世紀的**排序值**（公元前為負；「十八世紀」取該世紀的開始年份）。
 *
 * 保留此函式供既有呼叫者使用，語意等同 `parseTimePeriod(time)?.sortKey`：
 * **只用於排序，不可當作已核實的準確年份**（見 `MaterialPeriod`）。
 */
export function parseTimeSortKey(time: string): number | null {
  return parseTimePeriod(time)?.sortKey ?? null;
}

/* ------------------------------------------------------------------ */
/* 分析                                                                */
/* ------------------------------------------------------------------ */

/**
 * 分析檢索到的教材。
 *
 * 只分析傳入的段落（即生成題目時實際提供給模型的同一批內容），
 * 因此模型與閘門看到的是同一份材料，不會出現「閘門用其他段落判斷」的情況。
 */
export function analyseMaterial(input: MaterialAnalysisInput): MaterialAnalysis {
  const units = input.units.filter((unit) => unit.text.trim().length > 0);
  const concepts: MaterialConcept[] = [];
  const events: MaterialEvent[] = [];
  const relations: MaterialRelation[] = [];
  const claims: MaterialClaim[] = [];
  const conceptKeys = new Set<string>();
  const eventKeys = new Set<string>();
  const relationKeys = new Set<string>();

  for (const unit of units) {
    const evidence = evidenceOf(unit);
    for (const sentence of sentencesOf(unit)) {
      for (const match of sentence.matchAll(QUOTED_TERM_PATTERN)) {
        const term = match[1]!.trim();
        const key = `${normalizeForMatch(term)}@${unit.blockId}`;
        if (term.length >= 2 && !conceptKeys.has(key)) {
          conceptKeys.add(key);
          concepts.push({ term, kind: "quoted", evidence });
        }
      }
      for (const match of sentence.matchAll(DOCUMENT_PATTERN)) {
        const term = match[1]!.trim();
        const key = `${normalizeForMatch(term)}@${unit.blockId}`;
        if (!conceptKeys.has(key)) {
          conceptKeys.add(key);
          concepts.push({ term, kind: "document", evidence });
        }
      }
      const definition = DEFINITION_PATTERN.exec(sentence);
      if (definition) {
        const term = definition[1]!.trim();
        const key = `${normalizeForMatch(term)}@${unit.blockId}`;
        // 定義句式的主語才是關鍵詞：右邊是說明，左邊是詞語
        if (term.length >= 2 && term.length <= 16 && !conceptKeys.has(key)) {
          conceptKeys.add(key);
          concepts.push({ term, kind: "defined", evidence });
        }
      }

      const timeMatch = TIME_PATTERN.exec(sentence);
      if (timeMatch) {
        const time = `${timeMatch[1] ? "約" : ""}${timeMatch[2]!.replace(/\s+/g, "")}`;
        const period = parseTimePeriod(time);
        if (period !== null) {
          const key = `${period.sortKey}@${normalizeForMatch(sentence).slice(0, 12)}`;
          if (!eventKeys.has(key)) {
            eventKeys.add(key);
            events.push({
              time,
              sortKey: period.sortKey,
              period: { ...period, text: time },
              statement: sentence,
              evidence,
            });
          }
        }
      }

      const causal = firstMarker(sentence, CAUSE_MARKERS) ?? (bareCausalYin(sentence) ? "因" : null);
      if (causal !== null) {
        const key = `cause-consequence@${normalizeForMatch(sentence)}`;
        if (!relationKeys.has(key)) {
          relationKeys.add(key);
          relations.push({ dimension: "cause-consequence", marker: causal, statement: sentence, evidence });
        }
      }
      const change = firstMarker(sentence, CHANGE_MARKERS);
      if (change !== null) {
        const key = `change-continuity@${normalizeForMatch(sentence)}`;
        if (!relationKeys.has(key)) {
          relationKeys.add(key);
          relations.push({ dimension: "change-continuity", marker: change, statement: sentence, evidence });
        }
      }
      const comparison = firstMarker(sentence, COMPARISON_MARKERS);
      if (comparison !== null) {
        const key = `comparison@${normalizeForMatch(sentence)}`;
        if (!relationKeys.has(key)) {
          relationKeys.add(key);
          relations.push({ dimension: "comparison", marker: comparison, statement: sentence, evidence });
        }
      }
      const significance = firstMarker(sentence, SIGNIFICANCE_MARKERS);
      if (significance !== null) {
        const key = `significance@${normalizeForMatch(sentence)}`;
        if (!relationKeys.has(key)) {
          relationKeys.add(key);
          relations.push({ dimension: "significance", marker: significance, statement: sentence, evidence });
        }
      }

      // 陳述句：教材明確交代（有年份、有定義、有關係標記）或帶推測語氣
      const inference = firstMarker(sentence, INFERENCE_MARKERS);
      if (sentence.length >= 10) {
        claims.push({
          statement: sentence,
          kind: inference === null ? "explicit" : "inference",
          evidence,
        });
      }
    }
  }

  events.sort((left, right) => left.sortKey - right.sortKey);

  const documents = new Set(units.map((unit) => unit.sourceLocation.split("·")[0]!.trim()));
  // 時序題只可以在**教材真的支持先後次序**時出現：至少要有一對事件的時間範圍
  // 完全不重疊（例如「十八世紀」與「十九世紀」）。兩件同屬「十九世紀」的事件，
  // 教材沒有交代先後，因此不可出排序題（見下方 ambiguous-event-order）。
  const orderEstablished = hasEstablishedOrder(events);
  const chronological = events.length >= 2 && orderEstablished;
  const comparisonSubjects = new Set(
    concepts.filter((concept) => concept.kind !== "defined").map((concept) => normalizeForMatch(concept.term)),
  );
  const dimensions: Record<MaterialDimension, boolean> = {
    chronology: chronological,
    "cause-consequence": relations.some((relation) => relation.dimension === "cause-consequence"),
    "change-continuity": relations.some((relation) => relation.dimension === "change-continuity"),
    comparison:
      relations.some((relation) => relation.dimension === "comparison") && comparisonSubjects.size >= 2,
    significance: relations.some((relation) => relation.dimension === "significance"),
  };

  const limitations: MaterialLimitation[] = [];
  if (units.length < 3) {
    limitations.push({
      code: "too-little-material",
      message: `這次只取得 ${units.length} 段教材，不足以支持需要跨段綜合的題目（應改為單一史實的題目）。`,
    });
  }
  if (documents.size <= 1 && units.length < 6) {
    limitations.push({
      code: "single-document",
      message: "教材內容只來自同一份文件的少數段落，跨段落比較的題目資料不足。",
    });
  }
  if (units.length > 0 && units.every((unit) => unit.fromOcr === true)) {
    limitations.push({
      code: "ocr-only",
      message: "這次可用的教材全部來自圖片 OCR 辨識，文字可能不完整，不應出考核細節的題目。",
    });
  }
  if (events.length === 0) {
    limitations.push({
      code: "no-dated-events",
      message: "教材沒有交代任何年份或世紀，不可出時序或年份題。",
    });
  } else if (events.length === 1) {
    limitations.push({
      code: "single-dated-event",
      message: "教材只有一件帶年份的事件，不可出排序或比較時序的題目。",
    });
  } else if (!orderEstablished) {
    limitations.push({
      code: "ambiguous-event-order",
      message:
        `教材提到 ${events.length} 個時間，但它們的時間範圍互相重疊（例如同屬一個世紀的不同寫法），` +
        "教材沒有交代先後次序，因此不可出要求排序或判斷先後的題目。",
    });
  }
  if (!dimensions["cause-consequence"]) {
    limitations.push({
      code: "no-causal-relation",
      message: "教材沒有交代因果關係，不可出「為甚麼」、「有甚麼影響」一類需要推論因果的題目。",
    });
  }
  if (!dimensions["change-continuity"]) {
    limitations.push({
      code: "no-change-relation",
      message: "教材沒有交代轉變或延續，不可出「有甚麼轉變」一類的題目。",
    });
  }
  if (!dimensions.comparison) {
    limitations.push({
      code: "no-comparison-material",
      message: "教材沒有可比較的兩項資料，不可出「試比較」一類的題目。",
    });
  }
  if (!dimensions.significance) {
    limitations.push({
      code: "no-significance-statement",
      message: "教材沒有交代歷史意義或影響，不可出「有何歷史意義」一類的題目。",
    });
  }

  const relationsByBlock = new Map<string, MaterialRelation[]>();
  for (const relation of relations) {
    const list = relationsByBlock.get(relation.evidence.blockId) ?? [];
    list.push(relation);
    relationsByBlock.set(relation.evidence.blockId, list);
  }

  return {
    topicTitle: input.topicTitle ?? "",
    sectionTitle: input.sectionTitle ?? "",
    levelLabel: input.levelLabel ?? "",
    themeText: input.themeText ?? "",
    learningFocusText: input.learningFocusText ?? "",
    unitCount: units.length,
    documentCount: documents.size,
    concepts,
    events,
    relations,
    claims,
    dimensions,
    limitations,
    hasDimensionInBlocks(dimension, blockIds) {
      if (blockIds.length === 0) return dimensions[dimension];
      if (dimension === "chronology") {
        // 時序：引用段落內要有**可比較先後**的兩個時間（見 hasEstablishedOrder）
        const dated = events.filter((event) => blockIds.includes(event.evidence.blockId));
        return dated.length >= 2 && hasEstablishedOrder(dated);
      }
      return blockIds.some((blockId) =>
        (relationsByBlock.get(blockId) ?? []).some((relation) => relation.dimension === dimension),
      );
    },
    hasExactYearInBlocks(blockIds) {
      return events.some(
        (event) =>
          event.period.exact &&
          (blockIds.length === 0 || blockIds.includes(event.evidence.blockId)),
      );
    },
  };
}

/**
 * 教材是否交代了**可判斷的先後次序**。
 *
 * 只有當兩個事件的時間範圍完全不重疊時，先後才成立：
 *   - 「十八世紀」與「十九世紀」→ 成立（1700–1799 早於 1800–1899）
 *   - 「十九世紀」與「十九世紀末」→ 不成立（兩者範圍重疊）
 * `sortKey` 只用於排序，因此在範圍重疊時**不可**因為 sortKey 不同就當作已交代先後。
 */
function hasEstablishedOrder(events: MaterialEvent[]): boolean {
  const sorted = [...events].sort((left, right) => left.period.startYear - right.period.startYear);
  const earliest = sorted[0];
  if (!earliest) return false;
  return sorted.some((event) => event.period.startYear > earliest.period.endYear);
}

/* ------------------------------------------------------------------ */
/* 提示詞用的摘要                                                      */
/* ------------------------------------------------------------------ */

/** 分析中「教材明確交代」的陳述（推測語氣者不列入，避免當成史實） */
export function explicitStatements(analysis: MaterialAnalysis, limit = 8): string[] {
  return analysis.claims
    .filter((claim) => claim.kind === "explicit")
    .slice(0, limit)
    .map((claim) => claim.statement);
}

/**
 * 把時間寫成提示詞用的說明：保留教材原樣寫法，並標示它可以支持甚麼。
 * 世紀／約數會寫出可能範圍，提醒模型不要當成準確年份。
 */
export function formatPeriod(event: MaterialEvent): string {
  const { text, kind, startYear, endYear, exact, approximate } = event.period;
  if (exact && !approximate) return text;
  const range = startYear === endYear ? `${startYear}` : `${startYear}–${endYear}`;
  const label =
    kind === "century"
      ? "世紀（約數，不可當成準確年份）"
      : kind === "approximate"
        ? "約數"
        : kind === "range"
          ? "時間範圍"
          : "非明確年份";
  return `${text}（${label}；約 ${range} 年）`;
}

/**
 * 把分析結果寫成提示詞段落。
 *
 * 只列出教材**實際支持**的面向；不支持的面向會列在「不可考核」清單，
 * 令模型不會為了出題而自行補上教材沒有的因果或比較。
 */
export function materialAnalysisPrompt(analysis: MaterialAnalysis): string {
  if (analysis.unitCount === 0) return "";

  const lines: string[] = ["教材分析（由系統按教材原文整理，只反映教材實際交代的內容）："];
  const supported = (Object.keys(MATERIAL_DIMENSION_LABELS) as MaterialDimension[]).filter(
    (dimension) => analysis.dimensions[dimension],
  );
  lines.push(
    `- 可考核的思考面向：${supported.length > 0 ? supported.map((dimension) => MATERIAL_DIMENSION_LABELS[dimension]).join("、") : "（只有單一史實，只可考辨認與理解）"}`,
  );

  if (analysis.concepts.length > 0) {
    lines.push(
      `- 關鍵詞語（${analysis.concepts.length} 項，前 ${Math.min(8, analysis.concepts.length)} 項）：${analysis.concepts
        .slice(0, 8)
        .map((concept) => `${concept.term}（${concept.evidence.sourceLocation}）`)
        .join("、")}`,
    );
  }
  if (analysis.events.length > 0) {
    lines.push(
      `- 教材交代的時序：${analysis.events
        .slice(0, 10)
        .map((event) => `${formatPeriod(event)}（${event.evidence.sourceLocation}）`)
        .join(" → ")}`,
    );
    const exactYears = analysis.events.filter((event) => event.period.exact);
    if (exactYears.length === 0) {
      lines.push(
        "- 教材沒有寫出任何**明確年份**（只有世紀或約數）：不可出要求學生答出準確年份的題目，" +
          "亦不可把「十八世紀」寫成 1700 年。",
      );
    }
    if (analysis.limitations.some((limitation) => limitation.code === "ambiguous-event-order")) {
      lines.push("- 教材提到的時間範圍互相重疊，先後次序未能確定：不可出要求排序或判斷先後的題目。");
    }
  }
  const causeAndEffect = analysis.relations.filter(
    (relation) => relation.dimension === "cause-consequence",
  );
  if (causeAndEffect.length > 0) {
    lines.push(
      `- 教材交代的因果關係：${causeAndEffect
        .slice(0, 4)
        .map((relation) => `「${relation.statement}」`)
        .join("；")}`,
    );
  }
  const changes = analysis.relations.filter((relation) => relation.dimension === "change-continuity");
  if (changes.length > 0) {
    lines.push(`- 教材交代的轉變／延續：${changes.slice(0, 3).map((relation) => `「${relation.statement}」`).join("；")}`);
  }
  const comparisons = analysis.relations.filter((relation) => relation.dimension === "comparison");
  if (comparisons.length > 0 && analysis.dimensions.comparison) {
    lines.push(`- 教材交代的比較：${comparisons.slice(0, 3).map((relation) => `「${relation.statement}」`).join("；")}`);
  }
  const significance = analysis.relations.filter((relation) => relation.dimension === "significance");
  if (significance.length > 0) {
    lines.push(
      `- 教材交代的意義／影響：${significance.slice(0, 3).map((relation) => `「${relation.statement}」`).join("；")}`,
    );
  }

  const unavailable = analysis.limitations.filter((limitation) =>
    [
      "no-dated-events",
      "single-dated-event",
      "no-causal-relation",
      "no-change-relation",
      "no-comparison-material",
      "no-significance-statement",
      "too-little-material",
      "single-document",
      "ocr-only",
    ].includes(limitation.code),
  );
  if (unavailable.length > 0) {
    lines.push("- 教材**沒有**交代（因此不可出這類題目）：");
    for (const limitation of unavailable) lines.push(`  - ${limitation.message}`);
  }

  lines.push(
    "- 出題要求：先想清楚這條題目要考核哪一項歷史理解（例如因果、時序、轉變、比較、影響），" +
      "再由教材的說明組織題目文字；不可把教材一句話挖空當作題目，也不可考核上表沒有交代的內容。",
  );
  return lines.join("\n");
}
