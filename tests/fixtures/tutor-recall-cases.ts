/**
 * 檢索召回回歸案例（Sprint 34）。
 *
 * ── 用途 ────────────────────────────────────────────────────────────
 * Sprint 33 的真實模型評估發現 4 條「教材明明有段落，回覆卻說找不到」的個案。
 * 這裡把該批個案、跨語言同義詞、事件別稱、相近課題干擾、以及「教材確實沒有」的
 * 反向對照固定成可重複執行的檢索契約，並據此計算召回指標（見
 * `tests/tutor-retrieval-recall.test.ts`）。
 *
 * ── 為甚麼要記錄「教材實際有幾段」──────────────────────────────────
 * 只看「是否 grounded」無法區分「召回成功」與「本來就沒有教材」。`materialHits`
 * 是 Sprint 34 用唯讀查詢量得的教材段落數（LIKE 比對原文），用作 False No-Material
 * Rate 的分母：只有 `materialHits > 0` 的題目才算「應該召回得到」。
 *
 * ── 安全 ────────────────────────────────────────────────────────────
 * 全部為合成學生問題；不含學生資料、教材全文或憑證。
 */
import type { TutorAnswerabilityState } from "@/server/services/tutor-answerability";

export interface TutorRecallCase {
  id: string;
  query: string;
  /** 來源：Sprint 33 live 個案／跨語言／別稱／干擾／反向對照 */
  group: "sprint33" | "cross-language" | "alias" | "interference" | "negative" | "different-wording";
  /** 教材原文出現次數（0 = 教材確實沒有；>0 = 應該召回得到） */
  materialHits: number;
  /** 期望推斷出的課題；`null` = 不應推斷（應為 C 或 D） */
  expectTopic: string | null;
  /** 期望可答性狀態 */
  expectState: TutorAnswerabilityState;
  /**
   * 字詞層是否應該召回得到（預設 true）。
   *
   * `false` = 教材有內容，但提問與教材用語沒有字面交集，需靠語意改寫
   * （`expandTutorQuery`，正式 route 才有）才召回。這類案例不計入字詞層
   * Recall@3，但會單獨列出，避免把「需要改寫」混算成「召回失敗」。
   */
  lexicalRecallExpected?: boolean;
  /** 為甚麼這條案例重要（會寫入報告） */
  note: string;
}

export const TUTOR_RECALL_CASES: readonly TutorRecallCase[] = [
  // ── Sprint 33 live evaluation 的四條個案 ─────────────────────────────
  {
    id: "recall-live-11",
    query: "什么是种族隔离？",
    group: "sprint33",
    materialHits: 9,
    expectTopic: "topic-11",
    expectState: "A-material-supported",
    note: "Sprint 33 回報「教材找不到」，實際有 9 段（概念未列入詞庫及分節關鍵詞）。",
  },
  {
    id: "recall-live-08",
    query:
      "Compare the causes of the American and French Revolutions, and evaluate which was more revolutionary.",
    group: "sprint33",
    materialHits: 59,
    expectTopic: "topic-5",
    expectState: "B-partial-material-support",
    note: "英文比較題：詞庫英文別名命中「法國大革命」，但課程推斷失敗（scope 為『高中』屬歧義範疇）。",
  },
  {
    id: "recall-live-03",
    query: "甘地提倡的不合作運動是甚麼？",
    group: "sprint33",
    materialHits: 0,
    expectTopic: null,
    expectState: "C-general-knowledge",
    note: "教材的「不合作」指已發展國家在環保協作上的不合作態度，與甘地無關——必須維持 C，不可召回錯誤段落。",
  },
  {
    id: "recall-live-12",
    query: "美國在1942年才正式參戰，對嗎？",
    group: "sprint33",
    materialHits: 106,
    expectTopic: null,
    expectState: "C-general-knowledge",
    lexicalRecallExpected: false,
    note: "教材有珍珠港及二戰時間線，但「正式參戰」與教材用語無字面交集；此題交由語意改寫（expandTutorQuery）處理，字詞層維持 C。",
  },

  // ── 跨語言同義詞 ────────────────────────────────────────────────────
  {
    id: "recall-en-apartheid",
    query: "What is apartheid?",
    group: "cross-language",
    materialHits: 9,
    expectTopic: "topic-11",
    expectState: "A-material-supported",
    note: "英文別名 apartheid 於 Sprint 34 加入詞庫。",
  },
  {
    id: "recall-en-meiji",
    query: "What was the Meiji Restoration?",
    group: "cross-language",
    materialHits: 15,
    expectTopic: "hs-topic-3",
    expectState: "A-material-supported",
    note: "英文別名 → 明治維新，需命中高中課題3。",
  },
  {
    id: "recall-en-opium",
    query: "What caused the Opium War?",
    group: "cross-language",
    materialHits: 53,
    expectTopic: "topic-6",
    expectState: "B-partial-material-support",
    note: "詞庫英文別名命中了鴉片戰爭；教材主要在課題6（殖民擴張）。問的是成因，片段只給背景，故為 B。",
  },
  {
    id: "recall-hans-apartheid",
    query: "南非的種族隔離政策是甚麼？",
    group: "cross-language",
    materialHits: 9,
    expectTopic: "topic-11",
    expectState: "A-material-supported",
    note: "簡體提問＋「種族隔離政策」：詞庫指定課題11（聯合國制裁南非白人政府）。",
  },

  // ── 歷史事件別稱 ────────────────────────────────────────────────────
  {
    id: "recall-alias-pearl-harbor",
    query: "珍珠港事件是甚麼？",
    group: "alias",
    materialHits: 7,
    expectTopic: "hs-topic-4",
    expectState: "B-partial-material-support",
    note: "分節關鍵詞把提問帶到課題7 但該課題無片段，Sprint 34 改以教材內文反推課題4。",
  },
  {
    id: "recall-alias-ww2",
    query: "第二次世界大戰的原因？",
    group: "alias",
    materialHits: 97,
    expectTopic: "topic-9",
    expectState: "A-material-supported",
    note: "課程慣用寫法直接命中。",
  },
  {
    id: "recall-alias-231",
    query: "請引用《凡爾賽條約》第 231 條的原文。",
    group: "alias",
    materialHits: 53,
    expectTopic: "hs-topic-4",
    expectState: "B-partial-material-support",
    note: "教材有條約但沒有第 231 條原文；C3 的「不可虛構」由提示詞約束，檢索仍應找到條約段落（uncoveredTerms 會列出「原文」等缺口）。",
  },

  // ── 相近課題干擾 ────────────────────────────────────────────────────
  {
    id: "recall-interference-cold-war",
    query: "冷戰期間嘅足球比賽有咩政治意義？",
    group: "interference",
    materialHits: 291,
    expectTopic: "topic-10",
    expectState: "B-partial-material-support",
    note: "「足球」不在教材；課題必須落在冷戰（課題10），不可因體育詞而離題。",
  },
  {
    id: "recall-interference-france",
    query: "為什麼法國會介入美國獨立戰爭？",
    group: "interference",
    materialHits: 44,
    expectTopic: "topic-7",
    expectState: "B-partial-material-support",
    note: "「法國」在課題7 只有少數段落，不可因「法國大革命」屬課題5 而錯誤轉移。",
  },

  // ── 教材確實沒有（反向對照）────────────────────────────────────────
  {
    id: "recall-negative-rocket",
    query: "火箭推進器的燃燒溫度是多少？",
    group: "negative",
    materialHits: 0,
    expectTopic: null,
    expectState: "out-of-scope",
    note: "非歷史；不可因任何詞重疊而召回教材。",
  },
  {
    id: "recall-negative-cricket",
    query: "板球比賽的規則有幾條？",
    group: "negative",
    materialHits: 0,
    expectTopic: null,
    expectState: "out-of-scope",
    note: "非歷史（體育規則）。",
  },
  {
    id: "recall-negative-gandhi-quote",
    query: "甘地 1947 年說過哪一句關於非暴力的名言？",
    group: "negative",
    materialHits: 0,
    expectTopic: null,
    expectState: "C-general-knowledge",
    note: "教材沒有甘地內容，屬 C3（不可虛構引文）。",
  },

  // ── 教材有支持但用詞不同 ────────────────────────────────────────────
  {
    id: "recall-wording-meiji-charter",
    query: "日本明治時期如何處理舊有的武士特權？",
    group: "different-wording",
    materialHits: 15,
    expectTopic: "hs-topic-3",
    expectState: "B-partial-material-support",
    note: "提問用「武士特權」，教材用「廢藩置縣／四民平等」；Sprint 34 補上「明治時期」別名後才不再被判離題（修正前為 out-of-scope 假拒絕）。",
  },
  {
    id: "recall-wording-un-sanctions",
    query: "聯合國對南非白人政府做過甚麼？",
    group: "different-wording",
    materialHits: 9,
    expectTopic: "topic-11",
    expectState: "A-material-supported",
    note: "教材原文為「否決制裁南非白人政府的決議」，與提問用詞接近；三段落直接回答提問，故為 A。",
  },
];
