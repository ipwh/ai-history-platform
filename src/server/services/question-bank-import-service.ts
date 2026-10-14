/**
 * 校內試題匯入服務：把解析後的試題寫入題庫（草稿狀態，待教師審核）。
 *
 * 設計原則：
 *   1. 答案一律來自試題檔的答案區，程式不會自行推測（無法確定的題目會略過）。
 *   2. 匯入的題目狀態一律為「草稿」，教師在題目管理核對後才發布給學生。
 *   3. 不考核的內容（課題1 的新月沃土／黃河、長江流域／印度河流域文明）不會匯入。
 *   4. 題目 ID 由來源編號推導（穩定），重複匯入會更新同一題，不會產生重複題目。
 */
import { questionSchema, type Question, type Section } from "../../lib/types";
import { nowIso } from "../db/connection";
import { isExcludedText } from "../materials/exclusions";
import { parseQuestionBank, type ParsedBankQuestion } from "../materials/question-bank";
import { normalizeForMatch, truncate } from "../materials/text-utils";
import { getQuestion, insertQuestion, updateQuestion } from "../repositories/questions";
import { listSections } from "../repositories/topics";

export interface QuestionBankImportInput {
  topicId: string;
  fileName: string;
  /** 試題檔的純文字內容（DOCX 解析後） */
  text: string;
}

export interface QuestionBankImportResult {
  fileType: string;
  /** 成功寫入（新增或更新）的題目數 */
  imported: number;
  /** 因為不考核範圍而略過的題目數 */
  excluded: number;
  /** 無法忠實轉換而略過的題目（附原因） */
  skipped: { sourceId: string; reason: string }[];
  /** 各分節的題目數（用於報告） */
  bySection: { sectionId: string; title: string; count: number }[];
  /** 需要原檔圖片才能作答的題目數（已標示品質警告） */
  withQualityWarnings: number;
  warnings: string[];
}

/**
 * 依題目文字與單元標題找出最合適的分節。
 * 先用分節的比對關鍵詞（含子分節）計分，取最高分者；完全不匹配時回傳 null，
 * 由呼叫端改掛到課題的第一個分節（避免題目沒有分節而無法使用）。
 */
export function matchSection(
  question: ParsedBankQuestion,
  sections: Section[],
): Section | null {
  const haystack = normalizeForMatch(`${question.unitTitle} ${question.question}`);
  if (haystack.length === 0) return null;

  let best: Section | null = null;
  let bestScore = 0;
  for (const section of sections) {
    let score = 0;
    for (const keyword of section.matchKeywords) {
      const needle = normalizeForMatch(keyword);
      if (needle.length >= 2 && haystack.includes(needle)) score += needle.length;
    }
    const title = normalizeForMatch(section.title);
    if (title.length >= 3 && haystack.includes(title)) score += title.length + 4;
    if (score > bestScore) {
      best = section;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

function buildQuestion(
  source: ParsedBankQuestion,
  topicId: string,
  sectionId: string,
  fileName: string,
  ordinal: number,
): Question {
  const explanationParts = [source.explanation].filter((part) => part.trim().length > 0);
  const explanation =
    explanationParts.length > 0 ? explanationParts.join("\n") : "答案依校內試題檔的評卷參考。";
  const knowledgePoint = source.unitTitle.trim().length > 0 ? source.unitTitle : "校內試題";

  return questionSchema.parse({
    id: `qb-${source.sourceId}`,
    topicId,
    sectionId,
    questionType: source.questionType ?? "mc",
    difficulty: source.difficulty,
    question: source.question,
    options: source.options,
    correctAnswer:
      source.questionType === "short" ? "（短答題，由教師按得分要點評分）" : source.correctAnswer,
    acceptedAnswers: [],
    explanation,
    knowledgePoint,
    sourceExcerpt: truncate(source.question, 240),
    sourceLocation: `${fileName} · 第 ${ordinal} 題${
      source.unitTitle.length > 0 ? ` · ${source.unitTitle}` : ""
    }`,
    sourceBlockIds: [],
    gradingPoints: source.questionType === "short" ? source.gradingPoints : [],
    origin: "school-paper",
    // 校內試題由教師核對後才發布；答案直接取自試題檔，並非 AI 生成
    status: "draft",
    // 來源是校內試題檔本身（不是教材段落），因此不以教材依據核對標示
    sourceVerified: false,
    qualityWarnings: source.qualityWarnings,
    createdAt: nowIso(),
  });
}

/** 匯入一份試題檔（回傳統計；題目一律為草稿） */
export function importQuestionBank(input: QuestionBankImportInput): QuestionBankImportResult {
  const parsed = parseQuestionBank(input.text, input.fileName);
  const sections = listSections(input.topicId);
  const bySection = new Map<string, number>();
  let imported = 0;
  let excluded = 0;
  const skipped = [...parsed.skipped];

  parsed.questions.forEach((question, index) => {
    // 不考核的內容不會進入題庫（例如課題1 的印度河流域文明題目）
    if (isExcludedText(input.topicId, `${question.unitTitle} ${question.question} ${question.explanation}`)) {
      excluded += 1;
      return;
    }

    const matched = matchSection(question, sections);
    const sectionId = matched?.id ?? sections[0]?.id;
    if (!sectionId) {
      skipped.push({ sourceId: question.sourceId, reason: "課題沒有可用的分節" });
      return;
    }

    const question_ = buildQuestion(question, input.topicId, sectionId, input.fileName, index + 1);
    if (getQuestion(question_.id)) updateQuestion(question_.id, question_);
    else insertQuestion(question_);
    imported += 1;
    bySection.set(sectionId, (bySection.get(sectionId) ?? 0) + 1);
  });

  const warnings = [...parsed.warnings];
  if (excluded > 0) {
    warnings.push(`有 ${excluded} 題屬不考核範圍（新月沃土／黃河、長江流域／印度河），已略過。`);
  }
  if (skipped.length > 0) {
    warnings.push(`有 ${skipped.length} 題未能匯入（平台尚未支援該題型或格式不完整）。`);
  }

  return {
    fileType: parsed.fileType,
    imported,
    excluded,
    skipped,
    bySection: [...bySection.entries()].map(([sectionId, count]) => ({
      sectionId,
      title: sections.find((section) => section.id === sectionId)?.title ?? sectionId,
      count,
    })),
    withQualityWarnings: parsed.questions.filter((question) => question.qualityWarnings.length > 0)
      .length,
    warnings,
  };
}
