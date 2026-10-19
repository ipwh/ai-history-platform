import { expect, request, test, type Page, type Route } from "@playwright/test";

import { UI_TEST_BASE_URL, UI_TEST_IDENTITIES, readTestCookies } from "./test-env";

/**
 * `/teacher/review` 的瀏覽器層測試（Sprint 18）。
 *
 * 這些測試使用真實的 Next 伺服器、真實的 route handler 及真實授權檢查；
 * 只有外部資料來源（例如模擬 409／429）以 route interception 製造，
 * 不會繞過伺服器端的版本、指紋或學科授權驗證。
 */
const cookies = readTestCookies();

const SESSION_COOKIE = "hk-history-session";

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
 * 開啟不可作答佇列，並回傳伺服器實際提供的項目數。
 *
 * 佇列可能為空（所有題目已修復），此時頁面必須顯示明確的空狀態，
 * 而不是顯示推算數字；回傳 0 讓需要項目的測試以 skip 表示未驗證。
 */
async function openServabilityQueue(page: Page): Promise<number> {
  await page.goto("/teacher/review");
  await expect(page.getByRole("heading", { name: "教師審核工作台" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "不可作答題目（待裁決）" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const items = page.locator('ol[aria-label="佇列項目"] button');
  await expect
    .poll(
      async () =>
        (await items.count()) > 0 ||
        (await page.getByText(/目前沒有項目|稽核報告尚未產生/).count()) > 0,
      { timeout: 15_000, message: "等待佇列載入完成" },
    )
    .toBe(true);
  return items.count();
}

const EMPTY_QUEUE = "此環境的不可作答佇列為空（題目均已修復），無法驗證表單行為。";

test.describe("佇列與分頁", () => {
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
      await expect(page.getByText(/稽核報告尚未產生/)).toBeVisible();
      return;
    }

    // 顯示的數量必須等於伺服器回報的總數，而非前端自行推算。
    await expect(page.getByText(`共 ${payload.total} 項`)).toBeVisible();
    const itemLabels = await page.locator('ol[aria-label="佇列項目"] button strong').allInnerTexts();
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
      "此環境的佇列不足一頁，無法驗證分頁。",
    );

    await page.getByRole("button", { name: "下一頁" }).click();
    await expect(page.getByText(/^第 2／/)).toBeVisible();
    const pageTwoIds = await page.locator('ol[aria-label="佇列項目"] button strong').allInnerTexts();
    expect(pageTwoIds).toEqual(secondPayload.items.map((item) => item.id));

    await page.getByRole("button", { name: "上一頁" }).click();
    await expect(page.getByText(/^第 1／/)).toBeVisible();
  });
});

test.describe("不可作答題目裁決表單", () => {
  test("沒有預選核准，驗證錯誤會與欄位關聯並取得焦點", async ({ page }) => {
    await signIn(page, "reviewer");
    const queueSize = await openServabilityQueue(page);
    test.skip(queueSize === 0, EMPTY_QUEUE);
    await page.locator('ol[aria-label="佇列項目"] button').first().click();

    const decision = page.locator("#servability-decision");
    await expect(decision).toHaveValue("");

    await page.getByRole("button", { name: "提交裁決" }).click();

    const alert = page.locator("#servability-form-error");
    await expect(alert).toBeVisible();
    await expect(alert).toHaveAttribute("role", "alert");
    await expect(alert).toBeFocused();
    await expect(decision).toHaveAttribute("aria-invalid", "true");
    await expect(decision).toHaveAttribute("aria-describedby", "servability-form-error");
    await expect(page.getByText(/已記錄裁決/)).toHaveCount(0);
  });

  test("缺少勾選確認時拒絕提交", async ({ page }) => {
    await signIn(page, "reviewer");
    const queueSize = await openServabilityQueue(page);
    test.skip(queueSize === 0, EMPTY_QUEUE);
    await page.locator('ol[aria-label="佇列項目"] button').first().click();

    await page.locator("#servability-decision").selectOption("keep_quarantined");
    await page.locator("#servability-reason").fill("原卷缺失，保留隔離等待補充證據。");
    await page.getByRole("button", { name: "提交裁決" }).click();

    await expect(page.locator("#servability-form-error")).toContainText("請先確認");
  });

  test("409 版本衝突要求重新載入且不顯示成功訊息", async ({ page }) => {
    await signIn(page, "reviewer");
    const queueSize = await openServabilityQueue(page);
    test.skip(queueSize === 0, EMPTY_QUEUE);
    await page.locator('ol[aria-label="佇列項目"] button').first().click();

    await page.route("**/api/teacher/questions/*/servability", async (route: Route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "題目版本已由其他人更新", details: [] }),
      });
    });

    await page.locator("#servability-decision").selectOption("keep_quarantined");
    await page.locator("#servability-reason").fill("保留隔離，等待原卷證據。");
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "提交裁決" }).click();

    await expect(page.locator("#servability-form-error")).toContainText("請重新載入");
    await expect(page.locator("#servability-form-error")).toBeFocused();
    await expect(page.getByText(/已記錄裁決/)).toHaveCount(0);
  });

  test("429 顯示可理解的錯誤並可重試", async ({ page }) => {
    await signIn(page, "reviewer");
    const queueSize = await openServabilityQueue(page);
    test.skip(queueSize === 0, EMPTY_QUEUE);
    await page.locator('ol[aria-label="佇列項目"] button').first().click();

    await page.route("**/api/teacher/questions/*/servability", async (route: Route) => {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: "too many", details: [] }),
      });
    });

    await page.locator("#servability-decision").selectOption("keep_quarantined");
    await page.locator("#servability-reason").fill("保留隔離，等待原卷證據。");
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "提交裁決" }).click();

    await expect(page.locator("#servability-form-error")).toContainText("操作太頻繁");
    await expect(page.getByRole("button", { name: "提交裁決" })).toBeEnabled();
  });
});

test.describe("Golden 裁決表單", () => {
  test("沒有預選核准，核准需要完整評估欄位", async ({ page }) => {
    await signIn(page, "reviewer");
    const api = await apiContext("reviewer");
    const queue = await api.get("/api/teacher/review-queue?queue=golden&page=1&pageSize=10");
    const payload = (await queue.json()) as { available: boolean; total: number };
    await api.dispose();
    test.skip(
      !payload.available || payload.total === 0,
      "此環境沒有可用的 Golden 候選，無法驗證表單欄位驗證。",
    );

    await page.goto("/teacher/review");
    await page.getByRole("tab", { name: "Golden 候選（待教師核准）" }).click();

    const firstItem = page.locator('ol[aria-label="佇列項目"] button').first();
    await expect(firstItem).toBeVisible();
    await firstItem.click();

    const decision = page.locator("#golden-decision");
    await expect(decision).toHaveValue("");

    await page.getByRole("button", { name: "提交 Golden 裁決" }).click();
    await expect(page.locator("#golden-form-error")).toContainText("請選擇一個決定");
    await expect(page.locator("#golden-form-error")).toBeFocused();

    await decision.selectOption("approved");
    await page.locator("#golden-reason").fill("已核對原卷及評分方式。");
    await page.getByRole("button", { name: "提交 Golden 裁決" }).click();
    await expect(page.locator("#golden-form-error")).toContainText("評估類別");
    await expect(page.locator("#golden-decision")).toHaveAttribute("aria-invalid", "true");
  });
});

test.describe("授權邊界", () => {
  test("未登入者不能讀取佇列", async ({ page }) => {
    const api = await apiContext();
    const response = await api.get("/api/teacher/review-queue?queue=servability");
    expect(response.status()).toBe(401);
    await api.dispose();

    await page.goto("/teacher/review");
    await expect(page.locator('ol[aria-label="佇列項目"]')).toHaveCount(0);
  });

  test("學生不能讀取佇列", async ({ page }) => {
    const api = await apiContext("student");
    const response = await api.get("/api/teacher/review-queue?queue=servability");
    expect(response.status()).toBe(403);
    await api.dispose();

    await signIn(page, "student");
    await page.goto("/teacher/review");
    await expect(page.locator('ol[aria-label="佇列項目"]')).toHaveCount(0);
  });

  test("管理員不是歷史科審核者，不能提交 Golden 核准", async ({ page }) => {
    const api = await apiContext("admin");
    const queue = await api.get("/api/teacher/review-queue?queue=golden");
    expect(queue.status()).toBe(200);
    const payload = (await queue.json()) as { items: { id: string; revision?: number }[] };
    test.skip(payload.items.length === 0, "此環境沒有 Golden 候選。");

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

  test("授權審核者可讀取佇列", async ({ page }) => {
    const api = await apiContext("reviewer");
    const response = await api.get("/api/teacher/review-queue?queue=servability");
    expect(response.status()).toBe(200);
    await api.dispose();
    await signIn(page, "reviewer");
    await openServabilityQueue(page);
  });
});

test.describe("錯誤與復原", () => {
  test("佇列載入失敗顯示錯誤並可重試", async ({ page }) => {
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
    await expect(page.getByRole("tab", { name: "不可作答題目（待裁決）" })).toBeVisible();
  });

  test("未提交的理由在切換佇列前會要求確認", async ({ page }) => {
    await signIn(page, "reviewer");
    const queueSize = await openServabilityQueue(page);
    test.skip(queueSize === 0, EMPTY_QUEUE);
    await page.locator('ol[aria-label="佇列項目"] button').first().click();
    await page.locator("#servability-reason").fill("尚未提交的理由，不應默默消失。");

    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });

    await page.getByRole("tab", { name: "修復 provenance 風險（排序）" }).click();
    await expect
      .poll(() => dialogs.length, { message: "應先詢問是否放棄未提交的內容" })
      .toBeGreaterThan(0);
    await expect(page.getByRole("tab", { name: "不可作答題目（待裁決）" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("#servability-reason")).toHaveValue("尚未提交的理由，不應默默消失。");

    page.removeAllListeners("dialog");
    page.on("dialog", (dialog) => void dialog.accept());
    await page.getByRole("tab", { name: "修復 provenance 風險（排序）" }).click();
    await expect(page.getByRole("tab", { name: "修復 provenance 風險（排序）" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
