import { beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabasePath } from "./test-database";

// 使用獨立暫存資料庫，避免影響本機示範資料
const testDbPath = freshTestDatabasePath("senior-curriculum");
process.env.APP_DATABASE_PATH = testDbPath;
process.env.LLM_PROVIDER = "mock";

type Curriculum = typeof import("@/server/seed/curriculum");
type SeniorFocus = typeof import("@/server/seed/senior-curriculum-focus");
type CurriculumFocus = typeof import("@/server/seed/curriculum-focus");
type Seed = typeof import("@/server/seed");
type Topics = typeof import("@/server/repositories/topics");
type Types = typeof import("../src/lib/types");
type Prompt = typeof import("@/server/llm/prompt");

let curriculum: Curriculum;
let seniorFocus: SeniorFocus;
let focus: CurriculumFocus;
let seed: Seed;
let topics: Topics;
let types: Types;
let prompt: Prompt;

beforeAll(async () => {
  curriculum = await import("@/server/seed/curriculum");
  seniorFocus = await import("@/server/seed/senior-curriculum-focus");
  focus = await import("@/server/seed/curriculum-focus");
  seed = await import("@/server/seed");
  topics = await import("@/server/repositories/topics");
  types = await import("../src/lib/types");
  prompt = await import("@/server/llm/prompt");
});

describe("高中歷史科課程結構", () => {
  it("包含 5 個高中課題，分屬主題甲及主題乙", () => {
    const senior = curriculum.SENIOR_CURRICULUM_TOPICS;
    expect(senior).toHaveLength(5);
    expect(senior.map((topic) => topic.id)).toEqual([
      "hs-topic-1",
      "hs-topic-2",
      "hs-topic-3",
      "hs-topic-4",
      "hs-topic-5",
    ]);
    for (const topic of senior) {
      expect(topic.level).toBe(4);
      // 高中課題不重用初中課題編號，避免把初中學習重點套用到高中題目。
      expect(topic.topicNumber).toBeNull();
      expect(topic.published).toBe(false);
    }
    expect(senior.filter((topic) => topic.curriculumTheme === "A")).toHaveLength(3);
    expect(senior.filter((topic) => topic.curriculumTheme === "B")).toHaveLength(2);
  });

  it("共 23 個分節（主題甲 16、主題乙 7），分節 ID 不重複", () => {
    const ids = new Set<string>();
    let count = 0;
    let themeACount = 0;
    for (const topic of curriculum.SENIOR_CURRICULUM_TOPICS) {
      expect(topic.sections.length).toBeGreaterThan(0);
      for (const section of topic.sections) {
        expect(section.title.length).toBeGreaterThan(0);
        expect(section.matchKeywords.length).toBeGreaterThan(0);
        expect(ids.has(section.id)).toBe(false);
        ids.add(section.id);
        count += 1;
        if (topic.curriculumTheme === "A") themeACount += 1;
      }
    }
    expect(count).toBe(23);
    expect(themeACount).toBe(16);
  });

  it("按校本範圍不設 3.2 東南亞及 4.3.2 其他衝突", () => {
    const topic3 = curriculum.SENIOR_CURRICULUM_TOPICS.find((topic) => topic.id === "hs-topic-3");
    const topic4 = curriculum.SENIOR_CURRICULUM_TOPICS.find((topic) => topic.id === "hs-topic-4");
    expect(topic3?.sections).toHaveLength(5);
    expect(topic3?.sections.every((section) => !/東南亞/.test(section.title))).toBe(true);
    // 4.1、4.2、4.3.1 各為一個分節，另把 4.2 分成「巴黎和會／集體安全」及「二戰及戰後安排」。
    expect(topic4?.sections).toHaveLength(4);
    expect(topic4?.sections.every((section) => !/其他主要衝突/.test(section.title))).toBe(true);
    // 課題說明要列明校本範圍，避免學生誤以為漏教。
    expect(topic3?.description).toContain("不設 3.2");
    expect(topic4?.description).toContain("不設 4.3.2");
  });

  it("每份已上載教材都能反查所屬高中課題", () => {
    const files = [
      "1.1 香港的政治及行政轉變筆記答案.docx",
      "1.2 香港作為國際城市的發展筆記答案.docx",
      "2.1 中國早期的現代化努力 — 改革與革命筆記答案.docx",
      "2.2 毛澤東時代的社會主義現代化筆記答案.docx",
      "3.1 日本的現代化與蛻變筆記答案.docx",
      "4.1 1900年至1914年的國際關係筆記答案.docx",
      "4.2 兩次世界大戰及有關和約的簽署筆記答案.docx",
      "4.3.1 超級大國的對抗與關係緩和筆記答案.docx",
      "5.1 經濟方面的國際協作筆記答案.docx",
      "5.2 社會及文化方面的國際協作筆記答案.docx",
    ];
    for (const file of files) {
      const found = curriculum.findTopicSeedByFile(file);
      expect(found).not.toBeNull();
      expect(found?.id.startsWith("hs-topic-")).toBe(true);
    }
    expect(curriculum.findTopicSeedByFile(files[1])?.id).toBe("hs-topic-1");
    expect(curriculum.findTopicSeedByFile(files[3])?.id).toBe("hs-topic-2");
    expect(curriculum.findTopicSeedByFile(files[4])?.id).toBe("hs-topic-3");
    expect(curriculum.findTopicSeedByFile(files[5])?.id).toBe("hs-topic-4");
    expect(curriculum.findTopicSeedByFile(files[7])?.id).toBe("hs-topic-4");
    expect(curriculum.findTopicSeedByFile(files[8])?.id).toBe("hs-topic-5");
    expect(curriculum.findTopicSeedByFile(files[9])?.id).toBe("hs-topic-5");
  });

  it("主題乙教材聲明所屬分節，避免通用字眼令段落跨節錯配", () => {
    // 4.2 提及「第一次世界大戰」，但只可歸入課題4 的兩個分節，不可歸入 4.1 的分節。
    expect(
      curriculum.declaredSectionsForFile("4.2 兩次世界大戰及有關和約的簽署筆記答案.docx"),
    ).toEqual(["hs-topic-4-paris", "hs-topic-4-world-war-two"]);
    expect(
      curriculum.declaredSectionsForFile("4.3.1 超級大國的對抗與關係緩和筆記答案.docx"),
    ).toEqual(["hs-topic-4-cold-war"]);
    expect(
      curriculum.declaredSectionsForFile("5.2 社會及文化方面的國際協作筆記答案.docx"),
    ).toEqual(["hs-topic-5-population", "hs-topic-5-health-tech"]);
    // 主題甲以關鍵詞對應（一份筆記可橫跨多個分節），不設限。
    expect(curriculum.declaredSectionsForFile("1.2 香港作為國際城市的發展筆記答案.docx")).toBeNull();
  });

  it("高中課題的主題文字及學習重點可供出題使用", () => {
    expect(types.curriculumThemeText(4, "A")).toContain("主題甲");
    expect(types.curriculumThemeText(4, "B")).toContain("主題乙");
    expect(types.curriculumThemeText(1)).toContain("古代世界");

    expect(seniorFocus.seniorLearningFocusText("hs-topic-1")).toContain("政治及行政轉變");
    expect(seniorFocus.seniorLearningFocusText("hs-topic-2")).toContain("改革開放");
    expect(seniorFocus.seniorLearningFocusText("unknown")).toBe("");

    // 高中課題必須使用高中學習重點，不可回退到初中同一編號的內容。
    expect(
      focus.learningFocusTextForTopic({ id: "hs-topic-4", level: 4, topicNumber: null }),
    ).toContain("冷戰");
    expect(
      focus.learningFocusTextForTopic({ id: "topic-5", level: 2, topicNumber: 5 }),
    ).toContain("近代歐洲的興起");
  });

  it("高中出題使用高中版系統提示，不會沿用初中要求", () => {
    const senior = prompt.systemPromptFor("senior");
    expect(senior).toContain("中四至中六");
    expect(senior).toContain("二十世紀");
    expect(senior).toContain("因果關係");

    const junior = prompt.systemPromptFor("junior");
    expect(junior).toContain("中一至中三");
    expect(junior).not.toContain("中四至中六");
  });

  it("種子寫入資料庫時保留階段及主題", () => {
    seed.seedCurriculum();
    const stored = topics.getTopic("hs-topic-1");
    expect(stored?.level).toBe(4);
    expect(stored?.curriculumTheme).toBe("A");
    expect(stored?.published).toBe(false);
    expect(topics.listSections("hs-topic-1")).toHaveLength(5);

    const overview = topics.getTopicOverview("hs-topic-1", null);
    expect(overview?.levelLabel).toBe("中四至中六");
    expect(overview?.themeText).toContain("主題甲");
    expect(overview?.themeText).toContain("二十世紀亞洲的現代化與蛻變");
  });

  it("再次執行課程種子不會把已發布的高中課題下架", () => {
    seed.seedCurriculum();
    topics.setTopicPublished("hs-topic-1", true);
    seed.seedCurriculum();
    expect(topics.getTopic("hs-topic-1")?.published).toBe(true);
  });
});
