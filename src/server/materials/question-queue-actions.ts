/**
 * 「教師決定隊列」與「用詞對齊」動作清單的套用器（Sprint 8.2 後續）。
 *
 * 背景：2026-10 版教材取代舊版後，36 條題目的原文節錄在新教材找不到逐字相符的段落
 * （見 docs/teacher-review/material-decision-queue-2026-10.json）。擁有者指示：
 *   1. 新教材仍有相關內容者，按新教材改寫（更正答案、更新用詞、重寫題目）；
 *   2. 新教材完全沒有相關內容者，從題庫刪除。
 * 另外，30 條已重新連結的題目中，部分仍沿用舊版用詞，需要與新教材一致。
 *
 * 設計原則（與 reference-remapping.ts 相同）：
 *   - 預設模擬（dry run），要 `--apply` 才寫入；
 *   - 每條先驗證「修正前的題目內容指紋」與清單一致（教師改過即不套用）；
 *   - 改寫時，證據段落必須**逐字**包含新節錄（不做相似度或關鍵詞判斷）；
 *   - 段落 ID 只在產生清單的資料庫有效，其他資料庫改以「檔名＋來源位置」解析；
 *   - 只透過 `repositories/questions` 的 updateQuestion／deleteQuestion 寫入，
 *     因此版本號（`revision`）遞增、舊覆核紀錄依既有規則失效；
 *   - **不建立**任何人工覆核紀錄或擁有者授權紀錄；
 *   - 重複執行第二次為 no-op（已符合清單者回報 `already-applied`）。
 *
 * 刪除的界線：本模組只刪除清單明確列出的題目，並在報告中列出。清單產生前已核對
 * 這些題目的作答紀錄、題目回報及覆核紀錄均為 0（不會留下孤立的學生紀錄）。
 */
import { z } from "zod";

import {
  getBlocksByIds,
  listBlocksByTopic,
  listStudentDistributableDocumentIds,
} from "../repositories/materials";
import { deleteQuestion, getQuestion, updateQuestion } from "../repositories/questions";
import { questionFingerprint } from "../services/question-service";
import { blockSearchTexts, MIN_EXCERPT_LENGTH } from "./block-search";

/** 節錄可用作教材依據的最短長度（與教材依據修復共用同一規則） */
export { MIN_EXCERPT_LENGTH } from "./block-search";

/** 題目內容指紋（供清單產生器及測試使用；重用平台的 questionFingerprint） */
export function questionFingerprintFor(question: Parameters<typeof questionFingerprint>[0]): string {
  return questionFingerprint(question);
}

const contentOverrideSchema = z.object({
  question: z.string().min(4).optional(),
  options: z.array(z.string().min(1)).optional(),
  correctAnswer: z.string().min(1).optional(),
  acceptedAnswers: z.array(z.string()).optional(),
  explanation: z.string().min(1).optional(),
  gradingPoints: z.array(z.string()).optional(),
  knowledgePoint: z.string().min(1).optional(),
});

const evidenceSchema = z.object({
  blockIds: z.array(z.string().min(1)).min(1),
  documentFileName: z.string().min(1),
  sourceLocation: z.string().min(1),
  excerpt: z.string().min(MIN_EXCERPT_LENGTH),
  relatedLocators: z
    .array(z.object({ documentFileName: z.string().min(1), sourceLocation: z.string().min(1) }))
    .default([]),
  relatedExcerpts: z.array(z.string()).default([]),
});

export const queueActionEntrySchema = z.discriminatedUnion("action", [
  z.object({
    questionId: z.string().min(1),
    action: z.literal("rewrite"),
    topicId: z.string().min(1),
    sectionId: z.string().min(1),
    questionType: z.enum(["mc", "fill", "short"]),
    beforeFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    beforeExcerpt: z.string(),
    beforeSourceLocation: z.string(),
    content: contentOverrideSchema,
    evidence: evidenceSchema,
    resultFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    reason: z.string().min(1),
  }),
  z.object({
    questionId: z.string().min(1),
    action: z.literal("rewrite-content"),
    topicId: z.string().min(1),
    sectionId: z.string().min(1),
    questionType: z.enum(["mc", "fill", "short"]),
    beforeFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    content: contentOverrideSchema,
    resultFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    reason: z.string().min(1),
  }),
  z.object({
    questionId: z.string().min(1),
    action: z.literal("link-evidence"),
    topicId: z.string().min(1),
    sectionId: z.string().min(1),
    questionType: z.enum(["mc", "fill", "short"]),
    beforeFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    beforeExcerpt: z.string(),
    beforeSourceLocation: z.string(),
    evidence: evidenceSchema,
    reason: z.string().min(1),
  }),
  z.object({
    questionId: z.string().min(1),
    action: z.literal("delete"),
    topicId: z.string().min(1),
    sectionId: z.string().min(1),
    questionType: z.enum(["mc", "fill", "short"]),
    beforeFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    /** 刪除前的題目文字及答案（刪除後無法由資料庫查回，記錄在清單內以便稽核） */
    beforeQuestion: z.string().min(1).optional(),
    beforeCorrectAnswer: z.string().min(1).optional(),
    reason: z.string().min(1),
  }),
]);

export const queueActionManifestSchema = z.object({
  version: z.literal(1),
  title: z.string().min(1),
  purpose: z.string().min(1),
  sourceMaterials: z.string().min(1),
  generatedFrom: z.record(z.string(), z.string()),
  entries: z.array(queueActionEntrySchema).min(1),
});

export type QueueActionEntry = z.infer<typeof queueActionEntrySchema>;
export type QueueActionManifest = z.infer<typeof queueActionManifestSchema>;

export type QueueActionOutcome = "applied" | "already-applied" | "planned" | "failed";

export interface QueueActionResult {
  questionId: string;
  action: QueueActionEntry["action"];
  outcome: QueueActionOutcome;
  detail: string;
}

export interface QueueActionReport {
  results: QueueActionResult[];
  applied: number;
  alreadyApplied: number;
  planned: number;
  failed: number;
  deleted: number;
}

export interface ApplyQueueActionsOptions {
  /** 只檢查及報告，不寫入資料庫（預設 false） */
  dryRun?: boolean;
  /**
   * 全部條目通過驗證才寫入（預設 true）。
   *
   * 為甚麼預設要 atomic：刪除條目不需要教材證據（新教材已沒有該內容），因此若在
   * 「尚未匯入新教材」的資料庫上執行，改寫會全部失敗但刪除仍會生效——題庫會變成
   * 「一部分處理、一部分沒有」的半完成狀態。atomic 模式先以模擬方式驗證全部條目，
   * 有任何一條失敗即完全不寫入，令執行者可以先修正前置條件（例如先匯入新教材）。
   */
  atomic?: boolean;
  /** 要求證據段落所屬文件已開放給學生（open:materials 之後使用） */
  requireOpenDocuments?: boolean;
}

/**
 * 依清單修正題目。
 *
 * 每條獨立處理：一條失敗不影響其他條目（正式環境應以失敗清單決定是否繼續）。
 */
export function applyQuestionQueueActions(
  input: QueueActionManifest,
  options: ApplyQueueActionsOptions = {},
): QueueActionReport {
  const manifest = queueActionManifestSchema.parse(input);
  const dryRun = options.dryRun ?? false;
  const atomic = options.atomic ?? true;
  const distributable = options.requireOpenDocuments ? listStudentDistributableDocumentIds() : null;

  // atomic 模式：先以模擬方式驗證全部條目；有任何一條失敗即完全不寫入
  if (!dryRun && atomic) {
    const preflight = applyQuestionQueueActions(manifest, {
      dryRun: true,
      atomic: false,
      requireOpenDocuments: options.requireOpenDocuments,
    });
    if (preflight.failed > 0) {
      return {
        ...preflight,
        applied: 0,
        deleted: 0,
        planned: preflight.planned + preflight.alreadyApplied,
        alreadyApplied: 0,
      };
    }
  }

  const results: QueueActionResult[] = [];

  for (const entry of manifest.entries) {
    const fail = (detail: string) =>
      results.push({ questionId: entry.questionId, action: entry.action, outcome: "failed", detail });

    const question = getQuestion(entry.questionId);

    if (entry.action === "delete") {
      if (!question) {
        results.push({
          questionId: entry.questionId,
          action: entry.action,
          outcome: "already-applied",
          detail: "題目已不存在（已刪除）",
        });
        continue;
      }
      if (
        question.topicId !== entry.topicId ||
        question.sectionId !== entry.sectionId ||
        question.questionType !== entry.questionType
      ) {
        fail("題目的課題／分節／題型與清單不符");
        continue;
      }
      if (questionFingerprint(question) !== entry.beforeFingerprint) {
        fail("題目內容自清單產生後已改（內容指紋不符），未刪除");
        continue;
      }
      if (dryRun) {
        results.push({
          questionId: entry.questionId,
          action: entry.action,
          outcome: "planned",
          detail: "將刪除（新教材沒有相關內容）",
        });
        continue;
      }
      deleteQuestion(entry.questionId);
      results.push({
        questionId: entry.questionId,
        action: entry.action,
        outcome: "applied",
        detail: "已刪除（新教材沒有相關內容）",
      });
      continue;
    }

    if (!question) {
      fail("找不到題目（可能已被刪除）");
      continue;
    }
    if (
      question.topicId !== entry.topicId ||
      question.sectionId !== entry.sectionId ||
      question.questionType !== entry.questionType
    ) {
      fail("題目的課題／分節／題型與清單不符");
      continue;
    }

    const currentFingerprint = questionFingerprint(question);
    if (entry.action !== "link-evidence" && currentFingerprint === entry.resultFingerprint) {
      results.push({
        questionId: entry.questionId,
        action: entry.action,
        outcome: "already-applied",
        detail: "題目已符合清單內容",
      });
      continue;
    }
    if (
      entry.action !== "link-evidence" &&
      currentFingerprint !== entry.beforeFingerprint
    ) {
      fail("題目內容自清單產生後已改（內容指紋不符），未套用");
      continue;
    }
    if (entry.action === "link-evidence") {
      // 只修正「教材依據」：題目內容必須與清單一致（= 目前內容），節錄改為來源文件的逐字文字
      if (currentFingerprint !== entry.beforeFingerprint) {
        fail("題目內容自清單產生後已改（內容指紋不符），未套用");
        continue;
      }
      const alreadyLinked =
        question.sourceExcerpt.trim() === entry.evidence.excerpt.trim() &&
        question.sourceLocation.trim() === entry.evidence.sourceLocation.trim() &&
        question.sourceVerified &&
        question.sourceBlockIds.length === entry.evidence.blockIds.length;
      if (alreadyLinked) {
        results.push({
          questionId: entry.questionId,
          action: entry.action,
          outcome: "already-applied",
          detail: "教材依據已連結至清單所列段落",
        });
        continue;
      }
    }

    // 證據：改寫類先解析目標段落並逐字驗證；用詞對齊類沿用目前的引用段落
    let sourceBlockIds = question.sourceBlockIds;
    let sourceLocation = question.sourceLocation;
    let sourceExcerpt = question.sourceExcerpt;
    if (entry.action === "rewrite" || entry.action === "link-evidence") {
      const byId = getBlocksByIds(entry.evidence.blockIds);
      // 段落 ID 只在產生清單的資料庫有效；其他資料庫改以「檔名＋來源位置」解析。
      // 清單同時記錄主要及相關段落，因此以位置解析時要避免重複加入同一段落。
      const collected: typeof byId = [];
      const seen = new Set<string>();
      const addBlock = (block: (typeof byId)[number]) => {
        if (seen.has(block.id)) return;
        seen.add(block.id);
        collected.push(block);
      };

      if (byId.length === entry.evidence.blockIds.length) {
        for (const block of byId) addBlock(block);
      } else {
        const byLocation = listBlocksByTopic(entry.topicId).filter(
          (candidate) =>
            candidate.sourceLocation.trim() === entry.evidence.sourceLocation.trim() &&
            candidate.sourceLocation.split("·")[0]!.trim() === entry.evidence.documentFileName,
        );
        // 同一位置對應多個段落即屬歧義：不接受「任選一段」的寫法（fail closed）
        if (byLocation.length > 1) {
          fail(`證據位置在資料庫中對應多個段落（${entry.evidence.sourceLocation}，歧義），未套用`);
          continue;
        }
        for (const block of byLocation) addBlock(block);
      }
      if (collected.length === 0) {
        fail(`找不到證據段落（${entry.evidence.sourceLocation}）`);
        continue;
      }
      const supporting = collected.filter((block) =>
        blockSearchTexts(block).some((text) => text.includes(entry.evidence.excerpt)),
      );
      if (supporting.length === 0) {
        fail("新節錄不是證據段落的逐字內容（不做相似度判斷）");
        continue;
      }
      if (
        collected.some(
          (block) => block.sourceLocation.split("·")[0]!.trim() !== entry.evidence.documentFileName,
        )
      ) {
        fail("證據段落不屬於清單所列的教材文件");
        continue;
      }
      let relatedFailure: string | null = null;
      for (const locator of entry.evidence.relatedLocators) {
        const matches = listBlocksByTopic(entry.topicId).filter(
          (block) =>
            block.sourceLocation.trim() === locator.sourceLocation.trim() &&
            block.sourceLocation.split("·")[0]!.trim() === locator.documentFileName,
        );
        if (matches.length === 0) {
          relatedFailure = `找不到相關證據段落（${locator.sourceLocation}）`;
          break;
        }
        if (matches.length > 1) {
          relatedFailure = `相關證據位置對應多個段落（${locator.sourceLocation}，歧義）`;
          break;
        }
        for (const block of matches) addBlock(block);
      }
      if (relatedFailure) {
        fail(relatedFailure);
        continue;
      }
      if (distributable && collected.some((block) => !distributable.has(block.documentId))) {
        fail("證據段落所屬文件尚未開放給學生（--require-open）");
        continue;
      }
      sourceExcerpt = entry.evidence.excerpt;
      sourceLocation = entry.evidence.sourceLocation;
      sourceBlockIds = collected.map((block) => block.id);
    } else {
      // rewrite-content：節錄及引用需仍然成立
      const blocks = getBlocksByIds(question.sourceBlockIds);
      if (blocks.length !== question.sourceBlockIds.length) {
        fail("題目目前的引用段落已不存在；請先修正教材依據");
        continue;
      }
      const verbatim = blocks.some((block) =>
        blockSearchTexts(block).some((text) => text.includes(question.sourceExcerpt.trim())),
      );
      if (!verbatim) {
        fail("題目目前的節錄不是引用段落的逐字內容；請先修正教材依據");
        continue;
      }
      if (
        distributable &&
        blocks.some((block) => !distributable.has(block.documentId))
      ) {
        fail("引用段落所屬文件尚未開放給學生（--require-open）");
        continue;
      }
    }

    if (dryRun) {
      results.push({
        questionId: entry.questionId,
        action: entry.action,
        outcome: "planned",
        detail:
          entry.action === "rewrite"
            ? "將改寫並重新連結依據"
            : entry.action === "link-evidence"
              ? "將修正教材依據（節錄改為來源文件逐字文字）"
              : "將更新題目用詞",
      });
      continue;
    }

    updateQuestion(question.id, {
      ...question,
      // link-evidence 只修正教材依據，不改動題目內容
      ...(entry.action === "link-evidence" ? {} : entry.content),
      sourceExcerpt,
      sourceLocation,
      sourceBlockIds,
      sourceVerified: true,
    });
    results.push({
      questionId: entry.questionId,
      action: entry.action,
      outcome: "applied",
      detail:
        entry.action === "rewrite"
          ? "已改寫並重新連結依據"
          : entry.action === "link-evidence"
            ? "已修正教材依據（節錄改為來源文件逐字文字）"
            : "已更新題目用詞",
    });
  }

  const count = (outcome: QueueActionOutcome) =>
    results.filter((result) => result.outcome === outcome).length;
  return {
    results,
    applied: count("applied"),
    alreadyApplied: count("already-applied"),
    planned: count("planned"),
    failed: count("failed"),
    deleted: results.filter((result) => result.action === "delete" && result.outcome === "applied")
      .length,
  };
}
