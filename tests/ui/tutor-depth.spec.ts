import { expect, test } from "@playwright/test";

import { UI_TEST_BASE_URL, readTestCookies } from "./test-env";

/**
 * 回覆深度（2026-11-06）。
 *
 * 驗證三件介面行為：① 重新載入後仍顯示上一輪的深度標示（`replyDepth` 已存入資料庫）；
 * ② 學生選擇的深度會保存在瀏覽器，並隨請求以 `depth` 傳送；③ 回覆氣泡上方顯示對應標籤。
 */
const SESSION_COOKIE = "hk-history-session";
const QUESTION = "凡爾賽條約是否公平？";
const ANSWER = "（示範）先從軍事限制與賠款兩方面分析，再討論是否公平。";

test("學生選擇回覆深度後，請求會帶 depth 並在回覆上顯示標籤", async ({ page }) => {
  const cookies = readTestCookies();
  await page.context().addCookies([
    { name: SESSION_COOKIE, value: cookies.tutorStudent, url: UI_TEST_BASE_URL },
  ]);

  const submitted: Array<{ message?: string; depth?: string }> = [];
  await page.route("**/api/tutor/chat**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          sessionId: "ui-tutor-session",
          messages: [
            { role: "user", content: "美國革命與法國大革命有哪些關係？" },
            {
              role: "assistant",
              content: "（較早的進階回覆）",
              groundingStatus: "not-covered",
              replyDepth: "advanced",
            },
          ],
          remaining: 15,
          dailyLimit: 15,
          windowLimitReached: false,
          truncated: false,
          messageCount: 2,
          topicId: null,
          practiceContext: null,
        }),
      });
      return;
    }

    submitted.push(request.postDataJSON() as { message?: string; depth?: string });
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "x-tutor-session-id": "ui-tutor-session",
        "x-tutor-remaining": "15",
      },
      body: [
        `event: meta\ndata: ${JSON.stringify({
          grounding: "not-covered",
          sources: [],
          depth: "challenge",
        })}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ text: ANSWER })}\n\n`,
        `event: done\ndata: ${JSON.stringify({
          remaining: 14,
          grounding: "not-covered",
          sources: [],
          termNotes: [],
          depth: "challenge",
        })}\n\n`,
      ].join(""),
    });
  });

  await page.goto("/tutor");
  // 重新載入對話後仍顯示深度標示（不是只在前端即時顯示）
  await expect(
    page.locator("article").filter({ hasText: "（較早的進階回覆）" }).getByText("進階分析"),
  ).toBeVisible();

  const depthSelect = page.getByLabel("回覆深度");
  await expect(depthSelect).toHaveValue("auto");
  await depthSelect.selectOption("challenge");

  // 選擇保存在瀏覽器：重新載入後仍然生效
  await page.reload();
  await expect(page.getByLabel("回覆深度")).toHaveValue("challenge");

  await page.getByPlaceholder(/可用口語、錯字或簡體字提問/).fill(QUESTION);
  await page.getByRole("button", { name: "傳送問題" }).click();

  await expect(page.getByText(ANSWER, { exact: true })).toBeVisible();
  expect(submitted).toHaveLength(1);
  expect(submitted[0]).toMatchObject({ message: QUESTION, depth: "challenge" });
  await expect(
    page.locator("article").filter({ hasText: ANSWER }).getByText("挑戰・史觀"),
  ).toBeVisible();
});
