import { beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabasePath } from "./test-database";

// 使用獨立暫存資料庫，避免影響本機示範資料
const testDbPath = freshTestDatabasePath("curriculum");
process.env.APP_DATABASE_PATH = testDbPath;
process.env.LLM_PROVIDER = "mock";

type Curriculum = typeof import("@/server/seed/curriculum");
type Exclusions = typeof import("@/server/materials/exclusions");
type MaterialFiles = typeof import("@/server/materials/material-files");
type Seed = typeof import("@/server/seed");
type Topics = typeof import("@/server/repositories/topics");
type Questions = typeof import("@/server/repositories/questions");

let curriculum: Curriculum;
let materials: Exclusions;
let materialFiles: MaterialFiles;
let seed: Seed;
let topics: Topics;
let questions: Questions;

beforeAll(async () => {
  curriculum = await import("@/server/seed/curriculum");
  materials = await import("@/server/materials/exclusions");
  materialFiles = await import("@/server/materials/material-files");
  seed = await import("@/server/seed");
  topics = await import("@/server/repositories/topics");
  questions = await import("@/server/repositories/questions");
});

describe("教育局歷史科課程結構", () => {
  it("包含 12 個課題，全部屬於中一至中三", () => {
    const courseTopics = curriculum.CURRICULUM_TOPICS.filter((topic) => topic.level !== 0);
    expect(courseTopics).toHaveLength(12);
    expect(courseTopics.map((topic) => topic.topicNumber)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);

    expect(curriculum.CURRICULUM_TOPICS).toHaveLength(12);
  });

  it("課題按年級正確編排（中一 1-4、中二 5-8、中三 9-12）", () => {
    for (const topic of curriculum.CURRICULUM_TOPICS.filter((item) => item.level !== 0)) {
      const expectedLevel = Math.ceil((topic.topicNumber as number) / 4);
      expect(topic.level).toBe(expectedLevel);
    }
  });

  it("每個課題都有分節，且分節 ID 不重複", () => {
    const ids = new Set<string>();
    for (const topic of curriculum.CURRICULUM_TOPICS) {
      expect(topic.sections.length).toBeGreaterThan(0);
      for (const section of curriculum.flatSectionSeeds(topic.sections)) {
        expect(section.title.length).toBeGreaterThan(0);
        expect(ids.has(section.id)).toBe(false);
        ids.add(section.id);
      }
    }
    // 2026-10-20：按擁有者指示把各課題的分節整合為較少的主題，全課程分節總數由 91 降至 37。
    // 這裡保留一個下限，防止日後誤刪大量分節。
    expect(ids.size).toBeGreaterThan(30);
  });

  it("每個課程課題都對應一份教材檔案，並可由檔名反查", () => {
    for (const topic of curriculum.CURRICULUM_TOPICS) {
      expect(topic.materialFile).not.toBeNull();
      const found = curriculum.findTopicSeedByFile(topic.materialFile as string);
      expect(found?.id).toBe(topic.id);
    }
    // 教科書檔名（HNC1A2E_T1_SN_TE.docx → 課題1）
    expect(curriculum.findTopicSeedByFile("HNC1A2E_T1_SN_TE.docx")?.topicNumber).toBe(1);
    expect(curriculum.findTopicSeedByFile("HNC2A2E_T5_SN_TE.docx")?.topicNumber).toBe(5);
    expect(curriculum.findTopicSeedByFile("HNC3B_T11_SN_TE.docx")?.topicNumber).toBe(11);

    // 2026 學年起教材以課題資料夾存放，用相對路徑或資料夾名稱都能對應課題
    expect(
      curriculum.findTopicSeedByFile("課題5 近代歐洲的興起/課題5 近代歐洲的興起.docx")?.id,
    ).toBe("topic-5");
    expect(curriculum.findTopicSeedByFile("課題10 20 世紀的國際紛爭及危機 (II)")?.id).toBe(
      "topic-10",
    );
    expect(materialFiles.detectTopicId("課題7 美國的成立及發展/HNC2B2E_QB_T7_1.MCQ.docx")).toBe(
      "topic-7",
    );
    expect(materialFiles.detectTopicId("課題12 二十世紀香港的成長與蛻變")).toBe("topic-12");    expect(curriculum.findTopicSeedByFile("未知檔案.docx")).toBeNull();
  });

  it("課題標題與教育局課程一致", () => {
    const titleOf = (number: number) =>
      curriculum.CURRICULUM_TOPICS.find((topic) => topic.topicNumber === number)?.title ?? "";

    expect(titleOf(1)).toContain("人類的需要");
    expect(titleOf(4)).toContain("早期香港地區");
    expect(titleOf(5)).toContain("近代歐洲的興起");
    expect(titleOf(9)).toContain("兩次世界大戰");
    expect(titleOf(12)).toContain("20世紀香港");
  });
});

describe("課程結構寫入資料庫", () => {
  it("建立全部課題及分節，並記錄年級及課題編號", () => {
    const report = seed.seedCurriculum();
    expect(report.topics).toBe(12);
    expect(report.sections).toBeGreaterThan(30);

    const stored = topics.listTopics();
    expect(stored).toHaveLength(12);
    expect(topics.listTopics({ publishedOnly: true })).toHaveLength(12);

    const topic5 = topics.getTopic("topic-5");
    expect(topic5?.level).toBe(2);
    expect(topic5?.topicNumber).toBe(5);

    const overview = topics.getTopicOverview("topic-5", null);
    expect(overview?.levelLabel).toBe("中二");
    expect(overview?.themeText).toContain("近代世界");
    expect(overview?.themeText).toContain("西力的形成與外延");
  });

  it("中一至中三的課題主題文字正確", () => {
    const level1 = topics.getTopicOverview("topic-1", null);
    expect(level1?.themeText).toBe("古代世界（史前時期至 14 世紀）：區域文明的誕生與交流");

    const level3 = topics.getTopicOverview("topic-12", null);
    expect(level3?.themeText).toBe("現代世界（20 世紀至今）：邁向多極與相互依存");
  });

  it("重複執行課程種子不會產生重複課題", () => {
    seed.seedCurriculum();
    seed.seedCurriculum();
    expect(topics.listTopics()).toHaveLength(12);
    expect(questions.countQuestions({ topicId: "topic-1" })).toBe(0);
  });

  it("已由課程刪除的分節不會再出現（只有標題、沒有內容的「不同地區的舊石器時代人類」）", () => {
    seed.seedCurriculum();
    const sections = topics.listSections("topic-1");
    expect(sections.some((section) => section.id === "topic-1-origins-regions")).toBe(false);
    // 教材本身亦不會再匯入該標題（見 materials/exclusions.ts）
    expect(
      materials.isExcludedText("topic-1", "不同地區的舊石器時代人類"),
    ).toBe(true);
    expect(materials.isExcludedText("topic-1", "舊石器時代")).toBe(false);
  });
});
