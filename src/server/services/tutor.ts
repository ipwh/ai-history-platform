import { HISTORY_TERM_GROUPS } from "@/lib/history-lexicon";
import { countTutorQuestionsSince } from "../repositories/tutor";

export const TUTOR_DAILY_LIMIT = 15;
export const TUTOR_OFF_TOPIC_REPLY =
  "我是你的歷史科自學學伴，只能討論歷史科相關話題喔！你可以告訴我你想探討哪一個歷史事件或課題嗎？";

const HONG_KONG_OFFSET_MS = 8 * 60 * 60 * 1000;
const HISTORY_TERMS = HISTORY_TERM_GROUPS.flatMap((group) => [
  group.canonical,
  ...group.aliases,
])
  .filter((term) => term.trim().length >= 2)
  .map((term) => term.toLowerCase());

const SHORT_FOLLOW_UP =
  /^(?:點解|為甚麼|為什麼|原因呢|邊一年|哪一年|何時|幾時|然後呢|結果呢|有什麼影響|有何影響|呢個呢|那麼呢|之後呢|可否再說|可以再講|再解釋|詳細一點|再舉例)[?？!！。 ]*$/;

export function hongKongTimestamp(now = new Date()): string {
  return `${new Date(now.getTime() + HONG_KONG_OFFSET_MS).toISOString().slice(0, -1)}+08:00`;
}

export function hongKongDayStart(now = new Date()): string {
  const hongKongDate = new Date(now.getTime() + HONG_KONG_OFFSET_MS).toISOString().slice(0, 10);
  return `${hongKongDate}T00:00:00.000+08:00`;
}

export function isHistoryTopicPrompt(message: string): boolean {
  const normalized = message.toLowerCase();
  if (HISTORY_TERMS.some((term) => normalized.includes(term))) return true;
  return /(?:公元前|公元|西元)?\s*\d{1,4}\s*(?:年|世紀|年代)|\b(?:1[0-9]{3}|20[0-2][0-9])\b/.test(
    normalized,
  );
}

export function isShortHistoryFollowUp(message: string): boolean {
  const trimmed = message.trim();
  return trimmed.length <= 24 && SHORT_FOLLOW_UP.test(trimmed);
}

export function tutorDailyUsage(learnerId: string, now = new Date()): {
  used: number;
  remaining: number;
} {
  const used = countTutorQuestionsSince(learnerId, hongKongDayStart(now));
  return { used, remaining: Math.max(0, TUTOR_DAILY_LIMIT - used) };
}
