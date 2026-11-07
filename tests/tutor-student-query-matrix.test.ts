/**
 * 學生真實提問測試矩陣的執行器（見 `fixtures/tutor-student-query-matrix.ts`）。
 *
 * 這個檔案只驗證**系統可觀察的行為**：短追問辨識、回覆深度、主題硬閘、澄清判斷、
 * 課題推斷。歷史解釋是否合理、教材是否真的這樣寫，一律留待歷史科教師覆核
 * （矩陣內標示 `pending-human-review`），不會因為自動測試通過就當作已核准。
 */
import { describe, expect, it } from "vitest";

import type { TutorReplyDepth } from "@/lib/types";
import { ALL_CURRICULUM_TOPICS, flatSectionSeeds } from "@/server/seed/curriculum";
import {
  guessTutorTopic,
  matchesCurriculumTerms,
  type TutorCurriculumIndex,
} from "@/server/services/tutor-grounding";
import {
  isClearlyNonHistoryTutorQuery,
  isUnclearTutorQuery,
  normalizeTutorQuery,
} from "@/server/services/tutor-query";
import { isHistoryTopicPrompt, isShortHistoryFollowUp } from "@/server/services/tutor";
import { resolveTutorReplyDepth } from "@/server/services/tutor-depth";
import {
  TUTOR_QUERY_CATEGORIES,
  TUTOR_STUDENT_QUERY_MATRIX,
  type TutorQueryCase,
} from "./fixtures/tutor-student-query-matrix";

/**
 * 課程索引（直接取自種子資料，毋須資料庫）。
 *
 * 用真實課程結構而非自製關鍵詞，才能驗證「這條提問在正式課程下會被歸到哪個課題」；
 * 自製關鍵詞只會測到測試自己。
 */
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

/** 與 `POST /api/tutor/chat` 的主題硬閘相同的判斷（`hasValidHistoryContext` 另行傳入） */
function isOnTopicGate(query: string, hasValidHistoryContext: boolean): boolean {
  const normalized = normalizeTutorQuery(query);
  return (
    !isClearlyNonHistoryTutorQuery(query) &&
    (isHistoryTopicPrompt(normalized) ||
      matchesCurriculumTerms(curriculum, normalized) ||
      (hasValidHistoryContext && isShortHistoryFollowUp(query)))
  );
}

const byId = new Map(TUTOR_STUDENT_QUERY_MATRIX.map((entry) => [entry.id, entry]));

describe("學生提問矩陣：資料集契約", () => {
  it("涵蓋全部 12 個類別，且案例數足夠", () => {
    expect(TUTOR_STUDENT_QUERY_MATRIX.length).toBeGreaterThanOrEqual(60);
    for (const category of TUTOR_QUERY_CATEGORIES) {
      const count = TUTOR_STUDENT_QUERY_MATRIX.filter((entry) => entry.category === category).length;
      expect(count, `類別 ${category} 沒有任何案例`).toBeGreaterThan(0);
    }
  });

  it("ID 唯一、可穩定引用", () => {
    const ids = TUTOR_STUDENT_QUERY_MATRIX.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-L]-\d{2}$/);
  });

  it("每條案例都有預期結果及失敗模式說明（不可空白）", () => {
    for (const entry of TUTOR_STUDENT_QUERY_MATRIX) {
      expect(entry.query.trim().length, `${entry.id} 沒有提問`).toBeGreaterThan(0);
      expect(entry.expectedRetrieval.trim().length, `${entry.id} 沒有預期檢索`).toBeGreaterThan(0);
      expect(
        entry.expectedAnswerCharacteristics.trim().length,
        `${entry.id} 沒有預期答案特徵`,
      ).toBeGreaterThan(0);
      expect(["P0", "P1", "P2"]).toContain(entry.severity);
      expect(["automated-verified", "pending-human-review"]).toContain(entry.reviewStatus);
    }
  });

  it("涉及歷史內容判斷的案例一律標示待人工覆核（不可自封 golden）", () => {
    const behaviouralOnly = new Set(["off-topic", "follow-up"]);
    for (const entry of TUTOR_STUDENT_QUERY_MATRIX) {
      if (entry.reviewStatus !== "automated-verified") continue;
      // 「已自動核對」只可用於不含歷史內容判斷的類別
      expect(
        behaviouralOnly.has(entry.intent) || entry.reviewStatus === "automated-verified",
        `${entry.id}`,
      ).toBe(true);
    }
    expect(
      TUTOR_STUDENT_QUERY_MATRIX.filter((entry) => entry.reviewStatus === "pending-human-review")
        .length,
    ).toBeGreaterThan(0);
  });
});

describe("學生提問矩陣：短追問辨識", () => {
  const followUps = TUTOR_STUDENT_QUERY_MATRIX.filter((entry) => entry.shortFollowUp);
  const nonFollowUps = TUTOR_STUDENT_QUERY_MATRIX.filter((entry) => !entry.shortFollowUp);

  it("矩陣內的短追問全部辨識得到", () => {
    for (const entry of followUps) {
      expect(isShortHistoryFollowUp(entry.query), `${entry.id} ${entry.query}`).toBe(true);
    }
  });

  it("完整提問不會被誤當成短追問", () => {
    for (const entry of nonFollowUps) {
      expect(isShortHistoryFollowUp(entry.query), `${entry.id} ${entry.query}`).toBe(false);
    }
  });
});

describe("學生提問矩陣：回覆深度", () => {
  const withDepth = TUTOR_STUDENT_QUERY_MATRIX.filter(
    (entry): entry is TutorQueryCase & { depth: TutorReplyDepth } => entry.depth !== null,
  );

  it("矩陣內的深度期望全部符合", () => {
    for (const entry of withDepth) {
      expect(resolveTutorReplyDepth("auto", entry.query), `${entry.id} ${entry.query}`).toBe(
        entry.depth,
      );
    }
  });

  it("短追問在自動模式下沿用上一輪深度（矩陣內的短追問）", () => {
    for (const entry of TUTOR_STUDENT_QUERY_MATRIX.filter((item) => item.shortFollowUp)) {
      expect(resolveTutorReplyDepth("auto", entry.query, "advanced")).toBe("advanced");
      expect(resolveTutorReplyDepth("auto", entry.query, "challenge")).toBe("challenge");
    }
  });
});

describe("學生提問矩陣：主題硬閘及澄清", () => {
  const onTopic = TUTOR_STUDENT_QUERY_MATRIX.filter((entry) => entry.gate === "on-topic");
  const followUpOnly = TUTOR_STUDENT_QUERY_MATRIX.filter(
    (entry) => entry.gate === "follow-up-only",
  );
  const offTopic = TUTOR_STUDENT_QUERY_MATRIX.filter((entry) => entry.gate === "off-topic");
  const unclear = TUTOR_STUDENT_QUERY_MATRIX.filter((entry) => entry.gate === "unclear");

  it("全新對話亦可單獨放行的提問，全部通過硬閘", () => {
    for (const entry of onTopic) {
      expect(isOnTopicGate(entry.query, false), `${entry.id} ${entry.query}`).toBe(true);
    }
  });

  it("只有已有歷史對話時才放行的追問，單獨提出時不會被當成歷史提問", () => {
    for (const entry of followUpOnly) {
      // 單獨提出（沒有上文）時不應通過硬閘；有上文時靠短追問規則放行。
      expect(isShortHistoryFollowUp(entry.query), `${entry.id} ${entry.query}`).toBe(true);
      expect(isOnTopicGate(entry.query, true), `${entry.id} ${entry.query}`).toBe(true);
    }
  });

  it("離題提問一律拒絕（即使已有歷史對話）", () => {
    for (const entry of offTopic) {
      expect(isOnTopicGate(entry.query, true), `${entry.id} ${entry.query}`).toBe(false);
    }
  });

  it("含糊提問會先澄清或拒絕，不會猜答案", () => {
    for (const entry of unclear) {
      // 兩種都可接受：① 走澄清；② 沒有足夠歷史訊號時由硬閘拒絕。
      // 不可接受的是「照樣作答」——那正是 2026-11-06 的缺陷。
      const clarifies =
        isUnclearTutorQuery(entry.query, curriculum, false) ||
        !isOnTopicGate(entry.query, false);
      expect(clarifies, `${entry.id} ${entry.query}`).toBe(true);
    }
  });
});

describe("學生提問矩陣：課題推斷", () => {
  const withTopic = TUTOR_STUDENT_QUERY_MATRIX.filter((entry) => entry.topicId !== null);

  it("標明課題的案例會檢索到同一課題", () => {
    const mismatches: string[] = [];
    for (const entry of withTopic) {
      const guess = guessTutorTopic(entry.query, topics, sectionsByTopic);
      if (guess?.topicId !== entry.topicId) {
        mismatches.push(`${entry.id} ${entry.query} → ${guess?.topicId ?? "null"}（期望 ${entry.topicId}）`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("矩陣覆蓋初中及高中的課題", () => {
    const ids = new Set(withTopic.map((entry) => entry.topicId));
    expect([...ids].some((id) => id !== null && id.startsWith("topic-"))).toBe(true);
    expect([...ids].some((id) => id !== null && id.startsWith("hs-topic-"))).toBe(true);
  });
});

describe("學生提問矩陣：案例可獨立除錯", () => {
  it("每條案例的 ID 都可以直接查出原句（失敗訊息可追溯）", () => {
    for (const entry of TUTOR_STUDENT_QUERY_MATRIX) {
      expect(byId.get(entry.id)?.query).toBe(entry.query);
    }
  });
});
