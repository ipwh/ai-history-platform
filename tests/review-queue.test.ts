/**
 * 教師審核工作台佇列 API（Sprint 16）。
 *
 * 契約：
 *   - 未登入 401、學生 403；教師／管理員可讀（唯讀佇列）。
 *   - 佇列分批（pageSize 上限 25），不一次送回全部資料。
 *   - 內容來自既有稽核報告：servability 97、provenance 623、golden 42。
 *   - 不存在的 queue 回 400；報告缺失時 available=false（不推測）。
 */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("review-queue");
process.env.LLM_PROVIDER = "mock";
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_TEACHER_EMAILS = "teacher@example.com";
process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
process.env.HISTORY_REVIEWER_EMAILS = "teacher@example.com";
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
delete process.env.ADMIN_TOKEN;
delete process.env.K_SERVICE;

type SessionModule = typeof import("@/server/auth/session");
type SeedModule = typeof import("@/server/seed");

let session: SessionModule;
let seed: SeedModule;

/** 佇列內容來自既有的裁決工作清單報告；測試以報告為準，不硬編題數。 */
function worklistReport(): {
  totals: { questions: number };
  byIssueCode?: Record<string, number>;
  items: { issueCode: string }[];
} {
  const file = path.resolve(process.cwd(), "docs/quality/adjudication-worklist-2026-10-19.json");
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as {
    totals: { questions: number };
    byIssueCode?: Record<string, number>;
    items: { issueCode: string }[];
  };
}

function worklistTotal(): number {
  return worklistReport().totals.questions;
}

function worklistCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of worklistReport().items) {
    counts[item.issueCode] = (counts[item.issueCode] ?? 0) + 1;
  }
  return counts;
}

const TEACHER = {
  email: "teacher@example.com",
  name: "歷史科教師",
  role: "teacher" as const,
  learnerId: "teacher:teacher@example.com",
  pictureUrl: null,
};
const ADMIN = {
  email: "admin@example.com",
  name: "管理員",
  role: "admin" as const,
  learnerId: "admin:admin@example.com",
  pictureUrl: null,
};
const STUDENT = {
  email: "s2024146@pochiu.edu.hk",
  name: "學生",
  role: "student" as const,
  learnerId: "school:s2024146@pochiu.edu.hk",
  pictureUrl: null,
};

function cookieFor(user: typeof TEACHER | typeof ADMIN | typeof STUDENT): string {
  return `hk-history-session=${encodeURIComponent(session.encodeSession(user))}`;
}

async function callQueue(query: string, cookie?: string): Promise<Response> {
  const { GET } = await import("@/app/api/teacher/review-queue/route");
  return GET(
    new Request(`http://localhost:3000/api/teacher/review-queue?${query}`, {
      headers: cookie ? { cookie } : {},
    }),
  );
}

interface QueueResponse {
  queue: string;
  available: boolean;
  total: number;
  page: number;
  pageSize: number;
  items: Array<{ id: string; status: string; summary: string }>;
  counts: Record<string, number>;
  limitation: string | null;
}

beforeAll(async () => {
  session = await import("@/server/auth/session");
  seed = await import("@/server/seed");
  seed.ensureBootstrap();
});

describe("審核佇列：權限", () => {
  it("未登入 401、學生 403", async () => {
    expect((await callQueue("queue=servability")).status).toBe(401);
    expect((await callQueue("queue=servability", cookieFor(STUDENT))).status).toBe(403);
  });

  it("教師與管理員可讀（唯讀佇列）", async () => {
    expect((await callQueue("queue=servability", cookieFor(TEACHER))).status).toBe(200);
    expect((await callQueue("queue=servability", cookieFor(ADMIN))).status).toBe(200);
  });

  it("不存在的 queue 回 400", async () => {
    expect((await callQueue("queue=unknown", cookieFor(TEACHER))).status).toBe(400);
  });
});

describe("審核佇列：內容與分批", () => {
  it("servability 佇列與裁決工作清單一致，第一頁最多 10 項", async () => {
    const response = await callQueue("queue=servability&page=1&pageSize=10", cookieFor(TEACHER));
    const body = (await response.json()) as QueueResponse;
    expect(body.available).toBe(true);
    expect(body.total).toBe(worklistTotal());
    expect(body.items.length).toBeLessThanOrEqual(10);
    const expected = worklistCounts();
    expect(body.counts.MCQ_ROMAN_LABEL_MISSING ?? 0).toBe(expected.MCQ_ROMAN_LABEL_MISSING ?? 0);
    expect(body.counts.FILL_ANSWER_LEAKS ?? 0).toBe(expected.FILL_ANSWER_LEAKS ?? 0);
  });

  it("分頁不會重複或漏掉項目（第 1、2 頁交集為空）", async () => {
    const first = (await (
      await callQueue("queue=servability&page=1&pageSize=10", cookieFor(TEACHER))
    ).json()) as QueueResponse;
    const second = (await (
      await callQueue("queue=servability&page=2&pageSize=10", cookieFor(TEACHER))
    ).json()) as QueueResponse;
    const firstIds = new Set(first.items.map((item) => item.id));
    expect(second.items.filter((item) => firstIds.has(item.id))).toHaveLength(0);
  });

  it("pageSize 超過上限會被拒絕（400），不會一次載入全部", async () => {
    expect((await callQueue("queue=servability&pageSize=100", cookieFor(TEACHER))).status).toBe(400);
  });

  it("provenance 佇列 623 題，P1 530、P3 93", async () => {
    const body = (await (
      await callQueue("queue=provenance&pageSize=25", cookieFor(TEACHER))
    ).json()) as QueueResponse;
    expect(body.available).toBe(true);
    expect(body.total).toBe(623);
    expect(body.counts.P1).toBe(530);
    expect(body.counts.P3).toBe(93);
    expect(body.limitation ?? "").toContain("P3");
  });

  it("golden 佇列 42 候選、全部 pending，沒有 approved", async () => {
    const body = (await (
      await callQueue("queue=golden&pageSize=25", cookieFor(TEACHER))
    ).json()) as QueueResponse;
    expect(body.available).toBe(true);
    expect(body.total).toBe(42);
    expect(body.counts["pending-review"]).toBe(42);
    expect(body.counts.approved ?? 0).toBe(0);
  });
});
