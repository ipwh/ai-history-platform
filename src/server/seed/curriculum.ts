/**
 * 香港教育局歷史科課程（中一至中三）12 個課題的結構。
 *
 * 課程組織（按教育局歷史科課程指引）：
 *   中一（level 1）古代世界（史前時期至 14 世紀）：區域文明的誕生與交流 → 課題 1-4
 *   中二（level 2）近代世界（15 至 19 世紀）：西力的形成與外延     → 課題 5-8
 *   中三（level 3）現代世界（20 世紀至今）：邁向多極與相互依存    → 課題 9-12
 *
 * 每個課題的分節按試點教材（《歷史旅程－新課題系列（第二版）》溫習筆記）
 * 的編排整理，matchKeywords 用於把教材段落自動對應到分節。
 */
import { curriculumThemeText, type CurriculumLevel } from "../../lib/types";

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
  /** 對應的教材檔案名稱（用於自動匯入） */
  materialFile: string | null;
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
  description: "由人類起源、史前時期的生活，到古文明的誕生與特徵，探討人類自古至今基本需要的延續與轉變。",
  order: 1,
  published: true,
  materialFile: "課題1人類的需要 古與今/課題1人類的需要 古與今_課文.docx",
  sections: [
    {
      id: "topic-1-origins",
      title: "人類歷史的起源",
      summary: "古人類的演化與不同地區的早期人類。",
      matchKeywords: ["人類歷史的起源", "古人類"],
      children: [
        {
          id: "topic-1-origins-species",
          title: "古人類與演化",
          summary: "南方古猿、能人、直立人與智人。",
          matchKeywords: ["南方古猿", "智人", "直立人", "能人"],
        },
      ],
    },
    {
      id: "topic-1-periods",
      title: "歷史時期的劃分：史前時期與信史時期",
      summary: "以文字紀錄區分史前時期與信史時期；石器時代的演進。",
      matchKeywords: ["歷史時期的劃分", "史前時期與信史時期", "計時紀年"],
      children: [
        {
          id: "topic-1-periods-paleolithic",
          title: "舊石器時代",
          summary: "採摘與狩獵、游獵生活、簡單石器與用火。",
          matchKeywords: ["舊石器時代"],
        },
        {
          id: "topic-1-periods-neolithic",
          title: "新石器時代",
          summary: "農耕與畜牧、定居與村落、打磨石器與紡織。",
          matchKeywords: ["新石器時代", "新的生活模式"],
        },
        {
          id: "topic-1-periods-end",
          title: "石器時代的終結",
          summary: "由石器時代走向金屬器時代。",
          matchKeywords: ["石器時代的終結"],
        },
      ],
    },
    {
      id: "topic-1-civilisation",
      title: "古文明的誕生",
      summary: "文明的特徵及古文明誕生的背景。",
      matchKeywords: ["文明的特徵", "古文明誕生的背景", "古文明的誕生"],
      children: [
        {
          id: "topic-1-civilisation-features",
          title: "文明的特徵",
          summary: "城市生活、文字、政府與宗教等文明要素。",
          matchKeywords: ["文明的特徵", "城市生活的興起", "文字的發明"],
        },
        {
          id: "topic-1-civilisation-background",
          title: "古文明誕生的背景",
          summary: "大河與農業生產如何促成古文明。",
          matchKeywords: ["古文明誕生的背景"],
        },
      ],
    },
    {
      id: "topic-1-four-civilisations",
      title: "四大古代文明",
      summary: "古埃及文明（尼羅河流域）（新月沃土、印度河流域及黃河、長江流域文明不在本課程考核範圍）。",
      matchKeywords: [
        "四大古代文明",
        "四大古代文明的簡介",
        "四大古代文明的特徵",
        "尼羅河流域",
        "古埃及",
      ],
      children: [
        {
          id: "topic-1-four-civilisations-egypt",
          title: "古埃及文明（尼羅河流域）",
          summary: "位置、民族、衰落及文明特徵。",
          matchKeywords: ["尼羅河流域文明", "古代埃及文明", "古埃及文明", "古埃及", "尼羅河"],
        },
      ],
    },
    {
      id: "topic-1-summary",
      title: "總結：古與今：人類相同的基本需要",
      summary: "比較古今人類在基本需要上的延續與轉變。",
      matchKeywords: ["古與今", "人類相同的基本需要", "總結"],
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
      id: "topic-2-classical",
      title: "古典文明：古希臘與古羅馬",
      summary: "歐洲歷史時期的劃分及早期文明的概況。",
      matchKeywords: ["歐洲歷史時期的劃分", "歐洲的早期文明", "古典文明的介紹"],
      children: [
        {
          id: "topic-2-classical-greece",
          title: "古希臘文明",
          summary: "地理環境、城邦政治（斯巴達與雅典）及文化成就。",
          matchKeywords: ["古希臘文明", "古希臘的地理環境", "斯巴達", "雅典民主政治"],
        },
        {
          id: "topic-2-classical-rome",
          title: "古羅馬文明",
          summary: "由共和制到元首制的政治演變及帝國擴張。",
          matchKeywords: ["古羅馬文明", "羅馬共和", "羅馬元首制", "羅馬帝國"],
        },
      ],
    },
    {
      id: "topic-2-classical-legacy",
      title: "古典文明的遺產與意義",
      summary: "政治制度、法律、建築、語言及思想上的貢獻。",
      matchKeywords: ["古典文明的遺產與意義", "歐洲古典文明的遺產與意義"],
    },
    {
      id: "topic-2-medieval",
      title: "歐洲踏入中古時代",
      summary: "西羅馬帝國滅亡後歐洲的轉變。",
      matchKeywords: ["歐洲踏入中古時代", "中古時代的歐洲"],
      children: [
        {
          id: "topic-2-medieval-christianity",
          title: "基督宗教世界的形成",
          summary: "基督宗教的傳播與教會在中古歐洲的角色。",
          matchKeywords: ["基督宗教世界的形成", "基督宗教在歐洲的傳播"],
        },
        {
          id: "topic-2-medieval-feudalism",
          title: "封建社會的出現及其特徵",
          summary: "封建制度下各階級的關係與莊園經濟。",
          matchKeywords: ["封建社會的出現及其特徵", "歐洲封建社會"],
        },
      ],
    },
    {
      id: "topic-2-medieval-legacy",
      title: "歐洲中古文明的遺產與意義",
      summary: "中古時代對近代歐洲的影響。",
      matchKeywords: ["歐洲中古文明的遺產與意義"],
    },
    {
      id: "topic-2-medieval-end",
      title: "中古時代的結束",
      summary: "黑死病、百年戰爭及1453年等關鍵事件。",
      matchKeywords: ["中古時代的結束", "1453年"],
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
      summary: "創教者、經典、教義、主要宗派及傳播。",
      matchKeywords: ["伊斯蘭教的起源、教義與發展", "伊斯蘭教的創立", "認識伊斯蘭教"],
    },
    {
      id: "topic-3-trade-network",
      title: "控制連接歐、亞、非的商貿網絡",
      summary: "陸上絲綢之路、阿拉伯人的仲介貿易、海上絲路及意大利城邦商人。",
      matchKeywords: ["控制連接歐、亞、非的商貿網絡", "陸上絲綢之路", "海上絲路", "仲介貿易"],
    },
    {
      id: "topic-3-empire",
      title: "建立橫跨歐、亞、非的龐大帝國",
      summary: "阿拉伯帝國的擴張、收復失地運動、十字軍東征及蒙古西征。",
      matchKeywords: ["建立橫跨歐、亞、非的龐大帝國", "阿拉伯帝國的擴張", "十字軍東征", "蒙古西征"],
    },
    {
      id: "topic-3-europe",
      title: "擴闊中古時代歐洲人的視野",
      summary: "地理與醫學知識傳入歐洲，刺激探索精神。",
      matchKeywords: ["擴闊中古時代歐洲人的視野", "擴闊了歐洲人的世界觀"],
    },
    {
      id: "topic-3-asia",
      title: "促進歐洲文明在亞洲傳播",
      summary: "基督宗教向東方傳播及古文明知識的保存。",
      matchKeywords: ["促進歐洲文明在亞洲傳播", "基督宗教向東方傳播"],
    },
    {
      id: "topic-3-golden-age",
      title: "促成伊斯蘭文明的興起",
      summary: "八至十三世紀伊斯蘭文明的黃金時代。",
      matchKeywords: ["促成伊斯蘭文明的興起", "黃金時代", "伊斯蘭文明的主要成就"],
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
      id: "topic-4-documented",
      title: "信史時期的香港",
      summary: "由秦朝納入郡縣管轄開始的香港地區歷史。",
      matchKeywords: ["信史時期的香港", "香港進入信史時期"],
    },
    {
      id: "topic-4-clans",
      title: "主要民系與姓族",
      summary: "四大民系及新界五大姓族。",
      matchKeywords: ["主要民系與姓族", "四大民系", "新界本地人五大姓族"],
    },
    {
      id: "topic-4-life",
      title: "早期香港居民的生活",
      summary: "居所與建築、主要為生方法、傳統教育、信仰與習俗。",
      matchKeywords: ["早期香港居民的生活", "居所與建築", "主要為生方法", "傳統教育", "信仰與習俗"],
    },
    {
      id: "topic-4-heritage",
      title: "非物質文化遺產",
      summary: "非物質文化遺產的定義、類別及本地代表例子。",
      matchKeywords: ["非物質文化遺產", "文化遺產與非物質文化遺產"],
    },
  ],
};

/* ------------------------------------------------------------------ */
/* 中二：近代世界（15 至 19 世紀）：西力的形成與外延                   */
/* ------------------------------------------------------------------ */

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
      id: "topic-5-renaissance-reformation",
      title: "文藝復興與宗教改革",
      summary:
        "十四至十七世紀歐洲在文化、思想及宗教上的革新運動：文藝復興的特點、成因、起源與發展，以及宗教改革的背景、發展及影響。",
      matchKeywords: [
        "文藝復興",
        "從神本走向人本",
        "文藝復興的主要特點",
        "文藝復興出現的原因",
        "文藝復興的起源與發展",
        "文學、藝術與自然科學",
        "文學方面的發展",
        "藝術方面的發展",
        "自然科學",
        "文藝復興的主要發展",
        "文藝復興的影響",
        "宗教改革",
        "宗教改革的背景",
        "宗教改革的發展",
        "宗教改革的影響",
      ],
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
      title: "早期擴張（十六世紀初至十八世紀末）的背景及原因",
      summary: "新航路的開闢、接觸「新大陸」，以及政治、經濟、社會文化方面的擴張原因。",
      matchKeywords: ["早期擴張", "十六世紀初至十八世紀末", "新航路的開闢的簡介", "開闢新航路"],
    },
    {
      id: "topic-6-late-expansion",
      title: "後期擴張（十九世紀末至二十世紀初）的背景及原因",
      summary: "歐洲軍力優勢、民族主義變質及「白人的負擔」等背景與原因。",
      matchKeywords: ["後期擴張", "十九世紀末至二十世紀初", "白人的負擔"],
    },
    {
      id: "topic-6-policy",
      title: "殖民政策的形成與演變、殖民擴張的方式",
      summary: "由爭取貿易到擴大統治範圍；政治、經濟及社會文化的擴張方式。",
      matchKeywords: ["殖民政策的形成與演變", "殖民擴張的方式", "殖民擴張的簡介"],
    },
    {
      id: "topic-6-impact-others",
      title: "對美、亞、非三洲的影響",
      summary: "政治、經濟、社會及文化方面的正負影響。",
      matchKeywords: ["對美、亞、非三洲的影響", "對美亞非三洲的影響"],
    },
    {
      id: "topic-6-impact-europe",
      title: "對歐洲的影響",
      summary: "形成以歐洲為中心的世界經濟體系及引發爭奪殖民地的衝突。",
      matchKeywords: ["對歐洲的影響", "以歐洲為中心的世界經濟體系"],
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
      id: "topic-7-revolution-causes",
      title: "美國革命的內外成因",
      summary: "政治與經濟不滿、啟蒙運動的影響。",
      matchKeywords: ["美國革命的內外成因", "內外成因", "啟蒙運動的影響"],
    },
    {
      id: "topic-7-revolution",
      title: "美國革命（1775-1783年）",
      summary: "由《獨立宣言》到美國成立。",
      matchKeywords: ["美國革命（1775-1783年）", "獨立宣言"],
    },
    {
      id: "topic-7-revolution-impact",
      title: "美國革命的影響",
      summary: "推動革命活動、樹立自由民主典範。",
      matchKeywords: ["美國革命的內外因素及影響", "樹立自由、民主的典範"],
    },
    {
      id: "topic-7-constitution",
      title: "十八世紀末美國的政治體制與憲法",
      summary: "《美國憲法》、聯邦共和國、總統領導與權力分立、《權利法案》。",
      matchKeywords: ["十八世紀末美國的政治體制與憲法", "美國憲法", "權利法案", "聯邦共和國"],
    },
    {
      id: "topic-7-expansion",
      title: "十九世紀的領土拓展",
      summary: "購地、協議與戰爭、門羅主義及西進運動。",
      matchKeywords: ["十九世紀的領土拓展", "門羅主義", "西進運動"],
    },
    {
      id: "topic-7-civil-war",
      title: "美國南北內戰（1861-1865年）及影響",
      summary: "南北差異、戰爭導火線、結果與政治、經濟、社會影響。",
      matchKeywords: ["美國南北內戰", "南北內戰的影響", "南北差異"],
    },
    {
      id: "topic-7-postwar",
      title: "美國南北內戰後的重要發展",
      summary: "南方重建、高速工業化及躍居世界大國。",
      matchKeywords: ["美國南北內戰後的重要發展", "重建時期", "高速工業化", "躍居世界大國"],
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
      id: "topic-8-occupation",
      title: "英國侵佔香港",
      summary: "《南京條約》、《北京條約》及《展拓香港界址專條》。",
      matchKeywords: ["英國侵佔香港", "南京條約", "北京條約", "展拓香港界址專條"],
    },
    {
      id: "topic-8-colonial-rule",
      title: "英國殖民管治的建立",
      summary: "政府架構、典章制度及早期殖民管治的特色。",
      matchKeywords: ["英國殖民管治的建立", "政府架構及典章制度", "早期殖民管治的特色"],
    },
    {
      id: "topic-8-economy",
      title: "經濟發展狀況",
      summary: "自由港政策、轉口貿易及相關產業。",
      matchKeywords: ["經濟發展狀況", "自由港政策", "轉口貿易"],
    },
    {
      id: "topic-8-society",
      title: "社會發展狀況",
      summary: "人口增長、公共衛生、治安、對華人政策、教育及市區拓展。",
      matchKeywords: ["社會發展狀況", "公共衛生惡劣", "教育政策", "市區拓展"],
    },
    {
      id: "topic-8-organisations",
      title: "不同民間團體對香港的貢獻",
      summary: "東華醫院、保良局、九龍樂善堂、團防局及海外宗教團體。",
      matchKeywords: ["不同民間團體對香港的貢獻", "東華醫院", "保良局", "樂善堂", "團防局"],
    },
  ],
};

/* ------------------------------------------------------------------ */
/* 中三：現代世界（20 世紀至今）：邁向多極與相互依存                  */
/* ------------------------------------------------------------------ */

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
      id: "topic-9-ww1-causes",
      title: "第一次世界大戰：爆發的背景與成因",
      summary: "經濟與殖民地競爭、軍備競賽、同盟制度及極端民族主義。",
      matchKeywords: ["大戰爆發的背景與成因", "經濟與殖民地競爭", "軍備競賽", "同盟制度"],
    },
    {
      id: "topic-9-ww1-trigger",
      title: "引發大戰的衝突與導火線",
      summary: "摩洛哥危機、波斯尼亞危機、巴爾幹戰爭及塞拉耶佛事件。",
      matchKeywords: ["引發大戰的衝突與導火線", "摩洛哥危機", "塞拉耶佛事件"],
    },
    {
      id: "topic-9-ww1-result",
      title: "大戰的結果",
      summary: "巴黎和會（1919年）與歐洲版圖重劃。",
      matchKeywords: ["大戰的結果", "巴黎和會", "歐洲版圖重劃"],
    },
    {
      id: "topic-9-interwar",
      title: "兩次大戰期間的經濟問題",
      summary: "一戰後的經濟不景及經濟大衰退（1929-1933年）。",
      matchKeywords: ["兩次大戰期間的經濟問題", "經濟大衰退", "經濟不景"],
    },
    {
      id: "topic-9-treaty",
      title: "巴黎和會的主要決議和缺失",
      summary: "《凡爾賽條約》、民族自決、集體安全制度及其隱患。",
      matchKeywords: ["巴黎和會（1919 年）的主要決議和缺失", "凡爾賽條約", "民族自決"],
    },
    {
      id: "topic-9-ww2",
      title: "第二次世界大戰：爆發的背景與成因",
      summary: "極權主義興起、綏靖政策及二戰爆發。",
      matchKeywords: ["二戰爆發的背景與成因", "二次大戰"],
    },
    {
      id: "topic-9-impact",
      title: "兩次世界大戰的影響",
      summary: "人命傷亡、經濟破壞及國際秩序的改變。",
      matchKeywords: ["兩次大戰的影響", "一戰遺留的問題", "一戰後的國際局勢"],
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
      summary: "新國際秩序的形成、美蘇對立：意識形態矛盾與互不信任。",
      matchKeywords: ["冷戰的背景與成因", "冷戰的背景", "冷戰的成因", "冷戰是甚麼"],
    },
    {
      id: "topic-10-coldwar-early",
      title: "冷戰的展開與初期緊張局勢（1946-1953年）",
      summary: "鐵幕演說、杜魯門主義、馬歇爾計劃、柏林封鎖及朝鮮戰爭。",
      matchKeywords: ["冷戰的展開與初期緊張局勢", "鐵幕", "杜魯門主義", "馬歇爾計劃", "柏林封鎖"],
    },
    {
      id: "topic-10-coldwar-thaw",
      title: "冷戰解凍與危機迭起（1953-1971年）",
      summary: "U-2偵察機事件、柏林危機、古巴導彈危機及越戰。",
      matchKeywords: ["冷戰解凍", "冷戰持續與危機迭起", "古巴導彈危機", "越戰"],
    },
    {
      id: "topic-10-coldwar-deteriorate",
      title: "冷戰緩和與再度加劇（1971-1985年）",
      summary: "冷戰緩和（1971-1979年）、蘇聯入侵阿富汗及列根就任總統。",
      matchKeywords: ["冷戰緩和", "冷戰再度加劇", "蘇聯入侵阿富汗", "列根"],
    },
    {
      id: "topic-10-coldwar-end",
      title: "冷戰的結束與後冷戰時代",
      summary: "冷戰的終結及後冷戰時代的國際局勢。",
      matchKeywords: ["冷戰的結束", "後冷戰"],
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
      id: "topic-11-challenges-conflict",
      title: "大型軍事衝突不斷",
      summary: "衝突數目增加與破壞升級，以及推動和平的嘗試。",
      // 2026-10 版教材把此節標題寫成「大戰潛在再起風險」，並以「維和嘗試失敗」分段
      matchKeywords: [
        "大型軍事衝突不斷",
        "衝突數目增加與破壞程度升級",
        "推動和平的嘗試",
        "大戰潛在再起風險",
        "維和嘗試失敗",
        "兩次大戰造成空前破壞",
        "促進和平的努力",
      ],
    },
    {
      id: "topic-11-challenges-poverty",
      title: "全球貧富差距嚴重",
      summary: "財富分布不均、欠發達國家資源匱乏及貧窮的惡性循環。",
      matchKeywords: ["全球貧富差距嚴重", "財富分布不均", "貧窮的惡性循環"],
    },
    {
      id: "topic-11-challenges-health",
      title: "疾病傳播與醫療問題",
      summary: "傳染病與新興疾病、欠發達國家醫療水平低下。",
      // 2026-10 版教材把此節標題寫成「疾病威脅人類生存」
      matchKeywords: [
        "疾病傳播與醫療問題",
        "傳染病與新興疾病",
        "欠發達國家醫療水平低下",
        "疾病威脅人類生存",
        "新舊疾病傳播迅速",
        "疾病傳播",
        "醫療水平",
      ],
    },
    {
      id: "topic-11-challenges-environment",
      title: "資源開發破壞環境",
      summary: "人口增長與環境開發、自然環境破壞及全球性的環境危機。",
      // 2026-10 版教材把此節標題寫成「過度開發破壞環境」
      matchKeywords: [
        "資源開發破壞環境",
        "人口增長與環境開發",
        "全球性的環境危機",
        "溫室效應",
        "過度開發破壞環境",
        "資源枯竭與物種滅絕",
        "自然環境遭污染破壞",
        "全球暖化與臭氧層破壞",
      ],
    },
    {
      id: "topic-11-league",
      title: "國際聯盟與早期的和平嘗試",
      summary: "裁軍會議、和平組織及國際聯盟的成立與限制。",
      matchKeywords: ["國際聯盟", "裁軍會議", "和平組織"],
    },
    {
      id: "topic-11-united-nations",
      title: "聯合國的成立與運作",
      summary: "《聯合國憲章》、成立目標及推動國際合作的角色。",
      matchKeywords: ["聯合國", "聯合國憲章"],
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
      title: "戰前的經濟發展",
      summary: "轉口貿易及華資企業的崛起。",
      matchKeywords: ["戰前的經濟發展", "轉口貿易", "百貨零售業", "華資企業"],
    },
    {
      id: "topic-12-pre-war-chinese",
      title: "戰前華人的崛起及其角色",
      summary: "在政治、經濟及社會方面的角色。",
      matchKeywords: ["戰前華人的崛起及其角色", "官民溝通橋樑", "新晉銀行領袖", "民生服務主導者"],
    },
    {
      id: "topic-12-japanese-occupation",
      title: "日佔時期（1941-1945年）",
      summary: "日本侵佔香港及日佔時期的政治、經濟、社會與文化概況。",
      matchKeywords: ["日佔時期", "日本侵佔香港", "軍政廳", "以華制華"],
    },
    {
      id: "topic-12-post-war-economy",
      title: "戰後香港的蛻變：經濟發展",
      summary: "由轉口港到工業中心，再發展為國際金融中心。",
      matchKeywords: ["戰後香港的蛻變", "多方面發展", "國際金融中心", "工業中心"],
    },
    {
      id: "topic-12-post-war-society",
      title: "戰後香港的蛻變：社會發展與政制",
      summary: "公營房屋、免費教育、專上教育及管治與政制發展。",
      matchKeywords: ["社會發展", "公營房屋", "免費教育", "管治與政制"],
    },
    {
      id: "topic-12-global-links",
      title: "與歐美和亞洲等地的經濟及文化連結",
      summary: "香港工業製品、運輸網絡、海外辦事處及國際文化盛事。",
      matchKeywords: ["與歐美和亞洲等地的經濟及文化連結", "香港運輸網絡連接環球", "國際文化盛事"],
    },
    {
      id: "topic-12-reunification",
      title: "香港回歸祖國",
      summary: "香港問題談判、《中英聯合聲明》、《基本法》及香港特別行政區成立。",
      matchKeywords: ["香港回歸祖國", "中英聯合聲明", "基本法", "香港特別行政區成立"],
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

/** 依教材檔案名稱找出對應的課題 */
export function findTopicSeedByFile(fileName: string): TopicSeed | null {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const matches = (candidate: string | null): boolean =>
    candidate !== null && (candidate.split(/[\\/]/).pop() ?? candidate) === base;

  const exact = CURRICULUM_TOPICS.find((topic) => matches(topic.materialFile));
  if (exact) return exact;

  // 由檔名判斷年級及課題編號，例如 HNC2A2E_T5_SN_TE.docx → 中二課題5
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
  return CURRICULUM_TOPICS.flatMap((topic) => (topic.materialFile ? [topic.materialFile] : []));
}

export function flatSectionSeeds(sections: SectionSeed[]): SectionSeed[] {
  return sections.flatMap((section) => [section, ...(section.children ?? [])]);
}

export function topicThemeText(level: CurriculumLevel): string {
  return level === 0 ? "" : curriculumThemeText(level);
}
