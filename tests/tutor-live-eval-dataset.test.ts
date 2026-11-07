import { afterEach, describe, expect, it, vi } from "vitest";

import { TUTOR_PROMPT_VERSION } from "@/server/services/tutor-grounding";
import {
  LIVE_EVAL_DATASET,
  LIVE_EVAL_DEFAULT_CASES,
  LIVE_EVAL_MAX_CASES,
} from "./fixtures/tutor-live-eval-dataset";
import { buildPlan, clampCaseCount, liveCallAuthorization, loadProjectEnvFile } from "../scripts/tutor-live-eval";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("受控評估資料集契約（Sprint 31）", () => {
  it("覆蓋 A／B／C1／C2／C3／D／out-of-scope／多部分／混合／追問", () => {
    const classes = new Set(LIVE_EVAL_DATASET.map((entry) => entry.coverageClass));
    for (const required of [
      "A",
      "B",
      "C1",
      "C2",
      "C3",
      "D",
      "out-of-scope",
      "multi-part",
      "mixed",
      "follow-up",
    ]) {
      expect(classes, `缺少 ${required}`).toContain(required);
    }
  });

  it("首輪案例數不超過預設值，且永不多於硬上限", () => {
    expect(LIVE_EVAL_DATASET.length).toBeLessThanOrEqual(LIVE_EVAL_DEFAULT_CASES);
    expect(LIVE_EVAL_DEFAULT_CASES).toBeLessThanOrEqual(LIVE_EVAL_MAX_CASES);
  });

  it("案例 ID 唯一，並涵蓋繁體、粵語、簡體、英文及中英混寫", () => {
    const ids = LIVE_EVAL_DATASET.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    const languages = new Set(LIVE_EVAL_DATASET.map((entry) => entry.language));
    for (const language of ["zh-Hant", "zh-Hant-yue", "zh-Hans", "en", "mixed"]) {
      expect(languages, language).toContain(language);
    }
  });

  it("每條案例都有評估重點、期望證據政策及披露要求", () => {
    for (const entry of LIVE_EVAL_DATASET) {
      expect(entry.evaluationFocus.length, entry.id).toBeGreaterThan(0);
      expect(entry.expectedEvidencePolicy, entry.id).toBeTruthy();
      expect(typeof entry.expectedDisclosure, entry.id).toBe("boolean");
      // C 狀態必須有信心層級；其他狀態必須為 null
      if (entry.expectedState === "C-general-knowledge") {
        expect(entry.expectedConfidence, entry.id).not.toBeNull();
      } else {
        expect(entry.expectedConfidence, entry.id).toBeNull();
      }
    }
  });

  it("只含合成問題：沒有電郵、電話或身份欄位", () => {
    const text = JSON.stringify(LIVE_EVAL_DATASET);
    expect(text).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
    expect(text).not.toMatch(/s\d{7}/);
    expect(text).not.toMatch(/\b\d{8}\b/);
  });
});

describe("計劃模式：零網絡請求與硬上限", () => {
  it("建立計劃不會呼叫 fetch", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const plan = buildPlan(LIVE_EVAL_DEFAULT_CASES);
    expect(plan.caseCount).toBe(LIVE_EVAL_DATASET.length);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("--max-cases 被夾在 1 與硬上限之間", () => {
    expect(clampCaseCount(1000)).toBe(LIVE_EVAL_MAX_CASES);
    expect(clampCaseCount(0)).toBe(1);
    expect(clampCaseCount(-5)).toBe(1);
    expect(clampCaseCount(Number.NaN)).toBe(LIVE_EVAL_DEFAULT_CASES);
    expect(clampCaseCount(3)).toBe(3);
  });

  it("計劃記錄提示詞版本、每次呼叫上限與總上限", () => {
    // 提供定價時才有成本上限；未提供時必須明確標示不可用（不以猜測價格假裝有預算）。
    const pricing = { inputUsdPerMillion: 0.28, outputUsdPerMillion: 2.5, source: "測試" };
    const plan = buildPlan(3, { pricing });
    expect(plan.promptVersion).toBe(TUTOR_PROMPT_VERSION);
    expect(plan.callsPerCase).toBe(1);
    expect(plan.totalCalls).toBe(3);
    expect(plan.maxTotalOutputTokens).toBeGreaterThan(0);
    expect(plan.maxTotalOutputTokens).toBeLessThanOrEqual(
      plan.maxOutputTokensPerCall * plan.caseCount,
    );
    expect(plan.estimatedCostUsdCeiling).toBeGreaterThan(0);
    expect(plan.costEstimateUnavailable).toBeNull();

    const withoutPricing = buildPlan(3);
    expect(withoutPricing.estimatedCostUsdCeiling).toBeNull();
    expect(withoutPricing.costEstimateUnavailable).toContain("未提供定價");
  });

  it("計劃列出每條案例的期望狀態與分類結果（可追溯）", () => {
    const plan = buildPlan(LIVE_EVAL_DEFAULT_CASES);
    for (const entry of plan.cases) {
      expect(entry.id).toMatch(/^live-\d{2}$/);
      expect(entry.stateFromClassifier).toBeTruthy();
      expect(entry.coverageClass).toBeTruthy();
      expect(entry.evaluationFocus.length).toBeGreaterThan(0);
    }
  });
});

describe("環境檔載入：不洩漏憑證、不覆寫既有變數", () => {
  it("只補上未設定的變數，並移除引號", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-eval-env-"));
    try {
      fs.writeFileSync(
        path.join(dir, ".env.local"),
        ['# comment', 'TUTOR_EVAL_TEST_ONLY_A="value-a"', "TUTOR_EVAL_TEST_ONLY_B=value-b", "invalid line"].join("\n"),
        "utf8",
      );
      process.env.TUTOR_EVAL_TEST_ONLY_B = "preset";
      delete process.env.TUTOR_EVAL_TEST_ONLY_A;

      const loaded = loadProjectEnvFile(dir);
      expect(loaded).toBe(".env.local");
      expect(process.env.TUTOR_EVAL_TEST_ONLY_A).toBe("value-a");
      // 既有值不被覆寫
      expect(process.env.TUTOR_EVAL_TEST_ONLY_B).toBe("preset");
    } finally {
      delete process.env.TUTOR_EVAL_TEST_ONLY_A;
      delete process.env.TUTOR_EVAL_TEST_ONLY_B;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("沒有 .env.local 時回傳 null", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-eval-env-empty-"));
    try {
      expect(loadProjectEnvFile(dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("授權閘門：Sprint 31 未獲授權", () => {
  it("沒有明確授權時不會放行，並列出所需條件", () => {
    const plan = buildPlan(3);
    const result = liveCallAuthorization(
      { apply: false, allowance: null, budgetUsd: null },
      plan,
    );
    expect(result.allowed).toBe(false);
    expect(result.missing.length).toBeGreaterThanOrEqual(3);
  });
});
