/**
 * 管理員端儀表板與系統狀態的服務層。
 *
 * 只讀取統計數字及狀態，不會修改任何資料；亦不會回傳憑證、完整路徑或學生個人資料。
 */
import { appVersion, describeConfigIssues, describeDeployment } from "../config-diagnostics";
import { getServerConfig } from "../config";
import { databaseStatus } from "../db/connection";
import { getBackupStatus } from "../db/backup";
import { describeLlm } from "../llm";
import { describeOcr } from "../ocr";
import {
  countQuestionsByStatus,
  countSchoolPaperQuestions,
  countUnverifiedQuestionsNeedingReview,
} from "../repositories/questions";
import { countMaterialBlocks, listTopics } from "../repositories/topics";
import { listMaterials } from "./material-service";
import { countOpenReports } from "../repositories/reports";
import { gradingStats, llmUsageStats } from "../repositories/llm-logs";
import { getRosterStatus } from "../roster";

export interface PlatformOverview {
  topics: { total: number; published: number; curriculum: number };
  materials: {
    documents: number;
    uploaded: number;
    demo: number;
    blocks: number;
    ocrBlocks: number;
    /** 尚未完成 OCR 的文件數 */
    ocrPending: number;
  };
  questions: {
    total: number;
    published: number;
    draft: number;
    disabled: number;
    /** 未通過教材依據核對（教材重新匯入後可能出現），已排除校內試題（來源為試卷，不需教材依據） */
    unverified: number;
    /** 校內試題（來源為試卷）題數，供教師掌握核對進度 */
    schoolPaper: number;
    /** 有未處理的學生回報，需教師覆核 */
    flagged: number;
  };
  observability: {
    /** 最近 7 天 LLM 出題／批改記錄 */
    llmRequests: number;
    llmFailures: number;
    /** 最近 7 天 AI 批改成功、失敗及回退次數 */
    grading: { attempts: number; failures: number; fallbacks: number };
  };
}

export function getPlatformOverview(): PlatformOverview {
  const topics = listTopics();
  const materials = listMaterials();
  const questionCounts = countQuestionsByStatus();
  const curriculumTopics = topics.filter((topic) => topic.level !== 0);

  return {
    topics: {
      total: curriculumTopics.length,
      published: curriculumTopics.filter((topic) => topic.published).length,
      curriculum: curriculumTopics.length,
    },
    materials: {
      documents: materials.totals.documents,
      uploaded: materials.totals.uploaded,
      demo: materials.totals.demo,
      blocks: materials.totals.blocks,
      ocrBlocks: materials.totals.ocrBlocks,
      ocrPending: materials.documents.filter(
        (document) => document.ocrStatus === "not-run" || document.ocrStatus === "partial",
      ).length,
    },
    questions: {
      total: questionCounts.total,
      published: questionCounts.published,
      draft: questionCounts.draft,
      disabled: questionCounts.disabled,
      unverified: countUnverifiedQuestionsNeedingReview(),
      schoolPaper: countSchoolPaperQuestions(),
      flagged: countOpenReports(),
    },
    observability: {
      ...llmUsageStats(7),
      grading: gradingStats(7),
    },
  };
}

export interface SystemStatus {
  ok: boolean;
  version: string;
  database: { driver: string; status: string; message: string | null };
  llm: {
    provider: string;
    providerLabel: string;
    model: string | null;
    configured: boolean;
    demoMode: boolean;
    aiGrading: boolean;
    notice: string | null;
  };
  ocr: {
    enabled: boolean;
    provider: string;
    providerLabel: string;
    languages: string;
    notice: string | null;
  };
  auth: { enabled: boolean; requireSignIn: boolean; schoolDomains: string[]; staffApiOpen: boolean };
  roster: {
    enabled: boolean;
    enforce: boolean;
    source: string;
    loaded: boolean;
    students: number | null;
    inScope: number | null;
    classPrefixes: string[];
    classes: string[];
    loadedAt: string | null;
    error: string | null;
  };
  deployment: { platform: string; ephemeralStorage: boolean; notes: string[] };
  /** 資料庫備份狀態（免費持久化：備份到 Cloud Storage） */
  backup: {
    enabled: boolean;
    lastSuccessAt: string | null;
    lastError: string | null;
    backupsUploaded: number;
    restore: string;
    restoreMessage: string | null;
  };
  configIssues: { level: string; code: string; message: string }[];
}

/** 是否正在 Cloud Run 上執行（由 K_SERVICE 判斷） */
export function onCloudRun(): boolean {
  return (process.env.K_SERVICE ?? "").trim().length > 0;
}

/** 管理員端健康狀態：版本、資料庫、LLM、OCR、登入、學生名冊、部署提示及設定問題 */
export async function getSystemStatus(): Promise<SystemStatus> {
  const config = getServerConfig();
  const llm = describeLlm();
  const ocr = describeOcr();
  const database = databaseStatus();
  const adminTokenSet = (process.env.ADMIN_TOKEN ?? "").trim().length > 0;

  return {
    ok: database.status === "ok",
    version: appVersion(),
    database,
    llm: {
      provider: llm.provider,
      providerLabel: llm.providerLabel,
      model: config.llm.model,
      configured: llm.configured,
      demoMode: llm.demoMode,
      aiGrading: llm.demoMode ? false : config.llm.gradingEnabled,
      notice: llm.notice,
    },
    ocr: {
      enabled: ocr.enabled,
      provider: ocr.provider,
      providerLabel: ocr.providerLabel,
      languages: ocr.languages,
      notice: ocr.notice,
    },
    auth: {
      enabled: config.auth.enabled,
      requireSignIn: config.auth.requireSignIn,
      schoolDomains: config.auth.schoolDomains,
      // 在 Cloud Run 上，未啟用登入時後台 API 會被守衛直接拒絕（403），因此不算「開放」
      staffApiOpen: !config.auth.enabled && !adminTokenSet && !onCloudRun(),
    },
    roster: {
      enabled: config.roster.enabled,
      enforce: config.roster.enforce,
      source: config.roster.source,
      loaded: false,
      students: null,
      inScope: null,
      classPrefixes: config.roster.scope.classPrefixes,
      classes: config.roster.scope.classes,
      loadedAt: null,
      error: null,
    },
    deployment: describeDeployment(),
    backup: (() => {
      const status = getBackupStatus();
      return {
        enabled: status.enabled,
        lastSuccessAt: status.lastSuccessAt,
        lastError: status.lastError,
        backupsUploaded: status.uploads,
        restore: status.restore,
        restoreMessage: status.restoreMessage,
      };
    })(),
    configIssues: describeConfigIssues(),
  } satisfies SystemStatus;
}

/** 完整系統狀態（含名冊載入結果，供管理員端監察使用） */
export async function getSystemStatusWithRoster(): Promise<SystemStatus> {
  const status = await getSystemStatus();
  const roster = await getRosterStatus();
  return { ...status, roster };
}

/** 課題、教材及題目的摘要（供管理員端頁首顯示） */
export function getCurriculumSummary() {
  return listTopics()
    .filter((topic) => topic.level !== 0)
    .map((topic) => ({
      id: topic.id,
      title: topic.title,
      level: topic.level,
      topicNumber: topic.topicNumber,
      published: topic.published,
      blockCount: countMaterialBlocks(topic.id),
    }));
}
