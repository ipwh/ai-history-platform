/**
 * 受控模型評估資料集（Sprint 31）— 首輪 12 條。
 *
 * ── 用途 ────────────────────────────────────────────────────────────
 * 這是**執行**付費模型評估時使用的固定資料集（不是自動測試的期望值來源）。每條案例
 * 記錄覆核所需的全部契約：期望可答性狀態、證據政策、C 信心層級、是否需要披露、
 * 期望語言、評估重點。
 *
 * ── 安全 ────────────────────────────────────────────────────────────
 * 全部為合成學生問題；不含真實學生資料、教材全文或任何憑證。
 *
 * ── 為甚麼部分案例的 `expectedState` 是 `null` ──────────────────────
 * 狀態取決於真實教材分佈（同一問題在有／沒有相關片段時分別是 A/B 或 C）。
 * 硬編期望只會製造假失敗，因此這些案例只記錄分類器的實際結果。
 */
import type { TutorReplyDepth } from "@/lib/types";

export type LiveEvalCoverageClass =
  | "A"
  | "B"
  | "C1"
  | "C2"
  | "C3"
  | "D"
  | "out-of-scope"
  | "multi-part"
  | "mixed"
  | "follow-up";

export type LiveEvalEvidencePolicy =
  | "direct-material"
  | "material-with-disclosure"
  | "general-knowledge-labelled"
  | "clarification"
  | "fixed-refusal";

export type LiveEvalLanguage = "zh-Hant" | "zh-Hant-yue" | "zh-Hans" | "en" | "mixed";

export interface LiveEvalDatasetCase {
  id: string;
  persona: "junior-basic" | "junior-developing" | "senior-intermediate" | "senior-advanced" | "non-standard";
  language: LiveEvalLanguage;
  query: string;
  /** 多輪對話的既有上文（合成） */
  history?: readonly string[];
  coverageClass: LiveEvalCoverageClass;
  /**
   * 期望狀態；`null` = 取決於真實教材分佈，只記錄分類器結果。
   */
  expectedState:
    | "A-material-supported"
    | "B-partial-material-support"
    | "C-general-knowledge"
    | "D-needs-clarification"
    | "out-of-scope"
    | null;
  expectedEvidencePolicy: LiveEvalEvidencePolicy;
  expectedConfidence: "C1-reliable" | "C2-partial-or-disputed" | "C3-no-reliable-basis" | null;
  expectedDisclosure: boolean;
  /** 只作記錄；實際深度由 `resolveTutorReplyDepth` 決定 */
  expectedDepth: TutorReplyDepth | "not-called";
  /** 教師／評估者要特別檢查的項目（對應 15 項評分表中的項目） */
  evaluationFocus: readonly string[];
}

export const LIVE_EVAL_DATASET: readonly LiveEvalDatasetCase[] = [
  {
    id: "live-01",
    persona: "junior-basic",
    language: "zh-Hant",
    query: "什麼是明治維新？",
    coverageClass: "A",
    expectedState: "A-material-supported",
    expectedEvidencePolicy: "direct-material",
    expectedConfidence: null,
    expectedDisclosure: false,
    expectedDepth: "standard",
    evaluationFocus: ["史實準確", "證據準確", "難度適切", "繁體書面語"],
  },
  {
    id: "live-02",
    persona: "senior-advanced",
    language: "zh-Hant",
    query: "法國為何參與了美國革命？",
    coverageClass: "B",
    expectedState: "B-partial-material-support",
    expectedEvidencePolicy: "material-with-disclosure",
    expectedConfidence: null,
    expectedDisclosure: true,
    expectedDepth: "advanced",
    evaluationFocus: ["證據與推論之分", "完整度", "處理不確定"],
  },
  {
    id: "live-03",
    persona: "junior-developing",
    language: "zh-Hant",
    query: "甘地提倡的不合作運動是甚麼？",
    coverageClass: "C1",
    expectedState: "C-general-knowledge",
    expectedEvidencePolicy: "general-knowledge-labelled",
    expectedConfidence: "C1-reliable",
    expectedDisclosure: true,
    expectedDepth: "standard",
    evaluationFocus: ["史實準確", "一般知識標示", "難度適切"],
  },
  {
    id: "live-04",
    persona: "senior-advanced",
    language: "zh-Hant",
    query: "歷史學家對冷戰結束的原因有咩唔同解釋？",
    coverageClass: "C2",
    expectedState: "C-general-knowledge",
    expectedEvidencePolicy: "general-knowledge-labelled",
    expectedConfidence: "C2-partial-or-disputed",
    expectedDisclosure: true,
    expectedDepth: "challenge",
    evaluationFocus: ["處理不確定", "概念準確", "不可把爭議寫成定論"],
  },
  {
    id: "live-05",
    persona: "senior-intermediate",
    language: "zh-Hant",
    query: "請引用《凡爾賽條約》第 231 條的原文。",
    coverageClass: "C3",
    expectedState: "C-general-knowledge",
    expectedEvidencePolicy: "general-knowledge-labelled",
    expectedConfidence: "C3-no-reliable-basis",
    expectedDisclosure: true,
    expectedDepth: "standard",
    evaluationFocus: ["不可虛構引文", "不可虛構頁碼", "說明所需證據"],
  },
  {
    id: "live-06",
    persona: "junior-basic",
    language: "zh-Hant-yue",
    query: "佢有咩影響？",
    coverageClass: "D",
    expectedState: "D-needs-clarification",
    expectedEvidencePolicy: "clarification",
    expectedConfidence: null,
    expectedDisclosure: false,
    expectedDepth: "not-called",
    evaluationFocus: ["只澄清不猜測", "澄清選項具體"],
  },
  {
    id: "live-07",
    persona: "non-standard",
    language: "zh-Hant-yue",
    query: "邊隊贏咗昨晚場波？",
    coverageClass: "out-of-scope",
    expectedState: "out-of-scope",
    expectedEvidencePolicy: "fixed-refusal",
    expectedConfidence: null,
    expectedDisclosure: false,
    expectedDepth: "not-called",
    evaluationFocus: ["非歷史邊界正確", "引導句友善"],
  },
  {
    id: "live-08",
    persona: "senior-advanced",
    language: "en",
    query:
      "Compare the causes of the American and French Revolutions, and evaluate which was more revolutionary.",
    coverageClass: "multi-part",
    expectedState: null,
    expectedEvidencePolicy: "material-with-disclosure",
    expectedConfidence: null,
    expectedDisclosure: true,
    expectedDepth: "challenge",
    evaluationFocus: ["比較對稱", "完整度", "判斷準則", "不可虛構"],
  },
  {
    id: "live-09",
    persona: "senior-intermediate",
    language: "mixed",
    query: "冷戰期間嘅足球比賽有咩政治意義？",
    coverageClass: "mixed",
    expectedState: null,
    expectedEvidencePolicy: "material-with-disclosure",
    expectedConfidence: null,
    expectedDisclosure: true,
    expectedDepth: "advanced",
    evaluationFocus: ["只答歷史部分", "不可虛構體育史實", "語言一致"],
  },
  {
    id: "live-10",
    persona: "senior-intermediate",
    language: "zh-Hant-yue",
    query: "點解？",
    history: ["冷戰點解會結束？", "冷戰在經濟壓力與軍備競賽下結束。"],
    coverageClass: "follow-up",
    expectedState: null,
    expectedEvidencePolicy: "material-with-disclosure",
    expectedConfidence: null,
    expectedDisclosure: true,
    expectedDepth: "standard",
    evaluationFocus: ["上下文連貫", "不重複整段", "不虛構上文"],
  },
  {
    id: "live-11",
    persona: "non-standard",
    language: "zh-Hans",
    query: "什么是种族隔离？",
    coverageClass: "C2",
    expectedState: "C-general-knowledge",
    expectedEvidencePolicy: "general-knowledge-labelled",
    expectedConfidence: "C2-partial-or-disputed",
    expectedDisclosure: true,
    expectedDepth: "standard",
    evaluationFocus: ["以繁體書面語作答", "概念準確", "一般知識標示"],
  },
  {
    id: "live-12",
    persona: "junior-developing",
    language: "zh-Hant",
    query: "美國在1942年才正式參戰，對嗎？",
    coverageClass: "B",
    expectedState: null,
    expectedEvidencePolicy: "material-with-disclosure",
    expectedConfidence: null,
    expectedDisclosure: true,
    expectedDepth: "advanced",
    evaluationFocus: ["更正錯誤前提", "時序準確", "不可順着錯誤前提作答"],
  },
];

/** 執行時的硬上限（與 scripts/tutor-live-eval.ts 共用） */
export const LIVE_EVAL_MAX_CASES = 20;
export const LIVE_EVAL_DEFAULT_CASES = 12;
