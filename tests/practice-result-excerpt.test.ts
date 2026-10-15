/**
 * 教材節錄的路由層（route-level）外洩測試（Sprint 7.1）。
 *
 * Sprint 6 的 `sourceExcerptIsStudentVisible` 只以服務層測試覆蓋；本檔補上實際路由的
 * 契約，確認未確認／不可發布的來源文件即使經 HTTP 亦不會外洩節錄：
 *
 *   1. `POST /api/practice/[sessionId]/answers`：作答回饋不會包含未確認教材的原文。
 *   2. `GET  /api/practice/[sessionId]/result`：整份回應（包括其他欄位、錯誤路徑）都不會
 *      以任何形式包含該段原文——不只是 `sourceExcerpt` 一個欄位。
 *   3. 管理員確認版權（教師版另需內容覆核）後才會顯示；撤銷後立即再次停止顯示。
 *   4. 略去節錄不會過度阻擋：標準答案、解釋、知識點及評分結果如常回傳。
 *
 * 測試以學生工作階段 cookie 呼叫路由，因此同時覆蓋授權與內容判斷兩層。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { openDocumentForStudents } from "./material-distribution";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("result-excerpt");
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
type PracticeRepo = typeof import("@/server/repositories/practice");
type SessionModule = typeof import("@/server/auth/session");
type SeedModule = typeof import("@/server/seed");
type Types = typeof import("@/lib/types");

let materialsRepo: MaterialsRepo;
let practiceRepo: PracticeRepo;
let session: SessionModule;
let seed: SeedModule;
let types: Types;

const STUDENT = {
  email: "s2024146@pochiu.edu.hk",
  name: "測試學生",
  role: "student" as const,
  learnerId: "school:s2024146@pochiu.edu.hk",
  pictureUrl: null,
};
const OTHER_STUDENT = {
  email: "s2024152@pochiu.edu.hk",
  name: "另一名學生",
  role: "student" as const,
  learnerId: "school:s2024152@pochiu.edu.hk",
  pictureUrl: null,
};

function cookieFor(user: typeof STUDENT | typeof OTHER_STUDENT): string {
  return `hk-history-session=${encodeURIComponent(session.encodeSession(user))}`;
}

/** 只在測試資料庫使用的可辨識原文（在回應中出現即代表外洩） */
const PROTECTED_TEXT = "PROTECTED-TEXT-文藝復興時期歐洲人重視人文主義";
let sequence = 0;

function createSourceDocument(teacherEdition: boolean) {
  sequence += 1;
  const document = materialsRepo.createDocument({
    fileName: teacherEdition
      ? `HNC2A2E_T5_SN_TE${sequence}.docx`
      : `課題5 學生講義 ${sequence}.docx`,
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
      text: PROTECTED_TEXT,
      table: null,
      sourceLocation: "未確認來源 第 1 段",
    },
  ]);
  return { document, blockId: blocks[0]!.id };
}

function makeQuestion(blockId: string) {
  sequence += 1;
  const question = types.questionSchema.parse({
    id: `result-excerpt-${sequence}`,
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
    sourceExcerpt: PROTECTED_TEXT,
    sourceLocation: "未確認來源 第 1 段",
    sourceBlockIds: [blockId],
    gradingPoints: [],
    origin: "manual",
    status: "published",
    sourceVerified: true,
    createdAt: new Date().toISOString(),
  });
  const created = practiceRepo.createSession({
    learnerId: STUDENT.learnerId,
    topicId: "topic-5",
    sectionIds: ["topic-5-renaissance-features"],
    questionTypes: ["mc"],
    difficulty: "basic",
    mode: "standard",
    sourceSessionId: null,
    origin: "bank",
    questions: [question],
    notice: null,
  });
  return { question, sessionId: created.id };
}

async function submitAnswer(sessionId: string, questionId: string, learnerId: string) {
  const { POST } = await import("@/app/api/practice/[sessionId]/answers/route");
  return POST(
    new Request(`http://localhost:3000/api/practice/${sessionId}/answers`, {
      method: "POST",
      headers: { cookie: cookieFor(STUDENT), "content-type": "application/json" },
      body: JSON.stringify({ learnerId, questionId, answer: "人文主義" }),
    }),
    { params: Promise.resolve({ sessionId }) },
  );
}

async function getResult(sessionId: string, learnerId: string) {
  const { GET } = await import("@/app/api/practice/[sessionId]/result/route");
  return GET(
    new Request(
      `http://localhost:3000/api/practice/${sessionId}/result?learnerId=${encodeURIComponent(learnerId)}`,
      { headers: { cookie: cookieFor(STUDENT) } },
    ),
    { params: Promise.resolve({ sessionId }) },
  );
}

beforeAll(async () => {
  materialsRepo = await import("@/server/repositories/materials");
  practiceRepo = await import("@/server/repositories/practice");
  session = await import("@/server/auth/session");
  types = await import("@/lib/types");
  seed = await import("@/server/seed");
  seed.ensureBootstrap();
});

describe("未確認來源文件的節錄不會經路由外洩", () => {
  it("作答回饋略去節錄，但保留答案、解釋及知識點", async () => {
    const { document, blockId } = createSourceDocument(true);
    materialsRepo.setDocumentStudentDistribution(document.id, true); // 舊狀態：只有布林值
    const { question, sessionId } = makeQuestion(blockId);

    const response = await submitAnswer(sessionId, question.id, STUDENT.learnerId);
    expect(response.status).toBe(200);
    const raw = await response.text();

    expect(raw).not.toContain(PROTECTED_TEXT);
    const payload = JSON.parse(raw) as {
      feedback: {
        sourceWithheld: boolean;
        sourceExcerpt: string | null;
        sourceLocation: string | null;
        sourceBlockIds: string[];
        correctAnswer: string;
        explanation: string;
        knowledgePoint: string;
        isCorrect: boolean | null;
      };
    };
    expect(payload.feedback.sourceWithheld).toBe(true);
    expect(payload.feedback.sourceExcerpt).toBeNull();
    expect(payload.feedback.sourceLocation).toBeNull();
    expect(payload.feedback.sourceBlockIds).toEqual([]);
    // 不可過度阻擋：評分及學習所需的內容仍會回傳
    expect(payload.feedback.isCorrect).toBe(true);
    expect(payload.feedback.correctAnswer).toBe("人文主義");
    expect(payload.feedback.explanation.length).toBeGreaterThan(0);
    expect(payload.feedback.knowledgePoint.length).toBeGreaterThan(0);
  });

  it("成績回應的任何欄位都不含該段原文", async () => {
    const { document, blockId } = createSourceDocument(true);
    materialsRepo.setDocumentStudentDistribution(document.id, true);
    const { question, sessionId } = makeQuestion(blockId);
    await submitAnswer(sessionId, question.id, STUDENT.learnerId);

    const response = await getResult(sessionId, STUDENT.learnerId);
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).not.toContain(PROTECTED_TEXT);

    const payload = JSON.parse(raw) as {
      feedback: { sourceWithheld: boolean; sourceExcerpt: string | null }[];
    };
    expect(payload.feedback).toHaveLength(1);
    expect(payload.feedback[0]?.sourceWithheld).toBe(true);
    expect(payload.feedback[0]?.sourceExcerpt).toBeNull();
  });

  it("錯誤路徑亦不會洩漏節錄（其他學習者讀取成績會被拒）", async () => {
    const { document, blockId } = createSourceDocument(true);
    materialsRepo.setDocumentStudentDistribution(document.id, true);
    const { question, sessionId } = makeQuestion(blockId);
    await submitAnswer(sessionId, question.id, STUDENT.learnerId);

    const { GET } = await import("@/app/api/practice/[sessionId]/result/route");
    const forbidden = await GET(
      new Request(
        `http://localhost:3000/api/practice/${sessionId}/result?learnerId=${encodeURIComponent(OTHER_STUDENT.learnerId)}`,
        { headers: { cookie: cookieFor(OTHER_STUDENT) } },
      ),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.text()).not.toContain(PROTECTED_TEXT);
  });

  it("管理員確認版權（教師版另需內容覆核）後才會顯示，撤銷後立即再次停止顯示", async () => {
    const { document, blockId } = createSourceDocument(true);
    materialsRepo.setDocumentStudentDistribution(document.id, true);
    const { question, sessionId } = makeQuestion(blockId);

    await submitAnswer(sessionId, question.id, STUDENT.learnerId);
    const hidden = await getResult(sessionId, STUDENT.learnerId);
    expect((await hidden.text()).includes(PROTECTED_TEXT)).toBe(false);

    // 完整治理開放（版權 + 教師版內容覆核）
    openDocumentForStudents(materialsRepo, document.id);
    const shown = await getResult(sessionId, STUDENT.learnerId);
    const shownRaw = await shown.text();
    expect(shownRaw).toContain(PROTECTED_TEXT);
    const shownPayload = JSON.parse(shownRaw) as {
      feedback: { sourceWithheld: boolean; sourceExcerpt: string | null }[];
    };
    expect(shownPayload.feedback[0]?.sourceWithheld).toBe(false);
    expect(shownPayload.feedback[0]?.sourceExcerpt).toBe(PROTECTED_TEXT);

    // 撤銷後（確認紀錄仍在）即時停止顯示
    materialsRepo.setDocumentStudentDistribution(document.id, false);
    const revoked = await getResult(sessionId, STUDENT.learnerId);
    expect(await revoked.text()).not.toContain(PROTECTED_TEXT);
  });

  it("非教師版文件只需版權確認即可顯示節錄", async () => {
    const { document, blockId } = createSourceDocument(false);
    const { question, sessionId } = makeQuestion(blockId);
    await submitAnswer(sessionId, question.id, STUDENT.learnerId);

    materialsRepo.recordDocumentGovernance({
      documentId: document.id,
      rights: { confirmedBy: "admin@example.com", at: new Date().toISOString() },
    });
    materialsRepo.setDocumentStudentDistribution(document.id, true);

    const response = await getResult(sessionId, STUDENT.learnerId);
    expect(await response.text()).toContain(PROTECTED_TEXT);
  });
});
