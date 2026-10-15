/**
 * 學生閱讀教材（學習模式）。
 *
 * 目的：讓學生在作答之前先讀一次該課題／分節的教材內容，令自學流程完整
 * （先學習、後練習），毋須教師在場講解。
 *
 * 設計重點：
 *   1. 只提供**已發布**課題的教材；未發布的課題一律回 404，避免學生看到未完成內容。
 *   2. 只使用「可用於出題」的段落（`listGroundingBlocksForSections`），
 *      因此校內試題檔（含答案）不會出現在閱讀內容中。
 *   3. **只顯示課文內容**：課本檔案是**教師版**，除課文外還夾附「資料題」練習及其
 *      評分參考（例如「（3分）」、「資料線索：」、「（個人所知）」）。這些內容不屬課文，
 *      部分更是答案，因此一律不顯示（見下方 EXERCISE_TEXT_PATTERNS）。同樣不顯示的還有
 *      時間軸／表格碎片（例如單獨一段「公元前3,500年」）、無法辨識的 OCR 雜散文字，
 *      以及匯入時插入的圖片佔位標記 `[[IMAGE_UNEXTRACTED]]`。
 *   4. 內容**原樣取自已匯入的教材**，不作改寫、不經 AI 生成：教材是唯一的史實來源，
 *      任何自動改寫都可能加入未經核實的歷史陳述。
 *   5. OCR 辨識出來的文字會標示（可能與原書有出入，提示學生對照課本）。
 */
import {
  CURRICULUM_LEVEL_LABELS,
  CURRICULUM_THEMES,
  lessonViewSchema,
  type LessonBlock,
  type LessonSection,
  type LessonView,
} from "../../lib/types";
import { listGroundingBlocksForSections, listStudentDistributableDocumentIds } from "../repositories/materials";
import { getTopic, listSections } from "../repositories/topics";
import { isTeacherOnlyBlockText } from "../materials/teacher-content";
import {
  isExerciseOrAnswerText,
  isStandaloneNumberText,
  stripImageMarkers,
} from "../materials/content-policy";
import { isGarbledOcrText, stripPageReferences } from "../materials/text-utils";
import { stripOcrAnnotation } from "./ocr-text";

export class LessonServiceError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "LessonServiceError";
    this.status = status;
  }
}

/** OCR 說明行的樣式（不應顯示給學生閱讀） */
const OCR_NOTE = /^以上文字由 OCR/;

function toLessonBlock(block: {
  id: string;
  type: string;
  level: number | null;
  text: string;
  table: { text: string }[][] | null;
  sourceLocation: string;
  extractionMethod: string;
}): LessonBlock | null {
  const rawText = stripImageMarkers(stripOcrAnnotation(stripPageReferences(block.text))).trim();
  const fromOcr = block.extractionMethod === "ocr";

  // 沒有 OCR 文字的圖片沒有任何可讀內容
  if (block.type === "image" && !fromOcr) return null;

  const rows =
    block.type === "table" && block.table
      ? block.table.map((row) => row.map((cell) => stripImageMarkers(stripOcrAnnotation(cell.text)).trim()))
      : [];

  // 表格即使沒有文字內容（例如只有圖片）亦保留，讓學生看到結構
  if (rawText.length === 0 && rows.length === 0) return null;

  return {
    id: block.id,
    type: block.type as LessonBlock["type"],
    level: block.level,
    // 移除說明行後可能只剩空白
    text: OCR_NOTE.test(rawText) ? "" : rawText,
    rows,
    sourceLocation: block.sourceLocation,
    fromOcr,
  };
}

/**
 * 取得某課題（可指定分節）的閱讀內容。
 *
 * @throws LessonServiceError 找不到課題、課題未發布或沒有內容時。
 */
export function getLessonView(topicId: string, sectionIds: string[] = []): LessonView {
  const topic = getTopic(topicId);
  if (!topic) throw new LessonServiceError("找不到指定的課題", 404);
  if (!topic.published) {
    throw new LessonServiceError("這個課題尚未發布，暫時未能閱讀。", 404);
  }

  const allSections = listSections(topicId);
  const selected = sectionIds.length > 0 ? new Set(sectionIds) : null;

  const blocks = listGroundingBlocksForSections(topicId, sectionIds);
  // 版權閘門：只顯示管理員已明確確認可在平台內向學生發布的教材文件。
  // 沒有任何授權紀錄時預設一律不顯示（fail-closed），見 migration 0011 及 README。
  const distributable = listStudentDistributableDocumentIds();
  const blocksBySection = new Map<string, LessonBlock[]>();
  let hasOcrText = false;
  let hiddenByLicence = 0;
  let hiddenTeacherContent = 0;
  let hiddenExerciseContent = 0;
  let hiddenFragmentContent = 0;

  for (const block of blocks) {
    if (block.sectionId === null) continue;
    if (selected !== null && !selected.has(block.sectionId)) continue;
    if (!distributable.has(block.documentId)) {
      hiddenByLicence += 1;
      continue;
    }

    // 教師專用內容（答案、評分參考）一律不顯示給學生：課本檔案是**教師版**，
    // 「不是校內試題檔」不等於整份文件都適合學生閱讀（見 materials/teacher-content.ts）。
    const blockText = [block.text, ...(block.table ?? []).flat().map((cell) => cell.text)].join("\n");
    if (isTeacherOnlyBlockText(blockText)) {
      hiddenTeacherContent += 1;
      continue;
    }

    // 只顯示課文內容：練習題目及其評分參考（「（3分）」、「資料線索：」）不是課文，
    // 部分更是答案，因此不顯示；單獨一段的年份／數字碎片亦沒有可讀內容。
    if (isExerciseOrAnswerText(blockText)) {
      hiddenExerciseContent += 1;
      continue;
    }
    // 無法辨識的 OCR 雜散文字（零散單字、字母與數字）沒有閱讀價值
    if (block.extractionMethod === "ocr" && isGarbledOcrText(blockText)) {
      hiddenFragmentContent += 1;
      continue;
    }

    const lessonBlock = toLessonBlock(block);
    if (lessonBlock === null) continue;
    if (lessonBlock.fromOcr) hasOcrText = true;
    if (lessonBlock.type !== "table" && isStandaloneNumberText(lessonBlock.text)) {
      hiddenFragmentContent += 1;
      continue;
    }

    const list = blocksBySection.get(block.sectionId) ?? [];
    list.push(lessonBlock);
    blocksBySection.set(block.sectionId, list);
  }

  // 依分節的課程次序排列（父分節在前，其子分節緊隨其後）
  const depthOf = new Map<string, number>();
  for (const section of allSections) {
    depthOf.set(section.id, section.parentId === null ? 0 : 1);
  }

  const sections: LessonSection[] = [];
  for (const section of allSections) {
    const sectionBlocks = blocksBySection.get(section.id);
    if (sectionBlocks === undefined || sectionBlocks.length === 0) continue;
    sections.push({
      id: section.id,
      title: section.title,
      parentId: section.parentId,
      depth: depthOf.get(section.id) ?? 0,
      blocks: sectionBlocks,
    });
  }

  const notice =
    sections.length === 0
      ? hiddenByLicence > 0
        ? "這個課題的教材尚未開放學生閱讀。平台不會在未確認版權的情況下發布教材內容，請聯絡歷史科教師或管理員。"
        : hiddenExerciseContent > 0
          ? "這個課題的教材只有練習題目及評分參考，未包含可閱讀的課文內容。請使用練習功能，或請教師補充課文。"
          : "這個課題的教材尚未匯入，暫時未有可閱讀的內容。請先使用練習功能，或請教師上載教材。"
      : hiddenTeacherContent > 0 || hiddenExerciseContent > 0 || hiddenFragmentContent > 0
        ? "閱讀模式只顯示課文內容：教材內的練習題目、評分參考、答案及零散文字不會顯示。如需練習，請使用練習功能。"
        : null;

  return lessonViewSchema.parse({
    topic: {
      id: topic.id,
      title: topic.title,
      level: topic.level,
      levelLabel: CURRICULUM_LEVEL_LABELS[topic.level] ?? "",
      themeTitle: topic.level === 0 ? "" : (CURRICULUM_THEMES[topic.level]?.title ?? ""),
    },
    sections,
    hasOcrText,
    notice,
    withheldTeacherBlocks: hiddenTeacherContent,
  });
}

/**
 * 供課題清單顯示「有沒有教材可讀」。
 * 與 getLessonView 使用同一套判斷：已確認可發布、非教師專用、且不是練習題目／評分參考／
 * 零散文字（否則課題清單會顯示可閱讀，但點進去只有練習題目）。
 */
export function topicHasLesson(topicId: string): boolean {
  const distributable = listStudentDistributableDocumentIds();
  return listGroundingBlocksForSections(topicId, []).some((block) => {
    if (!distributable.has(block.documentId)) return false;
    const blockText = [block.text, ...(block.table ?? []).flat().map((cell) => cell.text)].join("\n");
    if (isTeacherOnlyBlockText(blockText)) return false;
    if (isExerciseOrAnswerText(blockText)) return false;
    if (block.extractionMethod === "ocr" && isGarbledOcrText(blockText)) return false;
    const lessonBlock = toLessonBlock(block);
    if (lessonBlock === null) return false;
    if (lessonBlock.type !== "table" && isStandaloneNumberText(lessonBlock.text)) return false;
    return true;
  });
}
