import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildTutorSystemPrompt, type TutorGrounding } from "@/server/services/tutor-grounding";
import {
  buildPracticeSuggestedQuestions,
  describeTutorPracticeContextForPrompt,
} from "@/server/services/tutor-practice-context";
import {
  getTutorTopicCard,
  loadTutorTopicCards,
  parseTutorTopicCard,
} from "@/server/services/tutor-topic-cards";
import { SEED_TUTOR_TOPIC_CARDS } from "@/server/seed/tutor-topic-cards";
import { tutorQueryWasRewritten } from "@/server/services/tutor-query";

const EMPTY_GROUNDING: TutorGrounding = {
  status: "not-covered",
  topicId: null,
  topicTitle: null,
  sources: [],
  passages: [],
};

function groundingWithPassage(): TutorGrounding {
  return {
    status: "grounded",
    topicId: "topic-9",
    topicTitle: "課題9：20次世界大戰",
    sources: [{ blockId: "block-1", documentLabel: "課題9 筆記", location: "第 2 段", excerpt: "限制軍隊數目" }],
    passages: [
      {
        anchorBlockId: "block-1",
        documentId: "doc-1",
        documentLabel: "課題9 筆記",
        location: "第 2 段",
        promptText: "《凡爾賽條約》規定德國須限制軍隊數目。",
        excerpt: "限制軍隊數目",
        score: 12,
      },
    ],
  };
}

describe("學伴回覆結構（固定短結構）", () => {
  it("系統提示包含四段結構要求及下一步引導", () => {
    const prompt = buildTutorSystemPrompt({ grounding: EMPTY_GROUNDING });
    expect(prompt).toContain("【回覆結構】");
    expect(prompt).toContain("1. 一句定位");
    expect(prompt).toContain("2. 二至三點線索或引導問題");
    expect(prompt).toContain("3. 依據說明");
    expect(prompt).toContain("4. 「下一步你可以問……」");
    expect(prompt).toContain("避免長篇議論");
  });

  it("要求先更正學生的錯誤前提，不可順着錯誤前題作答（2026-11-06 實測）", () => {
    const prompt = buildTutorSystemPrompt({ grounding: EMPTY_GROUNDING });
    expect(prompt).toContain("前提與教材片段不符");
    expect(prompt).toContain("必須先直接指出並更正");
  });

  it("要求以繁體書面語回覆，不可用粵語口語書寫（2026-11-06 實測）", () => {
    const prompt = buildTutorSystemPrompt({ grounding: EMPTY_GROUNDING });
    expect(prompt).toContain("繁體**書面語**");
    expect(prompt).toContain("不可用粵語口語書寫");
    // 仍然要理解粵語提問，只是不以口語作答
    expect(prompt).toContain("香港粵語");
  });

  it("不會削弱既有的禁代抄及禁背全文要求", () => {
    const prompt = buildTutorSystemPrompt({ grounding: groundingWithPassage() });
    expect(prompt).toContain("不直接代做功課");
    expect(prompt).toContain("提出引導問題");
    expect(prompt).toContain("不可提供可直接提交的完整作業答案");
    expect(prompt).toContain("不要複述片段原文");
  });

  it("有練習上下文時加入獨立區塊，並明確禁止給出答案", () => {
    const block = describeTutorPracticeContextForPrompt({
      questionId: "q-1",
      topicId: "topic-9",
      topicTitle: "課題9：兩次世界大戰",
      questionType: "填充題",
      skill: "準確排列歷史事件的次序",
      stemSummary: "《凡爾賽條約》規定德國在軍事上須＿＿＿。",
      suggestedQuestions: [],
    });
    const prompt = buildTutorSystemPrompt({
      grounding: groundingWithPassage(),
      practiceContextBlock: block,
    });
    expect(prompt).toContain("【練習上下文");
    expect(prompt).toContain("不要直接給出這題的答案");
    expect(prompt).toContain("不要猜測官方答案");
    expect(prompt).toContain("準確排列歷史事件的次序");
  });

  it("有學習目標時加入 soft prior 區塊，並保留「以當前提問為準」", () => {
    const prompt = buildTutorSystemPrompt({
      grounding: EMPTY_GROUNDING,
      goalTopicTitle: "課題5：近代歐洲的興起",
    });
    expect(prompt).toContain("【學習目標】");
    expect(prompt).toContain("課題5：近代歐洲的興起");
    expect(prompt).toContain("以學生當前的問題為準");
  });
});

describe("回覆深度（2026-11-06）", () => {
  it("進階深度改用分析框架結構，並保留禁代抄底線", () => {
    const prompt = buildTutorSystemPrompt({ grounding: EMPTY_GROUNDING, depth: "advanced" });
    expect(prompt).toContain("【回覆結構：進階分析】");
    expect(prompt).toContain("分析框架");
    expect(prompt).toContain("張力與反駁");
    expect(prompt).toContain("【分析角度】");
    expect(prompt).toContain("不可提供可直接提交的完整作業答案");
    expect(prompt).toContain("不可直接提交為作業");
  });

  it("進階／挑戰深度要求短追問先按上文作答，而不是只給選項", () => {
    for (const depth of ["advanced", "challenge"] as const) {
      const prompt = buildTutorSystemPrompt({ grounding: EMPTY_GROUNDING, depth });
      expect(prompt).toContain("先按上文最核心的一點作答");
    }
  });

  it("挑戰深度加入立場光譜、判斷準則及反駁任務", () => {
    const prompt = buildTutorSystemPrompt({ grounding: EMPTY_GROUNDING, depth: "challenge" });
    expect(prompt).toContain("【回覆結構：挑戰・史觀】");
    expect(prompt).toContain("立場光譜");
    expect(prompt).toContain("判斷準則");
    expect(prompt).toContain("挑戰任務");
    expect(prompt).toContain("不可虛構史實");
  });

  it("預設深度保持原本的四段精簡結構", () => {
    const prompt = buildTutorSystemPrompt({ grounding: EMPTY_GROUNDING });
    expect(prompt).not.toContain("【回覆結構：進階分析】");
    expect(prompt).not.toContain("【回覆結構：挑戰・史觀】");
    expect(prompt).not.toContain("【分析角度】");
  });
});

describe("課題卡（M2）", () => {
  it("內建課題卡不含答案或評卷字樣", () => {
    expect(SEED_TUTOR_TOPIC_CARDS.length).toBeGreaterThan(0);
    for (const card of SEED_TUTOR_TOPIC_CARDS) {
      const text = [card.title, ...card.suggestedQuestions, ...card.confusionPoints].join(" ");
      expect(text).not.toMatch(/答案|正確選項|評分|標準答案|解釋：/);
    }
  });

  it("有課題卡時建議問題優先使用卡片內容", () => {
    const suggestions = buildPracticeSuggestedQuestions({
      topicId: "topic-9",
      topicTitle: "課題9：20世紀的國際紛爭及危機(I)–兩次世界大戰",
      sectionTitle: "兩次大戰期間",
      skill: null,
    });
    const card = SEED_TUTOR_TOPIC_CARDS.find((entry) => entry.topicId === "topic-9");
    expect(card).toBeDefined();
    expect(suggestions[0]).toBe(card!.suggestedQuestions[0]);
    expect(suggestions.length).toBeLessThanOrEqual(3);
  });

  it("沒有課題卡的課題會退回以分節／技能／課題名稱產生建議問題", () => {
    const suggestions = buildPracticeSuggestedQuestions({
      topicId: "topic-404",
      topicTitle: "課題404：測試課題",
      sectionTitle: "測試分節的內容",
      skill: "從歷史資料中作出歸納和推論",
    });
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((question) => question.includes("歸納和推論"))).toBe(true);
  });

  it("data 目錄的卡片會覆蓋內建卡片；格式錯誤的檔案會被忽略", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-cards-"));
    try {
      fs.writeFileSync(
        path.join(dir, "topic-9.json"),
        JSON.stringify({
          topicId: "topic-9",
          title: "校內自訂課題9",
          suggestedQuestions: ["校內自訂問題一？", "校內自訂問題二？"],
          confusionPoints: ["校內自訂混淆點"],
        }),
      );
      fs.writeFileSync(path.join(dir, "broken.json"), "{ not json");
      fs.writeFileSync(path.join(dir, "invalid.json"), JSON.stringify({ title: "沒有 topicId" }));

      const cards = loadTutorTopicCards(dir);
      expect(cards.get("topic-9")?.title).toBe("校內自訂課題9");
      expect(cards.get("topic-5")?.title).toContain("課題5");
      expect(getTutorTopicCard("topic-9", dir)?.suggestedQuestions).toEqual([
        "校內自訂問題一？",
        "校內自訂問題二？",
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("卡片解析會丟棄空項目並限制長度", () => {
    const card = parseTutorTopicCard({
      topicId: " topic-x ",
      title: "x".repeat(200),
      suggestedQuestions: ["問題一？", "", 42, "問題二？"],
      confusionPoints: ["混淆一", "  "],
    });
    expect(card?.topicId).toBe("topic-x");
    expect(card?.title.length).toBeLessThanOrEqual(120);
    expect(card?.suggestedQuestions).toEqual(["問題一？", "問題二？"]);
    expect(card?.confusionPoints).toEqual(["混淆一"]);
    expect(parseTutorTopicCard(null)).toBeNull();
    expect(parseTutorTopicCard({ topicId: "" })).toBeNull();
  });
});

describe("正規化改寫判斷（事件記錄用）", () => {
  it("只統一標點或大小寫不算改寫", () => {
    expect(tutorQueryWasRewritten("凡爾賽條約如何約束德國？", "凡爾賽條約如何約束德國")).toBe(false);
    expect(tutorQueryWasRewritten("幫我寫 Python", "幫我寫python")).toBe(false);
  });

  it("實際換詞才算改寫", () => {
    expect(tutorQueryWasRewritten("文藝復興喺邊度開始？", "文藝復興在邊度開始")).toBe(true);
    expect(tutorQueryWasRewritten("希特勒做過乜？", "希特拉做過什麼")).toBe(true);
  });
});
