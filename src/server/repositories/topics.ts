/**
 * 課題及分節的資料存取。所有 SQL 只出現在此資料夾內。
 */
import { getDb, nowIso, toSqlBool, fromSqlBool, withTransaction } from "../db/connection";
import { getLearnerProgress } from "./learners";
import { studentMaterialBlockCounts } from "./materials";
import {
  CURRICULUM_LEVEL_LABELS,
  curriculumThemeText,
  sectionSchema,
  type CurriculumLevel,
  type CurriculumTheme,
  type Section,
  type Topic,
  type TopicOverview,
} from "../../lib/types";

function parseJsonArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

interface TopicRow {
  id: string;
  title: string;
  description: string;
  published: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  level: number | null;
  curriculum_theme: string | null;
  topic_number: number | null;
}

interface SectionRow {
  id: string;
  topic_id: string;
  parent_id: string | null;
  title: string;
  summary: string;
  match_keywords_json: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function mapTopic(row: TopicRow): Topic {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    published: fromSqlBool(row.published),
    order: row.sort_order,
    level: ((row.level ?? 1) as CurriculumLevel),
    curriculumTheme:
      row.curriculum_theme === "A" || row.curriculum_theme === "B"
        ? row.curriculum_theme
        : null,
    topicNumber: row.topic_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSection(row: SectionRow): Section {
  return sectionSchema.parse({
    id: row.id,
    topicId: row.topic_id,
    parentId: row.parent_id,
    title: row.title,
    summary: row.summary,
    order: row.sort_order,
    matchKeywords: parseJsonArray(row.match_keywords_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function listTopics(options: { publishedOnly?: boolean } = {}): Topic[] {
  const rows = getDb()
    .prepare(
      options.publishedOnly
        ? "SELECT * FROM topics WHERE published = 1 ORDER BY level ASC, sort_order ASC, title ASC"
        : "SELECT * FROM topics ORDER BY level ASC, sort_order ASC, title ASC",
    )
    .all() as unknown as TopicRow[];
  return rows.map(mapTopic);
}

export function getTopic(topicId: string): Topic | null {
  const row = getDb().prepare("SELECT * FROM topics WHERE id = ?").get(topicId) as
    | unknown as TopicRow
    | undefined;
  return row ? mapTopic(row) : null;
}

export function upsertTopic(topic: {
  id: string;
  title: string;
  description?: string;
  published?: boolean;
  order?: number;
  level?: CurriculumLevel;
  curriculumTheme?: CurriculumTheme | null;
  topicNumber?: number | null;
}): Topic {
  const db = getDb();
  const existing = getTopic(topic.id);
  const timestamp = nowIso();
  if (existing) {
    db.prepare(
      `UPDATE topics SET title = ?, description = ?, published = ?, sort_order = ?,
       level = ?, curriculum_theme = ?, topic_number = ?, updated_at = ? WHERE id = ?`,
    ).run(
      topic.title,
      topic.description ?? existing.description,
      toSqlBool(topic.published ?? existing.published),
      topic.order ?? existing.order,
      topic.level ?? existing.level,
      topic.curriculumTheme === undefined ? existing.curriculumTheme : topic.curriculumTheme,
      topic.topicNumber === undefined ? existing.topicNumber : topic.topicNumber,
      timestamp,
      topic.id,
    );
  } else {
    db.prepare(
      `INSERT INTO topics
       (id, title, description, published, sort_order, level, curriculum_theme, topic_number, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      topic.id,
      topic.title,
      topic.description ?? "",
      toSqlBool(topic.published ?? false),
      topic.order ?? 0,
      topic.level ?? 1,
      topic.curriculumTheme ?? null,
      topic.topicNumber ?? null,
      timestamp,
      timestamp,
    );
  }
  const saved = getTopic(topic.id);
  if (!saved) throw new Error(`課題儲存失敗：${topic.id}`);
  return saved;
}

export function setTopicPublished(topicId: string, published: boolean): Topic | null {
  const db = getDb();
  db.prepare("UPDATE topics SET published = ?, updated_at = ? WHERE id = ?").run(
    toSqlBool(published),
    nowIso(),
    topicId,
  );
  return getTopic(topicId);
}

export function listSections(topicId: string): Section[] {
  const rows = getDb()
    .prepare("SELECT * FROM sections WHERE topic_id = ? ORDER BY sort_order ASC, title ASC")
    .all(topicId) as unknown as SectionRow[];
  return rows.map(mapSection);
}

export function getSection(sectionId: string): Section | null {
  const row = getDb().prepare("SELECT * FROM sections WHERE id = ?").get(sectionId) as
    | unknown as SectionRow
    | undefined;
  return row ? mapSection(row) : null;
}

export function upsertSection(section: {
  id: string;
  topicId: string;
  parentId?: string | null;
  title: string;
  summary?: string;
  matchKeywords?: string[];
  order?: number;
}): Section {
  const db = getDb();
  const existing = getSection(section.id);
  const timestamp = nowIso();
  if (existing) {
    db.prepare(
      `UPDATE sections SET parent_id = ?, title = ?, summary = ?, match_keywords_json = ?,
       sort_order = ?, updated_at = ? WHERE id = ?`,
    ).run(
      section.parentId === undefined ? existing.parentId : section.parentId,
      section.title,
      section.summary ?? existing.summary,
      JSON.stringify(section.matchKeywords ?? existing.matchKeywords),
      section.order ?? existing.order,
      timestamp,
      section.id,
    );
  } else {
    db.prepare(
      `INSERT INTO sections
       (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      section.id,
      section.topicId,
      section.parentId ?? null,
      section.title,
      section.summary ?? "",
      JSON.stringify(section.matchKeywords ?? []),
      section.order ?? 0,
      timestamp,
      timestamp,
    );
  }
  const saved = getSection(section.id);
  if (!saved) throw new Error(`分節儲存失敗：${section.id}`);
  return saved;
}

export function deleteSection(sectionId: string): void {
  getDb().prepare("DELETE FROM sections WHERE id = ?").run(sectionId);
}

/**
 * 將選取的分節展開為「自身 + 所有子分節」，讓學生選擇父分節時也能取得子分節內容。
 */
export function expandSectionIds(topicId: string, sectionIds: string[]): string[] {
  const all = listSections(topicId);
  const byParent = new Map<string | null, Section[]>();
  for (const section of all) {
    const key = section.parentId;
    const list = byParent.get(key) ?? [];
    list.push(section);
    byParent.set(key, list);
  }

  const result = new Set<string>();
  const visit = (id: string) => {
    if (result.has(id)) return;
    result.add(id);
    for (const child of byParent.get(id) ?? []) visit(child.id);
  };

  for (const id of sectionIds) {
    if (all.some((section) => section.id === id)) visit(id);
  }
  return [...result];
}

export function sectionTitleMap(topicId: string): Map<string, string> {
  return new Map(listSections(topicId).map((section) => [section.id, section.title]));
}

interface QuestionCountRow {
  section_id: string;
  total: number;
}

function publishedQuestionCounts(topicId: string): Map<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT section_id, COUNT(*) AS total FROM questions
       WHERE topic_id = ? AND status = 'published' GROUP BY section_id`,
    )
    .all(topicId) as unknown as QuestionCountRow[];
  return new Map(rows.map((row) => [row.section_id, row.total]));
}

/** 各分節直接掛載的教材段落數（不含子分節） */
function directMaterialBlockCounts(topicId: string): Map<string, number> {
  const rows = getDb()
    .prepare(
      // 標題只是結構，不能用來出題，因此不計入「可出題的教材段落數」
      `SELECT section_id, COUNT(*) AS total FROM material_blocks
       WHERE topic_id = ? AND section_id IS NOT NULL AND type <> 'heading' GROUP BY section_id`,
    )
    .all(topicId) as unknown as QuestionCountRow[];
  return new Map(rows.map((row) => [row.section_id, row.total]));
}

export function countMaterialBlocks(topicId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS total FROM material_blocks WHERE topic_id = ?")
    .get(topicId) as unknown as { total: number } | undefined;
  return row?.total ?? 0;
}

export function getTopicOverviews(
  learnerId: string | null,
  options: { publishedOnly?: boolean } = {},
): TopicOverview[] {
  return listTopics(options).map((topic) => buildOverview(topic, learnerId));
}

export function getTopicOverview(topicId: string, learnerId: string | null): TopicOverview | null {
  const topic = getTopic(topicId);
  return topic ? buildOverview(topic, learnerId) : null;
}

function buildOverview(topic: Topic, learnerId: string | null): TopicOverview {
  const counts = publishedQuestionCounts(topic.id);
  const materialCounts = directMaterialBlockCounts(topic.id);
  const studentMaterialCounts = studentMaterialBlockCounts(topic.id);
  const allSections = listSections(topic.id);
  const byParent = new Map<string | null, Section[]>();
  for (const section of allSections) {
    const key = section.parentId;
    const list = byParent.get(key) ?? [];
    list.push(section);
    byParent.set(key, list);
  }

  const withDescendants = (section: Section): Section[] => [
    section,
    ...(byParent.get(section.id) ?? []).flatMap(withDescendants),
  ];

  const sumFor = (lookup: Map<string, number>, section: Section): number =>
    withDescendants(section).reduce((total, item) => total + (lookup.get(item.id) ?? 0), 0);

  const materialFor = (section: Section): number => sumFor(materialCounts, section);
  // 學生端介面只可用這個數字判斷可否出題（見 studentMaterialBlockCounts 的說明）
  const studentMaterialFor = (section: Section): number => sumFor(studentMaterialCounts, section);

  const topLevel = (byParent.get(null) ?? []).map((section) => {
    const descendants = withDescendants(section);
    const children = (byParent.get(section.id) ?? []).map((child) => ({
      ...child,
      publishedQuestionCount: counts.get(child.id) ?? 0,
      materialBlockCount: materialFor(child),
      studentMaterialBlockCount: studentMaterialFor(child),
    }));
    return {
      ...section,
      children,
      publishedQuestionCount: descendants.reduce(
        (total, item) => total + (counts.get(item.id) ?? 0),
        0,
      ),
      materialBlockCount: materialFor(section),
      studentMaterialBlockCount: studentMaterialFor(section),
    };
  });

  const progress = learnerId
    ? getLearnerProgress(learnerId, topic.id)
    : { completedSessions: 0, answeredQuestions: 0, correctAnswers: 0, accuracy: null };

  return {
    ...topic,
    levelLabel: CURRICULUM_LEVEL_LABELS[topic.level] ?? "",
    themeText: curriculumThemeText(topic.level, topic.curriculumTheme),
    sections: topLevel,
    totalPublishedQuestions: [...counts.values()].reduce((total, value) => total + value, 0),
    progress,
    materialReady: countMaterialBlocks(topic.id) > 0,
  };
}

/** 匯入教材時使用：一次建立課題及分節結構（可重複執行，具幂等性） */
export function seedTopicStructure(input: {
  topic: {
    id: string;
    title: string;
    description: string;
    order: number;
    published: boolean;
    level?: CurriculumLevel;
    curriculumTheme?: CurriculumTheme | null;
    topicNumber?: number | null;
  };
  sections: {
    id: string;
    title: string;
    summary?: string;
    matchKeywords?: string[];
    children?: { id: string; title: string; summary?: string; matchKeywords?: string[] }[];
  }[];
}): { topic: Topic; sections: Section[] } {
  const db = getDb();
  return withTransaction(db, () => {
    const topic = upsertTopic({
      id: input.topic.id,
      title: input.topic.title,
      description: input.topic.description,
      order: input.topic.order,
      published: input.topic.published,
      level: input.topic.level,
      curriculumTheme: input.topic.curriculumTheme,
      topicNumber: input.topic.topicNumber,
    });
    const sections: Section[] = [];
    input.sections.forEach((section, index) => {
      sections.push(
        upsertSection({
          id: section.id,
          topicId: topic.id,
          parentId: null,
          title: section.title,
          summary: section.summary ?? "",
          matchKeywords: section.matchKeywords,
          order: index,
        }),
      );
      section.children?.forEach((child, childIndex) => {
        sections.push(
          upsertSection({
            id: child.id,
            topicId: topic.id,
            parentId: section.id,
            title: child.title,
            summary: child.summary ?? "",
            matchKeywords: child.matchKeywords,
            order: childIndex,
          }),
        );
      });
    });
    return { topic, sections };
  });
}
