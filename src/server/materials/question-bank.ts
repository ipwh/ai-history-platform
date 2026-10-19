/**
 * 校內試題檔（DOCX）解析。
 *
 * 校內題庫檔案有兩種排版，兩者都是結構化標記，本解析器都會支援：
 *
 * **甲式（`[[ … ]]` 區塊）**
 *
 *   [[<題目編號>
 *   題目文字
 *   @O                       ← 選項開始（只有選擇題）
 *   A. 選項一 ……
 *   ❒
 *   ##                       ← 答案開始
 *   答案
 *   @@                       ← 補充內容（部分題型有更正說明）
 *   {{}}
 *   d:0;
 *   t:<類型>; nil:<空數>
 *   ]]
 *
 * **乙式（`|!|題號|!|` 標記）**
 *
 *   |!|NJCMN0060000001|!|
 *   題目文字
 *   選項一／選項二／選項三／選項四
 *   ##A##                    ← 答案以 `##` 前後包住
 *   @@x)nil,1@@              ← 後設資料（題型、空格數）
 *   [[]]                     ← 區塊結束（不是題目內容）
 *
 * 類型標記：`mc` 選擇題、`fb` 填充題、`sq` 是非題／短答題、`mg` 配對題、`nil` 時序題等。
 *
 * 這個解析器只做「忠實轉換」：答案一定取自檔案的答案區，不會自行推測；
 * 無法確定的題目會略過並記錄原因，交由教師處理（絕不猜測作答內容）。
 * 題目若需要原檔圖片（地圖、漫畫、照片等）才能作答，會加上品質警告，
 * 提醒教師審核時確認，避免學生看到無法作答的題目。
 */
import type { Difficulty, QuestionType } from "../../lib/types";
import { answerLeaksIntoStem, countBlankMarkers, FILL_BLANK } from "../llm/fill-question";

export type QuestionBankFileType = "MCQ" | "FBQ" | "TFQ" | "MUQ" | "COQ" | "LAQ" | "DBQ";

export interface ParsedBankQuestion {
  /** 檔案內的題目編號（例如 JTH2ndEdMCQ01001） */
  sourceId: string;
  /** 檔案類型（由檔名或 t: 標記判斷） */
  fileType: QuestionBankFileType;
  /** 題目所屬的單元標題（例如「A. 石器時代的演進」） */
  unitTitle: string;
  question: string;
  /** 平台題型；null 表示平台尚未支援（例如配對題、時序題） */
  questionType: QuestionType | null;
  options: string[];
  correctAnswer: string;
  /** 補充說明（例如是非題的正確說法、填充題多個空的答案順序） */
  explanation: string;
  /** 短答題的得分要點（由評卷參考的「（N 分）」段落拆出） */
  gradingPoints: string[];
  difficulty: Difficulty;
  /** 品質警告（只供教師端顯示，學生端看不到） */
  qualityWarnings: string[];
  /**
   * 整理題目時改變了被考核的內容（例如多空格填充題保留的不是原第 1 個空格）。
   *
   * 這種題目**必須**由教師確認，不可計入自動發布或批次發布（見
   * services/question-repair.ts 及 questions.teacher_confirmation_required）。
   */
  requiresTeacherReview?: boolean;
}

export interface SkippedBankQuestion {
  sourceId: string;
  reason: string;
}

export interface QuestionBankParseResult {
  fileType: QuestionBankFileType;
  questions: ParsedBankQuestion[];
  skipped: SkippedBankQuestion[];
  warnings: string[];
}

const QUESTION_BANK_TYPES = ["MCQ", "FBQ", "TFQ", "MUQ", "COQ", "LAQ", "DBQ"] as const;

/**
 * 英文類型標記：`HNC1A2E_QB_T1_1.MCQ.docx`（正式題庫檔）或
 * `課題1人類的需要 古與今_MCQ.docx`（教師自行命名的試題檔，2026-10 新教材）。
 */
const ASCII_TYPE_PATTERN = /[._\s-]([A-Za-z]{2,3})\.docx$/;

/** 中文題型後綴（教師自行命名時常用，例如「…_填充題.docx」） */
const CHINESE_TYPE_SUFFIXES: readonly [RegExp, QuestionBankFileType][] = [
  [/選擇題$/, "MCQ"],
  [/填充題$/, "FBQ"],
  [/是非題$/, "TFQ"],
  [/配對題$/, "MUQ"],
  [/時序題$/, "COQ"],
  [/(?:長答題|短答題|問答題)$/, "LAQ"],
  [/資料題$/, "DBQ"],
];

/**
 * 由檔名判斷試題類型，例如 HNC1A2E_QB_T1_1.MCQ.docx → MCQ、
 * 課題1人類的需要 古與今_填充題.docx → FBQ。
 * 只按檔名判斷，因此課本內容（例如「…_課文.docx」）不會被當成試題檔。
 */
export function detectQuestionBankType(fileName: string): QuestionBankFileType | null {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const ascii = ASCII_TYPE_PATTERN.exec(base);
  if (ascii) {
    const type = ascii[1].toUpperCase();
    if ((QUESTION_BANK_TYPES as readonly string[]).includes(type)) return type as QuestionBankFileType;
  }

  const stem = base.replace(/\.[^.]+$/, "");
  for (const [pattern, type] of CHINESE_TYPE_SUFFIXES) {
    if (pattern.test(stem)) return type;
  }
  return null;
}

/** 是否為校內試題檔（依檔名判斷，供批次匯入及上載時使用） */
export function isQuestionBankFileName(fileName: string): boolean {
  return detectQuestionBankType(fileName) !== null;
}

/**
 * 抽出 DOCX 的純文字（試題檔解析用）。
 * 校內試題以段落結構編寫，因此使用與匯入腳本相同的擷取方式，確保兩者結果一致。
 */
export async function extractQuestionBankText(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

function normalize(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u3000]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** 移除選項開頭的「A.」／「(A)」／「A 」／「A」等標記，只保留文字 */
export function stripOptionLabel(value: string): string {
  return value.replace(OPTION_LABEL_PATTERN, "").trim();
}

/**
 * 選項標記：字母後可接「.」「、」「：」，或直接接選項文字（部分試題檔寫成「A花拉子密」）。
 * 為免誤刪選項內容，字母後面必須是空白或非英數字的字元。
 */
const OPTION_LABEL_PATTERN = /^\s*[（(]?([A-Ha-h])[）)]?\s*(?:[.、:：]\s*|\s+)?(?=[^\sA-Za-z0-9])/;

/** 選項開頭的標記字母（沒有則回傳 null） */
function optionLabel(value: string): string | null {
  const match = OPTION_LABEL_PATTERN.exec(value);
  return match ? match[1].toUpperCase() : null;
}

interface RawBlock {
  sourceId: string;
  lines: string[];
  typeTag: string;
  blankCount: number;
  /** 檔案標示的難度（`難度：★★☆`），沒有標示則為 null */
  difficulty: Difficulty | null;
  /** 區塊在檔案文字中的起始位置（用於對應所屬單元標題） */
  startIndex: number;
  /** 區塊在檔案文字中的結束位置 */
  endIndex: number;
}

/** 難度星號換算：★→基礎、★★→進階、★★★→挑戰 */
function difficultyFromText(text: string): Difficulty | null {
  const match = /難度[：:]\s*([★☆]+)/.exec(text);
  if (!match) return null;
  const stars = (match[1].match(/★/g) ?? []).length;
  if (stars <= 1) return "basic";
  if (stars === 2) return "advanced";
  return "challenge";
}

/**
 * 清掉區塊內不屬於題目內容的行：
 * 難度標示、作答線、Word 圖片錨點數字、`{{}}`／`d:`／`t:` 等後設資料及重複行。
 */
function cleanBodyLines(lines: string[]): string[] {
  const cleaned: string[] = [];
  for (const raw of lines) {
    const line = raw
      .replace(/^\d{5,}\s*/, "")
      .replace(/^\|+\s*/, "")
      .replace(/\s*\|+$/, "")
      .trim();
    if (line.length === 0) continue;
    if (/^[_\s]{3,}$/.test(line)) continue;
    if (/^難度[：:]/.test(line)) continue;
    // 選項結束符號（❒ 及 Word 字型中的私人使用區字符）不是題目內容
    if (/^[\s\uE000-\uF8FF\u2752\u2610\u25A1\u25FB\u25FC\uFFFD\u200B\uFEFF]+$/.test(line)) continue;
    if (line === "[[]]" || line === "]]" || line === "[[" || line === "|!|" || line === "@@") continue;
    if (line === "b" || line === "{{}}" || /^d:\d+;?$/.test(line) || /^t:[a-z_]+/i.test(line)) continue;
    // Word 抽出文字時，同一段文字偶爾會重複出現（文字方塊的備用內容）
    if (line === cleaned[cleaned.length - 1]) continue;
    cleaned.push(line);
  }
  return cleaned;
}

/** 切出所有 `[[ ... ]]` 區塊（甲式排版） */
export function splitBlocks(text: string): RawBlock[] {
  const blocks: RawBlock[] = [];
  const pattern = /\[\[([\s\S]*?)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const lines = normalize(match[1]).split("\n").map((line) => line.trim());
    const sourceId = lines.shift() ?? "";
    const body = normalize(match[1]);
    const typeMatch = /t:([A-Za-z_]+)/.exec(body);
    const blankMatch = /nil:(\d+)/.exec(body);
    const cleaned = cleanBodyLines(lines);
    // `[[]]` 這類空區塊只是標記，不是題目，直接略過
    if (cleaned.length === 0) continue;
    blocks.push({
      sourceId: sourceId.trim(),
      lines: cleaned,
      typeTag: typeMatch ? typeMatch[1].toLowerCase() : "",
      blankCount: blankMatch ? Number(blankMatch[1]) : 0,
      difficulty: difficultyFromText(body),
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }
  return blocks;
}

/**
 * 切出所有 `|!|題號|!|` 區塊（乙式排版）。
 *
 * 此式排版的答案以 `##答案##` 包住，這裡會把它轉成與甲式相同的形狀
 * （插入 `##` 與 `@@` 行），令兩種排版的題目可以用同一套解析邏輯處理。
 */
export function splitPipeBlocks(text: string): RawBlock[] {
  const content = normalize(text);
  const marker = /\|!\|[\s|]*([A-Za-z0-9_-]{4,})[\s|]*\|!\|/g;
  const found: { sourceId: string; start: number; end: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = marker.exec(content)) !== null) {
    found.push({ sourceId: match[1], start: match.index, end: marker.lastIndex });
  }

  const blocks: RawBlock[] = [];
  found.forEach((entry, index) => {
    const next = found[index + 1];
    const body = content.slice(entry.end, next ? next.start : content.length);
    const blankMatch = /nil[),:]?\s*(\d+)/.exec(body);
    const answerMatch = /##([\s\S]*?)##/.exec(body);
    const questionPart = answerMatch ? body.slice(0, answerMatch.index) : body;
    const answerLines = answerMatch
      ? answerMatch[1]
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
      : [];
    const lines = cleanBodyLines(questionPart.split("\n"));
    if (lines.length === 0) return;
    // 區塊內容在 `[[]]` 結束標記後完結；之後的文字（例如下一個單元標題）不屬本題
    const terminator = body.lastIndexOf("[[]]");
    const endIndex = terminator >= 0 ? entry.end + terminator + 4 : (next?.start ?? content.length);
    blocks.push({
      sourceId: entry.sourceId,
      lines: [...lines, "##", ...cleanBodyLines(answerLines), "@@"],
      typeTag: "",
      blankCount: blankMatch ? Number(blankMatch[1]) : 0,
      difficulty: difficultyFromText(body),
      startIndex: entry.start,
      endIndex,
    });
  });
  return blocks;
}

/** 依檔案內使用的標記自動選擇排版：有 `|!|題號|!|` 就用乙式，否則用甲式 */
export function splitQuestionBlocks(text: string): RawBlock[] {
  const content = normalize(text);
  const pipeBlocks = splitPipeBlocks(content);
  return pipeBlocks.length > 0 ? pipeBlocks : splitBlocks(content);
}

function splitAt(lines: string[], marker: string): { before: string[]; after: string[] } {
  const index = lines.indexOf(marker);
  if (index < 0) return { before: lines, after: [] };
  return { before: lines.slice(0, index), after: lines.slice(index + 1) };
}

/**
 * 取出 `##`（答案開始）與 `@@`（補充內容開始）之間的文字。
 * `@@` 之後是檔案的後設資料（{{}}、d:、t:、nil:），不屬於答案。
 */
function answerSection(lines: string[]): string[] {
  const { after } = splitAt(lines, "##");
  const stopIndex = after.indexOf("@@");
  const section = stopIndex >= 0 ? after.slice(0, stopIndex) : after;
  return section
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        line !== "@@" &&
        line !== "##" &&
        line !== "{{}}" &&
        !/^d:\d+;?$/.test(line) &&
        !/^t:[a-z_]+/i.test(line) &&
        !/^nil:\d+$/.test(line),
    );
}

/** 由題型標記及檔案類型決定平台題型；null = 平台未支援 */
export function resolveQuestionType(
  fileType: QuestionBankFileType,
  typeTag: string,
): QuestionType | null {
  switch (fileType) {
    case "MCQ":
      return "mc";
    case "FBQ":
      return "fill";
    case "TFQ":
      // 是非題轉為兩個選項的選擇題（是／非）
      return "mc";
    default:
      // MUQ（配對）、COQ（時序）及 LAQ／DBQ（長題目／資料題）需要平台尚未支援的題型
      return typeTag === "mc" ? "mc" : null;
  }
}

/**
 * 依「（N 分）」拆出得分要點。
 * 評卷參考的寫法是「答案要點（N 分）」，因此每個要點 = 文字 + 緊接的分數標記。
 */
export function splitGradingPoints(answerText: string): string[] {
  const cleaned = normalize(answerText);
  if (cleaned.length === 0) return [];

  const points: string[] = [];
  const pattern = /([^（]*?)(（\s*\d+\s*分\s*）)/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  while ((match = pattern.exec(cleaned)) !== null) {
    const point = `${match[1]}${match[2]}`.replace(/\n+/g, " ").trim();
    if (point.length > 0) points.push(point);
    lastIndex = pattern.lastIndex;
  }

  const rest = cleaned.slice(lastIndex).replace(/\n+/g, " ").trim();
  if (rest.length > 0) points.push(rest);
  return points.length > 0 ? points : [cleaned];
}

/** 難度：試題檔沒有難度標示時，一律先以「基礎」匯入，由教師審核時調整 */
const DEFAULT_DIFFICULTY: Difficulty = "basic";

/**
 * 需要原檔圖片才能作答的關鍵詞（地圖、漫畫、照片…）。
 * 平台只保存文字，未能顯示原圖，這類題目匯入時一律排除。
 */
const VISUAL_PATTERN = /圖畫|漫畫|油畫|照片|相片|地圖|圖表|圖片|插圖|示意圖|附圖|上圖|下圖|圖一|圖二/;

/** 題目是否必須配合原檔圖片才能作答（平台未能顯示原圖，匯入時不會進入題庫） */
export function requiresOriginalImage(...texts: string[]): boolean {
  return VISUAL_PATTERN.test(texts.join(" "));
}

/** 依題目文字產生品質警告（只供教師端顯示） */
function buildQualityWarnings(...texts: string[]): string[] {
  const combined = texts.join(" ");
  const warnings: string[] = [];
  if (requiresOriginalImage(combined)) {
    warnings.push(
      "本題需配合原檔圖片（地圖／漫畫／照片等）作答，平台未能顯示原圖，發布前請確認或補上圖片。",
    );
  }
  return warnings;
}

/**
 * 分出選擇題的題目與選項。
 * 甲式排版以 `@O`／`❒` 標示；乙式排版沒有標記，選項會是最後 4 行
 * （若有 `A.` 至 `D.` 的字母標示，則取字母標示的連續區段）。
 */
function mcqParts(lines: string[]): { questionLines: string[]; optionLines: string[] } {
  // `##` 之後是答案區，不屬於題目或選項
  const answerIndex = lines.indexOf("##");
  const body = answerIndex >= 0 ? lines.slice(0, answerIndex) : lines;

  const marker = body.indexOf("@O");
  if (marker >= 0) {
    const after = body.slice(marker + 1);
    const end = after.indexOf("❒");
    return {
      questionLines: body.slice(0, marker),
      optionLines: end >= 0 ? after.slice(0, end) : after,
    };
  }

  const labelled = body
    .map((line, index) => (optionLabel(line) ? index : -1))
    .filter((index) => index >= 0);
  // 選項的字母標示（A. 至 D.）通常連續 4 項；
  // 若只有部分選項有標示（試題檔可能漏標），改用「最後 4 行」判斷。
  const consecutive =
    labelled.length >= 4 &&
    labelled[labelled.length - 1] === body.length - 1 &&
    labelled.every((index, position) => index === labelled[0] + position) &&
    labelled[0] >= 1;
  if (consecutive) {
    return {
      questionLines: body.slice(0, labelled[0]),
      optionLines: body.slice(labelled[0]),
    };
  }

  if (body.length >= 5) {
    return {
      questionLines: body.slice(0, body.length - 4),
      optionLines: body.slice(body.length - 4),
    };
  }
  return { questionLines: body, optionLines: [] };
}

/**
 * 選項文字清理：移除字母標記及原檔遺留的項目符號。
 *
 * 部分試題檔的選項寫成「A. . i和ii」（Word 項目符號被轉成「.」），移除字母標記後
 * 仍會留下一個「. 」，令學生看到「. i和ii」這種無意義的開頭（2026-10-18 模擬學生
 * 使用時發現 990 題選擇題中有 92 題屬這種情況）。
 */
function cleanOptionText(value: string): string {
  return stripOptionLabel(value)
    .replace(/^[.．·•‧]\s*/, "")
    .trim();
}

function parseMcq(block: RawBlock, unitTitle: string): ParsedBankQuestion | null {
  const { questionLines, optionLines } = mcqParts(block.lines);
  if (optionLines.length === 0) return null;
  const question = questionLines.join(" ").trim();
  if (question.length === 0) return null;

  const options = optionLines.map(cleanOptionText).filter((option) => option.length > 0);
  if (options.length < 2) return null;

  const answerLines = answerSection(block.lines);
  const answerRaw = cleanOptionText(answerLines[0] ?? "");
  if (answerRaw.length === 0) return null;

  const labelled = optionLines.map(optionLabel);
  let correctAnswer = "";
  const answerToken = (answerLines[0] ?? "").trim();

  // 1. 答案以字母標示，而且選項本身有字母標記 → 依標記對應
  const labelledIndex = /^[A-Ha-h]$/.test(answerToken)
    ? labelled.indexOf(answerToken.toUpperCase())
    : -1;
  if (labelledIndex >= 0) {
    correctAnswer = options[labelledIndex] ?? "";
  } else if (/^[A-Ha-h]$/.test(answerRaw)) {
    // 2. 選項沒有字母標記時，字母代表選項次序（A = 第 1 項）
    correctAnswer = options[answerRaw.toUpperCase().charCodeAt(0) - 65] ?? "";
  } else {
    // 3. 答案直接寫成選項文字
    correctAnswer = options.find((option) => option === answerRaw) ?? "";
  }
  if (correctAnswer.length === 0) return null;

  return {
    sourceId: block.sourceId,
    fileType: "MCQ",
    unitTitle,
    question,
    questionType: "mc",
    options,
    correctAnswer,
    explanation: "",
    gradingPoints: [],
    difficulty: block.difficulty ?? DEFAULT_DIFFICULTY,
    qualityWarnings: buildQualityWarnings(question),
  };
}

function parseFill(block: RawBlock, unitTitle: string): ParsedBankQuestion | null {  const { before } = splitAt(block.lines, "##");
  const question = before.join(" ").trim();
  const answerLines = answerSection(block.lines);
  const answerRaw = answerLines.join(" ").trim();
  if (question.length === 0 || answerRaw.length === 0) return null;

  // 多個空格的答案會以「；」分隔，順序對應題目中的空格
  const answers = answerRaw
    .split(/[；;]/)
    .map((answer) => answer.trim())
    .filter((answer) => answer.length > 0);
  if (answers.length === 0) return null;

  return {
    sourceId: block.sourceId,
    fileType: "FBQ",
    unitTitle,
    question,
    questionType: "fill",
    options: [],
    correctAnswer: answers[0],
    explanation:
      answers.length > 1
        ? `填充題答案（依空格次序）：${answers.map((answer, index) => `(${index + 1}) ${answer}`).join("、")}`
        : "",
    gradingPoints: answers.length > 1 ? answers.slice(1) : [],
    difficulty: block.difficulty ?? DEFAULT_DIFFICULTY,
    qualityWarnings: buildQualityWarnings(question),
  };
}

function parseTrueFalse(block: RawBlock, unitTitle: string): ParsedBankQuestion | null {
  const { before } = splitAt(block.lines, "##");
  const question = before.join(" ").replace(/_{3,}\s*$/g, "").trim();
  const answerLines = answerSection(block.lines);
  // 乙式排版的答案寫成「否。正確說法」，甲式排版則把正確說法放在下一行
  const verdictMatch = /^(是|非|否|對|錯|正確|錯誤)[。.、,，]?\s*([\s\S]*)$/.exec(answerLines[0] ?? "");
  if (question.length === 0 || !verdictMatch) return null;
  const isTrue = ["是", "對", "正確"].includes(verdictMatch[1]);
  const correction = [verdictMatch[2], ...answerLines.slice(1)].join(" ").trim();

  return {
    sourceId: block.sourceId,
    fileType: "TFQ",
    unitTitle,
    question,
    questionType: "mc",
    options: ["是", "非"],
    correctAnswer: isTrue ? "是" : "非",
    explanation: correction,
    gradingPoints: [],
    difficulty: block.difficulty ?? DEFAULT_DIFFICULTY,
    qualityWarnings: buildQualityWarnings(question),
  };
}

function parseLongAnswer(
  block: RawBlock,
  fileType: "LAQ" | "DBQ",
  unitTitle: string,
): ParsedBankQuestion | null {
  // 短答題功能已移除；長題目及資料題需要平台尚未支援的題型
  void block;
  void fileType;
  void unitTitle;
  return null;
}

/**
 * 解析試題檔內容。
 * 依檔案類型處理；無法確定的題目會放入 skipped 並附原因，不會產生猜測的答案。
 */
export function parseQuestionBank(
  text: string,
  fileName: string,
): QuestionBankParseResult {
  const fileType = detectQuestionBankType(fileName);
  if (!fileType) {
    return { fileType: "MCQ", questions: [], skipped: [], warnings: [`無法判斷試題檔類型：${fileName}`] };
  }

  const blocks = splitQuestionBlocks(text);
  const questions: ParsedBankQuestion[] = [];
  const skipped: SkippedBankQuestion[] = [];
  const warnings: string[] = [];
  /** 目前的單元標題（例如「A. 石器時代的演進」），會套用到之後的題目 */
  let unitTitle = "";

  // 單元標題有兩種寫法：「A. 歐洲殖民擴張的簡介」及「[擴張的原因]」（資料題）。
  // 選項也可能以「A.」開頭，因此只採用題目區塊以外的文字。
  const blockRanges = blocks.map((block) => ({ start: block.startIndex, end: block.endIndex }));
  const insideBlock = (index: number): boolean =>
    blockRanges.some((range) => index >= range.start && index < range.end);

  const headings: { index: number; title: string }[] = [];
  const headingPatterns = [
    /(?:^|\n)[ \t]*([A-Z]\.\s*[^\n]{2,40})[ \t]*(?=\n)/g,
    /(?:^|\n)[ \t]*\[([^[\]\n]{2,60})\][ \t]*(?=\n)/g,
  ];
  for (const pattern of headingPatterns) {
    let headingMatch: RegExpExecArray | null;
    while ((headingMatch = pattern.exec(text)) !== null) {
      if (insideBlock(headingMatch.index)) continue;
      headings.push({ index: headingMatch.index, title: normalize(headingMatch[1]) });
    }
  }
  headings.sort((a, b) => a.index - b.index);

  const headingForBlock = (blockIndex: number): string => {
    let title = "";
    for (const heading of headings) {
      if (heading.index < blockIndex) title = heading.title;
      else break;
    }
    return title;
  };

  blocks.forEach((block) => {
    unitTitle = headingForBlock(block.startIndex) || unitTitle;

    let parsed: ParsedBankQuestion | null = null;
    if (fileType === "MCQ") parsed = parseMcq(block, unitTitle);
    else if (fileType === "FBQ") parsed = parseFill(block, unitTitle);
    else if (fileType === "TFQ") parsed = parseTrueFalse(block, unitTitle);
    else if (fileType === "LAQ" || fileType === "DBQ") parsed = parseLongAnswer(block, fileType, unitTitle);

    if (!parsed) {
      const reason =
        fileType === "MUQ"
          ? "配對題需要平台尚未支援的題型"
          : fileType === "COQ"
            ? "時序題需要平台尚未支援的題型"
            : fileType === "LAQ" || fileType === "DBQ"
              ? "長題目／資料題需要平台尚未支援的題型（短答題功能已移除）"
              : "題目或答案格式不完整，無法忠實轉換";
      skipped.push({ sourceId: block.sourceId, reason });
      return;
    }
    // 平台題型由檔案類型決定（配對／時序題尚未支援，會回傳 null）
    if (resolveQuestionType(fileType, block.typeTag) === null || parsed.questionType === null) {
      skipped.push({ sourceId: block.sourceId, reason: "平台尚未支援此題型" });
      return;
    }
    questions.push(parsed);
  });

  if (skipped.length > 0) {
    warnings.push(`有 ${skipped.length} 題未能匯入（原因見匯入報告）。`);
  }

  const visualCount = questions.filter((question) => question.qualityWarnings.length > 0).length;
  if (visualCount > 0) {
    warnings.push(
      `有 ${visualCount} 題需要原檔圖片（地圖／漫畫／照片）才能作答，平台未能顯示原圖，匯入時一律排除（不會進入題庫）。`,
    );
  }

  return { fileType, questions, skipped, warnings };
}


/* ------------------------------------------------------------------ */
/* 多空格填充題：由「答案依空格次序」還原並改寫成單一空格              */
/* ------------------------------------------------------------------ */

/**
 * 由填充題的補充說明取出所有空格的答案。
 *
 * 校內試題檔的填充題可能一句有幾個空格，評卷參考只以一行列出答案，
 * 解析器把它寫成「填充題答案（依空格次序）：(1) 民族、(2) 殖民」。
 * 這個函式按次序還原，令平台可以：
 *   1. 檢查空格數與答案數是否相符；及
 *   2. 把其餘空格的答案填回題幹，只保留一個空格（見 normaliseMultiBlankFill）。
 */
export function blankAnswersFromExplanation(explanation: string): string[] {
  if (!explanation.includes("依空格次序")) return [];
  const answers = new Map<number, string>();
  for (const match of explanation.matchAll(/\((\d+)\)\s*([\s\S]*?)(?=\s*[、,，]\s*\(\d+\)|$)/g)) {
    const index = Number(match[1]);
    const answer = match[2].replace(/[、,，。\s]+$/, "").trim();
    if (index >= 1 && answer.length > 0) answers.set(index, answer);
  }
  return [...answers.entries()].sort((left, right) => left[0] - right[0]).map(([, answer]) => answer);
}

export interface FillNormalisation {
  /** 改寫後只有一個空格的題幹 */
  question: string;
  /** 保留的那個空格的答案 */
  correctAnswer: string;
  /**
   * 保留的空格在**原題**的次序（1 = 第一個空格）。
   *
   * 大於 1 代表被考核的空格已改變：原題第 1 個空格的答案 `originalAnswer` 並不是
   * `correctAnswer`。呼叫端不可把這種改寫描述為「考核的答案不變」，亦不可在未經
   * 教師確認下當作等價。
   */
  assessedBlankIndex: number;
  /** 原題第一個空格的答案（匯入時記錄的標準答案） */
  originalAnswer: string;
  /** 其餘空格及其答案（供教師核對原卷） */
  filled: { answer: string; blankIndex: number }[];
}

/**
 * 把有多個空格的填充題改寫成**只有一個空格**的題目。
 *
 * 為甚麼要改寫而不是保留多個空格：平台的作答介面每題只有一個輸入框，評分亦只
 * 比對一個標準答案。原卷一句有 3 個空格時，學生見到 3 個空格卻只能填 1 個，
 * 其餘空格永遠沒有答案可對（2026-10-18 模擬學生使用時發現 923 題填充題中有
 * 574 題屬這種情況）。
 *
 * 做法：把其餘空格的答案直接填回題幹，只保留其中一個空格。保留哪一個空格會
 * 逐一嘗試，確保被考核的答案**不會**在題幹其他地方出現（否則等於直接給答案）。
 * 沒有任何空格符合條件時回傳 null（由呼叫端視為無法使用，不派給學生）。
 */
export function normaliseMultiBlankFill(question: string, answers: string[]): FillNormalisation | null {
  const markers = [...question.matchAll(/[＿_]{2,}/g)];
  if (markers.length <= 1) return null;

  const cleaned = answers.map((answer) => answer.trim());
  if (cleaned.filter((answer) => answer.length > 0).length < markers.length) return null;

  for (let keep = 0; keep < markers.length; keep += 1) {
    let rebuilt = "";
    let cursor = 0;
    for (const [index, marker] of markers.entries()) {
      rebuilt += question.slice(cursor, marker.index);
      rebuilt += index === keep ? FILL_BLANK : cleaned[index];
      cursor = marker.index + marker[0].length;
    }
    rebuilt += question.slice(cursor);
    if (answerLeaksIntoStem(rebuilt, cleaned[keep])) continue;
    if (countBlankMarkers(rebuilt) !== 1) continue;
    return {
      question: rebuilt,
      correctAnswer: cleaned[keep],
      assessedBlankIndex: keep + 1,
      originalAnswer: cleaned[0],
      filled: cleaned
        .map((answer, index) => ({ answer, blankIndex: index + 1 }))
        .filter((entry) => entry.blankIndex - 1 !== keep),
    };
  }
  return null;
}
