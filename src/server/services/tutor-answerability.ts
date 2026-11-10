/**
 * 學伴的可答性與證據政策（Sprint 29，2026-11-07）。
 *
 * ── 為甚麼需要這一層 ────────────────────────────────────────────────
 * 檢索是否命中，與「這條問題是否值得、是否可以回答」是兩件事。舊有實作把兩者混在
 * 同一個硬閘裡：只要詞庫／課程用語沒有逐字命中，提問就會被當成離題，學生收到固定
 * 引導句「只能討論歷史科」。實際例子（本機唯讀探測）：
 *   - 「蒙古帝國點解會分裂？」→ 被判離題（詞庫沒有「蒙古帝國」）
 *   - 「香港係幾時割讓俾英國？」→ 被判離題（課程關鍵詞沒有「割讓」）
 *   - 「什麼是種族隔離？」→ 被判離題（課程沒有這個課題）
 * 這些都是清楚、可理解的歷史提問，只是教材未涵蓋或用了課程以外的寫法。反過來，
 * `isHistoryTopicPrompt` 昔日只要句中有年份或英文疑問詞就放行，於是
 * 「Who won the World Cup in 2022?」亦會進入歷史學伴回答。
 *
 * 這一層把「是否歷史提問」與「教材是否支持」分開，並明確分成四個可答性狀態：
 *
 *   A 教材足以支持（material-supported）
 *   B 教材只部分支持（partial-material-support）
 *   C 教材未涵蓋，但問題清楚且屬歷史科 → **必須作答**，並清楚標示一般歷史知識
 *   D 真正無法判斷 → 只問一條澄清問題
 *
 * 另加一個不屬於四個狀態的 `out-of-scope`：明確不是歷史提問（寫詩、天氣、體育賽果），
 * 沿用原有引導句。這一層只做**判斷**，不會自行呼叫模型，也不改動檢索門檻。
 *
 * ── 設計邊界（不可放寬）────────────────────────────────────────────
 *   1. 不降低檢索分數門檻：無關段落仍然不會被選入，`out-of-scope` 段落不會成為依據；
 *   2. C 狀態只允許「一般歷史知識」，並且必須標明；不可假稱課本內容或虛構出處；
 *   3. 只以「歷史題材的類別形態」（事件、政體、時段、人物角色、史學概念）判斷，
 *      不為個別問題加關鍵詞；
 *   4. 年份單獨出現不足以證明是歷史提問：近代（2000 年後）年份要有歷史題材形態
 *      才放行，否則體育、娛樂等時事問題會再次誤入。
 */
import {
  findLooseHistoryTerms,
  normalizeHistoryAnswer,
} from "@/lib/history-lexicon";
import type { TutorGrounding } from "./tutor-grounding";
import { matchesCurriculumTerms, type TutorCurriculumIndex } from "./tutor-grounding";
import { hasExplicitVagueness, hasHistoricalYearSignal, isClearlyNonHistoryTutorQuery, normalizeTutorQuery } from "./tutor-query";
import { isHistoryTopicPrompt, isShortHistoryFollowUp } from "./tutor";

/** 歷史年代界限（與 `services/tutor-query.ts` 共用同一常數，避免兩處不一致） */
export { TUTOR_HISTORICAL_ERA_LAST_YEAR } from "./tutor-query";

/** 歷史科學伴的四個可答性狀態（`out-of-scope` 不屬其中之一） */
export type TutorAnswerabilityState =
  | "A-material-supported"
  | "B-partial-material-support"
  | "C-general-knowledge"
  | "D-needs-clarification"
  | "out-of-scope";

export type TutorAnswerabilityScope = "history" | "out-of-scope";

export type TutorMaterialEvidence = "sufficient" | "partial" | "none";

/**
 * 教材對「提問所問的關係」的支持程度（Sprint 30）。
 *
 * A 狀態原本只看「提問關鍵詞是否全部出現」，但字詞重疊不等於事實支持：
 *   - 段落出現「革命」「經濟」，不代表它解釋了經濟如何導致革命；
 *   - 段落提供背景，不代表支持提問要求的結論。
 * 因此另設一層：`direct`（片段直接交代所問關係）／`inferential`（只有關鍵詞重疊
 * 或只有背景，需要推論）／`insufficient`（有片段但不足以支持）／`none`（沒有片段）。
 * 只有 `direct` 可以標示為 A；其餘一律降為 B（並要求披露）。
 */
export type TutorEvidenceSupport = "direct" | "inferential" | "insufficient" | "none";

/**
 * C 狀態的信心層級（Sprint 30）。
 *
 * C 仍然是「必須作答」，但「可以答得多肯定」不同：
 *   - C1 可靠的一般歷史知識：直接作答並標明；
 *   - C2 只有部分知識或存在史學爭議：答可靠部分，說明不確定及爭議；
 *   - C3 沒有可靠依據（例如要求逐字引文、精確數字）：不可虛構，說明無法核實
 *     的部分及需要甚麼證據。
 * **C3 不是拒絕機制**：仍要交代可確認的背景。
 */
export type TutorCConfidence =
  | "C1-reliable"
  | "C2-partial-or-disputed"
  | "C3-no-reliable-basis";

export interface TutorAnswerabilityDecision {
  state: TutorAnswerabilityState;
  scope: TutorAnswerabilityScope;
  /** 問題在歷史上是否可理解／可作答（與教材檢索成敗無關） */
  historicalQuestion: boolean;
  materialEvidence: TutorMaterialEvidence;
  /** 教材是否直接支持所問的關係（見 `TutorEvidenceSupport`） */
  evidenceSupport: TutorEvidenceSupport;
  /** 判斷證據支持程度的原因（診斷及教師套件用） */
  evidenceNotes: string[];
  /** 只在 C 狀態有值；A／B／D／out-of-scope 為 `null` */
  confidence: TutorCConfidence | null;
  /** 是否允許以一般歷史知識作答（B 的缺口部分及 C） */
  allowGeneralKnowledge: boolean;
  /** 是否必須在回覆中披露教材涵蓋範圍的限制 */
  requireDisclosure: boolean;
  /** 診斷用：得出此判斷的原因（不顯示給學生、不寫入資料庫） */
  reason: string;
}

/**
 * 歷史題材的類別形態（**類別，不是個別答案**）。
 *
 * 只收「一望而知屬於歷史討論對象」的字詞形態：事件類型、政體與制度、社會結構、
 * 史學概念。它們不會令答案變成教材說法，只用於決定「這是否一個歷史問題」。
 */
const HISTORICAL_EVENT_TERMS: readonly string[] = [
  "戰爭",
  "大戰",
  "戰役",
  "戰場",
  "內戰",
  "參戰",
  "宣戰",
  "開戰",
  "革命",
  "起義",
  "叛亂",
  "政變",
  "改革",
  "維新",
  "運動",
  "條約",
  "和約",
  "協定",
  "宣言",
  "入侵",
  "侵略",
  "佔領",
  "割讓",
  "屠殺",
  "滅絕",
  "獨立",
  "統一",
  "分裂",
  "聯盟",
  "同盟",
  "結盟",
  "停戰",
  "投降",
  "封鎖",
  "制裁",
  "審判",
  "遠征",
  "航海",
  "殖民",
  "移民",
  "貿易",
  "軍備",
  "條文",
];

const HISTORICAL_POLITY_TERMS: readonly string[] = [
  "帝國",
  "王朝",
  "朝代",
  "王國",
  "共和",
  "君主",
  "皇帝",
  "天皇",
  "國王",
  "女王",
  "總統",
  "首相",
  "議會",
  "憲法",
  "聯邦",
  "城邦",
  "殖民地",
  "獨裁",
  "極權",
  "專制",
  "封建",
  "民主",
  "共產",
  "資本主義",
  "社會主義",
  "法西斯",
  "納粹",
];

const HISTORICAL_CONCEPT_TERMS: readonly string[] = [
  "民族主義",
  "帝國主義",
  "殖民主義",
  "宗教改革",
  "文藝復興",
  "啟蒙",
  "工業化",
  "冷戰",
  "種族",
  "族群",
  "歧視",
  "隔離",
  "奴隸",
  "階級",
  "意識形態",
  "史觀",
  "史學",
];

/**
 * 特定歷史專名：朝代、事件、地標、器物、國際組織。
 *
 * 為甚麼需要（2026-11-10 模擬）：學生很少寫出教科書的 headword（「宗教改革」
 * 「工業革命」），但很自然會寫「教會」「蒸汽機」「柏林圍牆」。原本的詞表只有
 * **類別詞**（戰爭、條約、革命…）及 headword，於是「日本點解要偷襲美國嗰個海軍
 * 基地？」「柏林嗰道牆幾時拆？」這類正常提問全部被當成離題拒答。
 *
 * 收錄條件（兩項都要符合）：
 *   ① 在課程教材確實出現（2026-11-10 以唯讀查詢核對 `data/app.db` 的段數）；
 *   ② 日常用法幾乎不離歷史語境（故不收「學校」「比賽」「遊戲」等）。
 */
const HISTORICAL_PROPER_TERMS: readonly string[] = [
  // 朝代／政權
  "清朝",
  "明朝",
  "宋朝",
  "唐朝",
  "漢朝",
  "秦朝",
  "民國",
  "蘇聯",
  "日本帝國",
  // 事件、地標、器物、文獻（教材段數：珍珠港 7、柏林圍牆 13、文化大革命 14、
  // 明治維新 15、獨立宣言 14、蒸汽機 12、古巴 64、新界 75、清朝 17、歐盟 41、聯合國 291）
  "珍珠港",
  "柏林圍牆",
  "文化大革命",
  "明治維新",
  "獨立宣言",
  "蒸汽機",
  "大屠殺",
  "古巴",
  "新界",
  "香港島",
  "租借",
  "開埠",
  "轉口港",
  "一國兩制",
  "日心說",
  "地心說",
  "哥白尼",
  // 國際組織
  "聯合國",
  "歐盟",
  "北約",
  "國際聯盟",
];

/**
 * 日常歷史詞彙：本身也是常用詞，只在**確實是提問句**時才計入歷史訊號，
 * 避免「工廠大廈幾點關門」這類生活問題被當成歷史題。
 */
const HISTORICAL_EVERYDAY_TERMS: readonly string[] = [
  "教會",
  "教皇",
  "修道院",
  "工廠",
  "煤礦",
  "農業",
  "村民",
  "運河",
  "鐵路",
  "非洲",
  "偷襲",
];

/**
 * 英文歷史題材（同樣是類別形態）。
 *
 * 必須在**原文**比對：`normalizeTutorQuery` 會去掉空格，英文句子黏成一串，
 * `\b` 邊界再也分不到詞。
 */
const HISTORICAL_TERMS_EN =
  /\b(?:revolution|wars?|treaty|empire|dynasty|reformation|independence|colon(?:y|ies|ial|isation|ization)|civil\s+war|coup|genocide|holocaust|fascis[mt]|nationalis[mt]|imperialis[mt]|communis[mt]|monarch(?:y)?|republic|parliament|constitution|assassination|annexation|armistice|surrender|feudal(?:ism)?|slavery|enslavement|crusades?|imperial|colonial|sovereignty|czar|tsar|emperor|empress|pharaoh|dynastic|decolonisation|decolonization|industrialisation|industrialization|enlightenment|renaissance)\b/i;

const HISTORICAL_PERIODS =
  /(?:公元前|公元|西元)\s*\d{1,4}|(?<!\d)\d{1,4}\s*(?:世紀|年代)|古代|中古|中世紀|近代史|現代史|史前|上古/;

/** 提問形態：辨識「這是一條問題」而非陳述 */
const QUESTION_SHAPE =
  /(?:甚麼|什麼|咩|邊個|邊位|誰|何時|幾時|哪一?年|邊一年|點解|為甚麼|為什麼|為何|如何|怎樣|點樣|試述|分析|比較|評價|評估|判斷|影響|成因|原因|背景|經過|結果|後果|意義|重要性|分別|異同|特色|特點|是否|係咪|對嗎|對唔對|啱唔啱|有冇|有沒有|角色|作用|關係|幾多|引用|原文|引文|逐字)/;

const QUESTION_SHAPE_EN =
  /(?:\b(?:who|whose|what|when|where|which|why|how|explain|describe|compare|contrast|discuss|evaluate|assess|analyse|analyze|was|were|did|does|is|are|role)\b)/i;

/**
 * 只有上文、沒有具體指涉對象的寫法（「呢個條約」「上述政策」「兩者」「那三位」）。
 * 必須是**句子開首**的指示詞／代詞：像「南京條約嗰個」這種已點名對象的寫法
 * 不是含混，只是口語語序。
 *
 * 注意：`normalizeTutorQuery` 會把粵語寫法改寫（「嗰個」→「那個」、「嗰三個」→
 * 「那三位」），因此兩種寫法都要收。
 */
const DANGLING_REFERENCE_ZH =
  /^(?:咁|即係|所以|但|而且|然後)?(?:呢個|這個|嗰個|那個|那(?:個|位|件|條|項|種|些)|上述|前述|兩者|兩件|佢哋?|他們?|它|該(?:條約|政策|事件|制度)|嗰啲)/;

/**
 * 「嗰三個」「那兩位」：數量指示本身就依賴上文，即使不在句首亦屬缺少指涉對象
 * （實測：「藝術嗰三個邊個最勁」不應直接假定為文藝復興三傑）。
 */
const DANGLING_COUNT_REFERENCE = /[那嗰][一二三四五六七八九十幾]\s*(?:個|位|件|條|項|種)/;

/**
 * 沒有上文時的「裸追問」：「之後點」「之後呢」「咁跟住呢」。
 * 這不是歷史提問，也不是離題要求，而是缺少指涉對象的追問——只可澄清。
 */
const BARE_FOLLOW_UP =
  /^(?:咁|那)?(?:之後|跟住|然後|後來|結果|同埋|仲有|還有)(?:點|呢|呀|啊|如何|點樣)?(?:呀|啊|呢)?$/;

/**
 * 英文的代詞／指示詞必須有詞界：沒有 `\b` 時，`it` 會命中 `British`，
 * 令正常的比較題被當成「只有上文、沒有指涉對象」。
 */
const DANGLING_REFERENCE_EN =
  /\b(?:this|that|these|those|both|it|they|them)\b/i;

/** 有上文時，可用作追問的句式（角色、作用、影響、原因、之後…） */
const FOLLOW_UP_QUESTION_SHAPE =
  /(?:角色|作用|影響|原因|點解|為何|為甚麼|為什麼|之後|結果|後果|仲有|還有|更|簡單|例子|成功|失敗|重要|爭議|代價|好處|壞處|正確|對嗎|同意|評價|why|how|role|impact|effect|example|simpler|success|fail|important|significan|agree|correct)/;

const YEAR_PATTERN = /(?:公元前|公元|西元)?\s*\d{1,4}\s*(?:年|世紀|年代)?/g;

export function hasHistoricalSubjectShape(raw: string): boolean {
  const normalized = normalizeHistoryAnswer(raw);
  if (normalized.length === 0) return false;
  const zhTerms = [
    ...HISTORICAL_EVENT_TERMS,
    ...HISTORICAL_POLITY_TERMS,
    ...HISTORICAL_CONCEPT_TERMS,
    ...HISTORICAL_PROPER_TERMS,
  ];
  if (zhTerms.some((term) => normalized.includes(normalizeHistoryAnswer(term)))) return true;
  if (HISTORICAL_TERMS_EN.test(raw)) return true;
  return HISTORICAL_PERIODS.test(normalized);
}

export function hasQuestionShape(raw: string): boolean {
  return QUESTION_SHAPE.test(normalizeTutorQuery(raw)) || QUESTION_SHAPE_EN.test(raw);
}

export interface TutorHistoricalQuestionInput {
  message: string;
  curriculum: TutorCurriculumIndex;
  hasHistoryContext: boolean;
}

/**
 * 是否一個歷史提問（與教材是否涵蓋無關）。
 *
 * 判斷次序：明確非歷史 → 詞庫／課程用語 → 歷史題材形態（含教材常見專名）
 * → 日常歷史詞彙（需同時是提問句）→ 有上文時的追問 → 1999 年或以前的年份。
 * 任何一項成立即屬歷史提問。
 */
export function isHistoricalTutorQuestion(input: TutorHistoricalQuestionInput): boolean {
  const raw = input.message;
  if (isClearlyNonHistoryTutorQuery(raw)) return false;

  const normalized = normalizeTutorQuery(raw);
  const withoutYears = normalized.replace(YEAR_PATTERN, "");

  if (isHistoryTopicPrompt(withoutYears)) return true;
  if (findLooseHistoryTerms(withoutYears).length > 0) return true;
  if (matchesCurriculumTerms(input.curriculum, withoutYears)) return true;
  if (hasHistoricalSubjectShape(raw)) return true;
  // 日常歷史詞彙（教會、工廠、農業…）只在這句確實是提問時才計入，
  // 詳見 HISTORICAL_EVERYDAY_TERMS 的說明。
  if (
    hasQuestionShape(raw) &&
    HISTORICAL_EVERYDAY_TERMS.some((term) =>
      normalized.includes(normalizeHistoryAnswer(term)),
    )
  ) {
    return true;
  }

  if (input.hasHistoryContext) {
    if (isShortHistoryFollowUp(raw)) return true;
    if (FOLLOW_UP_QUESTION_SHAPE.test(normalized) || FOLLOW_UP_QUESTION_SHAPE.test(raw)) {
      return true;
    }
    if (DANGLING_REFERENCE_ZH.test(raw) || DANGLING_REFERENCE_EN.test(raw)) return true;
  }

  const year = hasHistoricalYearSignal(raw);
  if (year) return true;
  return false;
}

export interface TutorAnswerabilityInput extends TutorHistoricalQuestionInput {
  grounding: TutorGrounding;
  /** `isUnclearTutorQuery` 的原有判斷（見 services/tutor-query.ts） */
  unclear: boolean;
  /**
   * 學生已在某課題脈絡下發問，而該課題教材確實包含提問用到的詞彙
   * （見 `tutor-grounding.messageUsesTopicVocabulary`）。
   *
   * 用途：字詞檢索失敗、又沒有命中詞庫時，仍可依「教材用過這些詞」判定為課程內
   * 提問，以 C（一般歷史知識 + 明確標示教材未涵蓋）作答，而不是拒答。
   */
  materialVocabularyMatched?: boolean;
  /**
   * 沒有課題脈絡，但提問使用了任何已發布教材內的詞彙
   * （見 `tutor-grounding.messageUsesAnyCourseVocabulary`）。
   *
   * 用途：不足以斷定屬於哪一課題、亦不可引用未確認的教材，因此只可澄清；
   * route 會在澄清前先試一次語意改寫，改寫後仍找不到教材才真正澄清。
   */
  courseVocabularyMatched?: boolean;
}

function hasDanglingReferenceWithoutContext(raw: string, hasHistoryContext: boolean): boolean {
  if (hasHistoryContext) return false;
  const normalized = normalizeTutorQuery(raw);
  if (BARE_FOLLOW_UP.test(normalized)) return true;
  if (DANGLING_REFERENCE_ZH.test(normalized)) return true;
  if (DANGLING_COUNT_REFERENCE.test(normalized)) return true;
  // 英文：只有代詞／指示詞而句中沒有任何具體歷史名詞時，才算缺少指涉對象。
  if (!DANGLING_REFERENCE_EN.test(raw)) return false;
  return (
    !isHistoryTopicPrompt(normalized.replace(YEAR_PATTERN, "")) &&
    findLooseHistoryTerms(normalized).length === 0
  );
}

function hasSpecificAnchor(input: TutorAnswerabilityInput): boolean {
  const normalized = normalizeTutorQuery(input.message);
  const withoutYears = normalized.replace(YEAR_PATTERN, "");
  return (
    isHistoryTopicPrompt(withoutYears) ||
    findLooseHistoryTerms(withoutYears).length > 0 ||
    matchesCurriculumTerms(input.curriculum, withoutYears) ||
    hasHistoricalSubjectShape(input.message)
  );
}

/** 提問所問的關係類型（用於核對片段是否真的支持所問，而非只有關鍵詞重疊） */
type AskedRelation = "causal" | "comparison" | "evaluative";

const CAUSAL_QUESTION =
  /(?:點解|為甚麼|為什麼|為何|原因|成因|導致|造成|引致|促成|影響|後果|結果|why|cause|caused|causes|reason|effect|impact|result)/i;
const COMPARISON_QUESTION =
  /(?:比較|異同|相同|相異|分別|差異|compare|contrast|similar|differen)/i;
const EVALUATIVE_QUESTION =
  /(?:評價|評估|判斷|多大程度|重要性|成功|失敗|爭議|同意|to what extent|evaluate|significance|failure|success)/i;

const CAUSAL_EVIDENCE =
  /(?:因為|由於|導致|造成|引致|促成|使|影響|結果|故|所以|because|due to|led to|caused|resulted in|as a result|impact)/i;
const COMPARISON_EVIDENCE =
  /(?:相同|相似|不同|相比|比較|異同|同樣|both|whereas|unlike|similarly|in contrast)/i;
const EVALUATIVE_EVIDENCE =
  /(?:重要|成功|失敗|成效|意義|爭議|評價|判斷|significan|success|fail|important|assess)/i;


function askedRelations(message: string): AskedRelation[] {
  const raw = message;
  const relations: AskedRelation[] = [];
  if (CAUSAL_QUESTION.test(raw)) relations.push("causal");
  if (COMPARISON_QUESTION.test(raw)) relations.push("comparison");
  if (EVALUATIVE_QUESTION.test(raw)) relations.push("evaluative");
  return relations;
}

function relationEvidencePresent(relation: AskedRelation, passageTexts: string[]): boolean {
  const pattern =
    relation === "causal"
      ? CAUSAL_EVIDENCE
      : relation === "comparison"
        ? COMPARISON_EVIDENCE
        : EVALUATIVE_EVIDENCE;
  return passageTexts.some((text) => pattern.test(text));
}


interface MaterialSupportAssessment {
  materialEvidence: TutorMaterialEvidence;
  evidenceSupport: TutorEvidenceSupport;
  notes: string[];
}

/**
 * 評估片段對提問的支持程度。
 *
 * **關鍵詞重疊只是必要條件，不是充分條件**：即使提問的所有關鍵詞都出現在片段中，
 * 若片段沒有交代提問所問的關係（因果／比較／評價），仍降為 `inferential`（B），
 * 由提示詞要求披露「片段只有背景／關鍵詞，沒有直接支持這個結論」。
 */
function assessMaterialSupport(
  message: string,
  grounding: TutorGrounding,
): MaterialSupportAssessment {
  const notes: string[] = [];
  const grounded = grounding.status === "grounded" && grounding.passages.length > 0;
  if (!grounded) {
    return { materialEvidence: "none", evidenceSupport: "none", notes: ["no-passages"] };
  }

  const uncovered = grounding.uncoveredTerms ?? [];
  const topicGap = (grounding.topicEvidence ?? []).some((topic) => topic.selectedPassages === 0);
  let partial = false;
  if (uncovered.length > 0) {
    partial = true;
    notes.push(`uncovered-terms:${uncovered.slice(0, 5).join("、")}`);
  }
  if (topicGap) {
    partial = true;
    notes.push("comparison-topic-gap");
  }

  const passageTexts = grounding.passages.map((passage) => passage.promptText);
  const relations = askedRelations(message);
  const unsupported = relations.filter(
    (relation) => !relationEvidencePresent(relation, passageTexts),
  );
  for (const relation of unsupported) notes.push(`relation-not-supported:${relation}`);


  // 多部分提問：問了兩種關係但片段只支持其中一種
  if (relations.length > 1 && unsupported.length > 0) {
    notes.push("multi-part-partial");
  }

  if (partial) {
    return { materialEvidence: "partial", evidenceSupport: "insufficient", notes };
  }
  if (unsupported.length > 0) {
    return { materialEvidence: "partial", evidenceSupport: "inferential", notes };
  }
  return { materialEvidence: "sufficient", evidenceSupport: "direct", notes };
}

const UNVERIFIABLE_EVIDENCE_REQUEST =
  /(?:原文|逐字|引文|引用原文|exact quote|quote (?:it|the)|(?:第\s*\d+\s*(?:頁|段))|(?:準確|精確|exactly)[^。？?]{0,6}(?:日期|年份|數字|人數)|exact (?:date|figure|number)|(?:死亡人數|傷亡數字|多少萬人))/i;

/**
 * C 狀態的信心層級。
 *
 * 只影響提示詞的謹慎程度，不會把問題變成拒絕；`C3` 仍要求交代可確認的背景。
 */
export function cConfidenceFor(message: string): TutorCConfidence {
  if (UNVERIFIABLE_EVIDENCE_REQUEST.test(message)) return "C3-no-reliable-basis";
  const contested =
    EVALUATIVE_QUESTION.test(message) ||
    /(?:爭議|爭論|史學|史觀|interpretation|contested|historians?\s+(?:disagree|debate))/i.test(
      message,
    );
  if (contested) return "C2-partial-or-disputed";
  // 只有題材形態、沒有詞庫或課程錨點（例如課程以外的專名）→ 只能答較概括的內容
  const normalized = normalizeTutorQuery(message);
  const withoutYears = normalized.replace(YEAR_PATTERN, "");
  const hasLexiconAnchor =
    isHistoryTopicPrompt(withoutYears) || findLooseHistoryTerms(withoutYears).length > 0;
  if (!hasLexiconAnchor) return "C2-partial-or-disputed";
  return "C1-reliable";
}

/**
 * 判斷本回合的可答性狀態。
 *
 * 明確非歷史 → `out-of-scope`（沿用原有引導句）。
 * 不可理解／只有含混指涉 → `D-needs-clarification`（只問一條澄清問題）。
 * 其餘按教材證據分成 A／B／C；**C 不是拒絕**：由提示詞要求以一般歷史知識作答並標明。
 */
export function classifyTutorAnswerability(
  input: TutorAnswerabilityInput,
): TutorAnswerabilityDecision {
  const raw = input.message;

  const base = {
    scope: "out-of-scope" as TutorAnswerabilityScope,
    historicalQuestion: false,
    materialEvidence: "none" as TutorMaterialEvidence,
    evidenceSupport: "none" as TutorEvidenceSupport,
    evidenceNotes: [] as string[],
    confidence: null as TutorCConfidence | null,
    allowGeneralKnowledge: false,
    requireDisclosure: false,
  };

  if (isClearlyNonHistoryTutorQuery(raw)) {
    return { ...base, state: "out-of-scope", reason: "explicit-non-history" };
  }

  const historicalQuestion = isHistoricalTutorQuestion(input);

  /**
   * 教材已有支持段落 → 這條提問屬於課程範圍，不可判為離題。
   *
   * 2026-11-10 模擬發現：學生在練習課題5 時問「點解啲人開始唔再信教會講嘅嘢？」，
   * 檢索已命中 topic-5 教材（`grounded`），但因為句子沒有詞庫專名而被拒答。
   * 「平台自己找到教材」與「這不是歷史問題」互相矛盾，因此以教材證據為準。
   * 只有完全找不到教材（`not-covered`）時，才可能因缺乏歷史訊號而離題。
   */
  const materialBacked =
    input.materialVocabularyMatched === true ||
    (input.grounding.status !== "not-covered" && input.grounding.topicId !== null);

  // 含糊是語言問題：即使句中沒有詞庫專名，只要寫法本身無法確定對象，就只可澄清。
  if (
    hasExplicitVagueness(raw) ||
    hasDanglingReferenceWithoutContext(raw, input.hasHistoryContext)
  ) {
    return {
      ...base,
      state: "D-needs-clarification",
      scope: "history",
      historicalQuestion: historicalQuestion || materialBacked,
      reason: historicalQuestion || materialBacked ? "ambiguous-wording" : "ambiguous-history-signal",
    };
  }

  if (!historicalQuestion && !materialBacked) {
    /**
     * 沒有課題脈絡，但提問用了教材內的詞彙（「美國點解要同英國分手？」）：
     * 學生確實在問課程會處理的題材，不可當成離題；但既不能斷定課題、也不可引用
     * 未確認的教材，因此只可澄清並列出可能方向（2026-11-10 模擬）。
     */
    if (input.courseVocabularyMatched === true && hasQuestionShape(raw)) {
      return {
        ...base,
        state: "D-needs-clarification",
        scope: "history",
        reason: "course-vocabulary-without-topic",
      };
    }
    return { ...base, state: "out-of-scope", reason: "no-history-signal" };
  }

  const anchor = hasSpecificAnchor(input);
  // 原有的「含混」判斷只在**沒有具體提問**時成立：單講一個課題名（「改革」「德國」）
  // 仍應澄清；但「明治維新點解成功？」這類有錨點、有明確問法的提問不可被當成含混
  // （Sprint 29 修正）。
  const needsClarification = input.unclear && !(anchor && hasQuestionShape(raw));

  if (needsClarification) {
    return {
      ...base,
      state: "D-needs-clarification",
      scope: "history",
      historicalQuestion: true,
      reason: "needs-clarification",
    };
  }

  const support = assessMaterialSupport(raw, input.grounding);
  const historyBase = {
    ...base,
    scope: "history" as TutorAnswerabilityScope,
    historicalQuestion: true,
    materialEvidence: support.materialEvidence,
    evidenceSupport: support.evidenceSupport,
    evidenceNotes: support.notes,
  };

  if (support.materialEvidence === "sufficient" && support.evidenceSupport === "direct") {
    return { ...historyBase, state: "A-material-supported", reason: "grounded-direct-support" };
  }
  if (support.materialEvidence !== "none") {
    return {
      ...historyBase,
      state: "B-partial-material-support",
      allowGeneralKnowledge: true,
      requireDisclosure: true,
      reason:
        support.evidenceSupport === "inferential"
          ? "grounded-inferential-support"
          : "grounded-with-gaps",
    };
  }
  return {
    ...historyBase,
    state: "C-general-knowledge",
    allowGeneralKnowledge: true,
    requireDisclosure: true,
    confidence: cConfidenceFor(raw),
    reason: "materials-not-covered",
  };
}
