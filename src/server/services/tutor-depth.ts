/*
 * 學伴回覆深度（2026-11-06）。
 *
 * 背景：原本所有歷史問題都套用同一個四段精簡結構，連「美國革命與法國大革命有哪些關係？」
 * 這類分析性提問亦只有兩三句線索，對能力較高的學生沒有幫助。現在改為三層，
 * `auto` 按提問的認知要求判斷，學生亦可自行選擇（見 TutorView 的「回覆深度」）。
 *
 * 判斷只依賴提問字面、不呼叫模型：這是每次提問都會走的路徑，必須零額外延遲。
 */
import { normalizeHistoryAnswer } from "@/lib/history-lexicon";
import type { TutorDepthPreference, TutorReplyDepth } from "@/lib/types";
import { isShortHistoryFollowUp } from "./tutor";

/**
 * 需要評價、判斷或處理史學爭議的提問 → `challenge`。
 *
 * 實測補充（2026-11-06）：「有人認為美國革命只是精英運動，你同意嗎？」原本被判為
 * `advanced`，因為名單只有「是否同意」「同不同意」，沒有學生實際會打的「你同意嗎」。
 * 同時只收「疑問形」（同意嗎／贊成嗎／你認為…嗎），避免把「英國為何不同意自治」
 * 這類因果提問當成評價題。
 *
 * 2026-11-07（Sprint 29）：加入「因果判斷」句式——問某件事**是否**主要原因／關鍵
 * 因素，屬於評價而非單純解釋因果。「波士頓茶黨事件是美國革命的主要原因嗎？」原本
 * 被判 `advanced`（只因「原因」命中分析類），與「為何發生」得到同一個結構。
 */
const EVALUATIVE_CAUSAL_PATTERN =
  /(?:是否|係咪|算唔算|算不算|堪稱|可唔可以視為|可否視為)[^？?]{0,12}(?:主要原因|主因|最重要|關鍵|決定性|根本原因)|(?:主要原因|主因|最重要|關鍵|決定性)[^？?]{0,8}(?:嗎|呢|對嗎)|(?:多大程度|幾大程度)/;

const EVALUATIVE_PATTERN =
  /評價|評估|評論|判斷|是否同意|同不同意|同唔同意|你同意|同意嗎|贊成嗎|反對嗎|多大程度|幾大程度|重要性|最重要|較重要|更重要|哪一?個[^？?]{0,6}較|哪一?項[^？?]{0,6}較|最具(?:決定性|影響力|重要性)|最為關鍵|史觀|史學|爭議|成效|應否|應不應該|值不值得|公平嗎|合理嗎|恰當嗎|成功嗎|失敗嗎|算唔算|算不算|成唔成功|成不成功|失唔失敗|你認為[^？?]{0,24}嗎|是否值得|是否重要|是否成功|是否公平|是否合理|是否恰當|是否應該|是否應視為|是否可視為|值得嗎|重要嗎|視為一場/;

/** 需要比較、解釋因果或整理關係的提問 → `advanced` */
const ANALYTICAL_PATTERN =
  /比較|異同|相同|相異|分別|兩者|之間|關係|關聯|影響|為何|為什麼|為甚麼|點解|原因|背景|導致|造成|促使|促成|推動|如何|怎樣|怎會|反映出|延續|轉變|角色|作用|特色|特徵|之後|接著|後果/;

/** 只問「是甚麼／是誰／哪一年」的辨識型提問：精簡結構已足夠 */
const FACTUAL_PATTERN =
  /^(?:什麼|甚麼|咩|邊個|誰|哪一?年|邊一年|幾時|何時|幾多年|邊度|在哪|什麼是|甚麼是|定義|意思|全名)/;

/**
 * 疑問詞在句中（「列克星頓同康科特嗰場仗係幾時？」）。
 *
 * `FACTUAL_PATTERN` 只認句首，但學生常把「幾時」「邊個」放在後面。若不補這一條，
 * 「係幾時」會因為句子較長而落到預設的進階深度，令一個純事實提問得到分析框架。
 * 只收「問時間／問人物」的詞：問原因、影響的字詞已由評價／分析規則先行處理。
 */
const FACTUAL_ANYWHERE = /幾時|何時|邊一年|哪一年|幾多年|邊個|邊位/;

/**
 * 英文提問的認知層級（2026-11-06）。
 *
 * 為甚麼要另設一組：`normalizeHistoryAnswer` 會去掉空格，英文句子會黏成
 * `towhatextentwastheamericanrevolution…`，用中文的規則比對不到；而 DSE／英文授課
 * 學生正是用 "To what extent…"、"Compare and contrast…"、"Who was…" 這些句式提問。
 * 因此英文一律在**原文**上比對，並使用 `i` 旗標。
 */
const EVALUATIVE_PATTERN_EN =
  /\b(?:to what extent|to what degree|how far|how significant|how important|how successful|how effective|how justified|evaluate|assess|do you agree|do you think|discuss whether|judge whether|was it justified|was it mainly because|would you say)\b/i;

/**
 * 英文的因果判斷（Sprint 29）。
 *
 * "Was the Boston Tea Party the main cause of the American Revolution?" 只命中
 * `causes? of` → `advanced`，但這題要求判斷「主因」，屬評價。只收帶評價語意的
 * 主因／關鍵因素說法，普通 "What caused…?" 仍然是進階分析。
 */
const EVALUATIVE_CAUSAL_PATTERN_EN =
  /\b(?:main|primary|principal|chief|key|decisive|most important|single most important)\s+(?:cause|reason|factor)|\b(?:main|primary|principal|chief|key|decisive)\s+factors?\b|\bhow\s+(?:important|significant|decisive)\b|\bwhich\s+(?:factor|event|cause|reason|development)\b[^?]{0,60}\b(?:most important|most significant|more important|decisive|greatest)\b|\bmost\s+important\s+(?:factor|event|cause|reason)\b|\bhistorians?\s+(?:disagree|differ|debate)\b|\bwas\s+[^?]{0,60}\b(?:a|an)\s+(?:failure|success)\b|\bsignificance\b/i;

const ANALYTICAL_PATTERN_EN =
  /\b(?:why|how|compare|contrast|explain|in what ways?|relationship between|influence[sd]?|impact[s]?|effects? of|causes? of|what caused|what led to|caused by|reasons? (?:for|why)|consequences?)\b/i;

/** 英文辨識型提問：who／what／when／where／which 開首，且不帶分析字眼（分析字眼會先命中上一組） */
const FACTUAL_PATTERN_EN = /^\s*(?:who|what|when|where|which)\b/i;

/** 未命中任何分析訊號時，較長（即多半不止問一個名稱）的提問視為需要分析 */
const MIN_ANALYTICAL_LENGTH = 12;

/**
 * 各深度最多引用多少段教材。
 *
 * 進階／挑戰回覆要跨多個角度分析，三段教材通常不足以支撐；但仍設上限，
 * 以免一次把大量原文送去模型，亦令「已對照課本教材」的清單保持可讀。
 */
const MAX_SOURCES_BY_DEPTH: Record<TutorReplyDepth, number> = {
  standard: 3,
  advanced: 4,
  challenge: 5,
};

export function tutorMaxSourcesForDepth(depth: TutorReplyDepth): number {
  return MAX_SOURCES_BY_DEPTH[depth];
}

/**
 * 決定本回合的回覆深度。
 *
 * `preference` 為學生在介面選定的值（預設 `auto`）。`previousDepth` 是上一則學伴
 * 回覆的深度：短追問（「點解？」「咁之後呢？」）本身沒有足夠字面線索，若重新判斷
 * 會由「進階分析」掉回「精簡」，令剛開始的深入討論突然中斷，因此沿用上一輪。
 */
export function resolveTutorReplyDepth(
  preference: TutorDepthPreference,
  message: string,
  previousDepth: TutorReplyDepth | null = null,
): TutorReplyDepth {
  if (preference !== "auto") return preference;

  const normalized = normalizeHistoryAnswer(message);
  const raw = message;
  if (isShortHistoryFollowUp(message)) return previousDepth ?? "standard";
  if (
    EVALUATIVE_PATTERN.test(normalized) ||
    EVALUATIVE_PATTERN_EN.test(raw) ||
    EVALUATIVE_CAUSAL_PATTERN.test(normalized) ||
    EVALUATIVE_CAUSAL_PATTERN_EN.test(raw)
  ) {
    return "challenge";
  }
  if (ANALYTICAL_PATTERN.test(normalized) || ANALYTICAL_PATTERN_EN.test(raw)) return "advanced";
  if (
    FACTUAL_PATTERN.test(normalized) ||
    FACTUAL_ANYWHERE.test(normalized) ||
    FACTUAL_PATTERN_EN.test(raw)
  ) {
    return "standard";
  }
  // 預設進階：香港中學歷史科的提問多數都不只是問「是哪一年」，
  // 寧可給出分析框架讓學生自行取捨，也不要每次只回三句線索。
  return normalized.length >= MIN_ANALYTICAL_LENGTH ? "advanced" : "standard";
}
