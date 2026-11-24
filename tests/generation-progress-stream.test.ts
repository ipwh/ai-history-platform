/**
 * 生成進度的串流契約（2026-11-24）。
 *
 * 補題會令生成時間變長；介面需要看到「第幾輪、已取得幾題」才不會以為平台失敗而
 * 重新整理頁面。`POST /api/teacher/questions/generate` 因此支援
 * `Accept: text/event-stream`：先推送多個 `progress` 事件，最後推送 `done`（完整結果）
 * 或 `error`。沒有要求串流的呼叫仍然收到同一個 JSON 回應。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { freshTestDatabasePath } from "./test-database";
import { importTestPilotMaterial } from "./fixtures/pilot-material";

const testDbPath = freshTestDatabasePath("generation-progress-stream");
process.env.APP_DATABASE_PATH = testDbPath;
process.env.LLM_PROVIDER = "openai-compatible";
process.env.LLM_API_KEY = "test-key-not-a-secret";
process.env.LLM_BASE_URL = "https://llm.test.invalid";
process.env.LLM_MODEL = "test-model";
delete process.env.K_SERVICE;

type MaterialUnits = typeof import("@/server/services/material-units");
type TopicsRepo = typeof import("@/server/repositories/topics");
type Seed = typeof import("@/server/seed");

let materialUnits: MaterialUnits;
let topicsRepo: TopicsRepo;
let seed: Seed;

const TOPIC = "topic-5";
const VARIANT_LABELS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];

interface Excerpt {
  text: string;
  blockId: string;
}

let sectionId: string;
let pool: Excerpt[];

function padOption(label: string, targetLength: number): string {
  const filler = "，與本題資料不符";
  let text = label;
  while (text.length < targetLength) text += filler;
  return text;
}

function buildQuestion(item: Excerpt): unknown {
  const variant = Math.max(0, pool.findIndex((candidate) => candidate.text === item.text));
  const others = pool.filter((candidate) => candidate.text !== item.text).slice(0, 3);
  return {
    questionType: "mc",
    difficulty: "basic",
    question: `以下哪一項最符合本段資料的說明（${VARIANT_LABELS[variant % VARIANT_LABELS.length]}）？`,
    options: [item.text, ...others.map((other) => padOption(other.text, item.text.length))],
    correctAnswerIndex: 0,
    correctAnswer: item.text,
    explanation: `資料在這裡說明「${item.text}」，因此這個選項與資料一致，其餘選項所述內容與資料不符。`,
    knowledgePoint: "課題內容理解",
    sourceExcerpt: item.text,
    sourceBlockIds: [item.blockId],
    gradingPoints: [],
  };
}

/** provider 每次只交回 2 題（模擬模型少於要求的題數，令補題必然發生） */
function shortProviderStub(cursor: { value: number }): typeof fetch {
  return (async () => {
    const batch = pool.slice(cursor.value, cursor.value + 2);
    cursor.value += batch.length;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ questions: batch.map(buildQuestion) }) } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

function parseSseEvents(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of text.split("\n\n")) {
    let event = "";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (event.length === 0 || dataLines.length === 0) continue;
    events.push({ event, data: JSON.parse(dataLines.join("\n")) as Record<string, unknown> });
  }
  return events;
}

beforeAll(async () => {
  materialUnits = await import("@/server/services/material-units");
  topicsRepo = await import("@/server/repositories/topics");
  seed = await import("@/server/seed");

  seed.ensureBootstrap();
  await importTestPilotMaterial();

  let best: { id: string; units: ReturnType<MaterialUnits["buildMaterialUnits"]> } | null = null;
  for (const candidate of topicsRepo.listSections(TOPIC).map((section) => section.id)) {
    const units = materialUnits.buildMaterialUnits(
      TOPIC,
      topicsRepo.expandSectionIds(TOPIC, [candidate]),
    );
    if (units.length > 0 && (best === null || units.length > best.units.length)) {
      best = { id: candidate, units };
    }
  }
  if (best === null) throw new Error("課題5 找不到有教材的測試分節");
  sectionId = best.id;

  const seen = new Set<string>();
  pool = [];
  for (const unit of best.units) {
    for (const part of unit.text.split(/[。；\n]/)) {
      const text = part.trim();
      if (text.length < 10 || text.length > 60) continue;
      if (text.includes("＿") || seen.has(text)) continue;
      seen.add(text);
      pool.push({ text, blockId: unit.blockId });
    }
  }
  if (pool.length < 8) {
    throw new Error(`測試教材只有 ${pool.length} 條可用節錄，不足以驗證進度串流`);
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("生成進度串流", () => {
  it("要求 text/event-stream 時會先推送進度，最後才推送完整結果", async () => {
    const cursor = { value: 0 };
    vi.stubGlobal("fetch", shortProviderStub(cursor));

    const { POST } = await import("@/app/api/teacher/questions/generate/route");
    const response = await POST(
      new Request("http://localhost:3000/api/teacher/questions/generate", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({
          topicId: TOPIC,
          sectionIds: [sectionId],
          questionTypes: ["mc"],
          difficulty: "basic",
          questionCount: 5,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") ?? "").toContain("text/event-stream");

    const events = parseSseEvents(await response.text());
    const progress = events.filter((entry) => entry.event === "progress");
    expect(progress.length).toBeGreaterThan(0);
    // 進度事件一定要有可直接顯示的中文說明及輪次
    expect(progress.every((entry) => typeof entry.data.message === "string")).toBe(true);
    // 補題階段必須出現：這正是等待時間變長的原因
    expect(progress.some((entry) => entry.data.stage === "topping-up")).toBe(true);

    const done = events.at(-1);
    expect(done?.event).toBe("done");
    expect(done?.data.requestedCount).toBe(5);
    expect(done?.data.shortfall).toBe(0);
    expect((done?.data.questions as unknown[]).length).toBe(5);
  });
});
