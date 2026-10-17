/**
 * 本地示範生成（不需要任何 API key）。
 *
 * 以教材原文為素材，用固定規則組成題目：
 * - 定義句（「詞語：說明」）→ 選擇題（詞語 ↔ 說明）、填充題及短答題
 * - 含「引號詞語」的敘述句 → 填充題及選擇題（把關鍵詞挖空）
 * 每題都附上教材原文節錄及來源位置，方便教師核對，亦符合「必須有教材依據」的要求。
 *
 * 設計原則：
 *   1. 嚴格遵守學生／教師要求的題型分配。
 *   2. 只產生「答案唯一」的題目；教材內容不足以產生清晰題目時寧可少出題，
 *      不產生含糊或有多個正確答案的題目。
 */
import type { Difficulty, LlmQuestion, QuestionType } from "../../lib/types";
import {
  extractYears,
  isGarbledOcrText,
  normalizeForMatch,
  splitSentences,
  truncate,
  TABLE_CELL_SEPARATOR,
} from "../materials/text-utils";
import { buildBlankedStem } from "./fill-question";
import { checkHistoricalAnswer, isYearAnswer } from "./historical-answer";
import type { LlmProvider, MaterialUnit, QuestionGenerationInput } from "./provider";

interface UnitFact {
  unit: MaterialUnit;
  /** 引號內的關鍵詞（例如「家庭手工業制度」） */
  quotedTerms: string[];
  /** 定義句的詞語（「詞語：說明」格式） */
  definedTerm: string | null;
  definitionText: string | null;
  sentences: string[];
  /** 段落內出現的年份（例如 1517年） */
  years: string[];
  used: boolean;
}

const QUOTE_PATTERNS = [/「([^「」]{2,14})」/g, /《([^《》]{2,20})》/g];
const DEFINITION_PATTERN = /^([^：:]{2,14})[：:](.{6,})$/;
const MAX_OPTION_LENGTH = 90;

function extractQuotedTerms(text: string): string[] {
  const terms: string[] = [];
  for (const pattern of QUOTE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const term = match[1].trim();
      if (term.length >= 2 && !terms.includes(term)) terms.push(term);
    }
  }
  return terms;
}

/**
 * 「詞語：說明」的冒號後是否為解釋句——判定放在 question-quality.ts，
 * 令自動品質閘門與生成器共用同一把尺（見該檔的 isExplanatoryDefinition）。
 */
import { isExplanatoryDefinition, isTimeDesignation } from "./question-quality";
export { isExplanatoryDefinition };

function buildFacts(units: MaterialUnit[]): UnitFact[] {
  return units
    // 略過無法辨識的 OCR 雜訊（零散單字），避免產生無意義的題目
    .filter((unit) => !(unit.fromOcr && isGarbledOcrText(unit.text)))
    // 略過寬表格的一整列：規則式生成無法把欄位拼成問得通的題目
    .filter((unit) => !looksLikeWideTableRow(unit.text))
    .map((unit) => {
      const definition = DEFINITION_PATTERN.exec(unit.text.trim());
      return {
        unit,
        quotedTerms: extractQuotedTerms(unit.text),
        definedTerm: definition ? definition[1].trim() : null,
        definitionText: definition ? definition[2].trim() : null,
        sentences: splitSentences(unit.text),
        years: extractYears(unit.text),
        used: false,
      };
    })
    .filter((fact) => fact.unit.text.trim().length >= 12);
}

/** 本地示範生成的題目只會考核這兩項技能（其餘技能需要展示史料，不在本平台範圍） */
const SKILL_TERMINOLOGY = "正確地使用歷史辭彙";
const SKILL_CHRONOLOGY = "準確排列歷史事件的次序";

function baseFields(fact: UnitFact, knowledgePoint: string, skill: string = SKILL_TERMINOLOGY) {
  return {
    knowledgePoint,
    sourceExcerpt: truncate(fact.unit.text, 240),
    sourceBlockIds: [fact.unit.blockId],
    skill,
  };
}

/** 解釋的長度上限（學生要看得完；教材原文只引用關鍵片段） */
const MAX_EXPLANATION_LENGTH = 180;
/**
 * 解釋中引用教材的長度上限。
 * 太長就等於把整段教材原文貼一次：學生讀不到推理，教學品質閘門
 * （question-quality.ts 的「解釋只是抄錄教材」）亦會把這種解釋判為需要修訂。
 */
const MAX_EXPLANATION_QUOTE = 60;

/**
 * 解釋必須說明「為甚麼這個答案成立」，而不是把教材原文重貼一次。
 *
 * 本地示範生成沒有 AI，但仍可說明答案與教材的關係：引用教材的關鍵片段（保持簡短），
 * 再指出答案在該敘述中的角色。所有文字都來自教材本身，不會加入教材沒有交代的史實。
 */
function explainFromMaterial(fact: UnitFact, note: string): string {
  const quote = truncate(fact.unit.text, MAX_EXPLANATION_QUOTE);
  return truncate(`教材段落指出「${quote}」；${note}`, MAX_EXPLANATION_LENGTH);
}

function buildOptions(correct: string, candidates: string[]): string[] {
  const options = [correct];
  for (const candidate of candidates) {
    if (options.length >= 4) break;
    const trimmed = candidate.trim();
    if (trimmed.length < 2) continue;
    if (options.includes(trimmed)) continue;
    if (correct.includes(trimmed) || trimmed.includes(correct)) continue;
    options.push(trimmed);
  }
  return options;
}

/**
 * 把教材句子挖空，並回傳單句題幹。
 *
 * 這裡**不可**用 `String.replace(term, "＿＿＿")`：那只會換掉第一處，若同句後文再次
 * 出現同一詞語，答案就會留在題幹內（學生可直接抄寫）。安全做法見
 * [fill-question.ts](./fill-question.ts) 的 `buildBlankedStem`：只選「同句內剛好出現
 * 一次」的句子，否則略過整個素材（寧可少出一題）。
 */

/**
 * 填充題的答案必須是歷史元素（事件名稱、人物、年份、國家、地點、條約、神祇、思想、
 * 政治制度等），見 [historical-answer.ts](./historical-answer.ts)。
 * 本地示範生成只會用合格的素材出題；不合格者一律略過（寧可少出一題），
 * 不會以「為生方法」、「展開時間」這類教材欄位名稱頂替。
 */
function isAcceptableFillAnswer(answer: string, materialText: string): boolean {
  return checkHistoricalAnswer(answer, materialText).ok;
}

/**
 * 判斷教材單位是否為寬表格的一整列（例如「能源 ｜ 人力、畜力 ｜ 大量燃燒煤炭」）。
 * 這類文字是欄位並列而非完整句子，規則式生成無法問得通，因此略過；
 * 使用真正 LLM 時仍會把原文交給模型判斷。
 */
function looksLikeWideTableRow(text: string): boolean {
  const segments = text.split(TABLE_CELL_SEPARATOR).filter((segment) => segment.trim().length > 0);
  return segments.length >= 3;
}

/** 選擇題的出題模板 */
type McStyle = "term" | "definition" | "quoted" | "year";
/** 填充題的出題模板 */
type FillStyle = "definition" | "quoted" | "year";

interface DifficultyPlan {
  /** 選擇題模板的優先次序（依序嘗試，教材不足時自動退到下一個模板） */
  mc: McStyle[];
  /** 填充題模板的優先次序 */
  fill: FillStyle[];
  /** 短答題問法：definition = 解釋指定詞語；quoted = 說明與詞語相關的內容 */
  short: "definition" | "quoted";
  /** 短答題得分要點上限（難度越高要求越多要點） */
  shortPointLimit: number;
}

/**
 * 三個難度採用不同的出題規則，令示範模式下的「難度選擇」真正影響題目內容：
 *   基礎：直接辨認教材的關鍵詞語（定義句 ↔ 詞語）。
 *   進階：理解詞語的說明及整句意思（以句子挖空為主）。
 *   挑戰：掌握時序（以年份挖空為主），短答題須綜合較多要點。
 * 每個模板都附有較寬鬆的後備模板，教材不足以出題時仍可退到下一個模板。
 */
const DIFFICULTY_PLANS: Record<Difficulty, DifficultyPlan> = {
  basic: {
    mc: ["term", "definition", "quoted", "year"],
    fill: ["definition", "quoted", "year"],
    short: "definition",
    shortPointLimit: 2,
  },
  advanced: {
    mc: ["definition", "quoted", "year", "term"],
    fill: ["quoted", "year", "definition"],
    short: "quoted",
    shortPointLimit: 4,
  },
  challenge: {
    mc: ["year", "quoted", "definition", "term"],
    fill: ["year", "quoted", "definition"],
    short: "quoted",
    shortPointLimit: 5,
  },
};

export function generateQuestionsFromMaterial(input: QuestionGenerationInput): LlmQuestion[] {
  const facts = buildFacts(input.materialUnits);
  if (facts.length === 0) return [];

  // 錯誤選項可以來自同一課題的其他分節，但答案必須來自本分節的教材段落
  const distractorFacts = buildFacts(input.distractorUnits ?? []);

  const types: QuestionType[] = input.questionTypes.length > 0 ? input.questionTypes : ["mc"];
  const difficulty: Difficulty = input.difficulty;
  const definitionFacts = facts.filter(
    (fact) =>
      fact.definedTerm !== null &&
      fact.definitionText !== null &&
      !(fact.definitionText as string).includes(fact.definedTerm as string) &&
      isExplanatoryDefinition(fact.definitionText as string),
  );
  const allDefinedTerms = [
    ...new Set([
      ...definitionFacts.map((fact) => fact.definedTerm as string),
      ...distractorFacts
        .filter((fact) => fact.definedTerm !== null)
        .map((fact) => fact.definedTerm as string),
    ]),
  ];
  const allQuotedTerms = [
    ...new Set([
      ...facts.flatMap((fact) => fact.quotedTerms),
      ...distractorFacts.flatMap((fact) => fact.quotedTerms),
    ]),
  ];
  const allYears = [...new Set([...facts, ...distractorFacts].flatMap((fact) => fact.years))];

  const results: LlmQuestion[] = [];

  /**
   * 已用過的答案（同一份練習的其他題目）。
   * 補題時會傳入：這類答案一律不再使用，令模型改出其他史實，而不是把同一題改寫再交。
   * 注意：這只是「避免重複」的提示；最終仍由 question-dedupe.ts 的共用判定把關。
   */
  const avoidedAnswers = new Set(
    (input.avoidAnswers ?? []).map((answer) => normalizeForMatch(answer)),
  );
  const isAvoided = (answer: string): boolean =>
    avoidedAnswers.size > 0 && avoidedAnswers.has(normalizeForMatch(answer));

  const push = (question: LlmQuestion): boolean => {
    if (results.length >= input.count) return false;
    if (results.some((item) => item.question === question.question)) return false;
    if (isAvoided(question.correctAnswer)) return false;
    results.push(question);
    return true;
  };

  const nextUnused = (predicate: (fact: UnitFact) => boolean): UnitFact | null =>
    facts.find((fact) => !fact.used && predicate(fact)) ?? null;

  /** 只用合格的定義句出題（見 isExplanatoryDefinition）：不可把教材的標題詞當成說明 */
  const nextUnusedDefinition = (predicate: (fact: UnitFact) => boolean = () => true): UnitFact | null =>
    definitionFacts.find((fact) => !fact.used && predicate(fact)) ?? null;

  /** 選擇題：依難度指定的模板次序出題 */
  function buildMc(plan: DifficultyPlan): LlmQuestion | null {
    for (const style of plan.mc) {
      const built =
        style === "term" || style === "definition"
          ? buildMcFromDefinition(style)
          : buildMcFromBlank(style);
      if (built) return built;
    }
    return null;
  }

  /** 由定義句出題：term = 「定義」是指哪一個詞語？；definition = 以下哪一項是「詞語」的說明？ */
  function buildMcFromDefinition(style: "term" | "definition"): LlmQuestion | null {
    // 「是指哪一個詞語？」的標準答案必須是**詞語**：教材的時間軸句式（「公元1453年：…」）
    // 若用來出這一種問法，會得出「問詞語但答案是一個年份」的題目（2026-10-16 審計確認），
    // 因此與填充題一樣排除年份答案。
    const fact = nextUnusedDefinition(
      style === "term" ? (item) => !isTimeDesignation(item.definedTerm as string) : () => true,
    );
    if (!fact) return null;

    const term = fact.definedTerm as string;
    const definition = truncate(fact.definitionText as string, MAX_OPTION_LENGTH);

    if (style === "term") {
      const options = buildOptions(
        term,
        allDefinedTerms.filter((candidate) => candidate !== term),
      );
      if (options.length < 3) return null;
      fact.used = true;
      return {
        questionType: "mc",
        difficulty,
        question: `「${definition}」是指以下哪一個詞語？`,
        options,
        correctAnswerIndex: 0,
        correctAnswer: term,
        explanation: explainFromMaterial(
          fact,
          `這句說明所指的是歷史詞語「${term}」，其餘選項是教材其他詞語的說明。`,
        ),
        ...baseFields(fact, `${input.sectionTitle}：${term}`),
        gradingPoints: [],
      };
    }

    const otherDefinitions = definitionFacts
      .filter((item) => item.definedTerm !== term)
      .map((item) => truncate(item.definitionText as string, MAX_OPTION_LENGTH));
    const options = buildOptions(definition, otherDefinitions);
    if (options.length < 3) return null;
    fact.used = true;
    return {
      questionType: "mc",
      difficulty,
      question: `以下哪一項是「${term}」的說明？`,
      options,
      correctAnswerIndex: 0,
      correctAnswer: definition,
      explanation: explainFromMaterial(
        fact,
        `教材用這句話說明「${term}」的意思，所以符合這段說明的就是這一項。`,
      ),
      ...baseFields(fact, `${input.sectionTitle}：${term}`),
      gradingPoints: [],
    };
  }

  /**
   * 把教材句子的關鍵資料挖空後出題（答案唯一）：
   *   year   = 挖空年份（考核時序）
   *   quoted = 挖空「引號詞語」（考核對整句的理解）
   */
  function buildMcFromBlank(style: "year" | "quoted"): LlmQuestion | null {
    if (style === "year") {
      const fact = nextUnused((item) => item.years.length === 1);
      if (!fact) return null;
      const year = fact.years[0];
      const blanked = buildBlankedStem(fact.unit.text, year);
      if (!blanked) return null;
      const options = buildOptions(
        year,
        allYears.filter((candidate) => candidate !== year),
      );
      if (options.length < 3) return null;
      fact.used = true;
      return {
        questionType: "mc",
        difficulty,
        question: blanked.stem,
        options,
        correctAnswerIndex: 0,
        correctAnswer: year,
        explanation: explainFromMaterial(
          fact,
          `教材把「${year}」與所述事件連在一起；其餘年份在教材中沒有對應這段敘述。`,
        ),
        ...baseFields(fact, `${input.sectionTitle}：${truncate(blanked.stem, 40)}`, SKILL_CHRONOLOGY),
        gradingPoints: [],
      };
    }

    const fact = nextUnused((item) => item.quotedTerms.length > 0);
    if (!fact) return null;
    const term = fact.quotedTerms[0];
    const blanked = buildBlankedStem(fact.unit.text, term);
    if (!blanked) return null;
    const options = buildOptions(
      term,
      allQuotedTerms.filter((candidate) => candidate !== term),
    );
    if (options.length < 3) return null;
    fact.used = true;
    return {
      questionType: "mc",
      difficulty,
      question: blanked.stem,
      options,
      correctAnswerIndex: 0,
      correctAnswer: term,
      explanation: explainFromMaterial(
        fact,
        `被引號標示的「${term}」是這句敘述的關鍵，其餘選項出自教材其他段落。`,
      ),
      ...baseFields(fact, `${input.sectionTitle}：${term}`),
      gradingPoints: [],
    };
  }

  /** 填充題：依難度指定的模板次序出題 */
  function buildFill(plan: DifficultyPlan): LlmQuestion | null {
    for (const style of plan.fill) {
      const built = style === "definition" ? buildFillFromDefinition() : buildFillFromBlank(style);
      if (built) return built;
    }
    return null;
  }

  /** 填充題：寫出「＿＿＿」代表的詞語 */
  function buildFillFromDefinition(): LlmQuestion | null {
    // 定義句的「詞語」必須是歷史元素，而且不可只是年份：教材的時間軸句式
    // （例如「約公元前3,200年：人類發明文字」）若當成定義句，會得出
    // 「「約公元前3,200年」是指人類發明文字」這種問不通的題目。
    const fact = nextUnusedDefinition(
      (item) =>
        !isYearAnswer(item.definedTerm as string) &&
        isAcceptableFillAnswer(item.definedTerm as string, item.unit.text),
    );
    if (!fact) return null;
    const term = fact.definedTerm as string;
    fact.used = true;
    // 題幹須保持在硬上限之內（見 fill-question.ts），因此定義句只取前段；
    // 過長的定義句會在驗證階段被丟棄，令整條題目白費。
    const definition = truncate(fact.definitionText as string, 60);
    return {
      questionType: "fill",
      difficulty,
      question: `「＿＿＿」是指${definition}`,
      options: [],
      correctAnswerIndex: null,
      correctAnswer: term,
      explanation: explainFromMaterial(
        fact,
        `教材用這句話說明「${term}」的意思，所以要填的是這個歷史詞語。`,
      ),
      ...baseFields(fact, `${input.sectionTitle}：${term}`),
      gradingPoints: [],
    };
  }

  /** 填充題：把教材句子的年份或「引號詞語」挖空 */
  function buildFillFromBlank(style: "year" | "quoted"): LlmQuestion | null {
    if (style === "year") {
      const fact = nextUnused(
        (item) => item.years.length === 1 && isAcceptableFillAnswer(item.years[0], item.unit.text),
      );
      if (!fact) return null;
      const year = fact.years[0];
      const blanked = buildBlankedStem(fact.unit.text, year);
      if (!blanked) return null;
      fact.used = true;
      return {
        questionType: "fill",
        difficulty,
        question: blanked.stem,
        options: [],
        correctAnswerIndex: null,
        correctAnswer: year,
        explanation: explainFromMaterial(
          fact,
          `教材把「${year}」與所述事件連在一起，所以要填的是這個時間。`,
        ),
        ...baseFields(fact, `${input.sectionTitle}：${truncate(blanked.stem, 40)}`, SKILL_CHRONOLOGY),
        gradingPoints: [],
      };
    }

    const fact = nextUnused((item) =>
      item.quotedTerms.some((term) => isAcceptableFillAnswer(term, item.unit.text)),
    );
    if (!fact) return null;
    // 一個段落可能有多個引號詞語，只可用合格的那一個（不合格的會令答案沒有意義）
    const term = fact.quotedTerms.find((candidate) =>
      isAcceptableFillAnswer(candidate, fact.unit.text),
    );
    if (term === undefined) return null;
    const blanked = buildBlankedStem(fact.unit.text, term);
    if (!blanked) return null;
    fact.used = true;
    return {
      questionType: "fill",
      difficulty,
      question: blanked.stem,
      options: [],
      correctAnswerIndex: null,
      correctAnswer: term,
      explanation: explainFromMaterial(
        fact,
        `要填的是這句敘述中被引號標示的關鍵詞語「${term}」。`,
      ),
      ...baseFields(fact, `${input.sectionTitle}：${term}`),
      gradingPoints: [],
    };
  }

  /** 短答題：依難度決定問法（解釋詞語／說明相關內容）及得分要點數目 */
  function buildShort(plan: DifficultyPlan): LlmQuestion | null {
    return plan.short === "definition"
      ? buildShortFromDefinition(plan) ?? buildShortFromQuoted(plan)
      : buildShortFromQuoted(plan) ?? buildShortFromDefinition(plan);
  }

  function buildShortFromDefinition(plan: DifficultyPlan): LlmQuestion | null {
    const fact = nextUnusedDefinition();
    if (!fact) return null;
    const term = fact.definedTerm as string;
    const points = splitSentences(fact.definitionText as string)
      .map((point) => truncate(point, 80))
      .filter((point) => point.length > 0)
      .slice(0, plan.shortPointLimit);
    if (points.length === 0) return null;
    fact.used = true;
    return {
      questionType: "short",
      difficulty,
      question: `試說明「${term}」。`,
      options: [],
      correctAnswerIndex: null,
      correctAnswer: truncate(fact.definitionText as string, 200),
      explanation: explainFromMaterial(
        fact,
        `教材以這句話交代「${term}」的意思，作答時要寫出其中的要點。`,
      ),
      ...baseFields(fact, `${input.sectionTitle}：${term}`),
      gradingPoints: points,
    };
  }

  function buildShortFromQuoted(plan: DifficultyPlan): LlmQuestion | null {
    const fact = nextUnused((item) => item.quotedTerms.length > 0);
    if (!fact) return null;
    const term = fact.quotedTerms[0];
    const points = (fact.sentences.length > 0 ? fact.sentences : [fact.unit.text])
      .map((point) => truncate(point, 80))
      .filter((point) => point.length > 0)
      .slice(0, plan.shortPointLimit);
    if (points.length === 0) return null;
    fact.used = true;
    return {
      questionType: "short",
      difficulty,
      question: `試說明與「${term}」相關的內容。`,
      options: [],
      correctAnswerIndex: null,
      correctAnswer: truncate(fact.unit.text, 200),
      explanation: explainFromMaterial(
        fact,
        `教材以這句話交代與「${term}」相關的內容，作答時要寫出其中的要點。`,
      ),
      ...baseFields(fact, `${input.sectionTitle}：${term}`),
      gradingPoints: points,
    };
  }

  // 依照要求輪流產生各題型的題目，教材不足時該題型會少出題而不會產生含糊的題目
  const plan = DIFFICULTY_PLANS[difficulty];
  const maxRounds = Math.max(input.count * 3, 6);
  for (let round = 0; round < maxRounds && results.length < input.count; round += 1) {
    const type = types[round % types.length];
    const built =
      type === "mc" ? buildMc(plan) : type === "fill" ? buildFill(plan) : buildShort(plan);
    if (built) push(built);
  }

  return results.slice(0, input.count);
}

export const mockProvider: LlmProvider = {
  name: "mock",
  label: "本地示範生成（不需要 API key）",
  async generateQuestions(input) {
    // 本地示範生成不使用外部 API，因此沒有 token 用量
    return { questions: generateQuestionsFromMaterial(input), usage: null };
  },
};
