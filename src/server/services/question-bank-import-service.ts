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
import {
  blankAnswersFromExplanation,
  normaliseMultiBlankFill,
  parseQuestionBank,
  requiresOriginalImage,
  type ParsedBankQuestion,
} from "../materials/question-bank";
import { normalizeForMatch, truncate } from "../materials/text-utils";
import { getQuestion, insertQuestion, updateQuestion } from "../repositories/questions";
import { listSections } from "../repositories/topics";
import { checkQuestionServable } from "./question-servability";

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
  /** 需要原檔圖片才能作答而永久排除的題目數（平台未能顯示原圖） */
  excludedForImage: number;
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

/** 匯入前的題目整理結果：可用的題目，或不可用的原因 */
function prepareSourceQuestion(
  source: ParsedBankQuestion,
): { prepared: ParsedBankQuestion } | { skipReason: string } {
  if (source.questionType === "fill") {
    const answerList = [source.correctAnswer, ...source.gradingPoints]
      .map((answer) => answer.trim())
      .filter((answer) => answer.length > 0);
    const blanks = (source.question.match(/[＿_]{2,}/g) ?? []).length;

    if (blanks > 1) {
      // 一句有多個空格時，平台的單一輸入框只對應一個答案：把其餘空格的答案填回
      // 題幹，只保留一個空格（見 materials/question-bank.ts normaliseMultiBlankFill）。
      const normalised =
        normaliseMultiBlankFill(source.question, answerList) ??
        normaliseMultiBlankFill(source.question, blankAnswersFromExplanation(source.explanation));
      if (normalised === null) {
        return {
          skipReason: `填充題有 ${blanks} 個空格，但答案區只有 ${answerList.length} 個答案，未能確認每個空格的答案`,
        };
      }
      // 保留的空格不是原第 1 個空格時，被考核的內容已經改變：不可描述為等價，
      // 亦不可在未經教師確認下自動／批次發布（見 services/question-repair.ts）。
      const answerChanged =
        normalised.correctAnswer.trim() !== normalised.originalAnswer.trim();
      return {
        prepared: {
          ...source,
          question: normalised.question,
          correctAnswer: normalised.correctAnswer,
          requiresTeacherReview: answerChanged,
          explanation:
            source.explanation.trim().length > 0
              ? source.explanation
              : `原題有 ${blanks} 個空格，平台已把其餘空格的答案填入題幹，只考核第 ${normalised.assessedBlankIndex} 個空格。`,
          qualityWarnings: [
            ...source.qualityWarnings,
            answerChanged
              ? `原題有 ${blanks} 個空格；因平台每題只有一個輸入框，考核空格由第 1 個改為第 ${normalised.assessedBlankIndex} 個（原答案「${normalised.originalAnswer}」，現考核「${normalised.correctAnswer}」）。這**改變了考核內容**，必須由教師確認，不會自動發布。`
              : `原題有 ${blanks} 個空格，平台已把其餘空格的答案（${normalised.filled
                  .map((entry) => entry.answer)
                  .join("、")}）填入題幹，只考核第 1 個空格（考核答案不變）；請教師核對是否與原卷一致。`,
          ],
        },
      };
    }
  }

  const servability = checkQuestionServable({
    questionType: source.questionType ?? "mc",
    question: source.question,
    options: source.options,
    correctAnswer: source.correctAnswer,
  });
  if (!servability.ok) {
    // 結構上無法作答（題幹沒有空格、選項是空白或重複、答案不在選項內等）：
    // 沿用單一判斷來源，避免匯入了學生根本答不到的題目。
    if (source.questionType === "fill" || source.questionType === "mc") {
      return { skipReason: servability.reason ?? "題目結構不完整" };
    }
  }

  return { prepared: source };
}

function buildQuestion(
  source: ParsedBankQuestion,
  topicId: string,
  sectionId: string,
  fileName: string,
  ordinal: number,
  questionId: string,
): Question {
  const explanationParts = [source.explanation].filter((part) => part.trim().length > 0);
  const explanation =
    explanationParts.length > 0 ? explanationParts.join("\n") : "答案依校內試題檔的評卷參考。";
  const knowledgePoint = source.unitTitle.trim().length > 0 ? source.unitTitle : "校內試題";
  return questionSchema.parse({
    id: questionId,
    topicId,
    sectionId,
    questionType: source.questionType ?? "mc",
    difficulty: source.difficulty,
    question: source.question,
    options: source.options,
    correctAnswer: source.correctAnswer,
    acceptedAnswers: [],
    explanation,
    knowledgePoint,
    sourceExcerpt: truncate(source.question, 240),
    sourceLocation: `${fileName} · 第 ${ordinal} 題${
      source.unitTitle.length > 0 ? ` · ${source.unitTitle}` : ""
    }`,
    sourceBlockIds: [],
    gradingPoints: [],
    origin: "school-paper",
    // 校內試題由教師核對後才發布；答案直接取自試題檔，並非 AI 生成
    status: "draft",
    // 來源是校內試題檔本身（不是教材段落），因此不以教材依據核對標示
    sourceVerified: false,
    qualityWarnings: source.qualityWarnings,
    // 整理時改變了考核內容（例如多空格填充題改考另一個空格）：一律暫緩發布，
    // 由教師確認後才可發布，避免匯入流程靜默改寫答案。
    teacherConfirmationRequired: source.requiresTeacherReview === true,
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
  let excludedForImage = 0;
  let importedWithWarnings = 0;
  const skipped = [...parsed.skipped];
  /** 同一份檔案的題號出現次數：原卷重複使用題號時，後續題目以「-2」「-3」後綴保存 */
  const idOccurrences = new Map<string, number>();
  const duplicateSourceIds: string[] = [];

  parsed.questions.forEach((question, index) => {
    // 需要原檔圖片才能作答的題目永久排除：平台只保存文字，未能顯示原圖，
    // 學生看到也無法作答（見 materials/question-bank.ts 的 requiresOriginalImage）。
    if (requiresOriginalImage(question.question)) {
      excludedForImage += 1;
      return;
    }

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

    // 題目 ID 仍由來源題號推導（重複匯入會更新同一題），但同一檔案內題號重複時
    // 不可覆寫前一題（原卷確有不同題目共用同一題號），否則會靜默丟失題目。
    const occurrence = (idOccurrences.get(question.sourceId) ?? 0) + 1;
    idOccurrences.set(question.sourceId, occurrence);
    if (occurrence > 1 && !duplicateSourceIds.includes(question.sourceId)) {
      duplicateSourceIds.push(question.sourceId);
    }
    const questionId =
      occurrence === 1 ? `qb-${question.sourceId}` : `qb-${question.sourceId}-${occurrence}`;

    const preparation = prepareSourceQuestion(question);
    if ("skipReason" in preparation) {
      skipped.push({ sourceId: question.sourceId, reason: preparation.skipReason });
      return;
    }

    const built = buildQuestion(
      preparation.prepared,
      input.topicId,
      sectionId,
      input.fileName,
      index + 1,
      questionId,
    );
    if (getQuestion(built.id)) updateQuestion(built.id, built);
    else insertQuestion(built);
    imported += 1;
    if (built.qualityWarnings.length > 0) importedWithWarnings += 1;
    bySection.set(sectionId, (bySection.get(sectionId) ?? 0) + 1);
  });

  const warnings = [...parsed.warnings];
  if (duplicateSourceIds.length > 0) {
    warnings.push(
      `有 ${duplicateSourceIds.length} 個題號在原檔重複出現（${duplicateSourceIds
        .slice(0, 5)
        .join("、")}${duplicateSourceIds.length > 5 ? "…" : ""}），重複題目已以「-2」「-3」後綴保存，請教師核對原卷。`,
    );
  }
  if (excluded > 0) {
    warnings.push(`有 ${excluded} 題屬不考核範圍（新月沃土／黃河、長江流域／印度河），已略過。`);
  }
  if (excludedForImage > 0) {
    warnings.push(
      `有 ${excludedForImage} 題需要原檔圖片（地圖／漫畫／照片等）才能作答，平台未能顯示原圖，已永久排除（不會進入題庫）。`,
    );
  }
  if (skipped.length > 0) {
    const structural = skipped.filter((entry) => entry.reason.includes("空格") || entry.reason.includes("選項"));
    warnings.push(
      `有 ${skipped.length} 題未能匯入（平台尚未支援該題型、格式不完整或題目結構無法作答）` +
        (structural.length > 0
          ? `；其中 ${structural.length} 題是題幹空格數與答案數不符，或選項在解析後已失效，需由教師按原卷修正`
          : "") +
        "。",
    );
  }

  return {
    fileType: parsed.fileType,
    imported,
    excluded,
    excludedForImage,
    skipped,
    bySection: [...bySection.entries()].map(([sectionId, count]) => ({
      sectionId,
      title: sections.find((section) => section.id === sectionId)?.title ?? sectionId,
      count,
    })),
    withQualityWarnings: importedWithWarnings,
    warnings,
  };
}
