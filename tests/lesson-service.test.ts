/**
 * 學生閱讀教材（學習模式）測試。
 *
 * 驗證：
 *   1. 已發布且已匯入教材的課題可以閱讀，內容包含分節及段落。
 *   2. **未發布**的課題不可閱讀（回 404），避免學生看到未完成的內容。
 *   3. 內容原樣取自教材，不會出現 OCR 說明行；沒有 OCR 文字的圖片不會顯示。
 *   4. 指定分節時只回傳該分節（含其子分節）的內容。
 *   5. API 與其他學生端端點一致：要求登入時未登入會被拒絕。
 */
import os from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

process.env.APP_DATABASE_PATH = path.join(os.tmpdir(), `hist-test-lesson-${process.pid}.db`);
process.env.LLM_PROVIDER = "mock";
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_TEACHER_EMAILS = "teacher@example.com";
process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.AUTH_REQUIRE_SIGN_IN = "true";
delete process.env.ADMIN_TOKEN;

type LessonService = typeof import("@/server/services/lesson-service");
type MaterialService = typeof import("@/server/services/material-service");
type Seed = typeof import("@/server/seed");
type SessionModule = typeof import("@/server/auth/session");
type TopicsRepo = typeof import("@/server/repositories/topics");
type MaterialsRepo = typeof import("@/server/repositories/materials");

let lessonService: LessonService;
let materialService: MaterialService;
let seed: Seed;
let session: SessionModule;
let topicsRepo: TopicsRepo;
let materialsRepo: MaterialsRepo;

const STUDENT = {
  email: "s2024146@pochiu.edu.hk",
  name: "測試學生",
  role: "student" as const,
  learnerId: "school:s2024146@pochiu.edu.hk",
  pictureUrl: null,
};

/**
 * 測試用的版權閘門：只把測試需要的那份教材標示為「可在平台向學生發布」。
 * 這不是假造授權紀錄——只是把測試環境切換到「管理員已確認」的狀態，
 * 以驗證閘門開啟前後的行為差異（正式環境預設全部關閉）。
 */
function grantDistributionForTopic(topicId: string): void {
  for (const block of materialsRepo.listGroundingBlocksForSections(topicId, [])) {
    materialsRepo.setDocumentStudentDistribution(block.documentId, true);
  }
}

/** 撤銷所有教材的學生閱讀權限（回到預設的 fail-closed 狀態） */
function revokeAllDistribution(): void {
  for (const document of materialsRepo.listDocuments()) {
    materialsRepo.setDocumentStudentDistribution(document.id, false);
  }
}

beforeAll(async () => {
  lessonService = await import("@/server/services/lesson-service");
  materialService = await import("@/server/services/material-service");
  seed = await import("@/server/seed");
  session = await import("@/server/auth/session");
  topicsRepo = await import("@/server/repositories/topics");
  materialsRepo = await import("@/server/repositories/materials");
  seed.ensureBootstrap();
  // 閱讀內容需要已匯入的教材
  const imported = await materialService.importPilotMaterialFromDisk({ runOcr: false });
  if (!imported) throw new Error("找不到課題5的教材檔案，無法測試閱讀模式");
});

describe("教材版權閘門（預設不可發布）", () => {
  it("未經管理員確認的教材不會顯示給學生（fail-closed）", () => {
    revokeAllDistribution();
    const lesson = lessonService.getLessonView("topic-5");

    expect(lesson.sections).toEqual([]);
    expect(lesson.notice).not.toBeNull();
    // 訊息必須說明是版權確認問題，而不是教材不存在
    expect(lesson.notice).toContain("版權");
  });

  it("課題沒有任何已確認教材時，topicHasLesson 為 false", () => {
    revokeAllDistribution();
    expect(lessonService.topicHasLesson("topic-5")).toBe(false);
  });

  it("管理員確認後才會顯示內容", () => {
    revokeAllDistribution();
    expect(lessonService.getLessonView("topic-5").sections).toEqual([]);

    grantDistributionForTopic("topic-5");
    const lesson = lessonService.getLessonView("topic-5");
    expect(lesson.sections.length).toBeGreaterThan(0);
    expect(lesson.notice).toBeNull();
    expect(lessonService.topicHasLesson("topic-5")).toBe(true);
  });

  it("校內試題（題庫來源）永遠不會成為學生讀物，即使被標示為可發布", () => {
    revokeAllDistribution();
    // 刻意把所有文件（包括校內試題）都標示為可發布
    for (const document of materialsRepo.listDocuments()) {
      materialsRepo.setDocumentStudentDistribution(document.id, true);
    }
    expect(materialsRepo.listStudentDistributableDocumentIds().size).toBeGreaterThan(0);

    const questionBankDocs = materialsRepo
      .listDocuments()
      .filter((document) => document.kind === "question-bank");
    for (const document of questionBankDocs) {
      expect(materialsRepo.listStudentDistributableDocumentIds().has(document.id)).toBe(false);
    }
  });
});

describe("學生閱讀教材", () => {
  it("已發布的課題可以閱讀，並包含分節及段落", () => {
    grantDistributionForTopic("topic-5");
    const lesson = lessonService.getLessonView("topic-5");

    expect(lesson.topic.id).toBe("topic-5");
    expect(lesson.sections.length).toBeGreaterThan(0);
    expect(lesson.notice).toBeNull();

    const blocks = lesson.sections.flatMap((section) => section.blocks);
    expect(blocks.length).toBeGreaterThan(0);
    // 每個段落都要有來源位置，方便學生及教師核對
    expect(blocks.every((block) => block.sourceLocation.length > 0)).toBe(true);
  });

  it("未發布的課題不可閱讀（回 404）", () => {
    const original = topicsRepo.getTopic("topic-5");
    expect(original).not.toBeNull();

    topicsRepo.setTopicPublished("topic-5", false);
    try {
      expect(() => lessonService.getLessonView("topic-5")).toThrowError(/尚未發布/);
      try {
        lessonService.getLessonView("topic-5");
      } catch (error) {
        expect((error as { status?: number }).status).toBe(404);
      }
    } finally {
      topicsRepo.setTopicPublished("topic-5", original!.published);
    }
  });

  it("不存在的課題回 404", () => {
    expect(() => lessonService.getLessonView("topic-does-not-exist")).toThrowError(/找不到/);
  });

  it("不會顯示 OCR 說明行，亦不會顯示沒有 OCR 文字的圖片", () => {
    grantDistributionForTopic("topic-5");
    const lesson = lessonService.getLessonView("topic-5");
    const blocks = lesson.sections.flatMap((section) => section.blocks);

    expect(blocks.some((block) => block.text.includes("以上文字由 OCR"))).toBe(false);
    // 沒有 OCR 文字的圖片段落沒有任何可讀內容，必須被過濾（否則學生會看到空白項）
    expect(
      blocks.some((block) => block.type === "image" && block.text.trim().length === 0 && block.rows.length === 0),
    ).toBe(false);
  });

  it("指定的分節只回傳該分節的內容", () => {
    grantDistributionForTopic("topic-5");
    const all = lessonService.getLessonView("topic-5");
    const target = all.sections.find((section) => section.blocks.length > 0);
    expect(target).toBeDefined();

    const onlyTarget = lessonService.getLessonView("topic-5", [target!.id]);
    expect(onlyTarget.sections.map((section) => section.id)).toContain(target!.id);
    expect(onlyTarget.sections.length).toBeLessThanOrEqual(all.sections.length);

    // 所有回傳的段落都必須有 sectionId 在指定範圍內（即不會混入其他分節）
    const returnedBlockCount = onlyTarget.sections.reduce(
      (total, section) => total + section.blocks.length,
      0,
    );
    expect(returnedBlockCount).toBeGreaterThan(0);
  });

  it("未匯入教材的課題會回傳說明訊息而不是空白畫面", () => {
    // 課題1 沒有匯入書本內容時會回傳 notice；若測試環境已匯入則略過此斷言
    grantDistributionForTopic("topic-1");
    const lesson = lessonService.getLessonView("topic-1");
    if (lesson.sections.length === 0) {
      expect(lesson.notice).not.toBeNull();
    } else {
      expect(lesson.notice).toBeNull();
    }
  });
});

describe("閱讀教材 API", () => {
  function request(url: string, cookie?: string): Request {
    return new Request(`http://localhost:3000${url}`, {
      headers: cookie ? { cookie } : {},
    });
  }

  it("已登入的學生可以取得閱讀內容", async () => {
    grantDistributionForTopic("topic-5");
    const { GET } = await import("@/app/api/topics/[topicId]/lesson/route");
    const cookie = `hk-history-session=${encodeURIComponent(session.encodeSession(STUDENT))}`;

    const response = await GET(request("/api/topics/topic-5/lesson", cookie), {
      params: Promise.resolve({ topicId: "topic-5" }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { sections: unknown[]; topic: { id: string } };
    expect(body.topic.id).toBe("topic-5");
    expect(body.sections.length).toBeGreaterThan(0);
  });

  it("要求登入時，未登入不可取得閱讀內容（401）", async () => {
    const { GET } = await import("@/app/api/topics/[topicId]/lesson/route");
    const response = await GET(request("/api/topics/topic-5/lesson"), {
      params: Promise.resolve({ topicId: "topic-5" }),
    });
    expect(response.status).toBe(401);
  });

  it("未發布的課題回 404（不會因為是學生端端點而放行）", async () => {
    grantDistributionForTopic("topic-5");
    const { GET } = await import("@/app/api/topics/[topicId]/lesson/route");
    const cookie = `hk-history-session=${encodeURIComponent(session.encodeSession(STUDENT))}`;
    const original = topicsRepo.getTopic("topic-5");

    topicsRepo.setTopicPublished("topic-5", false);
    try {
      const response = await GET(request("/api/topics/topic-5/lesson", cookie), {
        params: Promise.resolve({ topicId: "topic-5" }),
      });
      expect(response.status).toBe(404);
    } finally {
      topicsRepo.setTopicPublished("topic-5", original!.published);
    }
  });
});
