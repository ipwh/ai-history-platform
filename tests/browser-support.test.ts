import { describe, expect, it } from "vitest";

import {
  BROWSER_SUPPORT_NOTICE,
  MINIMUM_SUPPORTED_SAFARI,
  REQUIRED_WEB_FEATURES,
  SUPPORT_BASELINE_LABEL,
  buildLegacyBrowserWatchdogScript,
  evaluateUserAgent,
} from "@/lib/browser-support";

const IPAD_15_7 =
  "Mozilla/5.0 (iPad; CPU OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6.1 Mobile/15E148 Safari/604.1";
const IPAD_15_3 =
  "Mozilla/5.0 (iPad; CPU OS 15_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.3 Mobile/15E148 Safari/604.1";
const IPAD_16_0 =
  "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
const IPAD_16_4 =
  "Mozilla/5.0 (iPad; CPU OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1";
const IPADOS_DESKTOP_16_3 =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Safari/605.1.15";
const IPADOS_DESKTOP_15_6 =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Safari/605.1.15";
const CHROME_120 =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CHROME_110 =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36";

describe("支援基線判定", () => {
  it("iPadOS 15.4 或以上的 iPad 判為 supported（iPad Air 2 最高只可到 15.8.3）", () => {
    const verdict = evaluateUserAgent(IPAD_15_7);
    expect(verdict.status).toBe("supported");
    expect(verdict.detected).toBe("iOS／iPadOS 15.7");
  });

  it("iPadOS 15.4 以下仍然判為 below-baseline", () => {
    expect(evaluateUserAgent(IPAD_15_3).status).toBe("below-baseline");
  });

  it("iPadOS 16.0–16.3 及 16.4 以上同樣判為 supported", () => {
    expect(evaluateUserAgent(IPAD_16_0).status).toBe("supported");
    expect(evaluateUserAgent(IPADOS_DESKTOP_16_3).status).toBe("supported");
    expect(evaluateUserAgent(IPAD_16_4).status).toBe("supported");
  });

  it("iPadOS 以桌面版 UA 回報時，Safari 15.6 仍然判為 supported", () => {
    expect(evaluateUserAgent(IPADOS_DESKTOP_15_6).status).toBe("supported");
  });

  it("達到 16.4 的 Safari／iPadOS 判為 supported", () => {
    expect(evaluateUserAgent(IPAD_16_4).status).toBe("supported");
    expect(
      evaluateUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
      ).status,
    ).toBe("supported");
  });

  it("Chromium 系按 111 判定（Chrome 的 UA 也含 Safari/，不可誤判為 Safari）", () => {
    expect(evaluateUserAgent(CHROME_120).status).toBe("supported");
    expect(evaluateUserAgent(CHROME_110).status).toBe("below-baseline");
    expect(evaluateUserAgent(CHROME_120).detected).toContain("Chromium");
  });

  it("無法識別的 UA 回報 unknown，不聲稱支援或不支援", () => {
    expect(evaluateUserAgent("").status).toBe("unknown");
    expect(evaluateUserAgent("SomeWeirdBrowser/1.0").status).toBe("unknown");
  });

  it("基線常數與文件一致", () => {
    expect(MINIMUM_SUPPORTED_SAFARI).toEqual({ major: 15, minor: 4 });
    expect(SUPPORT_BASELINE_LABEL).toContain("15.4");
  });
});

describe("舊裝置提示", () => {
  it("文案說明支援基線、可行的下一步，並且不假裝題目已載入", () => {
    expect(BROWSER_SUPPORT_NOTICE.title).toContain("未能載入");
    expect(BROWSER_SUPPORT_NOTICE.body).toContain("15.4");
    expect(BROWSER_SUPPORT_NOTICE.actions.length).toBeGreaterThanOrEqual(3);
    const actions = BROWSER_SUPPORT_NOTICE.actions.join(" ");
    expect(actions).toContain("軟件更新");
    expect(actions).toContain("重新載入");
    expect(actions).toContain("截圖");
  });

  it("明確說明 iPad Air 2／iPad mini 4 無法更新至 iPadOS 16，不要叫學生做不可能的事", () => {
    const actions = BROWSER_SUPPORT_NOTICE.actions.join(" ");
    expect(actions).toContain("iPad Air 2");
    expect(actions).toContain("15.8");
  });
});

describe("看門狗腳本", () => {
  const script = buildLegacyBrowserWatchdogScript();

  it("只含 ES5 語法（舊引擎在 bundle 解析失敗時仍能執行）", () => {
    expect(script).not.toMatch(/=>/);
    expect(script).not.toMatch(/\bconst\s+/);
    expect(script).not.toMatch(/\blet\s+/);
    expect(script).not.toMatch(/\bclass\s+/);
    expect(script).not.toMatch(/`/);
    expect(script).not.toMatch(/\.\.\./);
    expect(script).not.toMatch(/\basync\b/);
    expect(script).not.toMatch(/function\s*\*/);
  });

  it("語法本身可以解析", () => {
    expect(() => new Function(script)).not.toThrow();
  });

  it("監看 hydrate 標記、面板及必要的功能清單", () => {
    expect(script).toContain("data-app-hydrated");
    expect(script).toContain("browser-support-fallback");
    expect(script).toContain("app-root");
    for (const feature of REQUIRED_WEB_FEATURES) {
      expect(script).toContain(feature);
    }
  });

  it("必要功能清單全部屬於 Safari 15.4 才齊備的 API", () => {
    expect(REQUIRED_WEB_FEATURES).toContain("Object.hasOwn");
    expect(REQUIRED_WEB_FEATURES).toContain("Array.prototype.at");
    expect(REQUIRED_WEB_FEATURES).toContain("Promise.prototype.finally");
  });
});
