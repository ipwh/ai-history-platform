/**
 * 選項表面線索的**合成**測試樣本（Sprint 23）。
 *
 * 全部內容由本 Sprint 自行撰寫，使用「甲城／乙城」這類沒有歷史指涉的佔位符，
 * 刻意不含任何真實史事、教材原文或版權內容。用途只有一個：驗證
 * `src/server/quality/option-quality.ts` 的判定與長度度量，不能當作題庫品質的證據。
 *
 * 為甚麼要固定樣本：Sprint 22 的生產快照統計（2,235 題）只說明現象，不會隨程式碼
 * 變化而更新；回歸測試需要一個**不變的基準**，才能在規則被改動時立即發現
 * （例如把門檻放寬到令所有題目都通過）。
 */
export type OptionBiasOrigin = "material-ai" | "school-paper" | "demo" | "material-mock";

export interface OptionBiasSample {
  id: string;
  origin: OptionBiasOrigin;
  /** 這條樣本刻意模擬的表面線索 */
  note: string;
  question: string;
  options: string[];
  correctAnswer: string;
  /** 期望偵測到的問題代碼（空陣列＝期望不發出警告） */
  expectedCodes: string[];
  /**
   * `tuning`：在設計門檻時看過的樣本（不可用來宣稱效果）
   * `evaluation`：只在回歸測試中量度，門檻定案後才首次計算
   * 兩者必須分開報告，避免「用同一批樣本調參又當作驗證」。
   */
  split?: "tuning" | "evaluation";
}

const LONG_STATEMENT =
  "這是一段刻意寫得較長的說明文字，用來模擬 AI 生成題目中過度詳細的正確選項";

export const OPTION_BIAS_SAMPLES: readonly OptionBiasSample[] = [
  {
    id: "sample-ai-long-correct",
    origin: "material-ai",
    note: "正確選項是長說明句，其餘全部是短標籤（Sprint 22 最常見的形態）",
    question: "（合成樣本）下列哪一項最能說明這個情況？",
    options: [LONG_STATEMENT, "甲城", "乙城", "丙城"],
    correctAnswer: LONG_STATEMENT,
    expectedCodes: ["option-length-asymmetry", "option-form-mismatch"],
    split: "tuning",
  },
  {
    id: "sample-ai-long-correct-2",
    origin: "material-ai",
    note: "同類形態，正確選項在第三個位置",
    question: "（合成樣本２）下列哪一項最能說明這個情況？",
    options: ["乙城", "丙城", LONG_STATEMENT, "丁城"],
    correctAnswer: LONG_STATEMENT,
    expectedCodes: ["option-length-asymmetry", "option-form-mismatch"],
    split: "tuning",
  },
  {
    id: "sample-ai-length-only",
    origin: "material-ai",
    note: "四個選項都是說明句，但正確選項明顯較長（只有長度不對稱）",
    question: "（合成樣本３）下列哪一項是這個情況的說明？",
    options: [LONG_STATEMENT, "這是較短的說明句。", "這也是較短的說明句。", "這同樣是較短的說明句。"],
    correctAnswer: LONG_STATEMENT,
    expectedCodes: ["option-length-asymmetry"],
  },
  {
    id: "sample-ai-absolutist",
    origin: "material-ai",
    note: "干擾項大量使用絕對化用語，正確答案沒有",
    question: "（合成樣本４）下列哪一項符合實際情況？",
    options: ["一定如此", "必然如此", "所有情況皆如此", "視情況而定"],
    correctAnswer: "視情況而定",
    expectedCodes: ["option-absolutist-distractor"],
  },
  {
    id: "sample-ai-balanced",
    origin: "material-ai",
    note: "對稱的選項（不應發出警告）",
    question: "（合成樣本５）下列哪一項是甲城的別稱？",
    options: ["甲城", "乙城", "丙城", "丁城"],
    correctAnswer: "甲城",
    expectedCodes: [],
  },
  {
    id: "sample-ai-duplicate",
    origin: "material-ai",
    note: "正規化後重複的選項（只差句末標點）",
    question: "（合成樣本６）下列哪一項是甲城的別稱？",
    options: ["甲城", "甲城。", "乙城", "丙城"],
    correctAnswer: "乙城",
    expectedCodes: ["option-duplicate"],
  },
  {
    id: "sample-paper-balanced-1",
    origin: "school-paper",
    note: "學校試卷風格的平衡選項（Sprint 22：唯一最長僅 15.5%）",
    question: "（合成樣本７）下列哪一項是甲城的別稱？",
    options: ["甲城", "乙城", "丙城", "丁城"],
    correctAnswer: "乙城",
    expectedCodes: [],
  },
  {
    id: "sample-paper-balanced-2",
    origin: "school-paper",
    note: "學校試卷風格：選項長度相近的年份",
    question: "（合成樣本８）下列哪一年最早？",
    options: ["1901年", "1902年", "1903年", "1904年"],
    correctAnswer: "1901年",
    expectedCodes: [],
  },
  {
    id: "sample-paper-balanced-3",
    origin: "school-paper",
    note: "學校試卷風格：短句選項",
    question: "（合成樣本９）下列哪一項描述正確？",
    options: ["甲城位於北方。", "乙城位於南方。", "丙城位於東方。", "丁城位於西方。"],
    correctAnswer: "丙城位於東方。",
    expectedCodes: [],
  },
  {
    id: "sample-demo-balanced",
    origin: "demo",
    note: "示範題風格：短選項",
    question: "（合成樣本１０）下列哪一項是甲城的別稱？",
    options: ["甲城", "乙城", "丙城", "丁城"],
    correctAnswer: "丁城",
    expectedCodes: [],
  },
  {
    id: "sample-mock-balanced",
    origin: "material-mock",
    note: "本地示範生成風格：短選項",
    question: "（合成樣本１１）下列哪一項是甲城的別稱？",
    options: ["甲城", "乙城", "丙城", "丁城"],
    correctAnswer: "丙城",
    expectedCodes: [],
  },
];
