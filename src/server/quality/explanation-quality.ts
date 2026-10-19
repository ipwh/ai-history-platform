/**
 * 解釋品質分類（純函式）。
 *
 * 目的：把「有 explanation 欄位」與「解釋能支撐答案」分開。分類只用作佇列與
 * 發布閘門的證據，不會修改題目，也不會由程式裁定歷史事實。
 *
 * 避免誤判：
 *   - 佔位文字集中在 `PLACEHOLDER_EXPLANATIONS`／`PLACEHOLDER_PATTERNS`，方便測試及擴充；
 *   - 不以長度單獨判定不合格：短解釋只有在「沒有任何說明性用語」時才列為
 *     `insufficient`（啟發式，需教師覆核）；
 *   - 只含「參考答案」字樣不會自動判為佔位；
 *   - 與答案矛盾的解釋只標記 `potentially_inconsistent`，交由教師決定。
 */
export const EXPLANATION_CLASSES = [
  "placeholder",
  "answer_only",
  "insufficient",
  "potentially_inconsistent",
  "not_assessed",
] as const;

export type ExplanationClass = (typeof EXPLANATION_CLASSES)[number];

export type ExplanationQualityCode =
  | "EXPLANATION_PLACEHOLDER"
  | "EXPLANATION_ANSWER_ONLY"
  | "EXPLANATION_ANSWER_CONFLICT"
  | "EXPLANATION_SHORT_WITHOUT_REASONING"
  | "EXPLANATION_REVIEWED_BUT_LOW_QUALITY";

/** 已確認的佔位文字（完整字串比對，經正規化）。新增模板必須同時加測試。 */
export const PLACEHOLDER_EXPLANATIONS: readonly string[] = [
  "答案依校內試題檔的評卷參考。",
  "答案依校內試題檔的評卷參考",
  "見課本。",
  "見教材。",
  "從略。",
  "略。",
];

/** 模板式佔位文字；刻意保守，避免把真正的解釋誤判。 */
export const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /^答案依[^。]{0,30}(評卷參考|參考答案|答案冊)[。.]?$/,
  /^見(課本|教材|教科書|課本內容)[。.]?$/,
  /^(從)?略[。.]?$/,
  /^答案(如上|同上)[。.]?$/,
];

/** 說明性用語：短解釋若含這些詞，不會因長度被判定為不足。 */
const REASONING_MARKERS: readonly string[] = [
  "因為",
  "由於",
  "所以",
  "因此",
  "代表",
  "反映",
  "導致",
  "促成",
  "意味",
  "顯示",
  "說明",
  "象徵",
  "鞏固",
  "加劇",
  "引起",
  "造成",
  "形成",
  "促使",
  "使到",
  "令到",
  "有助",
  "標誌",
  "奠定",
  "推翻",
  "建立",
  "實施",
  "源於",
  "原因",
  "背景",
  "目的",
  "影響",
  "結果",
  "作用",
  "特徵",
  "特點",
  "包括",
  "例如",
];

const SHORT_EXPLANATION_LENGTH = 12;

export function normaliseExplanation(value: string): string {
  return value
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isPlaceholderExplanation(explanation: string): boolean {
  const normalised = normaliseExplanation(explanation);
  if (PLACEHOLDER_EXPLANATIONS.includes(normalised)) return true;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalised));
}

function sameAnswer(left: string, right: string): boolean {
  const normalise = (value: string): string =>
    value
      .replace(/\s+/g, "")
      .replace(/[。.，,；;：:、/／]/g, "")
      .toLowerCase();
  return normalise(left).length > 0 && normalise(left) === normalise(right);
}

export interface ExplanationQualityInput {
  explanation: string;
  correctAnswer: string;
  acceptedAnswers: string[];
  options: string[];
  /** 這一版是否有綁定目前 revision／fingerprint 的人工覆核（不含 automation）。 */
  hasHumanReview: boolean;
}

export interface ExplanationQualityResult {
  class: ExplanationClass;
  codes: ExplanationQualityCode[];
  notes: string[];
  hasHumanReview: boolean;
}

export function classifyExplanation(
  input: ExplanationQualityInput,
): ExplanationQualityResult {
  const explanation = normaliseExplanation(input.explanation);
  const answers = [input.correctAnswer, ...input.acceptedAnswers];

  if (explanation.length === 0 || isPlaceholderExplanation(explanation)) {
    return withReview(
      "placeholder",
      ["EXPLANATION_PLACEHOLDER"],
      ["解釋為空白或通用佔位文字，沒有說明答案"],
      input.hasHumanReview,
    );
  }

  const isAnswerList = explanation.startsWith("填充題答案（依空格次序）");
  const explicitAnswer =
    /^(?:正確)?答案[：:為是]?\s*(.+)$/.exec(explanation)?.[1]?.trim() ?? null;
  const isOnlyAnswer =
    isAnswerList ||
    sameAnswer(explanation, input.correctAnswer) ||
    input.acceptedAnswers.some((accepted) => sameAnswer(explanation, accepted)) ||
    (explicitAnswer !== null &&
      answers.some((answer) => sameAnswer(answer, explicitAnswer)) &&
      explanation.length <= explicitAnswer.length + 4);

  if (isOnlyAnswer) {
    return withReview(
      "answer_only",
      ["EXPLANATION_ANSWER_ONLY"],
      ["解釋只列出答案（或按空格次序的答案），沒有說明理由"],
      input.hasHumanReview,
    );
  }

  // 只有選擇題有「多個選項」可供對照；矛盾只標記待覆核。
  if (input.options.length > 0 && explicitAnswer !== null) {
    const conflictingOption = input.options.find(
      (option) =>
        !sameAnswer(option, input.correctAnswer) &&
        !input.acceptedAnswers.some((accepted) => sameAnswer(option, accepted)) &&
        (sameAnswer(option, explicitAnswer) ||
          explicitAnswer.includes(option) ||
          option.includes(explicitAnswer)),
    );
    if (conflictingOption !== undefined) {
      return withReview(
        "potentially_inconsistent",
        ["EXPLANATION_ANSWER_CONFLICT"],
        [`解釋指出的答案「${explicitAnswer}」與標準答案不符；只標記待教師覆核`],
        input.hasHumanReview,
      );
    }
  }

  const hasReasoning = REASONING_MARKERS.some((marker) => explanation.includes(marker));
  if (explanation.length < SHORT_EXPLANATION_LENGTH && !hasReasoning) {
    return withReview(
      "insufficient",
      ["EXPLANATION_SHORT_WITHOUT_REASONING"],
      ["解釋很短且沒有說明性用語；屬啟發式標記，需教師判斷（不是自動判錯）"],
      input.hasHumanReview,
    );
  }

  return {
    class: "not_assessed",
    codes: [],
    notes: ["未發現明顯模板或矛盾；不代表解釋已達教學標準（需教師判斷）"],
    hasHumanReview: input.hasHumanReview,
  };
}

function withReview(
  explanationClass: ExplanationClass,
  codes: ExplanationQualityCode[],
  notes: string[],
  hasHumanReview: boolean,
): ExplanationQualityResult {
  if (!hasHumanReview) {
    return { class: explanationClass, codes, notes, hasHumanReview };
  }
  return {
    class: explanationClass,
    codes: [...codes, "EXPLANATION_REVIEWED_BUT_LOW_QUALITY"],
    notes: [
      ...notes,
      "此題雖有人工覆核紀錄，但解釋仍被分類為需改善；不可當作已達標",
    ],
    hasHumanReview,
  };
}
