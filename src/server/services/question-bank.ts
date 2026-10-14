/**
 * 題庫批次生成。
 *
 * 為每個課程課題的分節生成練習題目（使用設定的 LLM provider，預設為本地示範生成）。
 * 生成結果會經過 schema 驗證及教材依據核對；沒有依據的題目不會儲存。
 *
 * 難度分配：每個分節的目標題數會平均分配到基礎／進階／挑戰三個難度，
 * 令學生選擇任何難度時都有題庫題目可用（本地示範生成亦會按難度採用不同出題規則）。
 *
 * 發布策略：
 *   - DEMO_AUTO_PUBLISH_QUESTIONS=true（預設）且使用本地示範生成時，題目會自動發布，
 *     令學生無需教師逐一審核也可練習（介面會標示來源為「本地示範生成（未使用 AI）」）。
 *   - 正式環境建議設為 false，讓教師在「題目管理」核對後才發布。
 */
import { DIFFICULTY_LABELS, type Difficulty } from "../../lib/types";
import { getServerConfig } from "../config";
import { describeLlm } from "../llm";
import { countQuestions, listQuestions } from "../repositories/questions";
import { listSections, listTopics } from "../repositories/topics";
import { changeQuestionStatus, generateQuestions } from "./question-service";

/** 題庫要齊備的難度（學生在練習設定可選的三個難度） */
const BANK_DIFFICULTIES: Difficulty[] = ["basic", "advanced", "challenge"];

export interface QuestionBankOptions {
  /** 只處理指定課題 */
  topicId?: string | null;
  /** 每個分節的目標題數（會平均分配到基礎／進階／挑戰三個難度） */
  perSection?: number;
  /** 只建立草稿，不自動發布 */
  draftOnly?: boolean;
  /** 進度回報 */
  onTopic?: (message: string) => void;
}

export interface QuestionBankReport {
  topicsProcessed: number;
  created: number;
  published: number;
  autoPublish: boolean;
  /** 這次新增的題目按難度分佈 */
  createdByDifficulty: Record<Difficulty, number>;
  duplicateSections: string[];
  insufficientSections: string[];
  totalsByTopic: { topicId: string; title: string; count: number }[];
}

/**
 * 把每個分節的目標題數平均分配到三個難度。
 * 例如 perSection = 5 → 基礎 2 題、進階 2 題、挑戰 1 題；
 * perSection = 3 → 基礎／進階／挑戰各 1 題。
 */
export function allocateByDifficulty(total: number): Map<Difficulty, number> {
  const allocation = new Map<Difficulty, number>();
  const base = Math.floor(total / BANK_DIFFICULTIES.length);
  const remainder = total % BANK_DIFFICULTIES.length;
  BANK_DIFFICULTIES.forEach((difficulty, index) => {
    const count = base + (index < remainder ? 1 : 0);
    if (count > 0) allocation.set(difficulty, count);
  });
  return allocation;
}

export async function generateQuestionBank(
  options: QuestionBankOptions = {},
): Promise<QuestionBankReport> {
  const config = getServerConfig();
  const perSection = options.perSection ?? 5;
  const llm = describeLlm();
  const autoPublish =
    !options.draftOnly && config.autoPublishMockQuestions && llm.provider === "mock";

  const topics = listTopics().filter(
    (topic) => topic.level !== 0 && (!options.topicId || topic.id === options.topicId),
  );

  let created = 0;
  let published = 0;
  const createdByDifficulty: Record<Difficulty, number> = {
    basic: 0,
    advanced: 0,
    challenge: 0,
  };
  const duplicateSections = new Set<string>();
  const insufficientSections = new Set<string>();

  for (const topic of topics) {
    const childSections = listSections(topic.id).filter((section) => section.parentId !== null);
    const targets = childSections.length > 0 ? childSections : listSections(topic.id);

    for (const section of targets) {
      // 逐個難度補足目標題數，確保題庫同時有基礎、進階及挑戰的題目
      for (const [difficulty, target] of allocateByDifficulty(perSection)) {
        const existing = listQuestions({
          topicId: topic.id,
          sectionIds: [section.id],
          difficulties: [difficulty],
        }).length;
        if (existing >= target) continue;

        try {
          const result = await generateQuestions({
            topicId: topic.id,
            sectionIds: [section.id],
            questionTypes: ["mc", "fill", "short"],
            difficulty,
            questionCount: target - existing,
          });

          created += result.questions.length;
          createdByDifficulty[difficulty] += result.questions.length;
          if (autoPublish) {
            for (const question of result.questions) {
              changeQuestionStatus(question.id, "published");
            }
            published += result.questions.length;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const label = `${topic.title} › ${section.title}`;
          if (message.includes("重複")) duplicateSections.add(label);
          else insufficientSections.add(label);
        }
      }
    }

    const counts = BANK_DIFFICULTIES.map(
      (difficulty) =>
        `${DIFFICULTY_LABELS[difficulty]} ${countQuestions({ topicId: topic.id, difficulties: [difficulty] })}`,
    ).join("、");
    options.onTopic?.(
      `${topic.title}：合計 ${countQuestions({ topicId: topic.id })} 題（分節 ${targets.length} 個；${counts}）`,
    );
  }

  return {
    topicsProcessed: topics.length,
    created,
    published,
    autoPublish,
    createdByDifficulty,
    duplicateSections: [...duplicateSections],
    insufficientSections: [...insufficientSections],
    totalsByTopic: topics.map((topic) => ({
      topicId: topic.id,
      title: topic.title,
      count: countQuestions({ topicId: topic.id }),
    })),
  };
}
