/**
 * 學伴檢索：兩字內容詞及通用詞加權（2026-11-13 學生模擬）。
 *
 * ── 模擬發現的兩個缺陷 ──────────────────────────────────────────────
 * ① 兩字內容詞（「貨幣」「割讓」「非洲」）權重只有 1，而選段要求至少一個「強詞」，
 *    於是教材明明有幾十段相關內容，回覆仍說「未找到教材依據」。單獨輸入「貨幣」
 *    （教材 62 段）、「民主」（169 段）、「割讓」（40 段）全部落空。
 * ② 「點解」的類別詞展開（成因／起因／因素）權重 20，高於課本專名的 8；這些詞在
 *    筆記中十分普遍（因素 57 段、成因 36 段），短標題式的「…的成因」因此壓過真正
 *    講該主題的段落。實測「國際聯盟點解失敗？」3 段來源只有 1 段提到國際聯盟；
 *    同一主題改問「國際聯盟失敗的原因」則 3 段全部相關。
 *
 * 這裡固定修正後的行為：兩字詞只在「罕見」且「屬提問關鍵詞」時才加權，通用詞的
 * 展開不得高於課本專名。需要真實教材的個案在沒有 `data/app.db` 時略過（CI）。
 */
import { describe, expect, it } from "vitest";

import { normalizeForMatch } from "@/server/materials/text-utils";
import {
  boostRareShortTerms,
  extractQueryTerms,
  findTutorGrounding,
  loadTutorCurriculumIndex,
} from "@/server/services/tutor-grounding";
import { normalizeTutorQuery } from "@/server/services/tutor-query";

const curriculum = loadTutorCurriculumIndex();
const hasContentDatabase = curriculum.topics.length > 0;

function ground(query: string, preferredTopicId?: string) {
  return findTutorGrounding(normalizeTutorQuery(query), [], curriculum, {
    maxSources: 3,
    preferredTopicId: preferredTopicId ?? null,
  });
}

describe("兩字內容詞加權（純函數）", () => {
  // 20 段教材：非洲 2 段（10%）、政府 12 段（60%）
  const blocks = Array.from({ length: 20 }, (_, index) =>
    index < 2
      ? "歐洲列強在非洲爭奪勢力範圍"
      : index < 14
        ? "政府推行多項政策"
        : "其他內容",
  );

  it("罕見的兩字詞會提升為強詞", () => {
    const boosted = boostRareShortTerms([{ term: "非洲", weight: 1 }], blocks);
    expect(boosted.find((term) => term.term === "非洲")?.weight).toBeGreaterThanOrEqual(2);
  });

  it("常見的兩字詞保持原權重", () => {
    const boosted = boostRareShortTerms([{ term: "政府", weight: 1 }], blocks);
    expect(boosted.find((term) => term.term === "政府")?.weight).toBe(1);
  });

  it("已是強詞或非兩字詞不受影響", () => {
    const terms = [
      { term: "非洲", weight: 5 },
      { term: "殖民主義", weight: 8 },
    ];
    expect(boostRareShortTerms(terms, blocks)).toEqual(terms);
  });

  it("已被詞庫長詞涵蓋的兩字詞不加權（「珍珠」之於「珍珠港」）", () => {
    const terms = [
      { term: "珍珠港", weight: 5 },
      { term: "珍珠", weight: 1 },
    ];
    const boosted = boostRareShortTerms(terms, ["珍珠港事件爆發", "其他內容"]);
    expect(boosted.find((term) => term.term === "珍珠")?.weight).toBe(1);
  });

  it("只加權提問的關鍵詞（白名單）", () => {
    const boosted = boostRareShortTerms(
      [{ term: "非洲", weight: 1 }],
      blocks,
      8,
      0.25,
      ["工業"],
    );
    expect(boosted.find((term) => term.term === "非洲")?.weight).toBe(1);
  });
});

describe("通用詞展開不得高於課本專名", () => {
  it("「國際聯盟點解失敗？」的主題詞權重高於「成因」", () => {
    const terms = extractQueryTerms(normalizeTutorQuery("國際聯盟點解失敗？"));
    const weightOf = (value: string): number =>
      terms.find((term) => term.term === value)?.weight ?? 0;
    expect(weightOf("國際聯盟")).toBeGreaterThan(weightOf("成因"));
    expect(weightOf("國際聯盟")).toBeGreaterThan(weightOf("因素"));
  });

  it("類別詞展開仍會生效（藝術家 → 藝術三傑）", () => {
    const terms = extractQueryTerms(normalizeTutorQuery("列出文藝復興時期的藝術家"));
    expect(terms.some((term) => term.term === "藝術三傑")).toBe(true);
  });
});

describe.skipIf(!hasContentDatabase)("真實教材：兩字詞及來源相關性", () => {
  it("「香港戰後點樣發展工業？」命中課題12（原本選不到任何段落）", () => {
    const grounding = ground("香港戰後點樣發展工業？");
    expect(grounding.status).toBe("grounded");
    expect(grounding.topicId).toBe("topic-12");
  });

  it("「殖民主義對非洲有咩影響？」命中課題6", () => {
    const grounding = ground("殖民主義對非洲有咩影響？");
    expect(grounding.status).toBe("grounded");
    expect(grounding.topicId).toBe("topic-6");
  });

  it("單獨輸入兩字主題詞亦可召回教材（貨幣）", () => {
    expect(ground("貨幣").status).toBe("grounded");
  });

  it("「國際聯盟點解失敗？」三段來源都提到國際聯盟", () => {
    const grounding = ground("國際聯盟點解失敗？");
    expect(grounding.status).toBe("grounded");
    expect(grounding.passages.length).toBeGreaterThan(0);
    for (const passage of grounding.passages) {
      expect(normalizeForMatch(passage.promptText)).toContain("國際聯盟");
    }
  });

  it("「香港點解要發展新市鎮？」的來源都提到新市鎮（原本 0/3 相關）", () => {
    const grounding = ground("香港點解要發展新市鎮？");
    expect(grounding.status).toBe("grounded");
    for (const passage of grounding.passages) {
      expect(normalizeForMatch(passage.promptText)).toContain("新市鎮");
    }
  });

  it("兩字詞加權不會把「珍珠港事件」帶到錯誤課題", () => {
    const grounding = ground("珍珠港事件是甚麼？");
    expect(grounding.topicId).toBe("hs-topic-4");
  });
});
