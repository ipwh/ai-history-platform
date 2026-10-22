/**
 * 時序題「答案已印在題幹」的共用判定（單一事實來源）。
 *
 * 2026-10-22 用家在教師端練習記錄見到以下題目：
 *   「以下三項事件均與香港政治及行政轉變有關：1946年楊慕琦提出政制改革方案、
 *     1966年及1967年的暴動、1984年簽署《中英聯合聲明》。試按時序排列這三項事件……」
 * 題幹已逐一寫出每項事件的年份，學生只須比較題幹印出的年份就能排出次序，
 * 完全沒有考核「時序」這個歷史技能——這條題目沒有意義。
 *
 * 這裡只做**確定性**的字面判斷（不呼叫模型、可逐項測試）：
 *   1. 題幹必須明確要求排序（先後次序／時序／排列等）；
 *   2. 題幹必須有至少兩項「年份＋事件描述」，即年份已隨事件寫在題幹之內；
 *   3. 「排列以下年份」這種考核公元／公元前先後概念的題目**不在此限**——要排序的
 *      對象本身就是年份，學生仍須理解公元前後的先後關係。
 *
 * 判定為真的題目一律視為不可派給學生（見 question-servability.ts）及不可發布
 * （見 question-quality.ts），避免同一道閘門只在一邊生效。
 */

/** 題幹明確要求「排序／先後」的寫法 */
const ORDERING_DEMAND =
  /(先後次序|先後順序|時間順序|按時序|時序排列|時序正確|按時間先後|按年代順序|排列|排序|正確的次序|正確順序|次序完全正確|次序正確)/;

/** 題幹中的年份（「1946年」「公元前 800 年」「公元 850 年」） */
const YEAR_TOKEN = /公元前\s*\d+\s*年|公元\s*\d+\s*年|\d{3,4}\s*年/g;

/**
 * 「年份＋事件描述」：年份後面緊接至少兩個非數字、非標點的字。
 * 這樣才代表題幹把年份寫在事件前面（「1946年楊慕琦提出政制改革方案」）；
 * 純粹列出年份（「公元850年 ii.」）不會符合。
 */
const DATED_EVENT =
  /(?:公元前\s*\d+\s*年|公元\s*\d+\s*年|\d{3,4}\s*年)([^\d\s；;，,、。：:！？!?（）()〔〕【】「」『』《》〈〉]{2,})/g;

/** 要排序的對象本身就是年份／年代（「按年代順序排列以下的年份」）：屬正當考核，不在此限 */
const ORDERS_TIME_ITSELF = /(排列|排序|順序|次序)[^。；]{0,8}(年份|年代|世紀)/;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * 時序題的答案是否已由題幹直接給出（年份印在題幹），回傳原因；否則 null。
 *
 * 只適用於選擇題／題幹本身；選項內容不影響判斷（排序題的選項就是各種次序）。
 */
export function chronologyGivenAwayReason(question: string): string | null {
  const stem = question.trim();
  if (stem.length === 0) return null;
  if (!ORDERING_DEMAND.test(stem)) return null;
  if (ORDERS_TIME_ITSELF.test(stem)) return null;

  const datedEvents = [...stem.matchAll(DATED_EVENT)].map((match) => match[0].trim());
  if (datedEvents.length < 2) return null;

  const years = unique(stem.match(YEAR_TOKEN) ?? []).slice(0, 4);
  return (
    `題幹已把年份寫在事件之前（${years.join("、")}），學生只須比較題幹印出的年份即可排出次序，` +
    "並未考核時序；請刪去題幹的年份，或改為考核其他歷史理解"
  );
}
