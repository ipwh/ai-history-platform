/**
 * 結構不可作答題目的分類及處置建議（純函式）。
 *
 * 只提出建議，不會修改題目。任何涉及答案映射、歷史事實或評分含義的修復都必須由
 * 教師裁決；`checkQuestionServable()` 仍是唯一的可作答判斷。
 */
export type ServabilityIssueCode =
  | "MISSING_ANSWER"
  | "FILL_NO_BLANK"
  | "FILL_MULTI_BLANK"
  | "FILL_ANSWER_TOO_LONG"
  | "FILL_ANSWER_CONTAINS_BLANK"
  | "FILL_ANSWER_SENTENCE"
  | "FILL_ANSWER_LEAKS"
  | "MCQ_TOO_FEW_OPTIONS"
  | "MCQ_EMPTY_OPTION"
  | "MCQ_DUPLICATE_OPTION"
  | "MCQ_ANSWER_NOT_IN_OPTIONS"
  | "MCQ_ROMAN_LABEL_MISSING"
  | "MCQ_ANSWER_LEAKS"
  | "MCQ_CHRONOLOGY_GIVEN_AWAY"
  | "UNKNOWN";

export type ServabilityCategory =
  | "unanswerable"
  | "answer_mapping_suspect"
  | "source_content_missing"
  | "grading_contract_invalid"
  | "legacy_snapshot_only"
  | "other";

export type RemediationRecommendation =
  | "safe_automatic_repair_candidate"
  | "teacher_review_required"
  | "return_to_draft_candidate"
  | "quarantine_candidate"
  | "investigation_required";

const PATTERNS: { pattern: RegExp; code: ServabilityIssueCode }[] = [
  { pattern: /沒有標準答案/, code: "MISSING_ANSWER" },
  { pattern: /題幹沒有空格標記/, code: "FILL_NO_BLANK" },
  { pattern: /有 \d+ 個空格，但只記錄了 1 個答案/, code: "FILL_MULTI_BLANK" },
  { pattern: /標準答案長達/, code: "FILL_ANSWER_TOO_LONG" },
  { pattern: /標準答案仍包含空格標記/, code: "FILL_ANSWER_CONTAINS_BLANK" },
  { pattern: /標準答案包含完整句子/, code: "FILL_ANSWER_SENTENCE" },
  { pattern: /仍出現在題幹其他位置/, code: "FILL_ANSWER_LEAKS" },
  { pattern: /選擇題只有 \d+ 個選項/, code: "MCQ_TOO_FEW_OPTIONS" },
  { pattern: /空白的選項/, code: "MCQ_EMPTY_OPTION" },
  { pattern: /重複的選項/, code: "MCQ_DUPLICATE_OPTION" },
  { pattern: /不在選項之內/, code: "MCQ_ANSWER_NOT_IN_OPTIONS" },
  { pattern: /羅馬數字/, code: "MCQ_ROMAN_LABEL_MISSING" },
  { pattern: /已出現在題幹中/, code: "MCQ_ANSWER_LEAKS" },
  // 時序題把年份印在題幹：題目仍可作答，但答案已由題幹給出，需由教師改寫或停用
  { pattern: /題幹已把年份寫在事件之前/, code: "MCQ_CHRONOLOGY_GIVEN_AWAY" },
];

export function classifyServabilityIssue(reason: string | null): ServabilityIssueCode {
  if (!reason) return "UNKNOWN";
  return PATTERNS.find((entry) => entry.pattern.test(reason))?.code ?? "UNKNOWN";
}

const CATEGORY_BY_CODE: Record<ServabilityIssueCode, ServabilityCategory> = {
  MISSING_ANSWER: "unanswerable",
  FILL_NO_BLANK: "unanswerable",
  FILL_MULTI_BLANK: "unanswerable",
  FILL_ANSWER_TOO_LONG: "answer_mapping_suspect",
  FILL_ANSWER_CONTAINS_BLANK: "answer_mapping_suspect",
  FILL_ANSWER_SENTENCE: "answer_mapping_suspect",
  FILL_ANSWER_LEAKS: "answer_mapping_suspect",
  MCQ_TOO_FEW_OPTIONS: "unanswerable",
  MCQ_EMPTY_OPTION: "unanswerable",
  MCQ_DUPLICATE_OPTION: "unanswerable",
  MCQ_ANSWER_NOT_IN_OPTIONS: "grading_contract_invalid",
  MCQ_ROMAN_LABEL_MISSING: "unanswerable",
  MCQ_ANSWER_LEAKS: "answer_mapping_suspect",
  MCQ_CHRONOLOGY_GIVEN_AWAY: "other",
  UNKNOWN: "other",
};

export function categoryForIssue(code: ServabilityIssueCode): ServabilityCategory {
  return CATEGORY_BY_CODE[code];
}

export interface ServabilityContext {
  issueCode: ServabilityIssueCode;
  attempts: number;
  snapshots: number;
  hasSourceDocument: boolean;
}

/**
 * 建議處置。現階段沒有任何一種不可作答原因同時符合「來源足以證明、規則確定、
 * 不改變答案／評分」的自動修復條件，因此一律不建議自動修復。
 */
export function recommendRemediation(context: ServabilityContext): RemediationRecommendation {
  switch (context.issueCode) {
    case "MISSING_ANSWER":
      return "quarantine_candidate";
    case "FILL_NO_BLANK":
      return "return_to_draft_candidate";
    case "UNKNOWN":
      return "investigation_required";
    case "MCQ_ANSWER_NOT_IN_OPTIONS":
      return context.hasSourceDocument ? "teacher_review_required" : "investigation_required";
    default:
      return "teacher_review_required";
  }
}

export function requiresHumanDecision(recommendation: RemediationRecommendation): boolean {
  return recommendation !== "safe_automatic_repair_candidate";
}
