/**
 * 題目是否可以派給學生作答（單一事實來源）。
 *
 * 為甚麼需要這一層：題庫的題目可能來自校內試題檔、教師手動輸入或 AI 生成，
 * 而校內試題檔的排版（Word 底線、表格內選項）不一定能完整轉換成文字。
 * 曾經出現的實際缺陷：
 *   - 一個題幹有 3 個空格，但答案區只記錄 1 個答案 → 學生見到 3 個空格卻只有 1 個輸入框，
 *     其餘空格沒有答案可對；
 *   - 標準答案已印在同一題幹後半句（「……聶斯托利派」），答案直接外洩；
 *   - 原檔以圖片或表格排版，解析後選項全部變成「.」，學生無法作答。
 *
 * 這些題目**不是**史實問題，而是結構上無法作答，因此在派給學生前一律攔下；
 * 題目仍留在題庫，由教師修正（見 scripts/repair-question-bank.ts）。
 * 生成流程另有更嚴格的品質閘門（question-quality.ts、fill-question.ts），
 * 這一層只是最後的安全網，不代替那些檢查。
 */
import type { QuestionType } from "../../lib/types";
import { answerLeaksIntoStem, countBlankMarkers } from "../llm/fill-question";

export interface ServabilityCheck {
  /** false = 不可派給學生 */
  ok: boolean;
  /** 不可派給學生的原因（繁體中文，供教師端及日誌顯示） */
  reason: string | null;
}

const SERVABLE: ServabilityCheck = { ok: true, reason: null };

/**
 * 選項／答案的比對用正規化：只收斂空白及全形字母，**不**移除標點。
 *
 * 曾經用「移除所有標點」比對，令「ii，iii，iv，i」與「iii，ii，iv，i」被當成
 * 重複選項（兩者是不同的排序答案）；逗號在排序類選項中是有意義的內容。
 */
function normaliseOption(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").replace(/[。．.]+$/, "").trim();
}

/**
 * 選項所指涉的羅馬數字（例如 `i、ii及iii` → [i, ii, iii]）。
 *
 * 只在整個選項都是「羅馬數字＋連接詞」時才視為指涉題幹的陳述；其他選項（例如
 * 「iii、iv」以外的文字選項）不會被誤判。
 */
const ROMAN_OPTION = /^(?:iv|i{1,3})(?:\s*[、,，及和/／]\s*(?:iv|i{1,3}))*$/;
const ROMAN_TOKEN = /iv|i{1,3}/g;

function romanReferencesInOption(option: string): string[] {
  const text = option.trim().toLowerCase();
  if (text.length === 0 || !ROMAN_OPTION.test(text)) return [];
  return text.match(ROMAN_TOKEN) ?? [];
}

/**
 * 題幹標示了哪些羅馬數字陳述（`i.`、`ii、`、`(iii)`、`iv）` 等寫法）。
 *
 * 校內試題原檔多以表格或分欄排版，轉換成文字時常把 `i.`／`ii.` 等標示與陳述
 * 分開，令題幹只剩幾句無標示的文字（實測 83 題）。這類題目的選項仍寫成
 * 「i、ii及iii」，學生無法得知哪一句是 i、哪一句是 ii，結構上無法作答。
 */
const ROMAN_LABEL = /(?:^|[\s（(【[])(iv|iii|ii|i)(?=[\s.．、:：)）】\]])/gi;

function romanLabelsInStem(stem: string): Set<string> {
  const labels = new Set<string>();
  for (const match of stem.matchAll(ROMAN_LABEL)) {
    labels.add(match[1].toLowerCase());
  }
  return labels;
}

export function checkQuestionServable(question: {
  questionType: QuestionType;
  question: string;
  options: string[];
  correctAnswer: string;
}): ServabilityCheck {
  const answer = question.correctAnswer.trim();

  if (answer.length === 0) {
    return { ok: false, reason: "題目沒有標準答案，學生無法得知對錯" };
  }

  if (question.questionType === "fill") {
    const blanks = countBlankMarkers(question.question);
    if (blanks === 0) {
      return { ok: false, reason: "填充題的題幹沒有空格標記，學生無從得知要填寫甚麼" };
    }
    if (blanks > 1) {
      return {
        ok: false,
        reason: `填充題的題幹有 ${blanks} 個空格，但只記錄了 1 個答案，其餘空格沒有答案可對`,
      };
    }
    if (answer.length > 40) {
      return {
        ok: false,
        reason: `填充題的標準答案長達 ${answer.length} 字，已接近整句或整段，學生無法在單一空格重現`,
      };
    }
    if (/[＿_]{2,}/.test(answer)) {
      return { ok: false, reason: "填充題的標準答案仍包含空格標記，學生無法作答" };
    }
    if (/[。？！?!]/.test(answer)) {
      return { ok: false, reason: "填充題的標準答案包含完整句子（句末標點），答案欄位已混入其他內容" };
    }
    if (answerLeaksIntoStem(question.question, answer)) {
      return {
        ok: false,
        reason: `填充題的標準答案「${answer}」仍出現在題幹其他位置，學生可直接抄寫`,
      };
    }
    return SERVABLE;
  }

  if (question.questionType === "mc") {
    const options = question.options.map((option) => option.trim());
    const distinct = new Set(options.map(normaliseOption));
    if (options.length < 2) {
      return { ok: false, reason: `選擇題只有 ${options.length} 個選項，無法作答` };
    }
    if (options.some((option) => option.length === 0)) {
      return { ok: false, reason: "選擇題有空白的選項" };
    }
    if (distinct.size !== options.length) {
      return { ok: false, reason: "選擇題有重複的選項，學生無法分辨" };
    }
    if (!options.some((option) => normaliseOption(option) === normaliseOption(answer))) {
      return { ok: false, reason: `選擇題的標準答案「${answer}」不在選項之內` };
    }
    // 選項以羅馬數字指涉題幹陳述時，題幹必須逐一標示（i／ii／iii／iv）。
    // 否則學生只看到幾句沒有編號的文字，無法把「i、ii及iii」對應到任何一句。
    const referenced = [...new Set(options.flatMap((option) => romanReferencesInOption(option)))];
    if (referenced.length > 0) {
      const labels = romanLabelsInStem(question.question);
      const missing = referenced.filter((label) => !labels.has(label));
      if (missing.length > 0) {
        return {
          ok: false,
          reason:
            `選項以羅馬數字（${referenced.join("、")}）指涉題幹的陳述，` +
            `但題幹沒有 ${missing.join("、")} 的標示，學生無法對應哪一句是哪一項`,
        };
      }
    }
    // 答案外洩：用**保留標點**的比對，避免「i、ii」這類排序選項與題幹的
    // 「i. … ii. …」因標點被移除而被誤判（2026-10-18 修正 8 題誤報）。
    if (normaliseOption(answer).length >= 3 && normaliseOption(question.question).includes(normaliseOption(answer))) {
      return { ok: false, reason: `選擇題的標準答案「${answer}」已出現在題幹中，答案直接外洩` };
    }
    return SERVABLE;
  }

  return SERVABLE;
}
