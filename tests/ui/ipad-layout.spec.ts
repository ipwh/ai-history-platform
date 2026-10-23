import { expect, request, test, type Page } from "@playwright/test";

import { UI_TEST_BASE_URL, readTestCookies } from "./test-env";

/**
 * iPad 第 8 代尺寸的版面及觸控測試（Sprint 25B）。
 *
 * **這不是實機測試**：它以 iPad 第 8 代的**邏輯解析度**（810 × 1080，直向）及觸控
 * 事件模擬版面與點擊行為，使用 Chromium／WebKit 桌面引擎。它不能證明 iPadOS Safari
 * 的渲染、虛擬鍵盤、記憶體壓力或實際效能（見 docs/browser-support.md §8）。
 *
 * 驗收標準（可自動化的部分）：
 *   - 沒有水平溢出（文字不會被推出畫面）；
 *   - 選項按鈕的觸控目標高度 ≥ 44 CSS px（Apple HIG 的最小建議）；
 *   - 以觸控點選、提交、取得回饋、前往下一題的流程正常；
 *   - 應用程式有 hydrate（舊裝置提示面板不出現）。
 */
const cookies = readTestCookies();
const SESSION_COOKIE = "hk-history-session";

async function signIn(page: Page): Promise<void> {
  await page.context().addCookies([
    { name: SESSION_COOKIE, value: cookies.student, url: UI_TEST_BASE_URL },
  ]);
}

async function createPracticeSession(questionCount = 3): Promise<string> {
  const context = await request.newContext({
    baseURL: UI_TEST_BASE_URL,
    extraHTTPHeaders: { cookie: `${SESSION_COOKIE}=${cookies.student}` },
  });
  try {
    const response = await context.post("/api/practice", {
      data: {
        learnerId: "ignored-when-signed-in",
        topicId: "topic-5",
        sectionIds: ["topic-5-renaissance-reformation"],
        questionTypes: ["mc"],
        difficulty: "basic",
        questionCount,
        mode: "standard",
        questionSource: "bank",
        sourceSessionId: null,
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    const body = (await response.json()) as { session: { id: string } };
    return body.session.id;
  } finally {
    await context.dispose();
  }
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe("iPad 第 8 代尺寸（810 × 1080，觸控）", () => {
  test.use({ viewport: { width: 810, height: 1080 }, hasTouch: true, deviceScaleFactor: 2 });

  test("題目版面沒有水平溢出，選項觸控目標 ≥44px，可點選、提交及前往下一題", async ({
    page,
  }) => {
    await signIn(page);
    const sessionId = await createPracticeSession();
    await page.goto(`/practice/${sessionId}`);

    await expect(page.getByText(/第 1 \/ \d+ 題/)).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    const options = page.locator(".option-row");
    const count = await options.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      const box = await options.nth(index).boundingBox();
      expect(box, `option ${index}`).not.toBeNull();
      expect(box!.height, `option ${index} 高度`).toBeGreaterThanOrEqual(44);
      expect(box!.width, `option ${index} 寬度`).toBeGreaterThan(200);
    }

    // 觸控點選（hasTouch）而非滑鼠點擊
    await options.first().tap();
    await expect(options.first()).toHaveAttribute("data-selected", "true");
    await page.getByRole("button", { name: "提交答案" }).tap();
    await expect(page.locator('.option-row[data-state="correct"]')).toHaveCount(1);

    await page.getByRole("button", { name: "下一題" }).tap();
    await expect(page.getByText(/第 2 \/ \d+ 題/)).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    // 已 hydrate：舊裝置提示面板不會出現
    await expect(page.locator("#browser-support-fallback")).toBeHidden();
  });
});

test.describe("窄螢幕（320 × 568）", () => {
  test.use({ viewport: { width: 320, height: 568 }, hasTouch: true });

  test("沒有水平溢出，選項與回饋仍可閱讀及操作", async ({ page }) => {
    await signIn(page);
    const sessionId = await createPracticeSession();
    await page.goto(`/practice/${sessionId}`);

    await expect(page.getByText(/第 1 \/ \d+ 題/)).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    const options = page.locator(".option-row");
    await expect(options.first()).toBeVisible();
    await options.first().click();
    await page.getByRole("button", { name: "提交答案" }).click();
    await expect(page.locator('.option-row[data-state="correct"]')).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });
});

test.describe("橫向（1080 × 810）", () => {
  test.use({ viewport: { width: 1080, height: 810 }, hasTouch: true });

  test("橫向沒有水平溢出", async ({ page }) => {
    await signIn(page);
    const sessionId = await createPracticeSession();
    await page.goto(`/practice/${sessionId}`);
    await expect(page.getByText(/第 1 \/ \d+ 題/)).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });
});
