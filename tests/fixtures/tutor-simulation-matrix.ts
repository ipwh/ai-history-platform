/**
 * 學生模擬矩陣（Sprint 29）。
 *
 * ── 用途 ────────────────────────────────────────────────────────────
 * 以**不同能力、語言及行為**的模擬學生，覆蓋 35 類提問（規格 §4）及 5 個人物設定
 * （§3），逐條記錄「預期可答性狀態」與「預期回覆深度」。這份矩陣是**測試資料**，
 * 不是 golden answer：
 *
 *   - `materialCoverage` 表示教材涵蓋程度（測試會據此提供對應的檢索結果）；
 *   - `historicalChecks` 只列出教師覆核時要核對的重點；
 *   - 所有案例的 `reviewStatus` 一律 `pending-human-review`：歷史正確性、教學質素及
 *     語言質素必須由歷史科教師逐條決定，自動測試不會代為核准。
 *
 * ── 為甚麼把「教材涵蓋」與「是否可答」分開記錄 ──────────────────────
 * 舊有的硬閘把兩者混在一起，令「教材沒有涵蓋」變成「拒絕回答」。矩陣明確分開：
 * coverage 為 `none` 的案例仍然屬於歷史提問，預期狀態是 C（以一般歷史知識作答並
 * 標明限制），不是離題，也不是澄清。
 */
import type { TutorReplyDepth } from "@/lib/types";

export type TutorSimulationPersonaId =
  | "junior-basic"
  | "junior-developing"
  | "senior-intermediate"
  | "senior-advanced"
  | "non-standard";

export interface TutorSimulationPersona {
  id: TutorSimulationPersonaId;
  label: string;
  level: "junior" | "senior" | "mixed";
  characteristics: string;
  expectedBehaviour: string;
}

export const TUTOR_SIMULATION_PERSONAS: readonly TutorSimulationPersona[] = [
  {
    id: "junior-basic",
    label: "中一至中二：基礎學習者",
    level: "junior",
    characteristics: "短問句、詞彙有限、句子不完整、以事實題為主、時序混淆。",
    expectedBehaviour: "解釋陌生用語、用淺白書面語、交代基本背景、避免過度學術用詞。",
  },
  {
    id: "junior-developing",
    label: "中三：發展中學習者",
    level: "junior",
    characteristics: "問因果及後果、做簡單比較、問重要性，偶然混淆相近概念。",
    expectedBehaviour: "交代因果關係、區分短期與長期成因、按時間整理事件、說明異同。",
  },
  {
    id: "senior-intermediate",
    label: "中四至中五：中階學習者",
    level: "senior",
    characteristics: "多因素提問、問歷史過程、要求結構化說明、連結多件事件。",
    expectedBehaviour: "有組織地解釋、區分背景／近因／後果、說明事件關係及因素相對重要性。",
  },
  {
    id: "senior-advanced",
    label: "中五至中六：高階學習者（HKDSE）",
    level: "senior",
    characteristics: "多大程度題、評價題、比較題、挑戰常見解釋、處理史學詮釋。",
    expectedBehaviour: "說明判斷準則、提出相關論證、交代證據與推理、承認限制及替代解釋。",
  },
  {
    id: "non-standard",
    label: "非標準提問行為",
    level: "mixed",
    characteristics: "粵語、簡體、英文、中英混寫、錯字、錯專名、縮寫、不完整句、代詞追問。",
    expectedBehaviour: "不因口語或不完整而誤判離題；能理解粵語但以繁體書面語作答。",
  },
];

export type TutorSimulationCategoryId =
  | "basic-facts"
  | "definitions"
  | "background"
  | "chronology"
  | "causes"
  | "immediate-causes"
  | "long-term-causes"
  | "multiple-causes"
  | "consequences"
  | "political-impact"
  | "economic-impact"
  | "social-impact"
  | "short-vs-long-term"
  | "significance"
  | "comparisons"
  | "similarities"
  | "differences"
  | "causality-between-events"
  | "evaluative"
  | "success-failure"
  | "relative-importance"
  | "to-what-extent"
  | "interpretations"
  | "false-premise"
  | "factual-verification"
  | "follow-up"
  | "clarification-request"
  | "multi-topic"
  | "unfamiliar-vocabulary"
  | "outside-materials"
  | "incomplete-context"
  | "deliberate-ambiguity"
  | "spelling-mistakes"
  | "english-terminology"
  | "mixed-languages";

/** 35 類提問，次序與規格 §4 一致（測試會核對數目及覆蓋） */
export const TUTOR_SIMULATION_CATEGORIES: readonly {
  id: TutorSimulationCategoryId;
  label: string;
}[] = [
  { id: "basic-facts", label: "基礎史實" },
  { id: "definitions", label: "歷史定義" },
  { id: "background", label: "歷史背景" },
  { id: "chronology", label: "時序" },
  { id: "causes", label: "成因" },
  { id: "immediate-causes", label: "近因／導火線" },
  { id: "long-term-causes", label: "長期成因" },
  { id: "multiple-causes", label: "多重成因" },
  { id: "consequences", label: "後果" },
  { id: "political-impact", label: "政治影響" },
  { id: "economic-impact", label: "經濟影響" },
  { id: "social-impact", label: "社會影響" },
  { id: "short-vs-long-term", label: "短期與長期影響" },
  { id: "significance", label: "歷史意義" },
  { id: "comparisons", label: "比較" },
  { id: "similarities", label: "相同之處" },
  { id: "differences", label: "相異之處" },
  { id: "causality-between-events", label: "兩件事件的因果關係" },
  { id: "evaluative", label: "評價題" },
  { id: "success-failure", label: "成功與失敗" },
  { id: "relative-importance", label: "重要性與相對重要性" },
  { id: "to-what-extent", label: "多大程度題" },
  { id: "interpretations", label: "史學詮釋" },
  { id: "false-premise", label: "更正錯誤前提" },
  { id: "factual-verification", label: "事實核對" },
  { id: "follow-up", label: "追問" },
  { id: "clarification-request", label: "要求澄清／簡化" },
  { id: "multi-topic", label: "涉及兩個或以上課題" },
  { id: "unfamiliar-vocabulary", label: "陌生歷史詞彙" },
  { id: "outside-materials", label: "教材以外" },
  { id: "incomplete-context", label: "上文不足" },
  { id: "deliberate-ambiguity", label: "刻意含糊" },
  { id: "spelling-mistakes", label: "錯字／錯專名" },
  { id: "english-terminology", label: "英文歷史術語" },
  { id: "mixed-languages", label: "中英混寫" },
];

export type TutorSimulationDifficulty = "recall" | "explain" | "analyse" | "evaluate";

/** 教材涵蓋程度（測試據此提供對應的檢索結果） */
export type TutorSimulationCoverage = "full" | "partial" | "none" | "not-history";

export type TutorSimulationExpectedState =
  | "A-material-supported"
  | "B-partial-material-support"
  | "C-general-knowledge"
  | "D-needs-clarification"
  | "out-of-scope";

export type TutorSimulationLanguage = "zh-Hant" | "zh-Hant-yue" | "zh-Hans" | "en" | "mixed";

export interface TutorSimulationCase {
  id: string;
  category: TutorSimulationCategoryId;
  persona: TutorSimulationPersonaId;
  difficulty: TutorSimulationDifficulty;
  language: TutorSimulationLanguage;
  query: string;
  materialCoverage: TutorSimulationCoverage;
  /** 是否有可用的對話上文（追問、代詞指涉、要求簡化） */
  hasHistoryContext: boolean;
  /** 容許的回覆深度；`evaluate` 一律要求挑戰深度 */
  allowedDepths: readonly TutorReplyDepth[];
  /** 預期可答性狀態（由教材涵蓋程度推導，個別含糊案例另行指定） */
  expectedState: TutorSimulationExpectedState;
  /** C 狀態的信心層級（Sprint 30）；非 C 狀態或未指定時為 `null` */
  expectedConfidence: "C1-reliable" | "C2-partial-or-disputed" | "C3-no-reliable-basis" | null;
  historicalChecks: string;
  reviewStatus: "pending-human-review";
}

/** 難度 → 可接受深度（不把「越長越好」當成正確） */
export const TUTOR_ALLOWED_DEPTHS: Record<TutorSimulationDifficulty, readonly TutorReplyDepth[]> = {
  recall: ["standard"],
  explain: ["standard", "advanced"],
  analyse: ["advanced"],
  evaluate: ["challenge"],
};

interface CaseOptions {
  hasHistoryContext?: boolean;
  allowedDepths?: readonly TutorReplyDepth[];
  expectedState?: TutorSimulationExpectedState;
  expectedConfidence?: TutorSimulationCase["expectedConfidence"];
}

function defaultStateFor(coverage: TutorSimulationCoverage): TutorSimulationExpectedState {
  switch (coverage) {
    case "full":
      return "A-material-supported";
    case "partial":
      return "B-partial-material-support";
    case "none":
      return "C-general-knowledge";
    case "not-history":
      return "out-of-scope";
  }
}

function testCase(
  id: string,
  category: TutorSimulationCategoryId,
  persona: TutorSimulationPersonaId,
  difficulty: TutorSimulationDifficulty,
  language: TutorSimulationLanguage,
  materialCoverage: TutorSimulationCoverage,
  query: string,
  historicalChecks: string,
  options: CaseOptions = {},
): TutorSimulationCase {
  return {
    id,
    category,
    persona,
    difficulty,
    language,
    query,
    materialCoverage,
    hasHistoryContext: options.hasHistoryContext ?? false,
    allowedDepths: options.allowedDepths ?? TUTOR_ALLOWED_DEPTHS[difficulty],
    expectedState: options.expectedState ?? defaultStateFor(materialCoverage),
    expectedConfidence:
      options.expectedConfidence ??
      (materialCoverage === "none" && options.expectedState !== "D-needs-clarification"
        ? "C1-reliable"
        : null),
    historicalChecks,
    reviewStatus: "pending-human-review",
  };
}

export const TUTOR_SIMULATION_MATRIX: readonly TutorSimulationCase[] = [
  // 1. 基礎史實
  testCase("SIM-01", "basic-facts", "junior-basic", "recall", "zh-Hant", "full", "什麼是明治維新？", "維新時間、推動者及主要內容不可混淆。"),
  testCase("SIM-02", "basic-facts", "senior-intermediate", "explain", "zh-Hant", "full", "試述美國革命爆發的三個原因。", "三項原因須為教材說法，不可補入課外細節。"),

  // 2. 歷史定義
  testCase("SIM-03", "definitions", "junior-developing", "recall", "zh-Hant-yue", "full", "咩係帝國主義？", "定義須與殖民主義區分。"),
  testCase("SIM-04", "definitions", "senior-advanced", "explain", "en", "none", "What is fascism?", "不可把法西斯主義與共產主義混為一談；須標明非教材內容。"),

  // 3. 歷史背景
  testCase("SIM-05", "background", "junior-basic", "explain", "zh-Hant-yue", "full", "美國革命嘅背景係咩？", "背景與成因的界線須清楚。"),
  testCase("SIM-06", "background", "senior-intermediate", "analyse", "zh-Hant", "partial", "分析一戰前歐洲列強之間的張力。", "須說明教材片段缺少的部分。"),

  // 4. 時序
  testCase("SIM-07", "chronology", "junior-basic", "recall", "zh-Hant-yue", "full", "二戰幾時結束？", "1945 年；不可與 1918 混淆。"),
  testCase("SIM-08", "chronology", "junior-developing", "explain", "zh-Hant", "partial", "把文藝復興、宗教改革、美國革命按時序排列。", "三段時序及世紀須正確。"),

  // 5. 成因
  testCase("SIM-09", "causes", "junior-developing", "explain", "zh-Hant-yue", "full", "點解會有文藝復興？", "不可化約為單一原因。"),
  testCase("SIM-10", "causes", "senior-intermediate", "analyse", "zh-Hant", "full", "分析美國革命爆發的長期因素。", "分清長期背景與直接衝突。"),

  // 6. 近因
  testCase("SIM-11", "immediate-causes", "junior-developing", "explain", "zh-Hant-yue", "full", "一戰嘅直接導火線係咩？", "塞拉耶佛事件與更深的背景須分開。"),
  testCase("SIM-12", "immediate-causes", "senior-intermediate", "analyse", "en", "full", "What was the immediate cause of the First World War?", "近因不可寫成唯一原因。"),

  // 7. 長期成因
  testCase("SIM-13", "long-term-causes", "senior-intermediate", "explain", "zh-Hant", "full", "第一次世界大戰嘅深層原因是甚麼？", "同盟制度、民族主義、軍備競賽須準確。"),
  testCase("SIM-14", "long-term-causes", "senior-advanced", "analyse", "zh-Hant", "full", "冷戰的深層成因為何？", "意識形態、權力真空及安全困境須分清。"),

  // 8. 多重成因
  testCase("SIM-15", "multiple-causes", "senior-intermediate", "analyse", "zh-Hant-yue", "full", "導致冷戰爆發嘅因素有邊幾個？", "須列出多項並說明關係。"),
  testCase("SIM-16", "multiple-causes", "senior-advanced", "evaluate", "zh-Hant", "partial", "美國革命的多重成因中，哪一項最具決定性？", "須說明判斷準則；缺少的教材面向要披露。"),

  // 9. 後果
  testCase("SIM-17", "consequences", "junior-developing", "explain", "zh-Hant-yue", "full", "工業革命有咩後果？", "不可把同時發生的現象直接寫成因果。"),
  testCase("SIM-18", "consequences", "senior-intermediate", "analyse", "zh-Hant", "full", "第二次世界大戰對歐洲社會造成甚麼後果？", "短期與長期後果須分開。"),

  // 10. 政治影響
  testCase("SIM-19", "political-impact", "junior-developing", "explain", "zh-Hant", "full", "法國大革命對歐洲政治有咩影響？", "民族主義與保守主義反應須準確。"),
  testCase("SIM-20", "political-impact", "senior-intermediate", "analyse", "en", "partial", "How did the American Revolution affect colonial governance?", "不可用美國以外材料代替。"),

  // 11. 經濟影響
  testCase("SIM-21", "economic-impact", "junior-developing", "explain", "zh-Hant", "full", "工業革命對經濟有咩影響？", "生產模式、貿易及城市化關係須合理。"),
  testCase("SIM-22", "economic-impact", "senior-advanced", "analyse", "zh-Hant", "none", "軍備競賽如何影響蘇聯經濟？", "教材未涵蓋；須標明一般歷史知識。", { expectedConfidence: "C2-partial-or-disputed" }),

  // 12. 社會影響
  testCase("SIM-23", "social-impact", "junior-developing", "explain", "zh-Hant", "full", "工業革命對社會階級有咩影響？", "資產階級與工人階級的形成須準確。"),
  testCase("SIM-24", "social-impact", "junior-basic", "recall", "zh-Hant-yue", "full", "香港日佔時期維持了幾多年？", "三年零八個月；不可與戰後時期混淆。", { allowedDepths: ["standard", "advanced"] }),

  // 13. 短期與長期
  testCase("SIM-25", "short-vs-long-term", "senior-intermediate", "explain", "zh-Hant", "full", "二戰嘅短期同長期影響有咩分別？", "兩層時間尺度須分明。"),
  testCase("SIM-26", "short-vs-long-term", "senior-advanced", "analyse", "zh-Hant", "partial", "比較一戰的即時影響與長期後果。", "缺少的面向要說明。"),

  // 14. 歷史意義
  testCase("SIM-27", "significance", "junior-developing", "explain", "zh-Hant", "full", "明治維新對日本帶來了甚麼改變？", "改變的清單不可混入未發生的改革。"),
  testCase("SIM-28", "significance", "senior-advanced", "evaluate", "en", "partial", "Evaluate the historical significance of the Meiji Restoration.", "須說明判斷準則及限制。"),

  // 15. 比較
  testCase("SIM-29", "comparisons", "junior-developing", "explain", "zh-Hant", "full", "比較美國革命同法國大革命。", "比較準則須對稱。"),
  testCase("SIM-30", "comparisons", "senior-intermediate", "analyse", "en", "partial", "Compare the causes of the American and French Revolutions.", "兩方都要有材料；不足者須披露。"),

  // 16. 相同之處
  testCase("SIM-31", "similarities", "junior-developing", "explain", "zh-Hant", "full", "美國革命同法國大革命有咩相同之處？", "不可把相似寫成因果。"),
  testCase("SIM-32", "similarities", "senior-intermediate", "analyse", "zh-Hant", "full", "一戰與二戰在成因上有何相似？", "相似點須有史實支持。"),

  // 17. 相異之處
  testCase("SIM-33", "differences", "junior-developing", "explain", "zh-Hant-yue", "full", "美國革命同法國大革命有咩分別？", "不可只列一方特點。"),
  testCase("SIM-34", "differences", "senior-intermediate", "analyse", "en", "partial", "How did the two world wars differ in their consequences?", "缺少的比較面向要說明。"),

  // 18. 兩件事件的因果
  testCase("SIM-35", "causality-between-events", "senior-intermediate", "explain", "zh-Hant-yue", "full", "一戰同二戰有咩因果關係？", "不可把關聯寫成直接因果。"),
  testCase("SIM-36", "causality-between-events", "senior-advanced", "analyse", "en", "full", "Did the Treaty of Versailles cause the Second World War?", "須處理多因論及判斷準則。"),

  // 19. 評價
  testCase("SIM-37", "evaluative", "senior-advanced", "evaluate", "zh-Hant", "partial", "有人認為美國革命只是精英運動，你同意嗎？", "正反論證及準則須兼備。"),
  testCase("SIM-37B", "evaluative", "senior-intermediate", "analyse", "zh-Hant", "partial", "分析「美國革命只是精英運動」這個說法的理據。", "須同時列出支持與反對的證據。"),
  testCase("SIM-38", "evaluative", "senior-advanced", "evaluate", "en", "full", "To what extent was the Meiji Restoration a revolution from above?", "不可虛構史學派別或學者。"),

  // 20. 成功與失敗
  testCase("SIM-39", "success-failure", "senior-intermediate", "evaluate", "zh-Hant-yue", "full", "明治維新算唔算成功？", "成功標準須先說明。"),
  testCase("SIM-39B", "success-failure", "junior-developing", "analyse", "zh-Hant", "full", "分析明治維新在軍事與經濟上的成果。", "成果與代價不可混為一談。"),
  testCase("SIM-40", "success-failure", "senior-advanced", "evaluate", "en", "none", "Was the League of Nations a failure?", "教材未涵蓋；標明一般歷史知識並保留爭議。", { expectedConfidence: "C2-partial-or-disputed" }),

  // 21. 相對重要性
  testCase("SIM-41", "relative-importance", "senior-intermediate", "evaluate", "zh-Hant", "full", "在美國革命嘅成因中，邊個因素最重要？", "須比較因素而非只列舉。"),
  testCase("SIM-41B", "relative-importance", "senior-intermediate", "analyse", "zh-Hant", "full", "分析美國革命各項成因之間的關係。", "須說明因素之間的互動。"),
  testCase("SIM-42", "relative-importance", "senior-advanced", "evaluate", "en", "partial", "Which factor was most important in ending the Cold War?", "缺少的面向要披露，不可補造。"),

  // 22. 多大程度
  testCase("SIM-43", "to-what-extent", "senior-advanced", "evaluate", "en", "full", "To what extent did British colonial policies cause the American Revolution?", "須分層論證並下有理據的結論。"),
  testCase("SIM-43B", "to-what-extent", "senior-intermediate", "analyse", "zh-Hant", "full", "英國殖民政策如何影響美國革命的爆發？", "須區分政策內容與殖民地回應。"),
  testCase("SIM-44", "to-what-extent", "senior-advanced", "evaluate", "zh-Hant", "partial", "美國革命在多大程度上是一場社會革命？", "界定「社會革命」後才判斷。"),

  // 23. 史學詮釋
  testCase("SIM-45", "interpretations", "senior-advanced", "evaluate", "zh-Hant", "partial", "歷史學家對冷戰結束嘅解釋有咩唔同？", "不可虛構學者姓名或著作。"),
  testCase("SIM-45B", "interpretations", "senior-intermediate", "analyse", "zh-Hant", "partial", "冷戰結束的解釋有甚麼主要分歧？", "須說明分歧來自史料或視角。"),
  testCase("SIM-46", "interpretations", "senior-advanced", "evaluate", "en", "full", "Why do historians disagree about the causes of the First World War?", "須說明史料、視角及價值判斷的差異。"),

  // 24. 錯誤前提
  testCase("SIM-47", "false-premise", "junior-developing", "explain", "zh-Hant", "full", "美國在1942年才正式參戰，對嗎？", "須更正珍珠港事件（1941）並說明差異。"),
  testCase("SIM-48", "false-premise", "senior-intermediate", "analyse", "zh-Hant", "partial", "假設明治維新在1912年才開始，這會如何改變我們對日本現代化的理解？", "須指出明治維新始於 1868 年，並說明錯誤年份的影響。"),

  // 25. 事實核對
  testCase("SIM-49", "factual-verification", "junior-developing", "explain", "zh-Hant", "full", "茶稅是否導致美國革命？", "因果不可化約為單一稅項。"),
  testCase("SIM-50", "factual-verification", "senior-intermediate", "evaluate", "zh-Hant", "none", "七七事變係二戰嘅開端，這個說法有甚麼爭議？", "教材未涵蓋；須說明時間界線的爭議。", { expectedConfidence: "C2-partial-or-disputed" }),

  // 26. 追問
  testCase("SIM-51", "follow-up", "junior-basic", "explain", "zh-Hant-yue", "full", "點解？", "須承接上一輪課題，不可另開新題。", { hasHistoryContext: true, allowedDepths: ["standard", "advanced"] }),
  testCase("SIM-52", "follow-up", "junior-developing", "recall", "zh-Hant-yue", "partial", "咁之後呢？", "須承接上文並交代教材缺口。", { hasHistoryContext: true, allowedDepths: ["standard", "advanced"] }),

  // 27. 要求澄清／簡化
  testCase("SIM-53", "clarification-request", "junior-basic", "recall", "zh-Hant-yue", "none", "第二點可以講簡單啲嗎？", "須按上文第二點簡化，不可重述全段。", { hasHistoryContext: true, allowedDepths: ["standard", "advanced"], expectedConfidence: "C2-partial-or-disputed" }),
  testCase("SIM-54", "clarification-request", "junior-basic", "explain", "zh-Hant-yue", "full", "即係點解？", "須按上文作答並說明回應的是哪一點。", { hasHistoryContext: true, allowedDepths: ["standard", "advanced"] }),

  // 28. 兩個課題
  testCase("SIM-55", "multi-topic", "senior-intermediate", "analyse", "zh-Hant", "partial", "美國革命同法國大革命有咩關係？", "兩方材料不可互相代替。"),
  testCase("SIM-56", "multi-topic", "senior-intermediate", "evaluate", "zh-Hant", "full", "冷戰同後冷戰時期嘅國際局勢有咩關聯？試評價兩者的延續與斷裂。", "須說明延續與轉變，並下判斷。"),

  // 29. 陌生詞彙
  testCase("SIM-57", "unfamiliar-vocabulary", "junior-developing", "recall", "zh-Hant-yue", "full", "咩係殖民主義？", "定義須與帝國主義區分。"),
  testCase("SIM-58", "unfamiliar-vocabulary", "senior-intermediate", "explain", "zh-Hans", "none", "什么是种族隔离？", "教材未涵蓋（模擬情境）；須以繁體書面語作答並標明。Sprint 34：詞庫已收錄「種族隔離／apartheid」（教材課題11、課題7 共 9 段），因此信心層級由 C2 升為 C1——它是課程內概念，不再是「陌生詞彙」；真實檢索結果見 tests/tutor-retrieval-recall.test.ts。", { expectedConfidence: "C1-reliable" }),

  // 30. 教材以外
  testCase("SIM-59", "outside-materials", "senior-intermediate", "explain", "zh-Hant-yue", "none", "蒙古帝國點解會分裂？", "不可假稱課本內容；一般知識要標明。", { expectedConfidence: "C2-partial-or-disputed" }),
  testCase("SIM-60", "outside-materials", "senior-advanced", "analyse", "zh-Hant", "none", "羅馬帝國為何滅亡？", "多因論；不可虛構出處。"),

  // 31. 上文不足
  testCase("SIM-61", "incomplete-context", "junior-basic", "explain", "zh-Hant-yue", "none", "佢有咩影響？", "沒有上文時只可澄清，不可猜測對象。", { expectedState: "D-needs-clarification", allowedDepths: ["standard", "advanced"] }),
  testCase("SIM-62", "incomplete-context", "junior-developing", "recall", "zh-Hant", "none", "呢個條約點解咁苛刻？", "須先問清楚是哪一條條約。", { expectedState: "D-needs-clarification", allowedDepths: ["standard", "advanced"] }),

  // 32. 刻意含糊
  testCase("SIM-63", "deliberate-ambiguity", "non-standard", "explain", "zh-Hant-yue", "none", "極權主義嗰啲嘢係點？", "須澄清具體面向，不可硬猜。", { expectedState: "D-needs-clarification" }),
  testCase("SIM-64", "deliberate-ambiguity", "non-standard", "recall", "zh-Hant-yue", "none", "個德國係咪好慘", "含糊評價；澄清後才作答。", { expectedState: "D-needs-clarification", allowedDepths: ["standard", "advanced"] }),

  // 33. 錯字／錯專名
  testCase("SIM-65", "spelling-mistakes", "non-standard", "analyse", "zh-Hant", "partial", "凡爾塞條約點解令德國不滿？", "須沿用教材寫法「凡爾賽條約」。"),
  testCase("SIM-66", "spelling-mistakes", "non-standard", "explain", "zh-Hant-yue", "full", "希特立點解會崛起？", "須更正為「希特拉」並作答。"),

  // 34. 英文術語
  testCase("SIM-67", "english-terminology", "senior-intermediate", "recall", "en", "full", "What was the Meiji Restoration?", "英文作答須與中文教材一致。"),
  testCase("SIM-68", "english-terminology", "senior-advanced", "analyse", "en", "full", "Why did the Cold War end?", "多因分析；不可虛構日期。"),

  // 35. 中英混寫
  testCase("SIM-69", "mixed-languages", "non-standard", "analyse", "mixed", "full", "Cold War 點解會結束？", "須以繁體書面語作答並保留英文術語。"),
  testCase("SIM-70", "mixed-languages", "non-standard", "evaluate", "mixed", "partial", "明治維新嘅 significance 係咩？", "須說明判斷準則並披露教材缺口。"),

  // 對照組：明確非歷史（不得因年份或英文疑問詞而誤放行）
  testCase("SIM-71", "basic-facts", "non-standard", "recall", "zh-Hant", "not-history", "幫我寫一首詩", "非歷史要求，沿用引導句。"),
  testCase("SIM-72", "basic-facts", "non-standard", "recall", "en", "not-history", "Who won the World Cup in 2022?", "只有近代年份不足以構成歷史提問。"),
  testCase("SIM-73", "basic-facts", "junior-basic", "recall", "zh-Hant-yue", "not-history", "今日天氣點？", "非歷史要求，沿用引導句。"),

  // ── Sprint 30：非歷史對照組（體育／娛樂／科學／數學／創作）────────────────
  testCase("SIM-74", "basic-facts", "non-standard", "recall", "zh-Hant-yue", "not-history", "邊隊贏咗昨晚場波？", "體育賽果；只有近代年份或隊名不足以構成歷史提問。"),
  testCase("SIM-75", "basic-facts", "non-standard", "recall", "zh-Hant", "not-history", "今日會唔會落雨？", "天氣；非歷史要求。"),
  testCase("SIM-76", "basic-facts", "non-standard", "recall", "zh-Hant", "not-history", "邊個歌手攞咗今年最受歡迎獎？", "娛樂新聞；非歷史要求。"),
  testCase("SIM-77", "basic-facts", "junior-developing", "recall", "zh-Hant", "not-history", "解釋光合作用的過程。", "科學概念；非歷史要求。"),
  testCase("SIM-78", "basic-facts", "junior-developing", "recall", "zh-Hant", "not-history", "3x + 5 = 20，x 等於幾多？", "數學計算；非歷史要求。"),
  testCase("SIM-79", "basic-facts", "non-standard", "recall", "zh-Hant", "not-history", "幫我寫一篇關於香港的散文。", "創作要求；非歷史提問。"),
  testCase("SIM-80", "basic-facts", "non-standard", "recall", "zh-Hant", "not-history", "2022年世界盃冠軍係邊隊？", "只有近代年份不足以構成歷史提問。"),

  // ── Sprint 30：混合歷史與非歷史（仍按歷史處理，不可整題拒絕）─────────────
  testCase("SIM-81", "multi-topic", "senior-intermediate", "analyse", "zh-Hant", "full", "冷戰期間嘅足球比賽有咩政治意義？", "混合題材：只答歷史部分，非歷史部分不作虛構。"),
  testCase("SIM-82", "multi-topic", "senior-advanced", "evaluate", "mixed", "partial", "比較冷戰同世界盃嘅重要性，邊樣對二十世紀影響更大？", "歷史部分必須作答；比較準則要說明。"),

  // ── Sprint 30：C 狀態信心層級（C1 可靠／C2 爭議／C3 無法核實）─────────────
  testCase("SIM-83", "definitions", "junior-basic", "recall", "zh-Hant", "none", "什麼是文藝復興？", "C1：可靠一般知識；須標明非教材內容。", { expectedConfidence: "C1-reliable" }),
  testCase("SIM-84", "outside-materials", "senior-advanced", "evaluate", "zh-Hant", "none", "歷史學家對冷戰結束有咩唔同解釋？", "C2：存在史學爭議；不可把爭議寫成定論。", { expectedConfidence: "C2-partial-or-disputed" }),
  testCase("SIM-85", "outside-materials", "senior-intermediate", "explain", "zh-Hant", "none", "請引用《凡爾賽條約》第 231 條的原文。", "C3：要求逐字引文；不可虛構，但不可拒絕。", { expectedConfidence: "C3-no-reliable-basis" }),
  testCase("SIM-86", "outside-materials", "senior-intermediate", "explain", "en", "none", "Quote the exact wording of the Treaty of Versailles.", "C3：英文要求引文；說明無法核實及所需證據。", { expectedConfidence: "C3-no-reliable-basis" }),
];

export function simulationCasesForCategory(
  category: TutorSimulationCategoryId,
): readonly TutorSimulationCase[] {
  return TUTOR_SIMULATION_MATRIX.filter((entry) => entry.category === category);
}
