import { expect, request, test, type Page, type Route } from "@playwright/test";

import { UI_TEST_BASE_URL, UI_TEST_IDENTITIES, readTestCookies } from "./test-env";

/**
 * 學生練習頁的瀏覽器層測試（Sprint 23）。
 *
 * 目的：把 Sprint 23 的兩個缺陷固定下來。
 *
 *   1. **載入失敗必須說得出是甚麼失敗**：以前無論網絡、伺服器、格式或空題目清單，
 *      畫面都只會停在「正在載入題目…」，學生與教師都無法判斷原因。
 *   2. **框架未能啟動時必須有可操作的提示**：Safari 15.4 以下的引擎無法解析
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
async function createPracticeSession(
  questionCount = 3,
  role: keyof typeof UI_TEST_IDENTITIES = "student",
): Promise<string> {
  const context = await request.newContext({
    baseURL: UI_TEST_BASE_URL,
    extraHTTPHeaders: { cookie: `${SESSION_COOKIE}=${cookies[role]}` },
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
  // 這正是 Safari 15.4 以下引擎無法解析 bundle 時的樣子。
  await page.route(/\/_next\/static\/.*\.js(\?|$)/, (route) => route.abort("failed"));
  await signIn(page, "student");

  await page.goto("/");
  const panel = page.locator("#browser-support-fallback");
  // 看門狗每 500 毫秒檢查一次、最多 120 次（約 60 秒）
  await expect(panel).toBeVisible({ timeout: 75_000 });
  await expect(panel.getByRole("heading", { name: "練習未能載入" })).toBeVisible();
  await expect(panel.getByText(/15\.4/).first()).toBeVisible();
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

/**
 * 作答頁的引導（2026-11-11 擁有者指示）：
 * 學生經常誤按「提交答案」及「下一題」，因此未選答案時「提交答案」不可按；
 * 提交後同一個位置才變成「下一題」，畫面任何時候只有一個「下一題」。
 */
test("未選答案時不可提交，提交後主要按鈕才變成「下一題」", async ({ page }) => {
  await signIn(page, "student");
  const sessionId = await createPracticeSession();
  await page.goto(`/practice/${sessionId}`);
  await expect(page.getByText(QUESTION_HEADER)).toBeVisible();

  const submit = page.getByRole("button", { name: "提交答案" });
  await expect(submit).toBeDisabled();
  await expect(page.getByText(/第 1 步：點選一個答案方格/)).toBeVisible();

  await page.locator(".option-row").first().click();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.locator('.option-row[data-state="correct"]')).toHaveCount(1);

  // 已提交：主要按鈕變成「下一題」，而且只有一個（不會與另一個「下一題」並排）
  await expect(page.getByRole("button", { name: "提交答案" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "下一題" })).toHaveCount(1);
  await expect(page.getByText(/已提交，請按「下一題」繼續/)).toBeVisible();
});

test("未登入時由伺服器守衛導向登入頁，而不是顯示空白或假題目", async ({ page }) => {
  const sessionId = await createPracticeSession();
  // 刻意不加入任何登入 cookie
  await page.goto(`/practice/${sessionId}`);
  await expect(page).toHaveURL(/\/login/);
  // 不是練習畫面：選項按鈕不存在（不會在未登入時派題或顯示假資料）
  await expect(page.locator(".option-row")).toHaveCount(0);
});

/**
 * 練習 → 學伴（2026-11-11 擁有者指示）：
 * 以往一按「問學伴這題的概念」就離開作答頁，學伴頁沒有回到該題的入口，
 * 學生只能靠瀏覽器上一頁，作業等於中斷。網址現在會帶 `returnTo`，
 * 學伴頁頂部顯示「返回這題繼續作答」，並回到同一題（答案與回饋已儲存）。
 */
test("按「問學伴這題的概念」後可返回同一題繼續作答", async ({ page }) => {
  await signIn(page, "tutorStudent");
  const sessionId = await createPracticeSession(3, "tutorStudent");
  await page.goto(`/practice/${sessionId}`);
  await expect(page.getByText(QUESTION_HEADER)).toBeVisible();

  await page.locator(".option-row").first().click();
  await page.getByRole("button", { name: "提交答案" }).click();
  await expect(page.locator('.option-row[data-state="correct"]')).toHaveCount(1);
  const questionStem = await page.locator("article h1").innerText();

  const tutorLink = page.getByRole("link", { name: /問學伴這題的概念/ });
  const tutorHref = (await tutorLink.getAttribute("href")) ?? "";
  expect(tutorHref).toContain("returnTo=");
  const questionId = new URL(tutorHref, UI_TEST_BASE_URL).searchParams.get("questionId");
  await tutorLink.click();

  await expect(page).toHaveURL(/\/tutor\?/);
  const returnLink = page.getByRole("link", { name: "← 返回這題繼續作答" });
  await expect(returnLink).toBeVisible();
  await expect(returnLink).toHaveAttribute(
    "href",
    `/practice/${sessionId}?question=${questionId}`,
  );

  await returnLink.click();
  await expect(page).toHaveURL(new RegExp(`/practice/${sessionId}\\?question=`));
  await expect(page.getByText(QUESTION_HEADER)).toBeVisible();
  // 回到同一題：題幹相同，而且那一題已作答（回饋仍在）
  expect(await page.locator("article h1").innerText()).toBe(questionStem);
  await expect(page.getByText(/已作答 1 題/)).toBeVisible();
  await expect(page.locator('.option-row[data-state="correct"]')).toHaveCount(1);
});

/**
 * 學伴提問（2026-11-11 擁有者指示）：
 * 學生以往只會見到系統預設的問題，無法自行輸入。現在提問框在手機貼齊底部，
 * 開場引導亦有「自己輸入問題」；學生自行輸入的內容會原樣送到 `/api/tutor/chat`。
 */
test("學生可在學伴頁自行輸入問題並送出（不限於系統建議）", async ({ page }) => {
  const ownQuestion = "文藝復興的建築同哥德式建築有甚麼分別？";
  const reply = "（示範）可以先比較圓頂與尖拱、圓柱與飛扶壁。";
  const posted: Array<{ message?: string }> = [];

  await signIn(page, "tutorStudent");
  await page.route("**/api/tutor/chat**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          sessionId: "ui-tutor-session",
          messages: [],
          remaining: 15,
          dailyLimit: 15,
          windowLimitReached: false,
          truncated: false,
          messageCount: 0,
          topicId: null,
          practiceContext: null,
        }),
      });
      return;
    }
    posted.push(request.postDataJSON() as { message?: string });
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reply, sessionId: "ui-tutor-session", remaining: 14, dailyLimit: 15 }),
    });
  });

  await page.goto("/tutor");
  const composer = page.getByLabel(/你的歷史問題/);
  await expect(composer).toBeEditable();
  await composer.fill(ownQuestion);
  await page.getByRole("button", { name: "傳送問題" }).click();

  await expect(page.getByText(reply, { exact: true })).toBeVisible();
  expect(posted).toHaveLength(1);
  expect(posted[0]?.message).toBe(ownQuestion);
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
