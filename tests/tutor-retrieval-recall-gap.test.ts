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

import { findTutorGrounding, loadTutorCurriculumIndex } from "@/server/services/tutor-grounding";
import { normalizeTutorQuery } from "@/server/services/tutor-query";

const curriculum = loadTutorCurriculumIndex();

function ground(query: string, options: Record<string, unknown> = {}) {
  return findTutorGrounding(normalizeTutorQuery(query), [], curriculum, {
    maxSources: 3,
    ...options,
  } as never);
}

describe("檢索召回缺口修正（Sprint 34）", () => {
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
});
