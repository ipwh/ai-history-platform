/**
 * 填充題答案的「歷史元素」檢查。
 *
 * 為甚麼需要：填充題的答案必須是**有歷史意義的元素**——著名歷史事件名稱、人物、年份、
 * 國家、地點、條約、神祇、思想、政治制度等。若答案是普通詞語、形容詞或教材的欄位名稱
 * （例如「重要」、「背景」、「生活方式」、「展開時間」、「為生方法」），學生無從得知
 * 要填寫甚麼，題目亦沒有教學價值。
 *
 * 實際觀察（2026-10-15，以正式環境 96 個分節的教材執行本地示範生成）：未加檢查前，
 * 「為生方法」、「游獵生活」、「定居與建房」、「技術改良與文化發展」、「展開時間」、
 * 「時代特徵」、「出現的自然條件」這類答案會大量出現——它們全部來自教材大綱的
 * 「標籤：說明」句式，標籤本身只是欄位名稱而不是史事。
 *
 * 判斷方式（偏向嚴格）：
 *   1. **明顯不合格**（`support = "disallowed"`）：答案是說明句、形容詞，或由通用欄位詞
 *      組成，例如「出現的自然條件」、「定居與建房」、「為生方法」。
 *   2. **未能確認**（`support = "uncertain"`）：沒有跡象顯示答案是歷史元素，也沒有
 *      明顯不合格之處——名單及詞尾不可能窮盡所有專有名詞（例如「石刻」）。
 *   3. **正面確認**（`support = "supported"`）：年份、制度／條約／事件詞尾、地名、
 *      人物敘述，或教材在同一句內明確交代其歷史意義的發明與器物（例如工業革命單元
 *      的「蒸汽機」）。
 *
 * **填充題採用 fail-closed**：只有 `supported` 可以接受，`disallowed` 及 `uncertain`
 * 一律丟棄（見 validation.ts 的填充題關卡）。三者仍然分開回報，令丟棄原因如實反映
 * 信心，而不是把所有失敗都說成「明顯錯誤」。
 *
 * 限制（必須如實說明）：這是**模式比對，不是內容理解**。它只可以令題目減少（少出一題），
 * 不可當成「答案一定是歷史元素」的證明；教師仍是最終把關者。
 */

export interface HistoricalAnswerCheck {
  /** 答案是否**正面**確認為具有歷史意義的元素（support === "supported"） */
  ok: boolean;
  /** 不合格時的原因（繁體中文，供教師核對清單及伺服器日誌顯示） */
  reason: string | null;
  /**
   * 不合格的信心：
   * true = 明顯不合格（答案是說明、形容詞或通用欄位名稱），應丟棄或略過該題；
   * false = 只是找不到歷史元素標記，可能誤判，只應標示警告交由教師核對。
   */
  definite: boolean;
  /**
   * 三分法結果（Sprint 7.4）：
   *   - `supported`：有正面證據（年份、詞尾、地名、人物、教材語境支持等），可接受；
   *   - `disallowed`：明顯不是歷史元素（說明句、形容詞、通用欄位詞）；
   *   - `uncertain`：找不到證據，但也無法斷定不合格。
   *
   * **填充題必須 fail-closed**：`uncertain` 一樣不可接受（見 validation.ts）。
   * 保留 `uncertain` 與 `disallowed` 的分別，是為了令丟棄原因如實反映信心，
   * 而不是把所有失敗都說成「明顯錯誤」。
   */
  support: HistoricalAnswerSupport;
}

/** 填充題答案的合格程度（見 HistoricalAnswerCheck.support） */
export type HistoricalAnswerSupport = "supported" | "disallowed" | "uncertain";

/** 答案長度上限：超過此長度多數是完整句子，而不是一個歷史元素 */
const MAX_ANSWER_LENGTH = 16;

/** 最短長度：單字答案（例如「北」、「三」）不足以構成可供辨認的歷史元素 */
const MIN_ANSWER_LENGTH = 2;

/**
 * 說明性或形容詞字詞：出現即代表答案是一句說明或描述，而不是一個歷史元素。
 * 例如「出現的自然條件」、「學會生存智慧」、「定居與建房」、「多種政治制度並行」。
 * 刻意不收錄「影響」、「發展」等名詞，那些由通用欄位詞判斷處理，避免誤殺「工業革命」。
 */
const DESCRIPTIVE_PATTERN =
  /的|是|｜|（|\(|(學會|變得|成為|出現|開始|能夠|可以|必須|應該|促進|提高|減少|降低|改善|導致|造成|帶來|躍居|引致|迫使|促使|掀起|進而|從而|得以|進行|使用|採取|推行|實施|展開|不斷|持續|大幅|明顯|嚴重|十分|非常|愈來愈|越來越|多種|各種|不同|相同|主要|重要|並行|相關|相繼|互相|簡稱|之父|之母)/;

/**
 * 通用欄位詞：教材以「標籤：說明」列出重點時，標籤往往只是欄位名稱。
 * 答案若由這些詞語組成（例如「為生方法」＝為生＋方法、「技術改良與文化發展」），
 * 代表它只是欄位名稱而不是史事。
 */
const GENERIC_COLUMN_WORDS = [
  "方法",
  "生活",
  "時間",
  "特徵",
  "特點",
  "特色",
  "情況",
  "狀況",
  "問題",
  "變化",
  "關係",
  "影響",
  "原因",
  "背景",
  "結果",
  "目的",
  "內容",
  "經過",
  "過程",
  "措施",
  "方式",
  "條件",
  "規模",
  "效率",
  "功能",
  "用途",
  "種類",
  "程度",
  "步驟",
  "概況",
  "概覽",
  "簡介",
  "介紹",
  "總結",
  "小結",
  "前言",
  "引言",
  "概說",
  "要點",
  "重點",
  "發展",
  "生產",
  "技術",
  "改良",
  "演變",
  "興起",
  "衰落",
  "為生",
  "建房",
  "定居",
  "游獵",
  "遷徙",
  "前期",
  "中期",
  "後期",
  "早期",
  "晚期",
  "標誌",
  "常見",
  "經典",
  "信徒",
  "宗教",
  "文化",
  "藝術",
  "科學",
  "經濟",
  "社會",
  "政治",
  "軍事",
  "教育",
  "農業",
  "工業",
  "商業",
  "貿易",
  "時代",
  "世紀",
  "時期",
];

/** 連接詞：把通用欄位詞組成答案（例如「定居與建房」） */
const JOINER_PATTERN = /[與及和、]/g;

/** 年份、世紀及年代（答案為時間元素） */
const YEAR_PATTERN =
  /(?:\d{1,3}(?:[,，]\d{3})*|\d{3,4})\s*年|公元前|公元|[一二三四五六七八九十百千]{1,4}\s*世紀|\d{1,4}\s*年代/;

/** 條約、文件、制度、思想及事件的詞尾（答案須長於詞尾，見 endsWithSuffix） */
const INSTITUTION_SUFFIXES = [
  "條約",
  "專條",
  "公約",
  "宣言",
  "憲章",
  "協定",
  "議定書",
  "法典",
  "法案",
  "法令",
  "條例",
  "計劃",
  "計畫",
  "聲明",
  "組織",
  "聯盟",
  "會議",
  "王朝",
  "帝國",
  "王國",
  "公國",
  "城邦",
  "共和國",
  "文明",
  "制度",
  "主義",
  "立憲",
  "憲政",
  "政體",
  "共和",
  "運動",
  "革命",
  "戰爭",
  "戰役",
  "改革",
  "政策",
  "學說",
  "復興",
  "宗教",
  "教派",
  "時代",
  "時期",
  "朝代",
  "化",
  "黨",
  "法",
  "制",
];

/** 國家、地區、城市及地形的詞尾 */
const PLACE_SUFFIXES = ["國", "洲", "半島", "群島", "島", "山脈", "河", "海", "湖", "城", "港", "地區", "大陸"];

/**
 * 政府機構、管治組織及官職的詞尾（例如「元老院」、「公民大會」、「平民護民官」）。
 * 這類機構名稱是歷史科常見的填充題答案，沒有固定的專有名詞詞尾，
 * 因此以機構通用詞尾辨認（見試點報告：真實模型曾以「元老院」為答案而被誤拒）。
 */
const BODY_SUFFIXES = [
  "院",
  "議會",
  "國會",
  "內閣",
  "委員會",
  "理事會",
  "大會",
  "法庭",
  "法院",
  "政府",
  "王室",
  "朝廷",
  "教廷",
  "同盟",
  "公會",
  "行會",
  "聯邦",
  "執政官",
  "政官",
  "護民官",
  "民官",
];

/** 思想、主義及原則的詞尾（例如「民族自決」、「天賦權利」） */
const PRINCIPLE_SUFFIXES = [
  "主義",
  "思想",
  "學說",
  "理念",
  "原則",
  "精神",
  "自決",
  "權利",
  "自由",
  "平等",
];

/** 常見的國家、地區、城市及古文明名稱（沒有固定詞尾） */
const PLACE_NAMES = new Set([
  "英國",
  "中國",
  "法國",
  "德國",
  "美國",
  "日本",
  "香港",
  "九龍",
  "新界",
  "埃及",
  "羅馬",
  "希臘",
  "雅典",
  "斯巴達",
  "波斯",
  "印度",
  "蘇聯",
  "俄國",
  "義大利",
  "西班牙",
  "葡萄牙",
  "荷蘭",
  "奧地利",
  "匈牙利",
  "土耳其",
  "波蘭",
  "越南",
  "朝鮮",
  "韓國",
  "臺灣",
  "巴比倫",
  "亞述",
  "腓尼基",
  "以色列",
  "猶太",
  "美索不達米亞",
  "兩河流域",
  "尼羅河",
  "地中海",
  "大西洋",
  "太平洋",
  "古希臘",
  "古羅馬",
  "古埃及",
  "古印度",
  "古巴比倫",
  "日內瓦",
  "凡爾賽",
  "巴黎",
  "倫敦",
  "柏林",
  "莫斯科",
  "華盛頓",
  "北京",
  "上海",
  "廣州",
  "澳門",
  "長安",
  "洛陽",
]);

/** 人物稱謂詞尾 */
const PERSON_TITLE_SUFFIXES = [
  "皇帝",
  "國王",
  "女王",
  "女皇",
  "大帝",
  "總統",
  "首相",
  "主席",
  "總理",
  "將軍",
  "元帥",
  "法老",
  "可汗",
  "教宗",
  "教皇",
  "神學家",
  "思想家",
  "科學家",
  "發明家",
  "航海家",
  "探險家",
  "政治家",
  "哲學家",
  "文學家",
  "藝術家",
];

/** 人物常見行為動詞：教材中以「某人＋動詞」敘述時，答案多數是人物姓名 */
const PERSON_ACTION_VERBS =
  "提出|發表|發明|創立|創辦|創建|設立|領導|率領|發現|主張|推行|撰寫|編寫|頒布|下令|統治|在位|逝世|生於|出生|認為|指出|改革|宣稱|征服|抨擊|批判|質疑|改良|成功";

/** 神祇 */
const DEITY_SUFFIX = /(神|女神|神祇)$/;
const DEITY_NAMES = new Set([
  "宙斯",
  "阿波羅",
  "雅典娜",
  "波塞頓",
  "赫拉",
  "阿蒙",
  "荷魯斯",
  "奧西里斯",
  "濕婆",
  "毗濕奴",
  "梵天",
  "安拉",
  "耶和華",
  "天主",
  "上帝",
]);

/** 歷史時期名稱（沒有固定詞尾，例如「古代」、「中古」、「史前」） */
const PERIOD_NAMES = new Set(["古代", "上古", "中古", "中世紀", "近代", "現代", "當代", "史前", "信史"]);

/**
 * 發明、器物及技術的詞尾。這類答案**不能**單憑詞尾通過：必須同時在教材原文中出現，
 * 且同一句內有明示其歷史意義的用語（見 `SIGNIFICANCE_CUES`）。原因是發明與器物
 * 是否具有歷史意義取決於語境（例如「蒸汽機」在工業革命單元是關鍵發明，
 * 但在其他語境可能只是隨手提及的器物）。教材沒有支持時一律當作「未能確認」。
 */
const TECHNOLOGY_SUFFIXES = [
  "機",
  "器",
  "車",
  "船",
  "槍",
  "炮",
  "砲",
  "箭",
  "刀",
  "劍",
  "農具",
  "工具",
  "印刷術",
  "造紙術",
  "鐵路",
  "運河",
  "文字",
];

/**
 * 教材中明示「這項技術／事物改變了歷史」的用語。只有在**同一句**同時提及該答案及
 * 其中一個用語時，才可認定教材已交代其歷史意義；單純提及其名稱並不足夠。
 */
const SIGNIFICANCE_CUES = [
  "發明",
  "革新",
  "改良",
  "革命",
  "改變",
  "開創",
  "奠定",
  "普及",
  "廣泛應用",
  "取代",
  "帶動",
  "推動",
  "促進",
  "大幅",
  "大大",
  "提升",
  "提高",
  "轉捩點",
  "里程碑",
];

/** 詞尾標記：答案必須長於詞尾本身，避免「制度」、「時代」等單獨成詞時被當作專有名詞 */
function endsWithSuffix(answer: string, suffixes: string[]): boolean {
  return suffixes.some((suffix) => answer.length > suffix.length && answer.endsWith(suffix));
}

/** 教材是否以「人名＋行為動詞」提及這個詞語（例如「馬丁路德發表《九十五條論證》」） */
function isPersonNameInMaterial(materialText: string, answer: string): boolean {
  if (materialText.length === 0) return false;
  const escaped = answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}(?=${PERSON_ACTION_VERBS})`).test(materialText);
}

/**
 * 答案是否為**教材有提及**的文件／條約／著作名稱。
 *
 * 這裡要求兩項條件同時成立：模型把答案寫成《》標題（代表它自稱是文件名稱），
 * 而且該名稱確實見於教材原文。單靠引號本身**不足夠**——引號只代表教材有提及，
 * 不代表該詞語具有歷史意義（見本檔開頭說明）。
 */
function isMaterialDocumentTitle(answer: string, rawAnswer: string, materialText: string): boolean {
  if (materialText.length === 0) return false;
  if (!/《[^《》]{2,30}》/.test(rawAnswer)) return false;
  return materialText.includes(answer);
}

/**
 * 教材是否在同一句內把這個詞語連繫到歷史意義（見 `SIGNIFICANCE_CUES`）。
 *
 * 這是「語境支持」判斷：只用於發明、器物及技術（`TECHNOLOGY_SUFFIXES`）。
 * 詞語必須在教材中出現，且與意義用語同句——避免把「蒸汽機」這類器物當成
 * 無條件合格，亦避免倚賴模型自稱重要。
 */
function isMaterialSupportedTerm(materialText: string, answer: string): boolean {
  if (materialText.length === 0) return false;
  if (!materialText.includes(answer)) return false;
  for (const sentence of materialText.split(/[。！？\n；;]/)) {
    if (!sentence.includes(answer)) continue;
    if (SIGNIFICANCE_CUES.some((cue) => sentence.includes(cue))) return true;
  }
  return false;
}

/**
 * 移除答案首尾的通用欄位詞及連接詞；剩下的內容為空即代表答案只是欄位名稱。
 * 例如「為生方法」（為生＋方法）、「技術改良與文化發展」、「定居與建房」、「背景」。
 * 注意：屬歷史元素詞尾的「革命」、「制度」、「條約」等**不在**通用欄位詞之列，
 * 因此「工業革命」、「封建制度」不會被拆走（見 INSTITUTION_SUFFIXES）。
 */
function stripGenericColumnWords(answer: string): string {
  let remaining = answer;
  let changed = true;
  while (changed) {
    changed = false;
    for (const word of GENERIC_COLUMN_WORDS) {
      if (remaining.startsWith(word)) {
        remaining = remaining.slice(word.length);
        changed = true;
      } else if (remaining.endsWith(word)) {
        remaining = remaining.slice(0, remaining.length - word.length);
        changed = true;
      }
    }
    const withoutJoiners = remaining.replace(JOINER_PATTERN, "");
    if (withoutJoiners !== remaining) {
      remaining = withoutJoiners;
      changed = true;
    }
  }
  return remaining;
}

/** 判斷答案是否為一個完整的年份、日期或世紀（而不是含有年字的整句說明） */
export function isYearAnswer(answer: string): boolean {
  const match = /\d[\d,，]*/.exec(answer);
  if (match) {
    const digits = match[0].replace(/[,，]/g, "");
    if (digits.length < 3 || digits.length > 4) return false;
    // 年份以外只可再帶「約」、「公元前」及年／月／日等時間字詞，否則屬整句說明
    const rest = answer
      .replace(/\d/g, "")
      .replace(/[,，]/g, "")
      .replace(/[約公元前後至\-—~～生卒年月日時分秒早晚\s]/g, "");
    return rest.length === 0;
  }
  // 沒有阿拉伯數字的寫法：整個答案是中文數字年份或世紀（例如「十八世紀」、「公元前二二一年」）
  return /^[約公元前後]{0,4}[一二三四五六七八九十百千零]{1,4}[年世紀代]{1,2}[度末初期間]{0,2}$/.test(answer);
}

/** 答案是否為明顯不合格的填充題答案（說明句、形容詞或通用欄位名稱） */
function isObviouslyNotHistoricalElement(answer: string): boolean {
  if (isYearAnswer(answer)) return false;
  if (answer.length > MAX_ANSWER_LENGTH) return true;
  if (answer.length < MIN_ANSWER_LENGTH) return true;
  if (DESCRIPTIVE_PATTERN.test(answer)) return true;
  return stripGenericColumnWords(answer).length === 0;
}

/**
 * 檢查填充題的標準答案是否為具有歷史意義的元素。
 *
 * @param answer 標準答案
 * @param materialText 已提供給模型的教材原文（用於判斷引號關鍵詞及人物敘述）；
 *   沒有提供時仍可檢查年份、詞尾及各名單標記。
 */
export function checkHistoricalAnswer(answer: string, materialText = ""): HistoricalAnswerCheck {
  // 答案可能被引號括住（例如「古代」、《凡爾賽條約》），先移除最外層引號再判斷
  const raw = answer.trim();
  const value = raw.replace(/^[「『《]+/, "").replace(/[」』》]+$/, "").trim();

  if (value.length === 0) {
    return { ok: false, reason: "答案是空白", definite: true, support: "disallowed" };
  }
  if (isObviouslyNotHistoricalElement(value)) {
    return {
      ok: false,
      reason:
        `填充題的標準答案「${value}」是說明、形容詞或教材的欄位名稱，不是歷史元素` +
        "（事件名稱、人物、年份、國家、地點、條約、神祇、思想、政治制度等）",
      definite: true,
      support: "disallowed",
    };
  }

  // 注意：出現在引號內（「」／《》）**不是**合格的理由——引號只代表教材有提及，
  // 不代表該詞語具有歷史意義（見本檔開頭的說明）。
  const isHistoricalElement =
    isYearAnswer(value) ||
    YEAR_PATTERN.test(value) ||
    endsWithSuffix(value, INSTITUTION_SUFFIXES) ||
    endsWithSuffix(value, PLACE_SUFFIXES) ||
    endsWithSuffix(value, BODY_SUFFIXES) ||
    endsWithSuffix(value, PRINCIPLE_SUFFIXES) ||
    endsWithSuffix(value, PERSON_TITLE_SUFFIXES) ||
    PLACE_NAMES.has(value) ||
    PERIOD_NAMES.has(value) ||
    DEITY_NAMES.has(value) ||
    DEITY_SUFFIX.test(value) ||
    isMaterialDocumentTitle(value, raw, materialText) ||
    isPersonNameInMaterial(materialText, value) ||
    (endsWithSuffix(value, TECHNOLOGY_SUFFIXES) && isMaterialSupportedTerm(materialText, value));

  if (isHistoricalElement) {
    return { ok: true, reason: null, definite: false, support: "supported" };
  }

  return {
    ok: false,
    reason:
      `填充題的標準答案「${value}」未見歷史元素標記` +
      "（事件名稱、人物、年份、國家、地點、條約、神祇、思想、政治制度、"
      + "或教材明確交代其歷史意義的發明與器物），請核對答案是否為史事名稱",
    definite: false,
    support: "uncertain",
  };
}
