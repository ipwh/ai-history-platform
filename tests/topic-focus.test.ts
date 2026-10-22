/**
 * 主題分配規則（把過粗的主題按時期拆分）的單元測試。
 *
 * 背景：練習設定頁的「主題」＝課題下的分節。部分課題只有一個分節包含整段課程，
 * 學生無法集中複習其中一段（2026-10-22 用家回報課題9）。這裡鎖定：
 *   1. 分類只按方案內的關鍵詞，且多個主題同分時不猜測；
 *   2. 跨時期題目留在「綜合」；
 *   3. 優先主題（種族滅絕）命中即歸入；
 *   4. 教材段落會沿用同一文件內前一段的主題，但不會跨文件；
 *   5. 每個方案的結構完整（唯一 ID、來源分節屬方案、關鍵詞不為空）。
 */
import { describe, expect, it } from "vitest";

import {
  assignFocusByDocumentOrder,
  classifyFocusText,
  classifyQuestionFocus,
  focusTargetFor,
  TOPIC_FOCUS_PLANS,
  type TopicFocusPlan,
} from "@/server/quality/topic-focus";

const PLAN_NINE = TOPIC_FOCUS_PLANS["topic-9"]!;

describe("課題9：時期分類", () => {
  it("第一次世界大戰的背景及戰事歸入一戰", () => {
    expect(
      classifyQuestionFocus(
        { question: "在1871年普法戰爭後，法國希望報復德國並收復失地。" },
        PLAN_NINE,
      ).key,
    ).toBe("ww1");
    expect(
      classifyQuestionFocus({ question: "1916年，德軍與法軍在凡爾登一帶激戰。" }, PLAN_NINE).key,
    ).toBe("ww1");
  });

  it("巴黎和會、經濟大衰退及極權擴張歸入兩次大戰之間", () => {
    expect(
      classifyQuestionFocus({ question: "巴黎和會的三巨頭包括威爾遜、克里孟梭與誰？" }, PLAN_NINE).key,
    ).toBe("interwar");
    expect(
      classifyQuestionFocus({ question: "1929年股票市場崩潰，美國經濟陷入蕭條。" }, PLAN_NINE).key,
    ).toBe("interwar");
    expect(
      classifyQuestionFocus({ question: "希特拉上台後，納粹德國逐步擴張軍備。" }, PLAN_NINE).key,
    ).toBe("interwar");
  });

  it("珍珠港及諾曼第歸入第二次世界大戰", () => {
    expect(
      classifyQuestionFocus({ question: "1941年，日軍偷襲珍珠港，美國對日本宣戰。" }, PLAN_NINE).key,
    ).toBe("ww2");
    expect(
      classifyQuestionFocus({ question: "1944年盟軍在諾曼第登陸，開闢歐洲第二戰場。" }, PLAN_NINE).key,
    ).toBe("ww2");
  });

  it("涉及猶太大屠殺的題目即使提到二戰亦一律歸入種族滅絕", () => {
    expect(
      classifyQuestionFocus(
        { question: "納粹德國於1941年開始大規模屠殺猶太人。" },
        PLAN_NINE,
      ).key,
    ).toBe("holocaust");
  });

  it("同時提到兩次大戰的題目留在綜合主題", () => {
    const result = classifyQuestionFocus(
      { question: "第二次世界大戰往往被視為第一次世界大戰的＿＿＿。" },
      PLAN_NINE,
    );
    expect(result.key).toBeNull();
    expect(result.ambiguous).toBe(true);
  });

  it("同時命中多個時期而分數相同時不猜測", () => {
    const result = classifyQuestionFocus(
      { question: "1940年，德、意、日三國締結《三國同盟》，組成軸心同盟。" },
      PLAN_NINE,
    );
    expect(result.key).toBeNull();
    expect(result.ambiguous).toBe(true);
  });

  it("沒有任何關鍵詞的題目留在綜合主題，但不標示為歧義", () => {
    const result = classifyQuestionFocus({ question: "以下哪一項是文字紀錄？" }, PLAN_NINE);
    expect(result.key).toBeNull();
    expect(result.ambiguous).toBe(false);
  });
});

describe("課題5：文藝復興與宗教改革", () => {
  const plan = TOPIC_FOCUS_PLANS["topic-5"]!;

  it("文藝復興與人文主義相關題目歸入文藝復興", () => {
    expect(
      classifyQuestionFocus({ question: "文藝復興時期的人文主義者重視個人的價值。" }, plan).key,
    ).toBe("renaissance");
    expect(
      classifyQuestionFocus({ question: "達文西和米開朗基羅是文藝復興的代表人物。" }, plan).key,
    ).toBe("renaissance");
  });

  it("馬丁路德及新教相關題目歸入宗教改革", () => {
    expect(
      classifyQuestionFocus({ question: "馬丁路德發表《九十五條論綱》，反對售賣贖罪券。" }, plan).key,
    ).toBe("reformation");
    expect(
      classifyQuestionFocus({ question: "加爾文在日內瓦推行宗教改革。" }, plan).key,
    ).toBe("reformation");
  });

  it("同時涉及兩者而分數相同時留在綜合主題", () => {
    const result = classifyQuestionFocus(
      { question: "文藝復興和宗教改革有甚麼分別？" },
      plan,
    );
    expect(result.key).toBeNull();
    expect(result.ambiguous).toBe(true);
  });
});

describe("課題10：冷戰的三個階段", () => {
  const plan = TOPIC_FOCUS_PLANS["topic-10"]!;

  it("鐵幕、馬歇爾計劃、柏林封鎖歸入初期對抗", () => {
    expect(
      classifyQuestionFocus({ question: "1946年邱吉爾發表「鐵幕」演說。" }, plan).key,
    ).toBe("early");
    expect(
      classifyQuestionFocus({ question: "1948年柏林封鎖期間，西方國家以空運供應物資。" }, plan).key,
    ).toBe("early");
  });

  it("古巴導彈危機、越戰及緩和歸入中間階段", () => {
    expect(
      classifyQuestionFocus({ question: "1962年古巴導彈危機一度將世界推向核戰邊緣。" }, plan).key,
    ).toBe("middle");
    expect(
      classifyQuestionFocus({ question: "1971年乒乓外交推動中美關係緩和。" }, plan).key,
    ).toBe("middle");
  });

  it("蘇聯入侵阿富汗及星戰計劃歸入再度加劇", () => {
    expect(
      classifyQuestionFocus({ question: "1979年蘇聯入侵阿富汗，美蘇關係再度緊張。" }, plan).key,
    ).toBe("late");
  });
});

describe("教材段落分類：同一文件內沿用上文主題", () => {
  it("沒有關鍵詞的段落沿用前一段的主題，但不跨越文件", () => {
    const assignments = assignFocusByDocumentOrder(
      [
        { id: "b1", documentId: "doc-note", text: "1914年，塞拉耶佛事件成為第一次世界大戰的導火線。", sortOrder: 0 },
        { id: "b2", documentId: "doc-note", text: "大戰的結果", sortOrder: 1 },
        { id: "b3", documentId: "doc-note", text: "巴黎和會於1919年召開，簽訂《凡爾賽條約》。", sortOrder: 2 },
        { id: "b4", documentId: "doc-quiz", text: "大戰的結果", sortOrder: 0 },
      ],
      PLAN_NINE,
    );

    const byId = new Map(assignments.map((item) => [item.id, item]));
    expect(byId.get("b1")!.key).toBe("ww1");
    expect(byId.get("b2")!.key).toBe("ww1");
    expect(byId.get("b2")!.inherited).toBe(true);
    expect(byId.get("b3")!.key).toBe("interwar");
    // 另一份文件的段落不可沿用上一份文件（否則會跨文件污染）
    expect(byId.get("b4")!.key).toBeNull();
    expect(byId.get("b4")!.inherited).toBe(false);
  });

  it("歧義段落不會沿用，也不會影響後續段落", () => {
    const assignments = assignFocusByDocumentOrder(
      [
        { id: "b1", documentId: "doc", text: "1939年德國入侵波蘭，第二次世界大戰爆發。", sortOrder: 0 },
        { id: "b2", documentId: "doc", text: "一戰與二戰的比較", sortOrder: 1 },
        { id: "b3", documentId: "doc", text: "戰後的國際秩序", sortOrder: 2 },
      ],
      PLAN_NINE,
    );
    const byId = new Map(assignments.map((item) => [item.id, item]));
    expect(byId.get("b2")!.key).toBeNull();
    expect(byId.get("b2")!.ambiguous).toBe(true);
    expect(byId.get("b3")!.key).toBe("ww2");
  });
});

describe("主題分配方案的結構", () => {
  it("每個方案都有唯一的主題鍵及分節 ID", () => {
    for (const [topicId, plan] of Object.entries(TOPIC_FOCUS_PLANS)) {
      const keys = plan.targets.map((target) => target.key);
      const ids = plan.targets.map((target) => target.id);
      expect(new Set(keys).size, topicId).toBe(keys.length);
      expect(new Set(ids).size, topicId).toBe(ids.length);
    }
  });

  it("來源分節及綜合主題都存在於方案內", () => {
    for (const [topicId, plan] of Object.entries(TOPIC_FOCUS_PLANS)) {
      const ids = plan.targets.map((target) => target.id);
      const keys = plan.targets.map((target) => target.key);
      expect(ids, topicId).toContain(plan.sourceSectionId);
      expect(keys, topicId).toContain(plan.overviewKey);
      const overview = focusTargetFor(plan, null);
      expect(overview.key, topicId).toBe(plan.overviewKey);
    }
  });

  it("可分類的主題都有足夠的比對關鍵詞，綜合主題則沒有", () => {
    for (const [topicId, plan] of Object.entries(TOPIC_FOCUS_PLANS)) {
      for (const target of plan.targets) {
        if (target.key === plan.overviewKey) {
          expect(target.classifyKeywords, `${topicId}/${target.key}`).toHaveLength(0);
        } else {
          expect(target.classifyKeywords.length, `${topicId}/${target.key}`).toBeGreaterThan(2);
        }
        expect(target.matchKeywords.length, `${topicId}/${target.key}`).toBeGreaterThan(1);
        expect(target.title.length, `${topicId}/${target.key}`).toBeGreaterThan(4);
        expect(Number.isInteger(target.sortOrder), `${topicId}/${target.key}`).toBe(true);
      }
    }
  });

  it("方案內的關鍵詞不會令同一段文字同時命中所有主題", () => {
    const plan: TopicFocusPlan = PLAN_NINE;
    const result = classifyFocusText("文藝復興時期的藝術發展。", plan);
    expect(result.key).toBeNull();
  });
});
