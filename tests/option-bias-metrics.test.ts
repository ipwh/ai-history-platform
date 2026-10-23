import { describe, expect, it } from "vitest";

import {
  LENGTH_ASYMMETRY_MIN_DELTA,
  LENGTH_ASYMMETRY_RATIO,
  analyseOptionQuality,
  optionTextLength,
} from "@/server/quality/option-quality";
import { OPTION_BIAS_SAMPLES, type OptionBiasSample } from "./fixtures/option-bias-samples";

/**
 * 固定離線樣本上的度量（Sprint 23）。
 *
 * 這一組數字**只反映合成樣本**，不能當作題庫品質或歷史正確性的證據；
 * 生產快照的實際分佈由 `scripts/audit-option-bias.ts` 以唯讀方式量度。
 *
 * 分開「調參樣本」與「評測樣本」：門檻（1.5 倍、至少多 4 字）是根據 Sprint 22 的
 * 生產快照分佈與兩條 tuning 樣本定出來的，其餘樣本在門檻定案後才首次計算，
 * 用來檢查規則有沒有漏報（false negative）或誤報（false positive）。
 */

interface SampleStats {
  origin: string;
  analysable: number;
  predictable: number;
  predictedCorrectly: number;
  flagged: number;
}

function isAsymmetricByDefinition(sample: OptionBiasSample): boolean {
  const lengths = sample.options.map((option) => optionTextLength(option));
  const correctIndex = sample.options.findIndex(
    (option) => option.trim() === sample.correctAnswer.trim(),
  );
  if (correctIndex < 0) return false;
  const others = lengths.filter((_unused, index) => index !== correctIndex);
  const longest = Math.max(...others);
  const correctLength = lengths[correctIndex];
  return (
    correctLength > longest &&
    correctLength / longest >= LENGTH_ASYMMETRY_RATIO &&
    correctLength - longest >= LENGTH_ASYMMETRY_MIN_DELTA
  );
}

function statsFor(samples: readonly OptionBiasSample[], origin: string): SampleStats {
  let analysable = 0;
  let predictable = 0;
  let predictedCorrectly = 0;
  let flagged = 0;
  for (const sample of samples.filter((entry) => entry.origin === origin)) {
    const result = analyseOptionQuality({
      questionType: "mc",
      options: sample.options,
      correctAnswer: sample.correctAnswer,
    });
    if (!result.applicable || result.metrics === null) continue;
    analysable += 1;
    if (result.findings.length > 0) flagged += 1;
    const maxLength = Math.max(...result.metrics.lengths);
    const winners = result.metrics.lengths
      .map((length, index) => (length === maxLength ? index : -1))
      .filter((index) => index >= 0);
    if (winners.length === 1) {
      predictable += 1;
      if (winners[0] === result.metrics.correctIndex) predictedCorrectly += 1;
    }
  }
  return { origin, analysable, predictable, predictedCorrectly, flagged };
}

const EVALUATION = OPTION_BIAS_SAMPLES.filter((sample) => sample.split !== "tuning");
const TUNING = OPTION_BIAS_SAMPLES.filter((sample) => sample.split === "tuning");

describe("固定離線樣本的分母與度量", () => {
  it("樣本按來源分組，分母清楚（全部可分析、沒有靜默排除）", () => {
    const origins = ["material-ai", "school-paper", "demo", "material-mock"] as const;
    const covered = origins.reduce(
      (total, origin) => total + OPTION_BIAS_SAMPLES.filter((s) => s.origin === origin).length,
      0,
    );
    expect(covered).toBe(OPTION_BIAS_SAMPLES.length);
    for (const origin of origins) {
      const stats = statsFor(OPTION_BIAS_SAMPLES, origin);
      expect(stats.analysable).toBe(
        OPTION_BIAS_SAMPLES.filter((sample) => sample.origin === origin).length,
      );
    }
  });

  it("調參樣本與評測樣本分開計算，並列的處理方式一致（並列＝不作唯一預測）", () => {
    const tuning = statsFor(TUNING, "material-ai");
    const evaluation = statsFor(EVALUATION, "material-ai");
    expect(tuning.analysable).toBe(2);
    expect(evaluation.analysable).toBe(4);

    // 並列最長的樣本（四項等長）不計入可預測題數，避免把「隨機猜中」當成命中
    const balanced = EVALUATION.find((sample) => sample.id === "sample-ai-balanced");
    expect(balanced).toBeDefined();
    const result = analyseOptionQuality({
      questionType: "mc",
      options: balanced!.options,
      correctAnswer: balanced!.correctAnswer,
    });
    const maxLength = Math.max(...result.metrics!.lengths);
    expect(result.metrics!.lengths.filter((length) => length === maxLength)).toHaveLength(4);
  });

  it("評測樣本沒有漏報：凡是符合門檻的不對稱，規則都會發出警告", () => {
    for (const sample of EVALUATION) {
      const expected = isAsymmetricByDefinition(sample);
      const findings = analyseOptionQuality({
        questionType: "mc",
        options: sample.options,
        correctAnswer: sample.correctAnswer,
      }).findings.map((finding) => finding.code);
      expect(findings.includes("option-length-asymmetry"), sample.id).toBe(expected);
    }
  });

  it("評測樣本沒有誤報：平衡的選項（學校試卷／示範／mock）不會被標記", () => {
    for (const origin of ["school-paper", "demo", "material-mock"] as const) {
      const flagged = EVALUATION.filter((sample) => sample.origin === origin).filter((sample) => {
        const findings = analyseOptionQuality({
          questionType: "mc",
          options: sample.options,
          correctAnswer: sample.correctAnswer,
        }).findings;
        return findings.length > 0;
      });
      expect(flagged.map((sample) => sample.id), origin).toEqual([]);
    }
  });

  it("警告率的分母是「可分析題數」，不是所有題目（避免用排除項沖淡比率）", () => {
    const stats = statsFor(OPTION_BIAS_SAMPLES, "material-ai");
    expect(stats.analysable).toBe(6);
    // 6 條 AI 樣本中，3 條刻意含表面線索（兩條調參、一條評測）；其餘為平衡／重複／絕對化
    const flaggedIds = OPTION_BIAS_SAMPLES.filter((sample) => {
      if (sample.origin !== "material-ai") return false;
      return (
        analyseOptionQuality({
          questionType: "mc",
          options: sample.options,
          correctAnswer: sample.correctAnswer,
        }).findings.length > 0
      );
    }).map((sample) => sample.id);
    expect(flaggedIds.sort()).toEqual(
      [
        "sample-ai-absolutist",
        "sample-ai-duplicate",
        "sample-ai-length-only",
        "sample-ai-long-correct",
        "sample-ai-long-correct-2",
      ].sort(),
    );
    expect(stats.flagged).toBe(flaggedIds.length);
  });
});

describe("shuffle 不會令長度線索消失", () => {
  it("旋轉／重排選項後，長度關係與警告完全相同（位置改變但最長者不變）", () => {
    for (const sample of OPTION_BIAS_SAMPLES) {
      const baseline = analyseOptionQuality({
        questionType: "mc",
        options: sample.options,
        correctAnswer: sample.correctAnswer,
      });
      const sortedLengths = [...baseline.metrics!.lengths].sort((a, b) => a - b);
      for (let rotation = 1; rotation < sample.options.length; rotation += 1) {
        const rotated = [...sample.options.slice(rotation), ...sample.options.slice(0, rotation)];
        const result = analyseOptionQuality({
          questionType: "mc",
          options: rotated,
          correctAnswer: sample.correctAnswer,
        });
        expect([...result.metrics!.lengths].sort((a, b) => a - b), sample.id).toEqual(
          sortedLengths,
        );
        expect(
          result.findings.map((finding) => finding.code),
          sample.id,
        ).toEqual(baseline.findings.map((finding) => finding.code));
        expect(result.metrics!.correctLength, sample.id).toBe(baseline.metrics!.correctLength);
      }
    }
  });
});
