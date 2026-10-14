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
});
