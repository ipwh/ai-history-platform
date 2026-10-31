import { expect, test } from "@playwright/test";

import { UI_TEST_BASE_URL, readTestCookies } from "./test-env";

const SESSION_COOKIE = "hk-history-session";
const RAW_QUESTION = "嗰個條約呢";
const CANDIDATES = [
  {
    id: "versailles",
    label: "凡爾賽條約與戰後安排",
    suggestedQuestion: "凡爾賽條約如何影響德國及戰後歐洲？",
  },
  {
    id: "ww1",
    label: "第一次世界大戰",
    suggestedQuestion: "第一次世界大戰的起因如何影響戰後局勢？",
  },
] as const;
const ANSWER = "可以先從條約對德國的限制和賠款兩方面思考。";

test("已核對學生點選歷史澄清候選後進入 mock 回答串流", async ({ page }) => {
  const cookies = readTestCookies();
  await page.context().addCookies([
    { name: SESSION_COOKIE, value: cookies.tutorStudent, url: UI_TEST_BASE_URL },
  ]);

  const submittedQuestions: string[] = [];
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
        }),
      });
      return;
    }

    const body = request.postDataJSON() as { message?: string };
    const message = body.message ?? "";
    submittedQuestions.push(message);
    if (message === RAW_QUESTION) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          clarify: true,
          reply: "我未能確定你想問哪一件歷史事或哪個方向。請選擇以下一個問題，或自行改寫後再問：",
          candidates: CANDIDATES,
          sessionId: null,
          remaining: 15,
          dailyLimit: 15,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "x-tutor-session-id": "ui-tutor-session",
        "x-tutor-remaining": "15",
      },
      body: [
        `event: meta\ndata: ${JSON.stringify({ grounding: "not-covered", sources: [] })}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ text: ANSWER })}\n\n`,
        `event: done\ndata: ${JSON.stringify({
          remaining: 14,
          grounding: "not-covered",
          sources: [],
          termNotes: [],
        })}\n\n`,
      ].join(""),
    });
  });

  await page.goto("/tutor");
  await expect(page.getByRole("heading", { name: /歷史科自學學伴/ })).toBeVisible();
  const quota = page.getByText(/今日剩餘提問次數：/);
  await expect(quota).toContainText("15 / 15");

  await page.getByPlaceholder(/可用口語、錯字或簡體字提問/).fill(RAW_QUESTION);
  await page.getByRole("button", { name: "傳送問題" }).click();

  const clarification = page.getByLabel("可選的歷史提問");
  const candidateButtons = clarification.getByRole("button");
  await expect(candidateButtons).toHaveCount(2);
  await expect(quota).toContainText("15 / 15");
  await candidateButtons.first().click();

  await expect(page.getByText(ANSWER, { exact: true })).toBeVisible();
  await expect(quota).toContainText("14 / 15");
  expect(submittedQuestions).toEqual([RAW_QUESTION, CANDIDATES[0].suggestedQuestion]);
});
