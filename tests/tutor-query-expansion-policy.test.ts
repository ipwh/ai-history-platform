/**
 * 學伴「語意改寫」的政策測試（Sprint 34）。
 *
 * ── 與 `tutor-query-expansion-route.test.ts` 的分工 ──────────────────
 * 那一份驗證「接線是否正常」（失敗→改寫→重試、失敗即降級、命中即不改寫）。
 * 這一份驗證**政策邊界**：哪些情況根本不應該發出改寫請求（D／out-of-scope／
 * 已命中／上文已足夠），以及改寫請求本身帶了甚麼資料（私隱）、會不會多扣額度、
 * 改寫出來的詞會不會令無關段落變成「教材依據」。
 *
 * 全部使用假模型（`vi.stubGlobal("fetch", ...)`），不會連上真實供應商。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE, encodeSession } from "@/server/auth/session";
import { ensureLearner } from "@/server/repositories/learners";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("tutor-expansion-policy");
process.env.AUTH_SECRET = "tutor-expansion-policy-secret-0123456789";
process.env.AUTH_REQUIRE_SIGN_IN = "true";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_STAFF_ACCESS_POLICY = "allowlist";
delete process.env.AUTH_STAFF_DOMAINS;
process.env.LLM_PROVIDER = "deepseek";
process.env.DEEPSEEK_API_KEY = "test-only-key";
process.env.AI_LIMITS_ENABLED = "true";
process.env.AI_LIMIT_WINDOW_MINUTES = "60";
process.env.AI_GENERATIONS_PER_LEARNER = "100";
process.env.AI_GENERATIONS_GLOBAL = "100";
process.env.BACKUP_ENABLED = "false";
process.env.TUTOR_QUERY_EXPANSION_ENABLED = "true";

const STUDENT = "school:s2024502@pochiu.edu.hk";
const STUDENT_EMAIL = "s2024502@pochiu.edu.hk";

let postChat: typeof import("@/app/api/tutor/chat/route").POST;
let getDb: typeof import("@/server/db/connection").getDb;
let expansion: typeof import("@/server/services/tutor-query-expansion");

function requestFor(body: unknown): Request {
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(
    encodeSession({
      email: STUDENT_EMAIL,
      name: "測試學生",
      role: "student",
      learnerId: STUDENT,
      rosterVerified: true,
      className: "1A",
      studentNumber: "s2024502",
    }),
  )}`;
  return new Request("http://localhost/api/tutor/chat", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface FetchBody {
  stream?: boolean;
  response_format?: { type?: string };
  messages?: { role: string; content: string }[];
}

function streamingAnswer(answer: string): Response {
  const events = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
  return new Response(events, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** 假模型：JSON 模式（語意改寫）回傳指定詞語，其餘回傳串流回答 */
function mockLlm(terms: string[]): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as FetchBody;
    if (body.response_format !== undefined) {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ terms }) } }],
          usage: { prompt_tokens: 80, completion_tokens: 12 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return streamingAnswer("這是示範回答，請以課本及老師的標準為準。");
  });
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, index: number): FetchBody {
  const call = fetchMock.mock.calls[index];
  return JSON.parse(String((call?.[1] as { body?: string } | undefined)?.body ?? "{}")) as FetchBody;
}

async function ask(body: Record<string, unknown>): Promise<{ text: string; events: string[] }> {
  const response = await postChat(requestFor(body));
  const text = await response.text();
  const events = [...text.matchAll(/^event: (\w+)$/gm)].map((match) => match[1] ?? "");
  return { text, events };
}

beforeAll(async () => {
  ({ POST: postChat } = await import("@/app/api/tutor/chat/route"));
  getDb = (await import("@/server/db/connection")).getDb;
  expansion = await import("@/server/services/tutor-query-expansion");
  ensureLearner(STUDENT);

  const db = getDb();
  const now = "2026-11-07T00:00:00.000+08:00";
  db.prepare(
    `INSERT INTO topics (id, title, description, published, sort_order, created_at, updated_at)
     VALUES ('topic-10', '課題10：20世紀的國際紛爭及危機(II)–冷戰及後冷戰時代', '', 1, 10, ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO material_documents
       (id, file_name, kind, status, created_at, student_distribution, rights_confirmed_at)
     VALUES ('doc-cw', '課題10 冷戰_筆記.docx', 'demo', 'ready', ?, 1, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO material_blocks
       (id, document_id, topic_id, section_id, sort_order, type, text, source_location, created_at, extraction_method)
     VALUES ('block-cw', 'doc-cw', 'topic-10', NULL, 0, 'paragraph', ?, ?, ?, 'native')`,
  ).run(
    "1985年戈巴卓夫成為蘇聯領導人，推行內政與外交改革，最終冷戰於1991年結束。",
    "課題10 冷戰_筆記.docx · 第 1 段（段落）",
    now,
  );
});

beforeEach(() => {
  vi.unstubAllGlobals();
  expansion.clearTutorQueryExpansionCache();
  process.env.DEEPSEEK_API_KEY = "test-only-key";
  process.env.TUTOR_QUERY_EXPANSION_ENABLED = "true";
  const db = getDb();
  db.prepare("DELETE FROM tutor_messages").run();
  db.prepare("DELETE FROM tutor_sessions").run();
  db.prepare("DELETE FROM ai_operations").run();
});

describe("語意改寫：不應觸發的情況", () => {
  it("含糊提問（無上文）只澄清，不呼叫任何模型", async () => {
    const fetchMock = mockLlm(["冷戰"]);
    vi.stubGlobal("fetch", fetchMock);
    const { text } = await ask({ message: "佢有咩影響？" });
    expect(fetchMock).not.toHaveBeenCalled();
    // D 狀態以澄清回應（不是 SSE 回答串流）
    expect(text).toContain('"clarify":true');
  });

  it("非歷史提問（體育賽果）不呼叫任何模型，亦不改寫", async () => {
    const fetchMock = mockLlm(["足球"]);
    vi.stubGlobal("fetch", fetchMock);
    const { text } = await ask({ message: "邊隊贏咗昨晚場波？" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(text).not.toContain("event: error");
  });

  it("教材已命中時不做改寫（零額外請求）", async () => {
    const fetchMock = mockLlm(["冷戰結束"]);
    vi.stubGlobal("fetch", fetchMock);
    await ask({ message: "冷戰幾時結束？" });
    // 只有一次（主回答）呼叫，沒有 JSON 模式的改寫請求
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock, 0).response_format).toBeUndefined();
  });
});

describe("語意改寫：會觸發的情況及邊界", () => {
  it("教材未涵蓋時改寫一次，並把詞語用於重試檢索", async () => {
    const fetchMock = mockLlm(["戈巴卓夫", "改革"]);
    vi.stubGlobal("fetch", fetchMock);
    await ask({ message: "蘇聯領導人推行嘅改革叫咩名？" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock, 0).response_format?.type).toBe("json_object");
  });

  it("簡體及粵語提問同樣可以觸發改寫（改寫詞會繁體化）", async () => {
    const fetchMock = mockLlm(["戈巴卓夫", "開放政策"]);
    vi.stubGlobal("fetch", fetchMock);
    await ask({ message: "苏联领导人的改革系咩？" });
    const expansionBody = bodyOf(fetchMock, 0);
    const userMessage = expansionBody.messages?.find((message) => message.role === "user");
    // 送給改寫模型的已是正規化（繁簡統一、粵語口語還原）的提問
    expect(userMessage?.content).toContain("蘇聯領導人的改革");
  });

  it("改寫請求只帶提問及課題標題，不含學生身分資料", async () => {
    const fetchMock = mockLlm(["戈巴卓夫"]);
    vi.stubGlobal("fetch", fetchMock);
    await ask({ message: "蘇聯領袖嘅改革叫咩名？" });
    const raw = JSON.stringify(bodyOf(fetchMock, 0));
    expect(raw).not.toContain(STUDENT_EMAIL);
    expect(raw).not.toContain("s2024502");
    expect(raw).not.toContain("1A");
  });

  it("改寫不會額外扣減每日額度（一次提問只記一次 AI 操作）", async () => {
    vi.stubGlobal("fetch", mockLlm(["戈巴卓夫"]));
    await ask({ message: "蘇聯領袖嘅改革叫咩名？" });
    const row = getDb()
      .prepare("SELECT COUNT(*) AS count FROM ai_operations WHERE learner_id = ?")
      .get(STUDENT) as { count: number } | undefined;
    expect(row?.count).toBe(1);
  });

  it("改寫出來的詞若教材真的沒有，仍維持「未找到教材依據」（不可憑空造依據）", async () => {
    // 假模型回傳的詞與教材完全無關
    const fetchMock = mockLlm(["文藝復興", "雕塑"]);
    vi.stubGlobal("fetch", fetchMock);
    const { text } = await ask({ message: "蘇聯領袖嘅改革叫咩名？" });
    expect(text).toContain('"grounding":"not-covered"');
  });

  it("改寫失敗（HTTP 500）時安靜降級，主回答仍然送出", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as FetchBody;
      if (body.response_format !== undefined) {
        return new Response("upstream error", { status: 500 });
      }
      return streamingAnswer("先想想改革的目的。");
    });
    vi.stubGlobal("fetch", fetchMock);
    const { text, events } = await ask({ message: "蘇聯領袖嘅改革叫咩名？" });
    expect(events).toContain("delta");
    expect(text).not.toContain("event: error");
  });
});
