/**
 * 解釋改進建議及歷史技能建議（純函式）。
 *
 * 用途：為「佔位解釋」「只列答案的解釋」「技能標籤空白」三類內容問題產生**可操作**的
 * 建議，供教師逐題確認。這個模組**不會**改寫題目、不會改動答案，也不會把建議寫入資料庫
 * ——寫入只會發生在教師明確確認之後（見 `src/server/services/content-improvement.ts`）。
 *
 * 設計原則：
 *   - **不假裝有依據**：`source_excerpt` 在本題庫絕大多數是校內試卷的原句（甚至與題幹
 *     完全相同），並非課本原文。只有真正像「課本段落」（與題幹不同、沒有空格標記、
 *     長度足夠）時，才建議「依來源句改寫」，否則一律交教師由課本補寫。
 *   - **技能建議只是排序提示**：選擇題及填充題本身只能考核部分教育局歷史技能
 *     （例如需要展示史料並要求推論的技能無法由此題型充分考核），因此相關建議一律
 *     標為較低信心，並在理由中說明限制。
 *   - 所有建議都附理由，教師可以一眼判斷是否接受。
 */
import { HISTORY_SKILLS, type HistorySkill } from "../../lib/types";
import type { ExplanationClass } from "./explanation-quality";

/**
 * 解釋需要哪一種改進。教師可用這些類型分工（例如「需補因果」的一批交給同一組老師）。
 */
export const IMPROVEMENT_TYPES = [
  /** 有可據的來源句／課文，可以按原文補寫解釋 */
  "rewrite_from_source_wording",
  /** 需補因果：說明「為甚麼」這個答案成立（成因、結果、影響） */
  "add_causal_reasoning",
  /** 需補概念定義：說明名詞／制度／現象是甚麼 */
  "add_concept_definition",
  /** 需補時間背景：說明事件在時序中的位置及前後關係 */
  "add_chronology_context",
  /** 需教師裁決：題目本身或答案有疑問，或完全沒有可據材料 */
  "teacher_adjudication",
] as const;

export type ImprovementType = (typeof IMPROVEMENT_TYPES)[number];

export const IMPROVEMENT_TYPE_LABELS: Record<ImprovementType, string> = {
  rewrite_from_source_wording: "可依來源句改寫（有原文可據）",
  add_causal_reasoning: "需補因果／歷史推理",
  add_concept_definition: "需補概念定義",
  add_chronology_context: "需補時間背景",
  teacher_adjudication: "需教師裁決（無可靠依據或題目本身有疑）",
};

export interface ExplanationImprovementInput {
  explanationClass: ExplanationClass;
  questionType: string;
  question: string;
  explanation: string;
  correctAnswer: string;
  /** 選擇題選項（用於判斷來源節錄是否只是題目本身的選項清單） */
  options?: string[];
  sourceExcerpt: string;
  knowledgePoint: string;
}

export interface ExplanationImprovementSuggestion {
  primary: ImprovementType;
  alsoConsider: ImprovementType[];
  /** 為甚麼建議這個類型（繁體中文，供教師閱讀） */
  rationale: string;
}

/** 匯入時的通用知識點標籤，不代表任何具體內容（與 metadata-quality 保持一致） */
const GENERIC_KNOWLEDGE_POINT = "校內試題";

const BLANK_MARKER = /[_＿]{2,}/;

/**
 * 來源節錄是否像「課本段落」而非「試卷題目原句」。
 *
 * 條件必須同時成立，避免把試卷題目當成教材原文：
 *   1. 長度至少 25 字（短句不足以支撐推理）；
 *   2. 本身不含空格標記（課文段落不會有填充空位）；
 *   3. 正規化後與題幹不同；
 *   4. 不是該題的**選項清單**——校內試題的 `source_excerpt` 常常是「題幹＋各選項」的
 *      版面重排（例如「下列哪些屬於一手資料？ 日記 錄像 …」），若節錄包含 2 個或以上
 *      選項文字，就判定為題目本身，不會建議「依原文改寫」。
 *
 * 門檻刻意保守：把題目誤判成課文會給教師錯誤的工作方向（以為有原文可抄），
 * 相反把課文誤判成題目只會令建議變成「需按課本補寫」，仍然正確。
 */
export function looksLikeSourcePassage(
  sourceExcerpt: string,
  question: string,
  options: string[] = [],
): boolean {
  const excerpt = sourceExcerpt.trim();
  if (excerpt.length < 25) return false;
  if (BLANK_MARKER.test(excerpt)) return false;

  const normalise = (value: string): string =>
    value
      .replace(/\s+/g, "")
      .replace(/[，,。.、；;：:！!？?「」『』（）()]/g, "")
      .toLowerCase();

  /** 選項前方的羅馬數字標示（i.／ii、／iii）屬排版，不是內容 */
  const stripOptionLabel = (value: string): string =>
    value.replace(/^\s*[(（]?\s*(iv|iii|ii|i)\s*[.、．)）:：]?\s*/i, "");

  /** 移除題幹內的 i／ii／iii… 陳述標示，方便比較「節錄是否只是題目本身」 */
  const stripStatementLabels = (value: string): string => value.replace(/vi|iv|v|iii|ii|i/gi, "");

  const normalisedExcerpt = normalise(excerpt);
  if (normalisedExcerpt.length === 0) return false;

  // 節錄就是題目本身（常見於多選題：題幹列出 i–iv，節錄是同一段文字去掉標示）
  const plainExcerpt = stripStatementLabels(normalisedExcerpt);
  const plainQuestion = stripStatementLabels(normalise(question));
  if (plainQuestion.length > 0 && plainExcerpt.includes(plainQuestion)) return false;

  const matchedOptions = options.filter((option) => {
    const normalisedOption = normalise(stripOptionLabel(option));
    return normalisedOption.length >= 2 && normalisedExcerpt.includes(normalisedOption);
  });
  return matchedOptions.length < 2;
}

function hasSpecificKnowledgePoint(knowledgePoint: string): boolean {
  const trimmed = knowledgePoint.trim();
  return trimmed.length > 0 && trimmed !== GENERIC_KNOWLEDGE_POINT;
}

/** 在理由後面補上知識點，讓教師知道應往課本哪一節找依據 */
function withKnowledgePoint(rationale: string, knowledgePoint: string): string {
  return hasSpecificKnowledgePoint(knowledgePoint)
    ? `${rationale}（可先查課本「${knowledgePoint.trim()}」一節）`
    : rationale;
}

/** 題幹是否在問時序（先後、次序、排序），而不是問「最早是何時」 */
function asksAboutOrder(stem: string): boolean {
  return /(次序|先後次序|排列次序|排序|排列順序|由早至晚|由晚至早|時間線)/.test(stem);
}

function asksAboutTimeContext(stem: string): boolean {
  return /(何時|甚麼時候|哪一年|年份|世紀|年代|時期)/.test(stem);
}

/** 題幹是否真的是一條問句（填充題的題幹多數是陳述句加空格） */
function asksQuestion(stem: string): boolean {
  return /[？?]/.test(stem);
}

function asksAboutCause(stem: string): boolean {
  return /(原因|為甚麼|為什麼|成因|影響|結果|後果|導致|促成|因素|作用)/.test(stem);
}

export function suggestExplanationImprovement(
  input: ExplanationImprovementInput,
): ExplanationImprovementSuggestion {
  switch (input.explanationClass) {
    case "potentially_inconsistent":
      return {
        primary: "teacher_adjudication",
        alsoConsider: [],
        rationale: "解釋指出的答案與標準答案不符；必須由教師核對才能改寫，程式不會代為判斷。",
      };
    case "placeholder": {
      if (looksLikeSourcePassage(input.sourceExcerpt, input.question, input.options ?? [])) {
        return {
          primary: "rewrite_from_source_wording",
          alsoConsider: ["add_causal_reasoning"],
          rationale:
            "現有來源節錄是完整句子而非題目本身，可先按原文說明答案，再補一句「為甚麼」；程式不會代寫。",
        };
      }
      // 沒有可用課文段落時，仍要指出「缺了甚麼」，否則所有題目都會變成一句「交教師決定」。
      const causal =
        input.questionType !== "fill" &&
        asksQuestion(input.question) &&
        asksAboutCause(input.question);
      return causal
        ? {
            primary: "add_causal_reasoning",
            alsoConsider: ["add_concept_definition"],
            rationale: withKnowledgePoint(
              "現時解釋是通用佔位文字，題目問的是原因／影響；建議補「為甚麼」的因果說明。來源只記錄試卷位置，沒有可核實的課文段落，需教師按課本補寫。",
              input.knowledgePoint,
            ),
          }
        : {
            primary: "add_concept_definition",
            alsoConsider: ["add_causal_reasoning"],
            rationale: withKnowledgePoint(
              "現時解釋是通用佔位文字；建議先說明相關概念／名詞是甚麼，再補一句「為甚麼答案成立」。來源只記錄試卷位置，沒有可核實的課文段落，需教師按課本補寫。",
              input.knowledgePoint,
            ),
          };
    }
    case "answer_only": {
      const alsoConsider: ImprovementType[] = [];
      if (input.questionType === "fill") alsoConsider.push("add_concept_definition");
      if (asksAboutOrder(input.question) || asksAboutTimeContext(input.question)) {
        alsoConsider.push("add_chronology_context");
      }
      return {
        primary: "add_causal_reasoning",
        alsoConsider,
        rationale: withKnowledgePoint(
          "解釋只重複答案，沒有說明理由；建議補「為甚麼這個答案成立」（因果、目的或影響），填充題另加概念定義。",
          input.knowledgePoint,
        ),
      };
    }
    case "insufficient":
      return {
        primary: "add_concept_definition",
        alsoConsider: ["add_causal_reasoning"],
        rationale: "解釋過短而且沒有說明性用語；建議先界定概念，再簡述原因。",
      };
    case "not_assessed":
      return {
        primary: "teacher_adjudication",
        alsoConsider: [],
        rationale: "系統未發現明顯模板；是否需要改寫由教師判斷。",
      };
  }
}

/* ------------------------------------------------------------------ */
/* 歷史技能建議                                                        */
/* ------------------------------------------------------------------ */

export const SKILL_SUGGESTION_CONFIDENCES = ["high", "medium", "low"] as const;
export type SkillSuggestionConfidence = (typeof SKILL_SUGGESTION_CONFIDENCES)[number];

export interface SkillSuggestion {
  skill: HistorySkill;
  confidence: SkillSuggestionConfidence;
  reason: string;
}

/**
 * 技能建議的關鍵詞規則。
 *
 * 只使用**明確**的字眼（例如「次序」「反映」「可信」），避免用「最早」這類同時
 * 表示「時間點」與「排序」的詞而產生誤判。
 */
interface SkillRule {
  skill: HistorySkill;
  pattern: RegExp;
  confidence: SkillSuggestionConfidence;
  reason: string;
}

const SKILL_RULES: readonly SkillRule[] = [
  {
    skill: "準確排列歷史事件的次序",
    pattern: /(先後次序|排列次序|按時間先後|由早至晚|由晚至早|排序|時間線)/,
    confidence: "high",
    reason: "題幹明確要求按時間先後排列或排序。",
  },
  {
    skill: "掌握資料的含義，對資料的準確性及可信性進行合理的質疑與探究",
    pattern: /(可信性|可靠性|史料價值|資料來源|是否可信|證據是否充分)/,
    confidence: "high",
    reason: "題幹直接要求評估資料的可信性或來源。",
  },
  {
    skill: "分辨歷史事實與見解之間的不同",
    pattern: /(事實|見解|觀點|意見).{0,6}(分別|不同|分辨|屬於)/,
    confidence: "high",
    reason: "題幹要求分辨事實陳述與個人見解。",
  },
  {
    skill: "找出主要歷史事件和人物不同的解釋",
    pattern: /(不同的?解釋|另一種?解釋|不同評價|不同看法)/,
    confidence: "high",
    reason: "題幹要求比較對同一事件或人物的不同解釋。",
  },
  {
    skill: "從歷史資料中作出歸納和推論",
    pattern: /(反映|顯示|可見|推斷|推論|歸納|意味|說明甚麼|說明什麼)/,
    confidence: "medium",
    reason: "題幹用語指向由資料推論，但本題型沒有附上完整史料，只能部分考核。",
  },
  {
    skill: "描述歷史地圖、模型、圖形、圖表、圖畫、表格和漫畫的特徵",
    pattern: /(地圖|圖表|表格|漫畫|圖畫|模型|示意圖)/,
    confidence: "medium",
    reason: "題幹提及圖表或圖像類資料；需教師確認學生是否真的要看圖作答。",
  },
  {
    skill: "運用想像力重組往事",
    pattern: /(想像|試代入|如果你是|假如你是)/,
    confidence: "medium",
    reason: "題幹要求代入情境或運用意想重組往事。",
  },
  {
    skill: "選取、組織和運用資料，並有條理地表達出來",
    pattern: /(試述|試分析|評論|闡述|有條理|加以說明)/,
    confidence: "medium",
    reason: "題幹要求有條理地組織及表達。",
  },
];

/** 填充題答案很短時，通常考核歷史名詞的準確認知 */
const SHORT_ANSWER_LENGTH = 8;

export interface SkillSuggestionInput {
  questionType: string;
  question: string;
  explanation: string;
  correctAnswer: string;
  knowledgePoint: string;
}

/**
 * 產生技能建議，依信心由高至低排序。
 *
 * **單選**：資料庫的 `skill` 欄位及 `historySkillSchema` 都是單一值，因此建議是
 * 「排序後的候選」，不是多選清單；教師確認後只會寫入一個技能。
 *
 * 若沒有任何關鍵詞命中，會回傳一個低信心的預設建議（而非空白），令教師仍有起點；
 * 但 `confidence: "low"` 明確表示這是題型推測，不是證據。
 */
export function suggestSkills(input: SkillSuggestionInput): SkillSuggestion[] {
  // 填充題的題幹多數是「課文句子＋空格」，句中的「反映」「先後」等字眼屬陳述內容，
  // 不是題目要求的動作。只有在題幹真的是一條問句時，才用關鍵詞推測技能。
  const stem = asksQuestion(input.question) ? input.question : "";
  const matched: SkillSuggestion[] = [];
  const seen = new Set<string>();

  for (const rule of SKILL_RULES) {
    if (seen.has(rule.skill)) continue;
    if (!rule.pattern.test(stem)) continue;
    seen.add(rule.skill);
    matched.push({ skill: rule.skill, confidence: rule.confidence, reason: rule.reason });
  }

  const answer = input.correctAnswer.trim();
  if (
    input.questionType === "fill" &&
    !seen.has("正確地使用歷史辭彙") &&
    answer.length > 0 &&
    answer.length <= SHORT_ANSWER_LENGTH
  ) {
    seen.add("正確地使用歷史辭彙");
    matched.push({
      skill: "正確地使用歷史辭彙",
      confidence: "medium",
      reason: `填充題以單一歷史名詞為答案（「${answer}」），主要考核辭彙的準確認知。`,
    });
  }

  if (matched.length === 0) {
    matched.push({
      skill: "正確地使用歷史辭彙",
      confidence: "low",
      reason:
        "題幹沒有明顯技能關鍵詞；選擇題及填充題多以辨認歷史名詞為主，此為題型推測，需教師確認。",
    });
  }

  // 只保留官方清單內的技能（防止日後清單變動留下無效值）
  const allowed = new Set<string>(HISTORY_SKILLS);
  const order: Record<SkillSuggestionConfidence, number> = { high: 0, medium: 1, low: 2 };
  return matched
    .filter((suggestion) => allowed.has(suggestion.skill))
    .sort(
      (left, right) =>
        order[left.confidence] - order[right.confidence] ||
        HISTORY_SKILLS.indexOf(left.skill) - HISTORY_SKILLS.indexOf(right.skill),
    );
}

/** 題幹摘要（工作清單用；保留前 80 個字元） */
export function summariseStem(question: string, maxLength = 80): string {
  const compact = question.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength)}…`;
}
