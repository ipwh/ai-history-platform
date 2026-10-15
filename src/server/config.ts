/**
 * 伺服器端設定。所有敏感資料（API key）只會由環境變數讀取，
 * 而且只在此伺服器端模組中使用，不會傳到前端。
 */
import path from "node:path";

export type LlmProviderName = "mock" | "openai-compatible" | "deepseek" | "gemini";
export type OcrProviderName = "none" | "tesseract" | "google-vision";

export interface ServerConfig {
  databasePath: string;
  uploadsDir: string;
  materialsDir: string;
  /** 檔案儲存 provider（本機 local／未來 Cloud Storage gcs） */
  storage: {
    provider: "local" | "gcs";
    /** Cloud Storage bucket（只在 STORAGE_PROVIDER=gcs 時使用） */
    gcsBucket: string | null;
  };
  llm: {
    provider: LlmProviderName;
    /** 是否已具備真實 provider 所需的憑證 */
    configured: boolean;
    apiKey: string | null;
    baseUrl: string | null;
    model: string | null;
    requestTimeoutMs: number;
    /** 未設定憑證時是否允許回退到本地示範生成 */
    allowMockFallback: boolean;
    /** 單次回應的 token 上限（null = 不傳送）；JSON 模式建議設定，避免 JSON 被中途截斷 */
    maxTokens: number | null;
    /** 思考模式（只適用於支援的 provider，例如 DeepSeek）；null = 使用 API 預設值 */
    thinking: "enabled" | "disabled" | null;
    /** 思考強度（只在思考模式開啟時傳送） */
    reasoningEffort: string | null;
    /** 回應內容為空時額外重試次數（DeepSeek JSON 模式偶爾會回傳空內容） */
    emptyContentRetries: number;
    /** 是否以 AI 按語意批改填充題及短答題（沒有真實 provider 時自動停用） */
    gradingEnabled: boolean;
  };
  /** 學生名冊（Google Sheet／CSV）設定 */
  roster: RosterConfig;
  auth: AuthConfig;
  ocr: {
    provider: OcrProviderName;
    /** 本機 OCR 的語言包 */
    languages: string;
    /** 語言資料快取目錄 */
    cachePath: string;
    /** 語言資料來源（可指向本機 tessdata 目錄） */
    langPath: string | null;
    /** 版面分析模式（tesseract PSM）；11 = SPARSE_TEXT，適合散佈文字的圖表 */
    pageSegMode: string;
    /** 可接受的最少有效字元數（過濾雜訊） */
    minChars: number;
    /** 可接受的最低平均信心度（0-1） */
    minConfidence: number;
    /** Google Cloud Vision 的 API key 及端點 */
    apiKey: string | null;
    baseUrl: string;
    /** 單張圖片 OCR 逾時 */
    imageTimeoutMs: number;
    /** 每次 OCR 最多處理的圖片數（避免一次執行過久） */
    maxImagesPerRun: number;
    /** 執行 OCR 的最長時間（毫秒） */
    runTimeoutMs: number;
  };
  /** 示範模式是否自動發布本地示範生成的題目（正式環境應設為 false） */
  autoPublishMockQuestions: boolean;
  /** AI 用量上限（避免個別帳戶或整體用量失控） */
  aiLimits: AiLimitConfig;
  /** 資料庫備份（把 SQLite 檔案備份到 Cloud Storage，令容器重建後仍保留資料） */
  backup: BackupConfig;
  maxUploadBytes: number;
  /** 伺服器端寫入的最大教材段落數，避免超大文件拖垮服務 */
  maxBlocksPerDocument: number;
}

/**
 * AI 用量上限設定。
 *
 * 每次 AI 出題及每次 AI 批改都會在**呼叫模型之前**同步寫入一筆用量記錄，
 * 因此上限是以「已保留的用量」計算：同一時間的並行請求不會因為同時通過檢查而超額
 * （單一程序 + 同步 SQLite 寫入，檢查與保留之間不會被其他請求插入）。
 *
 * 預設值為保守的防濫用上限，**並非**平台擁有者核准的預算；真正的成本上限
 * 仍須由擁有者按實際用量及預算決定（見 README「AI 用量上限」）。
 */
export interface AiLimitConfig {
  /** 是否啟用（設 false 只作記錄，不拒絕請求） */
  enabled: boolean;
  /** 統計用的時間窗（分鐘） */
  windowMinutes: number;
  /** 每位學習者在時間窗內最多可觸發的 AI 出題次數 */
  generationsPerLearner: number;
  /** 每位學習者在時間窗內最多可觸發的 AI 批改次數 */
  gradingsPerLearner: number;
  /** 所有使用者合計在時間窗內最多可觸發的 AI 出題次數 */
  generationsGlobal: number;
  /** 所有使用者合計在時間窗內最多可觸發的 AI 批改次數 */
  gradingsGlobal: number;
}

/** 學生登入（學校 Google Workspace 帳戶）設定 */
export interface AuthConfig {  /** 是否已具備啟用登入所需的憑證 */
  enabled: boolean;
  /** 未登入時可否使用學生功能（true = 必須登入才可使用練習功能） */
  requireSignIn: boolean;
  googleClientId: string | null;
  googleClientSecret: string | null;
  /** 工作階段 cookie 的簽署密鑰；未設定時會使用 data/ 內的隨機密鑰檔 */
  secret: string | null;
  /** OAuth 重新導向 URI；未設定時依請求的來源網址自動產生 */
  redirectUri: string | null;
  /**
   * 工作階段有效期（小時）。
   * 這是「名冊移除」後仍可繼續使用的最長時間：名冊成員只在登入時核對，
   * 之後由 cookie 證明身分；角色及名單變更則會即時重新判定（見 revalidateSessionUser）。
   * 預設 720 小時（30 天）；學校如要縮短撤銷窗口可調低（例如 8 小時）。
   */
  sessionTtlHours: number;
  /** 校內網域（完整標籤比對，例如 pochiu.edu.hk） */
  schoolDomains: string[];
  /** 一律視為教師的電郵（供教師使用非校內網域帳戶時使用） */
  teacherEmails: string[];
  /** 一律視為管理員的電郵（管理員擁有教師的全部功能，另可管理教材及系統設定） */
  adminEmails: string[];
  /**
   * 校內網域但學號形式（s + 7 位數字）不符，且不在 AUTH_TEACHER_EMAILS／
   * AUTH_ADMIN_EMAILS 及學生名冊內的帳戶，要視為哪一種身分。
   *
   * 預設 "student"（fail-closed）：只要有任何學生的帳戶不是學號形式（例如別名），
   * 舊行為就會把該學生當成教師，令其可讀取全部學生的練習記錄。
   * 教師須列在 AUTH_TEACHER_EMAILS，或明確設定 AUTH_IN_DOMAIN_ROLE=teacher。
   */
  inDomainRole: "student" | "teacher";
}

/**
 * 資料庫備份設定。
 *
 * Cloud Run 的容器檔案系統是暫時性的，因此把 SQLite 資料庫（以內建的
 * `db.backup()` 產生一致快照）定期上傳到 Cloud Storage，並在啟動時還原。
 * 這讓題庫、教材段落及學生練習記錄可以跨重新部署保留，且完全在 Google Cloud 內。
 */
export interface BackupConfig {
  /** 是否啟用（設定了 BACKUP_BUCKET 即啟用） */
  enabled: boolean;
  /** Cloud Storage bucket 名稱（不含 gs:// 前綴） */
  bucket: string | null;
  /** bucket 內的物件前置路徑 */
  prefix: string;
    /** 備份間隔（秒）；0 = 不設間隔 */
  intervalSeconds: number;
    /**
     * 偵測到資料有變更時，兩次備份之間的最短間隔（秒）。
     * 令使用期間的資料遺失窗口縮短，同時避免每個請求都備份。
     */
    minSpacingSeconds: number;
  /** 啟動時是否由 Cloud Storage 還原資料庫 */
  restoreOnStart: boolean;
  /** 還原時以雲端版本為準（即使本機已有資料庫）；預設只在本機沒有資料庫時還原 */
  preferCloud: boolean;
}

export type RosterSource = "none" | "csv" | "file" | "sheets-api";
/**
 * 學生名冊設定（Google Sheet 內的班別、學號、姓名及電郵）。
 *
 * 名冊只是「誰可以使用本網站」的白名單／補充資料來源：
 *   1. 學生仍然以學校 Google Workspace 帳戶登入（不在此儲存任何密碼）。
 *   2. 名冊內的學生會取得班別及學號，方便教師核對。
 *   3. enforce = true 時，名冊以外的學生帳戶不可登入。
 */
export interface RosterConfig {
  /** 是否啟用名冊（未設定任何來源時自動為 false） */
  enabled: boolean;
  /** 名冊以外的學生可否登入（false = 拒絕） */
  enforce: boolean;
  source: RosterSource;
  /** Google Sheet 檔案 ID（source = sheets-api 時必須） */
  spreadsheetId: string | null;
  /** 工作表名稱（CSV 匯出或 sheets-api 預設範圍都會用到；null = 第一張工作表） */
  sheetName: string | null;
  /** sheets-api 讀取的 A1 範圍（未設定時由 sheetName 推導） */
  range: string | null;
  /** CSV 網址（例如 Google Sheet「發布到網絡」或 gviz CSV 匯出網址） */
  csvUrl: string | null;
  /** 本機 CSV 檔案路徑（離線或測試用） */
  filePath: string | null;
  /** 服務帳戶 JSON（可直接放內容，或放檔案路徑）；未設定時會嘗試 GOOGLE_APPLICATION_CREDENTIALS */
  serviceAccountJson: string | null;
  /** 名冊快取時間（秒） */
  cacheTtlSeconds: number;
  /** 名冊來源暫時無法讀取時是否仍允許登入（預設 false：拒絕，避免未授權帳戶進入） */
  failOpen: boolean;
  /**
   * 只開放指定班別（例如中一至中三）。
   * classPrefixes 以「開頭」比對（1 會接受 1A、1B、1C、1D）；classes 以完全相等比對。
   * 兩者皆為空時不設限。
   */
  scope: {
    classPrefixes: string[];
    classes: string[];
  };  /** 欄位名稱覆寫（未設定時自動偵測常見中文／英文欄名） */
  columns: {
    email: string | null;
    studentNumber: string | null;
    className: string | null;
    name: string | null;
  };
}

/** AUTH_SECRET（工作階段 cookie 的簽署密鑰）要求的最短長度 */
export const MIN_AUTH_SECRET_LENGTH = 32;

const DEFAULT_TIMEOUT_MS = 45_000;
/** 學生帳號所屬的預設校內網域（保良局蔡繼有中學） */
const DEFAULT_SCHOOL_DOMAIN = "pochiu.edu.hk";
const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_BLOCKS = 4_000;
const DEFAULT_OCR_IMAGE_TIMEOUT_MS = 60_000;
const DEFAULT_OCR_MAX_IMAGES = 150;
const DEFAULT_OCR_RUN_TIMEOUT_MS = 15 * 60 * 1000;

function readEnv(name: string): string | null {
  const value = process.env[name];
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = readEnv(name);
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** 讀取非負整數；0 為合法值（用於「不設間隔」這類設定） */
function readNonNegativeInt(name: string, fallback: number): number {
  const raw = readEnv(name);
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readBoolean(name: string, fallback: boolean): boolean {  const raw = readEnv(name);
  if (raw === null) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

/** 讀取正整數；可設為 off／none／0 表示不使用（回傳 null） */
function readOptionalPositiveInt(name: string, fallback: number | null): number | null {
  const raw = readEnv(name);
  if (raw === null) return fallback;
  if (["off", "none", "0", "false"].includes(raw.toLowerCase())) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** 讀取以逗號、分號、直線或空白分隔的清單，並移除重複及空白項目 */
function readList(name: string, fallback: string[] = []): string[] {
  const raw = readEnv(name);
  if (raw === null) return fallback;
  return [
    ...new Set(
      raw
        .split(/[,;|\s]+/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

function readProviderName(): LlmProviderName {
  const raw = (readEnv("LLM_PROVIDER") ?? "mock").toLowerCase();
  if (raw === "deepseek") {
    return "deepseek";
  }
  if (raw === "openai" || raw === "openai-compatible" || raw === "openai_compatible") {
    return "openai-compatible";
  }
  if (raw === "gemini" || raw === "google" || raw === "vertex") {
    return "gemini";
  }
  return "mock";
}

/**
 * LLM API key：DeepSeek 優先用 DEEPSEEK_API_KEY，Gemini 優先用 GEMINI_API_KEY，
 * 其餘相容 API 用 LLM_API_KEY；三者都可使用 LLM_API_KEY 作為通用後備。
 */
function readLlmApiKey(provider: LlmProviderName): string | null {
  if (provider === "deepseek") {
    return readEnv("DEEPSEEK_API_KEY") ?? readEnv("LLM_API_KEY");
  }
  if (provider === "gemini") {
    return readEnv("GEMINI_API_KEY") ?? readEnv("GOOGLE_API_KEY") ?? readEnv("LLM_API_KEY");
  }
  return readEnv("LLM_API_KEY");
}

const DEFAULT_BASE_URLS: Record<Exclude<LlmProviderName, "mock">, string> = {
  deepseek: "https://api.deepseek.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  "openai-compatible": "https://api.openai.com/v1",
};

const DEFAULT_MODELS: Record<Exclude<LlmProviderName, "mock">, string> = {
  deepseek: "deepseek-flash",
  gemini: "gemini-2.5-flash",
  "openai-compatible": "gpt-4o-mini",
};

/** 未有設定時，DeepSeek 單次回應的 token 上限（充足而不會浪費；可用 LLM_MAX_TOKENS 調整） */
const DEFAULT_MAX_TOKENS = 8_192;

/**
 * 思考模式設定（DeepSeek 的思考模式預設為開啟且強度為 high）。
 *
 * 出題屬於「按提供的教材段落作結構化生成」，毋須思維鏈，因此 DeepSeek 預設關閉思考模式，
 * 可大幅減少延遲與輸出費用；如要改用思考模式可設 LLM_THINKING=enabled。
 * 其他 provider 未設定時不傳送此參數（避免不相容的參數導致 API 錯誤）。
 */
function readThinkingMode(provider: LlmProviderName): "enabled" | "disabled" | null {
  const raw = readEnv("LLM_THINKING")?.toLowerCase();
  if (raw === undefined || raw === null || raw === "default") {
    return provider === "deepseek" ? "disabled" : null;
  }
  if (["enabled", "on", "true"].includes(raw)) return "enabled";
  if (["disabled", "off", "false", "none"].includes(raw)) return "disabled";
  return provider === "deepseek" ? "disabled" : null;
}

/**
 * OCR provider 的預設值：
 * 已設定 Google Cloud Vision key → google-vision；否則使用本機 tesseract OCR。
 * 可用 OCR_PROVIDER=none 完全關閉。
 */
function readOcrProviderName(): OcrProviderName {
  const raw = readEnv("OCR_PROVIDER")?.toLowerCase();
  if (raw === "none" || raw === "off" || raw === "disabled") return "none";
  if (raw === "google" || raw === "google-vision" || raw === "vision") return "google-vision";
  if (raw === "tesseract" || raw === "local") return "tesseract";
  const hasVisionKey = readEnv("OCR_API_KEY") !== null;
  return hasVisionKey ? "google-vision" : "tesseract";
}

/**
 * 校內網域內「非學號形式且未被明確列出」的帳戶要視為哪一種身分。
 * 預設 student（fail-closed）；只有明確設定 AUTH_IN_DOMAIN_ROLE=teacher 才會沿用
 * 舊行為（校內非學號形式的帳戶一律是教師）。
 */
function readInDomainRole(): "student" | "teacher" {
  const raw = readEnv("AUTH_IN_DOMAIN_ROLE")?.toLowerCase();
  return raw === "teacher" || raw === "staff" ? "teacher" : "student";
}

/**
 * AI 用量上限。預設為保守的防濫用值（並非擁有者核准的預算）。
 * 未設定時使用這些值；設為 0 代表不設限（不建議，只供本機測試）。
 */
function readAiLimits(): AiLimitConfig {
  return {
    enabled: readBoolean("AI_LIMITS_ENABLED", true),
    windowMinutes: readPositiveInt("AI_LIMIT_WINDOW_MINUTES", 60),
    generationsPerLearner: readNonNegativeInt("AI_GENERATIONS_PER_LEARNER", 30),
    gradingsPerLearner: readNonNegativeInt("AI_GRADINGS_PER_LEARNER", 300),
    generationsGlobal: readNonNegativeInt("AI_GENERATIONS_GLOBAL", 600),
    gradingsGlobal: readNonNegativeInt("AI_GRADINGS_GLOBAL", 3000),
  };
}

/** 讀取名冊來源：未指定時依已提供的設定自動判斷 */
function readRosterSource(hasSheet: boolean, hasCsv: boolean, hasFile: boolean): RosterSource {
  const raw = readEnv("STUDENT_ROSTER_SOURCE")?.toLowerCase();
  if (raw === "none" || raw === "off" || raw === "disabled") return "none";
  if (raw === "csv" || raw === "sheet-csv" || raw === "published-csv") return "csv";
  if (raw === "file" || raw === "local" || raw === "csv-file") return "file";
  if (raw === "sheets-api" || raw === "api" || raw === "google-sheets") return "sheets-api";
  if (hasCsv) return "csv";
  if (hasSheet) return "sheets-api";
  if (hasFile) return "file";
  return "none";
}

function readRosterConfig(): RosterConfig {  const csvUrl = readEnv("STUDENT_ROSTER_CSV_URL");
  const filePath = readEnv("STUDENT_ROSTER_FILE");
  const spreadsheetId = readEnv("STUDENT_ROSTER_SHEET_ID");
  const source = readRosterSource(spreadsheetId !== null, csvUrl !== null, filePath !== null);
  const enabled = source === "none" ? false : readBoolean("STUDENT_ROSTER_ENABLED", true);

  return {
    enabled,
    enforce: readBoolean("STUDENT_ROSTER_ENFORCE", enabled),
    source,
    spreadsheetId,
    sheetName: readEnv("STUDENT_ROSTER_SHEET_NAME"),
    range: readEnv("STUDENT_ROSTER_RANGE"),
    csvUrl,
    filePath,
    serviceAccountJson:
      readEnv("STUDENT_ROSTER_SERVICE_ACCOUNT_JSON") ?? readEnv("GOOGLE_APPLICATION_CREDENTIALS"),
    cacheTtlSeconds: readPositiveInt("STUDENT_ROSTER_CACHE_TTL_SECONDS", 600),
    failOpen: readBoolean("STUDENT_ROSTER_FAIL_OPEN", false),
    scope: {
      classPrefixes: readList("STUDENT_ROSTER_CLASS_PREFIXES"),
      classes: readList("STUDENT_ROSTER_CLASSES"),
    },
    columns: {
      email: readEnv("STUDENT_ROSTER_COLUMN_EMAIL"),
      studentNumber: readEnv("STUDENT_ROSTER_COLUMN_STUDENT_NUMBER"),
      className: readEnv("STUDENT_ROSTER_COLUMN_CLASS"),
      name: readEnv("STUDENT_ROSTER_COLUMN_NAME"),
    },
  };
}

/** 讀取資料庫備份設定：未設定 BACKUP_BUCKET 時不啟用 */
function readBackupConfig(): BackupConfig {
  const bucket = readEnv("BACKUP_BUCKET")?.replace(/^gs:\/\//, "").replace(/\/+$/, "") ?? null;
  const rawPrefix = readEnv("BACKUP_PREFIX") ?? "history";
  return {
    enabled: bucket !== null && readBoolean("BACKUP_ENABLED", true),
    bucket,
    prefix: rawPrefix.replace(/^\/+|\/+$/g, ""),
    // 0 = 不設間隔（只在啟動及關機時備份；用於除錯或極低流量情境）
    intervalSeconds: readNonNegativeInt("BACKUP_INTERVAL_SECONDS", 300),
    minSpacingSeconds: readNonNegativeInt("BACKUP_MIN_SPACING_SECONDS", 60),
    restoreOnStart: readBoolean("BACKUP_RESTORE_ON_START", true),
    preferCloud: readBoolean("BACKUP_PREFER_CLOUD", false),
  };
}

export function getServerConfig(): ServerConfig {
  const projectRoot = process.cwd();
  const provider = readProviderName();

  const apiKey = readLlmApiKey(provider);

  const baseUrl =
    provider === "mock"
      ? null
      : (readEnv("LLM_BASE_URL") ?? DEFAULT_BASE_URLS[provider]);

  const model =
    provider === "mock" ? null : (readEnv("LLM_MODEL") ?? DEFAULT_MODELS[provider]);

  const ocrProvider = readOcrProviderName();
  const ocrApiKey = readEnv("OCR_API_KEY");

  const googleClientId = readEnv("GOOGLE_CLIENT_ID");
  const googleClientSecret = readEnv("GOOGLE_CLIENT_SECRET");

  return {
    databasePath:
      readEnv("APP_DATABASE_PATH") ?? path.join(projectRoot, "data", "app.db"),
    uploadsDir: readEnv("APP_UPLOADS_DIR") ?? path.join(projectRoot, "data", "uploads"),
    materialsDir: readEnv("APP_MATERIALS_DIR") ?? path.join(projectRoot, "materials"),
    storage: {
      provider: readEnv("STORAGE_PROVIDER")?.toLowerCase() === "gcs" ? "gcs" : "local",
      gcsBucket: readEnv("GCS_BUCKET"),
    },
    llm: {
      provider,
      configured: provider === "mock" ? false : apiKey !== null,
      apiKey,
      baseUrl,
      model,
      requestTimeoutMs: readPositiveInt("LLM_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
      allowMockFallback: readBoolean("LLM_ALLOW_MOCK_FALLBACK", true),
      maxTokens:
        provider === "mock"
          ? null
          : readOptionalPositiveInt(
              "LLM_MAX_TOKENS",
              provider === "deepseek" ? DEFAULT_MAX_TOKENS : null,
            ),
      thinking: provider === "mock" ? null : readThinkingMode(provider),
      reasoningEffort: readEnv("LLM_REASONING_EFFORT"),
      emptyContentRetries: readPositiveInt("LLM_EMPTY_RETRIES", 1),
      gradingEnabled: provider !== "mock" && readBoolean("LLM_GRADING_ENABLED", true),
    },
    roster: readRosterConfig(),
    auth: {
      enabled: googleClientId !== null && googleClientSecret !== null,
      requireSignIn: readBoolean("AUTH_REQUIRE_SIGN_IN", true),
      googleClientId,
      googleClientSecret,
      secret: readEnv("AUTH_SECRET"),
      redirectUri: readEnv("AUTH_REDIRECT_URI"),
      sessionTtlHours: readPositiveInt("AUTH_SESSION_TTL_HOURS", 720),
      schoolDomains: readList("AUTH_SCHOOL_DOMAINS", [DEFAULT_SCHOOL_DOMAIN]),
      teacherEmails: readList("AUTH_TEACHER_EMAILS"),
      adminEmails: readList("AUTH_ADMIN_EMAILS"),
      inDomainRole: readInDomainRole(),
    },
    ocr: {
      provider: ocrProvider === "google-vision" && ocrApiKey === null ? "tesseract" : ocrProvider,
      languages: readEnv("OCR_LANGUAGES") ?? "chi_tra",
      cachePath: readEnv("OCR_CACHE_PATH") ?? path.join(projectRoot, "data", "ocr-cache"),
      langPath: readEnv("OCR_LANG_PATH"),
      pageSegMode: readEnv("OCR_PAGE_SEG_MODE") ?? "11",
      minChars: readPositiveInt("OCR_MIN_CHARS", 8),
      minConfidence: readBoolean("OCR_SKIP_LOW_CONFIDENCE", true) ? 0.3 : 0,
      apiKey: ocrApiKey,
      baseUrl: readEnv("OCR_BASE_URL") ?? "https://vision.googleapis.com/v1",
      imageTimeoutMs: readPositiveInt("OCR_IMAGE_TIMEOUT_MS", DEFAULT_OCR_IMAGE_TIMEOUT_MS),
      maxImagesPerRun: readPositiveInt("OCR_MAX_IMAGES", DEFAULT_OCR_MAX_IMAGES),
      runTimeoutMs: readPositiveInt("OCR_RUN_TIMEOUT_MS", DEFAULT_OCR_RUN_TIMEOUT_MS),
    },
    // 預設值：本機示範為 true（方便試用），正式環境為 false——正式環境的題目必須由
    // 教師核對後才發布，不可因為執行批次生成腳本而自動發布未審核的題目。
    autoPublishMockQuestions: readBoolean(
      "DEMO_AUTO_PUBLISH_QUESTIONS",
      process.env.NODE_ENV !== "production",
    ),
    aiLimits: readAiLimits(),
    backup: readBackupConfig(),
    maxUploadBytes: readPositiveInt("APP_MAX_UPLOAD_BYTES", DEFAULT_MAX_UPLOAD_BYTES),
    maxBlocksPerDocument: readPositiveInt("APP_MAX_BLOCKS", DEFAULT_MAX_BLOCKS),
  };
}

/** 目前使用的 LLM provider 是否為本地示範模式 */
export function isDemoLlmMode(config: ServerConfig): boolean {
  return config.llm.provider === "mock" || !config.llm.configured;
}

export const LLM_PROVIDER_LABELS: Record<LlmProviderName, string> = {
  mock: "本地示範生成（不需要 API key）",
  "openai-compatible": "OpenAI 相容 API",
  deepseek: "DeepSeek API",
  gemini: "Google Gemini API",
};

export const OCR_PROVIDER_LABELS: Record<OcrProviderName, string> = {
  none: "已停用 OCR",
  tesseract: "本機 OCR（tesseract.js，不需要 API key）",
  "google-vision": "Google Cloud Vision OCR",
};
