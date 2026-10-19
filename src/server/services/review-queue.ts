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

export function listReviewQueue(
  queue: ReviewQueue,
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
      };
    }
    const counts: Record<string, number> = {};
    for (const item of data.items) counts[item.issueCode] = (counts[item.issueCode] ?? 0) + 1;
    const items = data.items.map((item) => {
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
      };
    }
    const counts: Record<string, number> = {};
    for (const row of data.rows) counts[row.priority] = (counts[row.priority] ?? 0) + 1;
    const items = data.rows.map((row) => ({
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
      limitation:
        "佇列來自唯讀 manifest（`npm run audit:review-manifest`）。此清單沒有逐題教師裁決，P3 不代表核准。",
      asOf: data.generatedAt,
      total: items.length,
      page,
      pageSize,
      items: paginate(items, page, pageSize),
      counts,
    };
  }

  const views = listGoldenCandidateViews();
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
