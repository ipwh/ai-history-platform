import { expect, request, test, type Page, type Route } from "@playwright/test";

import { UI_TEST_BASE_URL, UI_TEST_IDENTITIES, readTestCookies } from "./test-env";

/**
 * `/teacher/review` 的瀏覽器層測試。
 *
 * 這些測試使用真實的 Next 伺服器、真實的 route handler 及真實授權檢查；
 * 只有外部資料來源（例如模擬 409／429）以 route interception 製造，
 * 不會繞過伺服器端的版本、指紋或學科授權驗證。
 *
 * 2026-10-20 簡化版：畫面改成單欄、三個大按鈕、理由用快速選項，
 * 這裡同步以新的可見文字定位，測試仍然驗證同一批安全邊界
 * （沒有預設核准、必須有理由、衝突不顯示成功）。
 */
const cookies = readTestCookies();

const SESSION_COOKIE = "hk-history-session";

const QUEUE_TABS = {
  servability: "學生答唔到的題目",
  provenance: "要跟進課本依據的題目",
  golden: "評分示例題",
} as const;

const ITEM_LIST = 'ol[aria-label="題目清單"]';
const SUBMIT = "確認提交";
const CHIP_NO_EVIDENCE = "缺少原卷或課本證據";

async function signIn(page: Page, role: keyof typeof UI_TEST_IDENTITIES) {
  await page.context().addCookies([
    { name: SESSION_COOKIE, value: cookies[role], url: UI_TEST_BASE_URL },
  ]);
}

async function apiContext(role?: keyof typeof UI_TEST_IDENTITIES) {
  return request.newContext({
    baseURL: UI_TEST_BASE_URL,
    extraHTTPHeaders: role ? { cookie: `${SESSION_COOKIE}=${cookies[role]}` } : {},
  });
}

/**
 * 開啟「學生答唔到的題目」清單，並回傳伺服器實際提供的項目數。
 *
 * 清單可能為空（所有題目已修復），此時頁面必須顯示明確的空狀態，
 * 而不是顯示推算數字；回傳 0 讓需要項目的測試以 skip 表示未驗證。
 */
async function openServabilityQueue(page: Page): Promise<number> {
  await page.goto("/teacher/review");
  await expect(page.getByRole("heading", { name: "教師審核工作台" })).toBeVisible();
  await expect(page.getByRole("tab", { name: QUEUE_TABS.servability })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const items = page.locator(`${ITEM_LIST} button`);
  await expect
    .poll(
      async () =>
        (await items.count()) > 0 || (await page.getByText(/目前沒有題目|仍未產生/).count()) > 0,
      { timeout: 15_000, message: "等待清單載入完成" },
    )
    .toBe(true);
  return items.count();
}

const EMPTY_QUEUE = "此環境的不可作答清單為空（題目均已修復），無法驗證表單行為。";

test.describe("清單與分頁", () => {
  test("顯示伺服器提供的數量與第一頁項目", async ({ page }) => {
    await signIn(page, "reviewer");
    const api = await apiContext("reviewer");
    const response = await api.get("/api/teacher/review-queue?queue=servability&page=1&pageSize=10");
    expect(response.status()).toBe(200);
    const payload = (await response.json()) as {
      total: number;
      pageSize: number;
      available: boolean;
      items: { id: string }[];
    };
    await api.dispose();

    await openServabilityQueue(page);

    if (!payload.available) {
      await expect(page.getByText(/仍未產生/)).toBeVisible();
      return;
    }

    // 顯示的數量必須等於伺服器回報的總數，而非前端自行推算。
    await expect(page.getByText(`共 ${payload.total} 題`)).toBeVisible();
    const itemLabels = await page.locator(`${ITEM_LIST} button`).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-question-id")),
    );
    expect(itemLabels).toEqual(payload.items.slice(0, payload.pageSize).map((item) => item.id));
  });

  test("分頁使用伺服器端限制並可返回第一頁", async ({ page }) => {
    await signIn(page, "reviewer");
    const api = await apiContext("reviewer");
    const first = await api.get("/api/teacher/review-queue?queue=servability&page=1&pageSize=10");
    const payload = (await first.json()) as { total: number; pageSize: number; available: boolean };
    const second = await api.get("/api/teacher/review-queue?queue=servability&page=2&pageSize=10");
    const secondPayload = (await second.json()) as { items: { id: string }[] };
    await api.dispose();

    await openServabilityQueue(page);
    test.skip(
      !payload.available || payload.total <= payload.pageSize,
      "此環境的清單不足一頁，無法驗證分頁。",
    );

    await page.getByRole("button", { name: "下一頁" }).click();
    await expect(page.getByText(/^第 2／/)).toBeVisible();
    const pageTwoIds = await page.locator(`${ITEM_LIST} button`).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-question-id")),
    );
    expect(pageTwoIds).toEqual(secondPayload.items.map((item) => item.id));

    await page.getByRole("button", { name: "上一頁" }).click();
    await expect(page.getByText(/^第 1／/)).toBeVisible();
  });

  test("單欄流程：開啟題目後可返回清單", async ({ page }) => {
    await signIn(page, "reviewer");
    const queueSize = await openServabilityQueue(page);
    test.skip(queueSize === 0, EMPTY_QUEUE);

    await page.locator(`${ITEM_LIST} button`).first().click();
    await expect(page.getByRole("button", { name: "← 返回題目清單" })).toBeVisible();
    await expect(page.locator(ITEM_LIST)).toHaveCount(0);

    await page.getByRole("button", { name: "← 返回題目清單" }).click();
    await expect(page.locator(ITEM_LIST)).toBeVisible();
  });
});

test.describe("不可作答題目：三個決定", () => {
  test("未選擇決定前不會出現提交按鈕，亦沒有任何預設核准", async ({ page }) => {
    await signIn(page, "reviewer");
    const queueSize = await openServabilityQueue(page);
    test.skip(queueSize === 0, EMPTY_QUEUE);
    await page.locator(`${ITEM_LIST} button`).first().click();

    await expect(page.getByRole("group", { name: "你的決定" })).toBeVisible();
    await expect(page.getByRole("button", { name: SUBMIT })).toHaveCount(0);
    for (const label of ["要再查證", "先收起這題", "已修好，可以派"]) {
      await expect(page.getByRole("button", { name: new RegExp(`^${label}`) })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }
  });

  test("未選理由時拒絕提交，錯誤會取得焦點且不顯示成功訊息", async ({ page }) => {
    await signIn(page, "reviewer");
    const queueSize = await openServabilityQueue(page);
    test.skip(queueSize === 0, EMPTY_QUEUE);
    await page.locator(`${ITEM_LIST} button`).first().click();

    await page.getByRole("button", { name: /^先收起這題/ }).click();
    await page.getByRole("button", { name: SUBMIT }).click();

    const alert = page.locator("#servability-form-error");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("請至少選一句理由");
    await expect(alert).toBeFocused();
    await expect(page.getByText(/已記錄你的決定/)).toHaveCount(0);
  });

  test("快速選項可以直接作為理由（不需要打字）", async ({ page }) => {
    await signIn(page, "reviewer");
    const queueSize = await openServabilityQueue(page);
    test.skip(queueSize === 0, EMPTY_QUEUE);
    await page.locator(`${ITEM_LIST} button`).first().click();

    await page.getByRole("button", { name: /^先收起這題/ }).click();
    await page.getByRole("button", { name: CHIP_NO_EVIDENCE }).click();
    await expect(page.getByText(/你會提交的決定/)).toContainText(CHIP_NO_EVIDENCE);

    // 只驗證前端接納，不真正寫入資料庫：攔截請求後回 200。
    await page.route("**/api/teacher/questions/*/servability", async (route: Route) => {
      expect(route.request().postDataJSON()).toMatchObject({ decision: "return_to_draft" });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.getByRole("button", { name: SUBMIT }).click();
    await expect(page.getByText(/已記錄你的決定/)).toBeVisible();
  });

  test("409 版本衝突要求重新載入且不顯示成功訊息", async ({ page }) => {
    await signIn(page, "reviewer");
    const queueSize = await openServabilityQueue(page);
    test.skip(queueSize === 0, EMPTY_QUEUE);
    await page.locator(`${ITEM_LIST} button`).first().click();

    await page.route("**/api/teacher/questions/*/servability", async (route: Route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "題目版本已由其他人更新", details: [] }),
      });
    });

    await page.getByRole("button", { name: /^先收起這題/ }).click();
    await page.getByRole("button", { name: CHIP_NO_EVIDENCE }).click();
    await page.getByRole("button", { name: SUBMIT }).click();

    const alert = page.locator("#servability-form-error");
    await expect(alert).toContainText("再確認一次");
    await expect(alert).toBeFocused();
    await expect(page.getByText(/已記錄你的決定/)).toHaveCount(0);
  });

  test("429 顯示可理解的錯誤並可重試", async ({ page }) => {
    await signIn(page, "reviewer");
    const queueSize = await openServabilityQueue(page);
    test.skip(queueSize === 0, EMPTY_QUEUE);
    await page.locator(`${ITEM_LIST} button`).first().click();

    await page.route("**/api/teacher/questions/*/servability", async (route: Route) => {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: "too many", details: [] }),
      });
    });

    await page.getByRole("button", { name: /^先收起這題/ }).click();
    await page.getByRole("button", { name: CHIP_NO_EVIDENCE }).click();
    await page.getByRole("button", { name: SUBMIT }).click();

    await expect(page.locator("#servability-form-error")).toContainText("操作太頻繁");
    await expect(page.getByRole("button", { name: SUBMIT })).toBeEnabled();
  });
});

test.describe("評分示例題表單", () => {
  test("沒有預選決定，用作示例需要完整評估欄位", async ({ page }) => {
    await signIn(page, "reviewer");
    const api = await apiContext("reviewer");
    const queue = await api.get("/api/teacher/review-queue?queue=golden&page=1&pageSize=10");
    const payload = (await queue.json()) as { available: boolean; total: number };
    await api.dispose();
    test.skip(
      !payload.available || payload.total === 0,
      "此環境沒有可用的評分示例候選，無法驗證表單欄位驗證。",
    );

    await page.goto("/teacher/review");
    await page.getByRole("tab", { name: QUEUE_TABS.golden }).click();

    const firstItem = page.locator(`${ITEM_LIST} button`).first();
    await expect(firstItem).toBeVisible();
    await firstItem.click();

    await expect(page.getByRole("button", { name: SUBMIT })).toHaveCount(0);

    await page.getByRole("button", { name: /^可以用作示例/ }).click();
    await page.getByRole("button", { name: CHIP_NO_EVIDENCE }).click();
    await page.getByRole("button", { name: SUBMIT }).click();
    await expect(page.locator("#golden-form-error")).toContainText("評估類別");
    await expect(page.locator("#golden-form-error")).toBeFocused();
  });
});

test.describe("授權邊界", () => {
  test("未登入者不能讀取清單", async ({ page }) => {
    const api = await apiContext();
    const response = await api.get("/api/teacher/review-queue?queue=servability");
    expect(response.status()).toBe(401);
    await api.dispose();

    await page.goto("/teacher/review");
    await expect(page.locator(ITEM_LIST)).toHaveCount(0);
  });

  test("學生不能讀取清單", async ({ page }) => {
    const api = await apiContext("student");
    const response = await api.get("/api/teacher/review-queue?queue=servability");
    expect(response.status()).toBe(403);
    await api.dispose();

    await signIn(page, "student");
    await page.goto("/teacher/review");
    await expect(page.locator(ITEM_LIST)).toHaveCount(0);
  });

  test("管理員不是歷史科審核者，不能提交評分示例核准", async ({ page }) => {
    const api = await apiContext("admin");
    const queue = await api.get("/api/teacher/review-queue?queue=golden");
    expect(queue.status()).toBe(200);
    const payload = (await queue.json()) as { items: { id: string; revision?: number }[] };
    test.skip(payload.items.length === 0, "此環境沒有評分示例候選。");

    const response = await api.post(`/api/teacher/golden/${payload.items[0].id}`, {
      data: {
        decision: "rejected",
        reason: "管理員不具歷史科審核授權。",
        expectedRevision: payload.items[0].revision ?? 1,
      },
    });
    expect(response.status()).toBe(403);
    await api.dispose();
    await page.goto("/");
  });

  test("授權審核者可讀取清單", async ({ page }) => {
    const api = await apiContext("reviewer");
    const response = await api.get("/api/teacher/review-queue?queue=servability");
    expect(response.status()).toBe(200);
    await api.dispose();
    await signIn(page, "reviewer");
    await openServabilityQueue(page);
  });
});

test.describe("錯誤與復原", () => {
  test("清單載入失敗顯示錯誤並可重試", async ({ page }) => {
    await signIn(page, "reviewer");
    let failNext = true;
    await page.route("**/api/teacher/review-queue?*", async (route: Route) => {
      if (failNext) {
        failNext = false;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "伺服器暫時無法回應", details: [] }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/teacher/review");
    const errorRegion = page.getByRole("alert").first();
    await expect(errorRegion).toContainText("伺服器暫時無法回應");

    await page.getByRole("button", { name: "重試" }).click();
    await expect(page.getByRole("button", { name: "重試" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: QUEUE_TABS.servability })).toBeVisible();
  });

  test("未提交的內容在切換清單前會要求確認", async ({ page }) => {
    await signIn(page, "reviewer");
    const queueSize = await openServabilityQueue(page);
    test.skip(queueSize === 0, EMPTY_QUEUE);
    await page.locator(`${ITEM_LIST} button`).first().click();
    await page.getByRole("button", { name: /^先收起這題/ }).click();
    await page.locator("#review-reason-extra").fill("尚未提交的理由，不應默默消失。");

    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });

    await page.getByRole("tab", { name: QUEUE_TABS.provenance }).click();
    await expect
      .poll(() => dialogs.length, { message: "應先詢問是否放棄未提交的內容" })
      .toBeGreaterThan(0);
    await expect(page.getByRole("tab", { name: QUEUE_TABS.servability })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("#review-reason-extra")).toHaveValue(
      "尚未提交的理由，不應默默消失。",
    );

    page.removeAllListeners("dialog");
    page.on("dialog", (dialog) => void dialog.accept());
    await page.getByRole("tab", { name: QUEUE_TABS.provenance }).click();
    await expect(page.getByRole("tab", { name: QUEUE_TABS.provenance })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
