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
 * level 0 保留給未對應任何年級的教材，學生端不會顯示。
 */
export const curriculumLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export type CurriculumLevel = z.infer<typeof curriculumLevelSchema>;

export const CURRICULUM_LEVEL_LABELS: Record<CurriculumLevel, string> = {
  0: "未分類",
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

/** 歷史技能的 zod schema（題目標籤及進度統計使用；未標示時為 null） */
export const historySkillSchema = z.enum(HISTORY_SKILLS);

/**
 * 課題及技能層面的學習狀態。
 *
 * 定義於共用型別（而非伺服器服務），令前端與伺服器使用同一套標示，
 * 不會出現兩邊文字不一致的情況。判定這些狀態的**計數規則**見
 * src/server/services/learning-loop.ts 的檔案說明。
 */
export const learningStateSchema = z.enum([
  "not-started",
  "in-progress",
  "needs-review",
  "repeatedly-demonstrated",
]);
export type LearningState = z.infer<typeof learningStateSchema>;

export const LEARNING_STATE_LABELS: Record<LearningState, string> = {
  "not-started": "尚未開始",
  "in-progress": "進行中",
  "needs-review": "需要重溫",
  "repeatedly-demonstrated": "已多次答對",
};

/** 重溫佇列中每一題的到期原因（供學生理解為何現在要重溫） */
export const reviewReasonSchema = z.enum(["incorrect", "uncertain", "due-after-mistake", "due"]);
export type ReviewReason = z.infer<typeof reviewReasonSchema>;

export const REVIEW_REASON_LABELS: Record<ReviewReason, string> = {
  incorrect: "之前答錯",
  uncertain: "之前答案未能確定",
  "due-after-mistake": "曾答錯，現已到鞏固時間",
  due: "已到鞏固時間",
};

/** 下一步建議的類別（每一項都必須能追溯至真實的作答記錄） */
export const recommendationKindSchema = z.enum([
  "review-due",
  "redo-wrong",
  "practise-skill",
  "read-lesson",
  "try-topic",
  "neutral",
]);
export type RecommendationKind = z.infer<typeof recommendationKindSchema>;

/** 課題層面的學習進度（學生自己的記錄） */
export interface TopicProgressSummary {
  topicId: string;
  title: string;
  /** 課題內已發布、可作答的題目數 */
  eligibleQuestions: number;
  /** 學生已作答的**不同**題目數 */
  attemptedQuestions: number;
  correctQuestions: number;
  incorrectQuestions: number;
  /** 最新作答為「不確定」（近似答案）的不同題目數 */
  uncertainQuestions: number;
  state: LearningState;
}

/** 技能層面的學習進度（只計算 HISTORY_SKILLS 內的有效標示） */
export interface SkillProgressSummary {
  skill: HistorySkill;
  topicTitle: string;
  eligibleQuestions: number;
  attemptedQuestions: number;
  correctQuestions: number;
  incorrectQuestions: number;
  state: LearningState;
  /** 證據是否足夠；不足時不可顯示為弱項 */
  sufficientEvidence: boolean;
}

/** 重溫佇列中的一題（只顯示課題、分節及原因，不含題目內容或答案） */
export interface ReviewQueueItemSummary {
  questionId: string;
  topicId: string;
  topicTitle: string;
  sectionId: string;
  sectionTitle: string;
  reason: ReviewReason;
  daysSince: number;
  daysOverdue: number;
  lastAnsweredAt: string;
}

export interface LearningRecommendation {
  kind: RecommendationKind;
  title: string;
  /** 依據：必須來自真實的作答記錄 */
  reason: string;
  href: string;
}

/** GET /api/progress 的回傳內容 */
export interface LearningProgressPayload {
  topics: TopicProgressSummary[];
  /** 只在指定 `topicId` 時提供（技能進度屬單一課題的統計） */
  skills: SkillProgressSummary[];
  review: {
    dueItems: ReviewQueueItemSummary[];
    /** 到期題目總數（`dueItems` 可能已被截短） */
    dueCount: number;
    /** 因時間戳缺失或格式錯誤而無法排程的作答數 */
    dataIssues: number;
  };
  recommendations: LearningRecommendation[];
}

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
  /** 課程年級：1 中一、2 中二、3 中三（0 為未分類） */
  level: curriculumLevelSchema.default(1),
  /** 教育局課程的課題編號（例如 5）；未對應者為 null */
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
   * 此分節（含子分節）已匯入的教材段落數（教師可見的**全部**教材，
   * 包含校內試題檔及尚未開放給學生的教材）。
   * 0 表示沒有教材依據，即時生成無法出題，介面會提示教師先補充教材。
   */
  materialBlockCount: z.number().int().default(0),
  /**
   * 此分節（含子分節）中「學生實際可用來出題」的教材段落數。
   *
   * 只有已確認可向學生發布、且非教師專用內容的段落才計入（見
   * `studentMaterialBlockCounts`）。0 表示學生即時出題**必定**被版權閘門擋下，
   * 因此介面不可讓學生選取這樣的主題（見 `isSectionPractisable`）。
   */
  studentMaterialBlockCount: z.number().int().default(0),
});
export type SectionWithCount = z.infer<typeof sectionWithCountSchema>;

/**
 * 這個分節對學生是否真的可以出題。出題方式不同，條件亦不同：
 *   ai：必須有「學生可用」的教材段落，否則即時出題會被版權閘門擋下（409）。
 *   bank：題庫已有已發布題目即可；題目不足時系統會以同一批可用教材補足，
 *         生成失敗亦會回退題庫，因此不會令學生無法開始練習。
 *
 * 介面用它提醒學生哪些主題暫不可選，避免出現「選了卻出不到題」的情況——
 * 判定必須用 `studentMaterialBlockCount`（學生可用），而不是包含校內試題檔及
 * 未開放教材的 `materialBlockCount`。
 */
export function isSectionPractisable(
  section: { publishedQuestionCount: number; studentMaterialBlockCount: number },
  source: PracticeQuestionSource,
): boolean {
  if (source === "ai") return section.studentMaterialBlockCount > 0;
  return section.publishedQuestionCount > 0 || section.studentMaterialBlockCount > 0;
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
  /**
   * 學生可否在平台內閱讀這份教材的內容（預設 false = 不可）。
   *
   * `/learn/[topicId]` 會原文顯示教材，等同在平台內發布該內容；教材可能受版權限制，
   * 而本專案沒有任何授權紀錄，因此必須由管理員逐份文件明確確認後才會顯示。
   * 未確認的文件對學生完全不顯示（fail-closed）。
   */
  studentDistribution: z.boolean().default(false),
  /**
   * 版權／發行權確認時間（遷移 0017）。`studentDistribution` 為 true 但這個欄位為 null 時，
   * 文件**不會**向學生顯示（見 `documentIsStudentVisible`）。
   */
  rightsConfirmedAt: z.string().nullable().default(null),
  /** 內容安全覆核時間（教師版文件必須有這個確認才可向學生顯示） */
  contentReviewedAt: z.string().nullable().default(null),
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
  /**
   * 這條題目主要考核的歷史技能（取自教育局《歷史科課程指引》的 HISTORY_SKILLS）。
   * 用於技能層面的進度統計；教師手動建立或未標示時為 null。
   *
   * 注意：現有題型（選擇題、填充題、短答題）只能考核部分技能；
   * 需要展示史料並要求學生推論的技能**不在此平台範圍**，因此未標示為已涵蓋。
   */
  skill: historySkillSchema.nullable().default(null),
  /**
   * 題目內容的版本編號。每當題目內容被修改就會 +1（由伺服器管理，不由前端提供）。
   *
   * 用途：人工覆核必須對應**實際被覆核的那一版**。覆核紀錄記下當時的版本，
   * 題目之後被修改時版本會遞增，舊的覆核就不再適用（見 questionReviewSchema）。
   */
  revision: z.number().int().positive().default(1),
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
  // 來源位置及段落 ID 同樣是教材依據的一部分：未作答前不需要，作答後由回饋提供
  // （且只在來源文件已確認可向學生發布時才提供，見 studentExcerptVisibility）
  sourceLocation: true,
  sourceBlockIds: true,
  // 品質警告屬教師查核資訊，學生端不會看到
  qualityWarnings: true,
});
export type StudentQuestion = z.infer<typeof studentQuestionSchema>;

/** 教師建立／修改題目時提交的內容 */
export const questionInputSchema = questionBaseSchema
  .omit({ id: true, createdAt: true, sourceVerified: true, revision: true })
  .extend({ status: questionStatusSchema.default("draft") });
export type QuestionInput = z.infer<typeof questionInputSchema>;

/* ------------------------------------------------------------------ */
/* 教師人工覆核（題目發布關卡）                                        */
/* ------------------------------------------------------------------ */

/**
 * 人工覆核的決定。
 *
 *   - `approved`：教師確認這一版題目的史實、用語、選項、答案及解釋均無問題。
 *   - `rejected`：這一題不可用（例如史實有誤、答案不成立）。
 *   - `returned`：退回修改（例如選項具誤導性、解釋不足）。
 *
 * `rejected` 及 `returned` 都必須填寫原因，讓其他人知道要處理甚麼。
 */
export const questionReviewDecisionSchema = z.enum(["approved", "rejected", "returned"]);
export type QuestionReviewDecision = z.infer<typeof questionReviewDecisionSchema>;

export const QUESTION_REVIEW_DECISION_LABELS: Record<QuestionReviewDecision, string> = {
  approved: "已覆核通過",
  rejected: "不可用（退回）",
  returned: "退回修改",
};

/**
 * 一筆人工覆核紀錄（只可新增，不可修改或刪除）。
 *
 * 紀錄綁定「題目 + 版本 + 被覆核內容的指紋」：
 *   - `revision` 令覆核可追溯到實際被覆核的那一版；
 *   - `questionFingerprint` 是題目內容的雜湊，即使版本編號因任何原因沒有遞增，
 *     內容改變亦不會被當成同一版；
 *   - 資料庫對 (question_id, revision, decision, fingerprint) 設有唯一索引，
 *     因此重試或重複提交**不會**產生重複的覆核事件。
 */
export const questionReviewSchema = z.object({
  id: z.string().min(1),
  questionId: z.string().min(1),
  revision: z.number().int().positive(),
  decision: questionReviewDecisionSchema,
  /** 退回或不可用的原因；`approved` 時可為 null */
  reason: z.string().nullable(),
  /** 覆核者身分（來自伺服器端的工作階段，不接受前端提供的值） */
  reviewerEmail: z.string().min(1),
  reviewerRole: z.string().min(1),
  questionFingerprint: z.string().min(1),
  createdAt: z.string(),
});
export type QuestionReview = z.infer<typeof questionReviewSchema>;

/**
 * 題目的覆核狀態（由 `status`、`revision` 及覆核紀錄**推導**，不是新的狀態欄位）。
 *
 * 刻意不新增「已覆核」欄位：學生可見性仍然只由 `questions.status` 決定，
 * 覆核紀錄只回答「這一版由誰在何時確認過」。
 */
export const questionReviewStateSchema = z.enum([
  "pending-review",
  "approved",
  "approved-unpublished",
  "rejected",
  "returned",
  "stale-approval",
  "published-unreviewed",
  "retired",
]);
export type QuestionReviewState = z.infer<typeof questionReviewStateSchema>;

export const QUESTION_REVIEW_STATE_LABELS: Record<QuestionReviewState, string> = {
  "pending-review": "待教師覆核",
  approved: "已覆核通過（已發布）",
  "approved-unpublished": "已覆核通過（未發布）",
  rejected: "不可用（未發布）",
  returned: "退回修改（未發布）",
  "stale-approval": "覆核後已修改，需重新覆核",
  "published-unreviewed": "已發布（未經人工覆核）",
  retired: "已停用",
};

/** 教師端看到的題目：題目內容 + 覆核狀態及最新紀錄 */
export const teacherQuestionViewSchema = z.object({
  question: questionSchema,
  reviewState: questionReviewStateSchema,
  /** 最新一筆覆核紀錄（沒有任何紀錄時為 null） */
  latestReview: questionReviewSchema.nullable(),
  /** 對應目前版本、且決定為 approved 的覆核紀錄（沒有則為 null） */
  approvedReview: questionReviewSchema.nullable(),
});
export type TeacherQuestionView = z.infer<typeof teacherQuestionViewSchema>;

/** 學生看不到教材節錄的原因（教師端顯示用；與 source-visibility.ts 的判定一致） */
export const studentExcerptHiddenReasonSchema = z.enum([
  "unconfirmed-material",
  "teacher-edition",
  "exercise-content",
  "missing-source-blocks",
  "lookup-failed",
]);
export type StudentExcerptHiddenReason = z.infer<typeof studentExcerptHiddenReasonSchema>;

export const STUDENT_EXCERPT_HIDDEN_REASON_LABELS: Record<StudentExcerptHiddenReason, string> = {
  "unconfirmed-material": "來源教材尚未確認可向學生發布",
  "teacher-edition": "來源段落屬教師版內容（答案或評分參考）",
  "exercise-content": "來源段落是練習題目、評分參考或零散文字（非課文內容）",
  "missing-source-blocks": "引用的教材段落已不存在，需重新核對依據",
  "lookup-failed": "查證教材依據時出錯，已先當作不顯示",
};

/**
 * 題目清單用的覆核狀態（不重複題目內容，避免清單回應體積倍增）。
 *
 * 學生端的題目可見性仍然只由 `questions.status` 決定；這裡只讓教師知道
 * 每一題的覆核狀態，以及是誰在何時決定的。
 */
export const questionReviewStatusSchema = z.object({
  questionId: z.string().min(1),
  reviewState: questionReviewStateSchema,
  latestReview: questionReviewSchema.nullable(),
  approvedReview: questionReviewSchema.nullable(),
  /**
   * 學生是否看得到本題的教材節錄。`false` 代表版權／教材閘門略去了節錄
   * （原因見 `sourceExcerptHiddenReason`），教師可在這裡發現需要處理的題目，
   * 而不是以為學生已經看到節錄。
   */
  sourceExcerptHiddenFromStudents: z.boolean().default(false),
  sourceExcerptHiddenReason: studentExcerptHiddenReasonSchema.nullable().default(null),
});
export type QuestionReviewStatus = z.infer<typeof questionReviewStatusSchema>;

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
  /**
   * 教材原文節錄。若題目引用的教材文件尚未確認可向學生發布，這裡會是 null
   * （同時 `sourceWithheld` 為 true，見 `sourceExcerptIsStudentVisible`）。
   * 這可避免把未確認或教師版教材的原文（可能是答案或評分參考）顯示給學生。
   */
  sourceExcerpt: z.string().nullable(),
  sourceLocation: z.string().nullable(),
  sourceBlockIds: z.array(z.string()),
  /** 是否因來源未確認可向學生發布而略去節錄（介面會說明原因） */
  sourceWithheld: z.boolean().default(false),
  /** 教材依據是否包含 OCR 辨識文字（需教師核對） */
  sourceFromOcr: z.boolean().default(false),
  /** AI 語意批改結果（填充題／短答題；未使用 AI 時為 null） */
  aiGrading: aiGradingSchema.nullable().default(null),
  /** 學生自我檢查結果（短答題） */
  selfAssessment: z.enum(["understood", "needs-review"]).nullable().default(null),
  /**
   * 需要教師覆核的評分情況（評分本身仍然照常記錄，不會因此改變分數）：
   *   uncertain-answer = 學生的答案與標準答案極為接近但並非逐字相同（可能是錯別字或
   *                      未列出的可接受寫法），系統無法確定應否視為正確。
   * 讓學生知道「這個判斷未必準確」，亦讓教師在記錄中看到需要覆核的個案。
   */
  reviewFlag: z.enum(["uncertain-answer"]).nullable().default(null),
  /**
   * AI 批改因用量上限而未能執行（題目仍然照常作答及記錄，只是在這次沒有 AI 語意判斷）。
   * 與「AI 暫時無法使用」分開顯示，讓學生知道原因是可以再試的用量限制。
   */
  aiLimitReached: z.boolean().default(false),
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

/* ------------------------------------------------------------------ */
/* 學生閱讀教材（學習模式）                                            */
/* ------------------------------------------------------------------ */

/**
 * 學生閱讀用的教材段落。
 * 只包含已發布課題的教材內容（不含校內試題及答案），純粹供閱讀；
 * 學生在練習題中仍然看不到教材（題目不可要求參考教材）。
 */
export const lessonBlockSchema = z.object({
  id: z.string().min(1),
  type: materialBlockTypeSchema,
  /** 標題層級（1-6）；非標題為 null */
  level: z.number().int().nullable(),
  text: z.string(),
  /** 表格資料（列為單位），非表格為空陣列 */
  rows: z.array(z.array(z.string())).default([]),
  sourceLocation: z.string(),
  /** 文字來自 OCR 辨識（可能與原書有出入，介面必須提示學生對照課本） */
  fromOcr: z.boolean().default(false),
});
export type LessonBlock = z.infer<typeof lessonBlockSchema>;

export const lessonSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  /** 上層分節 ID（頂層為 null） */
  parentId: z.string().nullable().default(null),
  /** 縮排層級（0 = 頂層） */
  depth: z.number().int().min(0).default(0),
  blocks: z.array(lessonBlockSchema),
});
export type LessonSection = z.infer<typeof lessonSectionSchema>;

export const lessonViewSchema = z.object({
  topic: z.object({
    id: z.string().min(1),
    title: z.string(),
    level: z.number().int(),
    levelLabel: z.string(),
    themeTitle: z.string(),
  }),
  sections: z.array(lessonSectionSchema),
  /** 教材是否包含 OCR 辨識文字（介面顯示提示） */
  hasOcrText: z.boolean().default(false),
  /** 需要告知學生的訊息（例如教材尚未匯入） */
  notice: z.string().nullable().default(null),
  /**
   * 因屬教師專用內容（答案、評分參考）而未顯示的段落數。
   *
   * 讓管理員核對「這份教師版教材是否有內容被略過」；學生介面只會說有部分內容未開放，
   * 不會看到這些段落本身。這是啟發式過濾，不是內容審查證明。
   */
  withheldTeacherBlocks: z.number().int().min(0).default(0),
});
export type LessonView = z.infer<typeof lessonViewSchema>;

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
  /**
   * 主要考核的歷史技能（必須取自固定的 HISTORY_SKILLS 清單）。
   * 數值不在清單內時為 null，避免模型自創技能名稱而令統計失真。
   */
  skill: z.string().nullable().default(null),
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
  /**
   * 定期維護（資料保留期清理）的執行狀態。
   *
   * 只有類別、時間及次數，不含任何學習者資料；用途是證明保留期真的有在執行，
   * 而不只是「程式碼寫過清理」。
   */
  maintenance: z
    .array(
      z.object({
        kind: z.string(),
        lastStartedAt: z.string(),
        lastFinishedAt: z.string().nullable(),
        lastStatus: z.enum(["running", "ok", "failed"]),
        lastDetail: z.string().nullable(),
        runs: z.number().int(),
        failures: z.number().int(),
      }),
    )
    .default([]),
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

/**
 * AI 用量摘要（管理員端）。
 *
 * 只有總數：不提供個別學習者的用量，令成本監控不會變成監視學生的工具。
 */
export const aiUsageSummarySchema = z.object({
  enabled: z.boolean(),
  windowMinutes: z.number().int(),
  /** 用量記錄保留期（天），超過的記錄會自動刪除 */
  retentionDays: z.number().int(),
  generations: z.object({ globalUsed: z.number().int(), globalLimit: z.number().int() }),
  gradings: z.object({ globalUsed: z.number().int(), globalLimit: z.number().int() }),
  totals: z.object({
    last24Hours: z.object({ generations: z.number().int(), gradings: z.number().int() }),
    last7Days: z.object({ generations: z.number().int(), gradings: z.number().int() }),
  }),
  storedRecords: z.number().int(),
  /** 保留期清理的實際執行情況（供管理員核對保留期是否真的在運作） */
  retention: z.object({
    days: z.number().int(),
    lastRunAt: z.string().nullable(),
    lastStatus: z.enum(["running", "ok", "failed"]).nullable(),
    lastDetail: z.string().nullable(),
    runs: z.number().int(),
    failures: z.number().int(),
  }),
});
export type AiUsageSummary = z.infer<typeof aiUsageSummarySchema>;
