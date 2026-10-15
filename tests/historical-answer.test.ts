/**
 * 填充題答案的「歷史元素」檢查測試。
 *
 * 要求（擁有者指示）：填充題的答案必須是具有歷史意義的元素——著名歷史事件名稱、人物、
 * 年份、國家、地點、條約、神祇、思想、政治制度等，不可用普通詞語或形容詞。
 * 教材大綱的「標籤：說明」句式（「展開時間」、「為生方法」）正是最常見的不合格來源。
 */
import { describe, expect, it } from "vitest";

import { checkHistoricalAnswer } from "@/server/llm/historical-answer";

const MATERIAL = [
  "約公元前3,500年：人類發明文字以作記錄及溝通之用",
  "展開時間：約公元前3,500年",
  "為生方法：主要以採摘野果及狩獵為生",
  "定居與建房：村落陸續出現，以村落為基礎的農耕社會形成",
  "德意志神學家馬丁路德發表《九十五條論證》，批評教會濫用贖罪券。",
  "雅典與斯巴達為爭奪古希臘的領導權，爆發「伯羅奔尼撒戰爭」。",
].join("\n");

function ok(answer: string): boolean {
  return checkHistoricalAnswer(answer, MATERIAL).ok;
}

describe("填充題答案的歷史元素檢查", () => {
  it("接受年份、世紀及年代", () => {
    expect(ok("1517年")).toBe(true);
    expect(ok("3,500年")).toBe(true);
    expect(ok("公元前221年")).toBe(true);
    expect(ok("十八世紀")).toBe(true);
    expect(ok("1789年6月20日")).toBe(true);
  });

  it("接受人物、國家、地點、條約、神祇、思想及政治制度", () => {
    expect(ok("馬丁路德")).toBe(true); // 教材以「人名＋發表」敘述，可視為人物
    expect(ok("拿破崙皇帝")).toBe(true); // 稱謂詞尾
    expect(ok("英國")).toBe(true);
    expect(ok("雅典")).toBe(true);
    expect(ok("古希臘")).toBe(true);
    expect(ok("《凡爾賽條約》")).toBe(true);
    expect(ok("《展拓香港界址專條》")).toBe(true);
    expect(ok("宙斯")).toBe(true);
    expect(ok("太陽神")).toBe(true);
    expect(ok("人文主義")).toBe(true);
    expect(ok("封建制度")).toBe(true);
    expect(ok("君主立憲")).toBe(true);
    expect(ok("伯羅奔尼撒戰爭")).toBe(true);
    expect(ok("中古時代")).toBe(true);
    expect(ok("古代")).toBe(true);
    expect(ok("工業革命")).toBe(true);
  });

  it("接受教材以「」或《》標示的關鍵詞", () => {
    expect(ok("伯羅奔尼撒戰爭")).toBe(true);
    expect(checkHistoricalAnswer("家庭手工業制度", "家庭手工業制度：在家中以人手進行生產").ok).toBe(
      true,
    );
  });

  it("拒絕教材的欄位名稱（教材大綱的「標籤：說明」句式）", () => {
    for (const answer of ["展開時間", "為生方法", "定居與建房", "技術改良與文化發展", "背景", "前期", "總結"]) {
      const result = checkHistoricalAnswer(answer, MATERIAL);
      expect(result.ok, answer).toBe(false);
      expect(result.definite, answer).toBe(true);
    }
  });

  it("拒絕說明句、形容詞及過長的答案", () => {
    expect(checkHistoricalAnswer("出現的自然條件", MATERIAL).definite).toBe(true);
    expect(checkHistoricalAnswer("多種政治制度並行", MATERIAL).definite).toBe(true);
    expect(checkHistoricalAnswer("學會生存智慧", MATERIAL).definite).toBe(true);
    expect(checkHistoricalAnswer("重要", MATERIAL).definite).toBe(true);
    expect(checkHistoricalAnswer("生活方式", MATERIAL).definite).toBe(true);
    expect(checkHistoricalAnswer("最早期的人類約七百多萬年前在非洲出現", MATERIAL).definite).toBe(
      true,
    );
  });

  it("拒絕單字答案及空白答案", () => {
    expect(checkHistoricalAnswer("", MATERIAL).definite).toBe(true);
    expect(checkHistoricalAnswer("北", MATERIAL).definite).toBe(true);
    expect(checkHistoricalAnswer("三", MATERIAL).definite).toBe(true);
  });

  it("未能確認屬歷史元素時只作不確定判斷（交由呼叫方處理）", () => {
    const result = checkHistoricalAnswer("鐵器", "鐵器的使用令農業生產效率提升。");
    expect(result.ok).toBe(false);
    // 名單及詞尾不可能窮盡所有專有名詞，因此不可當成「明顯不合格」
    expect(result.definite).toBe(false);
    expect(result.reason).toContain("未見歷史元素標記");
  });

  it("沒有提供教材原文時仍可檢查年份及詞尾標記", () => {
    expect(checkHistoricalAnswer("英國").ok).toBe(true);
    expect(checkHistoricalAnswer("1517年").ok).toBe(true);
    expect(checkHistoricalAnswer("背景").definite).toBe(true);
  });
});
