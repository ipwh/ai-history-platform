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
