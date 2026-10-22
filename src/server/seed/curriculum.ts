/**
 * 香港教育局歷史科課程（中一至中三）12 個課題的結構。
 *
 * 高中（中四至中六）的 5 個課題另見 senior-curriculum.ts；兩者由
 * ALL_CURRICULUM_TOPICS 合併，教材檔名搜尋及匯入都會使用合併清單。
 *
 * 課程組織（按教育局歷史科課程指引）：
 *   中一（level 1）古代世界（史前時期至 14 世紀）：區域文明的誕生與交流 → 課題 1-4
 *   中二（level 2）近代世界（15 至 19 世紀）：西力的形成與外延     → 課題 5-8
 *   中三（level 3）現代世界（20 世紀至今）：邁向多極與相互依存    → 課題 9-12
 *
 * 每個課題的分節按試點教材（《歷史旅程－新課題系列（第二版）》溫習筆記）
 * 的編排整理，matchKeywords 用於把教材段落自動對應到分節。
 */
import {
  curriculumThemeText,
  type CurriculumLevel,
  type CurriculumTheme,
} from "../../lib/types";
import { SENIOR_CURRICULUM_TOPICS } from "./senior-curriculum";

export interface SectionSeed {
  id: string;
  title: string;
  summary: string;
  /** 用於自動把教材段落對應到此分節的關鍵詞（越長越優先） */
  matchKeywords: string[];
  children?: SectionSeed[];
}

export interface TopicSeed {
  id: string;
  /** 教育局課題編號 */
  topicNumber: number | null;
  level: CurriculumLevel;
  title: string;
  description: string;
  order: number;
  published: boolean;
  /** 高中課程主題（A 主題甲／B 主題乙）；初中課題為 null */
  curriculumTheme?: CurriculumTheme | null;
  /** 對應的教材檔案名稱（用於自動匯入） */
  materialFile: string | null;
  /** 一個課題可有多份教材（例如高中課題1 由 1.1 及 1.2 兩份筆記組成） */
  materialFiles?: string[];
  /**
   * 教材檔案 → 只可用來對應的分節清單。
   *
   * 分節對應以標題／關鍵詞比對，但同一課題的多份筆記往往會提及相同的通用字眼
   * （例如「第二次世界大戰」、「冷戰」），令 A 筆記的段落被歸入 B 筆記的分節。
   * 在此聲明每份檔案所屬的分節後，匯入時只會在該範圍內比對；沒有聲明時行為不變。
   */
  materialFileSections?: Record<string, string[]>;
  sections: SectionSeed[];
}

/* ------------------------------------------------------------------ */
/* 中一：古代世界（史前時期至 14 世紀）：區域文明的誕生與交流          */
/* ------------------------------------------------------------------ */

const TOPIC_1: TopicSeed = {
  id: "topic-1",
  topicNumber: 1,
  level: 1,
  title: "課題1：人類的需要：古與今",
  description:
    "由人類起源、石器時代的演進，到古文明的誕生與尼羅河流域文明，探討人類自古至今基本需要的延續與轉變。",
  order: 1,
  published: true,
  materialFile: "課題1人類的需要 古與今/課題1人類的需要 古與今_課文.docx",
  // 2026-10-20 擁有者指示：原本 12 個分節（含子分節）對學生而言太瑣碎，整合為 4 個主題。
  // 各主題的 matchKeywords 取其原有分節及子分節的關鍵詞聯集，令教材段落仍能正確對應。
  sections: [
    {
      id: "topic-1-stone-age",
      title: "石器時代的演進",
      summary:
        "人類歷史的起源與古人類的演化、史前時期與信史時期的劃分，以及舊石器時代、新石器時代至石器時代終結的演進。",
      matchKeywords: [
        "石器時代的演進",
        "人類歷史的起源",
        "古人類",
        "南方古猿",
        "智人",
        "直立人",
        "能人",
        "歷史時期的劃分",
        "史前時期與信史時期",
        "計時紀年",
        "舊石器時代",
        "新石器時代",
        "新的生活模式",
        "石器時代的終結",
      ],
    },
    {
      id: "topic-1-civilisation-rise",
      title: "古文明的興起",
      summary:
        "文明的特徵、古文明誕生的背景，以及四大古代文明的發源地與共同條件。",
      matchKeywords: [
        "古文明的興起",
        "古文明的誕生",
        "文明的特徵",
        "城市生活的興起",
        "文字的發明",
        "古文明誕生的背景",
        "四大古代文明",
        "四大古代文明的簡介",
        "四大古代文明的特徵",
        "四大古代文明的發源地",
        "大河文明",
      ],
    },
    {
      id: "topic-1-nile-civilisation",
      title: "尼羅河流域文明",
      summary: "古埃及文明（尼羅河流域）的位置、民族、衰落及文明特徵。",
      matchKeywords: [
        "尼羅河流域文明",
        "尼羅河流域",
        "尼羅河",
        "古代埃及文明",
        "古埃及文明",
        "古埃及",
        "埃及",
      ],
    },
    {
      id: "topic-1-summary",
      title: "古與今：人類相同的基本需要",
      summary: "比較古今人類在飲食、記錄、管治及居住等基本需要上的延續與轉變。",
      matchKeywords: ["古與今", "人類相同的基本需要", "基本的生存需要", "總結"],
    },
  ],
};

const TOPIC_2: TopicSeed = {
  id: "topic-2",
  topicNumber: 2,
  level: 1,
  title: "課題2：歐洲文明的發展",
  description: "由古希臘、古羅馬的古典文明，到中古時代的基督宗教世界與封建社會，了解歐洲文明的發展脈絡。",
  order: 2,
  published: true,
  materialFile: "課題2 歐洲文明的發展.docx",
  sections: [
    {
      id: "topic-2-ancient-greece",
      title: "古希臘文明",
      summary:
        "古希臘的地理環境、城邦政治（雅典民主與斯巴達寡頭政治），以及希臘的文化成就與影響。",
      matchKeywords: ["古希臘文明", "古希臘的地理環境", "斯巴達", "雅典民主政治", "城邦"],
    },
    {
      id: "topic-2-ancient-rome",
      title: "古羅馬文明",
      summary:
        "古羅馬從共和到帝國的發展、政治制度與法律，以及羅馬帝國分裂與西羅馬帝國滅亡。",
      matchKeywords: [
        "古羅馬文明",
        "羅馬共和",
        "羅馬元首制",
        "羅馬帝國",
        "羅馬共和國的擴張",
      ],
    },
    {
      id: "topic-2-classical-intro",
      title: "古典文明的介紹（概論與綜合）",
      summary:
        "歐洲歷史時期的劃分、早期文明概況，以及同時涉及古希臘與古羅馬的題目（未能歸入單一主題者亦保留於此）。",
      matchKeywords: ["古典文明的介紹", "歐洲歷史時期的劃分", "歐洲的早期文明", "古典文明"],
    },
    {
      id: "topic-2-classical-legacy",
      title: "古典文明的遺產與意義",
      summary: "古典文明在政治制度、法律、建築、語言及思想上的貢獻。",
      matchKeywords: ["古典文明的遺產與意義", "歐洲古典文明的遺產與意義"],
    },
    {
      id: "topic-2-medieval-europe",
      title: "中古時代的歐洲與基督宗教世界的形成",
      summary:
        "西羅馬帝國滅亡後歐洲的轉變、基督宗教世界的形成、封建社會的特徵，以及中古時代的遺產與結束。",
      matchKeywords: [
        "中古時代的歐洲與基督宗教世界的形成",
        "歐洲踏入中古時代",
        "中古時代的歐洲",
        "基督宗教世界的形成",
        "基督宗教在歐洲的傳播",
        "封建社會的出現及其特徵",
        "歐洲封建社會",
        "歐洲中古文明的遺產與意義",
        "中古時代的結束",
        "1453年",
      ],
    },
  ],
};

const TOPIC_3: TopicSeed = {
  id: "topic-3",
  topicNumber: 3,
  level: 1,
  title: "課題3：伊斯蘭文明的興起與中古時代歐亞的文化交流",
  description: "伊斯蘭教的起源與發展、阿拉伯帝國的擴張，以及中古時代歐亞文化交流的成果與影響。",
  order: 3,
  published: true,
  materialFile: "課題3 伊斯蘭文明的興起.docx",
  sections: [
    {
      id: "topic-3-islam",
      title: "伊斯蘭教的起源、教義與發展",
      summary: "穆罕默德的創教、伊斯蘭教的主要教義，以及伊斯蘭教內部的發展與分歧。",
      matchKeywords: [
        "伊斯蘭教的起源、教義與發展",
        "認識伊斯蘭教",
        "穆罕默德",
        "古蘭經",
        "五功",
        "哈里發",
        "對伊瑪目（Imam）地位的不同看法",
        "622-661年間穆斯林的控制範圍",
        "610年的阿拉伯半島與鄰近帝國",
      ],
    },
    {
      id: "topic-3-contact",
      title: "中古時代歐亞的接觸及伊斯蘭教的傳播",
      summary:
        "阿拉伯帝國的擴張、十字軍東征等戰爭形式，以及陸上與海上絲綢之路、仲介貿易等商貿形式如何促成歐亞接觸及伊斯蘭教的傳播（包括中古時代以前的歐亞往來）。",
      matchKeywords: [
        "中古時代歐亞的接觸及伊斯蘭教的傳播",
        "歐亞接觸的形式",
        "阿拉伯帝國的擴張",
        "阿拉伯帝國逐漸形成",
        "十字軍東征",
        "戰爭對歐亞文化交流的影響",
        "陸上絲綢之路",
        "絲綢之路",
        "阿拉伯人的仲介貿易",
        "海上絲綢之路",
        "意大利城邦",
        "商貿對歐亞文化交流的影響",
        "中古時代歐亞的貿易路線",
      ],
    },
    {
      id: "topic-3-results",
      title: "歐亞文化交流的結果及影響",
      summary:
        "歐亞文化交流如何擴闊歐洲人的視野、促進歐洲文明在亞洲傳播，並促成伊斯蘭文明的興起及其成就。",
      matchKeywords: [
        "歐亞文化交流的結果及影響",
        "擴闊中古時代歐洲人的視野",
        "促進歐洲文明在亞洲傳播",
        "促成伊斯蘭文明的興起",
        "伊斯蘭文明的主要成就",
        "繪畫與建築",
        "總結：中古時代的歐亞文化交流",
        "回饋",
      ],
    },
  ],
};

const TOPIC_4: TopicSeed = {
  id: "topic-4",
  topicNumber: 4,
  level: 1,
  title: "課題4：早期香港地區的歷史、文化與傳承",
  description: "信史時期香港的發展、早期居民的民系與姓族生活，以及本地非物質文化遺產的承傳。",
  order: 4,
  published: true,
  materialFile: "課題4 早期香港地區的歷史.docx",
  sections: [
    {
      id: "topic-4-clans",
      title: "主要民系與姓族",
      summary: "信史時期香港的管轄、四大民系及新界本地人五大姓族的來源、路線及聚居地。",
      matchKeywords: [
        "主要民系與姓族",
        "主要的民系及姓族",
        "四大民系",
        "四大民系從內地來港",
        "來港的主要路線",
        "新界本地人五大姓族",
        "新界五大姓族的聚居地分布",
        "信史時期的香港",
        "早期香港的主要人口",
      ],
    },
    {
      id: "topic-4-heritage",
      title: "香港的非物質文化遺產",
      summary:
        "文化遺產與非物質文化遺產的分別、非物質文化遺產的五大類別，以及四項具代表性的香港非物質文化遺產。",
      matchKeywords: [
        "香港的非物質文化遺產",
        "文化遺產與非物質文化遺產",
        "非物質文化遺產",
        "非物質文化遺產的五大類別",
        "四項具代表性的香港非物質文化遺產",
        "戲棚內上演潮州神功戲",
        "由傳統習俗演變成競賽活動",
      ],
    },
    {
      id: "topic-4-heritage-life",
      title: "通過四項具代表性的香港非物質文化遺產認識本地居民的生活",
      summary:
        "以早期香港居民的生活（居所與建築、主要為生方法、傳統教育、信仰與習俗，例如大坑舞火龍）說明非物質文化遺產與本地生活的關係。",
      matchKeywords: [
        "通過四項具代表性的香港非物質文化遺產認識本地居民的生活",
        "早期香港居民的生活",
        "居所與建築",
        "主要為生方法",
        "傳統教育",
        "信仰與習俗",
        "大坑舞火龍",
      ],
    },
  ],
};

const TOPIC_5: TopicSeed = {
  id: "topic-5",
  topicNumber: 5,
  level: 2,
  title: "課題5：近代歐洲的興起",
  description:
    "由文藝復興與宗教改革、科學革命與啟蒙運動、工業革命，到法國大革命及拿破崙時代，了解近代歐洲如何在思想、宗教、科學、經濟及政治上逐步興起。",
  order: 5,
  published: true,
  materialFile: "課題5 近代歐洲的興起/課題5 近代歐洲的興起_筆記.docx",
  // 2026-10-20 擁有者指示：原本 18 個子分節對學生而言太瑣碎，整合為 4 個主題。
  // 各主題的 matchKeywords 取其原有分節及子分節的關鍵詞聯集，令教材段落仍能正確對應；
  // 純屬「特點」「出現原因」「起源」等過於空泛的詞已剔除，避免搶去其他主題的段落。
  sections: [
    {
      id: "topic-5-renaissance",
      title: "文藝復興（十四至十七世紀）",
      summary:
        "文藝復興的起源與發展、人文主義的主要特點、出現原因，以及對歐洲藝術、學術與歷史發展的影響。",
      matchKeywords: ["文藝復興", "人文主義", "起源與發展", "主要特點", "文藝復興的影響"],
    },
    {
      id: "topic-5-reformation",
      title: "宗教改革（十六至十七世紀）",
      summary:
        "宗教改革的背景與發展、馬丁路德及其他改革者、新教教派的形成，以及宗教改革對歐洲政治、社會與文化的影響。",
      matchKeywords: ["宗教改革", "新教", "馬丁路德", "反宗教改革"],
    },
    {
      id: "topic-5-renaissance-reformation",
      title: "文藝復興與宗教改革：綜合與比較",
      summary:
        "同時涉及文藝復興與宗教改革的題目，以及未能歸入單一主題、需教師覆核的題目（例如中古後期的背景）。",
      matchKeywords: ["文藝復興與宗教改革", "從神本走向人本"],
    },
    {
      id: "topic-5-science-enlightenment",
      title: "科學革命與啟蒙運動",
      summary:
        "十六至十八世紀歐洲在科學與思想上的一系列變革：科學革命的原因、發展及影響，以及啟蒙運動的背景、思想、傳播及影響。",
      matchKeywords: [
        "科學革命",
        "啟蒙運動",
        "理性時代",
        "科學革命（十七至十八世紀）",
        "科學革命的原因",
        "科學革命的主要發展",
        "科學革命出現原因",
        "啟蒙運動（十七至十八世紀）",
        "主要的啟蒙思想",
        "啟蒙思想的傳播",
        "啟蒙運動的影響",
      ],
    },
    {
      id: "topic-5-industrial",
      title: "工業革命",
      summary:
        "十八世紀中葉至十九世紀末歐美的重大技術變革：特點與出現原因、英國率先展開的原因、主要發展及影響。",
      matchKeywords: [
        "工業革命",
        "技術的革新",
        "工業革命的特點",
        "工業革命的出現原因",
        "工業革命出現的原因",
        "英國率先展開工業革命的原因",
        "英國率先",
        "工業革命的主要發展",
        "革命的起點",
        "新能源的應用",
        "工業革命的影響",
        "工業革命帶來的重要轉變",
      ],
    },
    {
      id: "topic-5-french-revolution",
      title: "法國大革命",
      summary:
        "十八世紀末法國的政治革命及隨後的拿破崙時代：背景與成因、革命經過、拿破崙的上台與帝國，以及對後世的影響。",
      matchKeywords: [
        "法國大革命",
        "拿破崙時代",
        "對自由和民主的追求",
        "革命的背景",
        "革命的成因",
        "革命的經過",
        "革命的爆發",
        "革命的導火線",
        "拿破崙的上台",
        "拿破崙的改革",
        "法國大革命及拿破崙時代的影響",
        "自由主義及民族主義",
      ],
    },
  ],
};

const TOPIC_6: TopicSeed = {
  id: "topic-6",
  topicNumber: 6,
  level: 2,
  title: "課題6：歐洲國家的殖民擴張",
  description: "歐洲國家由十六世紀至二十世紀初的殖民擴張：背景、原因、方式及對歐、美、亞、非的影響。",
  order: 6,
  published: true,
  materialFile: "課題6 歐洲國家的殖民擴張.docx",
  sections: [
    {
      id: "topic-6-early-expansion",
      title: "早期殖民擴張（十六至十八世紀）",
      summary:
        "十六世紀初至十八世紀末歐洲國家向海外擴張的背景及原因：新航路的開闢、商業與宗教因素，以及早期殖民帝國的建立。",
      matchKeywords: [
        "歐洲國家早期擴張（十六世紀初至十八世紀末）的背景及原因",
        "早期擴張",
        "新航路",
        "重商主義",
      ],
    },
    {
      id: "topic-6-late-expansion",
      title: "後期殖民擴張（十九至二十世紀）",
      summary:
        "十九世紀末至二十世紀初歐洲國家瓜分非洲及亞洲的背景及原因：工業革命、帝國主義、原料與市場的需要。",
      matchKeywords: [
        "歐洲國家後期擴張（十九世紀末至二十世紀初）的背景及原因",
        "後期擴張",
        "白人的負擔",
      ],
    },
    {
      id: "topic-6-causes",
      title: "歐洲殖民擴張的原因：綜合",
      summary:
        "同時涉及早期與後期擴張的題目，以及未能歸入單一時期、需教師覆核者。",
      matchKeywords: ["歐洲殖民擴張的原因", "歐洲國家擴張的原因"],
    },
    {
      id: "topic-6-methods-impact",
      title: "歐洲殖民擴張的方式及影響",
      summary:
        "歐洲殖民擴張的簡介、殖民政策的形成與演變、殖民擴張的方式（據點、殖民地、保護國、勢力範圍），以及對美、亞、非三洲與歐洲的影響。",
      matchKeywords: [
        "歐洲殖民擴張的簡介",
        "歐洲殖民擴張的方式及影響",
        "殖民政策的形成與演變",
        "殖民擴張的方式",
        "據點",
        "殖民地",
        "保護國",
        "勢力範圍",
        "對美、亞、非三洲的影響",
        "對歐洲的影響",
        "社會及文化方面",
      ],
    },
  ],
};

const TOPIC_7: TopicSeed = {
  id: "topic-7",
  topicNumber: 7,
  level: 2,
  title: "課題7：美國的成立及發展",
  description: "由美國革命、獨立與憲法，到十九世紀領土拓展、南北內戰及戰後崛起為世界大國。",
  order: 7,
  published: true,
  materialFile: "課題7 美國的成立及發展.docx",
  sections: [
    {
      id: "topic-7-revolution-early",
      title: "美國革命的背景與經過（1775–1783）",
      summary:
        "北美殖民地的背景、革命的內外成因與導火線、獨立戰爭的經過，以及革命的影響。",
      matchKeywords: [
        "美國革命的內外因素及影響",
        "美國革命的內外成因",
        "背景、成因與導火線",
        "美國革命（1775-1783年）",
        "美國革命的影響",
      ],
    },
    {
      id: "topic-7-constitution",
      title: "美國憲法與政治體制",
      summary: "1787年制憲、三權分立的聯邦制度、國會與總統的職權，以及《權利法案》。",
      matchKeywords: ["十八世紀末美國的政治體制與憲法", "行政機關", "憲法", "三權分立"],
    },
    {
      id: "topic-7-nineteenth-century",
      title: "十九世紀的美國：領土拓展與南北內戰",
      summary:
        "十九世紀美國向西拓展領土的過程、移民（包括華人）的經歷，以及南北內戰的爆發、影響與戰後發展。",
      matchKeywords: [
        "十九世紀的美國領土拓展",
        "十九世紀的領土拓展",
        "追尋美國夢的移民",
        "華人移居美國的原因",
        "早期華人勞工在美國的生活及經歷",
        "南北內戰前後的美國",
        "美國南北內戰（1861-1865年）",
        "美國南北內戰的影響",
        "美國南北內戰後的重要發展",
      ],
    },
    {
      id: "topic-7-revolution",
      title: "美國革命與建國：綜合與比較",
      summary:
        "同時涉及革命、憲法及十九世紀發展的題目，以及未能歸入單一主題、需教師覆核者。",
      matchKeywords: ["美國革命的內外因素及影響", "美國革命與建國"],
    },
  ],
};

const TOPIC_8: TopicSeed = {
  id: "topic-8",
  topicNumber: 8,
  level: 2,
  title: "課題8：香港直至19世紀末的成長與發展",
  description: "英國侵佔香港與殖民管治的建立，以及十九世紀香港的經濟、社會民生狀況與民間團體的貢獻。",
  order: 8,
  published: true,
  materialFile: "課題8 直至二十世紀初香港的成長與發展.docx",
  sections: [
    {
      id: "topic-8-colonial-rule",
      title: "英國殖民管治的建立",
      summary: "英國侵佔香港的過程（割讓香港島、租借新界）及殖民管治制度的建立。",
      matchKeywords: [
        "英國殖民管治的建立",
        "英國侵佔香港",
        "割讓香港島",
        "租借新界",
        "殖民管治",
      ],
    },
    {
      id: "topic-8-economy-society",
      title: "經濟與社會民生狀況",
      summary: "香港的經濟發展狀況，以及人口、居住、醫療、教育等社會民生狀況。",
      matchKeywords: ["經濟與社會民生狀況", "經濟發展狀況", "社會發展狀況", "經濟與社會發展"],
    },
    {
      id: "topic-8-organisations",
      title: "不同民間團體對香港的貢獻",
      summary: "東華三院、保良局等民間團體在醫療、教育及救濟方面的貢獻。",
      matchKeywords: ["不同民間團體對香港的貢獻", "民間團體", "東華三院", "保良局"],
    },
  ],
};

const TOPIC_9: TopicSeed = {
  id: "topic-9",
  topicNumber: 9,
  level: 3,
  title: "課題9：20世紀的國際紛爭及危機(I)–兩次世界大戰",
  description: "兩次世界大戰的背景、成因、導火線、經過及結果，以及兩次大戰期間的經濟問題。",
  order: 9,
  published: true,
  materialFile: "課題9 20 世紀的國際紛爭及危機 (I) — 兩次世界大戰.docx",
  sections: [
    {
      id: "topic-9-ww1",
      title: "第一次世界大戰（1914–1918）：背景、經過與結果",
      summary:
        "第一次世界大戰爆發前的國際關係與衝突原因（民族主義、軍備競賽、同盟制度、巴爾幹問題）、戰爭經過及戰後安排。",
      matchKeywords: [
        "第一次世界大戰",
        "一戰",
        "塞拉耶佛",
        "巴爾幹",
        "三國同盟",
        "三國協約",
        "軍備競賽",
        "無畏艦",
      ],
    },
    {
      id: "topic-9-interwar",
      title: "兩次大戰之間（1919–1939）：巴黎和會、經濟大衰退與極權擴張",
      summary:
        "巴黎和會與《凡爾賽條約》、經濟大衰退、極權國家的興起與擴張、集體安全的失敗及綏靖政策。",
      matchKeywords: [
        "巴黎和會",
        "凡爾賽",
        "經濟大衰退",
        "極權",
        "軸心國",
        "集體安全",
        "綏靖",
        "國際聯盟",
      ],
    },
    {
      id: "topic-9-ww2",
      title: "第二次世界大戰（1939–1945）：爆發、經過與結果",
      summary:
        "第二次世界大戰的爆發、主要戰役與結束，以及戰後的新國際秩序（包括聯合國的成立）。",
      matchKeywords: [
        "第二次世界大戰",
        "二戰",
        "珍珠港",
        "諾曼第",
        "斯大林格勒",
        "原子彈",
        "雅爾塔",
        "波茨坦",
      ],
    },
    {
      id: "topic-9-world-wars",
      title: "兩次世界大戰的關聯與比較",
      summary:
        "兩次世界大戰之間的關聯、整體影響，以及需要同時比較兩次大戰的題目（未能歸入單一時期者亦保留於此）。",
      matchKeywords: ["兩次世界大戰", "兩次大戰", "關聯", "比較"],
    },
    {
      id: "topic-9-holocaust",
      title: "種族滅絕：二戰期間的「猶太大屠殺」",
      summary:
        "種族滅絕的定義、反猶太主義的由來、納粹黨敵視猶太人的原因、對猶太人的迫害與大屠殺，以及戰後國際社會的審訊與反省。",
      matchKeywords: [
        "種族滅絕：二戰期間的「猶太大屠殺」",
        "種族滅絕與猶太大屠殺",
        "種族滅絕",
        "反猶太主義",
        "納粹黨敵視猶太人的原因",
        "早期對猶太人的迫害",
        "《紐倫堡法令》",
        "水晶之夜",
        "猶太人集中營",
        "萬湖會議",
        "奧斯維辛",
        "紐倫堡審判",
        "戰後德國",
      ],
    },
  ],
};

const TOPIC_10: TopicSeed = {
  id: "topic-10",
  topicNumber: 10,
  level: 3,
  title: "課題10：20世紀的國際紛爭及危機(II)–冷戰及後冷戰時代",
  description: "冷戰的背景與成因、各階段的緊張與緩和，以及後冷戰時代的國際局勢。",
  order: 10,
  published: true,
  materialFile: "課題10 20 世紀的國際紛爭及危機 (II) — 冷戰及後冷戰時代.docx",
  sections: [
    {
      id: "topic-10-coldwar-background",
      title: "冷戰的背景與成因",
      summary: "二次大戰後新國際秩序的形成，以及美、蘇對立與意識形態衝突等冷戰成因。",
      matchKeywords: [
        "冷戰的背景與成因",
        "冷戰的背景：新國際秩序的形成",
        "冷戰的成因：美、蘇對立",
        "冷戰是甚麼",
      ],
    },
    {
      id: "topic-10-coldwar-start",
      title: "冷戰的展開與初期對抗（1946–1953）",
      summary:
        "冷戰在歐洲的形成：鐵幕演說、杜魯門主義、馬歇爾計劃、柏林封鎖、北約成立及韓戰。",
      matchKeywords: [
        "冷戰的展開",
        "初期緊張",
        "鐵幕",
        "杜魯門主義",
        "馬歇爾計劃",
        "柏林封鎖",
        "北約",
      ],
    },
    {
      id: "topic-10-coldwar-middle",
      title: "冷戰的起伏：解凍、危機與緩和（1953–1979）",
      summary:
        "史太林去世後的短暫緩和、柏林圍牆與古巴導彈危機、越戰，以及1970年代的緩和（乒乓外交、尼克遜訪華）。",
      matchKeywords: ["冷戰解凍", "古巴導彈危機", "越戰", "冷戰緩和", "乒乓外交"],
    },
    {
      id: "topic-10-coldwar-late",
      title: "冷戰再度加劇（1979–1985）",
      summary:
        "蘇聯入侵阿富汗、美蘇軍備競賽與「星戰計劃」，以及1980年代初期美蘇關係的再次緊張。",
      matchKeywords: ["冷戰再度加劇", "蘇聯入侵阿富汗", "軍備競賽", "星戰計劃"],
    },
    {
      id: "topic-10-coldwar-end",
      title: "冷戰的結束",
      summary: "戈爾巴喬夫的改革、東歐劇變及蘇聯解體，冷戰結束的原因與經過。",
      matchKeywords: ["冷戰的結束", "戈爾巴喬夫", "東歐劇變", "蘇聯解體", "冷戰的終結"],
    },
    {
      id: "topic-10-post-coldwar",
      title: "後冷戰時期的國際局勢",
      summary: "冷戰結束後的國際新秩序、區域衝突及恐怖主義等課題。",
      matchKeywords: ["後冷戰", "後冷戰時期的國際局勢", "後冷戰時代"],
    },
    {
      id: "topic-10-coldwar-development",
      title: "冷戰的發展：跨階段比較",
      summary:
        "同時涉及冷戰多個階段（例如由初期對抗到緩和再到再度加劇）的題目，以及未能歸入單一階段者。",
      matchKeywords: ["冷戰的主要發展", "冷戰的發展", "跨階段"],
    },
  ],
};

const TOPIC_11: TopicSeed = {
  id: "topic-11",
  topicNumber: 11,
  level: 3,
  title: "課題11：20世紀以來的國際合作",
  description: "二十世紀以來人類共同面對的挑戰，以及由國際聯盟到聯合國等國際合作的發展與成效。",
  order: 11,
  published: true,
  materialFile: "課題11 20世紀以來的國際合作.docx",
  sections: [
    {
      id: "topic-11-challenges",
      title: "國際合作的背景：二十世紀以來人類共同面對的挑戰",
      summary:
        "大型軍事衝突、全球貧富差距、疾病傳播與醫療問題、資源開發破壞環境等共同挑戰，以及國際聯盟與早期的和平嘗試。",
      matchKeywords: [
        "國際合作的背景",
        "大型軍事衝突不斷",
        "全球貧富差距嚴重",
        "疾病傳播與醫療問題",
        "資源開發破壞環境",
        "國際聯盟與早期的和平嘗試",
      ],
    },
    {
      id: "topic-11-united-nations",
      title: "聯合國的成立及其工作",
      summary: "聯合國的成立背景、組織架構，以及在維持和平、人權、經濟與社會發展方面的工作。",
      matchKeywords: ["聯合國的成立及其工作", "聯合國的成立與運作", "聯合國"],
    },
  ],
};

const TOPIC_12: TopicSeed = {
  id: "topic-12",
  topicNumber: 12,
  level: 3,
  title: "課題12：20世紀香港的成長與蛻變",
  description: "二戰前後香港的經濟、社會與政制發展，日佔時期的生活，以及香港與世界的連結和回歸祖國。",
  order: 12,
  published: true,
  materialFile: "課題12 二十世紀香港的成長與蛻變.docx",
  sections: [
    {
      id: "topic-12-pre-war-economy",
      title: "戰前香港的經濟發展",
      summary:
        "第二次世界大戰前香港的轉口貿易、工業與金融發展，以及經濟發展帶來的社會變化。",
      matchKeywords: ["戰前的經濟發展", "戰前經濟", "轉口貿易", "經濟發展"],
    },
    {
      id: "topic-12-pre-war-chinese",
      title: "戰前華人的崛起及其角色",
      summary:
        "戰前華人在經濟與社會上的崛起、華資企業及社團（東華三院、保良局等）的角色，以及他們面對的歧視與爭取。",
      matchKeywords: ["戰前華人的崛起及其角色", "華人崛起", "華資", "東華三院", "保良局"],
    },
    {
      id: "topic-12-pre-war",
      title: "第二次世界大戰前的香港：綜合",
      summary:
        "同時涉及戰前經濟與華人社會的題目，以及未能歸入單一主題、需教師覆核者。",
      matchKeywords: ["第二次世界大戰前的香港", "戰前"],
    },
    {
      id: "topic-12-japanese-occupation",
      title: "日佔時期（1941年-1945年）的香港",
      summary: "日軍佔領香港的經過、日佔時期的管治、社會民生及抗戰活動。",
      matchKeywords: ["日佔時期", "日佔時期的香港", "三年零八個月", "香港保衛戰"],
    },
    {
      id: "topic-12-post-war",
      title: "戰後香港的蛻變",
      summary:
        "戰後香港的經濟發展、社會發展與政制改革，以及與歐美和亞洲等地的經濟及文化連結。",
      matchKeywords: [
        "戰後香港的蛻變",
        "戰後香港的蛻變：經濟發展",
        "戰後香港的蛻變：社會發展與政制",
        "與歐美和亞洲等地的經濟及文化連結",
      ],
    },
    {
      id: "topic-12-reunification",
      title: "香港回歸祖國",
      summary: "《中英聯合聲明》、基本法、過渡期安排及1997年香港回歸祖國。",
      matchKeywords: ["香港回歸祖國", "中英聯合聲明", "基本法", "一國兩制", "回歸"],
    },
  ],
};

export const CURRICULUM_TOPICS: TopicSeed[] = [
  TOPIC_1,
  TOPIC_2,
  TOPIC_3,
  TOPIC_4,
  TOPIC_5,
  TOPIC_6,
  TOPIC_7,
  TOPIC_8,
  TOPIC_9,
  TOPIC_10,
  TOPIC_11,
  TOPIC_12,
];

/** 試點課題（課題5）保持獨立匯出，供示範題庫使用 */
export const PILOT_TOPIC = {
  id: TOPIC_5.id,
  title: TOPIC_5.title,
  description: TOPIC_5.description,
  order: TOPIC_5.order,
  published: TOPIC_5.published,
  level: TOPIC_5.level,
  topicNumber: TOPIC_5.topicNumber,
} as const;

export const PILOT_SECTIONS: SectionSeed[] = TOPIC_5.sections;

/** 初中及高中全部課題（搜尋教材檔名及匯入時使用） */
export const ALL_CURRICULUM_TOPICS: TopicSeed[] = [
  ...CURRICULUM_TOPICS,
  ...SENIOR_CURRICULUM_TOPICS,
];

function topicMaterialFiles(topic: TopicSeed): string[] {
  return [...(topic.materialFile ? [topic.materialFile] : []), ...(topic.materialFiles ?? [])];
}

/** 依教材檔案名稱找出對應的課題 */
export function findTopicSeedByFile(fileName: string): TopicSeed | null {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const matches = (candidate: string): boolean =>
    (candidate.split(/[\\/]/).pop() ?? candidate) === base;

  const exact = ALL_CURRICULUM_TOPICS.find((topic) =>
    topicMaterialFiles(topic).some((candidate) => matches(candidate)),
  );
  if (exact) return exact;

  // 由檔名判斷年級及課題編號，例如 HNC2A2E_T5_SN_TE.docx → 中二課題5
  // 高中課題不使用 topicNumber（避免與初中編號衝突），因此這兩個後備規則只查初中。
  const match = /HNC([123])[AB]?2?E?_T(\d+)_/i.exec(fileName);
  if (match) {
    const topicNumber = Number(match[2]);
    return CURRICULUM_TOPICS.find((topic) => topic.topicNumber === topicNumber) ?? null;
  }

  // 課題資料夾名稱（例如「課題5 近代歐洲的興起」）
  const numbered = /課題\s*(\d+)/.exec(fileName);
  if (numbered) {
    const topicNumber = Number(numbered[1]);
    return CURRICULUM_TOPICS.find((topic) => topic.topicNumber === topicNumber) ?? null;
  }
  return null;
}

/** 所有課程教材檔案 */
export function allCurriculumMaterialFiles(): string[] {
  return ALL_CURRICULUM_TOPICS.flatMap(topicMaterialFiles);
}

/**
 * 某教材檔案只可對應的分節 ID 清單；沒有聲明時回傳 null（維持以關鍵詞在全部分節中比對）。
 *
 * 用於避免同一課題的多份筆記互相污染：例如課題4 的 4.2 提及「第一次世界大戰」，
 * 若不設限會被歸入 4.1 的分節。
 */
export function declaredSectionsForFile(fileName: string): string[] | null {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  for (const topic of ALL_CURRICULUM_TOPICS) {
    const declared = topic.materialFileSections;
    if (!declared) continue;
    for (const [candidate, sectionIds] of Object.entries(declared)) {
      if ((candidate.split(/[\\/]/).pop() ?? candidate) === base && sectionIds.length > 0) {
        return sectionIds;
      }
    }
  }
  return null;
}

export function flatSectionSeeds(sections: SectionSeed[]): SectionSeed[] {
  return sections.flatMap((section) => [section, ...(section.children ?? [])]);
}

export function topicThemeText(
  level: CurriculumLevel,
  theme?: CurriculumTheme | null,
): string {
  return curriculumThemeText(level, theme);
}

export { SENIOR_CURRICULUM_TOPICS };
