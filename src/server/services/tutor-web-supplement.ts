/**
 * 學伴的白名單網頁補充（Web Supplement，MVP，**預設關閉**）。
 *
 * ── 產品定位 ──────────────────────────────────────────────────────────
 * 校本教材（`services/tutor-grounding.ts`）仍然是唯一的「課本依據」。這裡抓回來的
 * 內容只作**課後擴充**，與教材分開標示，永不寫成「課本寫道」或「教材指出」。
 * 因此本模組的輸出（`TutorWebSource[]`）與 `TutorSource[]` 是兩條獨立的軌道，
 * 由 API、資料庫及介面分別處理。
 *
 * ── 安全邊界（P0）────────────────────────────────────────────────────
 *   1. **預設零外網**：`TUTOR_WEB_SUPPLEMENT_ENABLED` 未設為 true 時，本模組不會
 *      發出任何請求（連 DNS 也不查）。
 *   2. **只接受白名單 host**：搜尋結果非白名單一律丟棄，**不會**先抓再過濾；
 *      白名單比對見 `tutor-web-allowlist.ts`。
 *   3. **只准 https**：http、file、data、ftp 一律拒絕。
 *   4. **防 SSRF**：每次連線前先解析 DNS，拒絕私網／迴路／link-local（包括雲端
 *      中繼資料服務 `169.254.169.254`）／CGNAT／組播／保留位址；重定向逐跳檢查，
 *      最多 3 次，任何一跳離開白名單即中止。
 *   5. **逾時及大小上限**：總逾時 `TUTOR_WEB_FETCH_TIMEOUT_MS`，回應只讀首
 *      `MAX_RESPONSE_BYTES` 位元組，摘錄再截斷至 `TUTOR_WEB_MAX_CHARS_PER_SOURCE`。
 *   6. **失敗即靜默降級**：任何錯誤都只令本次沒有外部參考，**不會**令學伴回 500。
 *   7. **不搶答**：抓取的文字只作為「參考摘錄」放進提示詞的一個獨立區塊，
 *      該區塊同時載明不可把摘錄說成課本內容。
 *
 * ── 為甚麼需要一隻搜尋端點 ────────────────────────────────────────────
 * 平台沒有付費搜尋 API。`TUTOR_WEB_SEARCH_ENDPOINT` 由管理員指向一個相容
 * `POST {query, domains, limit}` → `{results: [{url, title}]}` 的服務（自建代理、
 * 學校自架的搜尋服務或任何搜尋 API 的薄包裝）。未設定時**不會**退化成爬取搜尋引擎
 * 結果頁——那既違反搜尋引擎條款，亦不穩定——外網補充如實留空（`not-used`）。
 */
import { lookup } from "node:dns/promises";

import type { TutorWebSource, TutorWebSupplementStatus } from "@/lib/types";
import { matchTutorWebAllowlist, isBlockedWebAddress, isIpLiteralHost } from "./tutor-web-allowlist";
import {
  isTutorWebSearchProviderReady,
  searchWithProvider,
  toAllowlistedCandidates,
  type TutorWebSearchHit,
  type TutorWebSearchProviderConfig,
} from "./tutor-web-search-provider";

/** 顯示給學生的外部摘錄長度上限（規格：≤120 字） */
export const TUTOR_WEB_EXCERPT_MAX_CHARS = 120;
/** 送回模型／介面的外部參考數量上限（防止提示詞被外網內容淹沒） */
export const TUTOR_WEB_HARD_MAX_SOURCES = 5;
/** 單一來源可送進提示詞的字數上限（避免一段長文佔盡 token） */
export const TUTOR_WEB_HARD_MAX_CHARS_PER_SOURCE = 2_000;
/** 回應最多讀取多少位元組（夠讀取一篇條目，又不會被巨型頁面拖垮） */
const MAX_RESPONSE_BYTES = 1_024 * 1_024;
/** 重定向次數上限（逐跳檢查白名單及位址） */
const MAX_REDIRECTS = 3;
/** 外網補充的整體時間預算上限（硬上限，見 `budgetMs`） */
export const TUTOR_WEB_MAX_BUDGET_MS = 2_000;
/** 外網補充的整體時間預算預設值：超時即放棄，不阻塞主回答首字 */
export const TUTOR_WEB_DEFAULT_BUDGET_MS = 1_500;

/**
 * 外網補充策略（`TUTOR_WEB_MODE`）。
 *
 * - `off`：等同關閉，零外網請求；
 * - `always`：通過硬閘就嘗試抓外網（舊行為 S1）；
 * - `not-covered-only`（**啟用時的預設**）：只有教材 grounding 為 `not-covered`
 *   時才抓外網。教材已命中時，回答本來就有依據，再抓外網只會增加延遲及
 *   「兩個來源說法不同」的風險。
 */
export const TUTOR_WEB_MODES = ["off", "always", "not-covered-only"] as const;
export type TutorWebMode = (typeof TUTOR_WEB_MODES)[number];

/**
 * 外部參考設定。
 *
 * 由 `config.ts` 的 `readWebSupplementConfig()` 產生；刻意不以 `getServerConfig()`
 * 直接讀取，是為了避免 `config.ts` ↔ 本模組的循環依賴，亦令測試可以直接注入設定。
 */
export interface TutorWebSupplementConfig {
  enabled: boolean;
  /** 策略；`enabled=false` 時一律視為 `off` */
  mode: TutorWebMode;
  /** 已正規化的 host（見 tutor-web-allowlist.ts） */
  allowlist: string[];
  /** 非空時只有列出的 topicId 才允許外網（敏感課題的正面清單） */
  topicAllowlist: string[];
  maxSources: number;
  maxCharsPerSource: number;
  fetchTimeoutMs: number;
  /** 整體時間預算（搜尋＋抓取）；超時即放棄，不阻塞主回答 */
  budgetMs: number;
  /** 這些課題一律不做外網補充（敏感課題由科組自行設定） */
  blockedTopicIds: string[];
  /** 相容 `POST {query, domains, limit}` 的搜尋端點；null = 自行呼叫第三方 provider */
  searchEndpoint: string | null;
  /** 第三方搜尋 API 薄包裝設定（`searchEndpoint` 為 null 時才使用） */
  provider: TutorWebSearchProviderConfig;
}

export interface TutorWebCandidate {
  url: string;
  title: string;
  siteLabel: string;
}

export interface TutorWebSupplementResult {
  status: TutorWebSupplementStatus;
  /** 顯示給學生（及保存到資料庫）的外部參考，摘錄 ≤ TUTOR_WEB_EXCERPT_MAX_CHARS */
  sources: TutorWebSource[];
  /** 只送去提示詞的外部參考（可較長，見 maxCharsPerSource）；不保存、不回傳 */
  promptSources: TutorWebPromptSource[];
}

/**
 * 送去提示詞的外部參考。
 *
 * 與 `TutorWebSource` 分開的原因：顯示給學生的摘錄有 120 字上限（避免介面被長文
 * 淹沒），但模型可以參考較完整的段落（`TUTOR_WEB_MAX_CHARS_PER_SOURCE`）。把兩者
 * 混成一個物件，會令其中一個上限形同虛設。
 */
export interface TutorWebPromptSource {
  siteLabel: string;
  title: string;
  url: string;
  snippet: string;
}

/**
 * 收集本次提問的外部參考。
 *
 * **永不拋出錯誤**：外網補充是加分項，失敗或逾時時必須靜默降級為「只有教材」。
 * 呼叫方（`app/api/tutor/chat/route.ts`）只會在通過硬閘、非澄清／離題、且已完成
 * 日額及 generation 預留之後才呼叫，因此澄清與離題路徑不會產生任何外網請求。
 *
 * 所有策略判斷（開關、模式、封鎖課題、課題正面清單、搜尋端點）都在這裡一次做完，
 * 令「為甚麼沒有外部參考」只有一個答案，不會分散在路由與服務兩處而互相矛盾。
 */
export async function collectTutorWebSupplement(input: {
  query: string;
  topicId: string | null;
  /** 本次教材 grounding 的結果；`not-covered-only` 模式據此決定是否抓網 */
  grounding: "grounded" | "not-covered";
  config: TutorWebSupplementConfig;
}): Promise<TutorWebSupplementResult> {
  const { config } = input;
  const skip = (status: TutorWebSupplementStatus): TutorWebSupplementResult => ({
    status,
    sources: [],
    promptSources: [],
  });

  if (!config.enabled || config.mode === "off") return skip("disabled");
  if (input.topicId !== null && config.blockedTopicIds.includes(input.topicId)) {
    return skip("blocked-topic");
  }
  if (
    config.topicAllowlist.length > 0 &&
    (input.topicId === null || !config.topicAllowlist.includes(input.topicId))
  ) {
    // 設定了正面清單但本題不在清單內：屬「不適用」，不是錯誤
    return skip("not-used");
  }
  if (config.mode === "not-covered-only" && input.grounding === "grounded") {
    return skip("not-used");
  }
  // 兩條搜尋路徑：自訂代理端點（HTTP 契約）或進程內呼叫第三方 provider（薄包裝）。
  // 兩者都沒有時完全不做搜尋（狀態 not-used），平台不會退化成爬取搜尋結果頁。
  // 白名單為空時亦直接跳過：否則會付費呼叫第三方，再把所有結果丟棄。
  const providerReady = isTutorWebSearchProviderReady(config.provider);
  if (config.allowlist.length === 0) return skip("not-used");
  if (config.searchEndpoint === null && !providerReady) {
    return skip("not-used");
  }

  // 整體時間預算：搜尋與抓取共用同一個 deadline。超時就放棄（`failed`），
  // 令外網永遠不會把主回答的首字推遲超過 budgetMs。
  const budgetMs = Math.min(Math.max(config.budgetMs, 200), TUTOR_WEB_MAX_BUDGET_MS);
  let timer: NodeJS.Timeout | undefined;
  const work = (async (): Promise<TutorWebSupplementResult> => {
    let candidates: TutorWebCandidate[];
    try {
      candidates = await searchAllowlistedSources(input.query, {
        ...config,
        fetchTimeoutMs: Math.min(config.fetchTimeoutMs, budgetMs),
      });
    } catch {
      return skip("failed");
    }
    if (candidates.length === 0) return skip("not-used");

    const attempts = candidates.slice(0, config.maxSources);
    const settled = await Promise.allSettled(
      attempts.map((candidate) =>
        fetchAllowlistedText(candidate.url, {
          ...config,
          fetchTimeoutMs: Math.min(config.fetchTimeoutMs, budgetMs),
        }),
      ),
    );

    const sources: TutorWebSource[] = [];
    const promptSources: TutorWebPromptSource[] = [];
    const seen = new Set<string>();
    let failed = false;
    for (const outcome of settled) {
      if (outcome.status === "rejected") {
        failed = true;
        continue;
      }
      const fetched = outcome.value;
      if (seen.has(fetched.url)) continue;
      seen.add(fetched.url);
      sources.push({
        url: fetched.url,
        title: fetched.title,
        siteLabel: fetched.siteLabel,
        excerpt: buildExcerpt(fetched.text),
      });
      promptSources.push({
        url: fetched.url,
        title: fetched.title,
        siteLabel: fetched.siteLabel,
        snippet: fetched.text,
      });
      if (sources.length >= config.maxSources) break;
    }

    if (sources.length === 0) return skip(failed ? "failed" : "not-used");
    return { status: "ok", sources, promptSources };
  })();

  const timeout = new Promise<TutorWebSupplementResult>((resolve) => {
    timer = setTimeout(() => resolve(skip("failed")), budgetMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 取得候選來源（**已按白名單過濾**）。
 *
 * 兩條路徑共用同一個過濾器 `toAllowlistedCandidates`：
 *   1. `TUTOR_WEB_SEARCH_ENDPOINT`：自訂代理，`POST` JSON `{query, domains, limit}`，
 *      回應 `{results:[{url,title}]}`（或陣列）；
 *   2. 未設端點但已設定 `TUTOR_WEB_SEARCH_PROVIDER`：進程內呼叫第三方搜尋 API（薄包裝）。
 * **任何**非白名單、非 https 的結果都會被丟棄，不會進入抓取階段。
 */
export async function searchAllowlistedSources(
  query: string,
  config: TutorWebSupplementConfig,
): Promise<TutorWebCandidate[]> {
  const hits =
    config.searchEndpoint !== null
      ? await searchViaEndpoint(query, config)
      : await searchWithProvider({
          query,
          config: config.provider,
          timeoutMs: config.fetchTimeoutMs,
        });
  return toAllowlistedCandidates(hits, config.allowlist);
}

/** 走自訂代理端點（HTTP 契約） */
async function searchViaEndpoint(
  query: string,
  config: TutorWebSupplementConfig,
): Promise<TutorWebSearchHit[]> {
  const endpoint = config.searchEndpoint;
  if (endpoint === null) return [];

  let target: URL;
  try {
    target = new URL(endpoint);
  } catch {
    throw new Error("TUTOR_WEB_SEARCH_ENDPOINT is not a valid URL");
  }
  // 搜尋端點同樣要防 SSRF：只准 https 及公網位址，否則環境變數一打錯就變成
  // 「以學伴名義掃描內網」的工具。
  if (target.protocol !== "https:") throw new Error("TUTOR_WEB_SEARCH_ENDPOINT must be https");
  await assertPublicHost(target.hostname);

  const response = await fetch(target, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      query,
      domains: config.allowlist,
      limit: Math.max(4, config.maxSources * 3),
    }),
    redirect: "error",
    signal: AbortSignal.timeout(config.fetchTimeoutMs),
  });
  if (!response.ok) throw new Error(`search endpoint returned ${response.status}`);

  const payload: unknown = await response.json();
  const items = Array.isArray(payload)
    ? payload
    : typeof payload === "object" && payload !== null
      ? (payload as { results?: unknown }).results
      : null;
  if (!Array.isArray(items)) return [];

  // 代理路徑只負責轉成共通形狀；白名單過濾統一由 toAllowlistedCandidates 執行。
  return items.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const rawUrl = (item as { url?: unknown }).url;
    if (typeof rawUrl !== "string") return [];
    const rawTitle = (item as { title?: unknown }).title;
    return [{ url: rawUrl, title: typeof rawTitle === "string" ? rawTitle : "" }];
  });
}

export interface TutorWebFetchResult {
  url: string;
  title: string;
  text: string;
  siteLabel: string;
}

/**
 * 抓取一段已通過白名單的頁面文字。
 *
 * 任何一跳重定向離開白名單、變成非 https、或解析到私網位址，都會中止並拋出錯誤，
 * 該來源不會被採用（`collectTutorWebSupplement` 會把整個結果降級）。
 *
 * **已知限制（已記錄，不在本次修正）**：DNS 檢查與實際連線之間存在 TOCTOU 窗口，
 * 理論上惡意 DNS 可在兩者之間改換位址。Node 的 `fetch` 無法指定已解析的 IP，因此
 * MVP 以「連線前逐跳檢查 + 只准白名單 + 只准 https」作為防線；如要完全消除窗口，
 * 需改用 `node:https` 並以自訂 `lookup` 綁定位址。
 */
export async function fetchAllowlistedText(
  url: string,
  config: TutorWebSupplementConfig,
): Promise<TutorWebFetchResult> {
  const deadline = Date.now() + config.fetchTimeoutMs;
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    throw new Error("invalid url");
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (current.protocol !== "https:") throw new Error("only https is allowed");
    const siteLabel = matchTutorWebAllowlist(current.hostname, config.allowlist);
    if (siteLabel === null) throw new Error("host is not allowlisted");
    await assertPublicHost(current.hostname);

    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
        "accept-language": "zh-HK,zh;q=0.9,en;q=0.8",
        "user-agent": "hk-history-self-study-tutor/0.1 (school study companion)",
      },
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location === null || location.length === 0) throw new Error("redirect without location");
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new Error("invalid redirect target");
      }
      // 重定向後的 host 必須仍在白名單（下一圈會再驗一次，這裡先擋明顯的跳轉）
      if (matchTutorWebAllowlist(next.hostname, config.allowlist) === null) {
        throw new Error("redirect left the allowlist");
      }
      current = next;
      continue;
    }

    if (!response.ok) throw new Error(`upstream returned ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (
      contentType.length > 0 &&
      !/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)
    ) {
      throw new Error("unsupported content type");
    }

    const html = await readCappedText(response, MAX_RESPONSE_BYTES, contentType);
    const extracted = extractReadableText(html, config.maxCharsPerSource);
    if (extracted.text.length === 0) throw new Error("no readable text");
    return {
      url: current.toString(),
      title: extracted.title.length > 0 ? extracted.title : siteLabel,
      text: extracted.text,
      siteLabel,
    };
  }

  throw new Error("too many redirects");
}

/** 解析 host；任何一筆位址落在私網／保留區即拒絕（fail-closed） */
async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIpLiteralHost(host)) {
    if (isBlockedWebAddress(host)) throw new Error("address is not publicly routable");
    return;
  }
  const records = await lookup(host, { all: true, verbatim: true });
  if (records.length === 0) throw new Error("host did not resolve");
  for (const record of records) {
    if (isBlockedWebAddress(record.address)) {
      throw new Error("host resolves to a non-public address");
    }
  }
}

/** 讀取回應內容，並在 `maxBytes` 後停止（避免巨型頁面耗盡記憶體） */
async function readCappedText(
  response: Response,
  maxBytes: number,
  contentType: string,
): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      const take = value.byteLength > maxBytes - total ? value.subarray(0, maxBytes - total) : value;
      chunks.push(take);
      total += take.byteLength;
      if (take.byteLength < value.byteLength) break;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // 串流已結束或被上游中止：不影響已讀取的內容
    }
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decodeBytes(buffer, contentType);
}

/** charset 盡力轉 UTF-8：宣告的編碼不支援時退回 UTF-8，永不拋錯 */
function decodeBytes(bytes: Uint8Array, contentType: string): string {
  const declared = /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType)?.[1]?.toLowerCase();
  for (const candidate of [declared, "utf-8"]) {
    if (candidate === undefined || candidate.length === 0) continue;
    try {
      return new TextDecoder(candidate).decode(bytes);
    } catch {
      // 例如 Big5：Node 內建 TextDecoder 不支援，退回 UTF-8
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

const NON_CONTENT_ELEMENTS =
  /<(script|style|noscript|template|svg|iframe|form|nav|header|head|footer|aside|dialog)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const BLOCK_BOUNDARY = /<\/(?:p|div|li|ul|ol|h[1-6]|tr|table|section|article|main|blockquote|pre)\s*>/gi;
const TAG = /<[^>]+>/g;
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ldquo: "「",
  rdquo: "」",
  lsquo: "『",
  rsquo: "』",
  hellip: "…",
  mdash: "—",
  ndash: "–",
};

/**
 * 從 HTML 抽出可讀正文。
 *
 * MVP 刻意保持簡單、確定性（不引入 readability 之類的函式庫）：去掉 script／style／
 * 導覽及頁尾，優先取 `<article>`／`<main>`，再壓縮空白並截斷。抽得不夠準確的後果
 * 只是摘錄質素下降，不會令學生看到不存在的内容——介面顯示的網址永遠是真實抓取的
 * 那一頁。
 */
export function extractReadableText(html: string, maxChars: number): { title: string; text: string } {
  // 標題要在剪走 <head> 之前抽取（<head> 已列入 NON_CONTENT_ELEMENTS）
  const title = decodeEntities(
    /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] ??
      /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(html)?.[1] ??
      "",
  )
    .replace(TAG, " ")
    .replace(/\s+/g, " ")
    .trim();

  const stripped = html.replace(HTML_COMMENT, " ").replace(NON_CONTENT_ELEMENTS, " ");
  const region = mainRegion(stripped);
  const text = decodeEntities(
    region.replace(BLOCK_BOUNDARY, "\n").replace(TAG, " "),
  )
    .replace(/[ \t\u00a0\u3000]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title: title.slice(0, 200), text: text.slice(0, Math.max(0, maxChars)) };
}

function mainRegion(html: string): string {
  for (const tag of ["article", "main"]) {
    const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, "i").exec(html);
    const body = match?.[1];
    // 太短的代表只是版面外框（例如只有「分享」按鈕），改用整頁
    if (body !== undefined && body.length > 400) return body;
  }
  return html;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeFromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeFromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/**
 * 由正文抽取給學生看的短摘錄：取首段，並在句號／標點處收尾，避免截斷半句。
 */
function buildExcerpt(text: string): string {
  const firstParagraph = text.split(/\n{2,}/).map((part) => part.trim()).find((part) => part.length > 0);
  const source = (firstParagraph ?? text).replace(/\s+/g, " ").trim();
  if (source.length <= TUTOR_WEB_EXCERPT_MAX_CHARS) return source;
  const clipped = source.slice(0, TUTOR_WEB_EXCERPT_MAX_CHARS);
  const sentenceEnd = Math.max(
    clipped.lastIndexOf("。"),
    clipped.lastIndexOf("！"),
    clipped.lastIndexOf("？"),
    clipped.lastIndexOf(". "),
    clipped.lastIndexOf("；"),
  );
  if (sentenceEnd >= TUTOR_WEB_EXCERPT_MAX_CHARS / 2) return clipped.slice(0, sentenceEnd + 1).trim();
  return `${clipped.trim()}…`;
}
