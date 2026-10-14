/**
 * 共用資料契約（前後端都會用到）。
 * 所有 zod schema 都是唯一事實來源，TypeScript 型別由 schema 推導，
 * 避免前後端資料形狀不一致。
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* 共用列舉                                                            */
/* ------------------------------------------------------------------ */

export const QUESTION_TYPES = ["mc", "fill", "short"] as const;
export const questionTypeSchema = z.enum(QUESTION_TYPES);
export type QuestionType = z.infer<typeof questionTypeSchema>;

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mc: "選擇題",
  fill: "填充題",
  short: "短答題",
};

export const DIFFICULTIES = ["basic", "advanced", "challenge"] as const;
export const difficultySchema = z.enum(DIFFICULTIES);
export type Difficulty = z.infer<typeof difficultySchema>;

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  basic: "基礎",
  advanced: "進階",
  challenge: "挑戰",
};

/** 題目來源：示範題庫、教材 + 本地示範生成、教材 + AI 生成、教師手動建立、校內試題檔匯入 */
export const questionOriginSchema = z.enum([
  "demo",
  "material-mock",
  "material-ai",
  "manual",
  "school-paper",
]);
export type QuestionOrigin = z.infer<typeof questionOriginSchema>;

export const QUESTION_ORIGIN_LABELS: Record<QuestionOrigin, string> = {
  demo: "示範題庫（內建）",
  "school-paper": "校內試題（題庫匯入）",
  "material-mock": "本地示範生成（未使用 AI）",
  "material-ai": "AI 生成（已驗證教材依據）",
  manual: "教師手動建立",
};

export const questionStatusSchema = z.enum(["draft", "published", "disabled"]);
export type QuestionStatus = z.infer<typeof questionStatusSchema>;

export const QUESTION_STATUS_LABELS: Record<QuestionStatus, string> = {
  draft: "草稿",
  published: "已發布",
  disabled: "已停用",
};

/** 教材段落類型 */
export const materialBlockTypeSchema = z.enum(["heading", "paragraph", "list", "table", "image"]);
export type MaterialBlockType = z.infer<typeof materialBlockTypeSchema>;

export const MATERIAL_BLOCK_TYPE_LABELS: Record<MaterialBlockType, string> = {
  heading: "標題",
  paragraph: "段落",
  list: "清單",
  table: "表格",
  image: "圖片（未能自動擷取）",
};

/** 教材文件處理狀態 */
export const documentStatusSchema = z.enum(["ready", "failed"]);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  ready: "已成功擷取",
  failed: "擷取失敗",
};

/** 教材來源：內建示範內容、使用者上載，或校內試題（試題檔只用於匯入題庫，不作為 AI 出題依據） */
export const documentKindSchema = z.enum(["demo", "uploaded", "question-bank"]);
export type DocumentKind = z.infer<typeof documentKindSchema>;

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  demo: "示範資料",
  uploaded: "已上載教材",
  "question-bank": "校內試題（題庫來源）",
};

/** 圖片未能擷取時，介面統一顯示的說明文字 */
export const IMAGE_PLACEHOLDER_MESSAGE = "圖片內容未能自動擷取";

/* ------------------------------------------------------------------ */
/* 香港教育局歷史科課程結構                                            */
/* ------------------------------------------------------------------ */

/**
 * 中一至中三的課程組織（按教育局歷史科課程指引）：
 *   中一（level 1）古代世界（史前時期至14世紀）：區域文明的誕生與交流 → 課題1-4
 *   中二（level 2）近代世界（15至19世紀）：西力的形成與外延     → 課題5-8
 *   中三（level 3）現代世界（20世紀至今）：邁向多極與相互依存    → 課題9-12
 * level 0 表示「教師參考資料」，不屬於任何年級，學生端不會顯示。
 */
export const curriculumLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export type CurriculumLevel = z.infer<typeof curriculumLevelSchema>;

export const CURRICULUM_LEVEL_LABELS: Record<CurriculumLevel, string> = {
  0: "教師參考資料",
  1: "中一",
  2: "中二",
  3: "中三",
};

/** 各年級的課程主題 */
export const CURRICULUM_THEMES: Record<1 | 2 | 3, { title: string; era: string; focus: string }> = {
  1: {
    title: "古代世界",
    era: "史前時期至 14 世紀",
    focus: "區域文明的誕生與交流",
  },
  2: {
    title: "近代世界",
    era: "15 至 19 世紀",
    focus: "西力的形成與外延",
  },
  3: {
    title: "現代世界",
    era: "20 世紀至今",
    focus: "邁向多極與相互依存",
  },
};

export function curriculumThemeText(level: 1 | 2 | 3): string {
  const theme = CURRICULUM_THEMES[level];
  return `${theme.title}（${theme.era}）：${theme.focus}`;
}

/**
 * 教育局《歷史科課程指引》（中一至中三）第 1.3 節「學習目標」中「技能方面」的歷史技能。
 * 生成題目及語意批改都必須環繞這些技能（見 src/server/llm/prompt.ts），
 * 亦是判斷題目是否切合香港歷史科要求的依據，因此集中在此處定義。
 */
export const HISTORY_SKILLS = [
  "正確地使用歷史辭彙",
  "準確排列歷史事件的次序",
  "描述歷史地圖、模型、圖形、圖表、圖畫、表格和漫畫的特徵",
  "從歷史資料中作出歸納和推論",
  "找出主要歷史事件和人物不同的解釋",
  "分辨歷史事實與見解之間的不同",
  "掌握資料的含義，對資料的準確性及可信性進行合理的質疑與探究",
  "運用想像力重組往事",
  "選取、組織和運用資料，並有條理地表達出來",
] as const;
export type HistorySkill = (typeof HISTORY_SKILLS)[number];

/**
 * 歷史科課程重視的歷史概念。
 * 課程以「時序為軸」，並要求學生掌握因果關係、比較異同、轉變與延續，
 * 以及原始資料與二手資料的分類。
 */
export const HISTORY_CONCEPTS = [
  "時間與時序",
  "歷史分期",
  "因果關係",
  "比較異同",
  "轉變與延續",
  "原始資料與二手資料",
] as const;

/** OCR（光學文字辨識）狀態 */
export const ocrStatusSchema = z.enum(["not-run", "running", "done", "partial", "failed"]);
export type OcrStatus = z.infer<typeof ocrStatusSchema>;

export const OCR_STATUS_LABELS: Record<OcrStatus, string> = {
  "not-run": "未執行 OCR",
  running: "正在執行 OCR…",
  done: "OCR 完成",
  partial: "OCR 部分完成（有圖片格式不支援）",
  failed: "OCR 失敗",
};

/** 教材段落的取得方式：原生文字或 OCR 辨識 */
export const extractionMethodSchema = z.enum(["native", "ocr"]);
export type ExtractionMethod = z.infer<typeof extractionMethodSchema>;

export const EXTRACTION_METHOD_LABELS: Record<ExtractionMethod, string> = {
  native: "原文擷取",
  ocr: "OCR 辨識（可能有錯字，請教師核對）",
};

/** OCR 未能處理的圖片格式說明 */
export const OCR_UNSUPPORTED_FORMAT_MESSAGE =
  "此圖片格式（EMF／WMF／WDP）未能進行 OCR，如需擷取圖片文字，請提供 PNG／JPEG 版本或 PDF";

/* ------------------------------------------------------------------ */
/* 課題 / 分節                                                         */
/* ------------------------------------------------------------------ */

export const topicSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  published: z.boolean(),
  order: z.number().int(),
  /** 課程年級：0 教師參考、1 中一、2 中二、3 中三 */
  level: curriculumLevelSchema.default(1),
  /** 教育局課程的課題編號（例如 5）；教師參考資料為 null */
  topicNumber: z.number().int().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Topic = z.infer<typeof topicSchema>;

export const sectionSchema = z.object({
  id: z.string().min(1),
  topicId: z.string().min(1),
  /** 上層分節 ID；頂層分節為 null */
  parentId: z.string().nullable(),
  title: z.string().min(1),
  summary: z.string().default(""),
  order: z.number().int(),
  /** 用於自動把教材段落對應到此分節的關鍵詞 */
  matchKeywords: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Section = z.infer<typeof sectionSchema>;

/** 分節 + 該分節（含子分節）在題庫中已發布的題目數 */
export const sectionWithCountSchema = sectionSchema.extend({
  publishedQuestionCount: z.number().int().default(0),
  /**
   * 此分節（含子分節）已匯入的教材段落數。
   * 0 表示沒有教材依據，即時生成無法出題，介面會提示教師先補充教材。
   */
  materialBlockCount: z.number().int().default(0),
});
export type SectionWithCount = z.infer<typeof sectionWithCountSchema>;

/**
 * 此分節是否可以出題：題庫已有已發布題目，或已匯入教材（可由 AI 即時生成）。
 * 介面用它提醒學生哪些主題暫不可選，避免出現「選了卻出不到題」的情況。
 */
export function isSectionPractisable(section: {
  publishedQuestionCount: number;
  materialBlockCount: number;
}): boolean {
  return section.publishedQuestionCount > 0 || section.materialBlockCount > 0;
}

/** 首頁需要的課題概覽（含分節樹及進度） */
export const topicOverviewSchema = topicSchema.extend({
  levelLabel: z.string().default(""),
  themeText: z.string().default(""),
  sections: z.array(
    sectionWithCountSchema.extend({
      children: z.array(sectionWithCountSchema).default([]),
    }),
  ),
  totalPublishedQuestions: z.number().int().default(0),
  /** 此匿名學習者在此課題已完成的練習統計（未登入時仍可用） */
  progress: z
    .object({
      completedSessions: z.number().int(),
      answeredQuestions: z.number().int(),
      correctAnswers: z.number().int(),
      accuracy: z.number().nullable(),
    })
    .default({ completedSessions: 0, answeredQuestions: 0, correctAnswers: 0, accuracy: null }),
  /** 是否已有可用的教材內容（示範或已上載） */
  materialReady: z.boolean().default(false),
});
export type TopicOverview = z.infer<typeof topicOverviewSchema>;

/**
 * 課題內可選的主題數：分節若有子分節，以子分節為主題；否則分節本身即為一個主題。
 * 用於首頁顯示「共 N 個主題」，取代容易被誤解的題目數量。
 */
export function countPracticeThemes(topic: TopicOverview): number {
  return topic.sections.reduce(
    (total, section) => total + (section.children.length > 0 ? section.children.length : 1),
    0,
  );
}

/* ------------------------------------------------------------------ */
/* 教材段落                                                            */
/* ------------------------------------------------------------------ */

export const tableCellSchema = z.object({
  /** 合併儲存格的跨越數，未合併時為 1 */
  colSpan: z.number().int().min(1).default(1),
  text: z.string().default(""),
});
export type TableCell = z.infer<typeof tableCellSchema>;

export const materialBlockSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  topicId: z.string().nullable(),
  sectionId: z.string().nullable(),
  order: z.number().int(),
  type: materialBlockTypeSchema,
  /** 標題層級（1-6），其他類型為 null */
  level: z.number().int().nullable(),
  text: z.string(),
  /** 表格資料，非表格為 null */
  table: z.array(z.array(tableCellSchema)).nullable(),
  /** 人類可讀的來源位置，例如「HNC2A2E_T5_SN_TE.docx 第 3 個表格」 */
  sourceLocation: z.string(),
  /** native = 原文擷取；ocr = 由圖片文字辨識取得 */
  extractionMethod: extractionMethodSchema.default("native"),
  /** OCR 來源說明，例如「word/media/image12.png」 */
  ocrSource: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type MaterialBlock = z.infer<typeof materialBlockSchema>;

export const materialDocumentSchema = z.object({
  id: z.string().min(1),
  fileName: z.string().min(1),
  kind: documentKindSchema,
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  status: documentStatusSchema,
  /** 擷取失敗時的可理解錯誤訊息 */
  errorMessage: z.string().nullable(),
  /** 解析器回報的限制說明，例如「此 PDF 未包含可擷取文字」 */
  limitationNote: z.string().nullable(),
  blockCount: z.number().int(),
  imageCount: z.number().int(),
  topicId: z.string().nullable(),
  /** OCR 狀態及結果統計 */
  ocrStatus: ocrStatusSchema.default("not-run"),
  ocrProvider: z.string().nullable().default(null),
  ocrMessage: z.string().nullable().default(null),
  /** 成功辨識出文字的圖片數 */
  ocrRecognizedCount: z.number().int().default(0),
  /** 未能辨識（格式不支援或沒有文字）的圖片數 */
  ocrSkippedCount: z.number().int().default(0),
  ocrUpdatedAt: z.string().nullable().default(null),
  /** 原始檔案在本機的存放位置（供 OCR 重新讀取內嵌圖片；API 不會回傳給前端） */
  storedPath: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type MaterialDocument = z.infer<typeof materialDocumentSchema>;

/* ------------------------------------------------------------------ */
/* 題目                                                                */
/* ------------------------------------------------------------------ */

export const questionBaseSchema = z.object({
  id: z.string().min(1),
  topicId: z.string().min(1),
  sectionId: z.string().min(1),
  questionType: questionTypeSchema,
  difficulty: difficultySchema,
  question: z.string().min(4),
  /** 選擇題選項；其他題型為空陣列 */
  options: z.array(z.string().min(1)).default([]),
  /** 標準答案；選擇題為正確選項的完整文字 */
  correctAnswer: z.string().min(1),
  /** 填充題可接受的其他寫法 */
  acceptedAnswers: z.array(z.string()).default([]),
  explanation: z.string().min(1),
  knowledgePoint: z.string().min(1),
  /** 教材原文節錄（用於教師查核依據） */
  sourceExcerpt: z.string().min(2),
  /** 來源位置說明，例如「表格：文藝復興文學代表（第 3 個表格）」 */
  sourceLocation: z.string().min(1),
  /** 對應的教材段落 ID，供教師點擊查看 */
  sourceBlockIds: z.array(z.string()).default([]),
  /** 短答題得分要點（供學生自我檢查，非正式 HKDSE 評分） */
  gradingPoints: z.array(z.string()).default([]),
  origin: questionOriginSchema,
  status: questionStatusSchema,
  /** 是否已通過教材依據驗證 */
  sourceVerified: z.boolean(),
  /**
   * 品質警告（例如題目出現教材未提及的人名或條約名）。
   * 這類項目只提示教師核對，題目**不會**被丟棄；空陣列代表沒有警告。
   */
  qualityWarnings: z.array(z.string()).default([]),
  createdAt: z.string(),
});

/** 完整題目（含答案），供教師及後端使用 */
export const questionSchema = questionBaseSchema.superRefine((value, ctx) => {
  if (value.questionType === "mc") {
    if (value.options.length < 2) {
      ctx.addIssue({ code: "custom", message: "選擇題至少需要 2 個選項", path: ["options"] });
    }
    if (value.options.length > 0 && !value.options.includes(value.correctAnswer)) {
      ctx.addIssue({
        code: "custom",
        message: "選擇題的標準答案必須是其中一個選項",
        path: ["correctAnswer"],
      });
    }
  }
  if (value.questionType === "short" && value.gradingPoints.length === 0) {
    ctx.addIssue({
      code: "custom",
      message: "短答題必須提供得分要點，方便學生自我檢查",
      path: ["gradingPoints"],
    });
  }
});
export type Question = z.infer<typeof questionBaseSchema>;

/** 提供給學生作答的題目（不含答案，避免未作答前洩露） */
export const studentQuestionSchema = questionBaseSchema.omit({
  correctAnswer: true,
  acceptedAnswers: true,
  explanation: true,
  gradingPoints: true,
  sourceExcerpt: true,
  // 品質警告屬教師查核資訊，學生端不會看到
  qualityWarnings: true,
});
export type StudentQuestion = z.infer<typeof studentQuestionSchema>;

/** 教師建立／修改題目時提交的內容 */
export const questionInputSchema = questionBaseSchema
  .omit({ id: true, createdAt: true, sourceVerified: true })
  .extend({ status: questionStatusSchema.default("draft") });
export type QuestionInput = z.infer<typeof questionInputSchema>;

/* ------------------------------------------------------------------ */
/* AI 語意批改                                                         */
/* ------------------------------------------------------------------ */

/**
 * AI 語意批改結果。
 *
 * 用途：填充題與短答題不以「逐字比對」為唯一準則（例如「文藝復興」與
 * 「文藝復興時期」意思相同），改由 AI 判斷學生的答案在意思上是否達到要求。
 * 這不是正式 HKDSE 評分，介面必須明確說明。
 */
export const aiGradingSchema = z.object({
  /** correct = 意思等同標準答案；partial = 部分達到；incorrect = 未達到 */
  verdict: z.enum(["correct", "partial", "incorrect"]),
  /** 已達到的得分要點（短答題；逐字取自題目的 gradingPoints） */
  hitPoints: z.array(z.string()).default([]),
  /** 未達到的得分要點 */
  missingPoints: z.array(z.string()).default([]),
  /** 給學生的簡短中文回饋 */
  feedback: z.string().default(""),
  /** 補充說明（例如 AI 暫時無法使用時的提示） */
  note: z.string().nullable().default(null),
});
export type AiGrading = z.infer<typeof aiGradingSchema>;

export const AI_VERDICT_LABELS: Record<AiGrading["verdict"], string> = {
  correct: "已達到要求",
  partial: "部分達到要求",
  incorrect: "未達到要求",
};

/* ------------------------------------------------------------------ */
/* 練習設定 / 練習記錄 / 作答                                          */
/* ------------------------------------------------------------------ */

export const practiceModeSchema = z.enum(["standard", "wrong-only"]);
export type PracticeMode = z.infer<typeof practiceModeSchema>;

/**
 * 出題方式：
 *   bank = 先取題庫（示範題／教師已發布題目），不足時才即時生成
 *   ai   = 依所選分節即時生成（學生揀選主題後由 AI 出題）
 */
export const practiceQuestionSourceSchema = z.enum(["bank", "ai"]);
export type PracticeQuestionSource = z.infer<typeof practiceQuestionSourceSchema>;

export const PRACTICE_QUESTION_SOURCE_LABELS: Record<PracticeQuestionSource, string> = {
  bank: "使用題庫題目",
  ai: "AI 即時生成題目",
};

export const practiceSetupSchema = z.object({
  learnerId: z.string().min(1),
  topicId: z.string().min(1),
  /** 可選多個分節；選取父分節時會包含其子分節 */
  sectionIds: z.array(z.string().min(1)).min(1),
  questionTypes: z.array(questionTypeSchema).min(1),
  difficulty: difficultySchema,
  questionCount: z.number().int().min(1).max(30),
  mode: practiceModeSchema.default("standard"),
  /** 出題方式（預設 bank，維持原有行為） */
  questionSource: practiceQuestionSourceSchema.default("bank"),
  /** wrong-only 模式可指定由哪一次練習取錯題 */
  sourceSessionId: z.string().nullable().default(null),
});
export type PracticeSetup = z.infer<typeof practiceSetupSchema>;
/** 呼叫端可省略有預設值的欄位（例如 questionSource） */
export type PracticeSetupInput = z.input<typeof practiceSetupSchema>;

export const questionFeedbackSchema = z.object({
  questionId: z.string(),
  /** 學生答案（選擇題為選項文字，其他為輸入文字） */
  answer: z.string(),
  /** 是否可自動評分（短答題不可自動評分） */
  autoGraded: z.boolean(),
  isCorrect: z.boolean().nullable(),
  correctAnswer: z.string(),
  acceptedAnswers: z.array(z.string()),
  explanation: z.string(),
  knowledgePoint: z.string(),
  gradingPoints: z.array(z.string()),
  sourceExcerpt: z.string(),
  sourceLocation: z.string(),
  sourceBlockIds: z.array(z.string()),
  /** 教材依據是否包含 OCR 辨識文字（需教師核對） */
  sourceFromOcr: z.boolean().default(false),
  /** AI 語意批改結果（填充題／短答題；未使用 AI 時為 null） */
  aiGrading: aiGradingSchema.nullable().default(null),
  /** 學生自我檢查結果（短答題） */
  selfAssessment: z.enum(["understood", "needs-review"]).nullable().default(null),
});
export type QuestionFeedback = z.infer<typeof questionFeedbackSchema>;

export const practiceSessionSchema = z.object({
  id: z.string().min(1),
  learnerId: z.string().min(1),
  topicId: z.string().min(1),
  sectionIds: z.array(z.string()),
  questionTypes: z.array(questionTypeSchema),
  difficulty: difficultySchema,
  questionCount: z.number().int(),
  mode: practiceModeSchema,
  sourceSessionId: z.string().nullable(),
  /** 題目來源：教師題庫 / 即時生成 / 內建示範 */
  origin: z.enum(["bank", "generated", "demo"]),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type PracticeSession = z.infer<typeof practiceSessionSchema>;

export const answerSubmissionSchema = z.object({
  questionId: z.string().min(1),
  answer: z.string().default(""),
});
export type AnswerSubmission = z.infer<typeof answerSubmissionSchema>;

export const practiceResultSchema = z.object({
  session: practiceSessionSchema,
  totalQuestions: z.number().int(),
  answeredCount: z.number().int(),
  /** 可自動評分的題目數（選擇題、填充題） */
  gradedCount: z.number().int(),
  correctCount: z.number().int(),
  accuracy: z.number().nullable(),
  knowledgePointsToReview: z.array(
    z.object({
      knowledgePoint: z.string(),
      sectionTitle: z.string(),
      questionIds: z.array(z.string()),
    }),
  ),
  /** 短答題自我檢查中標記「需要重溫」的知識點 */
  selfReviewKnowledgePoints: z.array(z.string()),
  feedback: z.array(questionFeedbackSchema),
});
export type PracticeResult = z.infer<typeof practiceResultSchema>;

/* ------------------------------------------------------------------ */
/* 教師端：學生練習記錄                                                */
/* ------------------------------------------------------------------ */

/** 練習記錄中的單一題目（含學生答案及答對／答錯結果） */
export interface PracticeRecordQuestion {
  questionId: string;
  questionType: QuestionType;
  questionTypeLabel: string;
  question: string;
  sectionTitle: string;
  studentAnswer: string;
  correctAnswer: string;
  /** 已作答且可自動評分時為 true／false；未作答或短答自我檢查時為 null */
  isCorrect: boolean | null;
  selfAssessment: "understood" | "needs-review" | null;
  aiVerdict: "correct" | "partial" | "incorrect" | null;
  answered: boolean;
}

/** 教師端查閱／匯出的一次練習記錄 */
export interface PracticeRecordSession {
  sessionId: string;
  learnerId: string;
  learnerLabel: string;
  topicId: string;
  topicTitle: string;
  createdAt: string;
  completedAt: string | null;
  questionTypes: QuestionType[];
  questionTypeLabels: string[];
  difficulty: Difficulty;
  difficultyLabel: string;
  totalQuestions: number;
  answeredCount: number;
  correctCount: number;
  wrongCount: number;
  /** 準確率（0-1）；沒有可評分題目時為 null */
  accuracy: number | null;
  questions: PracticeRecordQuestion[];
}

/** 教師端學習記錄篩選器可選用的課題 */
export interface PracticeRecordTopicOption {
  id: string;
  title: string;
  level: number;
  topicNumber: number | null;
}

/** 曾作答的學習者摘要（不含姓名等個人資料） */
export interface PracticeRecordLearner {
  learnerId: string;
  lastAt: string;
  sessions: number;
}

/** 教師端首頁統計（只包含出題相關及學生練習記錄；教材、OCR 及系統狀態屬管理員職能） */
export interface TeacherQuestionOverview {
  questions: {
    total: number;
    published: number;
    draft: number;
    disabled: number;
    /** 未通過教材依據核對（教材重新匯入後可能出現），已排除校內試題 */
    unverified: number;
    /** 校內試題（來源為試卷）題數 */
    schoolPaper: number;
    /** 有未處理的學生回報，需教師覆核 */
    flagged: number;
  };
  records: {
    /** 已留檔的練習次數 */
    sessions: number;
    /** 有練習記錄的學習者數目（含匿名及教師測試身分） */
    learners: number;
  };
}

/** 練習題目組裝結果 */
export const assembledPracticeSchema = z.object({
  session: practiceSessionSchema,
  questions: z.array(studentQuestionSchema),
  /** 組題時需要告知學生的訊息（例如使用示範題庫） */
  notice: z.string().nullable(),
});
export type AssembledPractice = z.infer<typeof assembledPracticeSchema>;

/* ------------------------------------------------------------------ */
/* LLM 相關                                                            */
/* ------------------------------------------------------------------ */

/** LLM 必須返回的題目格式（之後會轉成內部 Question 並驗證教材依據） */
export const llmQuestionSchema = z.object({
  questionType: questionTypeSchema,
  difficulty: difficultySchema,
  question: z.string().min(4),
  options: z.array(z.string().min(1)).default([]),
  correctAnswerIndex: z.number().int().nullable().default(null),
  /**
   * 標準答案／參考答案。
   * 短答題容許模型留空（部分模型會這樣做），驗證時會以得分要點組出參考答案。
   */
  correctAnswer: z.string().default(""),
  explanation: z.string().min(1),
  knowledgePoint: z.string().min(1),
  sourceExcerpt: z.string().min(2),
  sourceBlockIds: z.array(z.string().min(1)).min(1),
  gradingPoints: z.array(z.string()).default([]),
});
export type LlmQuestion = z.infer<typeof llmQuestionSchema>;

export const llmResponseSchema = z.object({
  questions: z.array(llmQuestionSchema).min(1),
});
export type LlmResponse = z.infer<typeof llmResponseSchema>;

export const questionGenerationRequestSchema = z.object({
  topicId: z.string().min(1),
  sectionIds: z.array(z.string().min(1)).min(1),
  questionTypes: z.array(questionTypeSchema).min(1),
  difficulty: difficultySchema,
  questionCount: z.number().int().min(1).max(30),
});
export type QuestionGenerationRequest = z.infer<typeof questionGenerationRequestSchema>;

export const generatedQuestionPreviewSchema = z.object({
  provider: z.string(),
  providerLabel: z.string(),
  usedDemoFallback: z.boolean(),
  discardedCount: z.number().int(),
  discardReasons: z.array(z.string()),
  questions: z.array(questionSchema),
});
export type GeneratedQuestionPreview = z.infer<typeof generatedQuestionPreviewSchema>;

/** AI 語意批改時，模型必須返回的格式（之後會驗證並轉成 AiGrading） */
export const llmGradingSchema = z.object({
  verdict: z.enum(["correct", "partial", "incorrect"]),
  /** 已達到的得分要點索引（0 起計），只在短答題使用 */
  hitPointIndexes: z.array(z.number().int()).default([]),
  /** 給學生的簡短中文回饋 */
  feedback: z.string().default(""),
});
export type LlmGradingResponse = z.infer<typeof llmGradingSchema>;

/* ------------------------------------------------------------------ */
/* 學習記錄與 API 回應                                                 */
/* ------------------------------------------------------------------ */

export const learnerSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string(),
});
export type Learner = z.infer<typeof learnerSchema>;

export const apiErrorSchema = z.object({
  error: z.string(),
  details: z.array(z.string()).default([]),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** 學習者 ID 是隨機 UUID，不含任何個人資料；前端存放於 localStorage */
export const LEARNER_STORAGE_KEY = "hk-history-learner-id";

/* ------------------------------------------------------------------ */
/* 學校帳戶登入                                                        */
/* ------------------------------------------------------------------ */

/**
 * 登入角色：
 *   student 學生：只可使用學生端
 *   teacher 教師：學生端 + 出題相關功能（題目管理、生成題目）及查看學生練習記錄
 *   admin   管理員：包含教師全部功能，另可管理教材、OCR、課題發布及系統狀態
 */
export const SIGN_IN_ROLES = ["student", "teacher", "admin"] as const;
export const signInRoleSchema = z.enum(SIGN_IN_ROLES);
export type SignInRole = z.infer<typeof signInRoleSchema>;

export const SIGN_IN_ROLE_LABELS: Record<SignInRole, string> = {
  student: "學生",
  teacher: "教師",
  admin: "管理員",
};

/** 教師及管理員（可存取後台功能的身分） */
export function isStaffRole(role: SignInRole): boolean {
  return role === "teacher" || role === "admin";
}

/** 已登入的學校 Google 帳戶。learnerId 由伺服器依電郵推導，學習記錄跟隨帳戶。 */
export const sessionUserSchema = z.object({
  email: z.string().min(3),
  name: z.string().default(""),
  role: signInRoleSchema,
  learnerId: z.string().min(1),
  pictureUrl: z.string().nullable().default(null),
  /** 學生名冊提供的學號（教師或未核對時為 null） */
  studentNumber: z.string().nullable().default(null),
  /** 學生名冊提供的班別 */
  className: z.string().nullable().default(null),
  /** 是否已在學生名冊中核對（教師為 false） */
  rosterVerified: z.boolean().default(false),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;
/** 建立工作階段時的輸入型別（班別、學號等欄位可省略，解析時會補上預設值） */
export type SessionUserInput = z.input<typeof sessionUserSchema>;

/** 學生名冊狀態（供健康檢查及教師端顯示；不含任何學生個人資料） */
export const rosterStatusSchema = z.object({
  enabled: z.boolean(),
  /** 名冊以外的學生帳戶是否不可登入 */
  enforce: z.boolean(),
  source: z.enum(["none", "csv", "file", "sheets-api"]),
  /** 是否已成功載入名冊 */
  loaded: z.boolean(),
  /** 名冊人數（未載入時為 null） */
  students: z.number().int().nullable().default(null),
  /** 其中班別在開放範圍內的人數（未設範圍時與 students 相同） */
  inScope: z.number().int().nullable().default(null),
  /** 開放的班別範圍（空白 = 不設限） */
  classPrefixes: z.array(z.string()).default([]),
  classes: z.array(z.string()).default([]),
  loadedAt: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
});
export type RosterStatus = z.infer<typeof rosterStatusSchema>;

/** 登入狀態（供前端顯示；未啟用登入時 enabled = false） */
export const authStatusSchema = z.object({
  enabled: z.boolean(),
  /** 是否必須登入才能使用練習功能 */
  requireSignIn: z.boolean(),
  /** 校內網域（供登入頁說明使用） */
  schoolDomains: z.array(z.string()).default([]),
  user: sessionUserSchema.nullable().default(null),
});
export type AuthStatus = z.infer<typeof authStatusSchema>;

export const healthSchema = z.object({
  ok: z.boolean(),
  /** 應用程式版本（讀取 package.json；讀不到時為 unknown） */
  version: z.string().default("unknown"),
  /** 資料庫連線狀態：只回報驅動名稱及狀態，不含實際路徑 */
  database: z.object({
    driver: z.string(),
    status: z.string(),
  }),
  llmProvider: z.string(),
  llmProviderLabel: z.string(),
  llmConfigured: z.boolean(),
  demoMode: z.boolean(),
  /** 是否可使用 AI 語意批改（填充題／短答題） */
  aiGrading: z.boolean().default(false),
  /** OCR provider（none = 已停用） */
  ocrProvider: z.string().default("none"),
  ocrEnabled: z.boolean().default(false),
  /** 是否已啟用學校帳戶登入 */
  authEnabled: z.boolean().default(false),
  /** 後台 API（題目、記錄、教材、系統）是否未受登入保護（只應在本機示範時為 true） */
  staffApiOpen: z.boolean().default(false),
  /** 學生名冊狀態（不含任何學生個人資料） */
  roster: rosterStatusSchema,
  /** 資料持久化：Cloud Storage 備份狀態（不含 bucket 憑證） */
  persistence: z
    .object({
      backupEnabled: z.boolean().default(false),
      lastSuccessAt: z.string().nullable().default(null),
      lastError: z.string().nullable().default(null),
        backupsUploaded: z.number().int().default(0),
      /** 啟動還原結果：restored／skipped／failed／not-attempted */
      restore: z.string().default("not-attempted"),
    })
    .default({
      backupEnabled: false,
      lastSuccessAt: null,
      lastError: null,
        backupsUploaded: 0,
      restore: "not-attempted",
    }),
});
export type Health = z.infer<typeof healthSchema>;

/* ------------------------------------------------------------------ */
/* 教師端儀表板 / 系統狀態                                             */
/* ------------------------------------------------------------------ */

export const teacherOverviewSchema = z.object({
  topics: z.object({
    total: z.number().int(),
    published: z.number().int(),
    curriculum: z.number().int(),
  }),
  materials: z.object({
    documents: z.number().int(),
    uploaded: z.number().int(),
    demo: z.number().int(),
    blocks: z.number().int(),
    ocrBlocks: z.number().int(),
    ocrPending: z.number().int(),
  }),
  questions: z.object({
    total: z.number().int(),
    published: z.number().int(),
    draft: z.number().int(),
    disabled: z.number().int(),
    unverified: z.number().int(),
    /** 校內試題（來源為試卷）題數，供教師掌握核對進度 */
    schoolPaper: z.number().int().default(0),
    flagged: z.number().int(),
  }),
  observability: z.object({
    llmRequests: z.number().int(),
    llmFailures: z.number().int(),
    grading: z.object({
      attempts: z.number().int(),
      failures: z.number().int(),
      fallbacks: z.number().int(),
    }),
  }),
});
export type TeacherOverview = z.infer<typeof teacherOverviewSchema>;

export const systemStatusSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  database: z.object({ driver: z.string(), status: z.string(), message: z.string().nullable() }),
  llm: z.object({
    provider: z.string(),
    providerLabel: z.string(),
    model: z.string().nullable(),
    configured: z.boolean(),
    demoMode: z.boolean(),
    aiGrading: z.boolean(),
    notice: z.string().nullable(),
  }),
  ocr: z.object({
    enabled: z.boolean(),
    provider: z.string(),
    providerLabel: z.string(),
    languages: z.string(),
    notice: z.string().nullable(),
  }),
  auth: z.object({
    enabled: z.boolean(),
    requireSignIn: z.boolean(),
    schoolDomains: z.array(z.string()),
    staffApiOpen: z.boolean(),
  }),
  roster: rosterStatusSchema,
  deployment: z.object({
    platform: z.string(),
    ephemeralStorage: z.boolean(),
    notes: z.array(z.string()),
  }),
  backup: z.object({
    enabled: z.boolean(),
    lastSuccessAt: z.string().nullable().default(null),
    lastError: z.string().nullable().default(null),
    backupsUploaded: z.number().int().default(0),
    restore: z.string().default("not-attempted"),
    restoreMessage: z.string().nullable().default(null),
  }),
  configIssues: z.array(
    z.object({ level: z.string(), code: z.string(), message: z.string() }),
  ),
});
export type SystemStatus = z.infer<typeof systemStatusSchema>;

/* ------------------------------------------------------------------ */
/* 題目回報（學生回報 → 教師覆核）                                     */
/* ------------------------------------------------------------------ */

export const QUESTION_REPORT_REASONS = [
  "unclear",
  "answer-disputed",
  "explanation-unclear",
  "source-problem",
  "other",
] as const;
export const questionReportReasonSchema = z.enum(QUESTION_REPORT_REASONS);
export type QuestionReportReason = z.infer<typeof questionReportReasonSchema>;

export const QUESTION_REPORT_REASON_LABELS: Record<QuestionReportReason, string> = {
  unclear: "題目不清楚",
  "answer-disputed": "答案有爭議",
  "explanation-unclear": "解釋不明白",
  "source-problem": "教材來源有問題",
  other: "其他",
};

export const QUESTION_REPORT_STATUSES = ["open", "resolved", "dismissed"] as const;
export const questionReportStatusSchema = z.enum(QUESTION_REPORT_STATUSES);
export type QuestionReportStatus = z.infer<typeof questionReportStatusSchema>;

export const QUESTION_REPORT_STATUS_LABELS: Record<QuestionReportStatus, string> = {
  open: "待覆核",
  resolved: "已處理",
  dismissed: "已略過",
};

/** 學生提交題目回報的內容（learnerId 由伺服器依工作階段決定） */
export const questionReportInputSchema = z.object({
  questionId: z.string().min(1),
  /** 作答中的練習（用於核對回報者確實做過這題） */
  sessionId: z.string().min(1).nullable().default(null),
  reason: questionReportReasonSchema,
  detail: z.string().max(500).default(""),
});
export type QuestionReportInput = z.input<typeof questionReportInputSchema>;

export const questionReportSchema = z.object({
  id: z.string().min(1),
  questionId: z.string().min(1),
  sessionId: z.string().nullable().default(null),
  learnerId: z.string().min(1),
  topicId: z.string().min(1),
  reason: questionReportReasonSchema,
  detail: z.string().default(""),
  status: questionReportStatusSchema,
  createdAt: z.string(),
  resolvedAt: z.string().nullable().default(null),
  resolvedBy: z.string().nullable().default(null),
});
export type QuestionReport = z.infer<typeof questionReportSchema>;

/** 教師端看到的回報（附題目文字、分節及回報者顯示名稱） */
export const questionReportDetailSchema = questionReportSchema.extend({
  question: z.string(),
  questionStatus: questionStatusSchema,
  /** false 表示該題只存在於練習快照（AI 即時生成題目不會寫入題庫），教師無法在題庫編輯 */
  inQuestionBank: z.boolean().default(true),
  sectionTitle: z.string(),
  topicTitle: z.string(),
  /** 同一題目的未處理回報數（顯示「待覆核」用） */
  openCountForQuestion: z.number().int().default(1),
});
export type QuestionReportDetail = z.infer<typeof questionReportDetailSchema>;

/* ------------------------------------------------------------------ */
/* LLM 用量及 AI 批改監控                                              */
/* ------------------------------------------------------------------ */

/** API 回報的 token 用量（本地示範生成或 API 未提供時為 null） */
export interface LlmUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export const LLM_REQUEST_TYPES = ["question-instant", "question-bank", "grading"] as const;
export const llmRequestTypeSchema = z.enum(LLM_REQUEST_TYPES);
export type LlmRequestType = z.infer<typeof llmRequestTypeSchema>;

export const LLM_REQUEST_TYPE_LABELS: Record<LlmRequestType, string> = {
  "question-instant": "學生即時出題",
  "question-bank": "題庫批次生成",
  grading: "AI 語意批改",
};

export const llmUsageEntrySchema = z.object({
  requestType: llmRequestTypeSchema,
  provider: z.string(),
  model: z.string().nullable().default(null),
  topicId: z.string().nullable().default(null),
  success: z.boolean(),
  durationMs: z.number().int().min(0),
  inputTokens: z.number().int().nullable().default(null),
  outputTokens: z.number().int().nullable().default(null),
  /** 錯誤類別（例如 timeout / rate-limit / invalid-response），不含原始訊息內容 */
  errorType: z.string().nullable().default(null),
});
export type LlmUsageEntry = z.infer<typeof llmUsageEntrySchema>;

export const llmUsageLogSchema = llmUsageEntrySchema.extend({
  id: z.string(),
  createdAt: z.string(),
});
export type LlmUsageLog = z.infer<typeof llmUsageLogSchema>;

export const gradingLogSchema = z.object({
  id: z.string(),
  questionId: z.string().nullable().default(null),
  sessionId: z.string().nullable().default(null),
  questionType: z.string(),
  provider: z.string(),
  success: z.boolean(),
  /** 是否回退到字詞比對或學生自我檢查 */
  fellBack: z.boolean(),
  durationMs: z.number().int().min(0),
  errorType: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type GradingLog = z.infer<typeof gradingLogSchema>;

export const observabilitySummarySchema = z.object({
  /** 統計期間（日數） */
  days: z.number().int(),
  llmRequests: z.number().int(),
  llmFailures: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  grading: z.object({
    attempts: z.number().int(),
    failures: z.number().int(),
    fallbacks: z.number().int(),
  }),
  recentLlm: z.array(llmUsageLogSchema),
  recentGrading: z.array(gradingLogSchema),
  /** 依錯誤類別統計失敗次數 */
  errorTypes: z.array(z.object({ errorType: z.string(), count: z.number().int() })),
});
export type ObservabilitySummary = z.infer<typeof observabilitySummarySchema>;
