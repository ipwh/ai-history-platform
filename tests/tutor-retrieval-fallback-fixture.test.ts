/**
 * 教材內文反推課題（`inferTopicFromMaterial`）的合成資料庫測試（Sprint 34）。
 *
 * ── 為甚麼需要這個檔案 ──────────────────────────────────────────────
 * `tests/tutor-retrieval-recall.test.ts` 的期望值取自**真實教材分佈**，因此只在有
 * `data/app.db` 時執行；CI 的 `npm test` 沒有內容資料庫，該檔會記為 skipped。
 * 為了令召回修正在 CI 也有可驗證的證據，這裡用**合成資料庫**覆蓋同一套演算法行為：
 * 有內容但沒有分節關鍵詞 → 召回到；證據分散 → 不召回；教材真的沒有 → 不召回；
 * 課程用語推錯課題但該課題無片段 → 改以內文反推。
 *
 * ── 合成資料庫的內容 ────────────────────────────────────────────────
 * 刻意設計成與真實個案同構（但不是抄真實課文）：
 *   - 「種族隔離」4 段在課題A、1 段在課題B → 應召回課題A（4 ≥ 2×1）
 *   - 「不合作」1 段講**環保協作的不合作態度**，與甘地無關 → 必須維持未涵蓋
 *   - 「絲綢」2 段在課題A、2 段在課題C → 證據分散，必須維持未涵蓋
 *   - 課題D 有一個分節關鍵詞「香港開埠」但沒有任何相關片段 → 應改以內文反推
 */
import { beforeAll, describe, expect, it } from "vitest";

import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("tutor-retrieval-fallback-fixture");
process.env.BACKUP_ENABLED = "false";

let findTutorGrounding: typeof import("@/server/services/tutor-grounding").findTutorGrounding;
let loadTutorCurriculumIndex: typeof import("@/server/services/tutor-grounding").loadTutorCurriculumIndex;
let normalizeTutorQuery: typeof import("@/server/services/tutor-query").normalizeTutorQuery;
let getDb: typeof import("@/server/db/connection").getDb;

const NOW = "2026-11-07T00:00:00.000+08:00";

function insertTopic(db: ReturnType<typeof getDb>, id: string, title: string): void {
  db.prepare(
    `INSERT INTO topics (id, title, description, published, sort_order, created_at, updated_at)
     VALUES (?, ?, '', 1, 0, ?, ?)`,
  ).run(id, title, NOW, NOW);
}

function insertBlock(
  db: ReturnType<typeof getDb>,
  documentId: string,
  topicId: string,
  index: number,
  text: string,
): void {
  db.prepare(
    `INSERT INTO material_blocks
       (id, document_id, topic_id, section_id, sort_order, type, text, source_location, created_at, extraction_method)
     VALUES (?, ?, ?, NULL, ?, 'paragraph', ?, ?, ?, 'native')`,
  ).run(
    `${documentId}-b${index}`,
    documentId,
    topicId,
    index,
    text,
    `合成教材 · 第 ${index + 1} 段（段落）`,
    NOW,
  );
}

function insertDocument(db: ReturnType<typeof getDb>, id: string, fileName: string): void {
  db.prepare(
    `INSERT INTO material_documents
       (id, file_name, kind, status, created_at, student_distribution, rights_confirmed_at)
     VALUES (?, ?, 'demo', 'ready', ?, 1, ?)`,
  ).run(id, fileName, NOW, NOW);
}

beforeAll(async () => {
  ({ findTutorGrounding, loadTutorCurriculumIndex } = await import(
    "@/server/services/tutor-grounding"
  ));
  ({ normalizeTutorQuery } = await import("@/server/services/tutor-query"));
  getDb = (await import("@/server/db/connection")).getDb;

  const db = getDb();
  insertTopic(db, "fx-a", "課題A：合成國際合作課題");
  insertTopic(db, "fx-b", "課題B：合成美國課題");
  insertTopic(db, "fx-c", "課題C：合成中古交流課題");
  insertTopic(db, "fx-d", "課題D：合成香港課題");

  insertDocument(db, "doc-a", "合成課題A_筆記.docx");
  insertBlock(db, "doc-a", "fx-a", 0, "南非白人政府於1950至1990年代實行種族隔離政策，限制不同種族的居住與教育。");
  insertBlock(db, "doc-a", "fx-a", 1, "聯合國大會多次譴責種族隔離政策，並對南非實施經濟制裁。");
  insertBlock(db, "doc-a", "fx-a", 2, "種族隔離政策在1990年代初逐步廢除，南非於1994年舉行首次全民選舉。");
  insertBlock(db, "doc-a", "fx-a", 3, "國際社會的壓力與內部抗爭共同令種族隔離制度結束。");
  insertBlock(
    db,
    "doc-a",
    "fx-a",
    4,
    "在國際環保協作上，較發達國家的不合作態度令條約缺乏約束力。",
  );

  insertDocument(db, "doc-b", "合成課題B_筆記.docx");
  insertBlock(db, "doc-b", "fx-b", 0, "美國南部的《吉姆・克勞法》以種族隔離措施分開不同種族的學校與交通工具。");
  insertBlock(db, "doc-b", "fx-b", 1, "重建時期結束後，南部各州陸續頒布剝奪黑人權利的法律。");

  insertDocument(db, "doc-c", "合成課題C_筆記.docx");
  insertBlock(db, "doc-c", "fx-c", 0, "絲綢是歐亞貿易的重要商品，商旅沿途交換貨物與技術。");
  insertBlock(db, "doc-c", "fx-c", 1, "絲綢貿易促進城市發展，也帶來宗教與文化的交流。");
  insertBlock(db, "doc-c", "fx-a", 2, "絲綢亦見於宮廷禮儀的記載，反映地位的象徵。");
  insertBlock(db, "doc-c", "fx-a", 3, "宮廷以絲綢賞賜臣屬，形成固定的禮儀制度。");

  // 課題D：有分節關鍵詞但沒有相關片段，用來驗證「推錯課題 → 內文反推」
  db.prepare(
    `INSERT INTO sections (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
     VALUES ('fx-d-sec', 'fx-d', NULL, '開埠前後的轉變', '', '["香港開埠","轉口港"]', 1, ?, ?)`,
  ).run(NOW, NOW);

  insertDocument(db, "doc-d", "合成課題D_筆記.docx");
  insertBlock(db, "doc-d", "fx-d", 0, "香港的轉口貿易在十九世紀迅速增長，碼頭與倉庫相繼建成。");
});

function ground(query: string, options: Record<string, unknown> = {}) {
  const curriculum = loadTutorCurriculumIndex();
  const audit: import("@/server/services/tutor-grounding").TutorPassageSelectionAudit = {
    candidateBlocks: 0,
    scoredHits: 0,
    belowThreshold: 0,
    selected: [],
    excluded: [],
  };
  const grounding = findTutorGrounding(normalizeTutorQuery(query), [], curriculum, {
    maxSources: 3,
    audit,
    ...options,
  } as never);
  return { grounding, audit };
}

describe("教材內文反推課題（合成資料庫）", () => {
  it("有內容但沒有分節關鍵詞時，會由教材內文推斷課題並召回", () => {
    const { grounding, audit } = ground("什麼是種族隔離政策？");
    expect(grounding.status).toBe("grounded");
    // 課題A 有 4 段、課題B 有 1 段 → 4 ≥ 2×1，選課題A
    expect(grounding.topicId).toBe("fx-a");
    expect(grounding.passages.length).toBeGreaterThan(0);
    expect(audit.topicInference?.source).toBe("material-fallback");
    expect(audit.topicInference?.fallbackCandidates?.[0]).toEqual({
      topicId: "fx-a",
      qualifyingBlocks: 4,
    });
  });

  it("字詞重疊但語境不同時不會召回（「不合作」指環保協作，不是甘地）", () => {
    const { grounding } = ground("甘地提倡的不合作運動是甚麼？");
    expect(grounding.status).toBe("not-covered");
    expect(grounding.topicId).toBeNull();
  });

  it("證據分散在兩個課題時不推斷（寧可回 C）", () => {
    const { grounding, audit } = ground("絲綢貿易有甚麼影響？");
    // 「絲綢」在 fx-a 與 fx-c 各 2 段：勝出者未達第二名的兩倍 → 不推斷課題
    expect(grounding.status).toBe("not-covered");
    expect(grounding.topicId).toBeNull();
    expect(audit.topicInference?.source ?? "none").toBe("none");
  });

  it("教材完全沒有相關內容時維持未涵蓋（不會因任何詞而召回）", () => {
    for (const query of ["火箭推進器的燃燒溫度是多少？", "板球比賽的規則有幾條？"]) {
      expect(ground(query).grounding.status).toBe("not-covered");
    }
  });

  it("課程用語推錯課題但該課題無片段時，改以教材內文反推", () => {
    // 「香港開埠」命中課題D 的分節關鍵詞，但課題D 沒有相關片段；
    // 教材內文（課題D 的轉口貿易段落）才是真正的依據。
    const { grounding, audit } = ground("香港開埠後轉口貿易如何發展？");
    expect(grounding.status).toBe("grounded");
    expect(grounding.topicId).toBe("fx-d");
    expect(["curriculum", "material-fallback"]).toContain(audit.topicInference?.source);
  });

  it("非歷史提問在課題推斷層亦不會被英文疑問詞帶走（who → 世界衛生組織縮寫）", () => {
    const { grounding, audit } = ground("Who won the World Cup in 2022?");
    expect(grounding.status).toBe("not-covered");
    expect(grounding.topicId).toBeNull();
    expect(audit.topicInference?.source ?? "none").toBe("none");
  });
});
