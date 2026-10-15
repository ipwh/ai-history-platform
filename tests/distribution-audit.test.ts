/**
 * 教材發行權（學生閱讀權限）管理測試。
 *
 * 驗證：
 *   1. 預設為關閉（fail-closed）：沒有管理員確認前，學生不會看到教材內容。
 *   2. 只有管理員可以變更發行權（學生及未登入者被拒），且學生的閱讀範圍只受
 *      `student_distribution` 影響。
 *   3. 每次變更都會留下「誰在何時」的稽核記錄，操作者取自伺服器端的工作階段
 *      （前端傳來的值不會被採用）；重複設定相同值不會產生重複記錄。
 *   4. 關閉後立即生效：下一次讀取即不再顯示內容（沒有快取）。
 *   5. **教師版／混合文件**：檔名標示為教師版時需額外確認；教師專用段落
 *      （答案、評分參考）不會顯示給學生，亦不會被當成「有教材可讀」。
 *   6. 邊界情況：未知文件 ID、重複請求、先開放後撤銷。
 */
import os from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

process.env.APP_DATABASE_PATH = path.join(os.tmpdir(), `hist-test-distribution-${process.pid}.db`);
process.env.LLM_PROVIDER = "mock";
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_TEACHER_EMAILS = "teacher@example.com";
process.env.AUTH_ADMIN_EMAILS = "admin@example.com,admin2@example.com";
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
delete process.env.ADMIN_TOKEN;
delete process.env.K_SERVICE;

type SessionModule = typeof import("@/server/auth/session");
type SeedModule = typeof import("@/server/seed");
type MaterialsRepo = typeof import("@/server/repositories/materials");
type LessonService = typeof import("@/server/services/lesson-service");
type MaterialService = typeof import("@/server/services/material-service");
type TeacherContent = typeof import("@/server/materials/teacher-content");

let session: SessionModule;
let seed: SeedModule;
let materialsRepo: MaterialsRepo;
let lessonService: LessonService;
let materialService: MaterialService;
let teacherContent: TeacherContent;

const STUDENT = {
  email: "s2024146@pochiu.edu.hk",
  name: "測試學生",
  role: "student" as const,
  learnerId: "school:s2024146@pochiu.edu.hk",
  pictureUrl: null,
};
const ADMIN = {
  email: "admin@example.com",
  name: "測試管理員",
  role: "admin" as const,
  learnerId: "admin:admin@example.com",
  pictureUrl: null,
};
const OTHER_ADMIN = {
  ...ADMIN,
  email: "admin2@example.com",
  learnerId: "admin:admin2@example.com",
};

function cookieFor(user: typeof STUDENT | typeof ADMIN | typeof OTHER_ADMIN): string {
  return `hk-history-session=${encodeURIComponent(session.encodeSession(user))}`;
}

function patchDocument(
  documentId: string,
  body: Record<string, unknown>,
  cookie?: string,
): Promise<Response> {
  return import("@/app/api/admin/materials/[documentId]/route").then(({ PATCH }) =>
    PATCH(
      new Request(`http://localhost:3000/api/admin/materials/${documentId}`, {
        method: "PATCH",
        headers: {
          ...(cookie ? { cookie } : {}),
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ documentId }) },
    ),
  );
}

/** 測試用的教材文件（課題5的教材由 seed 建立） */
function pilotDocumentId(): string {
  const document = materialsRepo.listDocuments()[0];
  if (!document) throw new Error("找不到測試用教材文件");
  return document.id;
}

beforeAll(async () => {
  session = await import("@/server/auth/session");
  seed = await import("@/server/seed");
  materialsRepo = await import("@/server/repositories/materials");
  lessonService = await import("@/server/services/lesson-service");
  materialService = await import("@/server/services/material-service");
  teacherContent = await import("@/server/materials/teacher-content");
  seed.ensureBootstrap();
  // 發行權是針對教材文件，因此測試需要已匯入的教材（與 lesson-service 測試一致）
  const imported = await materialService.importPilotMaterialFromDisk({ runOcr: false });
  if (!imported) throw new Error("找不到課題5的教材檔案，無法測試發行權");
});

describe("教材發行權（fail-closed 及稽核記錄）", () => {
  it("預設關閉：未確認的教材不會顯示給學生", () => {
    const documentId = pilotDocumentId();
    materialsRepo.setDocumentStudentDistribution(documentId, false);
    expect(lessonService.getLessonView("topic-5").sections).toEqual([]);
    expect(materialsRepo.listStudentDistributableDocumentIds().size).toBe(0);
  });

  it("學生不可變更發行權（403），亦不會留下稽核記錄", async () => {
    const documentId = pilotDocumentId();
    const response = await patchDocument(documentId, { studentDistribution: true }, cookieFor(STUDENT));
    expect(response.status).toBe(403);
    expect(materialsRepo.listDistributionAudit(documentId)).toEqual([]);
  });

  it("未登入不可變更發行權（401）", async () => {
    const documentId = pilotDocumentId();
    const response = await patchDocument(documentId, { studentDistribution: true });
    expect(response.status).toBe(401);
    expect(materialsRepo.listDistributionAudit(documentId)).toEqual([]);
  });

  it("不在管理員名單的帳戶不可變更發行權（角色重新判定後 403）", async () => {
    const documentId = pilotDocumentId();
    const revoked = {
      ...ADMIN,
      email: "removed-admin@example.com",
      learnerId: "admin:removed-admin@example.com",
    };
    const response = await patchDocument(
      documentId,
      { studentDistribution: true },
      cookieFor(revoked),
    );
    expect(response.status).toBe(403);
    expect(materialsRepo.listDistributionAudit(documentId)).toEqual([]);
  });

  it("管理員開放後，學生可讀取內容，並留下操作者及時間的記錄", async () => {
    const documentId = pilotDocumentId();
    const response = await patchDocument(documentId, { studentDistribution: true }, cookieFor(ADMIN));
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      document: { studentDistribution: boolean };
      distributionAudit: { allowed: boolean; actorEmail: string; createdAt: string }[];
    };
    expect(body.document.studentDistribution).toBe(true);
    expect(body.distributionAudit).toHaveLength(1);
    expect(body.distributionAudit[0].allowed).toBe(true);
    expect(body.distributionAudit[0].actorEmail).toBe(ADMIN.email);
    expect(Number.isNaN(Date.parse(body.distributionAudit[0].createdAt))).toBe(false);

    expect(materialsRepo.listStudentDistributableDocumentIds().has(documentId)).toBe(true);
    expect(lessonService.getLessonView("topic-5").sections.length).toBeGreaterThan(0);
  });

  it("關閉後立即生效，並記錄是另一位管理員所為", async () => {
    const documentId = pilotDocumentId();
    materialsRepo.setDocumentStudentDistribution(documentId, true);

    const response = await patchDocument(
      documentId,
      { studentDistribution: false },
      cookieFor(OTHER_ADMIN),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      distributionAudit: { allowed: boolean; actorEmail: string }[];
    };
    // 最新一筆在最前
    expect(body.distributionAudit[0].allowed).toBe(false);
    expect(body.distributionAudit[0].actorEmail).toBe(OTHER_ADMIN.email);

    expect(lessonService.getLessonView("topic-5").sections).toEqual([]);
    expect(materialsRepo.listStudentDistributableDocumentIds().has(documentId)).toBe(false);
  });

  it("前端提供的操作者欄位不會被採用（記錄一律來自工作階段）", async () => {
    const documentId = pilotDocumentId();
    const response = await patchDocument(
      documentId,
      { studentDistribution: true, actorEmail: "attacker@example.com", actor: "attacker" },
      cookieFor(ADMIN),
    );
    expect(response.status).toBe(200);
    const latest = materialsRepo.listDistributionAudit(documentId)[0];
    expect(latest.actorEmail).toBe(ADMIN.email);
  });

  it("只更新課題時不會產生發行權記錄（避免稽核記錄被無關操作污染）", async () => {
    const documentId = pilotDocumentId();
    const before = materialsRepo.listDistributionAudit(documentId).length;
    const response = await patchDocument(documentId, { topicId: "topic-5" }, cookieFor(ADMIN));
    expect(response.status).toBe(200);
    expect(materialsRepo.listDistributionAudit(documentId).length).toBe(before);
  });

  it("校內試題文件永遠不會成為學生讀物", () => {
    const questionBank = materialsRepo
      .listDocuments()
      .find((document) => document.kind === "question-bank");
    if (!questionBank) return;
    materialsRepo.setDocumentStudentDistribution(questionBank.id, true);
    expect(materialsRepo.listStudentDistributableDocumentIds().has(questionBank.id)).toBe(false);
  });
});

describe("教師版／混合文件（不可只因 kind 不是試題檔就當作學生內容）", () => {
  /** 建立一份「教師版」文件：包含學生段落及教師專用的答案段落 */
  function createTeacherEditionDocument(sectionId: string, topicId: string) {
    const document = materialsRepo.createDocument({
      fileName: "E2E2A2E_T5_SN_TE.docx",
      kind: "demo",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 1024,
      status: "ready",
      topicId,
      sourceNote: null,
    });
    materialsRepo.insertBlocks([
      {
        documentId: document.id,
        topicId,
        sectionId,
        order: 0,
        type: "paragraph",
        level: null,
        text: "文藝復興時期，歐洲人重視人文主義。",
        table: null,
        sourceLocation: "測試段落 1",
      },
      {
        documentId: document.id,
        topicId,
        sectionId,
        order: 1,
        type: "paragraph",
        level: null,
        text: "參考答案：人文主義（每個答案各佔 1 分）",
        table: null,
        sourceLocation: "測試段落 2",
      },
    ]);
    return document;
  }

  it("檔名標示為教師版時，開放學生閱讀需要額外明確確認（409）", async () => {
    const lesson = lessonService.getLessonView("topic-5");
    const sectionId = lesson.sections[0]?.id ?? "topic-5-renaissance-features";
    const document = createTeacherEditionDocument(sectionId, "topic-5");
    try {
      expect(teacherContent.looksLikeTeacherEdition(document.fileName)).toBe(true);

      const blocked = await patchDocument(
        document.id,
        { studentDistribution: true },
        cookieFor(ADMIN),
      );
      expect(blocked.status).toBe(409);
      const body = (await blocked.json()) as { error?: string };
      expect(body.error ?? "").toContain("教師版");
      // 未確認前不會開放，也不會留下稽核記錄
      expect(materialsRepo.getDocument(document.id)?.studentDistribution).toBe(false);
      expect(materialsRepo.listDistributionAudit(document.id)).toEqual([]);

      const confirmed = await patchDocument(
        document.id,
        { studentDistribution: true, confirmTeacherEdition: true },
        cookieFor(ADMIN),
      );
      expect(confirmed.status).toBe(200);
      expect(materialsRepo.getDocument(document.id)?.studentDistribution).toBe(true);
      expect(materialsRepo.listDistributionAudit(document.id)).toHaveLength(1);
    } finally {
      materialsRepo.setDocumentStudentDistribution(document.id, false);
      materialsRepo.deleteDocument(document.id);
    }
  });

  it("教師專用段落（答案、評分參考）不會顯示給學生，其他段落照常顯示", () => {
    const lesson = lessonService.getLessonView("topic-5");
    const sectionId = lesson.sections[0]?.id ?? "topic-5-renaissance-features";
    const document = createTeacherEditionDocument(sectionId, "topic-5");
    try {
      materialsRepo.setDocumentStudentDistribution(document.id, true);
      const visible = lessonService.getLessonView("topic-5", [sectionId]);
      const texts = visible.sections
        .flatMap((section) => section.blocks)
        .map((block) => block.text)
        .join("\n");

      expect(texts).toContain("文藝復興時期，歐洲人重視人文主義。");
      expect(texts).not.toContain("參考答案");
      expect(texts).not.toContain("每個答案各佔");
      expect(visible.withheldTeacherBlocks).toBeGreaterThanOrEqual(1);
      expect(visible.notice ?? "").toContain("答案");
    } finally {
      materialsRepo.setDocumentStudentDistribution(document.id, false);
      materialsRepo.deleteDocument(document.id);
    }
  });

  it("只有教師專用內容的文件不會被當成「有教材可讀」", () => {
    const document = materialsRepo.createDocument({
      fileName: "答案及評分參考.docx",
      kind: "demo",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 512,
      status: "ready",
      topicId: "topic-1",
      sourceNote: null,
    });
    materialsRepo.insertBlocks([
      {
        documentId: document.id,
        topicId: "topic-1",
        sectionId: "topic-1-origins",
        order: 0,
        type: "paragraph",
        level: null,
        text: "評分參考：學生須指出兩個特徵，每個答案各佔 2 分。",
        table: null,
        sourceLocation: "答案頁",
      },
    ]);
    try {
      expect(teacherContent.looksLikeTeacherEdition(document.fileName)).toBe(true);
      materialsRepo.setDocumentStudentDistribution(document.id, true);
      const lesson = lessonService.getLessonView("topic-1", ["topic-1-origins"]);
      expect(lesson.sections).toEqual([]);
      expect(lesson.withheldTeacherBlocks).toBe(1);
      expect(lessonService.topicHasLesson("topic-1")).toBe(false);
    } finally {
      materialsRepo.setDocumentStudentDistribution(document.id, false);
      materialsRepo.deleteDocument(document.id);
    }
  });
});

describe("發行權操作的邊界情況", () => {
  it("重複設定相同值不會產生重複的稽核記錄", async () => {
    const documentId = pilotDocumentId();
    materialsRepo.setDocumentStudentDistribution(documentId, true);
    const before = materialsRepo.listDistributionAudit(documentId).length;

    const response = await patchDocument(
      documentId,
      { studentDistribution: true, confirmTeacherEdition: true },
      cookieFor(ADMIN),
    );
    expect(response.status).toBe(200);
    expect(materialsRepo.listDistributionAudit(documentId).length).toBe(before);

    // 由 true 改為 false 才是真正的變更 → 會新增一筆
    const revoke = await patchDocument(documentId, { studentDistribution: false }, cookieFor(ADMIN));
    expect(revoke.status).toBe(200);
    expect(materialsRepo.listDistributionAudit(documentId).length).toBe(before + 1);
  });

  it("未知的文件 ID 回 404，不會留下稽核記錄", async () => {
    const response = await patchDocument(
      "missing-document",
      { studentDistribution: true },
      cookieFor(ADMIN),
    );
    expect(response.status).toBe(404);
    expect(materialsRepo.listDistributionAudit("missing-document")).toEqual([]);
  });

  it("先開放再撤銷後，學生下一個請求立即看不到內容（沒有快取）", () => {
    const documentId = pilotDocumentId();
    materialsRepo.setDocumentStudentDistribution(documentId, true);
    expect(lessonService.getLessonView("topic-5").sections.length).toBeGreaterThan(0);

    materialsRepo.setDocumentStudentDistribution(documentId, false);
    expect(lessonService.getLessonView("topic-5").sections).toEqual([]);
  });

  it("管理員端的段落預覽會回報教師專用段落數及教師版標示", async () => {
    const documentId = pilotDocumentId();
    const { GET } = await import("@/app/api/admin/materials/[documentId]/route");
    const response = await GET(
      new Request(`http://localhost:3000/api/admin/materials/${documentId}`, {
        headers: { cookie: cookieFor(ADMIN) },
      }),
      { params: Promise.resolve({ documentId }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      teacherOnlyBlockCount: number;
      looksLikeTeacherEdition: boolean;
      distributionAudit: unknown[];
    };
    expect(typeof body.teacherOnlyBlockCount).toBe("number");
    expect(typeof body.looksLikeTeacherEdition).toBe("boolean");
    expect(Array.isArray(body.distributionAudit)).toBe(true);
  });
});
