/**
 * 設定診斷：集中檢查環境變數是否完整、是否適合部署到 Google Cloud Run。
 *
 * 只回報「問題」與「提示」，不會洩漏任何憑證內容（不回傳金鑰、密碼或完整路徑），
 * 供管理員端系統狀態頁及 /api/admin/system/health 使用。
 */
import fs from "node:fs";
import path from "node:path";

import { getServerConfig, MIN_AUTH_SECRET_LENGTH, MATERIAL_AUTO_OPEN_POLICIES, isProductionRuntime } from "./config";
import { isStudentPatternEmail } from "./auth/role";
import { EXPLANATION_HOLD_POLICIES } from "./quality/explanation-quality";
import { normalizeTutorWebAllowlistEntry } from "./services/tutor-web-allowlist";
import { TUTOR_WEB_MODES } from "./services/tutor-web-supplement";
import {
  isTutorWebSearchProviderReady,
  TUTOR_WEB_SEARCH_PROVIDERS,
} from "./services/tutor-web-search-provider";

export { MIN_AUTH_SECRET_LENGTH };

export interface ConfigIssue {
  /** error = 功能會受影響；warning = 可以運作但需注意；info = 提示 */
  level: "error" | "warning" | "info";
  code: string;
  message: string;
}

/** ADMIN_TOKEN 可用的最短長度，與 src/server/auth/guards.ts 的檢查一致 */
export const MIN_ADMIN_TOKEN_LENGTH = 32;

export interface DeploymentInfo {
  /** local = 本機開發；cloud-run = 執行於 Cloud Run（偵測 K_SERVICE）；other = 其他環境 */
  platform: "local" | "cloud-run" | "other";
  /** 資料庫或上載檔案是否位於容器／暫時性檔案系統 */
  ephemeralStorage: boolean;
  notes: string[];
}

/** 應用程式版本（讀取 package.json，失敗時回報 unknown） */
export function appVersion(): string {
  try {
    const candidates = [
      path.join(process.cwd(), "package.json"),
      path.join(process.cwd(), "..", "package.json"),
    ];
    for (const candidate of candidates) {
      // turbopackIgnore：執行時才讀取的檔案，不需要在建置時把整個專案納入追蹤圖。
      if (!fs.existsSync(/*turbopackIgnore: true*/ candidate)) continue;
      const parsed = JSON.parse(
        fs.readFileSync(/*turbopackIgnore: true*/ candidate, "utf8"),
      ) as { version?: unknown };
      if (typeof parsed.version === "string" && parsed.version.length > 0) return parsed.version;
    }
  } catch {
    // 讀不到版本不影響運作
  }
  return "unknown";
}

export function describeDeployment(): DeploymentInfo {
  const config = getServerConfig();
  const onCloudRun = (process.env.K_SERVICE ?? "").trim().length > 0;
  const platform: DeploymentInfo["platform"] = onCloudRun
    ? "cloud-run"
    : process.env.NODE_ENV === "production"
      ? "other"
      : "local";

  const notes: string[] = [];
  const backupEnabled = config.backup.enabled;
  const databaseInProject = config.databasePath.startsWith(process.cwd());
  const uploadsInProject = config.uploadsDir.startsWith(process.cwd());
  // 已啟用 Cloud Storage 備份時，資料庫即使位於容器目錄也可還原，故不算「隨時會遺失」。
  const ephemeralStorage = !backupEnabled && (databaseInProject || uploadsInProject);

  if (platform === "cloud-run") {
    notes.push(
      backupEnabled
        ? `資料庫以 Cloud Storage 備份持久化（bucket：${config.backup.bucket}，每 ${config.backup.intervalSeconds} 秒備份，啟動時還原）。教材檔案仍存於容器目錄，重建執行個體後需重新匯入。`
        : "偵測到 Cloud Run（K_SERVICE）：容器檔案系統不會保留資料，請設定 BACKUP_BUCKET 以啟用 Cloud Storage 備份，或改用 Cloud SQL 及 Cloud Storage。",
    );
  }

  return { platform, ephemeralStorage, notes };
}

/**
 * 部署目錄內是否有教材檔案（只回報數量，不顯示檔名——教材內容受使用授權限制）。
 *
 * Git 不含教材（`.gitignore` 排除 `materials/*`），但 Docker 映像檔會 `COPY materials/`。
 * 若在建置環境缺少教材，映像檔仍會成功建置並啟動，只是管理員無法匯入課本內容、
 * 學生會看到沒有教材的平台——因此這裡提供一個可被管理員端看見的訊號。
 *
 * 教材檔案隨映像檔固定不變，故結果在單一程序內只計算一次（避免每次健康檢查掃描目錄）。
 */
function materialsBundlePresent(materialsDir: string): boolean {
  try {
    // turbopackIgnore：映像檔內容在執行時檢查，不應在建置時追蹤整個專案。
    if (!fs.existsSync(/*turbopackIgnore: true*/ materialsDir)) return false;
    // 只作單層檢查（教材不隨執行期改變，深層掃描會令健康檢查變慢）：
    // 除 `materials/README.md` 外有任何項目即視為映像檔已附教材。
    return fs
      .readdirSync(/*turbopackIgnore: true*/ materialsDir, { withFileTypes: true })
      .some((entry) => entry.name !== "README.md");
  } catch {
    // 無法讀取時不當作「缺少教材」，避免產生誤導的警告
    return true;
  }
}

export function describeConfigIssues(): ConfigIssue[] {
  const config = getServerConfig();
  const issues: ConfigIssue[] = [];
  const deployment = describeDeployment();

  // LLM
  const providerFromEnv = (process.env.LLM_PROVIDER ?? "mock").trim().toLowerCase();
  if (providerFromEnv !== "" && providerFromEnv !== "mock" && !config.llm.configured) {
    issues.push({
      level: "warning",
      code: "llm-missing-credentials",
      message: `已設定 LLM_PROVIDER=${providerFromEnv}，但缺少對應的 API key，現時會使用本地示範生成（題目質素較基本）。`,
    });
  }
  if (config.llm.allowMockFallback && !config.llm.configured) {
    issues.push({
      level: "info",
      code: "llm-demo-mode",
      message: "現時使用本地示範生成：題目由教材原文以規則組成，適合示範及離線使用。",
    });
  }

  // OCR
  if ((process.env.OCR_PROVIDER ?? "").trim().toLowerCase() === "google-vision" && !config.ocr.apiKey) {
    issues.push({
      level: "warning",
      code: "ocr-missing-key",
      message: "已設定 OCR_PROVIDER=google-vision，但缺少 OCR_API_KEY，OCR 功能會停用。",
    });
  }
  if (config.ocr.provider === "tesseract") {
    issues.push({
      level: "info",
      code: "ocr-local-model",
      message:
        "本機 OCR 首次執行需要下載語言資料；如要離線或部署到容器，請把 chi_tra.traineddata 放入映像檔並設定 OCR_LANG_PATH。",
    });
  }

  // 登入與後台
  if (!config.auth.enabled) {
    // 正式建置（npm start／Cloud Run）一律 fail-closed：後台會被拒絕，
    // 除非明確設定 HISTORY_ALLOW_UNSAFE_DEMO_MODE=true（見 config.ts）。
    const publishedBuild = isProductionRuntime();
    issues.push({
      level: publishedBuild ? "error" : "warning",
      code: "auth-disabled",
      message: publishedBuild
        ? "正式建置未啟用學校 Google 帳戶登入：後台 API 及頁面會被拒絕（除非設定 HISTORY_ALLOW_UNSAFE_DEMO_MODE=true）。請設定 GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET 及 AUTH_SECRET。"
        : "尚未啟用學校 Google 帳戶登入：學生以匿名 ID 使用，教師端及管理員端與學生端完全開放，只適合本機開發及示範。",
    });
  } else {
    if (config.auth.secret === null) {
      issues.push({
        level: "warning",
        code: "auth-secret-missing",
        message:
          "未設定 AUTH_SECRET：工作階段密鑰會在 data/ 目錄自動產生，多個執行個體或容器重建後會令已登入的使用者被登出，正式部署前請改由 Secret Manager 注入。",
      });
    }
    if (config.auth.secret !== null && config.auth.secret.length < MIN_AUTH_SECRET_LENGTH) {
      issues.push({
        // 正式環境會直接拒絕使用過短的密鑰（所有帶 cookie 的請求都會失敗）
        level: process.env.NODE_ENV === "production" ? "error" : "warning",
        code: "auth-secret-short",
        message: `AUTH_SECRET 只有 ${config.auth.secret.length} 個字元：這是工作階段 cookie 的簽署密鑰，長度不足會增加被推導出來的風險，建議改用 32 個字元以上的隨機值。`,
      });
    }
    if (!config.auth.requireSignIn) {
      issues.push({
        level: "warning",
        code: "auth-optional",
        message: "已設定 AUTH_REQUIRE_SIGN_IN=false：未登入者仍可使用學生功能（示範用）。",
      });
    }
    if (config.auth.legacyInDomainTeacherConfigured) {
      // 舊政策已被移除：只提示，不再影響角色判定（避免靜默地令教師失去權限）
      issues.push({
        level: "error",
        code: "auth-legacy-in-domain-teacher-removed",
        message:
          "偵測到 AUTH_IN_DOMAIN_ROLE 或 AUTH_ALLOW_LEGACY_IN_DOMAIN_TEACHER：這個「校內網域即教師」" +
          "的政策**已被移除**，不再授予任何教職員權限（它會讓校內別名帳戶取得教師權限，" +
          "可讀取全部學生的練習記錄）。請改為把教師電郵列在 AUTH_TEACHER_EMAILS，" +
          "或使用已授權的 AUTH_STAFF_ACCESS_POLICY=school-domain 暫時政策；" +
          "並從部署設定移除這兩個變數；在完成之前，未列入名單的教師會是學生。",
      });
    }

    // 教師權限來源（Sprint 7.2）
    if (config.auth.staffAccessPolicy === "school-domain") {
      issues.push({
        level: "warning",
        code: "auth-staff-policy-school-domain",
        message:
          "已啟用暫時的全校教職員教師權限政策（AUTH_STAFF_ACCESS_POLICY=school-domain）：" +
          `在 ${config.auth.staffDomains.length} 個已列出的校內網域中，任何通過 Google 驗證、` +
          "且不是學號形式（s 加數字）的帳戶都是教師。" +
          "**這不是最小權限政策**：教師介面可讀取全部學生的練習記錄，並可覆核及發布題目。" +
          "停用方法：把 AUTH_STAFF_ACCESS_POLICY 設回 allowlist（或移除該變數），" +
          "並以 AUTH_TEACHER_EMAILS 明確列出教師。",
      });
      if (config.auth.staffDomains.length === 0) {
        issues.push({
          level: "error",
          code: "auth-staff-policy-no-domains",
          message:
            "AUTH_STAFF_ACCESS_POLICY=school-domain 但沒有設定 AUTH_STAFF_DOMAINS：" +
            "校內教職員不會取得教師權限（fail-closed），只有 AUTH_TEACHER_EMAILS 內的帳戶是教師。" +
            "請以 AUTH_STAFF_DOMAINS 列出核准的教職員網域（完整標籤，例如 pochiu.edu.hk）。",
        });
      }
      for (const domain of config.auth.staffDomains) {
        // 少於三個標籤（例如 edu.hk）通常代表註冊層級的網域，會令極大量帳戶取得教師權限
        if (domain.split(".").length < 3) {
          issues.push({
            level: "warning",
            code: "auth-staff-domain-too-broad",
            message: `AUTH_STAFF_DOMAINS 包含過於寬廣的網域（${domain}）：這會令該網域下大量帳戶取得教師權限。請確認這確實是學校自己的網域。`,
          });
        }
      }
    } else if (config.auth.teacherEmails.length === 0) {
      issues.push({
        level: "warning",
        code: "auth-no-teachers-configured",
        message:
          "未設定 AUTH_TEACHER_EMAILS：目前沒有任何帳戶可進入教師端（管理員不受影響）。" +
          "校內教師須明確列在 AUTH_TEACHER_EMAILS 才可使用教師端功能；" +
          "如要暫時讓全校教職員使用教師介面，可設定 AUTH_STAFF_ACCESS_POLICY=school-domain " +
          "及 AUTH_STAFF_DOMAINS（請先了解這會令教師介面對全校教職員開放）。",
      });
    }

    // 名單內的學號形式帳戶：一律會被判定為學生（學號形式優先於教師名單；管理員名單除外）
    const studentPatternTeachers = config.auth.teacherEmails.filter((email) =>
      isStudentPatternEmail(email),
    );
    const studentPatternAdmins = config.auth.adminEmails.filter((email) =>
      isStudentPatternEmail(email),
    );
    if (studentPatternTeachers.length > 0 || studentPatternAdmins.length > 0) {
      const parts: string[] = [];
      if (studentPatternTeachers.length > 0) {
        parts.push(
          `AUTH_TEACHER_EMAILS 內有 ${studentPatternTeachers.length} 個學號形式帳戶：這些項目**不會生效**` +
            "（學號形式優先於教師名單，以保障學生帳戶不會被誤升為教師）",
        );
      }
      if (studentPatternAdmins.length > 0) {
        parts.push(
          `AUTH_ADMIN_EMAILS 內有 ${studentPatternAdmins.length} 個學號形式帳戶：管理員名單優先，` +
            "因此該帳戶**會**是管理員——請確認這確實是校方授權（學生帳戶不應是管理員）",
        );
      }
      issues.push({
        level: "error",
        code: "auth-allowlist-student-pattern",
        message: `${parts.join("；")}。請檢查名單是否誤填。`,
      });
    }

    if (config.roster.enabled) {
      issues.push({
        level: "info",
        code: "auth-roster-authoritative",
        message:
          "學生名冊決定誰可以登入（學號形式帳戶不在名冊內會被拒絕）。學號形式（s 加數字）一律是學生，" +
          "因此不會因名冊資料缺失或網域政策而取得教師權限。",
      });
    }
  }

  // 學生名冊
  if (!config.roster.enabled) {
    issues.push({
      level: config.auth.enabled ? "warning" : "info",
      code: "roster-disabled",
      message:
        "尚未連接學生名冊：任何校內學生帳戶都可登入，亦不會顯示班別及學號。設定 STUDENT_ROSTER_FILE／STUDENT_ROSTER_CSV_URL／STUDENT_ROSTER_SHEET_ID 即可啟用。",
    });
  } else {
    if (config.roster.source === "sheets-api" && config.roster.serviceAccountJson === null) {
      issues.push({
        level: "error",
        code: "roster-service-account-missing",
        message:
          "名冊來源為 Google Sheets API，但未設定 STUDENT_ROSTER_SERVICE_ACCOUNT_JSON，名冊無法讀取（登入會被拒絕）。",
      });
    }
    if (config.roster.source === "csv") {
      issues.push({
        level: "info",
        code: "roster-csv",
        message:
          "名冊以 CSV 網址讀取：請把 Google Sheet 設為「知道連結的任何人可檢視」，或改用 sheets-api 配合服務帳戶。",
      });
    }
    if (!config.roster.enforce) {
      issues.push({
        level: "warning",
        code: "roster-not-enforced",
        message:
          "已設定 STUDENT_ROSTER_ENFORCE=false：名冊只作顯示班別及學號，不會阻止名冊以外的學生登入。",
      });
    }
    if (config.roster.failOpen) {
      issues.push({
        level: "warning",
        code: "roster-fail-open",
        message:
          "已設定 STUDENT_ROSTER_FAIL_OPEN=true：名冊暫時無法讀取時仍允許登入（安全性較低，不建議正式環境使用）。",
      });
    }
  }

  // 資料儲存
  if (deployment.ephemeralStorage) {
    issues.push({
      level: deployment.platform === "cloud-run" ? "error" : "info",
      code: "ephemeral-storage",
      message:
        "資料庫及教材檔案現時放在專案／容器目錄：本機開發沒有問題，部署到 Cloud Run 應設定 BACKUP_BUCKET 啟用 Cloud Storage 備份，或改用 Cloud SQL。",
    });
  }

  // 備份
  if (!config.backup.enabled && deployment.platform === "cloud-run") {
    issues.push({
      level: "warning",
      code: "backup-disabled",
      message:
        "未設定 BACKUP_BUCKET：Cloud Run 執行個體停止或重新部署後，練習記錄、題庫及教材匯入結果會遺失。",
    });
  }
  if (config.backup.enabled && !config.backup.restoreOnStart) {
    issues.push({
      level: "warning",
      code: "backup-restore-disabled",
      message: "已設定 BACKUP_BUCKET 但 BACKUP_RESTORE_ON_START=false：啟動時不會還原雲端備份。",
    });
  }

  // 示範題目的自動發布（只影響未經任何驗證的本地示範題目；正式環境亦不會生效）
  if (config.autoPublishMockQuestions && process.env.NODE_ENV === "production") {
    issues.push({
      level: "warning",
      code: "auto-publish-questions",
      message:
        "DEMO_AUTO_PUBLISH_QUESTIONS=true：只影響本地示範生成（未經任何驗證）的題目，且正式環境不會生效；請確認預期與實際一致。",
    });
  }
  // 通過自動品質驗證的題目是否即時供學生自學（Sprint 7.8；預設開啟）
  if (!config.autoPublishValidatedQuestions) {
    issues.push({
      level: "info",
      code: "auto-publish-validated-disabled",
      message:
        "AUTO_PUBLISH_VALIDATED_QUESTIONS=false：通過自動品質驗證的題目會留在草稿，必須由教師發布；確定這是刻意的設定。",
    });
  }

  // 解釋未達標是否暫緩派發（產品政策；預設 off）
  const holdPolicyRaw = (process.env.EXPLANATION_HOLD_POLICY ?? "").trim();
  if (
    holdPolicyRaw.length > 0 &&
    !(EXPLANATION_HOLD_POLICIES as readonly string[]).includes(holdPolicyRaw.toLowerCase())
  ) {
    issues.push({
      level: "error",
      code: "explanation-hold-policy-invalid",
      message: `EXPLANATION_HOLD_POLICY="${holdPolicyRaw}" 不是有效值（${EXPLANATION_HOLD_POLICIES.join("／")}）；已回退為 off。打錯字不會令題目意外全部停止派發。`,
    });
  }
  if (config.explanationHoldPolicy !== "off") {
    issues.push({
      level: "warning",
      code: "explanation-hold-policy-active",
      message:
        `EXPLANATION_HOLD_POLICY=${config.explanationHoldPolicy}：解釋為佔位文字` +
        (config.explanationHoldPolicy === "placeholder-or-answer-only" ? "或只列答案" : "") +
        "的題目不會派給學生。以 2026-10-20 的題庫為例，1,875 題全部屬這兩類，啟用後學生將沒有題目可練習；" +
        "請確認這是刻意的產品決定，並先以 `npm run audit:explanation-worklist` 查看影響範圍。",
    });
  }

  // 教材自動開放政策（2026-10-21 擁有者指示）
  const autoOpenRaw = process.env.MATERIAL_AUTO_OPEN_POLICY;
  if (
    autoOpenRaw !== undefined &&
    autoOpenRaw.trim().length > 0 &&
    !(MATERIAL_AUTO_OPEN_POLICIES as readonly string[]).includes(autoOpenRaw.trim().toLowerCase())
  ) {
    issues.push({
      level: "warning",
      code: "material-auto-open-policy-invalid",
      message: `MATERIAL_AUTO_OPEN_POLICY="${autoOpenRaw}" 不是有效值（${MATERIAL_AUTO_OPEN_POLICIES.join("／")}）；已按預設 lesson-content 處理（匯入後自動開放課文／筆記）。`,
    });
  }
  if (config.materialAutoOpenPolicy === "lesson-content") {
    issues.push({
      level: "info",
      code: "material-auto-open-active",
      message:
        "MATERIAL_AUTO_OPEN_POLICY=lesson-content（擁有者指示）：匯入課文／筆記後會自動確認使用授權並開放給學生，" +
        "確認者記錄為 owner-policy:auto-open-all-materials。校內試題檔永不開放；檔名標示教師版／答案的材料仍需逐份人手確認內容。",
    });
  }

  // 學伴白名單網頁補充（預設關閉，見 services/tutor-web-supplement.ts）
  const rawWebAllowlist = process.env.TUTOR_WEB_ALLOWLIST;
  if (rawWebAllowlist !== undefined && rawWebAllowlist.trim().length > 0) {
    const entries = rawWebAllowlist
      .split(/[,;|\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    const dropped = entries.filter((item) => normalizeTutorWebAllowlistEntry(item) === null);
    if (dropped.length > 0) {
      issues.push({
        level: "warning",
        code: "tutor-web-allowlist-invalid",
        message:
          `TUTOR_WEB_ALLOWLIST 有 ${dropped.length} 項無法使用（${dropped.slice(0, 5).join("、")}）。` +
          "只接受不含協議及路徑的網域；IP 位址、單一主機名（例如 localhost）及共筆百科／社交平台一律忽略。",
      });
    }
  }
  if (config.webSupplement.enabled) {
    const rawMode = (process.env.TUTOR_WEB_MODE ?? "").trim().toLowerCase();
    if (rawMode.length > 0 && !(TUTOR_WEB_MODES as readonly string[]).includes(rawMode)) {
      issues.push({
        level: "warning",
        code: "tutor-web-mode-invalid",
        message: `TUTOR_WEB_MODE="${rawMode}" 不是有效值（${TUTOR_WEB_MODES.join("／")}）；已按預設 not-covered-only 處理。`,
      });
    }
    const rawProvider = (process.env.TUTOR_WEB_SEARCH_PROVIDER ?? "").trim().toLowerCase();
    if (rawProvider.length > 0 && !(TUTOR_WEB_SEARCH_PROVIDERS as readonly string[]).includes(rawProvider)) {
      issues.push({
        level: "warning",
        code: "tutor-web-search-provider-invalid",
        message:
          `TUTOR_WEB_SEARCH_PROVIDER="${rawProvider}" 不是有效值（${TUTOR_WEB_SEARCH_PROVIDERS.join("／")}）；` +
          `已改用預設 ${config.webSupplement.provider.provider}。`,
      });
    }
    if (rawProvider === "google") {
      issues.push({
        level: "warning",
        code: "tutor-web-search-provider-google-removed",
        message:
          "TUTOR_WEB_SEARCH_PROVIDER=google 已移除（Google Programmable Search 在學校 Workspace 被停用，" +
          "且 Custom Search JSON API 已於 2027-01-01 停止）：已改用預設 Brave。",
      });
    }
    const fallback = config.webSupplement.provider.fallback ?? null;
    const rawFallback = (process.env.TUTOR_WEB_SEARCH_FALLBACK_PROVIDER ?? "").trim().toLowerCase();
    if (rawFallback.length > 0 && rawFallback !== "none" && fallback === null) {
      issues.push({
        level: "warning",
        code: "tutor-web-search-fallback-invalid",
        message: `TUTOR_WEB_SEARCH_FALLBACK_PROVIDER="${rawFallback}" 不是有效值（${TUTOR_WEB_SEARCH_PROVIDERS.join("／")}；設 none 可關閉後備）；已當作未設定。`,
      });
    }
    const providerReady = isTutorWebSearchProviderReady(config.webSupplement.provider);
    const fallbackReady =
      fallback !== null && isTutorWebSearchProviderReady(fallback);
    if (config.webSupplement.provider.provider === "brave" && !providerReady) {
      issues.push({
        level: "warning",
        code: "tutor-web-search-provider-incomplete",
        message:
          "TUTOR_WEB_SEARCH_PROVIDER=brave 但缺少 TUTOR_WEB_SEARCH_API_KEY（Secret Manager 的 Brave Search API key）：" +
          (fallbackReady
            ? `主要來源不可用，學伴會改用後備來源（${fallback?.provider}）。`
            : "學伴不會有任何外部參考。"),
      });
    }
    if (fallback !== null && !fallbackReady) {
      issues.push({
        level: "warning",
        code: "tutor-web-search-fallback-incomplete",
        message:
          `已設定後備搜尋來源（${fallback.provider}）但缺少 API key：主要來源失效時不會有後備。` +
          "（DeepSeek 會沿用 DEEPSEEK_API_KEY／LLM_API_KEY。）",
      });
    }
    if (config.webSupplement.searchEndpoint === null && !providerReady && !fallbackReady) {
      issues.push({
        level: "warning",
        code: "tutor-web-supplement-no-search",
        message:
          "TUTOR_WEB_SUPPLEMENT_ENABLED=true 但未設定 TUTOR_WEB_SEARCH_ENDPOINT，亦未設定可用的 " +
          "TUTOR_WEB_SEARCH_PROVIDER：學伴不會有任何外部參考（狀態固定為 not-used）。" +
          "平台不會退化成爬取搜尋引擎結果頁。",
      });
    } else if ((providerReady || fallbackReady) && config.webSupplement.searchEndpoint === null) {
      const chain = [
        config.webSupplement.provider.provider,
        fallback === null ? null : fallback.provider,
      ]
        .filter((name): name is NonNullable<typeof name> => typeof name === "string")
        .join(" → ");
      issues.push({
        level: "info",
        code: "tutor-web-search-provider-active",
        message:
          `已使用第三方搜尋 API（${chain}）作外部參考來源：` +
          "學生的提問內容（截斷至 200 字、不含任何身分資料）會送到該第三方，且只在教材找不到時才送出。" +
          "請確認符合學校私隱政策；如需完全留在校方，改用 TUTOR_WEB_SEARCH_ENDPOINT 自架代理。",
      });
    }
    if (config.webSupplement.searchEndpoint !== null && !config.webSupplement.searchEndpoint.toLowerCase().startsWith("https://")) {
      issues.push({
        level: "error",
        code: "tutor-web-supplement-search-not-https",
        message: "TUTOR_WEB_SEARCH_ENDPOINT 必須以 https:// 開頭，否則每次搜尋都會因防 SSRF 而失敗。",
      });
    }
    if (config.webSupplement.allowlist.length === 0) {
      issues.push({
        level: "error",
        code: "tutor-web-supplement-empty-allowlist",
        message: "TUTOR_WEB_ALLOWLIST 沒有任何有效項目：外網補充永遠不會抓到任何頁面。",
      });
    }
    issues.push({
      level: "info",
      code: "tutor-web-supplement-active",
      message:
        "已開啟學伴外部參考：只會抓取白名單網站的短摘錄，介面以「🌐 外部參考（非課本・非考試標準）」與教材分開標示。" +
        "外部網站的史觀及用詞可能與課本不同，不屬評卷標準；校本教材仍是唯一課本依據。",
    });
  }

  // 教材檔案是否隨映像檔提供（Git 不含教材，見 .gitignore；缺少時平台會「成功」啟動但沒有內容）
  if (!materialsBundlePresent(config.materialsDir)) {
    issues.push({
      level: "warning",
      code: "materials-bundle-missing",
      message:
        "映像檔／部署目錄內沒有教材檔案：管理員無法匯入課本內容，學生會看到沒有教材的平台。" +
        "教材不納入版本控制（使用授權考量），請在含有教材的電腦上建置映像檔，或改用受控的教材匯入流程。",
    });
  }

  // 管理權杖
  const adminToken = (process.env.ADMIN_TOKEN ?? "").trim();
  if (adminToken.length > 0) {
    if (adminToken.length < MIN_ADMIN_TOKEN_LENGTH) {
      issues.push({
        level: "error",
        code: "admin-token-weak",
        message: `ADMIN_TOKEN 只有 ${adminToken.length} 個字元（最少 ${MIN_ADMIN_TOKEN_LENGTH} 個）：這個權杖可繞過所有角色檢查，後台 API 不會接受過短的值。請以隨機方式重新產生。`,
      });
    } else {
      issues.push({
        level: "info",
        code: "admin-token",
        message:
          "已設定 ADMIN_TOKEN：自動化腳本可使用 x-admin-token 標頭呼叫後台 API（教師端及管理員端）。這個權杖等同管理員，請只存放在伺服器的環境變數或 Secret Manager。",
      });
    }
  }

  return issues;
}
