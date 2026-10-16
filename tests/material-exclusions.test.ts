import { describe, expect, it } from "vitest";

import { filterExcludedBlocks } from "@/server/materials/exclusions";

/**
 * 不考核內容（課題1 的三個古文明）的排除規則。
 *
 * 這些測試鎖定 2026-10 教材更新時修正的兩個行為：
 *   1. 教材把所有標題排成同一層級時，略過範圍必須在同層標題結束，不可延伸到文件結尾。
 *   2. 屬排除範圍的標題若已是最後一個標題，只略過標題本身，其餘段落交由逐段詞語比對；
 *      否則文件其餘全部內容（包括考核範圍的古埃及資料）會被一併略過。
 *   3. 含不考核內容的表格一律整段略過：只刪除命中詞語的列，會令同一列內其他不考核文明
 *      的內容（比較表以欄代表各文明）仍然寫入資料庫。
 */

interface TestBlock {
  type: string;
  level: number | null;
  text: string;
  table?: { text: string }[][];
}

const block = (type: string, text: string, level: number | null = null): TestBlock => ({
  type,
  text,
  level,
});

describe("不考核內容的排除規則（課題1）", () => {
  it("同層標題會結束略過範圍，其後考核範圍的內容仍會保留", () => {
    const blocks: TestBlock[] = [
      block("heading", "新石器時代", 3),
      block("list", "農耕社會出現，開始定居"),
      block("heading", "不同地區的舊石器時代人類", 3),
      block("list", "德馬尼西人（直立人）"),
      block("heading", "歷史技能：認識計時紀年", 3),
      block("list", "公元紀年、伊斯蘭教紀年、年號紀年"),
    ];

    const result = filterExcludedBlocks(blocks, "topic-1");

    expect(result.kept.map((entry) => entry.text)).toEqual([
      "新石器時代",
      "農耕社會出現，開始定居",
      "歷史技能：認識計時紀年",
      "公元紀年、伊斯蘭教紀年、年號紀年",
    ]);
    expect(result.skipped).toBe(2);
  });

  it("排除標題若是最後一個標題，不會把文件其餘內容一併略過", () => {
    const blocks: TestBlock[] = [
      block("heading", "黃河、長江流域文明：商朝文明", 3),
      block("list", "那爾邁：上埃及王國的國王，建立了埃及第一個統一王朝。"),
      block("list", "奧西烈斯：古埃及掌管生命及陰間的神祇。"),
      block("list", "古巴比倫帝國君主，制定了《漢模拉比法典》。"),
    ];

    const result = filterExcludedBlocks(blocks, "topic-1");

    expect(result.kept.map((entry) => entry.text)).toEqual([
      "那爾邁：上埃及王國的國王，建立了埃及第一個統一王朝。",
      "奧西烈斯：古埃及掌管生命及陰間的神祇。",
    ]);
    expect(result.skipped).toBe(2);
  });

  it("含不考核內容的表格整段略過，不會只刪除部分列", () => {
    const comparison = [
      [{ text: "文明的起始與終結" }, { text: "約公元前3500年至公元前539年" }, { text: "約公元前3500年至公元前30年" }],
      [{ text: "文明特徵三：宗教信仰" }, { text: "祭祀多神" }, { text: "祭祀多神" }],
    ];
    const blocks: TestBlock[] = [
      block("heading", "四大古代文明的特徵", 3),
      { type: "table", level: null, text: "新月沃土 | 尼羅河流域", table: comparison },
      block("heading", "總結：古與今：人類相同的基本需要", 3),
    ];

    const result = filterExcludedBlocks(blocks, "topic-1");

    expect(result.kept.map((entry) => entry.text)).toEqual([
      "四大古代文明的特徵",
      "總結：古與今：人類相同的基本需要",
    ]);
    expect(result.skipped).toBe(1);
  });

  it("其他課題不受課題1 的排除規則影響", () => {
    const blocks: TestBlock[] = [
      block("heading", "秦朝的統一", 3),
      block("list", "公元前221年，秦統一中國。"),
    ];

    const result = filterExcludedBlocks(blocks, "topic-9");

    expect(result.kept).toHaveLength(2);
    expect(result.skipped).toBe(0);
  });
});
