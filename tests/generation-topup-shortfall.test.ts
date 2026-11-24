/**
 * 生成「短欠」的補題契約（2026-11-24）。
 *
 * 背景：真實模型經常少於要求的題數（要求 5 題只交出 2–3 題）。舊流程只在「完全沒有
 * 題目」時才重試，短欠的題數就直接交給教師／學生，令教師要逐次再按「生成題目」補齊，
 * 而每一次都是全新的模型呼叫及等待。
 *
 * 現在的契約：
 *   1. 通過驗證的題目少於要求時，生成流程會以「還缺幾題」再向模型要一次（補題），
 *      並透過 `onProgress` 回報 `topping-up` 階段（介面用此顯示進度）。
 *   2. 補題有上限（最多 2 輪，整體最多 5 次模型呼叫）；教材真的不足時停止，
 *      如實回報 `shortfall` 而不是假裝成功。
 *
 * 測試以 stub 的 HTTP 回應取代 provider（與 tests/generation-empty-response.test.ts 同一手法）。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { freshTestDatabasePath } from "./test-database";
import { importTestPilotMaterial } from "./fixtures/pilot-material";

import type { GenerationProgress } from "@/lib/types";

const testDbPath = freshTestDatabasePath("generation-topup-shortfall");
process.env.APP_DATABASE_PATH = testDbPath;
process.env.LLM_PROVIDER = "openai-compatible";
process.env.LLM_API_KEY = "test-key-not-a-secret";
process.env.LLM_BASE_URL = "https://llm.test.invalid";
process.env.LLM_MODEL = "test-model";
delete process.env.K_SERVICE;

type QuestionService = typeof import("@/server/services/question-service");
type MaterialUnits = typeof import("@/server/services/material-units");
type TopicsRepo = typeof import("@/server/repositories/topics");
type Seed = typeof import("@/server/seed");

let questionService: QuestionService;
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

/** 把錯誤選項補長至與正確選項相若，避免觸發「正確選項唯一最長」的規則 */
function padOption(label: string, targetLength: number): string {
  const filler = "，與本題資料不符";
  let text = label;
  while (text.length < targetLength) text += filler;
  return text;
}

function buildQuestion(item: Excerpt, distractors: Excerpt[]): unknown {
  // 題幹按節錄在教材池中的次序編號，令不同史實的題目題幹互不相同（同一個節錄則相同，
  // 用來驗證補題不會重複計算同一條題目）
  const variant = Math.max(0, distractors.findIndex((candidate) => candidate.text === item.text));
  const others = distractors.filter((candidate) => candidate.text !== item.text).slice(0, 3);
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

/** provider 每次只交回少量題目（模擬「模型少於要求題數」） */
function shortProviderStub(state: {
  calls: number;
  batch: () => Excerpt[];
}): typeof fetch {
  return (async () => {
    state.calls += 1;
    const batch = state.batch();
    const questions = batch.map((item) => buildQuestion(item, pool));
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ questions }) } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

beforeAll(async () => {
  questionService = await import("@/server/services/question-service");
  materialUnits = await import("@/server/services/material-units");
  topicsRepo = await import("@/server/repositories/topics");
  seed = await import("@/server/seed");

  seed.ensureBootstrap();
  await importTestPilotMaterial();

  // 選教材最多的分節，令測試有足夠的句子可以出多條互不重複的題目
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
    throw new Error(`測試教材只有 ${pool.length} 條可用節錄，不足以驗證補題`);
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("生成短欠時的補題", () => {
  it("模型少於要求題數時會自動補題，最終取得要求題數並回報補題進度", async () => {
    let cursor = 0;
    const state = {
      calls: 0,
      batch: (): Excerpt[] => {
        // 每次最多交回 2 題，且不重複已交過的題目（模擬真實模型少於要求題數）
        const batch = pool.slice(cursor, cursor + 2);
        cursor += batch.length;
        return batch;
      },
    };
    vi.stubGlobal("fetch", shortProviderStub(state));

    const progress: GenerationProgress[] = [];
    const result = await questionService.generateQuestions({
      topicId: TOPIC,
      sectionIds: [sectionId],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 5,
      // 不寫入題庫：本測試只驗證生成流程的題數契約
      persist: false,
      onProgress: (entry) => progress.push(entry),
    });

    expect(result.questions.length).toBe(5);
    expect(result.requestedCount).toBe(5);
    expect(result.shortfall).toBe(0);
    // 真實發生了補題：至少 2 次模型呼叫，且在呼叫上限之內
    expect(state.calls).toBeGreaterThanOrEqual(2);
    expect(state.calls).toBeLessThanOrEqual(5);
    const toppingUp = progress.filter((entry) => entry.stage === "topping-up");
    expect(toppingUp.length).toBeGreaterThan(0);
    expect(toppingUp[0].message).toContain("補足");
    expect(toppingUp[0].target).toBe(5);
  });

  it("教材不足時補題會停止並如實回報短欠，不會無限呼叫模型", async () => {
    const state = {
      calls: 0,
      // 每次呼叫都交回同一條題目：補題沒有新進展，兩輪後必須停止
      batch: (): Excerpt[] => [pool[0]],
    };
    vi.stubGlobal("fetch", shortProviderStub(state));

    const progress: GenerationProgress[] = [];
    const result = await questionService.generateQuestions({
      topicId: TOPIC,
      sectionIds: [sectionId],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 5,
      persist: false,
      onProgress: (entry) => progress.push(entry),
    });

    expect(result.questions.length).toBe(1);
    expect(result.shortfall).toBe(4);
    expect(state.calls).toBeLessThanOrEqual(5);
    // 短欠要交代清楚，令教師知道可以改選分節／補充教材，而不是以為平台只出了這麼多題
    expect(result.notice ?? "").toContain("只取得 1／5 題");
    expect(progress.some((entry) => entry.stage === "topping-up")).toBe(true);
  });

  /**
   * 2026-11-24 擁有者指示：正確答案不可以是選擇題中最長的那一項。
   *
   * 生成階段會先要求模型重寫（提示詞明確要求把錯誤選項加長）；重寫後仍然如此，
   * 就不寫入題庫——寧可少一題（補題會嘗試補回），也不留下「只選最長那項」就能
   * 答對的題目。
   */
  it("正確答案是最長選項的題目會被重寫，仍然如此則不寫入題庫", async () => {
    const balanced = buildQuestion(pool[0], pool) as Record<string, unknown>;
    const asymmetric = {
      ...(buildQuestion(pool[1], pool) as Record<string, unknown>),
      // 正確答案（教材句子，10 字以上）明顯長於所有錯誤選項
      options: [pool[1].text, "甲項", "乙項", "丙項"],
    };
    const state = { calls: 0 };
    vi.stubGlobal(
      "fetch",
      (async () => {
        state.calls += 1;
        return new Response(
          JSON.stringify({
            choices: [
              { message: { content: JSON.stringify({ questions: [balanced, asymmetric] }) } },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 50 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch,
    );

    const result = await questionService.generateQuestions({
      topicId: TOPIC,
      sectionIds: [sectionId],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 2,
      persist: false,
    });

    // 只有長度中性的題目保留
    expect(result.questions.length).toBe(1);
    expect(result.questions[0].question).toBe(balanced.question);
    expect(result.shortfall).toBe(1);
    // 曾經要求重寫（第 1 輪之後仍有至少一次呼叫）
    expect(state.calls).toBeGreaterThanOrEqual(2);
    expect(state.calls).toBeLessThanOrEqual(5);
    // 丟棄原因要說得出是哪一條規則，教師才知道怎樣修正
    expect(result.discardReasons.join("\n")).toContain("最長的選項");
    expect(result.notice ?? "").toContain("最長的選項");
  });
});
