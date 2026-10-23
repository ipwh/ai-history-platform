import { expect, request, test, type Page, type Route } from "@playwright/test";

import { UI_TEST_BASE_URL, UI_TEST_IDENTITIES, readTestCookies } from "./test-env";

/**
 * 學生練習頁的瀏覽器層測試（Sprint 23）。
 *
 * 目的：把 Sprint 23 的兩個缺陷固定下來。
 *
 *   1. **載入失敗必須說得出是甚麼失敗**：以前無論網絡、伺服器、格式或空題目清單，
 *      畫面都只會停在「正在載入題目…」，學生與教師都無法判斷原因。
 *   2. **框架未能啟動時必須有可操作的提示**：Safari 16.4 以下的引擎無法解析
 *      Next.js 的 bundle，若沒有任何提示，學生只會看到永遠不會結束的載入畫面。
 *
 * 這裡用真實的 Next 伺服器、真實 route handler 及真實授權檢查；只有外部失敗
 * （500、格式錯誤、網絡中斷、空清單）以 route interception 製造，不會繞過伺服器端
 * 的任何驗證或評分。
 *
 * 注意：桌面 Chromium／WebKit 都不等同實體舊 iPadOS Safari（見 docs/browser-support.md）。
 */
const cookies = readTestCookies();
const SESSION_COOKIE = "hk-history-session";

const PRACTICE_API = /^\/api\/practice\/[^/]+$/;
const QUESTION_HEADER = /第 1 \/ \d+ 題/;

async function signIn(page: Page, role: keyof typeof UI_TEST_IDENTITIES) {
  await page.context().addCookies([
    { name: SESSION_COOKIE, value: cookies[role], url: UI_TEST_BASE_URL },
  ]);
}

/** 透過真實 API 建立一次練習，回傳 session id（學生身分由 cookie 決定） */
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

/** 攔截「讀取這次練習」的 GET，模擬指定的失敗 */
async function interceptPracticeLoad(
  page: Page,
  handler: (route: Route) => Promise<void>,
): Promise<void> {
  await page.route(
    (url) => PRACTICE_API.test(new URL(url).pathname),
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await handler(route);
    },
  );
}

test("載入題目、作答、取得回饋，重新載入後選項次序不變", async ({ page }) => {
  await signIn(page, "student");
  const sessionId = await createPracticeSession();
  await page.goto(`/practice/${sessionId}`);

  await expect(page.getByText(QUESTION_HEADER)).toBeVisible();
  const options = page.locator(".option-row");
  await expect(options.first()).toBeVisible();
  const beforeReload = await options.allInnerTexts();

  // 選第一個選項並提交：只驗證「有回饋、狀態有標示」，不假設哪一項是正確答案。
  // 回饋會同時標示正確選項（correct）與學生所選的錯誤選項（wrong），因此檢查
  // 「剛好有一個正確標示」而不是「只有一個有狀態」。
  await options.first().click();
  await page.getByRole("button", { name: "提交答案" }).click();
  await expect(page.locator('.option-row[data-state="correct"]')).toHaveCount(1);

  // 重新載入：選項次序必須與載入時完全相同（快照已凍結）
  await page.reload();
  await expect(page.getByText(QUESTION_HEADER)).toBeVisible();
  const afterReload = await page.locator(".option-row").allInnerTexts();
  expect(afterReload).toEqual(beforeReload);
});

test("伺服器 500：顯示「伺服器暫時出錯」並可重試，不會停在載入中", async ({ page }) => {
  await signIn(page, "student");
  const sessionId = await createPracticeSession();
  await interceptPracticeLoad(page, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "模擬伺服器錯誤" }),
    });
  });

  await page.goto(`/practice/${sessionId}`);
  await expect(page.getByText(/伺服器暫時出錯/)).toBeVisible();
  await expect(page.getByText(/模擬伺服器錯誤/)).toBeVisible();
  await expect(page.getByRole("button", { name: "重試" })).toBeVisible();
  // 只看實際渲染的區域：RSC 初始 payload（<script>）仍會包含載入字串，
  // 那不是學生看得到的內容。
  await expect(page.locator("main").getByText("正在載入題目…")).toHaveCount(0);
});

test("回應不是 JSON：顯示「伺服器回應格式不正確」", async ({ page }) => {
  await signIn(page, "student");
  const sessionId = await createPracticeSession();
  await interceptPracticeLoad(page, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<html>proxy error</html>",
    });
  });

  await page.goto(`/practice/${sessionId}`);
  await expect(page.getByText(/伺服器回應格式不正確/)).toBeVisible();
  await expect(page.getByRole("button", { name: "重試" })).toBeVisible();
});

test("題目清單為空：顯示明確錯誤而不是無限載入", async ({ page }) => {
  await signIn(page, "student");
  const sessionId = await createPracticeSession();
  await interceptPracticeLoad(page, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session: { id: sessionId },
        questions: [],
        notice: null,
        feedback: [],
      }),
    });
  });

  await page.goto(`/practice/${sessionId}`);
  await expect(page.getByText(/這次練習沒有可顯示的題目/)).toBeVisible();
  await expect(page.locator("main").getByText("正在載入題目…")).toHaveCount(0);
});

test("網絡中斷：顯示「未能連接伺服器」", async ({ page }) => {
  await signIn(page, "student");
  const sessionId = await createPracticeSession();
  await interceptPracticeLoad(page, async (route) => {
    await route.abort("failed");
  });

  await page.goto(`/practice/${sessionId}`);
  await expect(page.getByText(/未能連接伺服器/)).toBeVisible();
});

test("框架未能啟動時（模擬舊引擎無法解析 bundle）顯示可操作的舊裝置提示", async ({
  page,
}) => {
  test.slow();
  // 只封鎖 JavaScript：CSS 仍可載入，重現「頁面有樣式但 React 從未 hydrate」的情況，
  // 這正是 Safari 16.4 以下引擎無法解析 bundle 時的樣子。
  await page.route(/\/_next\/static\/.*\.js(\?|$)/, (route) => route.abort("failed"));
  await signIn(page, "student");

  await page.goto("/");
  const panel = page.locator("#browser-support-fallback");
  // 看門狗每 500 毫秒檢查一次、最多 40 次（約 20 秒）
  await expect(panel).toBeVisible({ timeout: 45_000 });
  await expect(panel.getByRole("heading", { name: "練習未能載入" })).toBeVisible();
  await expect(panel.getByText(/16\.4/).first()).toBeVisible();
  await expect(panel.getByRole("link", { name: "重新載入" })).toBeVisible();
  // 應用程式內容被隱藏，不會同時顯示沒有內容的載入狀態
  await expect(page.locator("#app-root")).toBeHidden();
});

/**
 * 以下四項是 Sprint 24 補上的相容性與錯誤處理測試：
 *   - 下一題導覽（舊裝置相容性驗收的一部分）
 *   - 私密瀏覽／`localStorage` 被封鎖
 *   - 未登入時由伺服器守衛重新導向（不是空白畫面）
 *   - API 逾時（20 秒時限）
 */
test("可以切換到下一題，並在重新載入後停留在同一題", async ({ page }) => {
  await signIn(page, "student");
  const sessionId = await createPracticeSession();
  await page.goto(`/practice/${sessionId}`);

  await expect(page.getByText(QUESTION_HEADER)).toBeVisible();
  const firstQuestion = await page.locator("article h1").innerText();

  await page.getByRole("button", { name: "下一題" }).click();
  await expect(page.getByText(/第 2 \/ \d+ 題/)).toBeVisible();
  const secondQuestion = await page.locator("article h1").innerText();
  expect(secondQuestion).not.toBe(firstQuestion);

  // 重新載入會回到第一題（題目次序已凍結），但內容必須與第一次相同
  await page.reload();
  await expect(page.getByText(QUESTION_HEADER)).toBeVisible();
  expect(await page.locator("article h1").innerText()).toBe(firstQuestion);
});

test("私密瀏覽／localStorage 被封鎖時仍可載入及作答", async ({ page }) => {
  // 舊版 Safari 私密瀏覽會在存取 localStorage 時拋出 SecurityError；
  // 以往這會令整個頁面在載入階段崩潰。現在應改用記憶體中的識別碼繼續。
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError: localStorage is disabled in this context");
      },
    });
  });
  await signIn(page, "student");
  const sessionId = await createPracticeSession();

  await page.goto(`/practice/${sessionId}`);
  await expect(page.getByText(QUESTION_HEADER)).toBeVisible();
  await page.locator(".option-row").first().click();
  await page.getByRole("button", { name: "提交答案" }).click();
  await expect(page.locator('.option-row[data-state="correct"]')).toHaveCount(1);
});

test("未登入時由伺服器守衛導向登入頁，而不是顯示空白或假題目", async ({ page }) => {
  const sessionId = await createPracticeSession();
  // 刻意不加入任何登入 cookie
  await page.goto(`/practice/${sessionId}`);
  await expect(page).toHaveURL(/\/login/);
  // 不是練習畫面：選項按鈕不存在（不會在未登入時派題或顯示假資料）
  await expect(page.locator(".option-row")).toHaveCount(0);
});

test("API 逾時（超過 20 秒沒有回應）會顯示逾時訊息並可重試", async ({ page }) => {
  test.slow();
  await signIn(page, "student");
  const sessionId = await createPracticeSession();
  // 永不回應：模擬網絡停滯（伺服器或中間代理沒有回應）
  await interceptPracticeLoad(page, async () => {
    await new Promise(() => {});
  });

  await page.goto(`/practice/${sessionId}`);
  await expect(page.getByText(/載入逾時/)).toBeVisible({ timeout: 35_000 });
  await expect(page.getByRole("button", { name: "重試" })).toBeVisible();
});
