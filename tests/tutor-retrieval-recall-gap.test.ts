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
});
