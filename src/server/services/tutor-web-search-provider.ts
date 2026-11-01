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
 *   3. 一律開啟嚴格安全搜尋（Google `safe=active`／Brave `safesearch=strict`）；
 *   4. 只在教材 `not-covered` 時才送出（`TUTOR_WEB_MODE=not-covered-only`），
 *      令大多數提問根本不會離開伺服器；
 *   5. 可用 `TUTOR_WEB_BLOCKED_TOPICS` 令敏感課題完全不外送。
 * 這些是「減少暴露」，不是「匿名化」：provider 仍可見到提問文字。是否接受由擁有者決定。
 */
import { matchTutorWebAllowlist } from "./tutor-web-allowlist";

/** 支援的第三方 provider */
export const TUTOR_WEB_SEARCH_PROVIDERS = ["google", "brave"] as const;
export type TutorWebSearchProvider = (typeof TUTOR_WEB_SEARCH_PROVIDERS)[number];

/** 送去第三方的問題長度上限（字符） */
export const TUTOR_WEB_SEARCH_QUERY_MAX_CHARS = 200;
/** 向 provider 要求的結果數；白名單過濾後通常只剩少數，因此索取較多 */
const REQUEST_RESULTS = 10;

export interface TutorWebSearchProviderConfig {
  provider: TutorWebSearchProvider | null;
  /** 第三方 API key（只由環境變數／Secret Manager 注入，永不回傳前端） */
  apiKey: string | null;
  /** Google Programmable Search 的 cx；Brave 不需要 */
  engineId: string | null;
  /**
   * 附加在查詢字串的 `site:` 提示（host 清單）。
   *
   * 為甚麼需要：中文提問在沒有 `site:` 限制時，provider 往往回傳共筆百科或內容農場，
   * 全部會被白名單過濾掉，結果恒為 `not-used`。加上少量 `site:`（例如
   * `britannica.com,bbc.co.uk,history.com`）可大幅提高「回傳結果真的落在白名單」的機會。
   * 留空＝不加提示（純查詢）。
   */
  siteHints: string[];
}

/** provider 是否已具備可用條件（key 齊全；Google 另需 cx） */
export function isTutorWebSearchProviderReady(
  config: TutorWebSearchProviderConfig,
): boolean {
  if (config.provider === null) return false;
  if (config.apiKey === null || config.apiKey.trim().length === 0) return false;
  if (config.provider === "google") {
    return config.engineId !== null && config.engineId.trim().length > 0;
  }
  return true;
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
 * 組出實際送出的查詢字串：截斷問題 + （可選）`site:` 提示。
 *
 * `site:` 以 OR 串連（Google 及 Brave 都支援）；提示數量上限 6，避免查詢過長而
 * 令 provider 退化成空結果。
 */
export function buildProviderQuery(
  query: string,
  siteHints: readonly string[],
  maxChars = TUTOR_WEB_SEARCH_QUERY_MAX_CHARS,
): string {
  const collapsed = query.replace(/\s+/g, " ").trim();
  const trimmed =
    collapsed.length <= maxChars ? collapsed : collapsed.slice(0, maxChars);
  const hints = siteHints
    .map((hint) => hint.trim().toLowerCase())
    .filter((hint) => hint.length > 0)
    .slice(0, 6);
  if (hints.length === 0) return trimmed;
  return `${trimmed} (${hints.map((hint) => `site:${hint}`).join(" OR ")})`;
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

  if (config.provider === "google") {
    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("key", config.apiKey!);
    url.searchParams.set("cx", config.engineId!);
    url.searchParams.set("q", query);
    url.searchParams.set("num", String(REQUEST_RESULTS));
    // 嚴格安全搜尋：學生使用，不可回傳成人內容
    url.searchParams.set("safe", "active");
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      headers: { accept: "application/json" },
      signal,
    });
    if (!response.ok) throw new Error(`google search returned ${response.status}`);
    const payload: unknown = await response.json();
    const items =
      typeof payload === "object" && payload !== null
        ? (payload as { items?: unknown }).items
        : null;
    if (!Array.isArray(items)) return [];
    return items.flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const link = (item as { link?: unknown }).link;
      const title = (item as { title?: unknown }).title;
      return typeof link === "string"
        ? [{ url: link, title: typeof title === "string" ? title : "" }]
        : [];
    });
  }

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
  if (!response.ok) throw new Error(`brave search returned ${response.status}`);
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
