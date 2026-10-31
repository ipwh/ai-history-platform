export type TutorUtteranceCategory = "history" | "clarify" | "reject" | "homework";

export interface TutorColloquialUtterance {
  id: string;
  raw: string;
  category: TutorUtteranceCategory;
  notes?: string;
}

export const TUTOR_COLLOQUIAL_UTTERANCES: readonly TutorColloquialUtterance[] = [
  { id: "history-ww1-cause", raw: "點解一戰會爆", category: "history" },
  { id: "history-versailles-punishment", raw: "凡爾賽條約點罰德國㗎", category: "history" },
  { id: "history-hitler-rise", raw: "希特拉點樣上台", category: "history" },
  { id: "history-cold-war-after-ww2", raw: "冷戰係咪二戰之後先有", category: "history" },
  { id: "history-ww1-english", raw: "WW1 成因講吓", category: "history" },
  { id: "history-meiji-reform", raw: "明治維新改咗啲咩", category: "history" },
  { id: "history-hong-kong-occupation", raw: "香港喺唔喺二戰俾人佔", category: "history" },
  {
    id: "history-totalitarianism",
    raw: "極權主義同獨裁有咩分別啊",
    category: "history",
  },
  {
    id: "history-ww2-outbreak",
    raw: "二戰點解會爆出嚟",
    category: "history",
  },
  { id: "history-ww2-abbreviation", raw: "WW2 爆發前有咩背景", category: "history" },

  {
    id: "clarify-treaty",
    raw: "嗰個條約呢",
    category: "clarify",
    notes: "只提到條約，未指出哪一份條約或想了解的面向。",
  },
  {
    id: "clarify-afterwards",
    raw: "之後點",
    category: "clarify",
    notes: "沒有有效對話上文。",
  },
  { id: "clarify-1919", raw: "1919 年嗰陣", category: "clarify" },
  { id: "clarify-germany", raw: "個德國係咪好慘", category: "clarify" },
  { id: "clarify-reform", raw: "改革嗰堆", category: "clarify" },
  {
    id: "clarify-renaissance-artists",
    raw: "藝術嗰三個邊個最勁",
    category: "clarify",
    notes: "可能指文藝復興藝術三傑，不應直接假定。",
  },
  { id: "clarify-pronoun-followup", raw: "佢哋後來點", category: "clarify" },
  { id: "clarify-emperor", raw: "嗰個皇帝呢", category: "clarify" },

  { id: "reject-python", raw: "幫我寫 python", category: "reject" },
  { id: "reject-weather", raw: "今日天氣點", category: "reject" },
  { id: "reject-chat", raw: "陪我傾偈", category: "reject" },
  { id: "reject-math", raw: "數學方程式點解", category: "reject" },
  { id: "reject-code", raw: "幫我寫 JavaScript code", category: "reject" },

  {
    id: "homework-copy-list",
    raw: "凡爾賽條約內容列點俾我抄",
    category: "homework",
    notes: "仍是歷史問題，但回覆須引導思考而非提供可抄答案。",
  },
  {
    id: "homework-cold-war-long",
    raw: "試解釋冷戰起因，要長篇",
    category: "homework",
  },
  {
    id: "homework-treaty-scaffold",
    raw: "幫我整理南京條約，俾幾個提示我自己寫",
    category: "homework",
  },
];
