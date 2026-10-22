import { describe, expect, it } from "vitest";

import { mapBlocksToSections } from "@/server/materials/section-mapper";
import type { ParsedBlock } from "@/server/materials/types";
import type { Section } from "@/lib/types";

function block(text: string, index: number, type: ParsedBlock["type"] = "paragraph"): ParsedBlock {
  return { type, level: null, text, items: [], table: null, order: index, page: null };
}

const SECTIONS: Section[] = [
  {
    id: "s1",
    topicId: "t1",
    parentId: null,
    title: "文藝復興",
    summary: "",
    order: 0,
    matchKeywords: [],
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "s1a",
    topicId: "t1",
    parentId: "s1",
    title: "主要特點",
    summary: "",
    order: 0,
    matchKeywords: ["文藝復興的主要特點"],
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "s1b",
    topicId: "t1",
    parentId: "s1",
    title: "影響",
    summary: "",
    order: 1,
    matchKeywords: [],
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "s2",
    topicId: "t1",
    parentId: null,
    title: "宗教改革",
    summary: "",
    order: 1,
    matchKeywords: [],
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "s2a",
    topicId: "t1",
    parentId: "s2",
    title: "影響",
    summary: "",
    order: 0,
    matchKeywords: [],
    createdAt: "",
    updatedAt: "",
  },
];

describe("教材段落對應分節", () => {
  it("先以頂層分節切段，再在區段內對應子分節", () => {
    const blocks = [
      block("課題5 近代歐洲的興起", 0),
      block("文藝復興（十四至十七世紀）", 1, "heading"),
      block("歐洲的一場文化與思想革新運動", 2, "list"),
      block("主要特點", 3, "heading"),
      block("復興古希臘、羅馬文明", 4, "list"),
      block("影響", 5, "heading"),
      block("奠定近代歐洲文明的基礎", 6, "list"),
      block("宗教改革（十六至十七世紀）", 7, "heading"),
      block("影響", 8, "heading"),
      block("引發衝突與戰爭", 9, "list"),
    ];

    const result = mapBlocksToSections(blocks, SECTIONS);

    expect(result.sectionIds[0]).toBeNull();
    expect(result.sectionIds[1]).toBe("s1");
    expect(result.sectionIds[2]).toBe("s1");
    expect(result.sectionIds[3]).toBe("s1a");
    expect(result.sectionIds[4]).toBe("s1a");
    expect(result.sectionIds[5]).toBe("s1b");
    expect(result.sectionIds[7]).toBe("s2");
    expect(result.sectionIds[8]).toBe("s2a");
    expect(result.sectionIds[9]).toBe("s2a");
  });

  it("沒有分節時不會指派任何段落", () => {
    const result = mapBlocksToSections([block("內容", 0)], []);
    expect(result.sectionIds).toEqual([null]);
  });

  it("限定候選分節後，其他分節的標題不會搶走段落", () => {
    // 匯入時若課程種子聲明某份教材只屬於指定分節（見 declaredSectionsForFile），
    // import-service 只會傳入該範圍，避免「文藝復興」等字眼令宗教改革的筆記
    // 被歸入文藝復興的分節。
    const blocks = [
      block("文藝復興", 0, "heading"),
      block("宗教改革", 1, "heading"),
      block("引發衝突與戰爭", 2, "list"),
    ];

    const unrestricted = mapBlocksToSections(blocks, SECTIONS);
    expect(unrestricted.sectionIds[0]).toBe("s1");

    const scoped = mapBlocksToSections(
      blocks,
      SECTIONS.filter((section) => section.id === "s2" || section.id === "s2a"),
    );
    expect(scoped.sectionIds[0]).toBeNull();
    expect(scoped.sectionIds[1]).toBe("s2");
    expect(scoped.sectionIds[2]).toBe("s2");
  });

  it("子標題誤中其他分節的關鍵詞時，短區段會沿用前後分節", () => {
    // 實際個案（2026-10-21 學生回報）：法國大革命「革命的成因」之下有子標題
    // 「啟蒙運動的影響及美國革命的鼓舞」（清單段落，不是標題樣式），而
    // 「啟蒙運動」是科學革命與啟蒙運動分節的關鍵詞，令該段及其後數段被歸入
    // 科學革命分節，學生練習時就見到「美國革命對法國大革命的影響」這種與所選
    // 分節無關的題目。
    const sections: Section[] = [
      { ...SECTIONS[0], id: "french", title: "法國大革命", order: 2, matchKeywords: ["法國大革命", "革命的成因", "革命的經過"] },
      { ...SECTIONS[0], id: "science", title: "科學革命與啟蒙運動", order: 1, matchKeywords: ["科學革命", "啟蒙運動"] },
    ];
    const blocks = [
      block("法國大革命", 0),
      block("革命的成因", 1),
      block("十八世紀的法國社會仍存在嚴格的等級制度。", 2),
      block("美國革命的鼓舞", 3),
      block("啟蒙運動的影響及美國革命的鼓舞", 4, "list"),
      block("法國曾派兵支援美國革命，思想隨之傳入法國。", 5, "list"),
      block("革命的經過", 6),
      block("革命浪潮與統一運動的出現。", 7),
    ];

    const result = mapBlocksToSections(blocks, sections);
    // 沒有平滑處理時，第 4–5 段會被歸入 science；修正後應沿用 french
    expect(result.sectionIds.slice(0, 8)).toEqual([
      "french",
      "french",
      "french",
      "french",
      "french",
      "french",
      "french",
      "french",
    ]);
  });

  it("由標題觸發的短分節不會被平滑掉（單元標題可以只有標題及日期兩段）", () => {
    const sections: Section[] = [
      { ...SECTIONS[0], id: "renaissance", title: "文藝復興與宗教改革", order: 0, matchKeywords: ["文藝復興"] },
      { ...SECTIONS[0], id: "science", title: "科學革命與啟蒙運動", order: 1, matchKeywords: ["科學革命與啟蒙運動"] },
    ];
    const blocks = [
      block("文藝復興（十四至十七世紀）", 0, "heading"),
      block("宗教改革的背景與發展。", 1, "list"),
      block("科學革命與啟蒙運動", 2, "heading"),
      block("（十六世紀中葉至十八世紀）", 3, "heading"),
      block("文藝復興對科學發展的推動。", 4, "list"),
    ];
    const result = mapBlocksToSections(blocks, sections);
    expect(result.sectionIds[2]).toBe("science");
    expect(result.sectionIds[3]).toBe("science");
  });

  it("夾在兩個不同分節之間的短區段不會被改寫", () => {
    const sections: Section[] = [
      { ...SECTIONS[0], id: "a", title: "甲分節", order: 0, matchKeywords: ["甲分節"] },
      { ...SECTIONS[0], id: "b", title: "乙分節", order: 1, matchKeywords: ["乙分節"] },
      { ...SECTIONS[0], id: "c", title: "丙分節", order: 2, matchKeywords: ["丙分節"] },
    ];
    const blocks = [
      block("甲分節", 0),
      block("甲的內容。", 1),
      block("乙分節", 2),
      block("乙的內容。", 3),
      block("丙分節", 4),
      block("丙的內容。", 5),
    ];
    const result = mapBlocksToSections(blocks, sections);
    expect(result.sectionIds).toEqual(["a", "a", "b", "b", "c", "c"]);
  });
});
