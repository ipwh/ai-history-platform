/**
 * 教師審核工作台的白話文字表（純資料，可在伺服器或客戶端使用）。
 *
 * 目的：只有一般電腦技能的老師，不應該見到 `provenance`、`servability`、
 * `fingerprint` 這類內部術語。畫面上一律用「問題係咩、你按邊個掣、按完會點」三段式文字。
 * 這裡只負責文字，不涉及任何裁決邏輯：真正的驗證仍然在伺服器。
 */

export type WorkbenchQueue = "servability" | "provenance" | "golden";

export interface QueueMeta {
  label: string;
  hint: string;
}

export const QUEUE_META: Record<WorkbenchQueue, QueueMeta> = {
  servability: {
    label: "學生答唔到的題目",
    hint: "題目本身有問題（例如沒有正確答案、選項重複），學生即使識也答不到。請你看完後決定怎樣處理。",
  },
  provenance: {
    label: "要跟進課本依據的題目",
    hint: "這些題目的課本依據需要人手核對。看完證據後，請到題目頁面修改或補上依據。",
  },
  golden: {
    label: "評分示例題",
    hint: "這些題目適合用來做「標準答案示例」，供老師之間對照評分尺度。",
  },
};

/** 不可作答的原因（issueCode）→ 一句老師看得明的廣東話。 */
export const SERVABILITY_REASON_TEXT: Record<string, string> = {
  MISSING_ANSWER: "這題沒有記錄正確答案，學生交了卷也不知對錯。",
  FILL_NO_BLANK: "題目原本應該是填充題，但題幹裡找不到空格。",
  FILL_MULTI_BLANK: "題幹有多個空格，但只記錄了一個答案。",
  FILL_ANSWER_TOO_LONG: "記錄的答案太長，似是整句句子而不是要填的字詞。",
  FILL_ANSWER_CONTAINS_BLANK: "記錄的答案裡仍然有空格符號。",
  FILL_ANSWER_SENTENCE: "記錄的答案是完整句子，跟填充題的格式不符。",
  FILL_ANSWER_LEAKS: "答案已經出現在題幹其他位置，等於直接送分。",
  MCQ_TOO_FEW_OPTIONS: "選擇題的選項數目不足。",
  MCQ_EMPTY_OPTION: "選擇題有空白選項。",
  MCQ_DUPLICATE_OPTION: "選擇題有重複選項。",
  MCQ_ANSWER_NOT_IN_OPTIONS: "記錄的正確答案不在選項之內。",
  MCQ_ROMAN_LABEL_MISSING: "題幹用了羅馬數字小項，但選項對不上。",
  MCQ_ANSWER_LEAKS: "正確答案已經出現在題幹中，等於直接送分。",
  UNKNOWN: "系統未能判斷具體原因，需要你直接看題目。",
};

export function servabilityReasonText(issueCode: string | null | undefined): string {
  if (!issueCode) return SERVABILITY_REASON_TEXT.UNKNOWN;
  return SERVABILITY_REASON_TEXT[issueCode] ?? SERVABILITY_REASON_TEXT.UNKNOWN;
}

export interface DecisionMeta {
  /** 送到伺服器的裁決值，必須與既有 API 一致。 */
  value: string;
  /** 按鈕上的文字（動詞開頭，短）。 */
  label: string;
  /** 按完會發生甚麼（一句）。 */
  effect: string;
  /** 是否只放在「其他決定」內，避免主畫面太多選擇。 */
  secondary?: boolean;
}

/** 主要三個決定：最常用、最安全。 */
export const SERVABILITY_DECISIONS: DecisionMeta[] = [
  {
    value: "request_more_evidence",
    label: "要再查證",
    effect: "題目退回草稿，等你補回原卷或課本證據再處理。學生不會見到這題。",
  },
  {
    value: "return_to_draft",
    label: "先收起這題",
    effect: "題目退回草稿，暫時不派給學生，之後可以再修改。",
  },
  {
    value: "approve_after_verified_repair",
    label: "已修好，可以派",
    effect: "只有在題目本身已可正常作答時才會成功；成功後仍要通過覆核才會派給學生。",
  },
];

/** 較少用的決定，收在「其他決定」內。 */
export const SERVABILITY_SECONDARY_DECISIONS: DecisionMeta[] = [
  {
    value: "keep_quarantined",
    label: "繼續隔離",
    effect: "維持不可派發，並保留待教師確認的標記。",
    secondary: true,
  },
  {
    value: "reject",
    label: "不要這題",
    effect: "留在草稿並標示不再採用。",
    secondary: true,
  },
];

export const ALL_SERVABILITY_DECISIONS: DecisionMeta[] = [
  ...SERVABILITY_DECISIONS,
  ...SERVABILITY_SECONDARY_DECISIONS,
];

export function decisionMeta(value: string): DecisionMeta | null {
  return ALL_SERVABILITY_DECISIONS.find((entry) => entry.value === value) ?? null;
}

/**
 * 理由快速選項。
 *
 * 伺服器要求理由至少 5 個字，這裡每一句都長於 5 個字，
 * 老師即使完全不打字，選一句就可以提交（按鈕會顯示實際會記錄的文字）。
 */
export const REASON_CHIPS: string[] = [
  "缺少原卷或課本證據",
  "題幹資料不完整",
  "答案有爭議，需要歷史科同事再議",
  "已對照課本修正題目",
  "這一題不需要保留",
  "系統判斷有誤，題目其實正常",
];

/** Golden 候選的評估類別（原本是英文代碼，這裡加上中文說明）。 */
export const GOLDEN_CATEGORY_LABELS: Record<string, string> = {
  chronology: "時序",
  "cause-consequence": "因果",
  significance: "重要性",
  comparison: "比較",
  people: "人物",
  treaty: "條約",
  "plausible-distractors": "選項具迷惑性",
};

export const GOLDEN_DECISIONS: DecisionMeta[] = [
  { value: "approved", label: "可以用作示例", effect: "記錄為評分示例；只影響評分基準，不會改變題目的發布狀態。" },
  { value: "revision_requested", label: "要再修改", effect: "記錄為要求修訂，題目需要再調整。" },
  { value: "rejected", label: "不適合做示例", effect: "記錄為拒絕，這題不再列為示例候選。" },
];

/** 把老師選的理由與自由輸入合併成要送到伺服器的理由字串。 */
export function composeReason(chips: string[], freeText: string): string {
  const picked = chips.map((chip) => chip.trim()).filter((chip) => chip.length > 0);
  const extra = freeText.trim();
  const parts = extra.length > 0 ? [...picked, extra] : picked;
  return parts.join("；");
}
