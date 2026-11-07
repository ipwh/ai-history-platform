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
  findLooseHistoryTerms,
  historyAnswersMatch,
  historyTermAliases,
  normalizeHistoryAnswer,
} from "@/lib/history-lexicon";
import { detectTermMismatches } from "@/server/services/tutor-grounding";

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
    expect(normalizeHistoryAnswer("文艺复兴")).toBe("文藝復興");
  });

  it("2026-11-02：常見簡體虛詞亦已收錄（不再出現半繁半簡）", () => {
    // 之前「什么」「与」「两」未收錄，令整句只轉換一半，疑問詞及檢索詞對不上教材
    expect(normalizeHistoryAnswer("冷战为什么会结束")).toBe("冷戰為什麼會結束");
    expect(normalizeHistoryAnswer("战争与和平")).toBe("戰爭與和平");
    expect(normalizeHistoryAnswer("两德统一")).toBe("兩德統一");
    expect(normalizeHistoryAnswer("工业革命对英国有什么影响")).toBe("工業革命對英國有什麼影響");
  });

  it("常見簡體歷史詞彙可反查至課程慣用詞", () => {
    const terms: Array<[string, string]> = [
      ["文艺复兴", "文藝復興"],
      ["人文主义", "人文主義"],
      ["启蒙运动", "啟蒙運動"],
      ["殖民主义", "殖民主義"],
      ["帝国主义", "帝國主義"],
      ["第一次鸦片战争", "鴉片戰爭"],
      ["南京条约", "南京條約"],
      ["第一次世界大战", "第一次世界大戰"],
      ["第二次世界大战", "第二次世界大戰"],
      ["极权主义", "極權主義"],
      ["法西斯主义", "法西斯主義"],
      ["纳粹主义", "納粹主義"],
      ["资本主义", "資本主義"],
      ["社会主义", "社會主義"],
      ["共产主义", "共產主義"],
      ["新民主主义", "新民主主義"],
      ["八国联军", "八國聯軍"],
      ["义和团运动", "義和團運動"],
      ["大跃进", "大躍進"],
      ["改革开放", "改革開放"],
      ["五四运动", "五四運動"],
      ["新文化运动", "新文化運動"],
      ["抗日战争", "抗日戰爭"],
      ["国共内战", "國共內戰"],
      ["君主立宪制", "君主立憲制"],
    ];

    for (const [simplified, traditional] of terms) {
      expect(canonicalHistoryTerm(simplified), simplified).toBe(traditional);
    }
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

  it("開埠以課本寫法「英國侵佔香港」為準（2026-11-02）", () => {
    expect(canonicalHistoryTerm("開埠")).toBe("英國侵佔香港");
    expect(canonicalHistoryTerm("香港開埠")).toBe("英國侵佔香港");
    expect(historyAnswersMatch("香港開埠", "英國侵佔香港")).toBe(true);
  });

  it("學生與教材常見的同義問法可反查課本寫法（2026-11-02）", () => {
    // 教材寫「美國革命」，學生多寫「美國獨立革命」
    expect(canonicalHistoryTerm("美國獨立革命")).toBe("美國革命");
    // 教材分節寫「四大古代文明」，學生慣說「四大古文明」
    expect(canonicalHistoryTerm("四大古文明")).toBe("四大古代文明");
    expect(canonicalHistoryTerm("大河文明")).toBe("四大古代文明");
    // 教材寫「侵佔香港」，學生多寫「佔領香港」
    expect(canonicalHistoryTerm("佔領香港")).toBe("英國侵佔香港");
    // 教材寫「新界本地人五大姓族」，學生問「新界五大姓族」
    expect(canonicalHistoryTerm("新界五大姓族")).toBe("新界五大族");
    // 2 字課程專名亦要認得，否則短問句只得 1–2 分，取不到教材
    expect(canonicalHistoryTerm("五功")).toBe("五功");
    expect(canonicalHistoryTerm("保護國")).toBe("保護國");
  });

  it("可列出某一專名的所有可接受寫法", () => {
    const aliases = historyTermAliases("第一次世界大戰");
    expect(aliases).toContain("一戰");
    expect(aliases).toContain("wwi");
    expect(aliases).toContain("第一次世界大戰");
  });
});

describe("錯別字容錯（只用於檢索及主題判斷，不用於批改）", () => {
  it("錯一個字的專名可對應回課程寫法", () => {
    expect(findLooseHistoryTerms(normalizeHistoryAnswer("凡爾塞條約對德國有咩影響"))).toContain(
      "凡爾賽條約",
    );
    expect(findLooseHistoryTerms(normalizeHistoryAnswer("文藝復與有咩代表人物"))).toContain("文藝復興");
    expect(findLooseHistoryTerms(normalizeHistoryAnswer("希特立係點樣上台"))).toContain("希特拉");
    expect(findLooseHistoryTerms(normalizeHistoryAnswer("明治為新對日本有咩影響"))).toContain(
      "明治維新",
    );
    expect(findLooseHistoryTerms(normalizeHistoryAnswer("馬些爾計劃係咩"))).toContain("馬歇爾計劃");
  });

  it("數字不同不會互相誤配（一戰／二戰）", () => {
    // 「第二次世界大戰」逐字命中，不會被模糊比對成「第一次世界大戰」
    expect(findLooseHistoryTerms(normalizeHistoryAnswer("第二次世界大戰的成因"))).not.toContain(
      "第一次世界大戰",
    );
    expect(findLooseHistoryTerms(normalizeHistoryAnswer("第二次世界大戰的成因"))).not.toContain(
      "第二次世界大戰",
    );
  });

  it("相差多於一個字或太短的詞不會誤配", () => {
    expect(findLooseHistoryTerms(normalizeHistoryAnswer("凡爾條約"))).toEqual([]);
    expect(findLooseHistoryTerms(normalizeHistoryAnswer("美國革命"))).toEqual([]);
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

describe("課程慣用寫法必須與教材一致（Sprint 34）", () => {
  /**
   * 背景：`canonical` 會經 `buildTutorGlossary` 進入學伴提示詞，模型因此會用「課程
   * 慣用寫法」作答。Sprint 33 的真實輸出把「戈巴卓夫」寫成「戈巴契夫」——因為詞庫把
   * 後者當成 canonical，而教材 80 段、題庫 39 題全部用前者。學生對照課本時找不到。
   */
  it("戈巴卓夫的 canonical 是教材寫法，另一譯名仍是別名（答案比對等價）", () => {
    expect(canonicalHistoryTerm("戈巴契夫")).toBe("戈巴卓夫");
    expect(canonicalHistoryTerm("戈巴卓夫")).toBe("戈巴卓夫");
    expect(canonicalHistoryTerm("戈爾巴喬夫")).toBe("戈巴卓夫");
    expect(historyAnswersMatch("戈巴契夫", "戈巴卓夫")).toBe(true);
    expect(historyAnswersMatch("戈巴卓夫", "戈巴卓夫")).toBe(true);
  });

  it("使用非教材寫法時會被標示為用語不一致（提示學生對照課本）", () => {
    const notes = detectTermMismatches("戈巴契夫推行經濟重組與政治開放。");
    expect(notes.map((note) => note.canonical)).toContain("戈巴卓夫");
    expect(notes.find((note) => note.canonical === "戈巴卓夫")?.used).toBe("戈巴契夫");
  });
});
