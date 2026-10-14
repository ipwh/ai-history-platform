import { describe, expect, it } from "vitest";

import { HISTORY_CONCEPTS, HISTORY_SKILLS } from "@/lib/types";
import { buildUserPrompt, SYSTEM_PROMPT } from "@/server/llm/prompt";
import { topicLearningFocusText } from "@/server/seed/curriculum-focus";
import type { QuestionGenerationInput } from "@/server/llm/provider";

const input: QuestionGenerationInput = {
  topicTitle: "課題5：近代歐洲的興起",
  sectionTitle: "文藝復興 › 主要特點",
  questionTypes: ["mc", "short"],
  difficulty: "advanced",
  count: 3,
  materialUnits: [
    {
      blockId: "block-1",
      sourceLocation: "HNC2A2E_T5_SN_TE.docx 第 1 段",
      text: "文藝復興時期，歐洲人重視人文主義。",
    },
  ],
};

describe("出題提示詞的歷史科要求", () => {
  it("只可使用教材段落出題，並明文禁止杜撰", () => {
    expect(SYSTEM_PROMPT).toContain("只可使用使用者提供的「教材段落」內容出題");
    expect(SYSTEM_PROMPT).toContain("不得加入教材沒有交代的歷史事實");
    expect(SYSTEM_PROMPT).toContain("教材沒有提及的年份一律不可出現");
    expect(buildUserPrompt(input)).toContain("教材沒有交代的年份");
  });

  it("列出歷史科課程重視的歷史概念及歷史技能", () => {
    for (const concept of HISTORY_CONCEPTS) {
      expect(SYSTEM_PROMPT).toContain(concept);
    }
    for (const skill of HISTORY_SKILLS) {
      expect(SYSTEM_PROMPT).toContain(skill);
    }
  });

  it("要求切合年級、課程主題、課題及分節，並分清難度要求", () => {
    expect(SYSTEM_PROMPT).toContain("切合使用者指出的年級、課程主題、課題及分節");
    expect(buildUserPrompt(input)).toContain("難度要求：");
  });

  it("要求用語沿用教材寫法（繁體中文）並符合歷史科提問慣例", () => {
    expect(SYSTEM_PROMPT).toContain("用語必須符合香港歷史科的書面語");
    expect(SYSTEM_PROMPT).toContain("沿用教材的寫法");
    expect(SYSTEM_PROMPT).toContain("提問用語要符合香港歷史科的慣常用法");
  });

  it("要求選擇題只有一個明確正確答案，錯誤選項不可虛構", () => {
    expect(SYSTEM_PROMPT).toContain("只有一個明確的正確答案");
    expect(SYSTEM_PROMPT).toContain("不可虛構不存在的人物、事件、年份或條約");
  });

  it("使用者提示帶入年級及課程主題，方便模型掌握課程脈絡", () => {
    const prompt = buildUserPrompt({
      ...input,
      levelLabel: "中二",
      themeText: "近代世界（15 至 19 世紀）：西力的形成與外延",
    });

    expect(prompt).toContain("年級：中二");
    expect(prompt).toContain("課程主題：近代世界（15 至 19 世紀）：西力的形成與外延");
    expect(prompt).toContain("課題：課題5：近代歐洲的興起");
  });

  it("沒有年級及課程主題時不會留下空標籤", () => {
    const prompt = buildUserPrompt(input);

    expect(prompt).not.toContain("年級：");
    expect(prompt).not.toContain("課程主題：");
    expect(prompt.startsWith("課題：")).toBe(true);
  });

  it("系統提示載明教育局《歷史科學習目標》精簡摘要及「不須強記」的要求", () => {
    expect(SYSTEM_PROMPT).toContain("教育局《歷史科學習目標》的精簡摘要");
    expect(SYSTEM_PROMPT).toContain("不須強記");
    expect(SYSTEM_PROMPT).toContain("知識和理解：");
    expect(SYSTEM_PROMPT).toContain("態度和價值觀：");
  });

  it("使用者提示帶入課題的學習重點，並說明它不是史實依據", () => {
    const prompt = buildUserPrompt({
      ...input,
      learningFocusText: topicLearningFocusText(5),
    });

    expect(prompt).toContain("課程學習重點（教育局《預期學習內容》精簡摘要）");
    expect(prompt).toContain("文藝復興");
    expect(prompt).toContain("避免學生強記人名及作品名稱");
    expect(prompt).toContain("不是史實依據");
    expect(prompt).toContain("教材段落：");
  });

  it("沒有學習重點時不會留下空標籤", () => {
    const prompt = buildUserPrompt(input);

    expect(prompt).not.toContain("課程學習重點");
    expect(prompt).not.toContain("不是史實依據");
  });
});
