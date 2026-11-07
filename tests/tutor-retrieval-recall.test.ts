/**
 * 檢索召回回歸測試及指標（Sprint 34）。
 *
 * ── 這個檔案在證明甚麼 ──────────────────────────────────────────────
 * Sprint 33 的真實模型評估暴露：12 條樣本中有 4 條回覆「教材找不到」，而其中 3 條
 * 教材實際有相關段落。根因不在教材、也不在模型，而在**問題→課題推斷**：
 * `guessTutorTopic` 只認分節關鍵詞及詞庫專名，內文有、關鍵詞沒有的概念永遠召回不到。
 *
 * Sprint 34 加入兩層修正，並在此固定：
 *   ① 詞庫補上課程確實涵蓋但漏收的概念（例如種族隔離／apartheid）；
 *   ② 課程用語推斷失敗時，改以**教材內文反推課題**（`inferTopicFromMaterial`）。
 *
 * ── 指標 ────────────────────────────────────────────────────────────
 * 測試同時輸出 Recall@k、Topic Inference Accuracy、Cross-language Recall、
 * False Evidence Rate 及 False No-Material Rate，數值寫入 Sprint 34 報告。
 * 「False No-Material」＝教材明明有段落（`materialHits > 0`）卻判為 not-covered，
 * 這正是 Sprint 33 的缺陷類型；反向的 False Evidence（教材沒有卻判 grounded）
 * 由 negative 組把關。
 */
import { describe, expect, it } from "vitest";

import { classifyTutorAnswerability } from "@/server/services/tutor-answerability";
import {
  findTutorGrounding,
  loadTutorCurriculumIndex,
  type TutorPassageSelectionAudit,
} from "@/server/services/tutor-grounding";
import { isUnclearTutorQuery, normalizeTutorQuery } from "@/server/services/tutor-query";
import { TUTOR_RECALL_CASES, type TutorRecallCase } from "./fixtures/tutor-recall-cases";

const curriculum = loadTutorCurriculumIndex();
/**
 * 這一組案例的期望值取自**真實教材分佈**（`data/app.db`），因此只在有內容資料庫時執行。
 * CI 的 `npm test` 沒有內容資料庫（`data/` 已被 `.gitignore` 排除），若強行執行只會
 * 得到假失敗。CI 可驗證的等價行為由 `tests/tutor-retrieval-fallback-fixture.test.ts`
 * 以合成資料庫覆蓋；這裡在缺資料庫時記為 **skipped**（不是 passed）。
 */
const hasContentDatabase = curriculum.topics.length > 0;

interface Observed {
  answerCase: TutorRecallCase;
  topicId: string | null;
  grounded: boolean;
  state: string;
  inferenceSource: string;
  evidenceSupport: string;
}

function observe(answerCase: TutorRecallCase): Observed {
  const audit: TutorPassageSelectionAudit = {
    candidateBlocks: 0,
    scoredHits: 0,
    belowThreshold: 0,
    selected: [],
    excluded: [],
  };
  const message = normalizeTutorQuery(answerCase.query);
  const grounding = findTutorGrounding(message, [], curriculum, { maxSources: 3, audit });
  const decision = classifyTutorAnswerability({
    message: answerCase.query,
    curriculum,
    grounding,
    hasHistoryContext: false,
    unclear: isUnclearTutorQuery(answerCase.query, curriculum, false),
  });
  return {
    answerCase,
    topicId: grounding.topicId,
    grounded: grounding.status === "grounded",
    state: decision.state,
    inferenceSource: audit.topicInference?.source ?? "none",
    evidenceSupport: decision.evidenceSupport,
  };
}

const observed = TUTOR_RECALL_CASES.map(observe);

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : Number((numerator / denominator).toFixed(3));
}

describe.skipIf(!hasContentDatabase)("檢索召回：Sprint 33 的四條失敗個案", () => {
  it("種族隔離（原本說「教材找不到」，實際有 9 段）→ 命中課題11", () => {
    const entry = observed.find((item) => item.answerCase.id === "recall-live-11");
    expect(entry?.grounded).toBe(true);
    expect(entry?.topicId).toBe("topic-11");
  });

  it("英文比較美國與法國革命（實際有 59 段）→ 命中課題5", () => {
    const entry = observed.find((item) => item.answerCase.id === "recall-live-08");
    expect(entry?.grounded).toBe(true);
    expect(entry?.topicId).toBe("topic-5");
  });

  it("甘地的不合作運動：教材的「不合作」是環保協作語境，必須維持不召回", () => {
    // 這一條是最重要的反向保護：若只做字詞重疊，會把甘地誤配到「已發展國家不合作
    // 態度」的環保章節（Sprint 34 開發期間實際發生過）。
    const entry = observed.find((item) => item.answerCase.id === "recall-live-03");
    expect(entry?.grounded).toBe(false);
    expect(entry?.state).toBe("C-general-knowledge");
  });

  it("「美國1942年才參戰」：字詞層維持 C，交由語意改寫處理", () => {
    const entry = observed.find((item) => item.answerCase.id === "recall-live-12");
    expect(entry?.grounded).toBe(false);
    expect(entry?.state).toBe("C-general-knowledge");
  });
});

describe.skipIf(!hasContentDatabase)("檢索召回：跨語言、別稱、干擾及反向對照", () => {
  for (const entry of observed) {
    it(`${entry.answerCase.id}：${entry.answerCase.query.slice(0, 28)}`, () => {
      if (entry.answerCase.expectTopic === null) {
        expect(entry.topicId).toBeNull();
      } else {
        expect(entry.topicId).toBe(entry.answerCase.expectTopic);
        expect(entry.grounded).toBe(true);
      }
      expect(entry.state).toBe(entry.answerCase.expectState);
    });
  }
});

describe.skipIf(!hasContentDatabase)("檢索召回指標", () => {
  it("Recall@3、課題推斷準確率、跨語言召回、False Evidence 及 False No-Material", () => {
    // 「教材有內容」＋「字詞層應該召回得到」才算召回分母；需要語意改寫的題目
    // （recall-live-12）單獨列出，不假裝召回失敗，也不假裝成功。
    const shouldRecall = observed.filter(
      (entry) =>
        entry.answerCase.materialHits > 0 && entry.answerCase.lexicalRecallExpected !== false,
    );
    const expansionRequired = observed.filter(
      (entry) =>
        entry.answerCase.materialHits > 0 && entry.answerCase.lexicalRecallExpected === false,
    );
    const recallAt3 =
      shouldRecall.length === 0
        ? 1
        : shouldRecall.filter((entry) => entry.grounded).length / shouldRecall.length;

    const withExpectedTopic = observed.filter((entry) => entry.answerCase.expectTopic !== null);
    const topicAccuracy =
      withExpectedTopic.filter(
        (entry) => entry.topicId === entry.answerCase.expectTopic,
      ).length / Math.max(withExpectedTopic.length, 1);

    const crossLanguage = observed.filter((entry) => entry.answerCase.group === "cross-language");
    const crossLanguageRecall =
      crossLanguage.filter((entry) => entry.grounded).length / Math.max(crossLanguage.length, 1);

    const absent = observed.filter((entry) => entry.answerCase.materialHits === 0);
    const falseEvidence = absent.filter((entry) => entry.grounded).length;
    const falseNoMaterial = shouldRecall.filter((entry) => !entry.grounded).length;

    const metrics = {
      recallAt3: rate(shouldRecall.length - falseNoMaterial, shouldRecall.length),
      topicInferenceAccuracy: rate(withExpectedTopic.length - withExpectedTopic.filter((e) => e.topicId !== e.answerCase.expectTopic).length, withExpectedTopic.length),
      crossLanguageRecall: rate(crossLanguage.filter((e) => e.grounded).length, crossLanguage.length),
      falseEvidenceRate: rate(falseEvidence, absent.length),
      falseNoMaterialRate: rate(falseNoMaterial, shouldRecall.length),
      expansionRequiredCases: expansionRequired.map((entry) => entry.answerCase.id),
    };
    // 指標輸出（報告引用；測試失敗時可直接看到哪一類出錯）
    console.log("Sprint 34 檢索召回指標", JSON.stringify(metrics));
    expect(recallAt3).toBe(1);
    expect(topicAccuracy).toBe(1);
    expect(crossLanguageRecall).toBe(1);
    expect(falseEvidence).toBe(0);
    expect(falseNoMaterial).toBe(0);
  });

  it("課題推斷來源可觀測（診斷欄位不得為空）", () => {
    for (const entry of observed) {
      if (entry.grounded) {
        expect(["curriculum", "preferred-topic", "context", "material-fallback"]).toContain(
          entry.inferenceSource,
        );
      }
    }
    // 至少一條要由「教材內文反推」救回，否則等於 Sprint 33 的缺口未修。
    expect(observed.some((entry) => entry.inferenceSource === "material-fallback")).toBe(true);
  });
});
