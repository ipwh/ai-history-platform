import { describe, expect, it } from "vitest";

import {
  buildClarifyCandidates,
  hasWeakHistorySignal,
  isClearlyNonHistoryTutorQuery,
  isUnclearTutorQuery,
  normalizeTutorQuery,
} from "@/server/services/tutor-query";
import type { TutorCurriculumIndex } from "@/server/services/tutor-grounding";
import { matchesCurriculumTerms } from "@/server/services/tutor-grounding";
import { isHistoryTopicPrompt } from "@/server/services/tutor";
import { TUTOR_COLLOQUIAL_UTTERANCES } from "./fixtures/tutor-colloquial-utterances";

const curriculum: TutorCurriculumIndex = {
  topics: [
    { id: "topic-9", title: "課題9：兩次世界大戰" },
    { id: "topic-5", title: "課題5：近代歐洲的興起" },
    { id: "topic-10", title: "課題10：冷戰及後冷戰時代" },
  ],
  sectionsByTopic: new Map([
    [
      "topic-9",
      [
        {
          id: "versailles",
          title: "凡爾賽條約的內容",
          matchKeywords: ["德國", "戰後安排"],
        },
        {
          id: "ww1",
          title: "第一次世界大戰的起因",
          matchKeywords: ["戰爭爆發"],
        },
      ],
    ],
    [
      "topic-5",
      [
        {
          id: "renaissance-art",
          title: "文藝復興藝術",
          matchKeywords: ["藝術三傑", "人文主義"],
        },
        {
          id: "meiji",
          title: "明治維新",
          matchKeywords: ["改革"],
        },
      ],
    ],
    [
      "topic-10",
      [
        {
          id: "cold-war",
          title: "冷戰的發展",
          matchKeywords: ["國際關係", "兩德統一"],
        },
      ],
    ],
  ]),
};

describe("學伴提問正規化與澄清候選", () => {
  it("模擬語料 fixture 至少涵蓋 25 條，並有明確分類", () => {
    expect(TUTOR_COLLOQUIAL_UTTERANCES.length).toBeGreaterThanOrEqual(25);
    expect(new Set(TUTOR_COLLOQUIAL_UTTERANCES.map((utterance) => utterance.category))).toEqual(
      new Set(["history", "clarify", "reject", "homework"]),
    );
  });

  it.each([
    ["點解一戰會爆", "為什麼一戰爆發"],
    ["係咩", "是什麼"],    ["爆出嚟", "爆發"],
    ["WW1 成因講吓", "第一次世界大戰成因說明"],
    ["WWII 之後的 Cold War", "第二次世界大戰之後的冷戰"],
    ["凡爾賽條約點罰德國㗎", "凡爾賽條約如何懲罰德國"],
    ["明治維新改咗啲咩", "明治維新有什麼改變"],
    ["香港喺唔喺二戰俾人佔", "香港是否二戰被佔領"],
    ["World War 1 嘅成因係咩？", "第一次世界大戰的成因是什麼"],
    ["ww 1 嘅成因係咩？", "第一次世界大戰的成因是什麼"],
    ["World War II 點解會爆發？", "第二次世界大戰為什麼會爆發"],
    ["希特勒點解可以上台？", "希特拉為什麼可以上台"],
    ["塞拉耶佛事件係咪一戰導火線？", "塞拉耶佛事件是否一戰導火線"],
    ["凡尔赛条约点解令德国咁不满？", "凡爾賽條約為什麼令德國咁不滿"],
    ["冷戰之後有冇發生戰爭？", "冷戰之後是否有發生戰爭"],
    ["明治維新幾時嚟㗎？", "明治維新幾時來"],
    ["香港喺二戰俾日本佔咗之後，發生咩事？", "香港在二戰被日本佔領之後"],
    ["凡爾賽條約嘅內容係咪有講賠款？", "凡爾賽條約的內容是否有講賠款"],
    ["明治維新冇令日本變強，點解？", "明治維新沒有令日本變強為什麼"],
    ["明治維新之後，日本變咗強國的原因係咩？", "日本變了強國的原因是什麼"],
    ["WWI 成因係咩？", "第一次世界大戰成因是什麼"],
    ["ww-2 成因", "第二次世界大戰成因"],
    ["world war 1 成因", "第一次世界大戰成因"],
  ])("normalizeTutorQuery(%s)", (raw, expected) => {
    expect(normalizeTutorQuery(raw)).toContain(expected);
  });

  it.each(
    TUTOR_COLLOQUIAL_UTTERANCES.filter((utterance) => utterance.category === "reject"),
  )("明確離題不會被當成含混歷史問題：$id", ({ raw }) => {
    // 固定拒答有兩條路：① 明確非歷史科目（python／天氣／數學／傾偈）；
    // ② 完全沒有歷史訊號（例如「幫我寫英文 essay 關於 my hobby」）。
    // 兩者都不可變成「澄清」，亦不應進入回答流程。
    expect(hasWeakHistorySignal(raw)).toBe(false);
    expect(isClearlyNonHistoryTutorQuery(raw) || !hasWeakHistorySignal(raw)).toBe(true);
  });

  it.each(
    TUTOR_COLLOQUIAL_UTTERANCES.filter((utterance) => utterance.category === "clarify"),
  )("含混語料有弱歷史訊號，且無上文時需要澄清：$id", ({ raw }) => {
    expect(hasWeakHistorySignal(raw)).toBe(true);
    expect(isUnclearTutorQuery(raw, curriculum, false)).toBe(true);
    expect(isUnclearTutorQuery(raw, curriculum, true)).toBe(false);
  });

  it("沒有有效上文的「佢呢」只提供澄清方向，不猜測人物", () => {
    const raw = "佢呢";
    expect(hasWeakHistorySignal(raw)).toBe(true);
    expect(isUnclearTutorQuery(raw, curriculum, false)).toBe(true);
    const candidates = buildClarifyCandidates(raw, [], curriculum);
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates.length).toBeLessThanOrEqual(4);
    expect(candidates.every((candidate) => !candidate.suggestedQuestion.includes("希特拉"))).toBe(
      true,
    );
  });

  it.each(
    TUTOR_COLLOQUIAL_UTTERANCES.filter(
      (utterance) => utterance.category === "history" || utterance.category === "homework",
    ),
  )("明確歷史語料不會誤觸澄清：$id", ({ raw }) => {
    expect(isClearlyNonHistoryTutorQuery(raw)).toBe(false);
    expect(isUnclearTutorQuery(raw, curriculum, false)).toBe(false);
  });

  it("候選優先採用相符課程分節，並保證 2 至 4 條都是問題", () => {
    const candidates = buildClarifyCandidates("嗰個條約呢", [], curriculum);
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates.length).toBeLessThanOrEqual(4);
    expect(candidates[0]?.suggestedQuestion).toContain("條約");
    expect(candidates.every((candidate) => candidate.suggestedQuestion.endsWith("？"))).toBe(true);
    expect(new Set(candidates.map((candidate) => candidate.id)).size).toBe(candidates.length);
  });

  it("產生的每個候選都是可直接回答的清晰歷史問題", () => {
    const candidates = buildClarifyCandidates("改革嗰堆", [], curriculum);
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(
      candidates.every(
        (candidate) => !isUnclearTutorQuery(candidate.suggestedQuestion, curriculum, false),
      ),
    ).toBe(true);
  });

  it("沒有課程索引可用時仍提供有限、歷史科專屬的保底方向", () => {
    const candidates = buildClarifyCandidates(
      "1919 年嗰陣",
      [],
      { topics: [], sectionsByTopic: new Map() },
    );
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates.length).toBeLessThanOrEqual(4);
    expect(candidates.map((candidate) => candidate.suggestedQuestion).join("\n")).toMatch(
      /凡爾賽條約|第一次世界大戰|五四運動/,
    );
  });
});

describe("香港中學問法分類：A 歷史題／B 澄清／C 拒答／D 作業口吻", () => {
  // 對應 2026-11-02 擁有者提供的評分表。每一句都是香港學生實際會打的字，
  // 期望的處理方式不同：A 要回答、B 要澄清、C 要固定拒答、D 要鷹架。
  const CLASS_A = [
    "點解一戰會爆",
    "凡爾賽條約點罰德國㗎",
    "希特拉點樣可以上台",
    "希特勒係咪同希特拉同一個人？",
    "WW1 成因講吓",
    "ww 1 嘅成因係咩",
    "冷戰係咪二戰之後先有",
    "明治維新改咗咁啲咩",
    "香港喺二戰俾日本佔咗之後發生咩事",
    "極權主義同獨裁有咩分別",
    "塞拉耶佛事件係咪一戰導火線",
    "凡尔赛条约点解令德国不满",
  ];
  const CLASS_B = [
    "嗰個條約呢",
    "之後呢",
    "1919 年嗰陣",
    "個德國係咪好慘",
    "藝術嗰三個邊個最勁",
    "佢呢",
    "改革嗰堆",
  ];
  const CLASS_C = [
    "幫我寫 python",
    "今日天氣點",
    "陪我傾偈",
    "數學 quadratic formula 點計",
    "幫我寫英文 essay 關於 my hobby",
  ];

  it.each(CLASS_A)("A｜「%s」通過硬閘、不需澄清", (raw) => {
    const normalized = normalizeTutorQuery(raw);
    expect(isClearlyNonHistoryTutorQuery(raw)).toBe(false);
    expect(
      isHistoryTopicPrompt(normalized) || matchesCurriculumTerms(curriculum, normalized),
    ).toBe(true);
    expect(isUnclearTutorQuery(raw, curriculum, false)).toBe(false);
  });

  it.each(CLASS_B)("B｜「%s」在空白對話會澄清（不瞎猜）", (raw) => {
    expect(hasWeakHistorySignal(raw)).toBe(true);
    expect(isUnclearTutorQuery(raw, curriculum, false)).toBe(true);
    // 有有效上文時則可繼續，不再要求澄清
    expect(isUnclearTutorQuery(raw, curriculum, true)).toBe(false);
  });

  it.each(CLASS_C)("C｜「%s」固定拒答（不是澄清）", (raw) => {
    expect(hasWeakHistorySignal(raw)).toBe(false);
    expect(isUnclearTutorQuery(raw, curriculum, false)).toBe(false);
  });

  it("B2／B6 在空白對話要澄清；A 類答完後的短跟進可以繼續", () => {
    // 擁有者情境：先在空白新對話打「之後呢」／「佢呢」→ 澄清（不瞎猜）。
    expect(isUnclearTutorQuery("之後呢", curriculum, false)).toBe(true);
    expect(isUnclearTutorQuery("佢呢", curriculum, false)).toBe(true);
    // A 類答完之後，同一批短跟進全部可以繼續（有上文即不要求澄清）。
    for (const followUp of ["之後呢", "佢呢", "點解？", "咁跟住呢？"]) {
      expect(isUnclearTutorQuery(followUp, curriculum, true), followUp).toBe(false);
    }
    // 空白對話的「點解？」沒有任何歷史訊號，屬固定拒答（不是澄清、不會消耗額度）：
    expect(hasWeakHistorySignal("點解？")).toBe(false);
  });
});

describe("學伴提問：香港中學常見問法不會誤觸澄清（2026-11-02）", () => {
  // 這些句子的意思清楚、也有具體歷史錨點，只是用了香港學生慣用的疑問句式
  // （「邊五樣」「邊幾個」「係點」「咩關係」）。原本的疑問詞表沒有收錄，令它們
  // 在已找到教材的情況下仍被要求澄清。
  const index: TutorCurriculumIndex = {
    topics: [
      { id: "topic-3", title: "課題3：伊斯蘭文明的興起與中古時代歐亞的文化交流" },
      { id: "topic-9", title: "課題9：20世紀的國際紛爭及危機(I)–兩次世界大戰" },
      { id: "topic-12", title: "課題12：20世紀香港的成長與蛻變" },
    ],
    sectionsByTopic: new Map([
      ["topic-3", [{ id: "topic-3-islam", title: "伊斯蘭教的起源、教義與發展", matchKeywords: ["五功"] }]],
      [
        "topic-9",
        [{ id: "topic-9-holocaust", title: "種族滅絕：二戰期間的「猶太大屠殺」", matchKeywords: ["奧斯維辛"] }],
      ],
      ["topic-12", [{ id: "topic-12-occupation", title: "日佔時期的香港", matchKeywords: ["三年零八個月"] }]],
    ]),
  };

  it.each([
    "伊斯蘭教嘅五功係指邊五樣？",
    "文藝復興時期嘅藝術家有邊幾個？",
    "猶太大屠殺係點發生嘅？",
    "三年零八個月期間香港人生活係點？",
    "Cold War 同 WW2 有咩關係？",
  ])("「%s」會直接作答，不要求澄清", (raw) => {
    expect(hasWeakHistorySignal(raw)).toBe(true);
    expect(isUnclearTutorQuery(raw, index, false)).toBe(false);
  });

  it("真正含糊的提問仍會澄清（不會因此放寬）", () => {
    expect(isUnclearTutorQuery("極權主義嗰啲嘢係點？", index, false)).toBe(true);
    expect(isUnclearTutorQuery("個德國係咪好慘", index, false)).toBe(true);
    expect(isUnclearTutorQuery("之後點", index, false)).toBe(true);
  });

  it("只打一個課程專名或練習題式問法都不再要求澄清（2026-11-02）", () => {
    expect(isUnclearTutorQuery("五功？", index, false)).toBe(false);
    expect(isUnclearTutorQuery("冷戰原因", index, false)).toBe(false);
    expect(isUnclearTutorQuery("試完成下表：三次工業革命的主要能源", index, false)).toBe(false);
    expect(isUnclearTutorQuery("請把以下事件按時序排列：鴉片戰爭、戊戌維新", index, false)).toBe(
      false,
    );
    expect(isUnclearTutorQuery("配對題：希特拉、明治天皇、列寧", index, false)).toBe(false);
  });

  it("DSE 指令詞、英文提問、錯別字都不再要求澄清（2026-11-02）", () => {
    expect(isUnclearTutorQuery("試就冷戰的結束，評論戈巴卓夫的角色。", index, false)).toBe(false);
    expect(isUnclearTutorQuery("舉兩個冷戰的例子。", index, false)).toBe(false);
    expect(isUnclearTutorQuery("Who was Hitler?", index, false)).toBe(false);
    expect(isUnclearTutorQuery("凡爾塞條約對德國有咩影響？", index, false)).toBe(false);
  });

  it("只有課題編號、沒有具體內容時會澄清（並以該課題的分節提供選項）", () => {
    expect(isUnclearTutorQuery("課題12有咩內容？", index, false)).toBe(true);
    expect(isUnclearTutorQuery("明天考歷史，幫我溫習課題9。", index, false)).toBe(true);
  });

  it("比較／背誦類問法及 4 字窗口錨點不會誤觸澄清（2026-11-02）", () => {
    expect(isUnclearTutorQuery("比較香港同新加坡嘅工業化。", index, false)).toBe(false);
    expect(isUnclearTutorQuery("阿sir話要背凡爾賽條約，點背？", index, false)).toBe(false);

    // 分節關鍵詞只差一個「的」：靠 4 字窗口仍算有具體錨點
    const modernisationIndex: TutorCurriculumIndex = {
      topics: [{ id: "hs-topic-2", title: "課題2：中國的現代化與蛻變" }],
      sectionsByTopic: new Map([
        [
          "hs-topic-2",
          [
            {
              id: "hs-topic-2-early",
              title: "中國早期的現代化努力：改革與革命",
              matchKeywords: ["洋務運動"],
            },
          ],
        ],
      ]),
    };
    expect(
      isUnclearTutorQuery("中國早期現代化努力有邊幾次改革？", modernisationIndex, false),
    ).toBe(false);
  });
});

describe("主題硬閘：香港學生的同義問法（2026-11-02）", () => {
  // 學生用平常的字眼問課程內容，但教材的分節關鍵詞是另一種寫法（四大古代文明／
  // 美國革命／英國侵佔香港）。逐字比對下會被當成離題，只收到固定引導句。
  it.each([
    "點解四大古文明都係喺大河旁邊興起？",
    "美國獨立革命有咩內外因素？",
    "美國獨立革命的原因",
    "英國係透過邊三條條約佔領香港？",
    "英國佔領香港之後的管治",
  ])("「%s」會被視為歷史提問", (raw) => {
    expect(isHistoryTopicPrompt(normalizeTutorQuery(raw))).toBe(true);
  });

  it("仍然不會放行明顯非歷史科的問題", () => {
    expect(isHistoryTopicPrompt(normalizeTutorQuery("幫我寫個 Python 程式"))).toBe(false);
    expect(isHistoryTopicPrompt(normalizeTutorQuery("今日天氣點呀？"))).toBe(false);
  });

  it("帶空格的英文專名亦可通過（2026-11-02 修正）", () => {
    // 之前 HISTORY_TERMS 只用 toLowerCase，保留了空格，而提問已去掉空格，
    // 令 "Industrial Revolution"、"Japanese occupation" 一律被當成離題。
    expect(isHistoryTopicPrompt(normalizeTutorQuery("Industrial Revolution 幾時開始？"))).toBe(
      true,
    );
    expect(
      isHistoryTopicPrompt(normalizeTutorQuery("Japanese occupation 期間香港發生咩事？")),
    ).toBe(true);
    expect(isHistoryTopicPrompt(normalizeTutorQuery("Cold War 同 WW2 有咩關係？"))).toBe(true);
  });

  it("錯一個字的專名仍屬歷史提問（2026-11-02）", () => {
    expect(isHistoryTopicPrompt(normalizeTutorQuery("凡爾塞條約對德國有咩影響？"))).toBe(true);
    expect(isHistoryTopicPrompt(normalizeTutorQuery("希特立係點樣上台？"))).toBe(true);
    expect(isHistoryTopicPrompt(normalizeTutorQuery("明治為新對日本有咩影響？"))).toBe(true);
  });
});
