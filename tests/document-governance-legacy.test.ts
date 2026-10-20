/**
 * 舊狀態（legacy state）治理邊界測試（Sprint 7.1）。
 *
 * 背景：`student_distribution` 這個布林值在遷移 0017 之前是唯一的發行權開關。因此在
 * 0017 之前已開放的文件、由舊備份還原的資料庫，或任何繞過 API 直接寫入的列，都可能
 * 出現「已開放但沒有任何版權／內容確認紀錄」的狀態。若讀取時只看布林值，這種文件會
 * 一直對學生可見（包括教師版原文、答案段落），而系統無法回答「這份文件為何可以給
 * 學生看」。
 *
 * 本檔驗證讀取端已 fail-closed：**必須同時**有
 *   1. `student_distribution = 1`
 *   2. 版權確認 `rights_confirmed_at`
 *   3. 教師版文件另需內容覆核 `content_reviewed_at`
 * 學生才會看到內容。兩條學生端路徑（教材節錄、學生即時 AI 出題的依據）都
 * 使用同一個判斷（`listStudentDistributableDocumentIds`），因此一次修正同時覆蓋。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { openDocumentForStudents } from "./material-distribution";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("governance-legacy");
process.env.LLM_PROVIDER = "mock";
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_TEACHER_EMAILS = "teacher@example.com";
process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
delete process.env.ADMIN_TOKEN;
delete process.env.K_SERVICE;

type MaterialsRepo = typeof import("@/server/repositories/materials");
type MaterialUnits = typeof import("@/server/services/material-units");
type PracticeService = typeof import("@/server/services/practice-service");
type Types = typeof import("@/lib/types");

let materialsRepo: MaterialsRepo;
let materialUnits: MaterialUnits;
let practiceService: PracticeService;
let types: Types;

const SAMPLE_TEXT = "文藝復興時期，歐洲人重視人文主義。";
const ADMIN = {
  email: "admin@example.com",
  name: "測試管理員",
  role: "admin" as const,
  learnerId: "admin:admin@example.com",
  pictureUrl: null,
};

let sequence = 0;

/** 建立一份教師版文件（檔名帶 `_TE`）及一個學生可見樣本段落 */
function createTeacherEditionDocument() {
  sequence += 1;
  const document = materialsRepo.createDocument({
    fileName: `HNC2A2E_T5_SN_TE${sequence}.docx`,
    kind: "demo",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 1024,
    status: "ready",
    topicId: "topic-5",
    sourceNote: null,
  });
  const blocks = materialsRepo.insertBlocks([
    {
      documentId: document.id,
      topicId: "topic-5",
      sectionId: "topic-5-renaissance-features",
      order: 0,
      type: "paragraph",
      level: null,
      text: SAMPLE_TEXT,
      table: null,
      sourceLocation: "測試段落 1",
    },
  ]);
  return { document, blockId: blocks[0]!.id };
}

let seed: typeof import("@/server/seed");

beforeAll(async () => {
  materialsRepo = await import("@/server/repositories/materials");
  materialUnits = await import("@/server/services/material-units");
  practiceService = await import("@/server/services/practice-service");
  types = await import("@/lib/types");
  seed = await import("@/server/seed");
  seed.ensureBootstrap();
});

describe("舊狀態：只設定 student_distribution 而沒有確認紀錄", () => {
  it("不會列入可向學生顯示的文件，且管理員介面會說明學生仍看不到", async () => {
    const { document } = createTeacherEditionDocument();
    // 重現 0017 之前的狀態：只有布林值，沒有 rights/content 紀錄
    materialsRepo.setDocumentStudentDistribution(document.id, true);

    const reloaded = materialsRepo.getDocument(document.id)!;
    expect(reloaded.studentDistribution).toBe(true);
    expect(reloaded.rightsConfirmedAt).toBeNull();
    expect(reloaded.contentReviewedAt).toBeNull();

    expect(materialsRepo.listStudentDistributableDocumentIds().has(document.id)).toBe(false);
    expect(materialsRepo.documentIsStudentVisible(reloaded)).toBe(false);

    // 管理員端詳情回應會回報「現時學生仍看不到」，避免誤以為已開放
    const session = await import("@/server/auth/session");
    const { GET } = await import("@/app/api/admin/materials/[documentId]/route");
    const response = await GET(
      new Request(`http://localhost:3000/api/admin/materials/${document.id}`, {
        headers: {
          cookie: `hk-history-session=${encodeURIComponent(session.encodeSession(ADMIN))}`,
        },
      }),
      { params: Promise.resolve({ documentId: document.id }) },
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { studentVisibleToStudents?: boolean };
    expect(payload.studentVisibleToStudents).toBe(false);
  });

  it("兩條學生端路徑都不會顯示內容：教材節錄、即時出題的教材依據", async () => {
    const { document, blockId } = createTeacherEditionDocument();
    materialsRepo.setDocumentStudentDistribution(document.id, true);

    // 1) 學生可用教材：該文件不會計入（學生連出題依據都沒有）
    expect(
      materialsRepo.studentMaterialBlockCounts("topic-5").get("topic-5-renaissance-features") ?? 0,
    ).toBe(0);

    // 2) 即時出題的學生版教材依據：不會包含該文件的段落
    const studentUnits = materialUnits.buildMaterialUnits(
      "topic-5",
      ["topic-5-renaissance-features"],
      { audience: "student" },
    );
    expect(studentUnits.some((unit) => unit.blockId === blockId)).toBe(false);
    // 教師／管理員生成不受此限（他們本來就可以看到教材）
    const staffUnits = materialUnits.buildMaterialUnits(
      "topic-5",
      ["topic-5-renaissance-features"],
      { audience: "staff" },
    );
    expect(staffUnits.some((unit) => unit.blockId === blockId)).toBe(true);

    // 3) 作答後的教材節錄：同一政策（引用未確認文件 → 不顯示節錄）
    const question = types.questionSchema.parse({
      id: `legacy-excerpt-${sequence}`,
      topicId: "topic-5",
      sectionId: "topic-5-renaissance-features",
      questionType: "mc",
      difficulty: "basic",
      question: "文藝復興時期歐洲人重視甚麼思想？",
      options: ["人文主義", "重商主義", "軍國主義", "自然主義"],
      correctAnswer: "人文主義",
      acceptedAnswers: [],
      explanation: "教材指出文藝復興重視人文主義。",
      knowledgePoint: "文藝復興人文主義",
      sourceExcerpt: SAMPLE_TEXT,
      sourceLocation: "測試教材 第 1 段",
      sourceBlockIds: [blockId],
      gradingPoints: [],
      origin: "manual",
      status: "published",
      sourceVerified: true,
      createdAt: new Date().toISOString(),
    });
    expect(practiceService.sourceExcerptIsStudentVisible(question)).toBe(false);
  });

  it("補回確認紀錄後才會顯示：教師版文件需要版權確認＋內容覆核", () => {
    const { document } = createTeacherEditionDocument();
    materialsRepo.setDocumentStudentDistribution(document.id, true);

    const at = new Date().toISOString();
    // 只有版權確認：教師版文件仍然不可見
    materialsRepo.recordDocumentGovernance({
      documentId: document.id,
      rights: { confirmedBy: "admin@example.com", at },
    });
    expect(materialsRepo.documentIsStudentVisible(materialsRepo.getDocument(document.id)!)).toBe(
      false,
    );

    // 加上內容安全覆核後才可見
    materialsRepo.recordDocumentGovernance({
      documentId: document.id,
      contentSafety: { reviewedBy: "admin@example.com", at },
    });
    expect(materialsRepo.documentIsStudentVisible(materialsRepo.getDocument(document.id)!)).toBe(
      true,
    );
    expect(materialsRepo.listStudentDistributableDocumentIds().has(document.id)).toBe(true);
  });

  it("非教師版文件只需要版權確認", () => {
    const document = materialsRepo.createDocument({
      fileName: "課題5 學生用教材.docx",
      kind: "demo",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 512,
      status: "ready",
      topicId: "topic-5",
      sourceNote: null,
    });
    materialsRepo.setDocumentStudentDistribution(document.id, true);
    expect(materialsRepo.documentIsStudentVisible(materialsRepo.getDocument(document.id)!)).toBe(
      false,
    );

    materialsRepo.recordDocumentGovernance({
      documentId: document.id,
      rights: { confirmedBy: "admin@example.com", at: new Date().toISOString() },
    });
    expect(materialsRepo.documentIsStudentVisible(materialsRepo.getDocument(document.id)!)).toBe(
      true,
    );
  });

  it("撤銷立即生效：即使確認紀錄仍在，學生亦看不到", () => {
    const { document } = createTeacherEditionDocument();
    openDocumentForStudents(materialsRepo, document.id);
    expect(materialsRepo.documentIsStudentVisible(materialsRepo.getDocument(document.id)!)).toBe(
      true,
    );

    materialsRepo.setDocumentStudentDistribution(document.id, false);
    const reloaded = materialsRepo.getDocument(document.id)!;
    // 確認紀錄保留（歷史事實），但已撤銷發行權
    expect(reloaded.rightsConfirmedAt).not.toBeNull();
    expect(materialsRepo.documentIsStudentVisible(reloaded)).toBe(false);
  });

  it("校內試題文件即使有完整確認紀錄亦不會顯示", () => {
    const document = materialsRepo.createDocument({
      fileName: "校內試題.docx",
      kind: "question-bank",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 512,
      status: "ready",
      topicId: "topic-5",
      sourceNote: null,
    });
    openDocumentForStudents(materialsRepo, document.id);

    const reloaded = materialsRepo.getDocument(document.id)!;
    expect(reloaded.rightsConfirmedAt).not.toBeNull();
    expect(materialsRepo.documentIsStudentVisible(reloaded)).toBe(false);
    expect(materialsRepo.listStudentDistributableDocumentIds().has(document.id)).toBe(false);
  });
});
