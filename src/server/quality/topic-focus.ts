/**
 * 課題「主題分配」的分類規則（純函式）。
 *
 * 背景：練習設定頁的「主題」＝課題下的分節。部分課題把整個課程壓在一個分節，
 * 學生想集中複習其中一段（例如第一次世界大戰、冷戰的某個階段）時，抽到的題目
 * 大部分屬其他時期（2026-10-22 用家回報）。
 *
 * 設計原則（fail-safe）：
 *   - 只做**確定性**字面比對，不呼叫模型。
 *   - 同時命中多個主題而分數相同 → 留在「綜合」主題，不猜測。
 *   - 題目同時提及兩個時期（例如兩次大戰、冷戰前後期）→ 留在「綜合」。
 *   - 標記為 `priority` 的主題命中即歸入（例如涉及猶太大屠殺的題目一律歸入種族滅絕）。
 *
 * 每個課題的方案（`TOPIC_FOCUS_PLANS`）由教師決定邊界；這支模組只負責把題目及
 * 教材段落歸類，並如實回報無法確定的項目。
 */

export interface FocusThemeTarget {
  /** 分類用的鍵，方案內必須唯一 */
  key: string;
  /** 目標分節 ID（`create: true` 時會在資料庫建立） */
  id: string;
  title: string;
  summary: string;
  /** 匯入教材時用來把段落／題目歸入此分節的關鍵詞（較短、較通用） */
  matchKeywords: string[];
  /** 判斷題目／段落屬於此主題的關鍵詞（較長、較具體）；「綜合」主題留空 */
  classifyKeywords: string[];
  sortOrder: number;
  /** false = 沿用既有分節（不建立，只更新標題及關鍵詞） */
  create: boolean;
  /** 命中即歸入，不理會其他主題（用於必須優先歸類的內容） */
  priority?: boolean;
}

export interface TopicFocusPlan {
  topicId: string;
  /** 主要來源分節（把所有題目混在一起的分節） */
  sourceSectionId: string;
  /** 其他來源分節（合併過細的主題時使用） */
  sourceSectionIds?: string[];
  /** 完成搬遷後刪除的分節（必須已無題目及教材段落） */
  removeEmptySectionIds?: string[];
  /** 無法確定時保留在原分節的主題鍵（該主題必須存在） */
  overviewKey: string;
  targets: FocusThemeTarget[];
  /** 題目同時提及兩者時視為跨時期比較，留在「綜合」 */
  crossPair?: { first: RegExp; second: RegExp };
  /** 其他既有分節的顯示次序（只調整 sort_order，不參與分類） */
  orderOverrides?: { id: string; sortOrder: number }[];
}

/** 方案內所有來源分節 */
export function focusSourceSectionIds(plan: TopicFocusPlan): string[] {
  return [...new Set([plan.sourceSectionId, ...(plan.sourceSectionIds ?? [])])];
}

export interface FocusClassification {
  /** 命中的主題鍵；null = 未能確定，留在「綜合」主題 */
  key: string | null;
  /** 各主題的關鍵詞命中數（供報告解釋判斷依據） */
  scores: Record<string, number>;
  /** 是否因多個主題同時命中而無法確定 */
  ambiguous: boolean;
}

/** 把文字分類到方案內的某個主題；無法確定時 `key` 為 null */
export function classifyFocusText(text: string, plan: TopicFocusPlan): FocusClassification {
  const haystack = text ?? "";
  const scores: Record<string, number> = {};
  for (const target of plan.targets) {
    if (target.classifyKeywords.length === 0) continue;
    const hits = target.classifyKeywords.filter((keyword) => haystack.includes(keyword)).length;
    if (hits > 0) scores[target.key] = hits;
  }

  const priority = plan.targets.find((target) => target.priority && (scores[target.key] ?? 0) > 0);
  if (priority) return { key: priority.key, scores, ambiguous: false };

  if (plan.crossPair && plan.crossPair.first.test(haystack) && plan.crossPair.second.test(haystack)) {
    return { key: null, scores, ambiguous: true };
  }

  const ranked = Object.entries(scores)
    .filter(([key]) => key !== plan.overviewKey)
    .sort((left, right) => right[1] - left[1]);

  if (ranked.length === 0) return { key: null, scores, ambiguous: false };
  if (ranked.length > 1 && ranked[0]![1] === ranked[1]![1]) {
    return { key: null, scores, ambiguous: true };
  }
  return { key: ranked[0]![0], scores, ambiguous: false };
}

/**
 * 題目分類：先看題幹、教材節錄及標準答案；都沒有命中時，才用知識點作後備。
 *
 * 標準答案納入判斷，是因為填充題常把關鍵詞挖空（「香港已是亞洲重要的＿＿＿」→
 * 「轉口港」），題幹本身不會出現該詞；答案本身就是題目意思的一部分。
 * 知識點（`knowledgePoint`）由匯入時所屬的教材小節產生，通常直接寫出主題
 * （例如「宗教改革的背景」「文藝復興的影響」），可以補回題幹沒有重複主題名稱的
 * 填充題。但知識點有時是章節標題（同時包含兩個主題），若一開始就納入會令大量題目
 * 變成「同時命中」而退回綜合主題，因此只在主要判斷完全沒有命中時才採用。
 *
 * 解釋（`explanation`）不納入：它經常同時提及前後時期。
 */
export function classifyQuestionFocus(
  input: {
    question: string;
    knowledgePoint?: string | null;
    sourceExcerpt?: string | null;
    correctAnswer?: string | null;
  },
  plan: TopicFocusPlan,
): FocusClassification {
  const primary = classifyFocusText(
    [input.question, input.sourceExcerpt ?? "", input.correctAnswer ?? ""].join(" "),
    plan,
  );
  if (primary.key !== null) return primary;

  const knowledgePoint = (input.knowledgePoint ?? "").trim();
  if (knowledgePoint.length === 0) return primary;

  // 知識點同時用作「平手時的裁判」：題幹同時命中兩個主題時，知識點（匯入時所屬的
  // 教材小節）通常只屬其中一個，足以打破平手；若知識點本身亦平手，維持「綜合」。
  const fallback = classifyFocusText(knowledgePoint, plan);
  if (fallback.key === null) return primary;
  return { ...fallback, scores: { ...primary.scores, ...fallback.scores } };
}

export interface FocusBlockInput {
  id: string;
  documentId: string;
  text: string;
  sortOrder: number;
}

export interface FocusBlockAssignment {
  id: string;
  documentId: string;
  /** 命中的主題鍵；null = 留在「綜合」 */
  key: string | null;
  /** 是否因段落本身沒有關鍵詞而沿用前一段的主題 */
  inherited: boolean;
  ambiguous: boolean;
}

/**
 * 教材段落分類：沒有命中關鍵詞的段落，沿用**同一文件內前一段**的主題。
 *
 * 筆記的標題（例如「大戰的結果」）及短段落本身不含時期關鍵詞，但上文已確立主題；
 * 若不沿用，這些段落會全部留在「綜合」主題，AI 以該主題出題時就不夠聚焦。
 * 同時命中多個主題的段落不會被沿用（避免把歧義擴散到後續段落）。
 */
export function assignFocusByDocumentOrder(
  blocks: FocusBlockInput[],
  plan: TopicFocusPlan,
): FocusBlockAssignment[] {
  const byDocument = new Map<string, FocusBlockInput[]>();
  for (const block of blocks) {
    const list = byDocument.get(block.documentId) ?? [];
    list.push(block);
    byDocument.set(block.documentId, list);
  }

  const assignments: FocusBlockAssignment[] = [];
  for (const list of byDocument.values()) {
    const ordered = [...list].sort((left, right) => left.sortOrder - right.sortOrder);
    let previous: string | null = null;
    for (const block of ordered) {
      const classification = classifyFocusText(block.text, plan);
      const carriesPrevious: boolean =
        classification.key === null && !classification.ambiguous && previous !== null;
      const key: string | null = carriesPrevious ? previous : classification.key;
      assignments.push({
        id: block.id,
        documentId: block.documentId,
        key,
        inherited: carriesPrevious,
        ambiguous: classification.ambiguous,
      });
      if (!classification.ambiguous) previous = key;
    }
  }
  return assignments;
}

/** 取得方案內某個主題鍵的目標設定；未能確定時回傳「綜合」主題 */
export function focusTargetFor(plan: TopicFocusPlan, key: string | null): FocusThemeTarget {
  const target = key === null ? undefined : plan.targets.find((item) => item.key === key);
  if (target) return target;
  return plan.targets.find((item) => item.key === plan.overviewKey)!;
}

/* ------------------------------------------------------------------ */
/* 課題方案                                                             */
/* ------------------------------------------------------------------ */

const WW1_MENTION = /(第一次世界大戰|一戰)/;
const WW2_MENTION = /(第二次世界大戰|二戰)/;

/**
 * 課題的主題分配方案。
 *
 * 只包含已由教師確認邊界的課題；未有方案的課題不會自動拆分
 * （`npm run plan:topic-focus -- --audit` 會列出所有過粗的主題）。
 */
export const TOPIC_FOCUS_PLANS: Record<string, TopicFocusPlan> = {
  "topic-9": {
    topicId: "topic-9",
    sourceSectionId: "topic-9-world-wars",
    overviewKey: "overview",
    crossPair: { first: WW1_MENTION, second: WW2_MENTION },
    targets: [
      {
        key: "ww1",
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
        classifyKeywords: [
          "第一次世界大戰",
          "一戰",
          "1914",
          "1915",
          "1916",
          "1917",
          "1918",
          "塞拉耶佛",
          "巴爾幹",
          "三國同盟",
          "三國協約",
          "施里芬",
          "壕溝",
          "無畏艦",
          "軍備競賽",
          "普法戰爭",
          "極端民族主義",
          "泛日耳曼",
          "斯拉夫",
          "同盟制度",
          "民族主義",
          "殖民競爭",
          "動員",
        ],
        sortOrder: 0,
        create: true,
      },
      {
        key: "interwar",
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
        classifyKeywords: [
          "巴黎和會",
          "凡爾賽",
          "威瑪",
          "經濟大衰退",
          "經濟大蕭條",
          "1929",
          "1930年代",
          "極權",
          "納粹",
          "法西斯",
          "希特拉",
          "墨索里尼",
          "綏靖",
          "軸心國",
          "國際聯盟",
          "國聯",
          "集體安全",
          "孤立主義",
          "慕尼黑",
          "萊茵",
          "西班牙內戰",
          "民族自決",
          "裁軍",
          "共產國際",
        ],
        sortOrder: 1,
        create: true,
      },
      {
        key: "ww2",
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
        classifyKeywords: [
          "第二次世界大戰",
          "二戰",
          "1939",
          "1940",
          "1941",
          "1942",
          "1943",
          "1944",
          "1945",
          "珍珠港",
          "諾曼第",
          "廣島",
          "長崎",
          "斯大林格勒",
          "閃電戰",
          "不列顛空戰",
          "雅爾塔",
          "波茨坦",
          "原子彈",
          "軸心國投降",
        ],
        sortOrder: 2,
        create: true,
      },
      {
        key: "overview",
        id: "topic-9-world-wars",
        title: "兩次世界大戰的關聯與比較",
        summary:
          "兩次世界大戰之間的關聯、整體影響，以及需要同時比較兩次大戰的題目（未能歸入單一時期者亦保留於此）。",
        matchKeywords: ["兩次世界大戰", "兩次大戰", "關聯", "比較"],
        classifyKeywords: [],
        sortOrder: 3,
        create: false,
      },
      {
        key: "holocaust",
        id: "topic-9-holocaust",
        title: "種族滅絕：二戰期間的「猶太大屠殺」",
        summary:
          "種族滅絕的定義、反猶太主義的由來、納粹黨敵視猶太人的原因、對猶太人的迫害與大屠殺，以及戰後國際社會的審訊與反省。",
        matchKeywords: [
          "種族滅絕",
          "猶太大屠殺",
          "反猶太主義",
          "集中營",
          "奧斯維辛",
          "紐倫堡審判",
        ],
        classifyKeywords: [
          "猶太",
          "種族滅絕",
          "集中營",
          "反猶",
          "水晶之夜",
          "紐倫堡",
          "萬湖",
          "奧斯維辛",
          "大屠殺",
          "最後解決",
        ],
        sortOrder: 4,
        create: false,
        priority: true,
      },
    ],
  },
  "topic-5": {
    topicId: "topic-5",
    sourceSectionId: "topic-5-renaissance-reformation",
    overviewKey: "overview",
    targets: [
      {
        key: "renaissance",
        id: "topic-5-renaissance",
        title: "文藝復興（十四至十七世紀）",
        summary:
          "文藝復興的起源與發展、人文主義的主要特點、出現原因，以及對歐洲藝術、學術與歷史發展的影響。",
        matchKeywords: ["文藝復興", "人文主義", "起源與發展", "主要特點", "文藝復興的影響"],
        classifyKeywords: [
          "文藝復興",
          "人文主義",
          "人文學者",
          "彼特拉克",
          "薄伽丘",
          "薄伽邱",
          "達文西",
          "米開朗基羅",
          "米開蘭基羅",
          "拉斐爾",
          "馬基雅維利",
          "莎士比亞",
          "贊助",
          "佛羅倫斯",
          "義大利半島",
          "意大利半島",
          "十四至十七世紀",
          "十字軍東征",
          "城邦",
          "貿易樞紐",
          "世俗生活",
          "黑死病",
          "封建社會",
          "中古時代後期",
          "以人為本",
          "人本",
        ],
        sortOrder: 0,
        create: true,
      },
      {
        key: "reformation",
        id: "topic-5-reformation",
        title: "宗教改革（十六至十七世紀）",
        summary:
          "宗教改革的背景與發展、馬丁路德及其他改革者、新教教派的形成，以及宗教改革對歐洲政治、社會與文化的影響。",
        matchKeywords: ["宗教改革", "新教", "馬丁路德", "反宗教改革"],
        classifyKeywords: [
          "宗教改革",
          "馬丁路德",
          "路德",
          "加爾文",
          "喀爾文",
          "新教",
          "贖罪券",
          "九十五條",
          "亨利八世",
          "英國國教",
          "反宗教改革",
          "耶穌會",
          "特倫多",
          "天主教會",
        ],
        sortOrder: 1,
        create: true,
      },
      {
        key: "science",
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
        classifyKeywords: [
          "科學革命",
          "啟蒙運動",
          "哥白尼",
          "伽利略",
          "牛頓",
          "維塞利亞斯",
          "哈維",
          "日心說",
          "地心說",
          "萬有引力",
          "望遠鏡",
          "伏爾泰",
          "孟德斯鳩",
          "盧梭",
          "洛克",
          "三權分立",
          "權力分立",
          "社會契約",
          "天賦權利",
          "皇家學會",
          "血液循環",
          "啟蒙思想",
          "專制君主",
          "理性",
          "百科全書",
        ],
        sortOrder: 3,
        create: false,
      },
      {
        key: "overview",
        id: "topic-5-renaissance-reformation",
        title: "文藝復興與宗教改革：綜合與比較",
        summary:
          "同時涉及文藝復興與宗教改革的題目，以及未能歸入單一主題、需教師覆核的題目（例如中古後期的背景）。",
        matchKeywords: ["文藝復興與宗教改革", "從神本走向人本"],
        classifyKeywords: [],
        sortOrder: 2,
        create: false,
      },
    ],
    orderOverrides: [
      { id: "topic-5-science-enlightenment", sortOrder: 3 },
      { id: "topic-5-industrial", sortOrder: 4 },
      { id: "topic-5-french-revolution", sortOrder: 5 },
    ],
  },
  "topic-10": {
    topicId: "topic-10",
    sourceSectionId: "topic-10-coldwar-development",
    overviewKey: "overview",
    crossPair: {
      first: /(初期緊張|鐵幕|杜魯門|馬歇爾|柏林封鎖|北約|韓戰)/,
      second: /(解凍|緩和|古巴導彈|越戰|阿富汗)/,
    },
    targets: [
      {
        key: "early",
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
        classifyKeywords: [
          "鐵幕",
          "杜魯門",
          "馬歇爾",
          "柏林封鎖",
          "空運",
          "北約",
          "韓戰",
          "1946",
          "1947",
          "1948",
          "1949",
          "1950",
          "1951",
          "1952",
          "1953",
          "原子彈",
          "衛星國",
          "佔領區",
          "波茨坦",
          "西德",
          "東德",
          "朝鮮",
          "韓國",
          "金日成",
          "朝鮮戰爭",
          "東南亞條約",
          "遏制",
          "經濟援助",
          "冷戰對手",
          "中華人民共和國",
        ],
        sortOrder: 1,
        create: true,
      },
      {
        key: "middle",
        id: "topic-10-coldwar-middle",
        title: "冷戰的起伏：解凍、危機與緩和（1953–1979）",
        summary:
          "史太林去世後的短暫緩和、柏林圍牆與古巴導彈危機、越戰，以及1970年代的緩和（乒乓外交、尼克遜訪華）。",
        matchKeywords: ["冷戰解凍", "古巴導彈危機", "越戰", "冷戰緩和", "乒乓外交"],
        classifyKeywords: [
          "解凍",
          "史太林",
          "日內瓦",
          "匈牙利",
          "柏林圍牆",
          "古巴導彈",
          "越戰",
          "越南",
          "緩和",
          "乒乓",
          "尼克遜",
          "赫爾辛基",
          "赫魯曉夫",
          "艾森豪威爾",
          "U-2",
          "高峰會",
          "導彈",
          "和平共存",
          "共存",
          "太空",
          "1955",
          "1956",
          "1957",
          "1958",
          "1959",
          "1960",
          "1961",
          "1962",
          "1963",
          "1964",
          "1965",
          "1966",
          "1967",
          "1968",
          "1969",
          "1970",
          "1971",
          "1972",
          "1975",
        ],
        sortOrder: 2,
        create: true,
      },
      {
        key: "late",
        id: "topic-10-coldwar-late",
        title: "冷戰再度加劇（1979–1985）",
        summary:
          "蘇聯入侵阿富汗、美蘇軍備競賽與「星戰計劃」，以及1980年代初期美蘇關係的再次緊張。",
        matchKeywords: ["冷戰再度加劇", "蘇聯入侵阿富汗", "軍備競賽", "星戰計劃"],
        classifyKeywords: [
          "阿富汗",
          "軍備競賽",
          "星戰",
          "戰略防禦",
          "列根",
          "1980",
          "1981",
          "1982",
          "1983",
          "1984",
          "1985",
        ],
        sortOrder: 3,
        create: true,
      },
      {
        key: "overview",
        id: "topic-10-coldwar-development",
        title: "冷戰的發展：跨階段比較",
        summary:
          "同時涉及冷戰多個階段（例如由初期對抗到緩和再到再度加劇）的題目，以及未能歸入單一階段者。",
        matchKeywords: ["冷戰的主要發展", "冷戰的發展", "跨階段"],
        classifyKeywords: [],
        sortOrder: 6,
        create: false,
      },
    ],
    orderOverrides: [
      { id: "topic-10-coldwar-background", sortOrder: 0 },
      { id: "topic-10-coldwar-end", sortOrder: 4 },
      { id: "topic-10-post-coldwar", sortOrder: 5 },
    ],
  },
  "topic-7": {
    topicId: "topic-7",
    sourceSectionId: "topic-7-revolution",
    // 兩個過細的主題（各 9 題）合併為「十九世紀的美國」
    sourceSectionIds: ["topic-7-expansion", "topic-7-civil-war"],
    removeEmptySectionIds: ["topic-7-expansion", "topic-7-civil-war"],
    overviewKey: "overview",
    targets: [
      {
        key: "revolution",
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
        classifyKeywords: [
          "美國革命",
          "獨立宣言",
          "獨立戰爭",
          "波士頓",
          "傾茶",
          "印花稅",
          "茶稅",
          "1775",
          "1776",
          "1777",
          "1778",
          "1781",
          "1783",
          "華盛頓",
          "大陸會議",
          "列剋星敦",
          "殖民地",
          "母國",
        ],
        sortOrder: 0,
        create: true,
      },
      {
        key: "constitution",
        id: "topic-7-constitution",
        title: "美國憲法與政治體制",
        summary:
          "1787年制憲、三權分立的聯邦制度、國會與總統的職權，以及《權利法案》。",
        matchKeywords: ["十八世紀末美國的政治體制與憲法", "行政機關", "憲法", "三權分立"],
        classifyKeywords: [
          "憲法",
          "制憲",
          "三權分立",
          "國會",
          "總統",
          "最高法院",
          "聯邦",
          "1787",
          "1789",
          "權利法案",
          "選舉人",
          "行政機關",
          "立法",
          "司法",
        ],
        sortOrder: 1,
        create: true,
      },
      {
        key: "nineteenth",
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
        classifyKeywords: [
          "領土拓展",
          "西進",
          "移民",
          "華工",
          "華人勞工",
          "鐵路",
          "加利福尼亞",
          "德克薩斯",
          "路易斯安那",
          "南北內戰",
          "內戰",
          "林肯",
          "1861",
          "1865",
          "奴隸",
          "莊園",
          "南方",
          "北方",
          "重建",
          "堪薩斯",
          "門羅主義",
          "關稅",
          "佛羅里達",
          "德克薩斯",
          "阿拉斯加",
          "加州",
          "華人歧視",
          "外交方針",
          "購地",
          "版圖",
          "民兵",
          "地方議會",
          "1823",
          "1845",
          "1848",
          "1867",
        ],
        sortOrder: 2,
        create: true,
      },
      {
        key: "overview",
        id: "topic-7-revolution",
        title: "美國革命與建國：綜合與比較",
        summary:
          "同時涉及革命、憲法及十九世紀發展的題目，以及未能歸入單一主題、需教師覆核者。",
        matchKeywords: ["美國革命的內外因素及影響", "美國革命與建國"],
        classifyKeywords: [],
        sortOrder: 3,
        create: false,
      },
    ],
  },
  "topic-12": {
    topicId: "topic-12",
    sourceSectionId: "topic-12-pre-war",
    overviewKey: "overview",
    targets: [
      {
        key: "economy",
        id: "topic-12-pre-war-economy",
        title: "戰前香港的經濟發展",
        summary:
          "第二次世界大戰前香港的轉口貿易、工業與金融發展，以及經濟發展帶來的社會變化。",
        matchKeywords: ["戰前的經濟發展", "戰前經濟", "轉口貿易", "經濟發展"],
        classifyKeywords: [
          "經濟",
          "貿易",
          "轉口",
          "工業",
          "銀行",
          "航運",
          "百貨",
          "商會",
          "工廠",
          "港口",
          "鴉片",
          "關稅",
          "轉口港",
          "英聯邦",
          "製造",
          "罐頭",
          "醬油",
          "廠",
          "壟斷",
          "船塢",
        ],
        sortOrder: 0,
        create: true,
      },
      {
        key: "chinese",
        id: "topic-12-pre-war-chinese",
        title: "戰前華人的崛起及其角色",
        summary:
          "戰前華人在經濟與社會上的崛起、華資企業及社團（東華三院、保良局等）的角色，以及他們面對的歧視與爭取。",
        matchKeywords: ["戰前華人的崛起及其角色", "華人崛起", "華資", "東華三院", "保良局"],
        classifyKeywords: [
          "華人",
          "華資",
          "東華",
          "保良",
          "何東",
          "種族",
          "平等待遇",
          "華民政務司",
          "歧視",
          "地位",
          "罷工",
          "工會",
          "非官守議員",
          "同鄉",
          "互助",
          "街坊",
          "何啟",
        ],
        sortOrder: 1,
        create: true,
      },
      {
        key: "overview",
        id: "topic-12-pre-war",
        title: "第二次世界大戰前的香港：綜合",
        summary:
          "同時涉及戰前經濟與華人社會的題目，以及未能歸入單一主題、需教師覆核者。",
        matchKeywords: ["第二次世界大戰前的香港", "戰前"],
        classifyKeywords: [],
        sortOrder: 2,
        create: false,
      },
    ],
    orderOverrides: [
      { id: "topic-12-japanese-occupation", sortOrder: 3 },
      { id: "topic-12-post-war", sortOrder: 4 },
      { id: "topic-12-reunification", sortOrder: 5 },
    ],
  },
  "topic-6": {
    topicId: "topic-6",
    sourceSectionId: "topic-6-causes",
    overviewKey: "overview",
    targets: [
      {
        key: "early",
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
        classifyKeywords: [
          "十六世紀",
          "十七世紀",
          "十八世紀",
          "十五世紀",
          "新航路",
          "哥倫布",
          "達伽馬",
          "麥哲倫",
          "航海",
          "香料",
          "黃金",
          "白銀",
          "傳教",
          "早期擴張",
          "重商主義",
          "東印度公司",
        ],
        sortOrder: 0,
        create: true,
      },
      {
        key: "late",
        id: "topic-6-late-expansion",
        title: "後期殖民擴張（十九至二十世紀）",
        summary:
          "十九世紀末至二十世紀初歐洲國家瓜分非洲及亞洲的背景及原因：工業革命、帝國主義、原料與市場的需要。",
        matchKeywords: [
          "歐洲國家後期擴張（十九世紀末至二十世紀初）的背景及原因",
          "後期擴張",
          "白人的負擔",
        ],
        classifyKeywords: [
          "十九世紀",
          "二十世紀",
          "工業革命",
          "帝國主義",
          "瓜分",
          "非洲",
          "原料",
          "市場",
          "資本",
          "後期擴張",
          "白人的負擔",
          "民族主義",
          "柏林會議",
        ],
        sortOrder: 1,
        create: true,
      },
      {
        key: "overview",
        id: "topic-6-causes",
        title: "歐洲殖民擴張的原因：綜合",
        summary:
          "同時涉及早期與後期擴張的題目，以及未能歸入單一時期、需教師覆核者。",
        matchKeywords: ["歐洲殖民擴張的原因", "歐洲國家擴張的原因"],
        classifyKeywords: [],
        sortOrder: 2,
        create: false,
      },
      {
        key: "methods",
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
        classifyKeywords: [
          "據點",
          "果亞",
          "休達",
          "專營權",
          "勢力範圍",
          "保護國",
          "殖民地",
          "殖民政策",
          "對歐洲的影響",
          "對美、亞、非三洲",
          "社會及文化",
        ],
        sortOrder: 3,
        create: false,
      },
    ],
    orderOverrides: [],
  },
  "topic-2": {
    topicId: "topic-2",
    sourceSectionId: "topic-2-classical-intro",
    overviewKey: "overview",
    targets: [
      {
        key: "greece",
        id: "topic-2-ancient-greece",
        title: "古希臘文明",
        summary:
          "古希臘的地理環境、城邦政治（雅典民主與斯巴達寡頭政治），以及希臘的文化成就與影響。",
        matchKeywords: ["古希臘文明", "古希臘的地理環境", "斯巴達", "雅典民主政治", "城邦"],
        classifyKeywords: [
          "古希臘",
          "希臘",
          "雅典",
          "斯巴達",
          "城邦",
          "民主政治",
          "寡頭",
          "波斯",
          "亞歷山大",
          "奧林匹克",
          "愛奧尼亞",
          "帕特農",
        ],
        sortOrder: 0,
        create: true,
      },
      {
        key: "rome",
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
        classifyKeywords: [
          "古羅馬",
          "羅馬",
          "共和",
          "元首制",
          "帝國",
          "凱撒",
          "元老院",
          "執政官",
          "十二銅表",
          "拉丁",
          "拜占庭",
          "東羅馬",
          "西羅馬",
          "君士坦丁",
        ],
        sortOrder: 1,
        create: true,
      },
      {
        key: "overview",
        id: "topic-2-classical-intro",
        title: "古典文明的介紹（概論與綜合）",
        summary:
          "歐洲歷史時期的劃分、早期文明概況，以及同時涉及古希臘與古羅馬的題目（未能歸入單一主題者亦保留於此）。",
        matchKeywords: ["古典文明的介紹", "歐洲歷史時期的劃分", "歐洲的早期文明", "古典文明"],
        classifyKeywords: [],
        sortOrder: 2,
        create: false,
      },
      {
        key: "medieval",
        id: "topic-2-medieval-europe",
        title: "中古時代的歐洲與基督宗教世界的形成",
        summary:
          "西羅馬帝國滅亡後歐洲的轉變、基督宗教世界的形成、封建社會的特徵，以及中古時代的遺產與結束。",
        matchKeywords: [
          "中古時代的歐洲與基督宗教世界的形成",
          "基督宗教世界的形成",
          "封建社會的出現及其特徵",
          "中古時代的結束",
          "中古時代",
        ],
        classifyKeywords: [
          "封建",
          "領主",
          "附庸",
          "莊園",
          "大憲章",
          "中古時代",
          "基督宗教",
          "教會",
          "城鎮",
          "行會",
          "1453",
        ],
        sortOrder: 4,
        create: false,
      },
    ],
    orderOverrides: [{ id: "topic-2-classical-legacy", sortOrder: 3 }],
  },
};
