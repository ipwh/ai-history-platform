/**
 * 教育局高中歷史科課程（中四至中六）的課題結構。
 *
 * 課程組織（《歷史科課程及評估指引（中四至中六）》）：
 *   主題甲：二十世紀亞洲的現代化與蛻變
 *     課題1 香港的現代化與蛻變（1.1 政治及行政轉變、1.2 作為國際城市的發展）
 *     課題2 中國的現代化與蛻變（2.1 早期的現代化努力、2.2 毛澤東時代及後毛澤東時代）
 *     課題3 日本及東南亞的現代化與蛻變（3.1 日本）
 *   主題乙：二十世紀世界的衝突與合作
 *     課題4 主要衝突與和平的訴求（4.1、4.2、4.3.1）
 *     課題5 協作與繁榮（5.1 經濟協作、5.2 社會及文化協作）
 *
 * 校本範圍（2026-10-22 擁有者指示）：
 *   - 不設「0 引言 現代世界的孕育」。
 *   - 不設「3.2 東南亞的現代化與蛻變——從殖民到獨立國家」。
 *   - 不設「4.3.2 其他主要衝突及爭取和平的努力」。
 *
 * 高中課程橫跨三年，不以年級分組，因此 `topicNumber` 一律為 null（避免與初中
 * 課題編號衝突，令初中課題的學習重點被錯誤套用到高中題目）。分節按上載筆記的
 * 章節整理，`matchKeywords` 用於把教材段落自動對應到分節；已用 2026-10 上載的
 * 五份筆記實測，99.5% 段落能正確對應。
 */
import type { CurriculumTheme } from "../../lib/types";
import type { SectionSeed, TopicSeed } from "./curriculum";

interface SeniorTopicSeed extends TopicSeed {
  curriculumTheme: CurriculumTheme;
  materialFiles: string[];
  /** 每份教材檔案可對應的分節（見 TopicSeed.materialFileSections） */
  materialFileSections?: Record<string, string[]>;
}

const TOPIC_1_SECTIONS: SectionSeed[] = [
  {
    id: "hs-topic-1-pre-war",
    title: "戰前及日治時期的政治與行政（1843–1945）",
    summary:
      "二十世紀初香港政府的架構、《英皇制誥》與《皇室訓令》、行政主導與委任制度，以及日治時期的管治及其間接影響。",
    matchKeywords: [
      "二十世紀初香港政府的架構",
      "英皇制誥",
      "皇室訓令",
      "殖民地規例",
      "行政主導",
      "總督的主導地位",
      "委任制度",
      "日治時期",
      "軍政廳",
      "分區制度",
      "以華制華",
      "香港的政治及行政概況",
    ],
  },
  {
    id: "hs-topic-1-post-war",
    title: "戰後的政治及行政轉變（1946–1997）",
    summary:
      "非殖民地化背景下的楊慕琦計劃與葛量洪改革、地方行政與諮詢、代議政制的發展、公務員本地化及《基本法》。",
    matchKeywords: [
      "楊慕琦計劃",
      "葛量洪改革",
      "公務員本地化",
      "地方行政",
      "代議政制",
      "中文成為法定語文",
      "中英聯合聲明",
      "基本法",
      "戰後香港的政治及行政",
      "1946-1997",
    ],
  },
  {
    id: "hs-topic-1-economy",
    title: "經濟發展：由轉口港到國際金融中心",
    summary:
      "由漁村、轉口港到工業城市及國際金融中心的經濟轉型，以及推動轉型的條件與政府政策。",
    matchKeywords: [
      "轉口貿易",
      "工業化",
      "經濟多元化",
      "金融服務業",
      "國際金融中心",
      "自由港",
      "蘇彝士運河",
      "經濟發展：由農村漁港發展為國際大都會",
    ],
  },
  {
    id: "hs-topic-1-urban",
    title: "都市化與人口轉變",
    summary:
      "都市化的涵義與階段、填海工程、新市鎮、市區重建，以及人口數目、結構及分佈的轉變。",
    matchKeywords: [
      "都市化的涵義",
      "都市化的發展",
      "填海工程",
      "新市鎮",
      "市區重建",
      "人口數目",
      "人口結構",
      "人口分佈",
      "香港的人口",
    ],
  },
  {
    id: "hs-topic-1-culture",
    title: "中外文化共存及與內地／亞太的關係",
    summary:
      "中、外文化共存的特質、原因及例子，以及香港與內地的關係和在亞太地區擔當的角色。",
    matchKeywords: [
      "中、外文化",
      "文化的共存",
      "文化共存",
      "與內地的關係",
      "亞太地區",
      "國際城市",
    ],
  },
];

const TOPIC_2_SECTIONS: SectionSeed[] = [
  {
    id: "hs-topic-2-late-qing",
    title: "清末新政與辛亥革命",
    summary: "清末新政的背景、內容、成效與局限，以及辛亥革命對中國現代化的意義與局限。",
    matchKeywords: ["清末新政", "辛亥革命", "臨時約法", "革命運動"],
  },
  {
    id: "hs-topic-2-may-fourth",
    title: "五四運動與南京政府的現代化努力",
    summary:
      "五四運動對中國現代化的意義與局限，以及南京政府在政治、經濟、軍事、教育及社會方面的現代化努力。",
    matchKeywords: ["五四運動", "新文化運動", "南京政府", "國民政府"],
  },
  {
    id: "hs-topic-2-ccp",
    title: "共產主義革命與中華人民共和國成立",
    summary: "共產主義在中國的傳入與興起、國共合作與分裂，以及中華人民共和國成立的經過。",
    matchKeywords: [
      "共產主義革命",
      "共產主義的傳入",
      "中國共產黨成立",
      "國共合作",
      "中華人民共和國成立",
    ],
  },
  {
    id: "hs-topic-2-state",
    title: "國家政治體制與社會主義過渡",
    summary:
      "國家政治體制的確立、黨政軍關係、憲法的制定與修訂，以及新民主主義到社會主義的過渡。",
    matchKeywords: [
      "國家政治體制的確立",
      "政治架構的建立",
      "黨、政、軍",
      "憲法的制定",
      "新民主主義",
      "社會主義階段的過渡",
    ],
  },
  {
    id: "hs-topic-2-mao",
    title: "毛澤東時代的現代化努力與文化大革命",
    summary: "第一個五年計劃、大躍進、調整時期，以及文化大革命對中國現代化的影響。",
    matchKeywords: [
      "第一個五年計劃",
      "一五計劃",
      "大躍進",
      "三面紅旗",
      "調整時期",
      "文化大革命",
      "紅衛兵",
      "四人幫",
    ],
  },
  {
    id: "hs-topic-2-reform",
    title: "1978 年以後的改革開放",
    summary:
      "治國方針的轉變、改革開放的對內對外措施、地區經濟的發展，以及對中國現代化及與亞洲國家關係的影響。",
    matchKeywords: [
      "1978年以後的改革開放",
      "改革開放",
      "有中國特色的社會主義",
      "十一屆三中全會",
      "承包制",
      "市場經濟",
      "鄉鎮企業",
      "地區經濟",
    ],
  },
];

const TOPIC_3_SECTIONS: SectionSeed[] = [
  {
    id: "hs-topic-3-early",
    title: "二十世紀初日本的現代化概況",
    summary: "二十世紀初日本政治、社會、經濟及文化的概況，並評估當時日本現代化的程度。",
    matchKeywords: ["二十世紀初", "明治維新", "政治、社會、經濟、文化", "現代化的程度"],
  },
  {
    id: "hs-topic-3-militarism",
    title: "軍國主義的興起及影響",
    summary: "日本軍國主義興起的原因、特色，以及對日本及亞洲的影響。",
    matchKeywords: [
      "軍國主義",
      "尚武傳統",
      "立憲政體",
      "政黨政治",
      "極端民族主義",
      "泛亞洲主義",
      "軍事擴張",
    ],
  },
  {
    id: "hs-topic-3-recovery",
    title: "二次大戰後的重建與經濟增長",
    summary:
      "1945 至 1952 年的經濟重建與復甦、戰後經濟恢復與高速增長，以及 1990 年代的發展。",
    matchKeywords: [
      "戰後日本的經濟恢復與增長",
      "1945-1952年間的發展",
      "經濟重建",
      "經濟復甦",
      "1990年代的發展",
      "泡沫",
    ],
  },
  {
    id: "hs-topic-3-society",
    title: "戰後的社會與文化發展",
    summary:
      "中產型社會的出現、人口變化、都市化、教育民主化、女性地位、西方流行文化與傳統價值的傳承。",
    matchKeywords: [
      "戰後日本的社會發展",
      "中產型社會",
      "人口狀況",
      "都市化",
      "教育民主化",
      "女性地位",
      "流行文化",
      "傳統價值",
    ],
  },
  {
    id: "hs-topic-3-asia",
    title: "日本與亞洲其他國家的關係",
    summary: "日本與亞洲其他國家在政治、經濟與文化關係方面的轉變與延續。",
    matchKeywords: [
      "與亞洲其他國家的關係",
      "亞洲其他國家",
      "外交關係",
      "經濟關係",
      "文化交流",
    ],
  },
];

const TOPIC_4_SECTIONS: SectionSeed[] = [
  {
    id: "hs-topic-4-international-relations",
    title: "1900 年至 1914 年的國際關係",
    summary:
      "二十世紀初歐洲列強的關係、競爭與衝突的起因（同盟制度、極端民族主義、經濟競爭與殖民地爭奪、軍備競賽）、早期爭取和平的努力、戰前危機及第一次世界大戰的爆發。",
    matchKeywords: [
      "至1914年的國際關係焦點",
      "競爭與衝突的起因",
      "早期爭取和平的努力",
      "戰前危機",
      "海牙會議",
      "同盟制度",
      "極端民族主義",
      "經濟競爭與殖民地爭奪",
      "軍備競賽",
      "塞拉耶佛事件",
    ],
  },
  {
    id: "hs-topic-4-paris",
    title: "巴黎和會與集體安全（1919–1939）",
    summary:
      "巴黎和會的目標與決議、《凡爾賽條約》及其他和約對國際秩序的影響、國際聯盟與裁軍嘗試、1930 年代集體安全的失敗（經濟大衰退、極權國家侵略、綏靖與孤立政策）。",
    matchKeywords: [
      "巴黎和會",
      "威爾遜",
      "克里孟梭",
      "勞萊喬治",
      "凡爾賽條約",
      "國際聯盟",
      "集體安全",
      "羅加諾公約",
      "凱格－白理安公約",
      "裁軍會議",
      "華盛頓會議",
      "倫敦海軍會議",
      "經濟大衰退",
      "極權國家",
      "綏靖政策",
      "孤立政策",
    ],
  },
  {
    id: "hs-topic-4-world-war-two",
    title: "第二次世界大戰及戰後安排",
    summary:
      "第二次世界大戰的爆發及經過、戰後的安排（對德國、奧地利及日本的和約）、戰後新國際秩序的形成，以及兩次大戰在政治、社會、經濟及文化方面的意義。",
    matchKeywords: [
      "第二次世界大戰的爆發",
      "盟國",
      "軸心國",
      "戰後的安排",
      "戰後的新國際秩序",
      "對日本的和約",
      "對和平的訴求",
      "維持和平組職",
    ],
  },
  {
    id: "hs-topic-4-cold-war",
    title: "冷戰：超級大國的對抗與緩和",
    summary:
      "冷戰的成因、發展及特點、美蘇關係的緩和與第二次冷戰，以及蘇聯與華沙公約組織的瓦解。",
    matchKeywords: [
      "冷戰",
      "鐵幕",
      "杜魯門主義",
      "馬歇爾計劃",
      "莫洛托夫計劃",
      "柏林封鎖",
      "北大西洋公約組織",
      "華沙公約組織",
      "韓戰",
      "古巴導彈危機",
      "緩和",
      "戈巴卓夫",
    ],
  },
];

const TOPIC_5_SECTIONS: SectionSeed[] = [
  {
    id: "hs-topic-5-economic",
    title: "經濟方面的國際協作",
    summary:
      "第二次世界大戰後歐洲的經濟問題與復興、美國與蘇聯在歐洲經濟重建中的角色，以及歐洲經濟統合的趨向、意義與困難。",
    matchKeywords: [
      "第二次世界大戰後歐洲的經濟問題",
      "歐洲經濟的重建",
      "美國與蘇聯在戰後歐洲經濟重建",
      "經濟互助委員會",
      "馬歇爾計劃",
      "歐洲經濟統合",
      "歐洲煤鋼共同體",
      "歐洲經濟共同體",
      "歐洲共同體",
      "歐洲聯盟",
      "經濟合作組織",
    ],
  },
  {
    id: "hs-topic-5-population",
    title: "人口與資源及環境保育的國際協作",
    summary:
      "人口增加與老化、財富與資源分佈不均、糧食與貧窮問題，以及環境保育（污染、全球暖化、廢物轉移、核能）方面國際協作的成就與局限。",
    matchKeywords: [
      "人口與資源方面的國際協作",
      "人口增加",
      "人口老化",
      "財富與資源",
      "糧食短缺",
      "貧窮",
      "環境保護方面的國際協作",
      "土地污染",
      "食水與海洋污染",
      "空氣污染",
      "全球暖化",
      "廢物轉移",
      "核能運用",
      "能源供應",
      "南極條約",
      "歐洲環境署",
    ],
  },
  {
    id: "hs-topic-5-health-tech",
    title: "醫學與科技方面的國際協作",
    summary:
      "新疾病與傳染病的威脅、世界衛生組織及其他國際組織的工作、醫學與科技協作的成就與局限，以及科技差距、基因工程與太空科技等議題。",
    matchKeywords: [
      "醫學與科技方面的國際協作",
      "醫學方面",
      "科技方面",
      "國際衛生局",
      "世界衛生組織",
      "聯合國愛滋病規劃署",
      "傳染病",
      "基因工程",
      "太空科技",
      "國際太空站",
      "國際原子能機構",
      "國際宇航聯合會",
      "科學交流",
    ],
  },
];

function seniorTopic(input: {
  id: string;
  title: string;
  description: string;
  order: number;
  curriculumTheme: CurriculumTheme;
  sections: SectionSeed[];
  materialFiles: string[];
  materialFileSections?: Record<string, string[]>;
}): SeniorTopicSeed {
  return {
    id: input.id,
    topicNumber: null,
    level: 4,
    curriculumTheme: input.curriculumTheme,
    title: input.title,
    description: input.description,
    order: input.order,
    // 匯入教材及生成題目後才發布，避免學生看到空課題。
    published: false,
    materialFile: input.materialFiles[0] ?? null,
    materialFiles: input.materialFiles,
    materialFileSections: input.materialFileSections,
    sections: input.sections,
  };
}

export const SENIOR_CURRICULUM_TOPICS: SeniorTopicSeed[] = [
  seniorTopic({
    id: "hs-topic-1",
    title: "課題1：香港的現代化與蛻變",
    description:
      "涵蓋 1.1 政治及行政轉變、1.2 作為國際城市的發展：由戰前管治、日治時期到戰後的政治及行政轉變，以及經濟、都市化、人口、文化與對外關係的發展。",
    order: 1,
    curriculumTheme: "A",
    sections: TOPIC_1_SECTIONS,
    materialFiles: [
      "1.1 香港的政治及行政轉變筆記答案.docx",
      "1.2 香港作為國際城市的發展筆記答案.docx",
    ],
  }),
  seniorTopic({
    id: "hs-topic-2",
    title: "課題2：中國的現代化與蛻變",
    description:
      "涵蓋 2.1 早期的現代化努力（清末新政、辛亥革命、五四運動、南京政府、共產主義革命）及 2.2 毛澤東時代與後毛澤東時代的社會主義現代化。",
    order: 2,
    curriculumTheme: "A",
    sections: TOPIC_2_SECTIONS,
    materialFiles: [
      "2.1 中國早期的現代化努力 — 改革與革命筆記答案.docx",
      "2.2 毛澤東時代的社會主義現代化筆記答案.docx",
    ],
  }),
  seniorTopic({
    id: "hs-topic-3",
    title: "課題3：日本的現代化與蛻變",
    description:
      "按校本課程只涵蓋 3.1 日本：二十世紀初的現代化、軍國主義的興起、戰後重建與經濟增長、社會文化發展及與亞洲其他國家的關係；不設 3.2 東南亞。",
    order: 3,
    curriculumTheme: "A",
    sections: TOPIC_3_SECTIONS,
    materialFiles: ["3.1 日本的現代化與蛻變筆記答案.docx"],
  }),
  seniorTopic({
    id: "hs-topic-4",
    title: "課題4：主要衝突與和平的訴求",
    description:
      "涵蓋 4.1 1900 年至 1914 年的國際關係、4.2 兩次世界大戰及和約的簽署，以及 4.3.1 超級大國的對抗與關係緩和；按校本課程不設 4.3.2 其他主要衝突及爭取和平的努力。",
    order: 4,
    curriculumTheme: "B",
    sections: TOPIC_4_SECTIONS,
    materialFiles: [
      "4.1 1900年至1914年的國際關係筆記答案.docx",
      "4.2 兩次世界大戰及有關和約的簽署筆記答案.docx",
      "4.3.1 超級大國的對抗與關係緩和筆記答案.docx",
    ],
    // 每份筆記只屬於指定的分節，避免「第二次世界大戰」「第一次世界大戰」等
    // 通用字眼令同一課題的另一份筆記的段落被錯誤歸入其他分節。
    materialFileSections: {
      "4.1 1900年至1914年的國際關係筆記答案.docx": ["hs-topic-4-international-relations"],
      "4.2 兩次世界大戰及有關和約的簽署筆記答案.docx": [
        "hs-topic-4-paris",
        "hs-topic-4-world-war-two",
      ],
      "4.3.1 超級大國的對抗與關係緩和筆記答案.docx": ["hs-topic-4-cold-war"],
    },
  }),
  seniorTopic({
    id: "hs-topic-5",
    title: "課題5：協作與繁榮",
    description: "涵蓋 5.1 經濟方面的國際協作及 5.2 社會及文化方面的國際協作。",
    order: 5,
    curriculumTheme: "B",
    sections: TOPIC_5_SECTIONS,
    materialFiles: [
      "5.1 經濟方面的國際協作筆記答案.docx",
      "5.2 社會及文化方面的國際協作筆記答案.docx",
    ],
    materialFileSections: {
      "5.1 經濟方面的國際協作筆記答案.docx": ["hs-topic-5-economic"],
      "5.2 社會及文化方面的國際協作筆記答案.docx": [
        "hs-topic-5-population",
        "hs-topic-5-health-tech",
      ],
    },
  }),
];
