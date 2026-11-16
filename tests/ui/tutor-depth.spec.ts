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

test("新對話提供可修改的歷史事件分析起步問題", async ({ page }) => {
  const cookies = readTestCookies();
  await page.context().addCookies([
    { name: SESSION_COOKIE, value: cookies.tutorStudent, url: UI_TEST_BASE_URL },
  ]);
  await page.route("**/api/tutor/chat**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sessionId: "ui-tutor-empty-session",
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
  });

  await page.goto("/tutor");
  await page.getByRole("button", { name: "分析：第一次世界大戰" }).click();

  await expect(page.getByPlaceholder(/可用口語、錯字或簡體字提問/)).toHaveValue(
    "請按教材分析第一次世界大戰的背景、起因、經過及結果，並指出一個可供深入評價的角度。",
  );
  await expect(page.getByRole("button", { name: "傳送問題" })).toBeEnabled();
});

test("學伴回覆顯示核心知識卡，並可提交自我檢查答案取得回饋", async ({ page }) => {
  const cookies = readTestCookies();
  await page.context().addCookies([
    { name: SESSION_COOKIE, value: cookies.tutorStudent, url: UI_TEST_BASE_URL },
  ]);

  const submitted: string[] = [];
  let answerTurn = 0;
  await page.route("**/api/tutor/chat**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          sessionId: null,
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

    const body = request.postDataJSON() as { message?: string };
    submitted.push(body.message ?? "");
    answerTurn += 1;
    const text =
      answerTurn === 1
        ? [
            "【核心知識】",
            "冷戰是美蘇兩大陣營長期對抗，但沒有直接爆發全面戰爭。",
            "",
            "教材線索：兩極格局和意識形態對立。",
            "",
            "【自我檢查題】",
            "冷戰為何被稱為「冷」戰？",
            "",
          ].join("\n")
        : "你已指出兩大陣營沒有直接開戰；可再補充對抗仍透過哪些方式進行。";
    const remaining = answerTurn === 1 ? 14 : 13;

    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "x-tutor-session-id": "ui-tutor-session",
        "x-tutor-remaining": String(remaining),
      },
      body: [
        `event: meta\ndata: ${JSON.stringify({
          grounding: "grounded",
          topicTitle: "課題10：冷戰",
          sources: [],
          depth: "standard",
        })}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ text })}\n\n`,
        `event: done\ndata: ${JSON.stringify({
          remaining,
          grounding: "grounded",
          topicTitle: "課題10：冷戰",
          sources: [],
          termNotes: [],
          depth: "standard",
        })}\n\n`,
      ].join(""),
    });
  });

  await page.goto("/tutor");
  await page.getByPlaceholder(/可用口語、錯字或簡體字提問/).fill("冷戰是甚麼？");
  await page.getByRole("button", { name: "傳送問題" }).click();

  await expect(page.getByLabel("核心知識")).toContainText(
    "冷戰是美蘇兩大陣營長期對抗",
  );
  const selfCheck = page.getByRole("form", { name: "自我檢查作答" });
  await expect(selfCheck).toContainText("冷戰為何被稱為「冷」戰？");
  await selfCheck.getByLabel("你的答案").fill("因為美蘇沒有直接爆發全面戰爭。");
  await selfCheck.getByRole("button", { name: "提交答案，請學伴回饋" }).click();

  await expect(
    page.getByText("你已指出兩大陣營沒有直接開戰", { exact: false }),
  ).toBeVisible();
  expect(submitted).toHaveLength(2);
  expect(submitted[1]).toContain("【自我檢查作答】");
  expect(submitted[1]).toContain("冷戰為何被稱為「冷」戰？");
  expect(submitted[1]).toContain("因為美蘇沒有直接爆發全面戰爭。");
});
