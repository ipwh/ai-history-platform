/**
 * 瀏覽器支援基線與舊裝置提示（Sprint 23；Sprint 26 降低基線至 Safari 15.4）。
 *
 * 已核實的基線（證據見 docs/browser-support.md）：
 *   - `next@16.4.1` 官方預設支援 Chrome 111+、Edge 111+、Firefox 111+、Safari 16.4+，
 *     但可用 `package.json` 的 `browserslist` 把轉譯目標調低。
 *   - 2026-10-27 實測：`browserslist: ["safari 15.6", …]` 後，`.next/static/chunks`
 *     已**不再含** class static block（`static { }`，此乃 Safari 16.4 以前唯一的
 *     解析階段硬錯誤），其餘輸出語法的最低要求均 ≤ Safari 15.4。
 *   - 因此本網站改為把 **Safari 15.4（iPadOS／iOS 15.4）** 定為基線，令停留在
 *     iPadOS 15 的裝置（例如 iPad Air 2 最高只能安裝 iPadOS 15.8.3）仍可使用。
 *   - 仍有一項未實機驗證：Tailwind 4 產出的 `@property` 及 `color-mix()` 在 Safari < 16.4
 *     會被忽略／丟棄，globals.css 已補上 `--tw-*` 變數的預設值作為降級方案。
 *
 * 看門狗的做法不變：
 *   1. 在根版面注入一段**僅用 ES5 語法**的看門狗腳本（不會因新語法而解析失敗），
 *      偵測「必要功能是否齊全」；
 *   2. 若功能齊全但一直沒有 hydrate（例如網絡太慢、裝置太舊而反應極慢），
 *      在合理等待後顯示可操作的訊息，而不是無止境的 spinner；
 *   3. 訊息只說明「瀏覽器版本過舊／功能不足／載入超時」，不會假裝題目已載入，
 *      亦不會以靜態示範題掩蓋真正的失敗。
 */

export const MINIMUM_SUPPORTED_SAFARI = { major: 15, minor: 4 } as const;
export const MINIMUM_SUPPORTED_CHROMIUM = 111;
export const MINIMUM_SUPPORTED_FIREFOX = 111;

export const SUPPORT_BASELINE_LABEL = "Safari 15.4（iPadOS／iOS 15.4）或以上";

/**
 * 舊裝置提示中列出的必要功能。共同點是 Safari 16.4 才全部支援，
 * 因此可作為「這個引擎是否能執行本網站」的低成本判別。
 */
export const REQUIRED_WEB_FEATURES: readonly string[] = [
  "Promise.prototype.finally",
  "fetch",
  "AbortController",
  "Object.fromEntries",
  "Object.hasOwn",
  "Array.prototype.at",
];

export type BrowserSupportStatus = "supported" | "below-baseline" | "not-applicable" | "unknown";

export interface BrowserSupportVerdict {
  status: BrowserSupportStatus;
  /** 例如「iPadOS 15.7」「Safari 16.3」；無法識別時為 null */
  detected: string | null;
  /** 給開發者／支援人員的判讀理由（不直接顯示給學生） */
  reason: string;
}

function belowBaseline(major: number, minor: number): boolean {
  if (major !== MINIMUM_SUPPORTED_SAFARI.major) {
    return major < MINIMUM_SUPPORTED_SAFARI.major;
  }
  return minor < MINIMUM_SUPPORTED_SAFARI.minor;
}

/**
 * 以 User-Agent 判斷裝置是否達到支援基線。
 *
 * 注意：iPadOS 13 以後的 Safari 可回報「Macintosh; Intel Mac OS X」，此時只能靠
 * `Version/x.y` 判斷 Safari 版本；若連 `Version/` 都沒有，一律回報 `unknown`，
 * **不會**聲稱支援或不支援。
 */
export function evaluateUserAgent(userAgent: string): BrowserSupportVerdict {
  const ua = String(userAgent ?? "");

  const ios = /(?:iPad|iPhone|iPod)[^)]*OS (\d+)[._](\d+)/.exec(ua);
  if (ios !== null) {
    const major = Number(ios[1]);
    const minor = Number(ios[2]);
    return {
      status: belowBaseline(major, minor) ? "below-baseline" : "supported",
      detected: `iOS／iPadOS ${major}.${minor}`,
      reason: `iOS 系版本 ${major}.${minor}；基線為 ${MINIMUM_SUPPORTED_SAFARI.major}.${MINIMUM_SUPPORTED_SAFARI.minor}`,
    };
  }

  // Chromium 系（Chrome／Edge／Android／CriOS）：先判斷，因為它們的 UA 也含 `Safari/`。
  // iOS 上的 Chrome 是 WebKit 引擎，因此上面的 iOS 分支會先行處理。
  const chromium = /(?:Chrome|CriOS|Chromium|Edg)\/(\d+)\./.exec(ua);
  if (chromium !== null) {
    const major = Number(chromium[1]);
    return {
      status: major >= MINIMUM_SUPPORTED_CHROMIUM ? "supported" : "below-baseline",
      detected: `Chromium 系 ${major}`,
      reason: `Chromium 系版本 ${major}；基線為 ${MINIMUM_SUPPORTED_CHROMIUM}`,
    };
  }

  const firefox = /Firefox\/(\d+)\./.exec(ua);
  if (firefox !== null) {
    const major = Number(firefox[1]);
    return {
      status: major >= MINIMUM_SUPPORTED_FIREFOX ? "supported" : "below-baseline",
      detected: `Firefox ${major}`,
      reason: `Firefox 版本 ${major}；基線為 ${MINIMUM_SUPPORTED_FIREFOX}`,
    };
  }

  const safari = /Version\/(\d+)[._](\d+)[^)]*Safari\//.exec(ua);
  if (safari !== null) {
    const major = Number(safari[1]);
    const minor = Number(safari[2]);
    return {
      status: belowBaseline(major, minor) ? "below-baseline" : "supported",
      detected: `Safari ${major}.${minor}`,
      reason: `Safari 版本 ${major}.${minor}；基線為 ${MINIMUM_SUPPORTED_SAFARI.major}.${MINIMUM_SUPPORTED_SAFARI.minor}`,
    };
  }

  return { status: "unknown", detected: null, reason: "無法由 User-Agent 識別瀏覽器版本" };
}

/** 舊裝置提示的文案（同時用於舊裝置面板及 <noscript>） */
export const BROWSER_SUPPORT_NOTICE = {
  title: "練習未能載入",
  body:
    "如果你的畫面一直停在「正在載入題目…」，可能是瀏覽器版本太舊、裝置太舊而反應極慢，或網絡太慢。" +
    `本網站需要 ${SUPPORT_BASELINE_LABEL}。`,
  actions: [
    "先按「重新載入」再試一次：較舊的 iPad 首次載入需要較長時間，稍等 30 至 60 秒即可。",
    "如果仍然不行，請在「設定 → 一般 → 關於本機」查看「軟件版本」，並在「設定 → 一般 → 軟件更新」更新至最新版本（iPad 需為 iPadOS 15.4 或以上）。",
    "注意：iPad Air 2、iPad mini 4 等舊機型最高只能安裝 iPadOS 15.8.3，無法更新到 iPadOS 16 或以上。如果你的系統版本已是 15.8 而仍無法載入，請改用較新的平板或電腦，並把這個畫面截圖交給老師，註明裝置型號及系統版本。",
  ],
} as const;

/**
 * 產生注入根版面的看門狗腳本。
 *
 * **必須只含 ES5 語法**（沒有箭頭函式、`const`／`let`、樣板字串、class、展開運算子），
 * 因為它要在「連框架 bundle 都無法解析」的舊引擎上執行。測試會檢查這一點。
 */
export function buildLegacyBrowserWatchdogScript(): string {
  const required = JSON.stringify(REQUIRED_WEB_FEATURES);
  // 舊 iPad（例如 iPad Air 2）解析及 hydrate 都比新機慢得多：20 秒（40 × 500ms）會在
  // 裝置仍在正常載入時就誤報失敗。改為 60 秒，同時保留「一直沒有 hydrate」的提示。
  const attempts = 120;
  const intervalMs = 500;
  return `(function () {
  var REQUIRED = ${required};
  var ATTEMPTS = ${attempts};
  var INTERVAL_MS = ${intervalMs};

  function missingFeature(path) {
    var parts = path.split('.');
    var target = window;
    for (var i = 0; i < parts.length; i += 1) {
      var name = parts[i];
      if (name === 'prototype') {
        target = target ? target.prototype : null;
        continue;
      }
      if (target === null || target === undefined) return true;
      target = target[name];
    }
    return target === null || target === undefined;
  }

  function detectVersion() {
    var ua = navigator.userAgent || '';
    var ios = /(?:iPad|iPhone|iPod)[^)]*OS (\\d+)[._](\\d+)/.exec(ua);
    if (ios) return 'iOS／iPadOS ' + ios[1] + '.' + ios[2];
    var safari = /Version\\/(\\d+)[._](\\d+)[^)]*Safari\\//.exec(ua);
    if (safari) return 'Safari ' + safari[1] + '.' + safari[2];
    var chromium = /(?:Chrome|CriOS|Chromium|Edg)\\/(\\d+)\\./.exec(ua);
    if (chromium) return 'Chromium ' + chromium[1];
    var firefox = /Firefox\\/(\\d+)\\./.exec(ua);
    if (firefox) return 'Firefox ' + firefox[1];
    return '';
  }

  function show(reason) {
    var panel = document.getElementById('browser-support-fallback');
    if (!panel) return;
    var app = document.getElementById('app-root');
    if (app) app.style.display = 'none';
    var detail = document.getElementById('browser-support-detected');
    if (detail) {
      var version = detectVersion();
      var text = (version ? '偵測到：' + version + '。' : '') + reason;
      detail.innerHTML = '';
      detail.appendChild(document.createTextNode(text));
    }
    panel.removeAttribute('hidden');
    panel.setAttribute('role', 'alert');
    try { panel.focus(); } catch (ignored) {}
  }

  function computeMissing() {
    var missing = [];
    for (var i = 0; i < REQUIRED.length; i += 1) {
      if (missingFeature(REQUIRED[i])) missing.push(REQUIRED[i]);
    }
    return missing;
  }

  var tries = 0;
  function poll() {
    if (document.documentElement.getAttribute('data-app-hydrated') === '1') return;
    var missing = computeMissing();
    if (missing.length > 0) {
      show('這個瀏覽器缺少本網站需要的功能（' + missing.join('、') + '）。');
      return;
    }
    tries += 1;
    if (tries >= ATTEMPTS) {
      show('畫面停留在載入中，可能是網絡太慢或程式未能啟動。');
      return;
    }
    setTimeout(poll, INTERVAL_MS);
  }

  function start() { setTimeout(poll, INTERVAL_MS); }
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();`;
}
