/**
 * 內建示範題庫（課題5）。
 *
 * 這些題目由教師按試點教材《HNC2A2E_T5_SN_TE.docx》的內容撰寫，
 * 每題的 sourceAnchor 必須真實出現在教材中；匯入教材後系統會自動核對，
 * 核對失敗的題目會被標示為未通過教材依據驗證（草稿狀態），提醒教師檢查。
 */
import type { Difficulty, QuestionType } from "../../lib/types";

export interface DemoQuestionSeed {
  id: string;
  sectionId: string;
  questionType: QuestionType;
  difficulty: Difficulty;
  question: string;
  options?: string[];
  correctAnswer: string;
  acceptedAnswers?: string[];
  explanation: string;
  knowledgePoint: string;
  gradingPoints?: string[];
  /** 用於在教材中定位來源段落（必須真實出現於教材） */
  sourceAnchor: string;
}

export const DEMO_QUESTIONS: DemoQuestionSeed[] = [
  /* ---------------- 文藝復興：主要特點 ---------------- */
  {
    id: "q-renaissance-nature",
    sectionId: "topic-5-renaissance-reformation",
    questionType: "mc",
    difficulty: "basic",
    question: "「文藝復興」是歐洲的一場甚麼運動？",
    options: [
      "文化與思想革新運動",
      "農業生產技術改良運動",
      "對外殖民擴張運動",
      "教會內部的紀律重整運動",
    ],
    correctAnswer: "文化與思想革新運動",
    explanation:
      "文藝復興是十四至十七世紀歐洲的一場文化與思想革新運動，其名稱帶有「復興」、「再生」的意思。",
    knowledgePoint: "文藝復興的性質及時期",
    sourceAnchor: "歐洲的一場文化與思想革新運動",
  },
  {
    id: "q-renaissance-features",
    sectionId: "topic-5-renaissance-reformation",
    questionType: "mc",
    difficulty: "basic",
    question: "以下哪一項是文藝復興的主要特點？",
    options: [
      "復興古希臘、羅馬文明",
      "以神為中心，否定人類的價值",
      "完全拒絕古代的文化遺產",
      "只以拉丁文創作宗教文學",
    ],
    correctAnswer: "復興古希臘、羅馬文明",
    explanation:
      "文藝復興的主要特點包括復興古希臘、羅馬文明、重視人文主義，以及挑戰傳統。",
    knowledgePoint: "文藝復興的主要特點",
    sourceAnchor: "復興古希臘、羅馬文明",
  },
  /* ---------------- 文藝復興：出現原因 ---------------- */
  {
    id: "q-renaissance-causes",
    sectionId: "topic-5-renaissance-reformation",
    questionType: "mc",
    difficulty: "advanced",
    question: "以下哪一項「不是」文藝復興出現的原因？",
    options: ["大學的興起", "教會權威下降", "封建社會瓦解", "美洲白銀大量流入歐洲"],
    correctAnswer: "美洲白銀大量流入歐洲",
    explanation:
      "文藝復興出現的原因包括封建社會瓦解、古典文明與伊斯蘭文明的刺激、富有城邦及新興階級的興起、大學的興起，以及教會權威下降；美洲白銀流入歐洲並非文藝復興的成因。",
    knowledgePoint: "文藝復興出現的原因",
    sourceAnchor: "大學的興起",
  },
  {
    id: "q-renaissance-feudal",
    sectionId: "topic-5-renaissance-reformation",
    questionType: "fill",
    difficulty: "basic",
    question:
      "中古時代後期，隨着城鎮興起與黑死病蔓延，歐洲的＿＿＿社會逐漸瓦解，為文藝復興的誕生創造有利條件。",
    correctAnswer: "封建",
    acceptedAnswers: ["封建", "封建社會"],
    explanation:
      "中古時代後期，隨着城鎮興起與黑死病蔓延，封建社會逐漸瓦解；農民逃離莊園後在城市定居，有較多自由與時間投入藝術與學術活動。",
    knowledgePoint: "封建社會瓦解與文藝復興的出現",
    sourceAnchor: "封建社會逐漸瓦解",
  },
  /* ---------------- 文藝復興：起源與發展 ---------------- */
  {
    id: "q-renaissance-origin-place",
    sectionId: "topic-5-renaissance-reformation",
    questionType: "mc",
    difficulty: "basic",
    question: "文藝復興最先在哪個地區興起？",
    options: ["意大利半島", "英格蘭", "德意志地區", "法國北部"],
    correctAnswer: "意大利半島",
    explanation: "文藝復興首先於意大利半島興起，其後逐漸傳播至歐洲其他地區。",
    knowledgePoint: "文藝復興的起源地",
    sourceAnchor: "首先於意大利半島興起，並逐漸傳播至歐洲其他地區",
  },
  {
    id: "q-renaissance-origin-literature",
    sectionId: "topic-5-renaissance-reformation",
    questionType: "fill",
    difficulty: "basic",
    question: "文藝復興最早出現在＿＿＿領域，其後才擴展至藝術及自然科學等範疇。",
    correctAnswer: "文學",
    acceptedAnswers: ["文學", "文學方面"],
    explanation: "文藝復興最早出現在文學領域。",
    knowledgePoint: "文藝復興的發展次序",
    sourceAnchor: "文藝復興最早出現在文學領域",
  },
  {
    id: "q-renaissance-origin-reason",
    sectionId: "topic-5-renaissance-reformation",
    questionType: "mc",
    difficulty: "advanced",
    question: "文藝復興首先在意大利半島興起的原因之一是甚麼？",
    options: [
      "意大利半島保留了大量古羅馬文化遺產",
      "意大利半島完全不受教會影響",
      "意大利君主下令推行復古政策",
      "意大利最早發明活字印刷術",
    ],
    correctAnswer: "意大利半島保留了大量古羅馬文化遺產",
    explanation:
      "意大利半島是古羅馬文明的搖籃，保留大量文化遺產；當地富裕階層亦樂於資助文藝創作與學術研究，促使文藝復興首先在此興起。",
    knowledgePoint: "文藝復興首先在意大利興起的原因",
    sourceAnchor: "意大利半島是古羅馬文明的搖籃，保留了大量文化遺產",
  },

  /* ---------------- 文藝復興：文學、藝術與自然科學 ---------------- */
  {
    id: "q-renaissance-dante",
    sectionId: "topic-5-renaissance-reformation",
    questionType: "mc",
    difficulty: "basic",
    question: "《神曲》的作者是誰？",
    options: ["但丁", "薄伽邱", "莎士比亞", "米開蘭基羅"],
    correctAnswer: "但丁",
    explanation:
      "意大利人但丁被視為文學革新的先驅，他的代表作《神曲》以意大利文寫成。",
    knowledgePoint: "文藝復興文學代表：但丁",
    sourceAnchor: "但丁被視為文學革新的先驅",
  },
  {
    id: "q-renaissance-decameron",
    sectionId: "topic-5-renaissance-reformation",
    questionType: "mc",
    difficulty: "advanced",
    question:
      "以下哪一部作品以意大利文寫成，講述一群年輕人為躲避瘟疫離開佛羅倫斯，並通過說故事打發時間？",
    options: ["《十日談》", "《神曲》", "《哈姆雷特》", "《雅典學院》"],
    correctAnswer: "《十日談》",
    explanation:
      "意大利人薄伽邱的代表作《十日談》以意大利文寫成，書中不少篇章諷刺教會與揭示人性。",
    knowledgePoint: "文藝復興文學代表：薄伽邱",
    sourceAnchor: "講述一群年輕人為躲避瘟疫離開佛羅倫斯",
  },
  {
    id: "q-renaissance-vinci",
    sectionId: "topic-5-renaissance-reformation",
    questionType: "fill",
    difficulty: "basic",
    question: "達文西擅長運用透視、光線與陰影等技巧，其名作包括《蒙娜麗莎》與《＿＿＿》。",
    correctAnswer: "最後的晚餐",
    acceptedAnswers: ["最後的晚餐"],
    explanation: "《蒙娜麗莎》與《最後的晚餐》是達文西的名作。",
    knowledgePoint: "文藝復興藝術三傑：達文西",
    sourceAnchor: "《蒙娜麗莎》與《最後的晚餐》是他的名作",
  },
  {
    id: "q-renaissance-michelangelo",
    sectionId: "topic-5-renaissance-reformation",
    questionType: "mc",
    difficulty: "advanced",
    question: "米開蘭基羅在西斯汀教堂天花板繪製的傳世巨作是？",
    options: ["《創世紀》", "《雅典學院》", "《蒙娜麗莎》", "《神曲》"],
    correctAnswer: "《創世紀》",
    explanation:
      "米開蘭基羅擅長描繪人體，仿效古希臘風格讚頌人體之美；他在西斯汀教堂天花板繪製《創世紀》場景，牆壁上則繪有《末日審判》。",
    knowledgePoint: "文藝復興藝術三傑：米開蘭基羅",
    sourceAnchor: "他在西斯汀教堂天花板繪製的《創世紀》場景",
  },
  /* ---------------- 文藝復興：影響 ---------------- */
  {
    id: "q-renaissance-impact",
    sectionId: "topic-5-renaissance-reformation",
    questionType: "mc",
    difficulty: "basic",
    question: "以下哪一項是文藝復興的影響？",
    options: [
      "奠定近代歐洲文明的基礎",
      "使歐洲重返封建制度",
      "令教會完全控制歐洲人的思想",
      "使拉丁文成為歐洲唯一的書寫語言",
    ],
    correctAnswer: "奠定近代歐洲文明的基礎",
    explanation:
      "文藝復興奠定近代歐洲文明的基礎、解放歐洲人的傳統思想，並掀起歐洲變革的序幕。",
    knowledgePoint: "文藝復興的影響",
    sourceAnchor: "奠定近代歐洲文明的基礎",
  },
  /* ---------------- 宗教改革：背景 ---------------- */
  {
    id: "q-reformation-nature",
    sectionId: "topic-5-renaissance-reformation",
    questionType: "mc",
    difficulty: "basic",
    question: "「宗教改革」是一場甚麼運動？",
    options: [
      "歐洲基督宗教的革新運動",
      "歐洲的農業改良運動",
      "歐洲的科學思想變革",
      "歐洲的君主集權運動",
    ],
    correctAnswer: "歐洲基督宗教的革新運動",
    explanation: "宗教改革是十六至十七世紀歐洲基督宗教的一場革新運動。",
    knowledgePoint: "宗教改革的性質",
    sourceAnchor: "歐洲基督宗教的一場革新運動",
  },
  {
    id: "q-reformation-background",
    sectionId: "topic-5-renaissance-reformation",
    questionType: "mc",
    difficulty: "advanced",
    question: "以下哪一項屬於宗教改革的背景？",
    options: ["教會積弊日益嚴重", "歐洲人口大幅上升", "蒸汽機廣泛應用", "美洲殖民地相繼獨立"],
    correctAnswer: "教會積弊日益嚴重",
    explanation:
      "宗教改革的背景包括基督徒質疑教會詮釋、君主不滿教會權力過大，以及教會積弊日益嚴重。",
    knowledgePoint: "宗教改革的背景",
    sourceAnchor: "教會積弊日益嚴重",
  },
  /* ---------------- 宗教改革：發展 ---------------- */
  {
    id: "q-reformation-95theses",
    sectionId: "topic-5-renaissance-reformation",
    questionType: "mc",
    difficulty: "basic",
    question: "1517年，馬丁路德發表了甚麼文件，標誌宗教改革的展開？",
    options: ["《九十五條論證》", "《人權及公民權利宣言》", "《神曲》", "《網球場宣言》"],
    correctAnswer: "《九十五條論證》",
    explanation:
      "1517年10月，德意志神學家馬丁路德發表《九十五條論證》，批評教會濫用贖罪券，標誌宗教改革的展開。",
    knowledgePoint: "馬丁路德與《九十五條論證》",
    sourceAnchor: "馬丁路德發表《九十五條論證》",
  },
  {
    id: "q-reformation-sola-fide",
    sectionId: "topic-5-renaissance-reformation",
    questionType: "fill",
    difficulty: "basic",
    question: "馬丁路德主張人要＿＿＿才可以得救（因信稱義），並不是倚靠購買「贖罪券」。",
    correctAnswer: "相信上帝",
    acceptedAnswers: ["相信上帝", "信仰", "因信稱義"],
    explanation: "《九十五條論證》指出人要相信上帝才可以得救（因信稱義）。",
    knowledgePoint: "因信稱義的主張",
    sourceAnchor: "人要相信上帝才可以得救",
  },
  {
    id: "q-reformation-trigger",
    sectionId: "topic-5-renaissance-reformation",
    questionType: "mc",
    difficulty: "advanced",
    question: "宗教改革的導火線是甚麼？",
    options: [
      "教會大規模販賣贖罪券",
      "君主拒絕向教會納稅",
      "大學紛紛成立",
      "美洲白銀大量流入歐洲",
    ],
    correctAnswer: "教會大規模販賣贖罪券",
    explanation:
      "1517年初，教會為籌建聖伯多祿大教堂而大量販售贖罪券，部分神職人員更誇大其功效，引發信徒不滿，成為宗教改革的導火線。",
    knowledgePoint: "宗教改革的導火線",
    sourceAnchor: "導火線：教會大規模販賣贖罪券",
  },
  {
    id: "q-reformation-protestant",
    sectionId: "topic-5-renaissance-reformation",
    questionType: "mc",
    difficulty: "advanced",
    question: "馬丁路德的主張最終促成甚麼結果？",
    options: [
      "出現脫離羅馬天主教會的新宗派，統稱為「新教教會」",
      "教宗權力進一步擴大",
      "歐洲各國重新統一於羅馬天主教會之下",
      "宗教改革運動隨即結束",
    ],
    correctAnswer: "出現脫離羅馬天主教會的新宗派，統稱為「新教教會」",
    explanation:
      "1521年教宗下令將馬丁路德逐出教會，但在德意志貴族與民眾支持下，逐漸形成獨立於羅馬天主教會的新宗派「路德宗」；「路德宗」、「歸正宗」、「聖公宗」等統稱為「新教教會」。",
    knowledgePoint: "新教教會的出現",
    sourceAnchor: "獨立於羅馬天主教會的新宗派",
  },
  /* ---------------- 宗教改革：影響 ---------------- */
  {
    id: "q-reformation-impact-war",
    sectionId: "topic-5-renaissance-reformation",
    questionType: "mc",
    difficulty: "basic",
    question: "以下哪一項是宗教改革帶來的影響？",
    options: [
      "引發衝突與戰爭",
      "令教宗的權力空前強大",
      "使歐洲人完全放棄宗教信仰",
      "使拉丁文成為歐洲唯一語言",
    ],
    correctAnswer: "引發衝突與戰爭",
    explanation:
      "宗教改革令歐洲基督宗教世界分裂為羅馬天主教與新教兩大陣營，歐洲國家爆發多次衝突，甚至戰爭（例如三十年戰爭）。",
    knowledgePoint: "宗教改革的影響：衝突與戰爭",
    sourceAnchor: "引發衝突與戰爭",
  },
  /* ---------------- 科學革命 ---------------- */
  {
    id: "q-science-society",
    sectionId: "topic-5-science-enlightenment",
    questionType: "mc",
    difficulty: "basic",
    question:
      "1660年代成立的「倫敦皇家自然知識促進學會」（即皇家學會）屬於以下哪一類組織？",
    options: ["科學研究團體", "羅馬天主教會的修會", "商人行會", "君主諮詢議會"],
    correctAnswer: "科學研究團體",
    explanation:
      "「倫敦皇家自然知識促進學會」及法國科學院等科學研究團體，鼓勵學者進行學術交流，共同推動科學發展。",
    knowledgePoint: "科學革命期間科學研究團體的成立",
    sourceAnchor: "倫敦皇家自然知識促進學會",
  },
  /* ---------------- 啟蒙運動 ---------------- */
  {
    id: "q-enlightenment-social-contract",
    sectionId: "topic-5-science-enlightenment",
    questionType: "mc",
    difficulty: "advanced",
    question: "啟蒙思想中的「社會契約」主張甚麼？",
    options: [
      "君主權力來自人民授予，雙方訂立契約界定權責",
      "君主由上帝授權統治，不必向人民負責",
      "人民必須無條件服從君主的絕對權力",
      "國家的權力應集中於單一機關",
    ],
    correctAnswer: "君主權力來自人民授予，雙方訂立契約界定權責",
    explanation:
      "社會契約主張人民與政府訂立契約，約定彼此的權利與義務；如果政府無法保障人民的天賦權利，人民有權推翻政府。",
    knowledgePoint: "啟蒙思想：社會契約",
    sourceAnchor: "社會契約：君主權力來自人民授予",
  },
  {
    id: "q-enlightenment-rights",
    sectionId: "topic-5-science-enlightenment",
    questionType: "fill",
    difficulty: "basic",
    question:
      "啟蒙思想認為人生而平等，擁有自由、生命與財產等基本權利；這些與生俱來、不容侵犯的權利稱為＿＿＿。",
    correctAnswer: "天賦權利",
    acceptedAnswers: ["天賦權利"],
    explanation:
      "啟蒙思想認為天賦權利與生俱來，並非由他人賜予，也不可被侵犯或剝奪。",
    knowledgePoint: "啟蒙思想：天賦權利",
    sourceAnchor: "天賦權利",
  },
  {
    id: "q-enlightenment-separation",
    sectionId: "topic-5-science-enlightenment",
    questionType: "mc",
    difficulty: "advanced",
    question: "啟蒙思想家提出「權力分立」的主要目的是甚麼？",
    options: [
      "防止權力過度集中",
      "加強君主的絕對權力",
      "由教會掌管司法權",
      "讓君主可以隨意修改法律",
    ],
    correctAnswer: "防止權力過度集中",
    explanation:
      "啟蒙思想主張把政府權力分為行政、立法與司法權，並由不同機關行使，以防止權力過度集中；同時以憲法限制君權，保障人民權利。",
    knowledgePoint: "啟蒙思想：權力分立與法律保障",
    sourceAnchor: "以防止權力過度集中",
  },
  /* ---------------- 工業革命：特點及出現原因 ---------------- */
  {
    id: "q-industrial-mechanisation",
    sectionId: "topic-5-industrial",
    questionType: "mc",
    difficulty: "basic",
    question: "工業革命的「機械化」特點是指甚麼？",
    options: [
      "機械逐步取代人力、畜力，成為生產的主要動力",
      "農民重新回到莊園耕作",
      "以人力為主的家庭手工業重新興起",
      "各國放棄使用蒸汽等新能源",
    ],
    correctAnswer: "機械逐步取代人力、畜力，成為生產的主要動力",
    explanation:
      "工業革命的特點包括機械化（機械取代人力、畜力成為主要生產動力）、工業化及城市化。",
    knowledgePoint: "工業革命的特點：機械化",
    sourceAnchor: "機械逐步取代人力、畜力等成為生產的主要動力",
  },
  {
    id: "q-industrial-causes",
    sectionId: "topic-5-industrial",
    questionType: "mc",
    difficulty: "advanced",
    question: "以下哪一項「不是」工業革命出現的原因？",
    options: ["歐洲君主頒布反工業法令", "人口增長", "世界貿易的擴展", "科學知識的應用"],
    correctAnswer: "歐洲君主頒布反工業法令",
    explanation:
      "工業革命出現的原因包括人口增長、世界貿易的擴展、歐洲商人的投資，以及科學知識的應用。",
    knowledgePoint: "工業革命出現的原因",
    sourceAnchor: "歐洲商人的投資",
  },

  /* ---------------- 工業革命：英國率先展開的原因 ---------------- */
  {
    id: "q-industrial-britain",
    sectionId: "topic-5-industrial",
    questionType: "mc",
    difficulty: "advanced",
    question: "以下哪一項是英國率先展開工業革命的原因？",
    options: [
      "英國本土蘊藏大量煤與鐵，並擁有多個殖民地",
      "英國政府禁止使用機器生產",
      "英國沒有海外市場，只能依賴內銷",
      "英國缺乏勞動力，需要引進外國工人",
    ],
    correctAnswer: "英國本土蘊藏大量煤與鐵，並擁有多個殖民地",
    explanation:
      "英國本土蘊藏大量煤與鐵等工業原料，加上擁有殖民地，提供廉價原料及龐大海外市場；圈地運動合法化亦為工業提供大量勞動力，政府又支持科技創新。",
    knowledgePoint: "英國率先展開工業革命的原因",
    sourceAnchor: "英國本土蘊藏大量煤與鐵，它們是重要的工業原料",
  },
  /* ---------------- 工業革命：主要發展 ---------------- */
  {
    id: "q-industrial-jenny",
    sectionId: "topic-5-industrial",
    questionType: "fill",
    difficulty: "basic",
    question: "工業革命期間，英國人發明「＿＿＿」（1764年），令紡織業的生產效率大幅提升。",
    correctAnswer: "珍妮紡紗機",
    acceptedAnswers: ["珍妮紡紗機", "珍妮機"],
    explanation:
      "重要發展包括珍妮紡紗機的發明（1764年）及動力織機的發明（1787年）；瓦特亦於1769年改良蒸汽機。",
    knowledgePoint: "工業革命的重要發明",
    sourceAnchor: "珍妮紡紗機的發明（1764年）",
  },
  {
    id: "q-industrial-watt",
    sectionId: "topic-5-industrial",
    questionType: "mc",
    difficulty: "basic",
    question: "十八世紀，英國人瓦特改良了甚麼機器，令蒸汽成為穩定可靠的新能源？",
    options: ["蒸汽機", "紡紗機", "電力傳輸系統", "蒸汽船"],
    correctAnswer: "蒸汽機",
    explanation:
      "瓦特改良蒸汽機後，蒸汽廣泛應用於紡織、採礦與運輸等領域，工業革命前期又被稱為「蒸汽時代」。",
    knowledgePoint: "瓦特改良蒸汽機",
    sourceAnchor: "瓦特改良蒸汽機",
  },
  {
    id: "q-industrial-factory-system",
    sectionId: "topic-5-industrial",
    questionType: "fill",
    difficulty: "advanced",
    question: "工業革命前，歐洲人主要在家中以人手及簡單工具生產，這種模式稱為「＿＿＿制度」。",
    correctAnswer: "家庭手工業",
    acceptedAnswers: ["家庭手工業", "家庭手工業制"],
    explanation:
      "這種生產模式稱為「家庭手工業制度」，工業革命期間逐漸被「工廠制度」取代。",
    knowledgePoint: "由家庭手工業到工廠制度",
    sourceAnchor: "這種生產模式稱為「家庭手工業制度」",
  },

  /* ---------------- 工業革命：影響 ---------------- */
  {
    id: "q-industrial-urbanisation",
    sectionId: "topic-5-industrial",
    questionType: "mc",
    difficulty: "basic",
    question: "工業革命期間的「城市化」是指甚麼？",
    options: [
      "城鎮人口持續上升，範圍不斷擴展",
      "大量城市人口遷回農村耕作",
      "所有城鎮被改建為工業廠房",
      "政府禁止農民遷入城市",
    ],
    correctAnswer: "城鎮人口持續上升，範圍不斷擴展",
    explanation:
      "工業革命期間，農民連同家人遷往工廠附近居住，促使工業城鎮興起，城鎮人口持續上升、範圍不斷擴展，形成「城市化」。",
    knowledgePoint: "工業革命與城市化",
    sourceAnchor: "城鎮人口持續上升，範圍亦不斷擴展",
  },
  {
    id: "q-industrial-gap",
    sectionId: "topic-5-industrial",
    questionType: "mc",
    difficulty: "advanced",
    question: "工業革命期間，資本主義盛行帶來了甚麼社會問題？",
    options: [
      "貧富懸殊日益嚴重",
      "所有工人都成為工廠擁有人",
      "社會階級界線完全消失",
      "生產資源由全民共同擁有",
    ],
    correctAnswer: "貧富懸殊日益嚴重",
    explanation:
      "資本主義容許少數資本家私人擁有大量生產資源，並藉此剝削工人階級以累積財富，令貧富懸殊日益嚴重；部分學者因此主張社會主義。",
    knowledgePoint: "工業革命與社會主義的提出",
    sourceAnchor: "貧富懸殊日益嚴重",
  },
  /* ---------------- 法國大革命：背景與成因 ---------------- */
  {
    id: "q-fr-estates",
    sectionId: "topic-5-french-revolution",
    questionType: "mc",
    difficulty: "basic",
    question: "法國大革命前，社會的「第三等級」是指甚麼人？",
    options: ["平民", "教士", "貴族", "王室成員"],
    correctAnswer: "平民",
    explanation:
      "十八世紀的法國社會分為三個等級：第一等級是教士，第二等級是貴族，第三等級是平民；第三等級約佔人口98%。",
    knowledgePoint: "法國大革命前的社會等級",
    sourceAnchor: "第三等級：平民",
  },
  {
    id: "q-fr-causes",
    sectionId: "topic-5-french-revolution",
    questionType: "mc",
    difficulty: "advanced",
    question: "以下哪一項「不是」法國大革命的成因？",
    options: [
      "法國在十八世紀已經實行民主選舉制度",
      "政治腐敗",
      "社會不平等",
      "財政困境",
    ],
    correctAnswer: "法國在十八世紀已經實行民主選舉制度",
    explanation:
      "法國大革命的成因包括政治腐敗、社會不平等、財政困境，以及啟蒙運動的影響及美國革命的鼓舞。",
    knowledgePoint: "法國大革命的成因",
    sourceAnchor: "革命的成因",
  },
  /* ---------------- 法國大革命：革命經過 ---------------- */
  {
    id: "q-fr-bastille",
    sectionId: "topic-5-french-revolution",
    questionType: "fill",
    difficulty: "basic",
    question: "1789年7月14日，巴黎民眾攻陷＿＿＿奪取武器，法國大革命正式爆發。",
    correctAnswer: "巴士底監獄",
    acceptedAnswers: ["巴士底監獄", "巴士底獄"],
    explanation: "巴士底監獄的陷落（1789年7月14日）標誌法國大革命正式爆發。",
    knowledgePoint: "法國大革命的爆發",
    sourceAnchor: "巴士底監獄的陷落（1789年7月14日）",
  },
  {
    id: "q-fr-estates-general",
    sectionId: "topic-5-french-revolution",
    questionType: "mc",
    difficulty: "advanced",
    question: "1789年5月路易十六召開三級會議，第三等級代表為甚麼退出會議？",
    options: [
      "第一與第二等級利用「每級一票」的投票方式否決稅制改革及「一人一票」的主張",
      "第三等級代表被國王提升為貴族",
      "第三等級代表同意國王的所有提案",
      "第一與第二等級自願放棄免稅特權",
    ],
    correctAnswer:
      "第一與第二等級利用「每級一票」的投票方式否決稅制改革及「一人一票」的主張",
    explanation:
      "會議中第一與第二等級利用「每級一票」的投票方式，聯手否決稅制改革及第三等級提出的「一人一票」新投票方式，第三等級代表為抗議不公而退出會議，另組「國民議會」。",
    knowledgePoint: "三級會議與國民議會",
    sourceAnchor: "聯手否決稅制改革",
  },

  /* ---------------- 拿破崙時代 ---------------- */
  {
    id: "q-fr-napoleon",
    sectionId: "topic-5-french-revolution",
    questionType: "mc",
    difficulty: "basic",
    question: "法國大革命之後，法國進入哪個時期？",
    options: ["拿破崙時代", "路易十四的黃金時代", "封建諸侯割據時期", "羅馬帝國統治時期"],
    correctAnswer: "拿破崙時代",
    explanation:
      "革命後的法國進入拿破崙時代，內容包括拿破崙的上台與改革，以及法蘭西第一帝國的建立與覆亡。",
    knowledgePoint: "革命後的法國：拿破崙時代",
    sourceAnchor: "革命後的法國：拿破崙時代",
  },

  /* ---------------- 法國大革命及拿破崙時代的影響 ---------------- */
  ];
