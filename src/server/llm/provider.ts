/**
 * LLM provider 介面。
 * 前端永遠不會直接呼叫 LLM；所有生成都在伺服器端經由這個介面進行，
 * 之後由 validation 模組驗證 schema 及教材依據。
 */
import type { Difficulty, LlmQuestion, LlmUsage, QuestionType } from "../../lib/types";

/** 傳給 LLM 的最小教材單位（只傳與當前分節相關的段落） */
export interface MaterialUnit {
  blockId: string;
  sourceLocation: string;
  text: string;
  /** 文字來自圖片 OCR 辨識（供規則式生成判斷是否適合出題） */
  fromOcr?: boolean;
}

export interface QuestionGenerationInput {
  topicTitle: string;
  /** 年級標籤（例如「中二」），讓模型掌握課程脈絡 */
  levelLabel?: string;
  /** 課程主題（例如「近代世界（15 至 19 世紀）：西力的形成與外延」） */
  themeText?: string;
  /**
   * 該課題的學習重點（教育局《預期學習內容》精簡摘要）。
   * 只界定課程範圍及考核要求，不是史實依據；史實一律以 materialUnits 為準。
   */
  learningFocusText?: string;
  sectionTitle: string;
  questionTypes: QuestionType[];
  difficulty: Difficulty;
  count: number;
  materialUnits: MaterialUnit[];
  /**
   * 同一課題其他分節的段落，只可用於製作選擇題的錯誤選項。
   * 正確答案仍必須來自 materialUnits（確保題目有本分節的教材依據）。
   */
  distractorUnits?: MaterialUnit[];
}

export interface LlmProvider {
  /** 內部名稱，例如 mock / gemini */
  readonly name: string;
  /** 顯示名稱，例如「本地示範生成（不需要 API key）」 */
  readonly label: string;
  /** 未經信任的原始題目；呼叫者必須先驗證 */
  generateQuestions(input: QuestionGenerationInput): Promise<GenerateQuestionsOutcome>;
}

/** 出題結果：未驗證的題目及 API 回報的 token 用量（本地示範生成為 null） */
export interface GenerateQuestionsOutcome {
  questions: LlmQuestion[];
  usage: LlmUsage | null;
}

export class LlmProviderError extends Error {
  /** 是否可以向使用者建議重試 */
  readonly retryable: boolean;

  constructor(message: string, options: { retryable?: boolean } = {}) {
    super(message);
    this.name = "LlmProviderError";
    this.retryable = options.retryable ?? true;
  }
}
