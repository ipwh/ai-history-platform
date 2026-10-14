/**
 * 課題及分節的服務層。
 */
import type { Section, TopicOverview } from "../../lib/types";
import { ensureBootstrap } from "../seed";
import { getTopicOverviews, getTopicOverview, upsertSection, setTopicPublished, getSection } from "../repositories/topics";

export function listTopicOverviews(
  learnerId: string | null,
  options: { publishedOnly?: boolean } = {},
): TopicOverview[] {
  ensureBootstrap();
  return getTopicOverviews(learnerId, options);
}

export function getTopicDetail(topicId: string, learnerId: string | null): TopicOverview | null {
  ensureBootstrap();
  return getTopicOverview(topicId, learnerId);
}

export function updateSectionDetails(
  sectionId: string,
  changes: { title?: string; summary?: string; matchKeywords?: string[] },
): Section {
  const existing = getSection(sectionId);
  if (!existing) {
    throw new Error("找不到指定的分節");
  }
  return upsertSection({
    id: existing.id,
    topicId: existing.topicId,
    parentId: existing.parentId,
    title: changes.title?.trim() || existing.title,
    summary: changes.summary ?? existing.summary,
    matchKeywords: changes.matchKeywords ?? existing.matchKeywords,
    order: existing.order,
  });
}

export function publishTopic(topicId: string, published: boolean) {
  return setTopicPublished(topicId, published);
}
