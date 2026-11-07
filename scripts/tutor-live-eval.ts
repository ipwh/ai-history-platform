/**
 * 學伴受控模型評估（Sprint 30）。
 *
 * ── 為甚麼要有「計劃」模式 ────────────────────────────────────────────
 * 確定性測試只能證明「提示詞與政策按規定組裝」，不能證明模型真的遵守。要驗證模型
 * 行為必須真正呼叫付費模型，因此本工具預設**只輸出計劃**（零網絡請求），要真正呼叫
 * 必須同時滿足三項：`--apply`、環境變數 `TUTOR_EVAL_ALLOW_LIVE_CALLS=1`、以及明確的
 * 預算上限 `--budget-usd <金額>`。缺少任何一項即拒絕執行並印出所需授權。
 *
 * ── 成本與私隱邊界 ───────────────────────────────────────────────────
 *   - 分層抽樣，預設 12 條、硬上限 20 條，每條**一次**呼叫（不重試除了一次網絡錯誤）；
 *   - `max_tokens` 由回覆深度上限控制，並受 `LLM_MAX_TOKENS` 限制；
 *   - 只使用合成學生問題（不出現真實學生資料）；
 *   - 結果寫入版本庫以外的指定路徑，不覆寫既有檔案（`wx`）；
 *   - 記錄模型、提示詞版本、配置及日期，令結果可重現。
 */
import fs from "node:fs";
import path from "node:path";

import { getServerConfig } from "../src/server/config";
import {
  findTutorGrounding,
  loadTutorCurriculumIndex,
  TUTOR_PROMPT_VERSION,
} from "../src/server/services/tutor-grounding";
import { classifyTutorAnswerability } from "../src/server/services/tutor-answerability";
import { isUnclearTutorQuery, normalizeTutorQuery } from "../src/server/services/tutor-query";
import { resolveTutorReplyDepth, tutorMaxSourcesForDepth } from "../src/server/services/tutor-depth";
import type { TutorReplyDepth } from "@/lib/types";
import {
  microToUsd,
  parseJournal,
  runTutorEvaluation,
  usdToMicro,
  type TutorEvalCaseRecord,
  type TutorEvalPricing,
  type TutorEvalTransport,
} from "../src/server/quality/tutor-eval-engine";
import { createLiveTransport } from "./lib/tutor-live-transport";
import { pricingForModel } from "./lib/provider-pricing";
import {
  LIVE_EVAL_DATASET,
  LIVE_EVAL_DEFAULT_CASES,
  LIVE_EVAL_MAX_CASES,
} from "../tests/fixtures/tutor-live-eval-dataset";

export interface LiveEvalPlan {
  promptVersion: string;
  model: string | null;
  provider: string;
  /** 讀取了哪個環境檔補充變數（`null` = 沒有） */
  envLoadedFrom?: string | null;
  caseCount: number;
  callsPerCase: number;
  totalCalls: number;
  maxOutputTokensPerCall: number;
  maxTotalOutputTokens: number;
  /**
   * 12 條案例的**保守成本上限**（輸入＋輸出都以上限計）。定價未提供時為 null，
   * 並在 `costEstimateUnavailable` 說明原因——不用猜測的價格假裝有預算。
   */
  estimatedCostUsdCeiling: number | null;
  costEstimateUnavailable: string | null;
  /** 保守輸入 token 上限（每次呼叫） */
  estimatedInputTokensPerCall: number;
  pricingSource: string | null;
  timeoutMs: number;
  retryPolicy: string;
  privacy: string;
  authorizationRequired: string[];
  cases: {
    id: string;
    persona: string;
    language: string;
    expectedState: string | null;
    stateFromClassifier: string;
    confidence: string | null;
    coverageClass: string;
    expectedEvidencePolicy: string;
    expectedDisclosure: boolean;
    evaluationFocus: readonly string[];
    depth: string;
    query: string;
  }[];
}

/** 把 `--max-cases` 夾在 1 與硬上限之間（不接受無限、零或負數） */
export function clampCaseCount(value: number): number {
  if (!Number.isFinite(value)) return LIVE_EVAL_DEFAULT_CASES;
  return Math.max(1, Math.min(LIVE_EVAL_MAX_CASES, Math.trunc(value)));
}

/**
 * 讀取專案根目錄的 `.env.local`（若存在），**只補上未設定的變數**。
 *
 * 為甚麼需要：計劃必須記錄實際使用的 provider／model，而 `tsx` 執行時不會自動載入
 * Next.js 的環境檔。這裡不覆寫既有環境變數、不輸出任何值（避免憑證進入日誌或報告）。
 */
export function loadProjectEnvFile(repoRoot: string): string | null {
  const envPath = path.join(repoRoot, ".env.local");
  if (!fs.existsSync(envPath)) return null;
  const content = fs.readFileSync(envPath, "utf8").replace(/^\uFEFF/, "");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Z0-9_]+$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
  return ".env.local";
}

function readArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

/** 與 `src/app/api/tutor/chat/route.ts` 的 `MAX_TOKENS_BY_DEPTH` 一致，令預算估算等於實際上限 */
const DEPTH_TOKEN_CAPS: Record<TutorReplyDepth, number> = {
  standard: 1_000,
  advanced: 1_500,
  challenge: 2_000,
};

export interface BuildPlanOptions {
  /** 保守輸入 token 上限；預設 6,000 */
  estimatedInputTokensPerCall?: number;
  pricing?: TutorEvalPricing | null;
}

/** 每次呼叫的保守輸入 token 上限（系統提示＋上文＋問題） */
export const DEFAULT_ESTIMATED_INPUT_TOKENS = 6_000;

/**
 * 建立引擎所需的案例規格。
 *
 * `maxOutputTokens` 必須與路線的封頂方式一致（`min(LLM_MAX_TOKENS, 深度上限)`），
 * 否則預算上限會低於實際可能的用量。
 */
export function buildCaseSpecs(
  caseCount: number,
  estimatedInputTokens: number = DEFAULT_ESTIMATED_INPUT_TOKENS,
): { id: string; maxOutputTokens: number; estimatedInputTokens: number; depth: TutorReplyDepth }[] {
  const config = getServerConfig();
  return LIVE_EVAL_DATASET.slice(0, caseCount).map((entry) => {
    const depth = resolveTutorReplyDepth("auto", entry.query, null);
    const maxOutputTokens = Math.min(
      config.llm.maxTokens ?? DEPTH_TOKEN_CAPS[depth],
      DEPTH_TOKEN_CAPS[depth],
    );
    return { id: entry.id, maxOutputTokens, estimatedInputTokens, depth };
  });
}

/** 全部案例的保守成本上限（輸入與輸出都以上限計） */
export function computeCeilingUsd(
  specs: readonly { maxOutputTokens: number; estimatedInputTokens: number }[],
  pricing: TutorEvalPricing,
  fallbackInputTokens: number = DEFAULT_ESTIMATED_INPUT_TOKENS,
): number {
  let micro = 0;
  for (const spec of specs) {
    const input = spec.estimatedInputTokens || fallbackInputTokens;
    micro +=
      Math.ceil(usdToMicro((input / 1_000_000) * pricing.inputUsdPerMillion)) +
      Math.ceil(usdToMicro((spec.maxOutputTokens / 1_000_000) * pricing.outputUsdPerMillion));
  }
  return Math.round(microToUsd(micro) * 1_000_000) / 1_000_000;
}

/**
 * 本機 mock transport（只供 `--self-test`）。
 *
 * 用途：在不接觸任何供應商的情況下，證明「授權 → 計劃 → 執行 → 記帳 → journal」
 * 整條路徑可用。它**永不**是模型行為證據，輸出會明確標示 `transport: "mock-selftest"`。
 */
export function createMockSelfTestTransport(): TutorEvalTransport {
  return {
    name: "mock-selftest",
    provider: "mock",
    model: "mock-selftest",
    async call(request) {
      return {
        ok: true,
        answer: `[SELF-TEST 非模型輸出] 案例 ${request.caseId} 的模擬回覆。`,
        usage: { inputTokens: 3_000, outputTokens: 600 },
      };
    },
  };
}

export function buildPlan(caseCount: number, options: BuildPlanOptions = {}): LiveEvalPlan {
  const config = getServerConfig();
  const curriculum = loadTutorCurriculumIndex();
  const selected = LIVE_EVAL_DATASET.slice(0, caseCount);
  const estimatedInputTokensPerCall =
    options.estimatedInputTokensPerCall ?? DEFAULT_ESTIMATED_INPUT_TOKENS;
  let maxOutputTokensPerCall = 0;
  let maxTotalOutputTokens = 0;
  const cases = selected.map((entry) => {
    const normalized = normalizeTutorQuery(entry.query);
    const depth = resolveTutorReplyDepth("auto", entry.query, null);
    const grounding = findTutorGrounding(
      normalized,
      (entry.history ?? []).map(normalizeTutorQuery),
      curriculum,
      { maxSources: tutorMaxSourcesForDepth(depth) },
    );
    const decision = classifyTutorAnswerability({
      message: entry.query,
      curriculum,
      grounding,
      hasHistoryContext: (entry.history ?? []).length > 0,
      unclear: isUnclearTutorQuery(entry.query, curriculum, (entry.history ?? []).length > 0),
    });
    // 與路線相同的封頂方式：min(LLM_MAX_TOKENS, 深度上限)
    const tokens = Math.min(config.llm.maxTokens ?? DEPTH_TOKEN_CAPS[depth], DEPTH_TOKEN_CAPS[depth]);
    maxOutputTokensPerCall = Math.max(maxOutputTokensPerCall, tokens);
    maxTotalOutputTokens += tokens;
    return {
      id: entry.id,
      persona: entry.persona,
      language: entry.language,
      expectedState: entry.expectedState,
      stateFromClassifier: decision.state,
      confidence: decision.confidence,
      coverageClass: entry.coverageClass,
      expectedEvidencePolicy: entry.expectedEvidencePolicy,
      expectedDisclosure: entry.expectedDisclosure,
      evaluationFocus: entry.evaluationFocus,
      depth,
      query: entry.query,
    };
  });

  const costCeiling =
    options.pricing === null || options.pricing === undefined
      ? null
      : computeCeilingUsd(
          selected.map((entry) => ({
            maxOutputTokens: Math.min(
              config.llm.maxTokens ?? DEPTH_TOKEN_CAPS[resolveTutorReplyDepth("auto", entry.query, null)],
              DEPTH_TOKEN_CAPS[resolveTutorReplyDepth("auto", entry.query, null)],
            ),
            estimatedInputTokens: estimatedInputTokensPerCall,
          })),
          options.pricing,
        );

  return {
    promptVersion: TUTOR_PROMPT_VERSION,
    model: config.llm.model,
    provider: config.llm.provider,
    caseCount: cases.length,
    callsPerCase: 1,
    totalCalls: cases.length,
    maxOutputTokensPerCall,
    maxTotalOutputTokens,
    estimatedCostUsdCeiling: costCeiling,
    costEstimateUnavailable:
      options.pricing === null || options.pricing === undefined
        ? "未提供定價（--pricing-input-usd-per-million／--pricing-output-usd-per-million／--pricing-source）"
        : null,
    estimatedInputTokensPerCall,
    pricingSource: options.pricing?.source ?? null,
    timeoutMs: config.llm.requestTimeoutMs,
    retryPolicy: "只對網絡錯誤重試一次；其餘錯誤即時停止，不會重複扣費",
    privacy: "只用合成學生問題；不寫入真實學生身分、對話或教材全文",
    authorizationRequired: [
      "--apply（明確執行）",
      "TUTOR_EVAL_ALLOW_LIVE_CALLS=1（環境變數授權付費呼叫）",
      "--budget-usd <金額>（須 ≥ 計劃的 estimatedCostUsdCeiling）",
    ],
    cases,
  };
}

/**
 * 是否已獲授權作付費模型呼叫。
 * 三項條件必須同時成立，缺一即拒絕（fail closed）。
 */
export function liveCallAuthorization(
  options: { apply: boolean; allowance: string | null; budgetUsd: number | null },
  plan: LiveEvalPlan,
): { allowed: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!options.apply) missing.push("--apply");
  if (options.allowance !== "1") missing.push("TUTOR_EVAL_ALLOW_LIVE_CALLS=1");
  if (options.budgetUsd === null || Number.isNaN(options.budgetUsd)) {
    missing.push("--budget-usd");
  } else if (plan.estimatedCostUsdCeiling === null) {
    // 沒有定價就不可能判斷預算是否足夠 → 不可以用猜測放行。
    missing.push("定價（--pricing-input-usd-per-million／--pricing-output-usd-per-million／--pricing-source）");
  } else if (options.budgetUsd < plan.estimatedCostUsdCeiling) {
    missing.push(`--budget-usd 不足（需要 ≥ ${plan.estimatedCostUsdCeiling}；含輸入 token 上限）`);
  }
  return { allowed: missing.length === 0, missing };
}

function readPricing(argv: string[]): TutorEvalPricing | null {
  const input = readArg(argv, "--pricing-input-usd-per-million");
  const output = readArg(argv, "--pricing-output-usd-per-million");
  const source = readArg(argv, "--pricing-source");
  if (input === null || output === null || source === null) return null;
  const inputRate = Number(input);
  const outputRate = Number(output);
  if (!Number.isFinite(inputRate) || !Number.isFinite(outputRate)) return null;
  return {
    inputUsdPerMillion: inputRate,
    outputUsdPerMillion: outputRate,
    source,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const envLoadedFrom = loadProjectEnvFile(process.cwd());
  const requested = Number(readArg(argv, "--max-cases") ?? LIVE_EVAL_DEFAULT_CASES);
  const caseCount = clampCaseCount(requested);
  const outPath = readArg(argv, "--out");
  const journalPath = readArg(argv, "--journal");
  const pricing = readPricing(argv);
  const estimatedInputTokens =
    readArg(argv, "--estimated-input-tokens") === null
      ? DEFAULT_ESTIMATED_INPUT_TOKENS
      : Number(readArg(argv, "--estimated-input-tokens"));
  const plan = {
    ...buildPlan(caseCount, { pricing, estimatedInputTokensPerCall: estimatedInputTokens }),
    envLoadedFrom,
  };

  const authorization = liveCallAuthorization(
    {
      apply: argv.includes("--apply"),
      allowance: process.env.TUTOR_EVAL_ALLOW_LIVE_CALLS ?? null,
      budgetUsd: readArg(argv, "--budget-usd") === null ? null : Number(readArg(argv, "--budget-usd")),
    },
    plan,
  );

  if (outPath !== null) {
    const resolved = path.resolve(outPath);
    if (fs.existsSync(resolved)) throw new Error(`拒絕覆寫既有檔案：${resolved}`);
    fs.writeFileSync(resolved, `${JSON.stringify({ plan, authorization }, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    console.log(`已寫出評估計劃：${resolved}`);
  } else {
    console.log(JSON.stringify({ plan, authorization }, null, 2));
  }

  if (!authorization.allowed) {
    console.log("");
    console.log("未執行任何模型呼叫（未獲授權）。所需條件：");
    for (const item of authorization.missing) console.log(` - ${item}`);
    return;
  }

  // ── 執行階段 ────────────────────────────────────────────────────────
  // 兩種模式：
  //   --self-test：本機 mock transport，零網絡，只證明路徑可用；
  //   --live     ：真正呼叫供應商，使用與正式 route 相同的串流 adapter
  //                （llm/stream-chat-completion.ts），每次呼叫一個請求。
  const selfTest = argv.includes("--self-test");
  const live = argv.includes("--live");
  if (!selfTest && !live) {
    throw new Error(
      "已具備授權條件，但未指定模式：請加 --live（真實呼叫）或 --self-test（本機 mock 驗證）。",
    );
  }
  if (selfTest && live) throw new Error("--self-test 與 --live 不可同時使用。");

  const approvedModel = readArg(argv, "--approved-model");
  const approvedProvider = readArg(argv, "--approved-provider") ?? "deepseek";

  if (pricing === null) throw new Error("--self-test 需要 --pricing-* 參數（用於記帳驗證）");

  // resume：由既有 journal 還原已完成案例，避免重複付費；沒有 resume 時 journal 不可已存在。
  const resumePath = readArg(argv, "--resume");
  const journalTarget = resumePath ?? journalPath;
  if (journalTarget === null) throw new Error("--self-test 需要 --journal <路徑>（記錄每條案例）");
  const resolvedJournal = path.resolve(journalTarget);

  let previous: TutorEvalCaseRecord[] = [];
  let truncatedJournalLines = 0;
  if (resumePath !== null) {
    if (!fs.existsSync(resolvedJournal)) throw new Error(`找不到可 resume 的 journal：${resolvedJournal}`);
    const parsed = parseJournal(fs.readFileSync(resolvedJournal, "utf8"));
    previous = parsed.records;
    truncatedJournalLines = parsed.truncatedLines;
  } else if (fs.existsSync(resolvedJournal)) {
    throw new Error(`拒絕覆寫既有 journal：${resolvedJournal}（如要續跑請用 --resume）`);
  }

  const specs = buildCaseSpecs(caseCount, estimatedInputTokens).map((spec) => ({
    id: spec.id,
    maxOutputTokens: spec.maxOutputTokens,
    estimatedInputTokens: spec.estimatedInputTokens,
  }));

  const appendJournal = (record: TutorEvalCaseRecord): void => {
    fs.appendFileSync(resolvedJournal, `${JSON.stringify(record)}\n`, { encoding: "utf8" });
  };

  let transport: TutorEvalTransport;
  if (selfTest) {
    transport = createMockSelfTestTransport();
  } else {
    // live：使用與正式 route 相同的串流 adapter；provider／model 必須與批准值相符。
    const config = getServerConfig();
    if (approvedModel === null) {
      throw new Error("--live 必須提供 --approved-model（owner 批准的 model ID）。");
    }
    if (config.llm.apiKey === null || config.llm.baseUrl === null || config.llm.model === null) {
      throw new Error("LLM 設定不完整（apiKey／baseUrl／model），不可執行 live 評估。");
    }
    if (config.llm.provider !== approvedProvider || config.llm.model !== approvedModel) {
      throw new Error(
        `實際設定 ${config.llm.provider}/${config.llm.model} 與批准值 ${approvedProvider}/${approvedModel} 不一致，停止執行。`,
      );
    }
    const verified = pricingForModel(approvedModel);
    if (
      Math.abs(pricing.inputUsdPerMillion - verified.inputUsdPerMillion) > 1e-9 ||
      Math.abs(pricing.outputUsdPerMillion - verified.outputUsdPerMillion) > 1e-9
    ) {
      throw new Error(
        "提供的 --pricing-* 與已查證的官方定價不符；請使用 scripts/lib/provider-pricing.ts 的數值或更新該檔。",
      );
    }
    transport = createLiveTransport(
      {
        provider: config.llm.provider,
        model: config.llm.model,
        baseUrl: config.llm.baseUrl,
        apiKey: config.llm.apiKey,
        timeoutMs: config.llm.requestTimeoutMs,
        maxTokensCap: config.llm.maxTokens,
        thinking: config.llm.thinking,
        reasoningEffort: config.llm.reasoningEffort,
      },
      LIVE_EVAL_DATASET,
      { provider: approvedProvider, model: approvedModel },
    );
  }

  const result = await runTutorEvaluation({
    cases: specs,
    transport,
    pricing,
    budgetUsd: Number(readArg(argv, "--budget-usd")),
    previous,
    confirmUncertainResume: argv.includes("--confirm-uncertain-resume"),
    onCaseComplete: appendJournal,
  });

  console.log("");
  console.log(
    selfTest
      ? `SELF-TEST（transport=${transport.name}；非模型輸出）`
      : `LIVE（transport=${transport.name}；model=${transport.model}）`,
  );
  console.log(`狀態：${result.status}`);
  if (result.refusalReason !== null) console.log(`拒絕原因：${result.refusalReason}`);
  console.log(`呼叫次數：${result.calls}；重試：${result.retries}`);
  console.log(
    `花費：US$${microToUsd(result.spentMicro).toFixed(6)}／上限 US$${microToUsd(result.budgetMicro).toFixed(2)}`,
  );
  console.log(`已完成：${result.records.filter((record) => record.status === "ok").length}／${specs.length}`);
  if (result.notRunCases.length > 0) console.log(`未執行：${result.notRunCases.join(", ")}`);
  if (result.costUnknownCases.length > 0) {
    console.log(`用量不可信（以上限估算）：${result.costUnknownCases.join(", ")}`);
  }
  if (resumePath !== null) {
    console.log(`resume 來源：${resolvedJournal}（略過已完成 ${previous.filter((r) => r.status === "ok").length} 條）`);
    if (truncatedJournalLines > 0) {
      console.log(`journal 有 ${truncatedJournalLines} 行不完整（可能上次被強制終止），已忽略`);
    }
  }
  console.log(`journal：${resolvedJournal}`);
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]).endsWith("tutor-live-eval.ts");
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
