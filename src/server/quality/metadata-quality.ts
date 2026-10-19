/**
 * 知識點、難度及技能元數據的品質規則（純函式）。
 *
 * 只回報問題，不會猜測或填入任何值。嚴重程度：
 *   - `blocking`：資料關聯錯誤，可能令組卷、篩選或進度統計指向錯誤課題；
 *   - `needs_review`：需要教師確認（例如知識點與分節不符）；
 *   - `warning`：不影響答案正確性，但降低分析或顯示質素。
 */
import { DIFFICULTIES, type Difficulty } from "../../lib/types";

export type MetadataSeverity = "blocking" | "needs_review" | "warning";

export type MetadataCode =
  | "TOPIC_MISSING"
  | "SECTION_MISSING"
  | "SECTION_TOPIC_MISMATCH"
  | "DIFFICULTY_INVALID"
  | "KNOWLEDGE_POINT_EMPTY"
  | "KNOWLEDGE_POINT_LAYOUT_RESIDUE"
  | "KNOWLEDGE_POINT_GENERIC"
  | "KNOWLEDGE_POINT_UNMAPPED"
  | "SKILL_MISSING";

export interface MetadataIssue {
  code: MetadataCode;
  severity: MetadataSeverity;
  message: string;
}

export interface MetadataQualityInput {
  topicId: string;
  sectionId: string;
  knowledgePoint: string;
  difficulty: string;
  skill: string | null;
  topicExists: boolean;
  sectionExists: boolean;
  sectionTopicId: string | null;
  /** 同一課題內的分節標題，用於判斷知識點是否可對應。 */
  sectionTitles: string[];
}

export interface MetadataQualityResult {
  issues: MetadataIssue[];
  /** 需要阻擋派發／組卷的關聯錯誤（不涉及內容對錯）。 */
  blocking: boolean;
}

/** 匯入時使用的通用知識點標籤，不是分節名稱。 */
export const GENERIC_KNOWLEDGE_POINTS: readonly string[] = ["校內試題"];

const LAYOUT_RESIDUE_PATTERNS: readonly RegExp[] = [
  /^[A-D]\s*[.、．]\s*(?:[ivx]+(?:[、,，]\s*[ivx]+)*|[A-Z])$/i,
  /^[A-D]\s*[.、．].*[A-Z]$/,
];

export function normaliseKnowledgePoint(value: string): string {
  return value
    .replace(/^[A-Za-z]\s*[.、．]\s*/, "")
    .replace(/[\s（）()：:、,，.。'"「」]/g, "")
    .toLowerCase();
}

export function isLayoutResidueKnowledgePoint(value: string): boolean {
  return LAYOUT_RESIDUE_PATTERNS.some((pattern) => pattern.test(value.trim()));
}

export function isGenericKnowledgePoint(value: string): boolean {
  return GENERIC_KNOWLEDGE_POINTS.includes(value.trim());
}

/**
 * 知識點是否可對應到同課題的分節標題。只作提示，不自動改寫。
 * 兩邊互相包含即視為可對應（課程指引的章節名稱常較分節標題長）。
 */
export function knowledgePointMapsToSection(
  knowledgePoint: string,
  sectionTitles: string[],
): boolean {
  const point = normaliseKnowledgePoint(knowledgePoint);
  if (point.length === 0) return false;
  return sectionTitles.some((title) => {
    const section = normaliseKnowledgePoint(title);
    if (section.length === 0) return false;
    return section.includes(point) || point.includes(section);
  });
}

export function assessMetadata(input: MetadataQualityInput): MetadataQualityResult {
  const issues: MetadataIssue[] = [];

  if (!input.topicExists) {
    issues.push({
      code: "TOPIC_MISSING",
      severity: "blocking",
      message: `課題 ${input.topicId} 不存在`,
    });
  }
  if (!input.sectionExists) {
    issues.push({
      code: "SECTION_MISSING",
      severity: "blocking",
      message: `分節 ${input.sectionId} 不存在`,
    });
  } else if (input.sectionTopicId !== null && input.sectionTopicId !== input.topicId) {
    issues.push({
      code: "SECTION_TOPIC_MISMATCH",
      severity: "blocking",
      message: `分節 ${input.sectionId} 屬於課題 ${input.sectionTopicId}，與題目的課題 ${input.topicId} 不一致`,
    });
  }

  if (!(DIFFICULTIES as readonly string[]).includes(input.difficulty)) {
    issues.push({
      code: "DIFFICULTY_INVALID",
      severity: "blocking",
      message: `難度「${(input.difficulty as Difficulty | string) ?? ""}」不在允許值（${DIFFICULTIES.join("／")}）`,
    });
  }

  const knowledgePoint = input.knowledgePoint.trim();
  if (knowledgePoint.length === 0) {
    issues.push({
      code: "KNOWLEDGE_POINT_EMPTY",
      severity: "needs_review",
      message: "知識點為空白，學習紀錄無法指向具體內容",
    });
  } else if (isLayoutResidueKnowledgePoint(knowledgePoint)) {
    issues.push({
      code: "KNOWLEDGE_POINT_LAYOUT_RESIDUE",
      severity: "needs_review",
      message: `知識點「${knowledgePoint}」是排版殘留，不是課題或分節名稱`,
    });
  } else if (isGenericKnowledgePoint(knowledgePoint)) {
    issues.push({
      code: "KNOWLEDGE_POINT_GENERIC",
      severity: "needs_review",
      message: `知識點「${knowledgePoint}」是匯入時的通用標籤，沒有指向分節`,
    });
  } else if (
    input.topicExists &&
    input.sectionExists &&
    !knowledgePointMapsToSection(knowledgePoint, input.sectionTitles)
  ) {
    issues.push({
      code: "KNOWLEDGE_POINT_UNMAPPED",
      severity: "needs_review",
      message: `知識點「${knowledgePoint}」與本課題任何分節標題都對不上（可能是錯配或課程指引章節名稱）`,
    });
  }

  if (input.skill === null || input.skill.trim().length === 0) {
    issues.push({
      code: "SKILL_MISSING",
      severity: "warning",
      message: "未標示歷史技能，技能進度分析會缺少這一題",
    });
  }

  return {
    issues,
    blocking: issues.some((issue) => issue.severity === "blocking"),
  };
}
