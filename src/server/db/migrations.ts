/**
 * 資料表結構。以簡單、順序執行的 migration 清單管理，
 * 每次啟動時會套用尚未執行的項目。
 */
import type { DatabaseSync } from "node:sqlite";

interface Migration {
  id: string;
  statements: string[];
}

/**
 * 全部 migration（依序套用）。
 *
 * 匯出以供測試驗證「ID 唯一、順序固定、已套用清單與程式碼一致」，
 * 以及升級／冪等契約（見 tests/migration-safety.test.ts）。
 */
export const MIGRATIONS: Migration[] = [
  {
    id: "0001-initial-schema",
    statements: [
      `CREATE TABLE IF NOT EXISTS learners (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS topics (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        published INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS sections (
        id TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        match_keywords_json TEXT NOT NULL DEFAULT '[]',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_sections_topic ON sections(topic_id, sort_order)`,
      `CREATE TABLE IF NOT EXISTS material_documents (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        kind TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT '',
        size_bytes INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        error_message TEXT,
        limitation_note TEXT,
        block_count INTEGER NOT NULL DEFAULT 0,
        image_count INTEGER NOT NULL DEFAULT 0,
        topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
        source_note TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS material_blocks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES material_documents(id) ON DELETE CASCADE,
        topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
        section_id TEXT REFERENCES sections(id) ON DELETE SET NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        type TEXT NOT NULL,
        level INTEGER,
        text TEXT NOT NULL DEFAULT '',
        table_json TEXT,
        source_location TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_blocks_document ON material_blocks(document_id, sort_order)`,
      `CREATE INDEX IF NOT EXISTS idx_blocks_section ON material_blocks(section_id)`,
      `CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
        question_type TEXT NOT NULL,
        difficulty TEXT NOT NULL,
        question TEXT NOT NULL,
        options_json TEXT NOT NULL DEFAULT '[]',
        correct_answer TEXT NOT NULL,
        accepted_answers_json TEXT NOT NULL DEFAULT '[]',
        explanation TEXT NOT NULL,
        knowledge_point TEXT NOT NULL,
        source_excerpt TEXT NOT NULL,
        source_location TEXT NOT NULL,
        source_block_ids_json TEXT NOT NULL DEFAULT '[]',
        grading_points_json TEXT NOT NULL DEFAULT '[]',
        origin TEXT NOT NULL,
        status TEXT NOT NULL,
        source_verified INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_questions_section ON questions(topic_id, section_id, status)`,
      `CREATE TABLE IF NOT EXISTS practice_sessions (
        id TEXT PRIMARY KEY,
        learner_id TEXT NOT NULL,
        topic_id TEXT NOT NULL,
        section_ids_json TEXT NOT NULL DEFAULT '[]',
        question_types_json TEXT NOT NULL DEFAULT '[]',
        difficulty TEXT NOT NULL,
        question_count INTEGER NOT NULL DEFAULT 0,
        mode TEXT NOT NULL,
        source_session_id TEXT,
        origin TEXT NOT NULL,
        question_snapshot_json TEXT NOT NULL DEFAULT '[]',
        notice TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_learner ON practice_sessions(learner_id, topic_id)`,
      `CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
        question_id TEXT NOT NULL,
        learner_id TEXT NOT NULL,
        answer TEXT NOT NULL DEFAULT '',
        auto_graded INTEGER NOT NULL DEFAULT 0,
        is_correct INTEGER,
        self_assessment TEXT,
        answered_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_attempts_session ON attempts(session_id)`,
      `CREATE INDEX IF NOT EXISTS idx_attempts_learner ON attempts(learner_id, question_id)`,
    ],
  },
  {
    id: "0002-curriculum-levels-and-ocr",
    statements: [
      // 課程年級（0 教師參考、1 中一、2 中二、3 中三）及教育局課題編號
      `ALTER TABLE topics ADD COLUMN level INTEGER NOT NULL DEFAULT 1`,
      `ALTER TABLE topics ADD COLUMN topic_number INTEGER`,
      // OCR（光學文字辨識）狀態及統計
      `ALTER TABLE material_documents ADD COLUMN ocr_status TEXT NOT NULL DEFAULT 'not-run'`,
      `ALTER TABLE material_documents ADD COLUMN ocr_provider TEXT`,
      `ALTER TABLE material_documents ADD COLUMN ocr_message TEXT`,
      `ALTER TABLE material_documents ADD COLUMN ocr_recognized_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE material_documents ADD COLUMN ocr_skipped_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE material_documents ADD COLUMN ocr_updated_at TEXT`,
      // 段落取得方式（native = 原文擷取、ocr = 圖片文字辨識）
      `ALTER TABLE material_blocks ADD COLUMN extraction_method TEXT NOT NULL DEFAULT 'native'`,
      `ALTER TABLE material_blocks ADD COLUMN ocr_source TEXT`,
      // 原始檔案在本機的存放位置（OCR 需要重新讀取原始檔以取得內嵌圖片）
      `ALTER TABLE material_documents ADD COLUMN stored_path TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_blocks_extraction ON material_blocks(document_id, extraction_method)`,
      `CREATE INDEX IF NOT EXISTS idx_topics_level ON topics(level, sort_order)`,
    ],
  },
  {
    id: "0003-attempt-ai-grading",
    statements: [
      // AI 語意批改結果（填充題／短答題）；未使用 AI 時為 NULL
      `ALTER TABLE attempts ADD COLUMN ai_grading_json TEXT`,
      // 只抽出判斷結果，方便統計及查詢需要重溫的題目
      `ALTER TABLE attempts ADD COLUMN ai_verdict TEXT`,
    ],
  },
  {
    id: "0004-question-quality-warnings",
    statements: [
      // 教師查核用的品質警告（例如題目出現教材未提及的人名或條約名），以 JSON 陣列儲存
      `ALTER TABLE questions ADD COLUMN quality_warnings_json TEXT`,
    ],
  },
  {
    id: "0005-reports-and-observability",
    statements: [
      // 學生回報題目（供教師覆核；不會自動刪除或停用題目）
      `CREATE TABLE IF NOT EXISTS question_reports (
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        session_id TEXT REFERENCES practice_sessions(id) ON DELETE SET NULL,
        learner_id TEXT NOT NULL,
        topic_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        resolved_by TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_reports_question ON question_reports(question_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_reports_status ON question_reports(status, created_at)`,
      // AI 語意批改監控（成功率、是否回退、回應時間、錯誤類別）
      `CREATE TABLE IF NOT EXISTS ai_grading_logs (
        id TEXT PRIMARY KEY,
        question_id TEXT,
        session_id TEXT,
        question_type TEXT NOT NULL,
        provider TEXT NOT NULL,
        success INTEGER NOT NULL DEFAULT 0,
        fell_back INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        error_type TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_grading_logs_created ON ai_grading_logs(created_at)`,
      // LLM 用量及延遲（即時出題／題庫生成／AI 批改）
      `CREATE TABLE IF NOT EXISTS llm_usage_logs (
        id TEXT PRIMARY KEY,
        request_type TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT,
        topic_id TEXT,
        success INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER,
        output_tokens INTEGER,
        error_type TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_llm_usage_created ON llm_usage_logs(created_at)`,
    ],
  },
  {
    id: "0006-reports-for-snapshot-questions",
    statements: [
      // AI 即時生成的題目只存在於練習快照，不會寫入題庫，因此回報的 question_id
      // 不能有指向 questions(id) 的外鍵（否則學生無法回報最常遇到的即時生成題目）。
      // 題目是否存在一律由服務層核對（題庫或該次練習的快照）。
      `CREATE TABLE question_reports_v2 (
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL,
        session_id TEXT REFERENCES practice_sessions(id) ON DELETE SET NULL,
        learner_id TEXT NOT NULL,
        topic_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        resolved_by TEXT
      )`,
      `INSERT INTO question_reports_v2
        (id, question_id, session_id, learner_id, topic_id, reason, detail, status, created_at, resolved_at, resolved_by)
       SELECT id, question_id, session_id, learner_id, topic_id, reason, detail, status, created_at, resolved_at, resolved_by
       FROM question_reports`,
      `DROP TABLE question_reports`,
      `ALTER TABLE question_reports_v2 RENAME TO question_reports`,
      `CREATE INDEX IF NOT EXISTS idx_reports_question ON question_reports(question_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_reports_status ON question_reports(status, created_at)`,
    ],
  },
  {
    id: "0007-remove-non-assessed-sections",
    statements: [
      // 課程只考核「黃河、長江流域文明」，新月沃土／尼羅河流域／印度河流域文明
      // 不會寫入資料庫，亦不可作為題材；這裡清除舊資料庫已存在的相關段落及題目。
      `DELETE FROM questions WHERE section_id IN (
         'topic-1-four-civilisations-mesopotamia',
         'topic-1-four-civilisations-nile',
         'topic-1-four-civilisations-indus'
       )`,
      `DELETE FROM material_blocks WHERE section_id IN (
         'topic-1-four-civilisations-mesopotamia',
         'topic-1-four-civilisations-nile',
         'topic-1-four-civilisations-indus'
       )`,
      `DELETE FROM sections WHERE id IN (
         'topic-1-four-civilisations-mesopotamia',
         'topic-1-four-civilisations-nile',
         'topic-1-four-civilisations-indus'
       )`,
      // 舊教材中提及這些文明的段落（例如四大古代文明的導言）亦一併移除
      `DELETE FROM material_blocks
        WHERE topic_id = 'topic-1'
          AND (
            text LIKE '%新月沃土%'
            OR text LIKE '%尼羅河%'
            OR text LIKE '%印度河%'
          )`,
      `DELETE FROM questions
        WHERE topic_id = 'topic-1'
          AND (
            question LIKE '%新月沃土%'
            OR question LIKE '%尼羅河%'
            OR question LIKE '%印度河%'
          )`,
    ],
  },
  {
    id: "0008-topic1-case-study-egypt",
    statements: [
      // 校本課程改以「古埃及文明（尼羅河流域）」作個案研習。
      // 先建立新的分節（沿用原分節的排序位置），令舊資料庫亦有此分節；
      // 課程資料庫尚未建立課題時（全新資料庫）則留給 seedCurriculum 建立。
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-1-four-civilisations-egypt',
              'topic-1',
              'topic-1-four-civilisations',
              '古埃及文明（尼羅河流域）',
              '位置、民族、衰落及文明特徵。',
              '["尼羅河流域文明","古代埃及文明","古埃及文明","古埃及","尼羅河"]',
              COALESCE((SELECT sort_order FROM sections WHERE id = 'topic-1-four-civilisations-yellow'), 0),
              strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-1')
         AND EXISTS (SELECT 1 FROM sections WHERE id = 'topic-1-four-civilisations')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-1-four-civilisations-egypt')`,
      // 其餘三個不再考核的文明，以及原本的黃河、長江流域文明分節，
      // 連同其所屬段落及題目一併移除。
      `DELETE FROM questions WHERE section_id IN (
         'topic-1-four-civilisations-mesopotamia',
         'topic-1-four-civilisations-nile',
         'topic-1-four-civilisations-indus',
         'topic-1-four-civilisations-yellow'
       )`,
      `DELETE FROM material_blocks WHERE section_id IN (
         'topic-1-four-civilisations-mesopotamia',
         'topic-1-four-civilisations-nile',
         'topic-1-four-civilisations-indus',
         'topic-1-four-civilisations-yellow'
       )`,
      `DELETE FROM sections WHERE id IN (
         'topic-1-four-civilisations-mesopotamia',
         'topic-1-four-civilisations-nile',
         'topic-1-four-civilisations-indus',
         'topic-1-four-civilisations-yellow'
       )`,
      // 舊教材中提及這些文明的段落（例如四大古代文明的導言及比較表）亦一併移除；
      // 表格內容放在 table_json，因此必須同時檢查。
      `DELETE FROM material_blocks
        WHERE topic_id = 'topic-1'
          AND (
            text LIKE '%新月沃土%'
            OR text LIKE '%印度河%'
            OR text LIKE '%幼發拉底%'
            OR text LIKE '%底格里斯%'
            OR text LIKE '%蘇美爾%'
            OR text LIKE '%巴比倫%'
            OR text LIKE '%哈拉巴%'
            OR text LIKE '%摩亨佐%'
            OR text LIKE '%吾珥%'
            OR text LIKE '%塔廟%'
            OR text LIKE '%黃河%'
            OR text LIKE '%長江%'
            OR text LIKE '%中華文明%'
            OR text LIKE '%甲骨文%'
            OR table_json LIKE '%新月沃土%'
            OR table_json LIKE '%印度河%'
            OR table_json LIKE '%黃河%'
            OR table_json LIKE '%長江%'
            OR table_json LIKE '%中華文明%'
          )`,
      `DELETE FROM questions
        WHERE topic_id = 'topic-1'
          AND (
            question LIKE '%新月沃土%'
            OR question LIKE '%印度河%'
            OR question LIKE '%蘇美爾%'
            OR question LIKE '%巴比倫%'
            OR question LIKE '%黃河%'
            OR question LIKE '%長江%'
            OR question LIKE '%中華文明%'
            OR question LIKE '%甲骨文%'
            OR explanation LIKE '%新月沃土%'
            OR explanation LIKE '%印度河%'
            OR explanation LIKE '%黃河%'
            OR explanation LIKE '%長江%'
            OR explanation LIKE '%中華文明%'
          )`,
    ],
  },
  {
    id: "0009-remove-curriculum-guide-reference",
    statements: [
      // 「教師參考：歷史科課程指引」課題只為存放兩份課程指引 PDF 而設，
      // 兩份 PDF 對出題沒有貢獻（出題檢索以課題為範圍，批次生成亦排除 level = 0），
      // 因此移除該課題、其分節、教材及相關題目。
      // material_documents.topic_id 是 ON DELETE SET NULL，必須先刪文件才不會留下孤兒資料。
      `DELETE FROM material_blocks
        WHERE topic_id = 'reference-curriculum'
           OR document_id IN (SELECT id FROM material_documents WHERE topic_id = 'reference-curriculum')`,
      `DELETE FROM material_documents WHERE topic_id = 'reference-curriculum'`,
      `DELETE FROM questions WHERE topic_id = 'reference-curriculum'`,
      `DELETE FROM sections WHERE topic_id = 'reference-curriculum'`,
      `DELETE FROM topics WHERE id = 'reference-curriculum'`,
    ],
  },
  {
    id: "0010-question-skill-tag",
    statements: [
      // 題目主要考核的歷史技能（取自教育局《歷史科課程指引》的固定清單）；
      // 未標示（教師手動建立或模型未填）時為 NULL。
      `ALTER TABLE questions ADD COLUMN skill TEXT`,
    ],
  },
  {
    id: "0011-material-student-distribution",
    statements: [
      // 學生可否在平台內把這份教材的內容顯示給學生（預設 0 = 不可）。
      //
      // 原因：教材內容會在平台內向學生發布（例如作為 AI 出題依據及題目來源節錄）。
      // 教材可能是出版社課本或第三方材料，學校未必有權在平台轉載；本專案沒有任何
      // 授權或發行權紀錄，因此**預設一律不可**（fail-closed），必須由管理員逐份文件
      // 明確確認擁有發行權後才會顯示。詳見 README「教材版權與學生閱讀範圍」。
      `ALTER TABLE material_documents ADD COLUMN student_distribution INTEGER NOT NULL DEFAULT 0`,
    ],
  },
  {
    id: "0012-ai-operation-budget",
    statements: [
      // AI 用量保留記錄：每次 AI 出題／批改都在**呼叫模型之前**同步寫入一筆。
      // 因為寫入與計數都是同步進行的，並行請求不會同時通過上限檢查（單一程序 + 同步 SQLite）。
      // 只記錄學習者 ID、類別及時間，不記錄題目內容或學生的答案。
      `CREATE TABLE IF NOT EXISTS ai_operations (
        id TEXT PRIMARY KEY,
        learner_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_ai_operations_learner ON ai_operations(learner_id, kind, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_ai_operations_kind ON ai_operations(kind, created_at)`,
    ],
  },
  {
    id: "0013-attempt-uncertain-flag",
    statements: [
      // 填充題「與標準答案只差一個字」的評分結果。
      //
      // 必須在批改當時寫入（而不是讀取時重新計算）：題目的答案或可接受寫法之後可能被
      // 教師修改，重新計算等於以今天的答案重新詮釋歷史作答記錄。
      // 0 = 明確判斷（正確或錯誤），1 = 不確定（已標示交由教師覆核）。
      `ALTER TABLE attempts ADD COLUMN uncertain INTEGER NOT NULL DEFAULT 0`,
    ],
  },
  {
    id: "0014-distribution-audit",
    statements: [
      // 教材發行權的稽核記錄：每次管理員開啟或關閉「可在平台向學生發布」都會留下一筆，
      // 記錄操作者及時間，以便日後回答「這份教材是何時、由誰決定向學生發布的」。
      // 只記錄電郵及角色（已在系統內），不記錄教材內容。
      `CREATE TABLE IF NOT EXISTS distribution_audit (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        allowed INTEGER NOT NULL,
        actor_email TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_distribution_audit_document
         ON distribution_audit(document_id, created_at DESC)`,
    ],
  },
  {
    id: "0015-question-review-audit",
    statements: [
      // 題目內容版本：人工覆核必須對應實際被覆核的那一版。
      // 已有題目一律由 1 開始；每次內容更新 +1（見 repositories/questions.ts 的 updateQuestion）。
      `ALTER TABLE questions ADD COLUMN revision INTEGER NOT NULL DEFAULT 1`,
      // 人工覆核紀錄。只可新增，不可修改或刪除（API 沒有提供更新或刪除的路徑）。
      //
      //   decision：approved（覆核通過）／rejected（不可用）／returned（退回修改）
      //   question_fingerprint：被覆核內容的雜湊，防止「版本號沒變但內容已改」的情況
      //   reviewer_email／reviewer_role：一律取自伺服器端的工作階段
      //
      // 唯一索引令重試或重複提交不會產生重複事件（冪等），同時允許同一版本先後
      // 出現不同決定（例如先退回、修改後再通過）。
      `CREATE TABLE IF NOT EXISTS question_reviews (
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        decision TEXT NOT NULL,
        reason TEXT,
        reviewer_email TEXT NOT NULL,
        reviewer_role TEXT NOT NULL,
        question_fingerprint TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_question_reviews_unique
         ON question_reviews(question_id, revision, decision, question_fingerprint)`,
      `CREATE INDEX IF NOT EXISTS idx_question_reviews_question
         ON question_reviews(question_id, created_at DESC)`,
    ],
  },
  {
    id: "0016-maintenance-runs",
    statements: [
      // 定期維護（例如 AI 用量記錄的保留期清理）的執行紀錄。
      //
      // 每一類維護只保留一列（最新一次），用於回答「清理實際上何時執行過、成功或失敗」；
      // 沒有這種紀錄就無法證明保留期真的在運作，只能聲稱「有寫過清理程式碼」。
      `CREATE TABLE IF NOT EXISTS maintenance_runs (
        kind TEXT PRIMARY KEY,
        last_started_at TEXT NOT NULL,
        last_finished_at TEXT,
        last_status TEXT NOT NULL,
        last_detail TEXT,
        runs INTEGER NOT NULL DEFAULT 0,
        failures INTEGER NOT NULL DEFAULT 0
      )`,
    ],
  },
  {
    id: "0017-document-governance",
    statements: [
      // 教材發布的兩項**分開**確認（Sprint 5）：
      //
      //   rights_*  ：版權／發行權確認——學校是否有權在平台向學生發布這份內容。
      //   content_* ：內容安全覆核——已逐段核對，沒有答案、評分參考、教師註記等
      //               不適合學生閱讀的內容（教師版文件必須有此確認）。
      //
      // 兩者是不同的問題，必須分開記錄：有發行權不等於內容安全（教師版就有發行權
      // 但仍含答案）；內容安全也不等於有發行權。分開記錄後，「這份文件為何可以給
      // 學生看」可以逐項回答，而不是只看一個布林值。
      //
      // 每次「開放」都需要重新確認（PATCH 要求帶 confirmRights；教師版另需
      // confirmTeacherEdition），因此這裡只保存最近一次確認的結果及時間。
      `ALTER TABLE material_documents ADD COLUMN rights_confirmed_at TEXT`,
      `ALTER TABLE material_documents ADD COLUMN rights_confirmed_by TEXT`,
      `ALTER TABLE material_documents ADD COLUMN content_reviewed_at TEXT`,
      `ALTER TABLE material_documents ADD COLUMN content_reviewed_by TEXT`,
    ],
  },
  {
    id: "0018-remove-empty-paleolithic-regions-section",
    statements: [
      // 教材中「不同地區的舊石器時代人類」只有標題、沒有任何內容段落，因此學生端
      // 一直顯示「未有教材」而無法選用；擁有者決定把這個分節由課程中刪除
      // （課程種子的定義已同步移除，之後的教材匯入亦會略過該標題，見 exclusions.ts）。
      //
      // 這裡清除舊資料庫中可能仍存在的列，避免舊資料庫保留一個沒有內容的分節。
      `DELETE FROM questions WHERE section_id = 'topic-1-origins-regions'`,
      `DELETE FROM material_blocks WHERE section_id = 'topic-1-origins-regions'`,
      `DELETE FROM sections WHERE id = 'topic-1-origins-regions'`,
    ],
  },
  {
    id: "0019-auto-quality-gate-and-report-binding",
    statements: [
      // ── 自動品質驗證紀錄（Sprint 7.8）────────────────────────────────
      // 學生自學不應等待教師逐題預先批准。題目通過**自動品質閘門**後即可供學生
      // 練習；教師覆核改為事後補救（由既有的 question_reviews 負責）。
      //
      // 這裡刻意**不**寫入任何覆核紀錄：自動驗證不是人工覆核，教師端一律顯示為
      // 「已發布（未經人工覆核）」，不會偽造「已覆核」的歷史。
      //
      // 與覆核紀錄一樣綁定版本及內容指紋：內容一改（revision 遞增）即失效。
      `ALTER TABLE questions ADD COLUMN auto_validated_at TEXT`,
      `ALTER TABLE questions ADD COLUMN auto_validated_revision INTEGER`,
      `ALTER TABLE questions ADD COLUMN auto_validated_fingerprint TEXT`,
      // ── 回報綁定題目版本及作答 ─────────────────────────────────────
      // 回報必須指向「學生實際看到的那一版」：題目之後可能被修正，只有記下
      // 版本及指紋，教師才能分辨「回報的是舊版」抑或「現行版本仍有問題」。
      // attempt_id 記錄相關作答，讓教師直接看到學生的答案及批改結果。
      `ALTER TABLE question_reports ADD COLUMN question_revision INTEGER`,
      `ALTER TABLE question_reports ADD COLUMN question_fingerprint TEXT`,
      `ALTER TABLE question_reports ADD COLUMN attempt_id TEXT`,
      // 教師處理回報時一併採取的行動（例如 make-draft、disable、revalidate），
      // 令「回報 → 做了甚麼」有紀錄，而不是只有「已處理」。
      `ALTER TABLE question_reports ADD COLUMN resolution_action TEXT`,
      // ── 作答記錄的題目版本 ─────────────────────────────────────────
      // 批改一律使用練習快照中凍結的題目（見 practice-service.submitAnswer）；
      // 記下當時的版本，才能在題目被修正後指出「哪些舊作答會受影響」，
      // 而不會靜默改動學生的歷史分數。
      `ALTER TABLE attempts ADD COLUMN question_revision INTEGER`,
    ],
  },
  {
    id: "0020-teacher-confirmation-required",
    statements: [
      // ── 未解決的品質疑問必須先由教師確認，才可發布給學生 ─────────────
      //
      // Sprint 7.8 的閘門只有「blocking（丟棄）」與「warning（提示後仍發布）」兩種結果。
      // Sprint 7.9 對抗式試點發現這不夠：有些題目**沒有逐字**教材依據，只是教材語句的
      // 改寫（真實模型最常見的選擇題寫法），既不能直接丟棄（可能完全正確），亦不可
      // 當作已證實（無法確認答案依據）。這類題目以往只收到警告而照樣自動發布。
      //
      // 現在閘門有第三種結果：uncertain（未確定）。此欄標記「自動發布被暫緩，等待教師
      // 確認」，題目仍然保留在題庫（狀態維持草稿），教師可以在「題目管理」核對後發布。
      // 自動發布的三條路徑一律查核此欄（見 question-service）。
      //
      // 預設 0：舊資料及人工建立的題目不受影響；只有閘門判定未確定時才會設為 1。
      `ALTER TABLE questions ADD COLUMN teacher_confirmation_required INTEGER NOT NULL DEFAULT 0`,
    ],
  },
  {
    id: "0021-review-decision-events",
    statements: [
      // ── 同一版本可以出現兩次相同的覆核決定 ───────────────────────────
      //
      // 舊有唯一索引 (question_id, revision, decision, question_fingerprint) 令重複提交
      // 冪等，但同時吞掉了「教師在疑問出現之後重新確認同一版內容」這個真實事件：
      // 批次授權核准 → 自動修復／匯入正規化把題目標示「待教師確認」→ 教師核對後再次
      // 核准。第二次決定不會寫入，於是「誰在何時解除了暫緩」沒有可稽核的時間戳。
      //
      // 改為由應用層維持冪等（見 repositories/questions.ts 的 insertQuestionReview）：
      //   - 題目沒有「待教師確認」標記時，相同的重複提交回傳既有紀錄，不新增；
      //   - 題目有待確認標記時，允許新增一筆紀錄，因為那是對新疑問的獨立決定。
      `DROP INDEX IF EXISTS idx_question_reviews_unique`,
    ],
  },
  {
    id: "0022-golden-fixture-reviews",
    statements: [
      // Golden Dataset 的人工核准紀錄（Sprint 11）。
      // 與 `question_reviews`（題目是否可對學生發布）刻意分開：Golden fixture 是
      // **評估基準**，核准與否不改變題目的發布狀態，兩者的證據不可互相取代。
      `CREATE TABLE IF NOT EXISTS golden_fixture_reviews (
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        question_fingerprint TEXT NOT NULL,
        decision TEXT NOT NULL,
        reason TEXT NOT NULL,
        reviewer_email TEXT NOT NULL,
        reviewer_role TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_golden_fixture_reviews_question
        ON golden_fixture_reviews (question_id, created_at)`,
    ],
  },
  {
    id: "0023-topic5-consolidated-themes",
    statements: [
      // 2026-10-20 擁有者指示：課題5 原本 18 個子分節對學生而言太瑣碎，
      // 整合為「文藝復興與宗教改革」「科學革命與啟蒙運動」「工業革命」「法國大革命」4 個主題。
      //
      // 舊資料庫的教材段落及題目會一併改掛到新的主題（先改掛、後刪除舊分節，
      // 以符合 section_id 的外鍵），因此學生的既有練習紀錄及教材不會消失。
      // 全新資料庫由 seedCurriculum 建立相同的結構，這裡的 INSERT 會自動略過。
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-5-renaissance-reformation', 'topic-5', NULL, '文藝復興與宗教改革', '十四至十七世紀歐洲在文化、思想及宗教上的革新運動：文藝復興的特點、成因、起源與發展，以及宗教改革的背景、發展及影響。', '["文藝復興", "從神本走向人本", "文藝復興的主要特點", "文藝復興出現的原因", "文藝復興的起源與發展", "文學、藝術與自然科學", "文學方面的發展", "藝術方面的發展", "自然科學", "文藝復興的主要發展", "文藝復興的影響", "宗教改革", "宗教改革的背景", "宗教改革的發展", "宗教改革的影響"]', 0,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-5')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-5-renaissance-reformation')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '文藝復興與宗教改革',
           summary = '十四至十七世紀歐洲在文化、思想及宗教上的革新運動：文藝復興的特點、成因、起源與發展，以及宗教改革的背景、發展及影響。',
           match_keywords_json = '["文藝復興", "從神本走向人本", "文藝復興的主要特點", "文藝復興出現的原因", "文藝復興的起源與發展", "文學、藝術與自然科學", "文學方面的發展", "藝術方面的發展", "自然科學", "文藝復興的主要發展", "文藝復興的影響", "宗教改革", "宗教改革的背景", "宗教改革的發展", "宗教改革的影響"]',
           sort_order = 0,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-5-renaissance-reformation'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-5-science-enlightenment', 'topic-5', NULL, '科學革命與啟蒙運動', '十六至十八世紀歐洲在科學與思想上的一系列變革：科學革命的原因、發展及影響，以及啟蒙運動的背景、思想、傳播及影響。', '["科學革命", "啟蒙運動", "理性時代", "科學革命（十七至十八世紀）", "科學革命的原因", "科學革命的主要發展", "科學革命出現原因", "啟蒙運動（十七至十八世紀）", "主要的啟蒙思想", "啟蒙思想的傳播", "啟蒙運動的影響"]', 1,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-5')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-5-science-enlightenment')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '科學革命與啟蒙運動',
           summary = '十六至十八世紀歐洲在科學與思想上的一系列變革：科學革命的原因、發展及影響，以及啟蒙運動的背景、思想、傳播及影響。',
           match_keywords_json = '["科學革命", "啟蒙運動", "理性時代", "科學革命（十七至十八世紀）", "科學革命的原因", "科學革命的主要發展", "科學革命出現原因", "啟蒙運動（十七至十八世紀）", "主要的啟蒙思想", "啟蒙思想的傳播", "啟蒙運動的影響"]',
           sort_order = 1,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-5-science-enlightenment'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-5-industrial', 'topic-5', NULL, '工業革命', '十八世紀中葉至十九世紀末歐美的重大技術變革：特點與出現原因、英國率先展開的原因、主要發展及影響。', '["工業革命", "技術的革新", "工業革命的特點", "工業革命的出現原因", "工業革命出現的原因", "英國率先展開工業革命的原因", "英國率先", "工業革命的主要發展", "革命的起點", "新能源的應用", "工業革命的影響", "工業革命帶來的重要轉變"]', 2,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-5')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-5-industrial')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '工業革命',
           summary = '十八世紀中葉至十九世紀末歐美的重大技術變革：特點與出現原因、英國率先展開的原因、主要發展及影響。',
           match_keywords_json = '["工業革命", "技術的革新", "工業革命的特點", "工業革命的出現原因", "工業革命出現的原因", "英國率先展開工業革命的原因", "英國率先", "工業革命的主要發展", "革命的起點", "新能源的應用", "工業革命的影響", "工業革命帶來的重要轉變"]',
           sort_order = 2,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-5-industrial'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-5-french-revolution', 'topic-5', NULL, '法國大革命', '十八世紀末法國的政治革命及隨後的拿破崙時代：背景與成因、革命經過、拿破崙的上台與帝國，以及對後世的影響。', '["法國大革命", "拿破崙時代", "對自由和民主的追求", "革命的背景", "革命的成因", "革命的經過", "革命的爆發", "革命的導火線", "拿破崙的上台", "拿破崙的改革", "法國大革命及拿破崙時代的影響", "自由主義及民族主義"]', 3,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-5')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-5-french-revolution')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '法國大革命',
           summary = '十八世紀末法國的政治革命及隨後的拿破崙時代：背景與成因、革命經過、拿破崙的上台與帝國，以及對後世的影響。',
           match_keywords_json = '["法國大革命", "拿破崙時代", "對自由和民主的追求", "革命的背景", "革命的成因", "革命的經過", "革命的爆發", "革命的導火線", "拿破崙的上台", "拿破崙的改革", "法國大革命及拿破崙時代的影響", "自由主義及民族主義"]',
           sort_order = 3,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-5-french-revolution'`,
      `UPDATE material_blocks SET section_id = 'topic-5-renaissance-reformation' WHERE section_id IN ('topic-5-renaissance', 'topic-5-renaissance-features', 'topic-5-renaissance-causes', 'topic-5-renaissance-origin', 'topic-5-renaissance-culture', 'topic-5-renaissance-impact', 'topic-5-reformation', 'topic-5-reformation-background', 'topic-5-reformation-development', 'topic-5-reformation-impact')`,
      `UPDATE questions SET section_id = 'topic-5-renaissance-reformation' WHERE section_id IN ('topic-5-renaissance', 'topic-5-renaissance-features', 'topic-5-renaissance-causes', 'topic-5-renaissance-origin', 'topic-5-renaissance-culture', 'topic-5-renaissance-impact', 'topic-5-reformation', 'topic-5-reformation-background', 'topic-5-reformation-development', 'topic-5-reformation-impact')`,
      `UPDATE material_blocks SET section_id = 'topic-5-science-enlightenment' WHERE section_id IN ('topic-5-science', 'topic-5-enlightenment')`,
      `UPDATE questions SET section_id = 'topic-5-science-enlightenment' WHERE section_id IN ('topic-5-science', 'topic-5-enlightenment')`,
      `UPDATE material_blocks SET section_id = 'topic-5-industrial' WHERE section_id IN ('topic-5-industrial-features', 'topic-5-industrial-britain', 'topic-5-industrial-development', 'topic-5-industrial-impact')`,
      `UPDATE questions SET section_id = 'topic-5-industrial' WHERE section_id IN ('topic-5-industrial-features', 'topic-5-industrial-britain', 'topic-5-industrial-development', 'topic-5-industrial-impact')`,
      `UPDATE material_blocks SET section_id = 'topic-5-french-revolution' WHERE section_id IN ('topic-5-fr-background', 'topic-5-fr-course', 'topic-5-fr-napoleon', 'topic-5-fr-impact')`,
      `UPDATE questions SET section_id = 'topic-5-french-revolution' WHERE section_id IN ('topic-5-fr-background', 'topic-5-fr-course', 'topic-5-fr-napoleon', 'topic-5-fr-impact')`,
      `DELETE FROM sections WHERE id IN ('topic-5-renaissance', 'topic-5-renaissance-features', 'topic-5-renaissance-causes', 'topic-5-renaissance-origin', 'topic-5-renaissance-culture', 'topic-5-renaissance-impact', 'topic-5-reformation', 'topic-5-reformation-background', 'topic-5-reformation-development', 'topic-5-reformation-impact', 'topic-5-science', 'topic-5-enlightenment', 'topic-5-industrial-features', 'topic-5-industrial-britain', 'topic-5-industrial-development', 'topic-5-industrial-impact', 'topic-5-fr-background', 'topic-5-fr-course', 'topic-5-fr-napoleon', 'topic-5-fr-impact')`,
    ],
  },
  {
    id: "0024-topic1-consolidated-themes",
    statements: [
      // 2026-10-20 擁有者指示：課題1 原本 12 個分節（含子分節）對學生而言太瑣碎，
      // 整合為「石器時代的演進」「古文明的興起」「尼羅河流域文明」「古與今：人類相同的基本需要」4 個主題。
      //
      // 舊資料庫的教材段落及題目會一併改掛到新的主題（先改掛、後刪除舊分節，
      // 以符合 section_id 的外鍵），因此學生的既有練習紀錄及教材不會消失。
      // 全新資料庫由 seedCurriculum 建立相同的結構，這裡的 INSERT 會自動略過。
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-1-stone-age', 'topic-1', NULL, '石器時代的演進', '人類歷史的起源與古人類的演化、史前時期與信史時期的劃分，以及舊石器時代、新石器時代至石器時代終結的演進。', '["石器時代的演進", "人類歷史的起源", "古人類", "南方古猿", "智人", "直立人", "能人", "歷史時期的劃分", "史前時期與信史時期", "計時紀年", "舊石器時代", "新石器時代", "新的生活模式", "石器時代的終結"]', 0,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-1')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-1-stone-age')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '石器時代的演進',
           summary = '人類歷史的起源與古人類的演化、史前時期與信史時期的劃分，以及舊石器時代、新石器時代至石器時代終結的演進。',
           match_keywords_json = '["石器時代的演進", "人類歷史的起源", "古人類", "南方古猿", "智人", "直立人", "能人", "歷史時期的劃分", "史前時期與信史時期", "計時紀年", "舊石器時代", "新石器時代", "新的生活模式", "石器時代的終結"]',
           sort_order = 0,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-1-stone-age'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-1-civilisation-rise', 'topic-1', NULL, '古文明的興起', '文明的特徵、古文明誕生的背景，以及四大古代文明的發源地與共同條件。', '["古文明的興起", "古文明的誕生", "文明的特徵", "城市生活的興起", "文字的發明", "古文明誕生的背景", "四大古代文明", "四大古代文明的簡介", "四大古代文明的特徵", "四大古代文明的發源地", "大河文明"]', 1,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-1')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-1-civilisation-rise')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '古文明的興起',
           summary = '文明的特徵、古文明誕生的背景，以及四大古代文明的發源地與共同條件。',
           match_keywords_json = '["古文明的興起", "古文明的誕生", "文明的特徵", "城市生活的興起", "文字的發明", "古文明誕生的背景", "四大古代文明", "四大古代文明的簡介", "四大古代文明的特徵", "四大古代文明的發源地", "大河文明"]',
           sort_order = 1,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-1-civilisation-rise'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-1-nile-civilisation', 'topic-1', NULL, '尼羅河流域文明', '古埃及文明（尼羅河流域）的位置、民族、衰落及文明特徵。', '["尼羅河流域文明", "尼羅河流域", "尼羅河", "古代埃及文明", "古埃及文明", "古埃及", "埃及"]', 2,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-1')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-1-nile-civilisation')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '尼羅河流域文明',
           summary = '古埃及文明（尼羅河流域）的位置、民族、衰落及文明特徵。',
           match_keywords_json = '["尼羅河流域文明", "尼羅河流域", "尼羅河", "古代埃及文明", "古埃及文明", "古埃及", "埃及"]',
           sort_order = 2,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-1-nile-civilisation'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-1-summary', 'topic-1', NULL, '古與今：人類相同的基本需要', '比較古今人類在飲食、記錄、管治及居住等基本需要上的延續與轉變。', '["古與今", "人類相同的基本需要", "基本的生存需要", "總結"]', 3,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-1')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-1-summary')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '古與今：人類相同的基本需要',
           summary = '比較古今人類在飲食、記錄、管治及居住等基本需要上的延續與轉變。',
           match_keywords_json = '["古與今", "人類相同的基本需要", "基本的生存需要", "總結"]',
           sort_order = 3,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-1-summary'`,
      `UPDATE material_blocks SET section_id = 'topic-1-stone-age' WHERE section_id IN ('topic-1-origins', 'topic-1-origins-species', 'topic-1-periods', 'topic-1-periods-paleolithic', 'topic-1-periods-neolithic', 'topic-1-periods-end')`,
      `UPDATE questions SET section_id = 'topic-1-stone-age' WHERE section_id IN ('topic-1-origins', 'topic-1-origins-species', 'topic-1-periods', 'topic-1-periods-paleolithic', 'topic-1-periods-neolithic', 'topic-1-periods-end')`,
      `UPDATE material_blocks SET section_id = 'topic-1-civilisation-rise' WHERE section_id IN ('topic-1-civilisation', 'topic-1-civilisation-features', 'topic-1-civilisation-background', 'topic-1-four-civilisations')`,
      `UPDATE questions SET section_id = 'topic-1-civilisation-rise' WHERE section_id IN ('topic-1-civilisation', 'topic-1-civilisation-features', 'topic-1-civilisation-background', 'topic-1-four-civilisations')`,
      `UPDATE material_blocks SET section_id = 'topic-1-nile-civilisation' WHERE section_id IN ('topic-1-four-civilisations-egypt')`,
      `UPDATE questions SET section_id = 'topic-1-nile-civilisation' WHERE section_id IN ('topic-1-four-civilisations-egypt')`,
      `DELETE FROM sections WHERE id IN ('topic-1-origins', 'topic-1-origins-species', 'topic-1-periods', 'topic-1-periods-paleolithic', 'topic-1-periods-neolithic', 'topic-1-periods-end', 'topic-1-civilisation', 'topic-1-civilisation-features', 'topic-1-civilisation-background', 'topic-1-four-civilisations', 'topic-1-four-civilisations-egypt')`,
    ],
  },
  {
    id: "0025-consolidate-topic-themes",
    statements: [
      // 2026-10-20 擁有者指示：課題2-4 及 6-12 的分節對學生而言太瑣碎，整合為較少的主題
      // （課題1 及課題5 已分別由 migration 0024、0023 處理）。
      //
      // 先建立／更新主題，再按整個舊分節改掛教材段落及題目；課題9 的「猶太大屠殺」
      // 及課題10 的「後冷戰時期」在同一份筆記內，因此先按內容關鍵詞切出，之後才做整節改掛。
      // 最後刪除不再使用的舊分節（此時已沒有段落或題目指向它們，符合外鍵）。
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-1-stone-age', 'topic-1', NULL, '石器時代的演進', '人類歷史的起源與古人類的演化、史前時期與信史時期的劃分，以及舊石器時代、新石器時代至石器時代終結的演進。', '["石器時代的演進", "人類歷史的起源", "古人類", "南方古猿", "智人", "直立人", "能人", "歷史時期的劃分", "史前時期與信史時期", "計時紀年", "舊石器時代", "新石器時代", "新的生活模式", "石器時代的終結"]', 0,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-1')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-1-stone-age')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '石器時代的演進',
           summary = '人類歷史的起源與古人類的演化、史前時期與信史時期的劃分，以及舊石器時代、新石器時代至石器時代終結的演進。',
           match_keywords_json = '["石器時代的演進", "人類歷史的起源", "古人類", "南方古猿", "智人", "直立人", "能人", "歷史時期的劃分", "史前時期與信史時期", "計時紀年", "舊石器時代", "新石器時代", "新的生活模式", "石器時代的終結"]',
           sort_order = 0,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-1-stone-age'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-1-civilisation-rise', 'topic-1', NULL, '古文明的興起', '文明的特徵、古文明誕生的背景，以及四大古代文明的發源地與共同條件。', '["古文明的興起", "古文明的誕生", "文明的特徵", "城市生活的興起", "文字的發明", "古文明誕生的背景", "四大古代文明", "四大古代文明的簡介", "四大古代文明的特徵", "四大古代文明的發源地", "大河文明"]', 0,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-1')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-1-civilisation-rise')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '古文明的興起',
           summary = '文明的特徵、古文明誕生的背景，以及四大古代文明的發源地與共同條件。',
           match_keywords_json = '["古文明的興起", "古文明的誕生", "文明的特徵", "城市生活的興起", "文字的發明", "古文明誕生的背景", "四大古代文明", "四大古代文明的簡介", "四大古代文明的特徵", "四大古代文明的發源地", "大河文明"]',
           sort_order = 0,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-1-civilisation-rise'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-1-nile-civilisation', 'topic-1', NULL, '尼羅河流域文明', '古埃及文明（尼羅河流域）的位置、民族、衰落及文明特徵。', '["尼羅河流域文明", "尼羅河流域", "尼羅河", "古代埃及文明", "古埃及文明", "古埃及", "埃及"]', 0,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-1')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-1-nile-civilisation')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '尼羅河流域文明',
           summary = '古埃及文明（尼羅河流域）的位置、民族、衰落及文明特徵。',
           match_keywords_json = '["尼羅河流域文明", "尼羅河流域", "尼羅河", "古代埃及文明", "古埃及文明", "古埃及", "埃及"]',
           sort_order = 0,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-1-nile-civilisation'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-1-summary', 'topic-1', NULL, '古與今：人類相同的基本需要', '比較古今人類在飲食、記錄、管治及居住等基本需要上的延續與轉變。', '["古與今", "人類相同的基本需要", "基本的生存需要", "總結"]', 0,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-1')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-1-summary')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '古與今：人類相同的基本需要',
           summary = '比較古今人類在飲食、記錄、管治及居住等基本需要上的延續與轉變。',
           match_keywords_json = '["古與今", "人類相同的基本需要", "基本的生存需要", "總結"]',
           sort_order = 0,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-1-summary'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-2-classical-intro', 'topic-2', NULL, '古典文明的介紹', '歐洲歷史時期的劃分、早期文明，以及古希臘與古羅馬的地理環境、政治制度與文化成就。', '["古典文明的介紹", "歐洲歷史時期的劃分", "歐洲的早期文明", "古典文明", "古希臘文明", "古希臘的地理環境", "斯巴達", "雅典民主政治", "古羅馬文明", "羅馬共和", "羅馬元首制", "羅馬帝國"]', 1,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-2')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-2-classical-intro')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '古典文明的介紹',
           summary = '歐洲歷史時期的劃分、早期文明，以及古希臘與古羅馬的地理環境、政治制度與文化成就。',
           match_keywords_json = '["古典文明的介紹", "歐洲歷史時期的劃分", "歐洲的早期文明", "古典文明", "古希臘文明", "古希臘的地理環境", "斯巴達", "雅典民主政治", "古羅馬文明", "羅馬共和", "羅馬元首制", "羅馬帝國"]',
           sort_order = 1,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-2-classical-intro'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-2-classical-legacy', 'topic-2', NULL, '古典文明的遺產與意義', '古典文明在政治制度、法律、建築、語言及思想上的貢獻。', '["古典文明的遺產與意義", "歐洲古典文明的遺產與意義"]', 1,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-2')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-2-classical-legacy')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '古典文明的遺產與意義',
           summary = '古典文明在政治制度、法律、建築、語言及思想上的貢獻。',
           match_keywords_json = '["古典文明的遺產與意義", "歐洲古典文明的遺產與意義"]',
           sort_order = 1,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-2-classical-legacy'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-2-medieval-europe', 'topic-2', NULL, '中古時代的歐洲與基督宗教世界的形成', '西羅馬帝國滅亡後歐洲的轉變、基督宗教世界的形成、封建社會的特徵，以及中古時代的遺產與結束。', '["中古時代的歐洲與基督宗教世界的形成", "歐洲踏入中古時代", "中古時代的歐洲", "基督宗教世界的形成", "基督宗教在歐洲的傳播", "封建社會的出現及其特徵", "歐洲封建社會", "歐洲中古文明的遺產與意義", "中古時代的結束", "1453年"]', 1,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-2')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-2-medieval-europe')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '中古時代的歐洲與基督宗教世界的形成',
           summary = '西羅馬帝國滅亡後歐洲的轉變、基督宗教世界的形成、封建社會的特徵，以及中古時代的遺產與結束。',
           match_keywords_json = '["中古時代的歐洲與基督宗教世界的形成", "歐洲踏入中古時代", "中古時代的歐洲", "基督宗教世界的形成", "基督宗教在歐洲的傳播", "封建社會的出現及其特徵", "歐洲封建社會", "歐洲中古文明的遺產與意義", "中古時代的結束", "1453年"]',
           sort_order = 1,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-2-medieval-europe'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-3-islam', 'topic-3', NULL, '伊斯蘭教的起源、教義與發展', '穆罕默德的創教、伊斯蘭教的主要教義，以及伊斯蘭教內部的發展與分歧。', '["伊斯蘭教的起源、教義與發展", "認識伊斯蘭教", "穆罕默德", "古蘭經", "五功", "哈里發", "對伊瑪目（Imam）地位的不同看法", "622-661年間穆斯林的控制範圍", "610年的阿拉伯半島與鄰近帝國"]', 2,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-3')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-3-islam')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '伊斯蘭教的起源、教義與發展',
           summary = '穆罕默德的創教、伊斯蘭教的主要教義，以及伊斯蘭教內部的發展與分歧。',
           match_keywords_json = '["伊斯蘭教的起源、教義與發展", "認識伊斯蘭教", "穆罕默德", "古蘭經", "五功", "哈里發", "對伊瑪目（Imam）地位的不同看法", "622-661年間穆斯林的控制範圍", "610年的阿拉伯半島與鄰近帝國"]',
           sort_order = 2,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-3-islam'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-3-contact', 'topic-3', NULL, '中古時代歐亞的接觸及伊斯蘭教的傳播', '阿拉伯帝國的擴張、十字軍東征等戰爭形式，以及陸上與海上絲綢之路、仲介貿易等商貿形式如何促成歐亞接觸及伊斯蘭教的傳播（包括中古時代以前的歐亞往來）。', '["中古時代歐亞的接觸及伊斯蘭教的傳播", "歐亞接觸的形式", "阿拉伯帝國的擴張", "阿拉伯帝國逐漸形成", "十字軍東征", "戰爭對歐亞文化交流的影響", "陸上絲綢之路", "絲綢之路", "阿拉伯人的仲介貿易", "海上絲綢之路", "意大利城邦", "商貿對歐亞文化交流的影響", "中古時代歐亞的貿易路線"]', 2,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-3')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-3-contact')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '中古時代歐亞的接觸及伊斯蘭教的傳播',
           summary = '阿拉伯帝國的擴張、十字軍東征等戰爭形式，以及陸上與海上絲綢之路、仲介貿易等商貿形式如何促成歐亞接觸及伊斯蘭教的傳播（包括中古時代以前的歐亞往來）。',
           match_keywords_json = '["中古時代歐亞的接觸及伊斯蘭教的傳播", "歐亞接觸的形式", "阿拉伯帝國的擴張", "阿拉伯帝國逐漸形成", "十字軍東征", "戰爭對歐亞文化交流的影響", "陸上絲綢之路", "絲綢之路", "阿拉伯人的仲介貿易", "海上絲綢之路", "意大利城邦", "商貿對歐亞文化交流的影響", "中古時代歐亞的貿易路線"]',
           sort_order = 2,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-3-contact'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-3-results', 'topic-3', NULL, '歐亞文化交流的結果及影響', '歐亞文化交流如何擴闊歐洲人的視野、促進歐洲文明在亞洲傳播，並促成伊斯蘭文明的興起及其成就。', '["歐亞文化交流的結果及影響", "擴闊中古時代歐洲人的視野", "促進歐洲文明在亞洲傳播", "促成伊斯蘭文明的興起", "伊斯蘭文明的主要成就", "繪畫與建築", "總結：中古時代的歐亞文化交流", "回饋"]', 2,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-3')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-3-results')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '歐亞文化交流的結果及影響',
           summary = '歐亞文化交流如何擴闊歐洲人的視野、促進歐洲文明在亞洲傳播，並促成伊斯蘭文明的興起及其成就。',
           match_keywords_json = '["歐亞文化交流的結果及影響", "擴闊中古時代歐洲人的視野", "促進歐洲文明在亞洲傳播", "促成伊斯蘭文明的興起", "伊斯蘭文明的主要成就", "繪畫與建築", "總結：中古時代的歐亞文化交流", "回饋"]',
           sort_order = 2,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-3-results'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-4-clans', 'topic-4', NULL, '主要民系與姓族', '信史時期香港的管轄、四大民系及新界本地人五大姓族的來源、路線及聚居地。', '["主要民系與姓族", "主要的民系及姓族", "四大民系", "四大民系從內地來港", "來港的主要路線", "新界本地人五大姓族", "新界五大姓族的聚居地分布", "信史時期的香港", "早期香港的主要人口"]', 3,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-4')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-4-clans')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '主要民系與姓族',
           summary = '信史時期香港的管轄、四大民系及新界本地人五大姓族的來源、路線及聚居地。',
           match_keywords_json = '["主要民系與姓族", "主要的民系及姓族", "四大民系", "四大民系從內地來港", "來港的主要路線", "新界本地人五大姓族", "新界五大姓族的聚居地分布", "信史時期的香港", "早期香港的主要人口"]',
           sort_order = 3,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-4-clans'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-4-heritage', 'topic-4', NULL, '香港的非物質文化遺產', '文化遺產與非物質文化遺產的分別、非物質文化遺產的五大類別，以及四項具代表性的香港非物質文化遺產。', '["香港的非物質文化遺產", "文化遺產與非物質文化遺產", "非物質文化遺產", "非物質文化遺產的五大類別", "四項具代表性的香港非物質文化遺產", "戲棚內上演潮州神功戲", "由傳統習俗演變成競賽活動"]', 3,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-4')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-4-heritage')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '香港的非物質文化遺產',
           summary = '文化遺產與非物質文化遺產的分別、非物質文化遺產的五大類別，以及四項具代表性的香港非物質文化遺產。',
           match_keywords_json = '["香港的非物質文化遺產", "文化遺產與非物質文化遺產", "非物質文化遺產", "非物質文化遺產的五大類別", "四項具代表性的香港非物質文化遺產", "戲棚內上演潮州神功戲", "由傳統習俗演變成競賽活動"]',
           sort_order = 3,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-4-heritage'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-4-heritage-life', 'topic-4', NULL, '通過四項具代表性的香港非物質文化遺產認識本地居民的生活', '以早期香港居民的生活（居所與建築、主要為生方法、傳統教育、信仰與習俗，例如大坑舞火龍）說明非物質文化遺產與本地生活的關係。', '["通過四項具代表性的香港非物質文化遺產認識本地居民的生活", "早期香港居民的生活", "居所與建築", "主要為生方法", "傳統教育", "信仰與習俗", "大坑舞火龍"]', 3,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-4')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-4-heritage-life')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '通過四項具代表性的香港非物質文化遺產認識本地居民的生活',
           summary = '以早期香港居民的生活（居所與建築、主要為生方法、傳統教育、信仰與習俗，例如大坑舞火龍）說明非物質文化遺產與本地生活的關係。',
           match_keywords_json = '["通過四項具代表性的香港非物質文化遺產認識本地居民的生活", "早期香港居民的生活", "居所與建築", "主要為生方法", "傳統教育", "信仰與習俗", "大坑舞火龍"]',
           sort_order = 3,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-4-heritage-life'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-5-renaissance-reformation', 'topic-5', NULL, '文藝復興與宗教改革', '十四至十七世紀歐洲在文化、思想及宗教上的革新運動：文藝復興的特點、成因、起源與發展，以及宗教改革的背景、發展及影響。', '["文藝復興", "從神本走向人本", "文藝復興的主要特點", "文藝復興出現的原因", "文藝復興的起源與發展", "文學、藝術與自然科學", "文學方面的發展", "藝術方面的發展", "自然科學", "文藝復興的主要發展", "文藝復興的影響", "宗教改革", "宗教改革的背景", "宗教改革的發展", "宗教改革的影響"]', 4,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-5')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-5-renaissance-reformation')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '文藝復興與宗教改革',
           summary = '十四至十七世紀歐洲在文化、思想及宗教上的革新運動：文藝復興的特點、成因、起源與發展，以及宗教改革的背景、發展及影響。',
           match_keywords_json = '["文藝復興", "從神本走向人本", "文藝復興的主要特點", "文藝復興出現的原因", "文藝復興的起源與發展", "文學、藝術與自然科學", "文學方面的發展", "藝術方面的發展", "自然科學", "文藝復興的主要發展", "文藝復興的影響", "宗教改革", "宗教改革的背景", "宗教改革的發展", "宗教改革的影響"]',
           sort_order = 4,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-5-renaissance-reformation'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-5-science-enlightenment', 'topic-5', NULL, '科學革命與啟蒙運動', '十六至十八世紀歐洲在科學與思想上的一系列變革：科學革命的原因、發展及影響，以及啟蒙運動的背景、思想、傳播及影響。', '["科學革命", "啟蒙運動", "理性時代", "科學革命（十七至十八世紀）", "科學革命的原因", "科學革命的主要發展", "科學革命出現原因", "啟蒙運動（十七至十八世紀）", "主要的啟蒙思想", "啟蒙思想的傳播", "啟蒙運動的影響"]', 4,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-5')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-5-science-enlightenment')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '科學革命與啟蒙運動',
           summary = '十六至十八世紀歐洲在科學與思想上的一系列變革：科學革命的原因、發展及影響，以及啟蒙運動的背景、思想、傳播及影響。',
           match_keywords_json = '["科學革命", "啟蒙運動", "理性時代", "科學革命（十七至十八世紀）", "科學革命的原因", "科學革命的主要發展", "科學革命出現原因", "啟蒙運動（十七至十八世紀）", "主要的啟蒙思想", "啟蒙思想的傳播", "啟蒙運動的影響"]',
           sort_order = 4,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-5-science-enlightenment'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-5-industrial', 'topic-5', NULL, '工業革命', '十八世紀中葉至十九世紀末歐美的重大技術變革：特點與出現原因、英國率先展開的原因、主要發展及影響。', '["工業革命", "技術的革新", "工業革命的特點", "工業革命的出現原因", "工業革命出現的原因", "英國率先展開工業革命的原因", "英國率先", "工業革命的主要發展", "革命的起點", "新能源的應用", "工業革命的影響", "工業革命帶來的重要轉變"]', 4,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-5')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-5-industrial')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '工業革命',
           summary = '十八世紀中葉至十九世紀末歐美的重大技術變革：特點與出現原因、英國率先展開的原因、主要發展及影響。',
           match_keywords_json = '["工業革命", "技術的革新", "工業革命的特點", "工業革命的出現原因", "工業革命出現的原因", "英國率先展開工業革命的原因", "英國率先", "工業革命的主要發展", "革命的起點", "新能源的應用", "工業革命的影響", "工業革命帶來的重要轉變"]',
           sort_order = 4,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-5-industrial'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-5-french-revolution', 'topic-5', NULL, '法國大革命', '十八世紀末法國的政治革命及隨後的拿破崙時代：背景與成因、革命經過、拿破崙的上台與帝國，以及對後世的影響。', '["法國大革命", "拿破崙時代", "對自由和民主的追求", "革命的背景", "革命的成因", "革命的經過", "革命的爆發", "革命的導火線", "拿破崙的上台", "拿破崙的改革", "法國大革命及拿破崙時代的影響", "自由主義及民族主義"]', 4,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-5')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-5-french-revolution')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '法國大革命',
           summary = '十八世紀末法國的政治革命及隨後的拿破崙時代：背景與成因、革命經過、拿破崙的上台與帝國，以及對後世的影響。',
           match_keywords_json = '["法國大革命", "拿破崙時代", "對自由和民主的追求", "革命的背景", "革命的成因", "革命的經過", "革命的爆發", "革命的導火線", "拿破崙的上台", "拿破崙的改革", "法國大革命及拿破崙時代的影響", "自由主義及民族主義"]',
           sort_order = 4,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-5-french-revolution'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-6-causes', 'topic-6', NULL, '歐洲殖民擴張的原因', '早期擴張（十六世紀初至十八世紀末）及後期擴張（十九世紀末至二十世紀初）的背景及原因。', '["歐洲國家早期擴張（十六世紀初至十八世紀末）的背景及原因", "歐洲國家後期擴張（十九世紀末至二十世紀初）的背景及原因", "早期擴張", "後期擴張", "白人的負擔", "歐洲國家擴張的原因", "背景", "原因"]', 5,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-6')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-6-causes')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '歐洲殖民擴張的原因',
           summary = '早期擴張（十六世紀初至十八世紀末）及後期擴張（十九世紀末至二十世紀初）的背景及原因。',
           match_keywords_json = '["歐洲國家早期擴張（十六世紀初至十八世紀末）的背景及原因", "歐洲國家後期擴張（十九世紀末至二十世紀初）的背景及原因", "早期擴張", "後期擴張", "白人的負擔", "歐洲國家擴張的原因", "背景", "原因"]',
           sort_order = 5,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-6-causes'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-6-methods-impact', 'topic-6', NULL, '歐洲殖民擴張的方式及影響', '歐洲殖民擴張的簡介、殖民政策的形成與演變、殖民擴張的方式（據點、殖民地、保護國、勢力範圍），以及對美、亞、非三洲與歐洲的影響。', '["歐洲殖民擴張的簡介", "歐洲殖民擴張的方式及影響", "殖民政策的形成與演變", "殖民擴張的方式", "據點", "殖民地", "保護國", "勢力範圍", "對美、亞、非三洲的影響", "對歐洲的影響", "社會及文化方面"]', 5,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-6')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-6-methods-impact')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '歐洲殖民擴張的方式及影響',
           summary = '歐洲殖民擴張的簡介、殖民政策的形成與演變、殖民擴張的方式（據點、殖民地、保護國、勢力範圍），以及對美、亞、非三洲與歐洲的影響。',
           match_keywords_json = '["歐洲殖民擴張的簡介", "歐洲殖民擴張的方式及影響", "殖民政策的形成與演變", "殖民擴張的方式", "據點", "殖民地", "保護國", "勢力範圍", "對美、亞、非三洲的影響", "對歐洲的影響", "社會及文化方面"]',
           sort_order = 5,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-6-methods-impact'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-7-revolution', 'topic-7', NULL, '美國革命的內外因素及影響', '美國革命的背景、成因與導火線、革命經過、十八世紀末的政治體制與憲法，以及革命的影響。', '["美國革命的內外因素及影響", "美國革命的內外成因", "背景、成因與導火線", "美國革命（1775-1783年）", "美國革命的影響", "十八世紀末美國的政治體制與憲法", "行政機關"]', 6,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-7')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-7-revolution')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '美國革命的內外因素及影響',
           summary = '美國革命的背景、成因與導火線、革命經過、十八世紀末的政治體制與憲法，以及革命的影響。',
           match_keywords_json = '["美國革命的內外因素及影響", "美國革命的內外成因", "背景、成因與導火線", "美國革命（1775-1783年）", "美國革命的影響", "十八世紀末美國的政治體制與憲法", "行政機關"]',
           sort_order = 6,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-7-revolution'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-7-expansion', 'topic-7', NULL, '十九世紀的美國領土拓展', '十九世紀美國向西拓展領土的過程，以及移民（包括華人）的經歷。', '["十九世紀的美國領土拓展", "十九世紀的領土拓展", "追尋美國夢的移民", "華人移居美國的原因", "早期華人勞工在美國的生活及經歷"]', 6,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-7')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-7-expansion')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '十九世紀的美國領土拓展',
           summary = '十九世紀美國向西拓展領土的過程，以及移民（包括華人）的經歷。',
           match_keywords_json = '["十九世紀的美國領土拓展", "十九世紀的領土拓展", "追尋美國夢的移民", "華人移居美國的原因", "早期華人勞工在美國的生活及經歷"]',
           sort_order = 6,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-7-expansion'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-7-civil-war', 'topic-7', NULL, '南北內戰前後的美國', '南北內戰的爆發、經過、影響，以及戰後的重要發展。', '["南北內戰前後的美國", "美國南北內戰（1861-1865年）", "美國南北內戰的影響", "美國南北內戰後的重要發展", "美國南北內戰爆發的綜合表", "《堪薩斯―內布拉斯加法案》下的美國"]', 6,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-7')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-7-civil-war')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '南北內戰前後的美國',
           summary = '南北內戰的爆發、經過、影響，以及戰後的重要發展。',
           match_keywords_json = '["南北內戰前後的美國", "美國南北內戰（1861-1865年）", "美國南北內戰的影響", "美國南北內戰後的重要發展", "美國南北內戰爆發的綜合表", "《堪薩斯―內布拉斯加法案》下的美國"]',
           sort_order = 6,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-7-civil-war'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-8-colonial-rule', 'topic-8', NULL, '英國殖民管治的建立', '英國侵佔香港的過程（割讓香港島、租借新界）及殖民管治制度的建立。', '["英國殖民管治的建立", "英國侵佔香港", "割讓香港島", "租借新界", "殖民管治"]', 7,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-8')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-8-colonial-rule')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '英國殖民管治的建立',
           summary = '英國侵佔香港的過程（割讓香港島、租借新界）及殖民管治制度的建立。',
           match_keywords_json = '["英國殖民管治的建立", "英國侵佔香港", "割讓香港島", "租借新界", "殖民管治"]',
           sort_order = 7,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-8-colonial-rule'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-8-economy-society', 'topic-8', NULL, '經濟與社會民生狀況', '香港的經濟發展狀況，以及人口、居住、醫療、教育等社會民生狀況。', '["經濟與社會民生狀況", "經濟發展狀況", "社會發展狀況", "經濟與社會發展"]', 7,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-8')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-8-economy-society')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '經濟與社會民生狀況',
           summary = '香港的經濟發展狀況，以及人口、居住、醫療、教育等社會民生狀況。',
           match_keywords_json = '["經濟與社會民生狀況", "經濟發展狀況", "社會發展狀況", "經濟與社會發展"]',
           sort_order = 7,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-8-economy-society'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-8-organisations', 'topic-8', NULL, '不同民間團體對香港的貢獻', '東華三院、保良局等民間團體在醫療、教育及救濟方面的貢獻。', '["不同民間團體對香港的貢獻", "民間團體", "東華三院", "保良局"]', 7,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-8')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-8-organisations')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '不同民間團體對香港的貢獻',
           summary = '東華三院、保良局等民間團體在醫療、教育及救濟方面的貢獻。',
           match_keywords_json = '["不同民間團體對香港的貢獻", "民間團體", "東華三院", "保良局"]',
           sort_order = 7,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-8-organisations'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-9-world-wars', 'topic-9', NULL, '兩次世界大戰的簡介：兩次世界大戰前的國際關係及衝突的原因', '兩次世界大戰的概況、大戰前的國際關係與衝突原因、巴黎和會與凡爾賽條約、兩次大戰期間的經濟問題與極權擴張，以及兩次大戰的結果與影響。', '["兩次世界大戰的簡介", "兩次世界大戰前的國際關係與衝突的原因", "大戰爆發的背景與成因", "引發大戰的衝突與導火線", "引發大戰的事件與導火線", "巴黎和會", "《凡爾賽條約》", "兩次大戰期間的經濟問題", "經濟大衰退", "極權國家", "軸心國", "集體安全", "第二次世界大戰（1939-1945年）爆發", "大戰的結果", "一戰後的國際局勢", "兩次世界大戰的影響"]', 8,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-9')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-9-world-wars')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '兩次世界大戰的簡介：兩次世界大戰前的國際關係及衝突的原因',
           summary = '兩次世界大戰的概況、大戰前的國際關係與衝突原因、巴黎和會與凡爾賽條約、兩次大戰期間的經濟問題與極權擴張，以及兩次大戰的結果與影響。',
           match_keywords_json = '["兩次世界大戰的簡介", "兩次世界大戰前的國際關係與衝突的原因", "大戰爆發的背景與成因", "引發大戰的衝突與導火線", "引發大戰的事件與導火線", "巴黎和會", "《凡爾賽條約》", "兩次大戰期間的經濟問題", "經濟大衰退", "極權國家", "軸心國", "集體安全", "第二次世界大戰（1939-1945年）爆發", "大戰的結果", "一戰後的國際局勢", "兩次世界大戰的影響"]',
           sort_order = 8,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-9-world-wars'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-9-holocaust', 'topic-9', NULL, '種族滅絕：二戰期間的「猶太大屠殺」', '種族滅絕的定義、反猶太主義的由來、納粹黨敵視猶太人的原因、對猶太人的迫害與大屠殺，以及戰後國際社會的審訊與反省。', '["種族滅絕：二戰期間的「猶太大屠殺」", "種族滅絕與猶太大屠殺", "種族滅絕", "反猶太主義", "納粹黨敵視猶太人的原因", "早期對猶太人的迫害", "《紐倫堡法令》", "水晶之夜", "猶太人集中營", "萬湖會議", "奧斯維辛", "紐倫堡審判", "戰後德國"]', 8,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-9')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-9-holocaust')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '種族滅絕：二戰期間的「猶太大屠殺」',
           summary = '種族滅絕的定義、反猶太主義的由來、納粹黨敵視猶太人的原因、對猶太人的迫害與大屠殺，以及戰後國際社會的審訊與反省。',
           match_keywords_json = '["種族滅絕：二戰期間的「猶太大屠殺」", "種族滅絕與猶太大屠殺", "種族滅絕", "反猶太主義", "納粹黨敵視猶太人的原因", "早期對猶太人的迫害", "《紐倫堡法令》", "水晶之夜", "猶太人集中營", "萬湖會議", "奧斯維辛", "紐倫堡審判", "戰後德國"]',
           sort_order = 8,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-9-holocaust'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-10-coldwar-background', 'topic-10', NULL, '冷戰的背景與成因', '二次大戰後新國際秩序的形成，以及美、蘇對立與意識形態衝突等冷戰成因。', '["冷戰的背景與成因", "冷戰的背景：新國際秩序的形成", "冷戰的成因：美、蘇對立", "冷戰是甚麼"]', 9,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-10')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-10-coldwar-background')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '冷戰的背景與成因',
           summary = '二次大戰後新國際秩序的形成，以及美、蘇對立與意識形態衝突等冷戰成因。',
           match_keywords_json = '["冷戰的背景與成因", "冷戰的背景：新國際秩序的形成", "冷戰的成因：美、蘇對立", "冷戰是甚麼"]',
           sort_order = 9,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-10-coldwar-background'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-10-coldwar-development', 'topic-10', NULL, '冷戰的主要發展', '由冷戰的展開與初期緊張局勢、解凍與危機迭起，到緩和與再度加劇的主要事件（鐵幕、杜魯門主義、馬歇爾計劃、柏林封鎖、古巴導彈危機、越戰等）。', '["冷戰的主要發展", "冷戰的展開與初期緊張局勢", "冷戰解凍", "冷戰持續與危機迭起", "冷戰緩和", "冷戰再度加劇", "鐵幕", "杜魯門主義", "馬歇爾計劃", "柏林封鎖", "古巴導彈危機", "越戰", "乒乓外交", "蘇聯入侵阿富汗"]', 9,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-10')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-10-coldwar-development')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '冷戰的主要發展',
           summary = '由冷戰的展開與初期緊張局勢、解凍與危機迭起，到緩和與再度加劇的主要事件（鐵幕、杜魯門主義、馬歇爾計劃、柏林封鎖、古巴導彈危機、越戰等）。',
           match_keywords_json = '["冷戰的主要發展", "冷戰的展開與初期緊張局勢", "冷戰解凍", "冷戰持續與危機迭起", "冷戰緩和", "冷戰再度加劇", "鐵幕", "杜魯門主義", "馬歇爾計劃", "柏林封鎖", "古巴導彈危機", "越戰", "乒乓外交", "蘇聯入侵阿富汗"]',
           sort_order = 9,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-10-coldwar-development'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-10-coldwar-end', 'topic-10', NULL, '冷戰的結束', '戈爾巴喬夫的改革、東歐劇變及蘇聯解體，冷戰結束的原因與經過。', '["冷戰的結束", "戈爾巴喬夫", "東歐劇變", "蘇聯解體", "冷戰的終結"]', 9,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-10')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-10-coldwar-end')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '冷戰的結束',
           summary = '戈爾巴喬夫的改革、東歐劇變及蘇聯解體，冷戰結束的原因與經過。',
           match_keywords_json = '["冷戰的結束", "戈爾巴喬夫", "東歐劇變", "蘇聯解體", "冷戰的終結"]',
           sort_order = 9,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-10-coldwar-end'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-10-post-coldwar', 'topic-10', NULL, '後冷戰時期的國際局勢', '冷戰結束後的國際新秩序、區域衝突及恐怖主義等課題。', '["後冷戰", "後冷戰時期的國際局勢", "後冷戰時代"]', 9,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-10')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-10-post-coldwar')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '後冷戰時期的國際局勢',
           summary = '冷戰結束後的國際新秩序、區域衝突及恐怖主義等課題。',
           match_keywords_json = '["後冷戰", "後冷戰時期的國際局勢", "後冷戰時代"]',
           sort_order = 9,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-10-post-coldwar'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-11-challenges', 'topic-11', NULL, '國際合作的背景：二十世紀以來人類共同面對的挑戰', '大型軍事衝突、全球貧富差距、疾病傳播與醫療問題、資源開發破壞環境等共同挑戰，以及國際聯盟與早期的和平嘗試。', '["國際合作的背景", "大型軍事衝突不斷", "全球貧富差距嚴重", "疾病傳播與醫療問題", "資源開發破壞環境", "國際聯盟與早期的和平嘗試"]', 10,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-11')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-11-challenges')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '國際合作的背景：二十世紀以來人類共同面對的挑戰',
           summary = '大型軍事衝突、全球貧富差距、疾病傳播與醫療問題、資源開發破壞環境等共同挑戰，以及國際聯盟與早期的和平嘗試。',
           match_keywords_json = '["國際合作的背景", "大型軍事衝突不斷", "全球貧富差距嚴重", "疾病傳播與醫療問題", "資源開發破壞環境", "國際聯盟與早期的和平嘗試"]',
           sort_order = 10,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-11-challenges'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-11-united-nations', 'topic-11', NULL, '聯合國的成立及其工作', '聯合國的成立背景、組織架構，以及在維持和平、人權、經濟與社會發展方面的工作。', '["聯合國的成立及其工作", "聯合國的成立與運作", "聯合國"]', 10,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-11')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-11-united-nations')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '聯合國的成立及其工作',
           summary = '聯合國的成立背景、組織架構，以及在維持和平、人權、經濟與社會發展方面的工作。',
           match_keywords_json = '["聯合國的成立及其工作", "聯合國的成立與運作", "聯合國"]',
           sort_order = 10,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-11-united-nations'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-12-pre-war', 'topic-12', NULL, '第二次世界大戰前的香港', '戰前的經濟發展，以及華人的崛起及其在社會上的角色。', '["第二次世界大戰前的香港", "戰前的經濟發展", "戰前華人的崛起及其角色", "戰前"]', 11,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-12')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-12-pre-war')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '第二次世界大戰前的香港',
           summary = '戰前的經濟發展，以及華人的崛起及其在社會上的角色。',
           match_keywords_json = '["第二次世界大戰前的香港", "戰前的經濟發展", "戰前華人的崛起及其角色", "戰前"]',
           sort_order = 11,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-12-pre-war'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-12-japanese-occupation', 'topic-12', NULL, '日佔時期（1941年-1945年）的香港', '日軍佔領香港的經過、日佔時期的管治、社會民生及抗戰活動。', '["日佔時期", "日佔時期的香港", "三年零八個月", "香港保衛戰"]', 11,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-12')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-12-japanese-occupation')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '日佔時期（1941年-1945年）的香港',
           summary = '日軍佔領香港的經過、日佔時期的管治、社會民生及抗戰活動。',
           match_keywords_json = '["日佔時期", "日佔時期的香港", "三年零八個月", "香港保衛戰"]',
           sort_order = 11,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-12-japanese-occupation'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-12-post-war', 'topic-12', NULL, '戰後香港的蛻變', '戰後香港的經濟發展、社會發展與政制改革，以及與歐美和亞洲等地的經濟及文化連結。', '["戰後香港的蛻變", "戰後香港的蛻變：經濟發展", "戰後香港的蛻變：社會發展與政制", "與歐美和亞洲等地的經濟及文化連結"]', 11,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-12')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-12-post-war')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '戰後香港的蛻變',
           summary = '戰後香港的經濟發展、社會發展與政制改革，以及與歐美和亞洲等地的經濟及文化連結。',
           match_keywords_json = '["戰後香港的蛻變", "戰後香港的蛻變：經濟發展", "戰後香港的蛻變：社會發展與政制", "與歐美和亞洲等地的經濟及文化連結"]',
           sort_order = 11,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-12-post-war'`,
      `INSERT INTO sections
        (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       SELECT 'topic-12-reunification', 'topic-12', NULL, '香港回歸祖國', '《中英聯合聲明》、基本法、過渡期安排及1997年香港回歸祖國。', '["香港回歸祖國", "中英聯合聲明", "基本法", "一國兩制", "回歸"]', 11,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE EXISTS (SELECT 1 FROM topics WHERE id = 'topic-12')
         AND NOT EXISTS (SELECT 1 FROM sections WHERE id = 'topic-12-reunification')`,
      `UPDATE sections
       SET parent_id = NULL,
           title = '香港回歸祖國',
           summary = '《中英聯合聲明》、基本法、過渡期安排及1997年香港回歸祖國。',
           match_keywords_json = '["香港回歸祖國", "中英聯合聲明", "基本法", "一國兩制", "回歸"]',
           sort_order = 11,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 'topic-12-reunification'`,
      `UPDATE material_blocks SET section_id = 'topic-9-holocaust'
       WHERE topic_id = 'topic-9'
         AND (text LIKE '%猶太%' OR text LIKE '%種族滅絕%' OR text LIKE '%集中營%' OR text LIKE '%反猶%' OR text LIKE '%水晶之夜%' OR text LIKE '%紐倫堡%' OR text LIKE '%萬湖會議%' OR text LIKE '%奧斯維辛%')`,
      `UPDATE questions SET section_id = 'topic-9-holocaust'
       WHERE topic_id = 'topic-9'
         AND (question LIKE '%猶太%' OR question LIKE '%種族滅絕%' OR question LIKE '%集中營%' OR question LIKE '%反猶%' OR question LIKE '%水晶之夜%' OR question LIKE '%紐倫堡%' OR question LIKE '%萬湖會議%' OR question LIKE '%奧斯維辛%' OR source_excerpt LIKE '%猶太%' OR source_excerpt LIKE '%種族滅絕%' OR source_excerpt LIKE '%集中營%' OR source_excerpt LIKE '%反猶%' OR source_excerpt LIKE '%水晶之夜%' OR source_excerpt LIKE '%紐倫堡%' OR source_excerpt LIKE '%萬湖會議%' OR source_excerpt LIKE '%奧斯維辛%')`,
      `UPDATE material_blocks SET section_id = 'topic-10-post-coldwar'
       WHERE topic_id = 'topic-10'
         AND (text LIKE '%後冷戰%')`,
      `UPDATE questions SET section_id = 'topic-10-post-coldwar'
       WHERE topic_id = 'topic-10'
         AND (question LIKE '%後冷戰%' OR source_excerpt LIKE '%後冷戰%')`,
      `UPDATE material_blocks SET section_id = 'topic-2-classical-intro' WHERE section_id IN ('topic-2-classical', 'topic-2-classical-greece', 'topic-2-classical-rome')`,
      `UPDATE questions SET section_id = 'topic-2-classical-intro' WHERE section_id IN ('topic-2-classical', 'topic-2-classical-greece', 'topic-2-classical-rome')`,
      `UPDATE material_blocks SET section_id = 'topic-2-medieval-europe' WHERE section_id IN ('topic-2-medieval', 'topic-2-medieval-christianity', 'topic-2-medieval-feudalism', 'topic-2-medieval-legacy', 'topic-2-medieval-end')`,
      `UPDATE questions SET section_id = 'topic-2-medieval-europe' WHERE section_id IN ('topic-2-medieval', 'topic-2-medieval-christianity', 'topic-2-medieval-feudalism', 'topic-2-medieval-legacy', 'topic-2-medieval-end')`,
      `UPDATE material_blocks SET section_id = 'topic-3-contact' WHERE section_id IN ('topic-3-empire', 'topic-3-trade-network')`,
      `UPDATE questions SET section_id = 'topic-3-contact' WHERE section_id IN ('topic-3-empire', 'topic-3-trade-network')`,
      `UPDATE material_blocks SET section_id = 'topic-3-results' WHERE section_id IN ('topic-3-europe', 'topic-3-asia', 'topic-3-golden-age')`,
      `UPDATE questions SET section_id = 'topic-3-results' WHERE section_id IN ('topic-3-europe', 'topic-3-asia', 'topic-3-golden-age')`,
      `UPDATE material_blocks SET section_id = 'topic-4-clans' WHERE section_id IN ('topic-4-documented')`,
      `UPDATE questions SET section_id = 'topic-4-clans' WHERE section_id IN ('topic-4-documented')`,
      `UPDATE material_blocks SET section_id = 'topic-4-heritage-life' WHERE section_id IN ('topic-4-life')`,
      `UPDATE questions SET section_id = 'topic-4-heritage-life' WHERE section_id IN ('topic-4-life')`,
      `UPDATE material_blocks SET section_id = 'topic-6-causes' WHERE section_id IN ('topic-6-early-expansion', 'topic-6-late-expansion')`,
      `UPDATE questions SET section_id = 'topic-6-causes' WHERE section_id IN ('topic-6-early-expansion', 'topic-6-late-expansion')`,
      `UPDATE material_blocks SET section_id = 'topic-6-methods-impact' WHERE section_id IN ('topic-6-policy', 'topic-6-impact-others', 'topic-6-impact-europe')`,
      `UPDATE questions SET section_id = 'topic-6-methods-impact' WHERE section_id IN ('topic-6-policy', 'topic-6-impact-others', 'topic-6-impact-europe')`,
      `UPDATE material_blocks SET section_id = 'topic-7-revolution' WHERE section_id IN ('topic-7-revolution-causes', 'topic-7-revolution-impact', 'topic-7-constitution')`,
      `UPDATE questions SET section_id = 'topic-7-revolution' WHERE section_id IN ('topic-7-revolution-causes', 'topic-7-revolution-impact', 'topic-7-constitution')`,
      `UPDATE material_blocks SET section_id = 'topic-7-civil-war' WHERE section_id IN ('topic-7-postwar')`,
      `UPDATE questions SET section_id = 'topic-7-civil-war' WHERE section_id IN ('topic-7-postwar')`,
      `UPDATE material_blocks SET section_id = 'topic-8-colonial-rule' WHERE section_id IN ('topic-8-occupation')`,
      `UPDATE questions SET section_id = 'topic-8-colonial-rule' WHERE section_id IN ('topic-8-occupation')`,
      `UPDATE material_blocks SET section_id = 'topic-8-economy-society' WHERE section_id IN ('topic-8-economy', 'topic-8-society')`,
      `UPDATE questions SET section_id = 'topic-8-economy-society' WHERE section_id IN ('topic-8-economy', 'topic-8-society')`,
      `UPDATE material_blocks SET section_id = 'topic-9-world-wars' WHERE section_id IN ('topic-9-ww1-causes', 'topic-9-ww1-trigger', 'topic-9-ww1-result', 'topic-9-interwar', 'topic-9-treaty', 'topic-9-ww2', 'topic-9-impact')`,
      `UPDATE questions SET section_id = 'topic-9-world-wars' WHERE section_id IN ('topic-9-ww1-causes', 'topic-9-ww1-trigger', 'topic-9-ww1-result', 'topic-9-interwar', 'topic-9-treaty', 'topic-9-ww2', 'topic-9-impact')`,
      `UPDATE material_blocks SET section_id = 'topic-10-coldwar-development' WHERE section_id IN ('topic-10-coldwar-early', 'topic-10-coldwar-thaw', 'topic-10-coldwar-deteriorate')`,
      `UPDATE questions SET section_id = 'topic-10-coldwar-development' WHERE section_id IN ('topic-10-coldwar-early', 'topic-10-coldwar-thaw', 'topic-10-coldwar-deteriorate')`,
      `UPDATE material_blocks SET section_id = 'topic-11-challenges' WHERE section_id IN ('topic-11-challenges-conflict', 'topic-11-challenges-poverty', 'topic-11-challenges-health', 'topic-11-challenges-environment', 'topic-11-league')`,
      `UPDATE questions SET section_id = 'topic-11-challenges' WHERE section_id IN ('topic-11-challenges-conflict', 'topic-11-challenges-poverty', 'topic-11-challenges-health', 'topic-11-challenges-environment', 'topic-11-league')`,
      `UPDATE material_blocks SET section_id = 'topic-12-pre-war' WHERE section_id IN ('topic-12-pre-war-economy', 'topic-12-pre-war-chinese')`,
      `UPDATE questions SET section_id = 'topic-12-pre-war' WHERE section_id IN ('topic-12-pre-war-economy', 'topic-12-pre-war-chinese')`,
      `UPDATE material_blocks SET section_id = 'topic-12-post-war' WHERE section_id IN ('topic-12-post-war-economy', 'topic-12-post-war-society', 'topic-12-global-links')`,
      `UPDATE questions SET section_id = 'topic-12-post-war' WHERE section_id IN ('topic-12-post-war-economy', 'topic-12-post-war-society', 'topic-12-global-links')`,
      `DELETE FROM sections WHERE id IN ('topic-3-pre-medieval', 'topic-6-intro', 'topic-2-classical', 'topic-2-classical-greece', 'topic-2-classical-rome', 'topic-2-medieval', 'topic-2-medieval-christianity', 'topic-2-medieval-feudalism', 'topic-2-medieval-legacy', 'topic-2-medieval-end', 'topic-3-empire', 'topic-3-trade-network', 'topic-3-europe', 'topic-3-asia', 'topic-3-golden-age', 'topic-4-documented', 'topic-4-life', 'topic-6-early-expansion', 'topic-6-late-expansion', 'topic-6-policy', 'topic-6-impact-others', 'topic-6-impact-europe', 'topic-7-revolution-causes', 'topic-7-revolution-impact', 'topic-7-constitution', 'topic-7-postwar', 'topic-8-occupation', 'topic-8-economy', 'topic-8-society', 'topic-9-ww1-causes', 'topic-9-ww1-trigger', 'topic-9-ww1-result', 'topic-9-interwar', 'topic-9-treaty', 'topic-9-ww2', 'topic-9-impact', 'topic-10-coldwar-early', 'topic-10-coldwar-thaw', 'topic-10-coldwar-deteriorate', 'topic-11-challenges-conflict', 'topic-11-challenges-poverty', 'topic-11-challenges-health', 'topic-11-challenges-environment', 'topic-11-league', 'topic-12-pre-war-economy', 'topic-12-pre-war-chinese', 'topic-12-post-war-economy', 'topic-12-post-war-society', 'topic-12-global-links')`,
    ],
  },
];

export function runMigrations(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const appliedRows = db.prepare("SELECT id FROM schema_migrations").all() as { id: string }[];
  const applied = new Set(appliedRows.map((row) => row.id));

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.exec("BEGIN");
    try {
      for (const statement of migration.statements) {
        db.exec(statement);
      }
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
        migration.id,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
