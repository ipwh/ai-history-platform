/**
 * LLM provider 介面。
 * 前端永遠不會直接呼叫 LLM；所有生成都在伺服器端經由這個介面進行，
 * 之後由 validation 模組驗證 schema 及教材依據。
 */
import type { Difficulty, LlmQuestion, LlmUsage, QuestionType } from "../../lib/types";
import type { MaterialAnalysis } from "./material-analysis";

/** 傳給 LLM 的最小教材單位（只傳與當前分節相關的段落） */
export interface MaterialUnit {
  blockId: string;
  /** 段落所屬分節；用來把題目歸入正確的分節（未分節的段落為 null） */
  sectionId?: string | null;
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
  /**
   * 教材的結構化語意分析（Sprint 8.5，見 material-analysis.ts）。
   *
   * 由呼叫端（生成流程）以確定性規則預先整理，令模型看到的是教材的**歷史脈絡**
   * （關鍵詞語、時序、因果、轉變、比較、意義，以及教材**沒有**交代的面向），
   * 而不是一連串互不相關的句子。沒有提供時提示詞會略去分析段落
   * （例如直接以 provider 做單元測試），生成規則本身不受影響。
   */
  materialAnalysis?: MaterialAnalysis;
  /**
   * 上一輪未通過品質閘門的問題（Sprint 8.5）：有限次重試時，把具體問題交回模型，
   * 要求它針對問題重寫，而不是原句重交一次。
   */
  revisionNotes?: string[];
  /**
   * 已用過的標準答案（同一份練習已出過的題目）。
   * 生成時應避免重用這些答案：同一份練習出現兩條答案相同的填充題，
   * 代表同一件史實問了兩次，對學生沒有額外價值。
   */
  avoidAnswers?: string[];
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
