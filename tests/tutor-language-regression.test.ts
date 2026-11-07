/**
 * 語言及意圖回歸（規格 3.3、3.4、3.6、3.7、3.11、3.12）。
 *
 * 這些規則決定「這條問題要用幾深回答」以及「是否要先澄清」。它們全部是字面判斷
 * （零額外模型請求），所以任何改動都必須有清單式回歸測試——否則很容易為了令某一條
 * 提問過關而把另一類提問判錯（例如把因果題當成評價題）。
 */
import { describe, expect, it } from "vitest";

import { extractQueryTerms } from "@/server/services/tutor-grounding";
import { isUnclearTutorQuery } from "@/server/services/tutor-query";
import { resolveTutorReplyDepth } from "@/server/services/tutor-depth";

const EMPTY_CURRICULUM = {
  topics: [] as { id: string; title: string }[],
  sectionsByTopic: new Map<string, { id: string; title: string; matchKeywords: string[] }[]>(),
};

describe("中文評價題識別（規格 3.3）", () => {
  const evaluative = [
    "你同意嗎？",
    "你認為美國革命只是一場精英運動嗎？",
    "你贊成嗎？",
    "這個政策是否值得？",
    "明治維新是否重要？",
    "美國革命是否成功？",
    "在多大程度上美國革命是經濟因素造成？",
    "你會如何評價美國革命？",
    "是否應該視為一場革命？",
    "經濟因素是否最重要的原因？",
    "美國革命與法國大革命哪一個影響較大？",
  ];

  it("評價問法一律使用挑戰深度", () => {
    for (const query of evaluative) {
      expect(resolveTutorReplyDepth("auto", query), query).toBe("challenge");
    }
  });

  it("句中有「同意」但不是疑問語境，不會被當成評價題", () => {
    // 「不同意」是陳述原因，不是要求評價
    expect(resolveTutorReplyDepth("auto", "英國為何不同意殖民地自治？")).toBe("advanced");
    // 「是否正確」是核對前提，不是評價
    expect(resolveTutorReplyDepth("auto", "明治天皇在 1912 年才開始改革，是否正確？")).toBe(
      "advanced",
    );
  });
});

describe("中文因果及程度問題（規格 3.4）", () => {
  const causal = [
    "為何造成美國革命？",
    "美國革命有多大影響？",
    "茶稅是否導致美國革命？",
    "茶稅是否直接引致美國革命？",
    "兩者有何因果關係？",
    "為什麼會出現美國革命？",
    "經濟因素是主要原因嗎？",
  ];

  it("因果解釋使用進階深度", () => {
    for (const query of causal) {
      expect(resolveTutorReplyDepth("auto", query), query).toBe("advanced");
    }
  });

  it("「在多大程度上」屬程度判斷，使用挑戰深度", () => {
    expect(resolveTutorReplyDepth("auto", "加稅在多大程度上導致美國革命？")).toBe("challenge");
    expect(resolveTutorReplyDepth("auto", "英國政策在多大程度上促成美國革命？")).toBe(
      "challenge",
    );
  });

  it("單純事件描述不會被當成因果或評價題", () => {
    expect(resolveTutorReplyDepth("auto", "波士頓傾茶事件係咩事？")).toBe("standard");
  });
});

describe("英文深度識別（規格 3.6）", () => {
  const expectations: [string, "standard" | "advanced" | "challenge"][] = [
    ["Who was George Washington?", "standard"],
    ["Who were the Founding Fathers?", "standard"],
    ["What was the Stamp Act?", "standard"],
    ["What were the Intolerable Acts?", "standard"],
    ["When did the American Revolution begin?", "standard"],
    ["Why did the American Revolution happen?", "advanced"],
    ["Why was the Stamp Act unpopular?", "advanced"],
    ["How did Britain respond to the American Revolution?", "advanced"],
    ["How was the Declaration of Independence written?", "advanced"],
    ["What were the causes of the American Revolution?", "advanced"],
    ["What caused the American Revolution?", "advanced"],
    ["What were the consequences of the American Revolution?", "advanced"],
    ["Compare the Stamp Act and the Townshend Acts.", "advanced"],
    ["To what extent was the American Revolution economic?", "challenge"],
    ["How significant was the Boston Tea Party?", "challenge"],
    ["How important was the French alliance?", "challenge"],
    ["Do you agree that it was a revolution?", "challenge"],
    ["Do you think the British were to blame?", "challenge"],
    ["Was it mainly because of taxation?", "challenge"],
    ["Evaluate the significance of the Stamp Act.", "challenge"],
    ["Assess the impact of the Boston Tea Party.", "challenge"],
  ];

  it("英文句式按認知層級判斷深度", () => {
    for (const [query, depth] of expectations) {
      expect(resolveTutorReplyDepth("auto", query), query).toBe(depth);
    }
  });

  it("英文在原文比對（正規化會令單字黏合，不可用中文規則判斷）", () => {
    // 若先經中文正規化，"to what extent" 會變成 "towhatextent"，只看字面仍可，
    // 但 "Do you think" 之類的句式會因為失去詞界而判斷不到。
    expect(resolveTutorReplyDepth("auto", "Do you think the British were to blame?")).toBe(
      "challenge",
    );
  });
});

describe("英文疑問詞與別名衝突（規格 3.7）", () => {
  const interrogatives = ["who", "what", "when", "where", "why", "how", "which"];

  it("英文疑問詞不會成為正文檢索詞", () => {
    for (const word of interrogatives) {
      const terms = extractQueryTerms(`Who was ${word}?`);
      expect(
        terms.some((term) => term.term === word),
        word,
      ).toBe(false);
    }
  });

  it("`who` 不會被當成世界衛生組織（WHO）", () => {
    const terms = extractQueryTerms("Who was George Washington?");
    expect(terms.some((term) => term.term === "世界衛生組織")).toBe(false);
    expect(terms.some((term) => term.term === "who")).toBe(false);
  });

  it("英文疑問詞仍可透過其他寫法命中正確的人物（不靠刪除全部重疊詞）", () => {
    const terms = extractQueryTerms("Who was George Washington?");
    expect(terms.some((term) => term.term === "華盛頓")).toBe(true);
  });
});

describe("中文核對式提問（規格 3.12）", () => {
  const verification = [
    "美國革命係1776年開始，對唔對？",
    "日本在 1942 年開始太平洋戰爭，對嗎？",
    "明治天皇在 1912 年才開始改革，是否正確？",
    "係咪1941年？",
    "我理解得啱唔啱？",
    "有冇記錯？",
    "Am I right?",
    "Did I get this right?",
  ];

  it("核對式提問不會被當成含糊而要求重問", () => {
    for (const query of verification) {
      expect(isUnclearTutorQuery(query, EMPTY_CURRICULUM, false), query).toBe(false);
    }
  });

  it("真正含糊的提問仍然會要求澄清（沒有因為放寬而失效）", () => {
    // 這類句子有歷史訊號（年份），但內容詞完全是代詞 → 應澄清而不是猜。
    expect(isUnclearTutorQuery("1941年嗰啲嘢係點？", EMPTY_CURRICULUM, false)).toBe(true);
    expect(isUnclearTutorQuery("1919年那些事情", EMPTY_CURRICULUM, false)).toBe(true);
  });

  it("沒有年份的核對式提問只在已有對話時有效（不會令硬閘失效）", () => {
    // 這類句子本身沒有任何歷史錨點，單獨提出時應由硬閘處理；
    // 已有上文時由短追問規則放行（見 tutor-followup-regression）。
    expect(isUnclearTutorQuery("我理解得啱唔啱？", EMPTY_CURRICULUM, false)).toBe(false);
  });
});
