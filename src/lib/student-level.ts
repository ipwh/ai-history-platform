/**
 * 由學生班別推斷所屬程度（初中 1–3／高中 4）。
 *
 * 為甚麼集中在這裡：首頁（客戶端）與學伴檢索（伺服器端）都需要同一條規則。
 * 兩邊各寫一份時，日後調整班別格式很容易只改到其中一邊，於是出現「首頁顯示中三、
 * 學伴卻當成高中」這類不一致（2026-11-10）。
 *
 * 目前名冊的班別格式為「年級 + 班別字母」（1A、3B、5C）。只接受首位是 1–6 的寫法；
 * 其他格式（例如「S3A」「中三甲」）回傳 null，由呼叫方決定退回哪個預設，而不是猜。
 */
import { SENIOR_SECONDARY_LEVEL, type CurriculumLevel } from "./types";

export function levelFromClassName(className: string | null | undefined): CurriculumLevel | null {
  const prefix = className?.trim().charAt(0) ?? "";
  if (prefix === "1" || prefix === "2" || prefix === "3") {
    return Number(prefix) as CurriculumLevel;
  }
  if (prefix === "4" || prefix === "5" || prefix === "6") {
    return SENIOR_SECONDARY_LEVEL;
  }
  return null;
}
