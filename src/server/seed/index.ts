/**
 * 示範資料的建立與核對。
 *
 * - 種子課題結構（分節及關鍵詞）可重複執行。
 * - 示範題庫的每條題目都帶有 sourceAnchor，匯入教材後會自動核對是否真有教材依據；
 *   核對失敗的題目會被降為「草稿」並回報，提醒教師檢查。
 */
import { questionSchema, type Question, type TableCell } from "../../lib/types";
import { nowIso } from "../db/connection";
import { listBlocksByTopic } from "../repositories/materials";
import { getQuestion, insertQuestion, updateQuestion } from "../repositories/questions";
import {
  getTopic,
  listSections,
  listTopics,
  seedTopicStructure,
} from "../repositories/topics";
import { normalizeForMatch, truncate } from "../materials/text-utils";
import {
  ALL_CURRICULUM_TOPICS,
  PILOT_SECTIONS,
  PILOT_TOPIC,
  SENIOR_CURRICULUM_TOPICS,
  type TopicSeed,
} from "./curriculum";
import { DEMO_QUESTIONS } from "./demo-questions";

export interface SeedReport {
  topicId: string;
  sectionCount: number;
  materialBlockCount: number;
  totalQuestions: number;
  verifiedQuestions: number;
  unverifiedQuestions: { id: string; anchor: string }[];
}

export interface CurriculumSeedReport {
  topics: number;
  sections: number;
  levels: { level: number; label: string; topics: number }[];
}

interface AnchorSource {
  blockId: string;
  sourceLocation: string;
  excerpt: string;
}

/** 在教材段落中找出包含 anchor 的最小文字單位（清單項目或表格儲存格優先） */
export function findAnchorSource(topicId: string, anchor: string): AnchorSource | null {
  const target = normalizeForMatch(anchor);
  if (target.length === 0) return null;

  let best: AnchorSource | null = null;
  const consider = (blockId: string, sourceLocation: string, text: string) => {
    if (!text.includes(anchor) && !normalizeForMatch(text).includes(target)) return;
    if (!best || text.length < best.excerpt.length) {
      best = { blockId, sourceLocation, excerpt: truncate(text, 240) };
    }
  };

  for (const block of listBlocksByTopic(topicId)) {
    if (block.type === "image") continue;
    if (block.table) {
      for (const row of block.table as TableCell[][]) {
        for (const cell of row) {
          if (cell.text.length > 0) consider(block.id, block.sourceLocation, cell.text);
        }
      }
      continue;
    }
    for (const item of block.text.split("\n")) {
      if (item.trim().length > 0) consider(block.id, block.sourceLocation, item.trim());
    }
  }

  return best;
}

/**
 * 建立／更新全部課程課題的結構（初中 12 個、高中 5 個）。
 * 可重複執行（具幂等性）。
 */
export function seedCurriculum(options: { levels?: (0 | 1 | 2 | 3 | 4)[] } = {}): CurriculumSeedReport {
  const topics = options.levels
    ? ALL_CURRICULUM_TOPICS.filter((topic) => options.levels?.includes(topic.level))
    : ALL_CURRICULUM_TOPICS;

  let sectionCount = 0;
  for (const topic of topics) {
    // 重複執行種子不得改變發布狀態：高中課題預設不發布，管理員發布後若再次匯入教材，
    // 不應被種子悄悄下架。
    const existing = getTopic(topic.id);
    const result = seedTopicStructure({
      topic: {
        id: topic.id,
        title: topic.title,
        description: topic.description,
        order: topic.order,
        published: existing?.published ?? topic.published,
        level: topic.level,
        curriculumTheme: topic.curriculumTheme ?? null,
        topicNumber: topic.topicNumber,
      },
      sections: topic.sections,
    });
    sectionCount += result.sections.length;
  }

  const byLevel = new Map<number, number>();
  for (const topic of topics) {
    byLevel.set(topic.level, (byLevel.get(topic.level) ?? 0) + 1);
  }

  const labels: Record<number, string> = {
    0: "未分類",
    1: "中一",
    2: "中二",
    3: "中三",
    4: "中四至中六",
  };

  return {
    topics: topics.length,
    sections: sectionCount,
    levels: [...byLevel.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([level, count]) => ({ level, label: labels[level] ?? String(level), topics: count })),
  };
}

/** 取得課題的 seed 資料（用於匯入教材時對應檔案） */
export function findTopicSeed(topicId: string): TopicSeed | null {
  return ALL_CURRICULUM_TOPICS.find((topic) => topic.id === topicId) ?? null;
}

/** 建立／更新試點課題（課題5）的分節結構 */
export function seedTopicStructureOnly(): { topicId: string; sectionCount: number } {
  const { topic, sections } = seedTopicStructure({
    topic: PILOT_TOPIC,
    sections: PILOT_SECTIONS,
  });
  return { topicId: topic.id, sectionCount: sections.length };
}

/**
 * 寫入示範題庫，並核對每題是否真有教材依據。
 * 若教材尚未匯入，示範題目仍可使用，但會標示為「未與已上載教材核對」。
 */
export function seedDemoQuestionBank(): SeedReport {
  const { topicId, sectionCount } = seedTopicStructureOnly();
  const sectionIds = new Set(listSections(topicId).map((section) => section.id));
  const materialBlockCount = listBlocksByTopic(topicId).length;
  const unverifiedQuestions: { id: string; anchor: string }[] = [];
  let verifiedQuestions = 0;

  for (const seed of DEMO_QUESTIONS) {
    if (!sectionIds.has(seed.sectionId)) {
      throw new Error(`示範題目 ${seed.id} 指向不存在的分節：${seed.sectionId}`);
    }

    const source = findAnchorSource(topicId, seed.sourceAnchor);
    if (source) verifiedQuestions += 1;
    else unverifiedQuestions.push({ id: seed.id, anchor: seed.sourceAnchor });

    // 教材尚未匯入時保留為可用的示範題；已匯入但找不到依據時降為草稿待教師檢查
    const status = source || materialBlockCount === 0 ? "published" : "draft";

    const question: Question = questionSchema.parse({
      id: `demo-${seed.id}`,
      topicId,
      sectionId: seed.sectionId,
      questionType: seed.questionType,
      difficulty: seed.difficulty,
      question: seed.question,
      options: seed.options ?? [],
      correctAnswer: seed.correctAnswer,
      acceptedAnswers: seed.acceptedAnswers ?? [],
      explanation: seed.explanation,
      knowledgePoint: seed.knowledgePoint,
      sourceExcerpt: source?.excerpt ?? seed.sourceAnchor,
      sourceLocation: source?.sourceLocation ?? "示範題庫（未能自動核對教材位置）",
      sourceBlockIds: source ? [source.blockId] : [],
      gradingPoints: seed.gradingPoints ?? [],
      origin: "demo",
      status,
      sourceVerified: source !== null,
      createdAt: nowIso(),
    });

    if (getQuestion(question.id)) updateQuestion(question.id, question);
    else insertQuestion(question);
  }

  return {
    topicId,
    sectionCount,
    materialBlockCount,
    totalQuestions: DEMO_QUESTIONS.length,
    verifiedQuestions,
    unverifiedQuestions,
  };
}

/** 建立分節結構並寫入示範題庫（教材已匯入時會一併核對教材依據） */
export function seedPilotTopic(): SeedReport {
  return seedDemoQuestionBank();
}

let bootstrapped = false;

/**
 * 首次啟動時若資料庫尚未有任何課題，自動建立初中 12 個及高中 5 個課題的結構及示範題庫，
 * 確保沒有 API key、沒有上載教材的情況下仍可使用示範模式。
 */
export function ensureBootstrap(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  if (listTopics().length === 0) {
    seedCurriculum();
    seedPilotTopic();
    return;
  }
  // 既有資料庫（已在運作的初中平台）：補上尚未建立的高中課題結構。
  // 只建立缺少的課題，不改動已存在課題的發布狀態或管理員設定。
  for (const topic of SENIOR_CURRICULUM_TOPICS) {
    if (getTopic(topic.id)) continue;
    seedTopicStructure({
      topic: {
        id: topic.id,
        title: topic.title,
        description: topic.description,
        order: topic.order,
        published: topic.published,
        level: topic.level,
        curriculumTheme: topic.curriculumTheme ?? null,
        topicNumber: topic.topicNumber,
      },
      sections: topic.sections,
    });
  }
}
