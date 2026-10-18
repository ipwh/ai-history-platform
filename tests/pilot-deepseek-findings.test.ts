/**
 * DeepSeek 受控試點的缺陷回歸測試（2026-10 試點，27 格矩陣 + 學生旅程）。
 *
 * 試點以真實模型輸出暴露三個可重現的軟件缺陷，本檔以**合成**教材及題目鎖定修正後的行為：
 *   1. 填充題答案「元老院」、「民族自決」因機構／思想詞尾不在標記清單而被誤拒
 *      （試點 PILOT-04、PILOT-06、PILOT-22；兩詞其實都見於教材）；
 *   2. 選擇題正確選項是教材語句的**改寫**時，逐字比對令 9 格選擇題中 6 格被丟棄
 *      （試點 PILOT-02、PILOT-03、PILOT-11、PILOT-12、PILOT-20、PILOT-21）；
 *   3. 杜撰人名警告把「上述兩項」、「納出兩次」、「洲人因而」等片段當成人名
 *      （試點 PILOT-08、PILOT-09、PILOT-16，17 條題目中 4 條出現這類誤報）。
 *
 * 所有教材內容均為合成，並未包含任何真實教材段落。
 */
import { describe, expect, it } from "vitest";

import { checkHistoricalAnswer } from "@/server/llm/historical-answer";
import { checkQuestionQuality, hasUncertainIssue, type QualityCandidate } from "@/server/llm/question-quality";
import { findUnverifiedNames } from "@/server/llm/validation";
import type { MaterialUnit } from "@/server/llm/provider";

const ROME_MATERIAL =
  "古代共和國建城後奉行君主制，並設立長老院，負責為君主提供施政建議；共和時期另設公民大會。";

const PEACE_MATERIAL =
  "與戰敗國簽署和約之後，列強同意在殖民地落實民族自決，但民族自決同時埋下日後衝突的隱患。";

describe("試點缺陷 1：機構及思想類答案被填充題標記清單誤拒", () => {
  it("機構名稱（長老院）視為歷史元素", () => {
    expect(checkHistoricalAnswer("長老院", ROME_MATERIAL).ok).toBe(true);
  });

  it("思想／原則（民族自決）視為歷史元素", () => {
    expect(checkHistoricalAnswer("民族自決", PEACE_MATERIAL).ok).toBe(true);
  });

  it("其他機構及思想詞尾同樣獲接納", () => {
    for (const answer of ["參議院", "平民大會", "護民官", "天賦權利", "平等原則"]) {
      expect(checkHistoricalAnswer(answer, ROME_MATERIAL).ok, answer).toBe(true);
    }
  });

  it("教材欄位名稱及說明仍然被拒（沒有放寬原本的檢查）", () => {
    for (const answer of ["重要原因", "科技發展", "背景", "影響深遠"]) {
      expect(checkHistoricalAnswer(answer, ROME_MATERIAL).ok, answer).toBe(false);
    }
  });
});

describe("試點缺陷 2：選擇題正確答案是教材改寫時被誤丟", () => {
  const UNITS: MaterialUnit[] = [
    {
      blockId: "synthetic-notice",
      sourceLocation: "合成教材 · 第 1 段",
      text: "十九世紀，工業革命逐步改變城市面貌：設立公共衛生局，負責清理污水；規定工廠必須限制工時。",
    },
  ];

  function mc(overrides: Partial<QualityCandidate>): QualityCandidate {
    return {
      questionType: "mc",
      question: "十九世紀的工業革命如何改變城市管治？",
      options: ["設立公共衛生局負責清理污水", "取消所有工廠", "禁止城市擴張", "推行計劃經濟"],
      correctAnswer: "設立公共衛生局負責清理污水",
      explanation: "合成解釋：教材指出工業革命期間設立公共衛生局，負責清理污水。",
      sourceExcerpt: "設立公共衛生局，負責清理污水",
      sourceBlockIds: ["synthetic-notice"],
      ...overrides,
    };
  }

  it("教材語句的改寫會獲保留並照常發布，只記錄警告（2026-10-18 放寬）", () => {
    const result = checkQuestionQuality(
      mc({ correctAnswer: "工業革命逐步令城市面貌改變，並設立公共衛生局負責清理污水" }),
      UNITS,
    );
    expect(result.issues.filter((issue) => issue.severity === "blocking")).toHaveLength(0);
    const issue = result.issues.find((issue) => issue.code === "answer-not-in-material");
    expect(issue?.severity).toBe("warning");
    expect(issue?.message).toContain("改寫");
    expect(hasUncertainIssue(result.issues)).toBe(false);
    expect(result.outcome).toBe("pass");
  });

  it("逐字引用的答案屬確定，不會暫緩自動發布", () => {
    const result = checkQuestionQuality(mc({}), UNITS);
    expect(result.issues.filter((issue) => issue.code === "answer-not-in-material")).toHaveLength(0);
    expect(hasUncertainIssue(result.issues)).toBe(false);
  });

  it("杜撰的年份或人物不會因改寫規則而獲通過", () => {
    const result = checkQuestionQuality(
      mc({ correctAnswer: "工業革命由凱撒利昂於公元前50年推行，並設立公共衛生局負責清理污水" }),
      UNITS,
    );
    const blocking = result.issues.filter((issue) => issue.severity === "blocking");
    expect(blocking.map((issue) => issue.code)).toContain("answer-not-in-material");
  });

  it("與教材重疊率不足的概括句仍然被丟棄", () => {
    const result = checkQuestionQuality(
      mc({ correctAnswer: "大革命使各國經濟繁榮，並促成永久和平" }),
      UNITS,
    );
    const blocking = result.issues.filter((issue) => issue.severity === "blocking");
    expect(blocking.map((issue) => issue.code)).toContain("answer-not-in-material");
  });

  it("填充題的短答案仍然必須逐字見於教材（沒有套用改寫規則）", () => {
    const result = checkQuestionQuality(
      mc({
        questionType: "fill",
        question: "十九世紀的城市設立＿＿＿，負責清理污水。",
        options: [],
        correctAnswer: "公共衛生局",
      }),
      UNITS,
    );
    expect(result.issues.filter((issue) => issue.severity === "blocking")).toHaveLength(0);

    const unsupported = checkQuestionQuality(
      mc({
        questionType: "fill",
        question: "十九世紀的城市設立＿＿＿，負責清理污水。",
        options: [],
        correctAnswer: "市政管理局局長",
      }),
      UNITS,
    );
    expect(unsupported.issues.filter((issue) => issue.severity === "blocking").map((issue) => issue.code)).toContain(
      "answer-not-in-material",
    );
  });
});

describe("試點缺陷 3：杜撰人名警告的誤報", () => {
  const MATERIAL = "科學革命期間，歐洲學者開始以觀察、實驗與理性研究自然，並提出多項嶄新理論。";

  it("指示詞與量詞片段不再當成人名", () => {
    const found = findUnverifiedNames(
      "上述兩項改革如何影響平民參政？學者納出兩次結論，歐洲人因而改變研究自然的方法。",
      MATERIAL,
    );
    expect(found.persons).toEqual([]);
  });

  it("轉折連接詞片段不再當成人名", () => {
    const found = findUnverifiedNames(
      "一方面實現民族自決，另一方面卻埋下隱患，科學革命的方法亦被應用於社會。",
      MATERIAL,
    );
    expect(found.persons).toEqual([]);
  });

  it("真正杜撰的人名仍然會被偵測（沒有把警告閹掉）", () => {
    const found = findUnverifiedNames("凱撒利昂提出多項嶄新理論。", MATERIAL);
    expect(found.persons).toContain("凱撒利昂");
  });

  it("教材已提及的人名不會被當成杜撰", () => {
    const material = "馬丁路德發表《九十五條論證》，質疑教會的立場。";
    const found = findUnverifiedNames("馬丁路德發表《九十五條論證》。", material);
    expect(found.persons).toEqual([]);
  });
});
