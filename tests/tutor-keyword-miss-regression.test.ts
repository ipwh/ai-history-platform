/**
 * 學生模擬：課題詞彙未命中時的拒答回歸測試（2026-11-10）。
 *
 * ── 這個檔案在證明甚麼 ──────────────────────────────────────────────
 * 擁有者要求「模擬學生使用伴讀功能，以防未能命中課題重要詞彙」。以 38 條學生口語
 * 提問（粵語、簡體、間接描述、只用日常詞彙）模擬後發現三類問題，本檔逐一固定：
 *
 *   ① **有教材卻拒答**：學生在練習課題5 時問「點解啲人開始唔再信教會講嘅嘢？」，
 *      檢索已命中 topic-5 教材，但因為句子沒有詞庫專名，被判 `out-of-scope`。
 *      → `classifyTutorAnswerability` 改以教材證據為準（`grounded` 不再判離題）。
 *   ② **詞表只有教科書 headword**：「教會」「工廠」「珍珠港」「柏林圍牆」「新界」
 *      「清朝」等學生自然會用的字詞不在任何清單內 → 已加入
 *      `HISTORICAL_PROPER_TERMS` / `HISTORICAL_EVERYDAY_TERMS`。
 *   ③ **教材有詞、寫法不同**：字詞檢索失敗但該課題教材確實用過提問的詞彙
 *      → 以 `messageUsesTopicVocabulary` 判定為課程內提問，改以 C（一般歷史知識，
 *      並要求標明教材未涵蓋）作答，而不是拒答。
 *
 * ── 誠實聲明 ────────────────────────────────────────────────────────
 * 這些提問由工程角度模擬，**不是**經歷史科教師審定的標準答案；本檔只驗證
 * 「是否被拒答」「是否判為課程內提問」「是否使用該課題教材詞彙」等系統行為，
 * 不驗證模型回答的歷史內容是否正確。
 *
 * ── 未處理（已知限制，見 CHANGELOG）─────────────────────────────────
 * 完全沒有課題脈絡（未由練習或學習目標進入）而又完全不用課程詞彙的提問，仍可能
 * 被判離題；要根治需在硬閘前加入語意分類／改寫（會增加模型請求成本）。
 * 課題推斷錯誤（例如「1914 年歐洲點解會打成一團？」被推斷為高中課題4）屬另一類
 * 缺陷，不在本檔範圍。
 */
import { describe, expect, it } from "vitest";

import {
  classifyTutorAnswerability,
  isHistoricalTutorQuestion,
} from "@/server/services/tutor-answerability";
import {
  findTutorGrounding,
  loadTutorCurriculumIndex,
  messageUsesAnyCourseVocabulary,
  messageUsesTopicVocabulary,
  type TutorGrounding,
} from "@/server/services/tutor-grounding";
import { isUnclearTutorQuery, normalizeTutorQuery } from "@/server/services/tutor-query";
import { levelFromClassName } from "@/lib/student-level";
import { SENIOR_SECONDARY_LEVEL } from "@/lib/types";
import type { TutorCurriculumIndex } from "@/server/services/tutor-grounding";

const EMPTY_INDEX: TutorCurriculumIndex = { topics: [], sectionsByTopic: new Map() };

function groundingFixture(
  status: TutorGrounding["status"],
  topicId: string | null,
): TutorGrounding {
  return {
    status,
    topicId,
    topicTitle: topicId === null ? null : "課題5：近代歐洲的興起",
    sources: [],
    passages: [],
  };
}

function classify(
  message: string,
  grounding: TutorGrounding,
  extra: {
    hasHistoryContext?: boolean;
    materialVocabularyMatched?: boolean;
    courseVocabularyMatched?: boolean;
  } = {},
) {
  return classifyTutorAnswerability({
    message,
    curriculum: EMPTY_INDEX,
    grounding,
    hasHistoryContext: extra.hasHistoryContext ?? false,
    unclear: false,
    materialVocabularyMatched: extra.materialVocabularyMatched,
    courseVocabularyMatched: extra.courseVocabularyMatched,
  });
}

describe("詞表：學生日常寫法不再被當成離題", () => {
  const shouldBeHistory = [
    "點解啲人開始唔再信教會講嘅嘢？", // 宗教改革，未寫出「宗教改革」
    "點解突然之間好多工廠同蒸汽機出現？", // 工業革命
    "日本點解要偷襲美國嗰個海軍基地？", // 偷襲（教材用詞）
    "柏林圍牆幾時拆？",
    "新界係幾時變咗英國管？",
    "清朝末年啲人點解想學西方？",
    "古巴嗰次差啲打核戰係咩事？",
    "二戰之後成立嗰個世界組織係做咩？", // 聯合國
    "歐洲啲國家點解會組成一個聯盟？", // 歐盟
    "美國點解要發表獨立宣言？",
    "文化大革命其實發生咗咩事？",
    "日本嘅明治維新改咗啲咩？",
  ];

  for (const message of shouldBeHistory) {
    it(`視為歷史提問：${message}`, () => {
      expect(
        isHistoricalTutorQuestion({ message, curriculum: EMPTY_INDEX, hasHistoryContext: false }),
      ).toBe(true);
    });
  }

  const shouldNotBeHistory = [
    "聽日會唔會落雨？",
    "點樣整芝士蛋糕？",
    "幫我寫英文作文",
    "學校幾點關門？",
    "點樣安裝打印機驅動程式？",
  ];

  for (const message of shouldNotBeHistory) {
    it(`不視為歷史提問：${message}`, () => {
      expect(
        isHistoricalTutorQuestion({ message, curriculum: EMPTY_INDEX, hasHistoryContext: false }),
      ).toBe(false);
    });
  }
});

describe("可答性：教材已命中時不可判為離題", () => {
  it("檢索命中課題教材 → 即使沒有詞庫專名，仍屬課程內提問", () => {
    const decision = classify(
      "點解啲人開始唔再信教會講嘅嘢？",
      groundingFixture("grounded", "topic-5"),
    );
    expect(decision.state).not.toBe("out-of-scope");
    expect(decision.scope).toBe("history");
    expect(decision.historicalQuestion).toBe(true);
  });

  it("字詞檢索失敗，但該課題教材用過提問的詞彙 → 以 C 作答而不是拒答", () => {
    const decision = classify(
      "古巴嗰次差啲打核戰係咩事？",
      groundingFixture("not-covered", "topic-10"),
      { materialVocabularyMatched: true },
    );
    expect(decision.state).toBe("C-general-knowledge");
    expect(decision.allowGeneralKnowledge).toBe(true);
    expect(decision.requireDisclosure).toBe(true);
  });

  it("沒有教材、沒有詞彙證據、沒有歷史訊號 → 仍然拒答（不可放行閒聊）", () => {
    const decision = classify("聽日會唔會落雨？", groundingFixture("not-covered", null));
    expect(decision.state).toBe("out-of-scope");
  });

  it("即使有課題脈絡，非歷史提問仍會拒答", () => {
    const decision = classify(
      "點樣整芝士蛋糕？",
      groundingFixture("not-covered", "topic-12"),
      { materialVocabularyMatched: false },
    );
    expect(decision.state).toBe("out-of-scope");
  });

  it("沒有課題脈絡但提問用了教材詞彙 → 只可澄清，不可拒答", () => {
    const decision = classify("美國點解要同英國分手？", groundingFixture("not-covered", null), {
      courseVocabularyMatched: true,
    });
    expect(decision.state).toBe("D-needs-clarification");
    expect(decision.scope).toBe("history");
  });

  it("沒有課題脈絡、沒有詞彙證據 → 仍然拒答", () => {
    const decision = classify("點樣整芝士蛋糕？", groundingFixture("not-covered", null), {
      courseVocabularyMatched: false,
    });
    expect(decision.state).toBe("out-of-scope");
  });
});

const curriculum = loadTutorCurriculumIndex();
/** 這一組需要真實教材（`data/app.db`）；CI 沒有內容資料庫時記為略過而不是假通過。 */
const hasContentDatabase = curriculum.topics.length > 0;

describe.skipIf(!hasContentDatabase)("教材詞彙比對（需要內容資料庫）", () => {
  const anchored: [string, string][] = [
    ["以前啲人以為地球係宇宙中心，幾時開始唔係咁諗？", "topic-5"],
    ["柏林嗰道牆幾時拆，為咩要起？", "topic-10"],
    ["香港九七年之後有咩唔同？", "topic-12"],
    ["新界係幾時變咗英國管？", "topic-8"],
    ["以前香港啲村民係靠咩生活？", "topic-4"],
  ];

  for (const [message, topicId] of anchored) {
    it(`在 ${topicId} 脈絡下，提問使用該課題教材詞彙：${message}`, () => {
      expect(messageUsesTopicVocabulary(message, topicId)).toBe(true);
    });
  }

  it("非歷史提問不會被教材詞彙比對放行", () => {
    expect(messageUsesTopicVocabulary("點樣整芝士蛋糕？", "topic-12")).toBe(false);
    expect(messageUsesTopicVocabulary("聽日會唔會落雨？", "topic-12")).toBe(false);
  });

  it("由練習進入的學生提問：不再被拒答，並會引用該課題教材或明確標示未涵蓋", () => {
    const cases: [string, string][] = [
      ["點解啲人開始唔再信教會講嘅嘢？", "topic-5"],
      ["點解突然之間好多工廠同蒸汽機出現？", "topic-5"],
      ["法國啲人點解要殺自己個國王？", "topic-5"],
      ["香港島點解會變成英國地方？", "topic-8"],
      ["歐洲啲國家點解要去非洲搶地盤？", "topic-6"],
      ["美國點解要同英國分手？", "topic-7"],
    ];

    for (const [raw, topicId] of cases) {
      const normalized = normalizeTutorQuery(raw);
      const grounding = findTutorGrounding(normalized, [], curriculum, {
        maxSources: 3,
        preferredTopicId: topicId,
      });
      const decision = classifyTutorAnswerability({
        message: raw,
        curriculum,
        grounding,
        hasHistoryContext: false,
        unclear: isUnclearTutorQuery(raw, curriculum, false),
        materialVocabularyMatched:
          grounding.status === "not-covered" &&
          messageUsesTopicVocabulary(normalized, topicId),
      });
      expect(
        decision.state,
        `${raw}（${topicId}）不應被拒答；實際 ${decision.state} / ${grounding.status}`,
      ).not.toBe("out-of-scope");
    }
  });

  it("同一批提問在完全沒有課題脈絡時，仍有教材或詞彙證據者不會被拒答", () => {
    const shouldAnswer: [string, string][] = [
      ["點解啲人開始唔再信教會講嘅嘢？", "topic-5"],
      ["日本點解要偷襲美國嗰個海軍基地？", "topic-9"],
      ["古巴嗰次差啲打核戰係咩事？", "topic-10"],
    ];
    for (const [raw] of shouldAnswer) {
      const decision = classifyTutorAnswerability({
        message: raw,
        curriculum,
        grounding: findTutorGrounding(normalizeTutorQuery(raw), [], curriculum, {
          maxSources: 3,
        }),
        hasHistoryContext: false,
        unclear: isUnclearTutorQuery(raw, curriculum, false),
      });
      // 這一組的重點是「不再被當成離題」；教材是否引用得到屬檢索召回，另有專項測試。
      expect(decision.scope, `${raw} 應判為課程內提問`).toBe("history");
    }
  });
});

describe.skipIf(!hasContentDatabase)("學生所在課題優先（需內容資料庫）", () => {
  const keepAnchor: [string, string][] = [
    // 推斷分數 12：只靠分節關鍵詞，不足以取代學生所在課題
    ["1914 年歐洲點解會打成一團？", "topic-9"],
    // 推斷分數 10：只看到「二戰」二字
    ["二戰之後成立嗰個世界組織係做咩？", "topic-11"],
    ["二戰之後有兩個大國互相針對但冇真正開戰，其實係咩事？", "topic-10"],
  ];

  for (const [raw, topicId] of keepAnchor) {
    it(`學生在 ${topicId} 練習時，不會被較弱的課題推斷帶走：${raw}`, () => {
      const grounding = findTutorGrounding(normalizeTutorQuery(raw), [], curriculum, {
        maxSources: 3,
        preferredTopicId: topicId,
      });
      expect(grounding.status).toBe("grounded");
      expect(grounding.topicId).toBe(topicId);
    });
  }

  it("明確點名另一課題的專名時，仍然可以轉換課題（明治維新，分數 24）", () => {
    const grounding = findTutorGrounding(
      normalizeTutorQuery("明治維新改咗啲咩？"),
      [],
      curriculum,
      { maxSources: 3, preferredTopicId: "topic-5" },
    );
    expect(grounding.topicId).toBe("hs-topic-3");
  });

  it("同一程度內明確轉換課題仍然有效（在課題9 問冷戰，分數 16）", () => {
    const grounding = findTutorGrounding(
      normalizeTutorQuery("冷戰嘅起因係咩？"),
      [],
      curriculum,
      { maxSources: 3, preferredTopicId: "topic-9" },
    );
    expect(grounding.topicId).toBe("topic-10");
  });
});

describe.skipIf(!hasContentDatabase)("教材詞彙（跨課題，需內容資料庫）", () => {  it("提問使用教材內的詞彙 → 可作為「疑似歷史提問」的證據", () => {
    const us = messageUsesAnyCourseVocabulary(normalizeTutorQuery("美國點解要同英國分手？"));
    expect(us.matched).toBe(true);
    expect(us.topicIds.length).toBeGreaterThan(0);
    expect(messageUsesAnyCourseVocabulary(normalizeTutorQuery("柏林嗰道牆幾時拆？")).matched).toBe(
      true,
    );
  });

  it("教材完全沒有提問的詞彙 → 不放行（維持拒答）", () => {
    expect(messageUsesAnyCourseVocabulary(normalizeTutorQuery("點樣整芝士蛋糕？")).matched).toBe(
      false,
    );
    expect(messageUsesAnyCourseVocabulary(normalizeTutorQuery("聽日會唔會落雨？")).matched).toBe(
      false,
    );
  });
});

describe("班別 → 程度", () => {
  it.each([
    ["1A", 1],
    ["2B", 2],
    ["3C", 3],
    ["4A", SENIOR_SECONDARY_LEVEL],
    ["5B", SENIOR_SECONDARY_LEVEL],
    ["6D", SENIOR_SECONDARY_LEVEL],
  ])("%s → %s", (className, expected) => {
    expect(levelFromClassName(className)).toBe(expected);
  });

  it.each([[""], [null], ["S3A"], ["中三甲"]])("無法辨認的班別（%s）不會猜程度", (value) => {
    expect(levelFromClassName(value)).toBeNull();
  });
});

describe.skipIf(!hasContentDatabase)("同程度優先（需內容資料庫）", () => {
  const topicLevel = (topicId: string | null): number | null =>
    curriculum.topics.find((topic) => topic.id === topicId)?.level ?? null;

  it("初中生問兩次世界大戰：不會引用高中同史事課題", () => {
    const grounding = findTutorGrounding(
      normalizeTutorQuery("1914 年歐洲點解會打成一團？"),
      [],
      curriculum,
      { maxSources: 3, studentLevel: 3 },
    );
    expect(grounding.topicId).toBe("topic-9");
  });

  it("同一個問題，高中生會用高中課題", () => {
    const grounding = findTutorGrounding(
      normalizeTutorQuery("1914 年歐洲點解會打成一團？"),
      [],
      curriculum,
      { maxSources: 3, studentLevel: SENIOR_SECONDARY_LEVEL },
    );
    expect(grounding.topicId).toBe("hs-topic-4");
  });

  it("初中生問凡爾賽條約：留在初中課題9（原本被帶到高中課題4）", () => {
    const grounding = findTutorGrounding(
      normalizeTutorQuery("凡爾賽條約對德國有咩影響？"),
      [],
      curriculum,
      { maxSources: 3, studentLevel: 3 },
    );
    expect(grounding.topicId).toBe("topic-9");
  });

  it("初中生問高中課題內容時仍會跨程度（明治維新 → 高中課題3）", () => {
    const grounding = findTutorGrounding(
      normalizeTutorQuery("明治維新改咗啲咩？"),
      [],
      curriculum,
      { maxSources: 3, studentLevel: 3 },
    );
    expect(grounding.topicId).toBe("hs-topic-3");
  });

  it("教材反推亦會找回初中課題（香港島被割讓）", () => {
    const grounding = findTutorGrounding(
      normalizeTutorQuery("香港島點解會變成英國地方？"),
      [],
      curriculum,
      { maxSources: 3, studentLevel: 3 },
    );
    expect(grounding.status).toBe("grounded");
    expect(topicLevel(grounding.topicId)).not.toBe(SENIOR_SECONDARY_LEVEL);
  });

  it("沒有班別時維持原有行為（不猜程度）", () => {
    const grounding = findTutorGrounding(
      normalizeTutorQuery("1914 年歐洲點解會打成一團？"),
      [],
      curriculum,
      { maxSources: 3 },
    );
    expect(grounding.topicId).toBe("hs-topic-4");
  });

  it("程度偏好不會令非歷史提問變成可作答", () => {
    for (const raw of ["聽日會唔會落雨？", "點樣整芝士蛋糕？"]) {
      const grounding = findTutorGrounding(normalizeTutorQuery(raw), [], curriculum, {
        maxSources: 3,
        studentLevel: 3,
      });
      expect(grounding.status, raw).toBe("not-covered");
    }
  });
});
