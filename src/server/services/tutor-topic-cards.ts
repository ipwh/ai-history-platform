/**
 * 課題級「人物／事件卡」讀取（M2，最小版）。
 *
 * 來源優先次序：
 *   1. `data/tutor-topic-cards/*.json`（科組自行維護，不納入版本控制）；
 *   2. 內建 `seed/tutor-topic-cards.ts`（開箱即用，只覆蓋 1–2 個課題作示例）。
 *
 * 同一 `topicId` 以檔案版本為準（可局部覆蓋）。任何讀取／解析錯誤一律忽略該檔並
 * 繼續，最壞情況只是退回內建版本——**永不**因為卡片問題令學伴回 500。
 *
 * 卡片只可含引導性問題及概念提示；見 `seed/tutor-topic-cards.ts` 的安全說明。
 */
import fs from "node:fs";
import path from "node:path";

import {
  SEED_TUTOR_TOPIC_CARDS,
  type TutorTopicCard,
} from "../seed/tutor-topic-cards";

/** 每張卡片的建議問題上限（避免開場建議過長） */
export const TUTOR_TOPIC_CARD_MAX_QUESTIONS = 5;
/** 卡片檔案的大小上限；超過視為設定錯誤並忽略 */
const MAX_CARD_FILE_BYTES = 64 * 1024;

export function defaultTutorTopicCardsDir(projectRoot = process.cwd()): string {
  return path.join(projectRoot, "data", "tutor-topic-cards");
}

/** 把任意 JSON 內容收斂成合法卡片；不合法回傳 null */
export function parseTutorTopicCard(value: unknown): TutorTopicCard | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const topicId = typeof record.topicId === "string" ? record.topicId.trim() : "";
  if (topicId.length === 0) return null;
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const toList = (input: unknown, limit: number): string[] =>
    Array.isArray(input)
      ? input
          .flatMap((item) => (typeof item === "string" ? [item.trim()] : []))
          .filter((item) => item.length > 0)
          .slice(0, limit)
      : [];
  return {
    topicId,
    title: title.slice(0, 120),
    suggestedQuestions: toList(record.suggestedQuestions, TUTOR_TOPIC_CARD_MAX_QUESTIONS),
    confusionPoints: toList(record.confusionPoints, TUTOR_TOPIC_CARD_MAX_QUESTIONS),
  };
}

function readCardFiles(dir: string): TutorTopicCard[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir).filter((name) => name.toLowerCase().endsWith(".json"));
  } catch {
    return [];
  }
  const cards: TutorTopicCard[] = [];
  for (const name of entries.sort()) {
    const filePath = path.join(dir, name);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > MAX_CARD_FILE_BYTES) continue;
      const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
      // 支援單一卡片或卡片陣列兩種寫法
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const candidate of candidates) {
        const card = parseTutorTopicCard(candidate);
        if (card !== null) cards.push(card);
      }
    } catch {
      // 單一檔案的格式錯誤不應令其他卡片失效
    }
  }
  return cards;
}

/** 全部生效的卡片（檔案覆蓋內建），以 topicId 為鍵 */
export function loadTutorTopicCards(
  dir: string = defaultTutorTopicCardsDir(),
): Map<string, TutorTopicCard> {
  const merged = new Map<string, TutorTopicCard>();
  for (const card of SEED_TUTOR_TOPIC_CARDS) merged.set(card.topicId, card);
  for (const card of readCardFiles(dir)) merged.set(card.topicId, card);
  return merged;
}

export function getTutorTopicCard(
  topicId: string | null,
  dir: string = defaultTutorTopicCardsDir(),
): TutorTopicCard | null {
  if (topicId === null) return null;
  return loadTutorTopicCards(dir).get(topicId) ?? null;
}
