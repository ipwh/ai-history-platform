/**
 * 歷史科專名同義詞庫測試。
 *
 * 驗證重點：
 *   1. 標準化會處理空白、標點、全半形及簡體字。
 *   2. 同一專名的不同寫法（簡稱、舊譯名、英文、本地／外地譯名）判為相同。
 *   3. 名稱相近但指不同事物的**不會**判為相同（寧可交由教師覆核）。
 *   4. 詞庫內部沒有互相衝突的寫法（同一個寫法不可屬於兩組）。
 */
import { describe, expect, it } from "vitest";

import {
  HISTORY_TERM_GROUPS,
  canonicalHistoryTerm,
  historyAnswersMatch,
  historyTermAliases,
  normalizeHistoryAnswer,
} from "@/lib/history-lexicon";

describe("歷史答案標準化", () => {
  it("移除前後空白及標點", () => {
    expect(normalizeHistoryAnswer("  第一次世界大戰。 ")).toBe("第一次世界大戰");
    expect(normalizeHistoryAnswer("《南京條約》，1842年")).toBe("南京條約1842年");
    expect(normalizeHistoryAnswer("凡爾賽・條約")).toBe("凡爾賽條約");
  });

  it("全形字元轉為半形並忽略大小寫", () => {
    expect(normalizeHistoryAnswer("ＷＷＩＩ")).toBe("wwii");
    expect(normalizeHistoryAnswer("World War II")).toBe("worldwarii");
  });

  it("簡體字轉為繁體字", () => {
    expect(normalizeHistoryAnswer("第一次世界大战")).toBe("第一次世界大戰");
    expect(normalizeHistoryAnswer("凡尔赛条约")).toBe("凡爾賽條約");
    expect(normalizeHistoryAnswer("明治维新")).toBe("明治維新");
  });
});

describe("專名同義詞比對", () => {
  it("接受重大事件的簡稱及英文寫法", () => {
    expect(historyAnswersMatch("一戰", "第一次世界大戰")).toBe(true);
    expect(historyAnswersMatch("第一次世界大战", "第一次世界大戰")).toBe(true);
    expect(historyAnswersMatch("WWI", "第一次世界大戰")).toBe(true);
    expect(historyAnswersMatch("World War II", "第二次世界大戰")).toBe(true);
  });

  it("接受條約的舊譯名及英文寫法", () => {
    expect(historyAnswersMatch("江寧條約", "南京條約")).toBe(true);
    expect(historyAnswersMatch("凡爾賽和約", "凡爾賽條約")).toBe(true);
    expect(historyAnswersMatch("Treaty of Versailles", "凡爾賽條約")).toBe(true);
    expect(historyAnswersMatch("下關條約", "馬關條約")).toBe(true);
  });

  it("接受改革的別稱", () => {
    expect(historyAnswersMatch("明治變法", "明治維新")).toBe(true);
    expect(historyAnswersMatch("自強運動", "洋務運動")).toBe(true);
    expect(historyAnswersMatch("百日維新", "戊戌維新")).toBe(true);
  });

  it("接受歷史人物的本地／外地慣用譯名", () => {
    expect(historyAnswersMatch("希特拉", "希特勒")).toBe(true);
    expect(historyAnswersMatch("邱吉爾", "邱吉爾")).toBe(true);
    expect(historyAnswersMatch("丘吉爾", "邱吉爾")).toBe(true);
    expect(historyAnswersMatch("戈爾巴喬夫", "戈巴契夫")).toBe(true);
  });

  it("忽略空白、標點及全半形差異", () => {
    expect(historyAnswersMatch(" 凡爾賽 和約 。", "凡爾賽條約")).toBe(true);
    expect(historyAnswersMatch("ＷＷＩＩ", "第二次世界大戰")).toBe(true);
  });

  it("標準答案以「/」列出多個可接受寫法時逐一比對", () => {
    expect(historyAnswersMatch("信義宗", "路德宗 / 信義宗")).toBe(true);
    expect(historyAnswersMatch("加爾文宗", "路德宗 / 信義宗")).toBe(false);
  });

  it("名稱相近但指不同事物時不會判定為相同", () => {
    expect(historyAnswersMatch("第二次世界大戰", "第一次世界大戰")).toBe(false);
    expect(historyAnswersMatch("拿破崙戰爭", "拿破崙")).toBe(false);
    expect(historyAnswersMatch("封建", "封建制度")).toBe(false);
    expect(historyAnswersMatch("宗教改革", "反宗教改革")).toBe(false);
    expect(historyAnswersMatch("甲午戰爭", "日俄戰爭")).toBe(false);
  });

  it("空白答案一律不匹配", () => {
    expect(historyAnswersMatch("   ", "第一次世界大戰")).toBe(false);
    expect(historyAnswersMatch("。", "第一次世界大戰")).toBe(false);
  });

  it("同組的所有寫法都可反查回課程慣用寫法", () => {
    expect(canonicalHistoryTerm("一戰")).toBe("第一次世界大戰");
    expect(canonicalHistoryTerm("江寧條約")).toBe("南京條約");
    expect(canonicalHistoryTerm("完全不在詞庫的答案")).toBeNull();
  });

  it("可列出某一專名的所有可接受寫法", () => {
    const aliases = historyTermAliases("第一次世界大戰");
    expect(aliases).toContain("一戰");
    expect(aliases).toContain("wwi");
    expect(aliases).toContain("第一次世界大戰");
  });
});

describe("詞庫一致性", () => {
  it("同一個寫法不會同時屬於兩組（避免把不同專名判成相同）", () => {
    const owners = new Map<string, Set<string>>();
    for (const group of HISTORY_TERM_GROUPS) {
      for (const term of [group.canonical, ...group.aliases]) {
        const key = normalizeHistoryAnswer(term);
        if (key.length === 0) continue;
        const set = owners.get(key) ?? new Set<string>();
        set.add(group.canonical);
        owners.set(key, set);
      }
    }
    const collisions = [...owners.entries()]
      .filter(([, canonicals]) => canonicals.size > 1)
      .map(([term, canonicals]) => `${term} → ${[...canonicals].join(" / ")}`);
    expect(collisions).toEqual([]);
  });

  it("課程慣用寫法本身不會被其他組的別名蓋過", () => {
    for (const group of HISTORY_TERM_GROUPS) {
      expect(canonicalHistoryTerm(group.canonical), group.canonical).toBe(group.canonical);
    }
  });

  it("每組至少有一個別名，且不包含空白寫法", () => {
    for (const group of HISTORY_TERM_GROUPS) {
      expect(group.aliases.length, group.canonical).toBeGreaterThan(0);
      for (const term of [group.canonical, ...group.aliases]) {
        expect(normalizeHistoryAnswer(term).length, `${group.canonical}: ${term}`).toBeGreaterThan(0);
      }
    }
  });
});
