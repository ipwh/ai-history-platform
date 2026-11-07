/**
 * 課題範圍（topic scope）回歸（規格 3.10、3.17）。
 *
 * 規格要求：不可因為「高中」範疇橫跨五個課題，就把五個課題當成同等候選，最後以
 * 資料庫次序第一個作平手結果——那會令「What was the Meiji Restoration?」引用
 * 「香港的現代化與蛻變」的教材。這裡固定三件事：
 *   ① 有 `topicId` 指定的詞只提升該課題；
 *   ② 「高中」這種一對多範疇只在該課題**另有證據**時加分；
 *   ③ 比較題會同時檢索被點名的第二個課題，但不會無差別放大範圍。
 */
import { describe, expect, it } from "vitest";

import { ALL_CURRICULUM_TOPICS, flatSectionSeeds } from "@/server/seed/curriculum";
import { HISTORY_TERM_GROUPS } from "@/lib/history-lexicon";
import {
  extractQueryTerms,
  guessTutorTopic,
  matchesCurriculumTerms,
  supportingTopicIds,
  type TutorCurriculumIndex,
} from "@/server/services/tutor-grounding";

const topics = ALL_CURRICULUM_TOPICS.map((topic) => ({ id: topic.id, title: topic.title }));
const sectionsByTopic = new Map(
  ALL_CURRICULUM_TOPICS.map((topic) => [
    topic.id,
    flatSectionSeeds(topic.sections).map((section) => ({
      id: section.id,
      title: section.title,
      matchKeywords: section.matchKeywords,
    })),
  ]),
);
const curriculum: TutorCurriculumIndex = { topics, sectionsByTopic };

const guess = (query: string) => guessTutorTopic(query, topics, sectionsByTopic);

describe("指定課題的詞只提升該課題（規格 3.17）", () => {
  it("明治維新（高中詞，已指定課題）→ 日本的現代化與蛻變", () => {
    expect(guess("What was the Meiji Restoration?")?.topicId).toBe("hs-topic-3");
    expect(guess("明治維新是甚麼？")?.topicId).toBe("hs-topic-3");
  });

  it("不會因為「高中」範疇而引用香港的現代化", () => {
    const result = guess("What was the Meiji Restoration?");
    expect(result?.topicId).not.toBe("hs-topic-1");
    expect(result?.topicTitle).not.toContain("香港");
  });

  it("只在「高中」範疇出現的詞，沒有其他證據時不猜課題（不引用第一個高中課題）", () => {
    // 「法國大革命」屬高中範疇詞，句子本身沒有其他課題證據。
    expect(guess("French Revolutions")).toBeNull();
  });

  it("初中課題詞可以精確定位（課題7 美國的成立及發展）", () => {
    expect(guess("美國革命的背景是甚麼？")?.topicId).toBe("topic-7");
    expect(guess("What was the American Revolution?")?.topicId).toBe("topic-7");
  });

  it("「課題12」不會被當成「課題1」", () => {
    expect(guess("課題12 講甚麼？")?.topicId).toBe("topic-12");
  });
});

describe("課題推斷不會被錯別字誤配帶錯課題（規格 3.17）", () => {
  it("「開始」不會被當成錯別字「開埠」（課題8）", () => {
    const result = guess("明治天皇在 1912 年才開始改革，是否正確？");
    expect(result?.topicId).toBe("topic-6");
  });

  it("「改革」不會被當成錯別字「文革」", () => {
    const result = guess("明治天皇推動了哪些改革？");
    expect(result?.topicId).toBe("topic-6");
  });

  it("真正的錯別字專名仍然可定位（凡爾塞條約 → 課題9／高中課題4 的巴黎和會）", () => {
    const result = guess("凡爾塞條約對德國有咩影響？");
    expect(result).not.toBeNull();
    expect(["topic-9", "hs-topic-4"]).toContain(result?.topicId);
  });
});

describe("跨課題比較會一併檢索被點名的課題（規格 3.17）", () => {
  it("美國革命與法國大革命比較：主課題是課題7，並加入課題5", () => {
    const message = "美國革命與法國大革命有甚麼分別？";
    const primary = guess(message);
    expect(primary?.topicId).toBe("topic-7");
    const supporting = supportingTopicIds(message, "topic-7", curriculum);
    expect(supporting).toContain("topic-5");
  });

  it("單一課題提問不會無故加入其他課題", () => {
    expect(supportingTopicIds("美國革命有甚麼影響？", "topic-7", curriculum)).toEqual([]);
  });

  it("最多只加入兩個額外課題（避免一次送入大量原文）", () => {
    const message = "比較美國革命、法國大革命、明治維新與俄國革命。";
    expect(supportingTopicIds(message, "topic-7", curriculum).length).toBeLessThanOrEqual(2);
  });

  it("沒有明確證據的課題不會被加入（不會引用完全無關的教材）", () => {
    const supporting = supportingTopicIds("美國革命有甚麼影響？", "topic-7", curriculum);
    expect(supporting).not.toContain("hs-topic-1");
    expect(supporting).not.toContain("topic-12");
  });

  it("比較兩個制度或政策時，同樣檢索兩方課題", () => {
    const query = "比較雅典民主政治與極權主義的政治制度";
    const primary = guess(query);
    expect(["topic-2", "topic-9"]).toContain(primary?.topicId);
    const supporting = supportingTopicIds(query, primary?.topicId ?? "", curriculum);
    expect(supporting).toContain(primary?.topicId === "topic-2" ? "topic-9" : "topic-2");
  });

  it("比較題以代詞指回上文時，沿用上文明確提到的第二課題", () => {
    const previousQuestion = "美國革命與法國大革命有哪些關係？";
    expect(
      supportingTopicIds("比較兩者的異同", "topic-7", curriculum, [previousQuestion]),
    ).toContain("topic-5");
  });

  it("單課題後續提問不會只因上文提過另一課題而擴大檢索", () => {
    expect(
      supportingTopicIds("美國革命有甚麼影響？", "topic-7", curriculum, ["法國大革命"]),
    ).toEqual([]);
  });
});

describe("詞庫新增項目的契約（規格 3.5、3.10、3.15、3.16）", () => {
  const REQUIRED: { canonical: string; scope: string; english: string }[] = [
    { canonical: "波士頓傾茶事件", scope: "課題7", english: "boston tea party" },
    { canonical: "不可容忍的法案", scope: "課題7", english: "intolerable acts" },
    { canonical: "第一次大陸會議", scope: "課題7", english: "continental congress" },
    { canonical: "列克星頓及康科特戰事", scope: "課題7", english: "lexington" },
    { canonical: "美國革命", scope: "課題7", english: "american revolution" },
    { canonical: "印花稅法", scope: "課題7", english: "stamp act" },
    { canonical: "美國獨立宣言", scope: "課題7", english: "declaration of independence" },
    { canonical: "絲綢之路", scope: "課題3", english: "silk road" },
    { canonical: "活字印刷術", scope: "課題5", english: "printing press" },
    { canonical: "明治維新", scope: "高中", english: "meiji restoration" },
    { canonical: "明治天皇", scope: "課題6", english: "emperor meiji" },
  ];

  it("每一組都有課題範圍及英文別名（不可只加中文或只加英文）", () => {
    for (const entry of REQUIRED) {
      const group = HISTORY_TERM_GROUPS.find((item) => item.canonical === entry.canonical);
      expect(group, entry.canonical).toBeDefined();
      expect(group?.scope, entry.canonical).toBe(entry.scope);
      const aliases = (group?.aliases ?? []).map((alias) => alias.toLowerCase());
      expect(aliases, `${entry.canonical} 缺英文別名 ${entry.english}`).toContain(entry.english);
    }
  });

  it("新增別名不會污染其他課題（只在指定課題取得高分）", () => {
    // 「波士頓傾茶事件」只應提升課題7；不可令課題1／12 等同時取得課題證據。
    const query = "波士頓傾茶事件係咩事？";
    const primary = guess(query);
    expect(primary?.topicId).toBe("topic-7");
    expect(supportingTopicIds(query, "topic-7", curriculum)).toEqual([]);
  });

  it("相似但不同的人物不會互相混淆", () => {
    const hitler = extractQueryTerms("Who was Hitler?");
    const names = new Set(hitler.map((term) => term.term));
    expect(names.has("希特拉") || names.has("希特勒")).toBe(true);
    expect(names.has("華盛頓")).toBe(false);
    expect(names.has("林肯")).toBe(false);
  });
});

describe("課程用語硬閘與課題推斷保持一致（規格 3.17）", () => {
  it("課程用語可通過硬閘", () => {
    for (const query of ["極權主義有甚麼特點？", "明治維新是甚麼？", "文藝復興有甚麼特徵？"]) {
      expect(matchesCurriculumTerms(curriculum, query), query).toBe(true);
    }
  });

  it("非歷史科問題不可通過硬閘", () => {
    for (const query of ["幫我寫 Python", "今天天氣如何", "數學方程式怎樣解"]) {
      expect(matchesCurriculumTerms(curriculum, query), query).toBe(false);
    }
  });
});
