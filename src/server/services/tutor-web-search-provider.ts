/**
 * 第三方搜尋 API 的薄包裝（`TUTOR_WEB_SEARCH_PROVIDER`）。
 *
 * ── 為甚麼是「薄」的 ──────────────────────────────────────────────────
 * 這個模組只做三件事：把學生提問送給 provider、把回應正規化成 `{ url, title }`、
 * 其他一律交由 `tutor-web-supplement.ts` 既有的白名單過濾與抓取流程處理。
 * 它不判斷白名單、不做 SSRF 檢查、不抽取正文——那些邏輯只有一份，不會因為多了一條
 * 搜尋路徑而出現第二套規則。
 *
 * ── 為甚麼不另開一隻 Cloud Run 服務 ────────────────────────────────────
 * 「薄包裝」可以是獨立服務，但那樣要多一份基建、一組憑證，而且學伴服務要經互聯網
 * 再呼叫自己（同一執行個體自我呼叫在併發數低時會互相等待）。改為在進程內呼叫
 * provider，效果相同：API key 只留在伺服器端、外部只見到 HTTPS 請求、延遲更低。
 * （若科組另有代理服務，仍可用 `TUTOR_WEB_SEARCH_ENDPOINT` 走 HTTP 契約。）
 *
 * ── 私隱（必須如實告知師生）──────────────────────────────────────────
 * 選用第三方 provider **等於把學生的提問內容送到該第三方**。因此：
 *   1. 只送**問題本身**：不送 learnerId、電郵、班別、學號、session 或任何上文；
 *   2. 長度截斷至 `TUTOR_WEB_SEARCH_QUERY_MAX_CHARS`（200 字），避免整段貼上的文章外送；
 *   3. Brave 一律開啟嚴格安全搜尋（`safesearch=strict`）；
 *      DeepSeek 只取標題及網址，正文仍由本模組自行抓取；
 *   4. 只在教材 `not-covered` 時才送出（`TUTOR_WEB_MODE=not-covered-only`），
 *      令大多數提問根本不會離開伺服器；
 *   5. 可用 `TUTOR_WEB_BLOCKED_TOPICS` 令敏感課題完全不外送。
 * 這些是「減少暴露」，不是「匿名化」：provider 仍可見到提問文字。是否接受由擁有者決定。
 *
 * ── 主要／後備來源（2026-11-06）────────────────────────────────────────
 * `config.fallback` 可指定後備 provider：主要來源失敗、逾時或結果全部被白名單剔除時，
 * 會再試後備。預設「Brave → DeepSeek」：Brave 免費額度用完或被限流時仍有外部參考，
 * 而 DeepSeek 沿用學伴本身的 API key，不增加新的憑證。
 *
 * Google Programmable Search 分支已於 2026-11-06 移除：學校 Workspace 停用了
 * 「程式化搜尋引擎」（無法建立 cx），而且 Custom Search JSON API 已於 2027-01-01 停止。
 */
import { matchTutorWebAllowlist } from "./tutor-web-allowlist";

/** 支援的第三方 provider（Google Custom Search 已於 2026-11-06 移除） */
export const TUTOR_WEB_SEARCH_PROVIDERS = ["brave", "deepseek"] as const;
export type TutorWebSearchProvider = (typeof TUTOR_WEB_SEARCH_PROVIDERS)[number];

/** 送去第三方的問題長度上限（字符） */
export const TUTOR_WEB_SEARCH_QUERY_MAX_CHARS = 200;
/**
 * DeepSeek Search 的查詢上限（128 個 Unicode 字符，超出即回 400）。
 *
 * 這個上限比 `TUTOR_WEB_SEARCH_QUERY_MAX_CHARS` 更嚴，因此 `buildProviderQuery`
 * 會先為 `site:` 提示預留長度，避免截斷後只剩下半截的 `site:` 令搜尋必然失敗。
 */
export const TUTOR_WEB_DEEPSEEK_QUERY_MAX_CHARS = 128;
/** 向 provider 要求的結果數；白名單過濾後通常只剩少數，因此索取較多 */
const REQUEST_RESULTS = 10;

export interface TutorWebSearchProviderConfig {
  provider: TutorWebSearchProvider | null;
  /** 第三方 API key（只由環境變數／Secret Manager 注入，永不回傳前端） */
  apiKey: string | null;
  /**
   * 附加在查詢字串的 `site:` 提示（host 清單）。
   *
   * 為甚麼需要：中文提問在沒有 `site:` 限制時，provider 往往回傳共筆百科或內容農場，
   * 全部會被白名單過濾掉，結果恒為 `not-used`。加上少量 `site:`（例如
   * `britannica.com,bbc.co.uk,history.com`）可大幅提高「回傳結果真的落在白名單」的機會。
   * 留空＝不加提示（純查詢）。
   */
  siteHints: string[];
  /** 自訂 API base URL（DeepSeek 用；留空使用官方 https://api.deepseek.com） */
  baseUrl?: string | null;
  /**
   * 主要來源「失效」（請求失敗、逾時或沒有任何可用結果）時改用的後備來源。
   *
   * 由 `config.ts` 依 `TUTOR_WEB_SEARCH_FALLBACK_PROVIDER` 建立；未設定時為 null。
   */
  fallback?: TutorWebSearchProviderConfig | null;
}

/** DeepSeek 的官方 API base URL（與 LLM 共用同一個帳戶及 key） */
export const TUTOR_WEB_DEEPSEEK_BASE_URL = "https://api.deepseek.com";

/** provider 是否已具備可用條件（Brave 及 DeepSeek 都只需 API key） */
export function isTutorWebSearchProviderReady(
  config: TutorWebSearchProviderConfig,
): boolean {
  if (config.provider === null) return false;
  return config.apiKey !== null && config.apiKey.trim().length > 0;
}

/** 正規化 provider 名稱：不認識的值回傳 null（由呼叫方當作未設定） */
export function parseTutorWebSearchProvider(raw: string | null): TutorWebSearchProvider | null {
  if (raw === null) return null;
  const value = raw.trim().toLowerCase();
  return (TUTOR_WEB_SEARCH_PROVIDERS as readonly string[]).includes(value)
    ? (value as TutorWebSearchProvider)
    : null;
}

export interface TutorWebSearchHit {
  url: string;
  title: string;
}

/**
 * 搜尋 provider 回非 2xx 時拋出的錯誤。
 *
 * 保留 HTTP 狀態碼，令呼叫方可以分辨「配額／權限問題」（401／402／403／429，短期內
 * 重試也不會成功）與「暫時性故障」（5xx／逾時）。前者會觸發短暫停用主要來源，
 * 之後的提問直接改用後備，避免每題都白等一次失敗請求。
 */
export class TutorWebSearchHttpError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
  ) {
    super(`${provider} search returned ${status}`);
    this.name = "TutorWebSearchHttpError";
  }
}

/**
 * 組出實際送出的查詢字串：截斷問題 + （可選）`site:` 提示。
 *
 * `site:` 以 OR 串連；提示數量上限 6，避免查詢過長而令 provider 退化成空結果。
 *
 * 不同 provider 的語法不同（2026-11-06 以真實 API 核對）：
 *   - Brave 接受 `(site:a OR site:b)` 分組；
 *   - DeepSeek 只接受**不加括號**的 `site:a OR site:b`（加括號會回 0 結果），
 *     且查詢上限為 128 字符（超出回 400）。
 * 因此 `options` 可指定提示語法及硬上限；未指定時行為與舊版完全相同。
 */
export function buildProviderQuery(
  query: string,
  siteHints: readonly string[],
  maxChars = TUTOR_WEB_SEARCH_QUERY_MAX_CHARS,
  options: { hintSyntax?: "grouped" | "plain"; hardMaxChars?: number } = {},
): string {
  const collapsed = query.replace(/\s+/g, " ").trim();
  const hints = siteHints
    .map((hint) => hint.trim().toLowerCase())
    .filter((hint) => hint.length > 0)
    .slice(0, 6);
  const hardMax = options.hardMaxChars ?? Number.POSITIVE_INFINITY;
  const questionLimit = Math.min(maxChars, hardMax);
  if (hints.length === 0) return collapsed.slice(0, questionLimit);

  const hintText = (count: number): string => {
    const joined = hints.slice(0, count).map((hint) => `site:${hint}`).join(" OR ");
    return options.hintSyntax === "plain" ? joined : `(${joined})`;
  };

  for (let count = hints.length; count >= 1; count -= 1) {
    const text = hintText(count);
    const room = hardMax - text.length - 1;
    if (room < 1) continue;
    const question = collapsed.slice(0, Math.min(maxChars, room)).trim();
    return `${question} ${text}`.trim();
  }
  // 提示本身已超出硬上限：只用問題（避免送出半截 site: 造成必然失敗）
  return collapsed.slice(0, questionLimit);
}

/**
 * 呼叫第三方搜尋並正規化結果。
 *
 * 任何失敗（非 2xx、格式不符、逾時、網絡錯誤）都會拋出，由
 * `collectTutorWebSupplement` 統一降級為 `failed`——不會令學伴回 500。
 */
export async function searchWithProvider(input: {
  query: string;
  config: TutorWebSearchProviderConfig;
  timeoutMs: number;
  /** 測試用：注入 fetch（預設用全域 fetch） */
  fetchImpl?: typeof fetch;
}): Promise<TutorWebSearchHit[]> {
  const { config } = input;
  if (!isTutorWebSearchProviderReady(config)) return [];
  const fetchImpl = input.fetchImpl ?? fetch;
  const query = buildProviderQuery(input.query, config.siteHints);
  const signal = AbortSignal.timeout(Math.max(1, input.timeoutMs));

  if (config.provider === "brave") {
    // Brave Search API
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(REQUEST_RESULTS));
    url.searchParams.set("safesearch", "strict");
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      headers: {
        accept: "application/json",
        "X-Subscription-Token": config.apiKey!,
      },
      signal,
    });
    if (!response.ok) throw new TutorWebSearchHttpError("brave", response.status);
    const payload: unknown = await response.json();
    const results =
      typeof payload === "object" && payload !== null
        ? ((payload as { web?: { results?: unknown } }).web?.results ?? null)
        : null;
    if (!Array.isArray(results)) return [];
    return results.flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const link = (item as { url?: unknown }).url;
      const title = (item as { title?: unknown }).title;
      return typeof link === "string"
        ? [{ url: link, title: typeof title === "string" ? title : "" }]
        : [];
    });
  }

  // DeepSeek Search API（與 LLM 共用同一個 API key；文件：api-docs.deepseek.com/zh-cn/guides/search）
  if (config.provider === "deepseek") {
    const base = (config.baseUrl?.trim() || TUTOR_WEB_DEEPSEEK_BASE_URL).replace(/\/+$/, "");
    // DeepSeek 的語法與長度限制都與 Google／Brave 不同（見 buildProviderQuery）
    const deepseekQuery = buildProviderQuery(
      input.query,
      config.siteHints,
      TUTOR_WEB_SEARCH_QUERY_MAX_CHARS,
      { hintSyntax: "plain", hardMaxChars: TUTOR_WEB_DEEPSEEK_QUERY_MAX_CHARS },
    );
    const response = await fetchImpl(`${base}/v1/tools/search`, {
      method: "POST",
      redirect: "error",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey!}`,
      },
      // need_content=false：正文交由本模組自行抓取，令白名單及 SSRF 檢查只有一套
      body: JSON.stringify({ query: deepseekQuery, count: REQUEST_RESULTS, need_content: false }),
      signal,
    });
    if (!response.ok) throw new TutorWebSearchHttpError("deepseek", response.status);
    const payload: unknown = await response.json();
    const results =
      typeof payload === "object" && payload !== null
        ? (payload as { results?: unknown }).results
        : null;
    if (!Array.isArray(results)) return [];
    return results.flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const link = (item as { url?: unknown }).url;
      const title = (item as { title?: unknown }).title;
      return typeof link === "string"
        ? [{ url: link, title: typeof title === "string" ? title : "" }]
        : [];
    });
  }

  return [];
}

/**
 * 把 provider／代理回傳的結果過濾成白名單候選。
 *
 * 這一步是**安全邊界**：即使 provider 被污染、或代理被換成惡意服務，只要結果不是
 * https 或不在白名單，就不會被請求。因此兩條搜尋路徑共用同一支過濾器。
 */
export function toAllowlistedCandidates(
  hits: readonly TutorWebSearchHit[],
  allowlist: readonly string[],
): { url: string; title: string; siteLabel: string }[] {
  const candidates: { url: string; title: string; siteLabel: string }[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    let parsed: URL;
    try {
      parsed = new URL(hit.url);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:") continue;
    const siteLabel = matchTutorWebAllowlist(parsed.hostname, allowlist);
    if (siteLabel === null) continue;
    parsed.hash = "";
    const url = parsed.toString();
    if (seen.has(url)) continue;
    seen.add(url);
    candidates.push({ url, title: hit.title.trim().slice(0, 200), siteLabel });
  }
  return candidates;
}
