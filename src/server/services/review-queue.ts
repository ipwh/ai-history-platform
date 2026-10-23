/**
 * 教師審核工作台的分批佇列（Sprint 16）。
 *
 * 設計原則：
 *   - **唯讀查詢**：只讀既有稽核報告及題庫；不改變任何狀態。
 *   - **分批**：每次最多 25 項，不把 623／97／42 項全部送到瀏覽器。
 *   - **不推斷**：報告缺失時回報 `available: false` 及原因，不用替代數字。
 *   - **不把自動證據當裁決**：P1／P3 只是排序；`reviewRecords` 原樣呈現。
 *
 * 佇列資料來源：
 *   - `servability`：`docs/quality/servability-remediation-2026-10-19.json`（97 題）
 *   - `provenance`：`docs/quality/review-priority-manifest-2026-10-19.json`（623 題）
 *   - `golden`：`listGoldenCandidateViews()`（42 個候選，含最新裁決）
 */
import fs from "node:fs";
import path from "node:path";

import { checkQuestionServable } from "./question-servability";
import { listGoldenCandidateViews } from "./golden-approval";
import { getQuestion, listQuestionReviews } from "../repositories/questions";

export const REVIEW_QUEUES = ["servability", "provenance", "golden"] as const;
export type ReviewQueue = (typeof REVIEW_QUEUES)[number];

export const MAX_PAGE_SIZE = 25;

export interface QueueItem {
  id: string;
  revision: number | null;
  fingerprint: string | null;
  status: string;
  summary: string;
  detail: Record<string, unknown>;
}

export interface QueuePage {
  queue: ReviewQueue;
  available: boolean;
  limitation: string | null;
  asOf: string | null;
  total: number;
  page: number;
  pageSize: number;
  items: QueueItem[];
  counts: Record<string, number>;
  /**
   * 報告內引用但題庫已沒有的題目數（例如題目已被刪除）。
   *
   * 報告是某一天的快照，題目之後可能被刪除；若照樣列出，教師點進去只會看到
   * 「找不到指定的題目」而不知道原因。這裡如實略過並回報數量，不會假裝清單完整。
   */
  skippedMissing: number;
}

function readReport<T>(relativePath: string): { data: T | null; error: string | null } {
  const full = path.resolve(process.cwd(), relativePath);
  if (!fs.existsSync(full)) return { data: null, error: `找不到報告 ${relativePath}；請先執行對應的 audit 指令。` };
  try {
    return { data: JSON.parse(fs.readFileSync(full, "utf8")) as T, error: null };
  } catch (error) {
    return {
      data: null,
      error: `報告 ${relativePath} 無法解析：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

/**
 * 比對報告與題庫：略過題庫已不存在的題目（報告是快照；題目之後可能被刪除）。
 *
 * 兩種情況必須分開：
 *   - **部分**不存在：如實略過並回報數量（教師不會點進必定 404 的項目）；
 *   - **全部**都不存在：代表目前資料庫不是產生這份報告時的那個（例如指向另一個資料庫），
 *     這種情況**不可**當成「沒有待處理項目」，因此回報 `available: false` 及原因。
 *     這是本專案一貫的 fail-closed 原則：空資料不可當作沒有問題。
 */
export function matchReportToDatabase<T extends { id: string }>(items: T[]): {
  items: T[];
  skipped: number;
  databaseMismatch: boolean;
} {
  const kept: T[] = [];
  let skipped = 0;
  for (const item of items) {
    if (getQuestion(item.id)) kept.push(item);
    else skipped += 1;
  }
  return {
    items: kept,
    skipped,
    databaseMismatch: items.length > 0 && kept.length === 0,
  };
}

interface ServabilityReport {
  generatedAt: string;
  items: Array<{
    id: string;
    revision: number;
    fingerprint: string;
    issueCode: string;
    reason: string;
    questionType: string;
    reviewRecords: number;
    currentHumanReview: boolean;
    hasSourceDocument: boolean;
  }>;
}

interface ManifestReport {
  generatedAt: string;
  totals?: {
    sourceRows?: number;
    clearedByVerification?: number;
    notInDatabase?: number;
  };
  rows: Array<{
    questionId: string;
    revision: number | null;
    fingerprint: string | null;
    priority: string;
    repairCategory: string;
    sourceStatus: string;
    overlapsSourcePending: boolean;
    servability: { servable: boolean; issueCode: string | null };
    requiredDecision: string;
  }>;
}

/**
 * provenance 佇列的說明文字：除了原本的「不是裁決」提醒，還要如實說明已經逐題核對了多少題，
 * 否則畫面顯示「沒有項目」會被誤讀成「從來沒有人檢查過」或「系統壞了」。
 */
function provenanceLimitation(data: ManifestReport): string {
  const base =
    "佇列來自唯讀 manifest（`npm run audit:review-manifest`）。此清單沒有逐題教師裁決，P3 不代表核准。";
  const cleared = data.totals?.clearedByVerification ?? 0;
  const missing = data.totals?.notInDatabase ?? 0;
  if (cleared === 0 && missing === 0) return base;
  return (
    `${base} 已有 ${cleared} 題按現時版本完成逐題核對並移出佇列（AI 依教材及史實核對，` +
    "**不是**教師覆核，沒有寫入覆核紀錄）；" +
    (missing > 0 ? `另有 ${missing} 題已不在題庫。` : "") +
    "題目日後再被修改，核對紀錄會自動失效並重回佇列。"
  );
}

export function listReviewQueue(  queue: ReviewQueue,
  options: { page?: number; pageSize?: number } = {},
): QueuePage {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(options.pageSize ?? 10)));

  if (queue === "servability") {
    const { data, error } = readReport<ServabilityReport>(
      "docs/quality/servability-remediation-2026-10-19.json",
    );
    if (!data) {
      return {
        queue,
        available: false,
        limitation: error,
        asOf: null,
        total: 0,
        page,
        pageSize,
        items: [],
        counts: {},
        skippedMissing: 0,
      };
    }
    const counts: Record<string, number> = {};
    for (const item of data.items) counts[item.issueCode] = (counts[item.issueCode] ?? 0) + 1;
    const missingServability = matchReportToDatabase(
      data.items.map((item) => ({ ...item, id: item.id })),
    );
    if (missingServability.databaseMismatch) {
      return {
        queue,
        available: false,
        limitation:
          `稽核報告列出 ${data.items.length} 題，但目前在這個資料庫完全找不到。` +
          "這通常代表資料庫不是產生報告時的那一個（例如設定了另一個資料庫）。" +
          "系統不會把這個情況當成「沒有待處理項目」；請確認資料庫設定後重新執行 `npm run audit:servability`。",
        asOf: data.generatedAt,
        total: 0,
        page,
        pageSize,
        items: [],
        counts: {},
        skippedMissing: missingServability.skipped,
      };
    }
    const items = missingServability.items.map((item) => {
      const latest = listQuestionReviews(item.id, 1)[0] ?? null;
      return {
        id: item.id,
        revision: item.revision,
        fingerprint: item.fingerprint,
        status: "quarantined",
        summary: `${item.issueCode}：${item.reason}`,
        detail: {
          questionType: item.questionType,
          hasSourceDocument: item.hasSourceDocument,
          reviewRecords: item.reviewRecords,
          currentHumanReview: item.currentHumanReview,
          latestReview: latest
            ? {
                decision: latest.decision,
                reviewerRole: latest.reviewerRole,
                revision: latest.revision,
                createdAt: latest.createdAt,
                reason: latest.reason,
              }
            : null,
        },
      };
    });
    return {
      queue,
      available: true,
      limitation:
        "佇列來自唯讀稽核報告（`npm run audit:servability`）；題目內容以詳情查詢即時讀取。",
      asOf: data.generatedAt,
      total: items.length,
      page,
      pageSize,
      items: paginate(items, page, pageSize),
      counts,
      skippedMissing: missingServability.skipped,
    };
  }

  if (queue === "provenance") {
    const { data, error } = readReport<ManifestReport>(
      "docs/quality/review-priority-manifest-2026-10-19.json",
    );
    if (!data) {
      return {
        queue,
        available: false,
        limitation: error,
        asOf: null,
        total: 0,
        page,
        pageSize,
        items: [],
        counts: {},
        skippedMissing: 0,
      };
    }
    const counts: Record<string, number> = {};
    for (const row of data.rows) counts[row.priority] = (counts[row.priority] ?? 0) + 1;
    const missingProvenance = matchReportToDatabase(
      data.rows.map((row) => ({ ...row, id: row.questionId })),
    );
    if (missingProvenance.databaseMismatch) {
      return {
        queue,
        available: false,
        limitation:
          `覆核 manifest 列出 ${data.rows.length} 題，但目前在這個資料庫完全找不到。` +
          "這通常代表資料庫不是產生 manifest 時的那一個。系統不會把這個情況當成「沒有待處理項目」；" +
          "請確認資料庫設定後重新執行 `npm run audit:review-manifest`。",
        asOf: data.generatedAt,
        total: 0,
        page,
        pageSize,
        items: [],
        counts: {},
        skippedMissing: missingProvenance.skipped,
      };
    }
    const items = missingProvenance.items.map((row) => ({
      id: row.questionId,
      revision: row.revision,
      fingerprint: row.fingerprint,
      status: row.servability.servable ? "servable" : "quarantined",
      summary: `${row.priority}／${row.repairCategory}／來源 ${row.sourceStatus}`,
      detail: {
        priority: row.priority,
        repairCategory: row.repairCategory,
        sourceStatus: row.sourceStatus,
        overlapsSourcePending: row.overlapsSourcePending,
        servable: row.servability.servable,
        issueCode: row.servability.issueCode,
        requiredDecision: row.requiredDecision,
        notice: "P1／P3 只是覆核排序，不是核准狀態。",
      },
    }));
    return {
      queue,
      available: true,
      limitation: provenanceLimitation(data),
      asOf: data.generatedAt,
      total: items.length,
      page,
      pageSize,
      items: paginate(items, page, pageSize),
      counts,
      skippedMissing: missingProvenance.skipped,
    };
  }

  // 候選清單是**產生檔**（依版權政策不納入版本控制）：檔案不存在時必須如實回報
  // available=false 及原因，而不是令整個佇列 API 以 500 失敗（2026-10-23 CI 發現：
  // 乾淨 checkout 沒有 docs/teacher-review/golden-candidates-*.json）。
  let goldenCandidates;
  try {
    goldenCandidates = listGoldenCandidateViews();
  } catch (error) {
    return {
      queue,
      available: false,
      limitation:
        `無法讀取 Golden 候選清單：${error instanceof Error ? error.message : String(error)}` +
        "這不代表沒有候選；請在產生候選清單的環境執行 `npm run golden:candidates`。",
      asOf: null,
      total: 0,
      page,
      pageSize,
      items: [],
      counts: {},
      skippedMissing: 0,
    };
  }

  const missingGolden = matchReportToDatabase(
    goldenCandidates.map((view) => ({ ...view, id: view.questionId })),
  );
  const views = missingGolden.items;
  if (missingGolden.databaseMismatch) {
    return {
      queue,
      available: false,
      limitation:
        `候選清單列出 ${missingGolden.skipped} 題，但目前在這個資料庫完全找不到。` +
        "這通常代表資料庫不是產生候選清單時的那一個。系統不會把這個情況當成「沒有候選」；" +
        "請確認資料庫設定後重新執行 `npm run golden:candidates`。",
      asOf: null,
      total: 0,
      page,
      pageSize,
      items: [],
      counts: {},
      skippedMissing: missingGolden.skipped,
    };
  }
  const counts: Record<string, number> = {};
  for (const view of views) counts[view.status] = (counts[view.status] ?? 0) + 1;
  const items = views.map((view) => ({
    id: view.questionId,
    revision: view.currentRevision,
    fingerprint: view.currentFingerprint,
    status: view.status,
    summary: `${view.group}／${view.status}`,
    detail: {
      candidateRevision: view.questionRevision,
      fingerprintMatchesCandidate: view.fingerprintMatchesCandidate,
      questionType: view.options.length > 0 ? "mc" : "fill",
      stem: view.stem,
      options: view.options,
      correctAnswer: view.correctAnswer,
      acceptedAnswers: view.acceptedAnswers,
      explanation: view.explanation,
      evidence: view.evidence,
      latestDecision: view.latestDecision,
      servable: view.servable,
    },
  }));
  return {
    queue,
    available: true,
    limitation:
      "候選清單不含教師評估內容（grading／理由／錯誤選項說明）；核准必須在表單提供，程式不會代填。",
    asOf: null,
    total: items.length,
    page,
    pageSize,
    items: paginate(items, page, pageSize),
    counts,
    skippedMissing: missingGolden.skipped,
  };
}

/** 單題詳情：題目、來源位置、答案、評分方式、可取性理由及覆核歷史（唯讀） */
export function questionReviewDetail(questionId: string) {
  const question = getQuestion(questionId);
  if (!question) return null;
  const servability = checkQuestionServable(question);
  return {
    question,
    servability,
    reviews: listQuestionReviews(questionId, 20),
  };
}
