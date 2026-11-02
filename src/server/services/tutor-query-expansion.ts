/**
 * 學伴提問的「語意改寫」（LLM query expansion，2026-11-02）。
 *
 * ── 為甚麼需要 ────────────────────────────────────────────────────────
 * 教材檢索（`services/tutor-grounding.ts`）是**確定性字詞比對**：學生與教材用語不同
 * 就找不到段落。人手維護的「類別詞」表（藝術家→藝術三傑、開埠→自由港／割讓…）
 * 每次都要等真實失敗才補一條，永遠追不上學生的說法。
 *
 * 這裡補上一層**語意**：只在字詞檢索已經確定找不到教材時（`not-covered`），才請模型
 * 把學生的問題改寫成「本校教科書最可能使用的關鍵詞」，再把這些詞交回檢索重試。
 *
 * ── 為甚麼只在失敗時呼叫 ──────────────────────────────────────────────
 *   1. **成本**：教材已命中時再呼叫模型只是白花 token；失敗才需要語意補救。
 *   2. **延遲**：正常提問完全不受影響（不會多等一次模型回應）。
 *   3. **風險**：改寫詞只是「擴充檢索詞」，最終仍由同一套字詞比對與來源政策決定
 *      是否引用某段教材——模型不能憑空令一段無關教材變成依據。
 *
 * ── 失敗處理（fail-open）──────────────────────────────────────────────
 * 逾時、HTTP 錯誤、JSON 格式錯誤、詞語不合理，一律回傳空詞表並記錄用量，
 * **不會**令學伴請求失敗，亦不會改變原有「未找到教材依據」的標示。
 *
 * ── 私隱 ──────────────────────────────────────────────────────────────
 * 只送出提問本身（學生原文）及課題標題；不含 learnerId、電郵、班別、對話紀錄或
 * 教材內容。學伴回答本來就會把同一條提問送到同一個模型供應商（DeepSeek），
 * 因此這不是新的第三方。
 */
import type { LlmUsage } from "@/lib/types";
import { normalizeHistoryAnswer } from "@/lib/history-lexicon";
import { requestJsonCompletion } from "../llm/chat-client";
import { categorizeLlmError, logLlmUsage } from "./llm-usage";

/** 語意改寫的整體時間預算預設值；超時即放棄，不阻塞主回答 */
export const TUTOR_EXPANSION_DEFAULT_BUDGET_MS = 2_500;
/** 語意改寫時間預算的硬上限（環境變數寫得再大也不會超過） */
export const TUTOR_EXPANSION_MAX_BUDGET_MS = 5_000;
/** 每次改寫最多取用多少個詞 */
export const TUTOR_EXPANSION_DEFAULT_MAX_TERMS = 6;
/** 詞語硬上限（防止異常回應令檢索詞爆炸） */
export const TUTOR_EXPANSION_HARD_MAX_TERMS = 10;
/** 可用的詞語長度範圍（太短會命中任何段落，太長不可能是教材用語） */
export const TUTOR_EXPANSION_TERM_MIN_CHARS = 2;
export const TUTOR_EXPANSION_TERM_MAX_CHARS = 12;
/** 回應 token 上限：6 個詞的 JSON 遠低於此數 */
const TUTOR_EXPANSION_MAX_TOKENS = 200;
/** 程序內快取上限（同一條提問在同一執行個體只改寫一次） */
const CACHE_LIMIT = 300;

/**
 * 不可以用作檢索詞的提問用語。
 *
 * 這些詞在任何教材段落都會出現（或根本不是內容詞），若被當成改寫詞並給予高權重，
 * 會令無關段落排到前面，比「找不到」更差。
 */
const EXPANSION_STOP_TERMS: ReadonlySet<string> = new Set(
  [
    "甚麼",
    "什麼",
    "咩",
    "為何",
    "為什麼",
    "點解",
    "如何",
    "怎樣",
    "點樣",
    "哪些",
    "哪個",
    "幾時",
    "何時",
    "影響",
    "原因",
    "背景",
    "意義",
    "特色",
    "比較",
    "分別",
    "試述",
    "解釋",
    "說明",
    "介紹",
    "簡介",
    "總結",
    "列出",
    "列舉",
    "問題",
    "歷史",
  ].map((term) => normalizeHistoryAnswer(term)),
);

export interface TutorQueryExpansionConfig {
  enabled: boolean;
  /** 整體時間預算（毫秒）；超時即放棄改寫 */
  budgetMs: number;
  /** 最多取用多少個改寫詞 */
  maxTerms: number;
}

/** 可用的模型設定（由呼叫方從 `getServerConfig().llm` 傳入，避免循環依賴） */
export interface TutorQueryExpansionLlm {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export type TutorQueryExpansionStatus =
  /** 功能關閉，未發出任何請求 */
  | "disabled"
  /** 回傳了可用詞語 */
  | "expanded"
  /** 模型回應沒有任何合格詞語 */
  | "empty"
  /** 呼叫失敗（逾時、HTTP 錯誤、格式錯誤）；已靜默降級 */
  | "failed";

export interface TutorQueryExpansionResult {
  status: TutorQueryExpansionStatus;
  /** 可用作檢索詞的教材用語（已正規化、去重、長度及停用詞已過濾） */
  terms: string[];
  usage: LlmUsage | null;
}

/** 程序內快取：同一條提問（同一課題）只改寫一次 */
const expansionCache = new Map<string, string[]>();

/** 供測試使用：清空快取 */
export function clearTutorQueryExpansionCache(): void {
  expansionCache.clear();
}

function cacheKey(message: string, topicTitle: string | null): string {
  return `${topicTitle ?? ""}\u0000${normalizeHistoryAnswer(message)}`;
}

function rememberInCache(key: string, terms: string[]): void {
  if (expansionCache.size >= CACHE_LIMIT) {
    const oldest = expansionCache.keys().next().value;
    if (oldest !== undefined) expansionCache.delete(oldest);
  }
  expansionCache.set(key, terms);
}

/**
 * 過濾模型回傳的詞語。
 *
 * 只接受「像教材用語」的字串：2–12 字、不是提問用語、不可重複。簡體字會經
 * `normalizeHistoryAnswer` 轉成繁體，令檢索可以直接比對（教材一律繁體）。
 */
export function sanitizeExpansionTerms(
  raw: unknown,
  options: { maxTerms?: number; question?: string } = {},
): string[] {
  const maxTerms = Math.min(
    Math.max(options.maxTerms ?? TUTOR_EXPANSION_DEFAULT_MAX_TERMS, 1),
    TUTOR_EXPANSION_HARD_MAX_TERMS,
  );
  const list =
    typeof raw === "object" && raw !== null && Array.isArray((raw as { terms?: unknown }).terms)
      ? ((raw as { terms: unknown[] }).terms)
      : [];
  const normalizedQuestion = normalizeHistoryAnswer(options.question ?? "");

  const terms: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item !== "string") continue;
    const term = normalizeHistoryAnswer(item);
    if (term.length < TUTOR_EXPANSION_TERM_MIN_CHARS) continue;
    if (term.length > TUTOR_EXPANSION_TERM_MAX_CHARS) continue;
    if (EXPANSION_STOP_TERMS.has(term)) continue;
    // 整條問題原句不是「教材用語」，只會令任何段落都命中
    if (normalizedQuestion.length > 0 && term === normalizedQuestion) continue;
    if (seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length >= maxTerms) break;
  }
  return terms;
}

const SYSTEM_PROMPT = [
  "你是香港中學歷史科的教材檢索助理。",
  "學生會問一條歷史問題，你要把問題改寫成「本校教科書最可能使用的繁體中文關鍵詞」，用於在教材資料庫做字詞檢索。",
  "規則：",
  '1. 只輸出 json 物件：{"terms": ["詞一", "詞二"]}，不要其他文字，不要 markdown。',
  "2. terms 為 2 至 6 個詞，每個 2 至 12 字，必須是名詞或短語（事件、人物、制度、條約、政策、地名、組織）。",
  "3. 不可包含提問用語（例如「甚麼」「如何」「為甚麼」「列出」「影響」「原因」）。",
  "4. 必須使用繁體中文及香港教科書常見寫法（例如「希特拉」而不是「希特勒」）。",
  "5. 不要解釋，不要句子，不要英文。",
].join("\n");

/**
 * 把學生的提問改寫成教材檢索詞。
 *
 * **永不拋出錯誤**：任何失敗都回傳空詞表（`status: "failed"`），由呼叫方保留原本
 * 「未找到教材依據」的行為。呼叫方必須已通過每日額度及 `generation` 預留，
 * 且只在字詞檢索失敗時呼叫。
 */
export async function expandTutorQuery(input: {
  message: string;
  topicTitle: string | null;
  config: TutorQueryExpansionConfig;
  llm: TutorQueryExpansionLlm;
  topicId?: string | null;
}): Promise<TutorQueryExpansionResult> {
  const { config, llm } = input;
  if (!config.enabled) return { status: "disabled", terms: [], usage: null };
  if (llm.provider !== "deepseek") return { status: "disabled", terms: [], usage: null };

  const key = cacheKey(input.message, input.topicTitle);
  const cached = expansionCache.get(key);
  if (cached !== undefined) return { status: "expanded", terms: cached, usage: null };

  const startedAt = Date.now();
  try {
    const { data, usage } = await requestJsonCompletion(
      {
        apiKey: llm.apiKey,
        baseUrl: llm.baseUrl,
        model: llm.model,
        // 預算即逾時：改寫只是加分項，不可拖慢主回答
        timeoutMs: Math.min(config.budgetMs, TUTOR_EXPANSION_MAX_BUDGET_MS),
        maxTokens: TUTOR_EXPANSION_MAX_TOKENS,
        // 思考模式會把 token 用在推理上，令短 JSON 回應變成空白（見 route.ts 同類說明）
        thinking: "disabled",
        emptyContentRetries: 0,
        temperature: 0.2,
      },
      [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            input.topicTitle === null
              ? `學生的問題：${input.message}`
              : `學生的問題：${input.message}\n所屬課題：${input.topicTitle}`,
        },
      ],
      "學伴語意改寫",
    );

    const terms = sanitizeExpansionTerms(data, {
      maxTerms: config.maxTerms,
      question: input.message,
    });
    logLlmUsage({
      requestType: "tutor-expansion",
      provider: llm.provider,
      model: llm.model,
      topicId: input.topicId ?? null,
      success: true,
      durationMs: Date.now() - startedAt,
      usage,
      errorType: null,
    });
    if (terms.length === 0) return { status: "empty", terms: [], usage };
    rememberInCache(key, terms);
    return { status: "expanded", terms, usage };
  } catch (error) {
    logLlmUsage({
      requestType: "tutor-expansion",
      provider: llm.provider,
      model: llm.model,
      topicId: input.topicId ?? null,
      success: false,
      durationMs: Date.now() - startedAt,
      usage: null,
      errorType: categorizeLlmError(error),
    });
    return { status: "failed", terms: [], usage: null };
  }
}
