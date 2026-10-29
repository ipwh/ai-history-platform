/**
 * 教師端「學習者」清單的班級與排序規則（單一事實來源）。
 *
 * 為甚麼需要獨立成一個模組：名冊的「班別」是 `1A`、`2B` 這類班號，「班級」是同一級的
 * 所有班（中一、中二…）。教師要逐班核對學生時，下拉選單必須按**班級 → 班別 → 班號**
 * 排列；若沿用預設的字串排序，`班號 10` 會排在 `班號 9` 之前，看起來像隨機順序。
 */
import type { PracticeRecordLearner } from "./types";

/** 由班別（`1A`）取出班級（`1`）；不是以數字開頭時回傳 null（例如「未列入名冊」） */
export function formLevelOf(className: string | null): string | null {
  const match = /^(\d+)/.exec((className ?? "").trim());
  return match ? match[1] : null;
}

const FORM_LEVEL_LABELS: Record<string, string> = {
  "1": "中一",
  "2": "中二",
  "3": "中三",
  "4": "中四",
  "5": "中五",
  "6": "中六",
};

/** 班級的中文名稱（中一…中六）；其他數字級別顯示為「N 級」 */
export function formLevelLabel(level: string): string {
  return FORM_LEVEL_LABELS[level] ?? `${level} 級`;
}

/** 學號可能是「01」或「1」：以數值比較；沒有學號或不是數字者排到最後 */
function studentNumberKey(value: string | null): number {
  const text = (value ?? "").trim();
  if (text.length === 0) return Number.MAX_SAFE_INTEGER;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function displayName(learner: PracticeRecordLearner): string {
  return learner.name || learner.email || learner.learnerId;
}

/**
 * 「學習者」下拉選單的排序：先班級、再班別、最後班號（學號）。
 *
 * 未列入名冊的學習者（沒有班別）一律排最後，避免混在班別之間。
 */
export function compareLearnersByClass(
  left: PracticeRecordLearner,
  right: PracticeRecordLearner,
): number {
  const leftLevel = formLevelOf(left.className);
  const rightLevel = formLevelOf(right.className);
  if (leftLevel !== rightLevel) {
    if (leftLevel === null) return 1;
    if (rightLevel === null) return -1;
    return Number(leftLevel) - Number(rightLevel);
  }
  const classOrder = (left.className ?? "").localeCompare(right.className ?? "", "zh-HK", {
    numeric: true,
  });
  if (classOrder !== 0) return classOrder;
  const numberOrder = studentNumberKey(left.studentNumber) - studentNumberKey(right.studentNumber);
  if (numberOrder !== 0) return numberOrder;
  return displayName(left).localeCompare(displayName(right), "zh-HK");
}
