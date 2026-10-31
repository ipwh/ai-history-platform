import { describe, expect, it } from "vitest";

import {
  buildClarifyCandidates,
  hasWeakHistorySignal,
  isClearlyNonHistoryTutorQuery,
  isUnclearTutorQuery,
  normalizeTutorQuery,
} from "@/server/services/tutor-query";
import type { TutorCurriculumIndex } from "@/server/services/tutor-grounding";
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
    ["係咩", "是什麼"],
    ["爆出嚟", "爆發"],
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
    expect(isClearlyNonHistoryTutorQuery(raw)).toBe(true);
    expect(hasWeakHistorySignal(raw)).toBe(false);
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
