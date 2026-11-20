/**
 * 檢索召回缺口 — Sprint 33 發現、Sprint 34 修正後的行為契約。
 *
 * ── 歷史 ────────────────────────────────────────────────────────────
 * Sprint 33 的真實模型評估中，學生問「什么是种族隔离？」及英文比較美國與法國革命，
 * 模型回覆「教材找不到這部分的內容」，但教材實際有 9 段及 59 段相關內容。
 * 當時這個檔案的作用是**固定缺陷**（特徵測試），並註明「修正時必須一併更新」。
 *
 * ── 現在 ────────────────────────────────────────────────────────────
 * Sprint 34 已修正：課程用語沒有線索（或推斷出的課題沒有可用片段）時，改以教材內文
 * 反推課題（`inferTopicFromMaterial`），並補上課程確實涵蓋但詞庫漏收的概念。
 * 本檔驗證修正後的行為；完整召回指標見 `tests/tutor-retrieval-recall.test.ts`。
 *
 * 最重要的反向保護是「不合作」：教材那 4 段講的是**已發展國家在國際環保協作上的
 * 不合作態度**，與甘地無關。只做字詞重疊會把甘地誤配到環保章節（開發期間實際發生過），
 * 所以它必須繼續維持 not-covered。
 */
import { describe, expect, it } from "vitest";

import {
  extractQueryTerms,
  findTutorGrounding,
  loadTutorCurriculumIndex,
} from "@/server/services/tutor-grounding";
import { normalizeTutorQuery } from "@/server/services/tutor-query";

const curriculum = loadTutorCurriculumIndex();
/** 需要真實教材內容（CI 的 `npm test` 沒有 `data/app.db`，見檔案頂部說明） */
const hasContentDatabase = curriculum.topics.length > 0;

function ground(query: string, options: Record<string, unknown> = {}) {
  return findTutorGrounding(normalizeTutorQuery(query), [], curriculum, {
    maxSources: 3,
    ...options,
  } as never);
}

describe.skipIf(!hasContentDatabase)("檢索召回缺口修正（Sprint 34）", () => {
  it("「什么是种族隔离？」改由詞庫＋教材內文召回（教材 9 段）", () => {
    const grounding = ground("什么是种族隔离？");
    expect(grounding.status).toBe("grounded");
    expect(grounding.topicId).toBe("topic-11");
  });

  it("英文比較美國與法國革命改由教材內文反推課題（教材 59 段）", () => {
    const english =
      "Compare the causes of the American and French Revolutions, and evaluate which was more revolutionary.";
    const grounding = ground(english);
    expect(grounding.status).toBe("grounded");
    expect(grounding.topicId).toBe("topic-5");
    expect(grounding.selectionAudit?.topicInference?.source).toBe("material-fallback");
  });

  it("甘地的不合作運動維持 not-covered（教材該詞屬環保協作語境）", () => {
    const grounding = ground("甘地提倡的不合作運動是甚麼？");
    expect(grounding.status).toBe("not-covered");
    expect(grounding.topicId).toBeNull();
  });

  it("「美國1942年才正式參戰」字詞層維持 not-covered（交由語意改寫）", () => {
    const grounding = ground("美國在1942年才正式參戰，對嗎？");
    expect(grounding.status).toBe("not-covered");
  });

  it("補充語意改寫詞後，同一問題可以召回", () => {
    const grounding = ground("美國在1942年才正式參戰，對嗎？", {
      extraTerms: ["珍珠港", "第二次世界大戰"],
    });
    expect(grounding.status).toBe("grounded");
    expect(grounding.topicId).toBe("topic-9");
  });

  it("課題推斷來源會被記錄（curriculum／material-fallback）", () => {
    expect(ground("什麼是明治維新？").selectionAudit?.topicInference?.source).toBe("curriculum");
    expect(ground("珍珠港事件是甚麼？").selectionAudit?.topicInference?.source).toBe(
      "material-fallback",
    );
  });

  it("非歷史問題不會因任何詞重疊而召回教材", () => {
    for (const query of ["火箭推進器的燃燒溫度是多少？", "板球比賽的規則有幾條？"]) {
      expect(ground(query).status).toBe("not-covered");
    }
  });

  it("匿名學生事件：中古時代以前的藝術問法會召回古典文明教材", () => {
    const queries = [
      "中古時期前的雕塑和建築的風格",
      "中古时前的建築和繪畫风格",
    ];
    for (const query of queries) {
      const grounding = ground(query);
      expect(grounding.status).toBe("grounded");
      expect(grounding.topicId).toBe("topic-2");
    }
  });

  it("匿名學生事件：科學領域與天主教問法會召回科學革命教材", () => {
    const grounding = ground(
      "为什么那么多聪明人出现，开始在科学领域有重大成就，罗马天主教不会阻止吗",
    );
    expect(grounding.status).toBe("grounded");
    expect(grounding.topicId).toBe("topic-5");
  });

  /**
   * 2026-11-20 學生模擬：「二戰之後成立嗰個世界組織係咩？」原本被推斷為課題9
   * （兩次世界大戰），三段教材全部與聯合國無關，回覆稱教材沒有提及；但課題11
   * 有 158 段提及聯合國。原因有二：① 教材完全沒有「世界組織」這個說法（0 段），
   * 提問因此沒有課題線索；② 課題9 與課題11 同分時按課題次序取捨，取了課題9。
   */
  it("學生模擬：以「世界組織」問二戰後的組織會召回課題11（聯合國）", () => {
    const grounding = ground("二戰之後成立嗰個世界組織係咩？");
    expect(grounding.status).toBe("grounded");
    expect(grounding.topicId).toBe("topic-11");
    const excerpts = grounding.sources.map((source) => source.excerpt).join("\n");
    expect(excerpts).toContain("聯合國");
  });

  it("學生模擬：「國際組織」類別詞不再落空（原本 not-covered）", () => {
    for (const query of ["點解要成立國際組織？", "國際組織有邊幾類？"]) {
      const grounding = ground(query);
      expect(grounding.status).toBe("grounded");
      expect(grounding.topicId).toBe("topic-11");
    }
  });

  it("一戰後的國際組織仍以國際聯盟為第一段（不會被推向聯合國）", () => {
    const grounding = ground("一戰之後成立嘅國際組織係咩？");
    expect(grounding.status).toBe("grounded");
    expect(grounding.sources[0]?.excerpt).toContain("國聯");
  });

  /**
   * 節錄覆核（2026-11-20）：「命中課題」不等於「答得到問題」。
   *
   * 推斷出的課題揀得到片段，但提問主要詞完全不在片段之中時，掃描**全部**教材
   * （純字詞比對、零模型呼叫）再決定是否換課題。以下三個個案固定這條規則的三種結局。
   */
  it("節錄未覆蓋提問主要詞時，以全教材掃描換到覆蓋更好的課題", () => {
    const grounding = ground("二次大戰後的重建與經濟增是甚麼？");
    expect(grounding.status).toBe("grounded");
    // 課程用語把它帶到課題7（美國的成立及發展），全教材掃描指向高中課題5（協作與繁榮）
    expect(grounding.topicId).toBe("hs-topic-5");
    expect(grounding.selectionAudit?.topicInference?.source).toBe("material-fallback");
    // 「二次大戰後」由未覆蓋變成有覆蓋（掃描揀到真正相關的段落）
    expect(grounding.uncoveredTerms).not.toContain("二次大戰後");
  });

  it("全教材掃描沒有改善覆蓋時保留原本課題，亦不留下誤導紀錄", () => {
    const grounding = ground("年至 1914 年的國際是甚麼？");
    expect(grounding.status).toBe("grounded");
    // 詞庫把它帶到高中課題4；掃描找到的另一課題覆蓋更差，因此不換
    expect(grounding.topicId).toBe("hs-topic-4");
    expect(grounding.selectionAudit?.topicInference?.source).toBe("curriculum");
    expect(grounding.selectionAudit?.topicInference?.fallbackCandidates).toBeUndefined();
  });

  it("節錄已覆蓋所有主要詞時不會掃描全部教材（成本控制）", () => {
    for (const query of ["什麼是文藝復興？", "冷戰幾時結束？", "聯合國有咩目標？"]) {
      const grounding = ground(query);
      expect(grounding.uncoveredTerms ?? []).toHaveLength(0);
      expect(grounding.selectionAudit?.topicInference?.fallbackCandidates).toBeUndefined();
    }
  });

  it("學生設定的溫習目標不會被全教材掃描改寫", () => {
    // 高中課題5 有可用片段 → 學生自己設定的溫習目標成立，覆核不得改寫它
    const grounding = ground("二次大戰後的重建與經濟增是甚麼？", {
      preferredTopicId: "hs-topic-5",
    });
    expect(grounding.topicId).toBe("hs-topic-5");
    expect(grounding.selectionAudit?.topicInference?.source).toBe("preferred-topic");
    expect(grounding.selectionAudit?.topicInference?.fallbackCandidates).toBeUndefined();
  });
});

describe("匿名學生事件的召回詞展開", () => {
  it("只將「中古時前」映射至古典文明，不把一般中古提問改寫", () => {
    const beforeMiddleAges = extractQueryTerms("中古時前的雕塑和建築");
    expect(beforeMiddleAges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ term: "古代" }),
        expect.objectContaining({ term: "古典文明" }),
      ]),
    );

    const middleAges = extractQueryTerms("中古時期的封建制度");
    expect(middleAges).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ term: "古典文明" })]),
    );
  });

  it("科學領域及天主教補上課程用語", () => {
    const terms = extractQueryTerms("科學領域與羅馬天主教的關係");
    expect(terms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ term: "科學革命" }),
        expect.objectContaining({ term: "羅馬天主教會" }),
      ]),
    );
  });

  it("「世界組織」補上實際專名作召回詞", () => {
    const terms = extractQueryTerms("二戰之後成立嗰個世界組織係咩？");
    expect(terms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ term: "聯合國" }),
        expect.objectContaining({ term: "國際聯盟" }),
      ]),
    );
  });
});
