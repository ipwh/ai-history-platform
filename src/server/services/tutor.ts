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

export interface TutorChatTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * 只保留「有回覆」的學生提問，並以 assistant 訊息作結。
 *
 * 學生提問在呼叫模型**之前**就會寫入資料庫；若該次請求失敗（上游錯誤、逾時、
 * 串流中斷、額度用盡），資料庫會留下一則沒有回覆的提問。若把這種提問照樣送去模型，
 * 模型會見到連續兩則學生訊息，於是同時回答上一則（學生已見過錯誤訊息）的問題——
 * 2026-10-27 使用者回報就是這樣：問「凡爾賽條約」失敗後再問「文藝復興如何導致宗教
 * 改革」，回覆把兩題一起答，並因為其中一題沒有教材依據而令整個標示降級。
 *
 * 規則：
 *   1. 連續的學生訊息只保留**最新**一則（較舊的是沒有回覆的提問）；
 *   2. 結尾若是學生訊息（最新一則仍未回覆）便丟棄，因為本次提問會另行附加。
 *
 * 不刪除資料庫內的提問：刪除會令每日提問次數「回水」，與 README 及 `ai_operations`
 * 的用量語意不一致；提問仍保留在對話紀錄中，只是不再送去模型。
 */
export function answeredTurnsOnly(messages: TutorChatTurn[]): TutorChatTurn[] {
  const turns: TutorChatTurn[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      const last = turns[turns.length - 1];
      if (last?.role === "user") turns[turns.length - 1] = { role: "user", content: message.content };
      else turns.push({ role: "user", content: message.content });
    } else {
      turns.push({ role: "assistant", content: message.content });
    }
  }
  if (turns[turns.length - 1]?.role === "user") turns.pop();
  return turns;
}

export function tutorDailyUsage(learnerId: string, now = new Date()): {
  used: number;
  remaining: number;
} {
  const used = countTutorQuestionsSince(learnerId, hongKongDayStart(now));
  return { used, remaining: Math.max(0, TUTOR_DAILY_LIMIT - used) };
}
