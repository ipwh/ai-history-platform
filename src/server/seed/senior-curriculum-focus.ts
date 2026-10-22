/**
 * 高中歷史科各課題的「學習重點（精簡摘要）」。
 *
 * 內容取自教育局《歷史科課程及評估指引（中四至中六）》第二章「課程架構」的
 * 學習要點及說明。學習重點只界定課程範圍及考核要求，**不是史實依據**；
 * 出題時史實一律以上載教材的段落為準（見 src/server/llm/prompt.ts）。
 */

export interface SeniorLearningStrand {
  title: string;
  points: string[];
  /** 課程對這一節的著重點（影響題目的提問層次） */
  emphasis: string;
}

export interface SeniorTopicLearningFocus {
  title: string;
  strands: SeniorLearningStrand[];
}

const SENIOR_TOPIC_LEARNING_FOCUS: Record<string, SeniorTopicLearningFocus> = {
  "hs-topic-1": {
    title: "課題1 香港的現代化與蛻變",
    strands: [
      {
        title: "1.1 政治及行政轉變",
        points: ["二十世紀初至 1997 年香港在政治及制度上的主要發展趨勢", "不同發展階段的特色"],
        emphasis: "指出政治發展的主要趨勢，並比較不同階段的發展及特色",
      },
      {
        title: "1.2 作為國際城市的發展",
        points: [
          "經濟發展、都市化與人口轉變",
          "中、外文化的共存與相互影響",
          "與內地的關係及在亞太地區擔當的角色",
        ],
        emphasis: "追溯及解釋香港作為國際城市的發展，並分析不同時期與內地及亞太地區的關係",
      },
    ],
  },
  "hs-topic-2": {
    title: "課題2 中國的現代化與蛻變",
    strands: [
      {
        title: "2.1 早期的現代化努力——改革與革命",
        points: ["清末新政", "辛亥革命", "五四運動", "南京政府的現代化努力", "共產主義革命與中華人民共和國的成立"],
        emphasis: "識別晚清政府及南京政府的主要改革，評價辛亥革命及五四運動對中國現代化的意義",
      },
      {
        title: "2.2 毛澤東時代及後毛澤東時代的社會主義現代化",
        points: [
          "政治體制的確立，以及新民主主義到社會主義的過渡",
          "毛澤東時代的現代化努力（五年計劃、大躍進及調整政策）",
          "文化大革命及其對中國現代化的影響",
          "1978 年以後的改革開放及「有中國特色的社會主義」",
        ],
        emphasis: "描述及評價主要現代化措施，並分析改革開放如何影響中國現代化及與其他亞洲國家的關係",
      },
    ],
  },
  "hs-topic-3": {
    title: "課題3 日本的現代化與蛻變（3.1 日本）",
    strands: [
      {
        title: "二十世紀初的現代化",
        points: ["二十世紀初政治、社會、經濟、文化的概況"],
        emphasis: "評估當時日本現代化的程度",
      },
      {
        title: "軍國主義的興起及影響",
        points: ["軍國主義興起的原因", "軍國主義的特色"],
        emphasis: "分析背景如何導致軍國主義興起，並評價其對日本及亞洲的影響",
      },
      {
        title: "二次大戰後的重建與增長",
        points: ["戰後經濟的恢復和增長", "政治及社會發展"],
        emphasis: "追溯及解釋戰後重建與增長的原因及影響",
      },
      {
        title: "與亞洲其他國家的關係",
        points: ["日本與其他亞洲國家在政治、經濟與文化關係方面的轉變與延續"],
        emphasis: "舉例說明關係的轉變與延續",
      },
    ],
  },
  "hs-topic-4": {
    title: "課題4 主要衝突與和平的訴求",
    strands: [
      {
        title: "4.1 1900 年至 1914 年的國際關係",
        points: ["二十世紀初歐洲主要強國的關係", "競爭與衝突的起因", "爭取和平的努力"],
        emphasis: "分析衝突起因，並描述早期爭取和平的努力及第一次世界大戰的爆發",
      },
      {
        title: "4.2 兩次世界大戰及有關和約的簽署",
        points: ["巴黎和會對國際秩序的影響", "兩次大戰間建立集體安全的嘗試", "第二次世界大戰後的安排及其影響"],
        emphasis: "說明兩次大戰的因果關係，並從政治、社會、經濟及文化角度評估其歷史意義",
      },
      {
        title: "4.3.1 超級大國的對抗與關係緩和",
        points: ["冷戰的成因、發展及特點", "美蘇關係的緩和", "蘇聯與華沙公約組織的瓦解"],
        emphasis: "指出冷戰特點，解釋緩和原因，並識別導致蘇聯與華約瓦解的事件因果關係",
      },
    ],
  },
  "hs-topic-5": {
    title: "課題5 協作與繁榮",
    strands: [
      {
        title: "5.1 經濟方面的國際協作",
        points: [
          "第二次世界大戰後歐洲的重建、經濟合作與統合",
          "美國和蘇聯在歐洲經濟重建及發展方面擔當的角色",
          "歐洲經濟統合的趨向及意義",
        ],
        emphasis: "分析美蘇決策背後的政治及經濟考慮，並評估經濟統合的意義",
      },
      {
        title: "5.2 社會及文化方面的國際協作",
        points: ["人口與資源", "環境保育", "醫學及科技"],
        emphasis: "舉例說明國際協作的成就與局限，並了解各議題背後的不同意見及利益衝突",
      },
    ],
  },
};

/** 產生單一高中課題的「學習重點」文字；沒有對應課題時回傳空字串 */
export function seniorLearningFocusText(topicId: string): string {
  const focus = SENIOR_TOPIC_LEARNING_FOCUS[topicId];
  if (!focus) return "";
  const strands = focus.strands
    .map(
      (strand) =>
        `- ${strand.title}：${strand.points.join("；")}。課程著重：${strand.emphasis}。`,
    )
    .join("\n");
  return `${focus.title}的學習重點：\n${strands}`;
}

/**
 * 高中課程的學習目標摘要（《歷史科課程及評估指引（中四至中六）》1.4 及 1.5）。
 * 供高中出題提示詞使用，避免把初中程度的「辨認字詞」當作高中要求。
 */
export function seniorLearningGoalsText(): string {
  return [
    "知識：了解二十世紀本地、國家、亞洲及世界主要事件的相互關係，以及塑造今日世界的主要歷史發展及趨勢；掌握因果關係、演變與延續、異同比較等歷史概念。",
    "技能：分辨事實與見解，辨識偏頗觀點；比較和詮釋歷史資料，根據顯證提出合理結論；選取、組織及運用史料，提出合乎邏輯及前後一致的論點。",
    "價值觀：以公正持平、設身處地的態度審視過去與當代事件，尊重不同民族的經驗與信念，並具備全球視野及公民責任意識。",
  ].join("\n");
}

export function seniorTopicFocusIds(): string[] {
  return Object.keys(SENIOR_TOPIC_LEARNING_FOCUS);
}
