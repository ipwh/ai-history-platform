/**
 * 版本控制的「教材依據重新連結清單」套用器（Sprint 8.2）。
 *
 * 背景：2026-10 版教材取代舊版後，部分題目的原文節錄在新教材找不到逐字相符的段落。
 * 逐題核對後，其中 30 條可在新教材找到**逐字**相符的段落，需要把依據重新連結；
 * 其餘 36 條維持「未通過教材依據核對」（見 docs/teacher-review）。
 *
 * 為甚麼要清單化：更新正式環境時必須重複同一個動作。把對應寫進版本控制的清單
 * （`docs/material-remapping/*.json`，每條都有題目 ID、課題、目標段落、逐字節錄及理由），
 * 再由本模組以決定性的方式套用，令「重複執行」與「換一部電腦執行」得到相同結果，
 * 而不是依賴一次性的臨時腳本。
 *
 * 與平台契約的關係（重要）：
 *   - 「已核對」的定義是**節錄逐字出現在引用的段落之中**（見 block-search.ts）；
 *     本模組只接受逐字相符，不做相似度或關鍵詞判斷。
 *   - 題目更新一律走 `repositories/questions.updateQuestion`（`revision` 會 +1），
 *     因此舊版本的覆核紀錄／自動驗證紀錄依既有規則失效。
 *   - 只改 `sourceExcerpt`／`sourceLocation`／`sourceBlockIds`／`sourceVerified`；
 *     題幹、選項、答案、解釋、得分要點不在本模組可寫入的欄位之內。
 *   - 本模組**不建立**任何人工覆核紀錄或擁有者授權紀錄。
 *
 * 失敗即不套用（fail safe）：
 *   - 題目內容指紋與清單不符（教師已改過題目）→ 不套用該條；
 *   - 題目目前狀態既非「清單記載的套用前狀態」亦非「已套用狀態」→ 不套用該條；
 *   - 目標段落不存在，或節錄不是目標段落的逐字內容 → 不套用該條；
 *   - `--require-open`（`requireOpenDocuments`）時，目標段落所屬文件未開放給學生 → 不套用該條。
 *
 * 判斷次序（2026-10-16 修正）：先判斷「是否已套用」，之後才檢查內容指紋。已套用的條目
 * 不會寫入任何欄位，因此不必以指紋擋下；把指紋檢查放在前面會令題目其後由教師或另一份清單
 * 更新用詞時，重複執行誤報「內容指紋不符」。真正要改寫依據時，指紋仍然必須相符。
 *
 * 跨資料庫（重要）：段落 ID 由匯入時產生，**只在產生清單的資料庫有效**。在正式環境快照
 * 匯入同一批教材後，段落 ID 必然不同，因此目標段落改以「檔名 ＋ 來源位置字串」解析
 * （位置由教材檔的段落次序決定，可重現）；節錄必須在解析到的段落中逐字出現才會套用。
 * 「套用前的狀態」亦以節錄及來源位置比對，不使用個別資料庫的段落 ID。
 * 若同一位置在該資料庫對應**多個**段落（匯入重複段落等），一律視為歧義並拒絕套用
 * （fail closed：不接受「任選一段」）。2026-10-16 實測：本機資料庫及重現副本的 30 條
 * 目標位置均為唯一對應（0 個歧義）。
 *
 * 重複執行：已套用且狀態一致的題目會回報 `already-applied`，完全不寫入資料庫
 * （因此版本號不會無謂遞增）。
 *
 * 引用段落去重（2026-10-16 修正）：清單可同時把同一段落列為主要目標及「其他引用段落」
 * （產生清單時兩者都取自同一次核對），套用時會以段落 ID 去重。若不去重，寫入的
 * `sourceBlockIds` 會含有重複 ID，令 `getBlocksByIds` 的長度與 ID 數目不符，學生端依
 * fail-closed 政策直接不顯示節錄；重複執行時亦會誤報「套用前狀態不符」。
 */
import { createHash } from "node:crypto";
import { z } from "zod";

import { getBlocksByIds, listBlocksByTopic, listStudentDistributableDocumentIds } from "../repositories/materials";
import { getQuestion, updateQuestion } from "../repositories/questions";
import { questionFingerprint } from "../services/question-service";
import { excerptAppearsInBlock, MIN_EXCERPT_LENGTH } from "./block-search";

/** 清單條目 */
export const remappingEntrySchema = z.object({
  /** 題目 ID */
  questionId: z.string().min(1),
  /** 目標課題（必須與題目目前的課題一致） */
  topicId: z.string().min(1),
  /** 目標分節（必須與題目目前的分節一致） */
  sectionId: z.string().min(1),
  questionType: z.enum(["mc", "fill", "short"]),
  /** 目標段落所屬的學生教材檔名（僅作核對用） */
  documentFileName: z.string().min(1),
  /**
   * 目標段落（重新連結後的依據）。
   *
   * **注意：段落 ID 只在產生清單的那個資料庫有效**（每次匯入都會產生新 ID）。
   * 在別的資料庫（例如正式環境快照匯入教材後）執行時，改以
   * `documentFileName` + `sourceLocation`（段落位置字串，由教材檔的段落次序決定，可重現）
   * 解析目標段落；兩者也對不上時不套用。
   */
  blockIds: z.array(z.string().min(1)).min(1),
  /** 重新連結後的來源位置（由目標段落提供，同時用作跨資料庫的定位依據） */
  sourceLocation: z.string().min(1),
  /**
   * 同一次重新連結所引用的其他段落（例如證據分佈於兩段），以檔名＋位置字串定位；
   * 多數條目為空陣列。
   */
  relatedBlockLocators: z
    .array(
      z.object({
        documentFileName: z.string().min(1),
        sourceLocation: z.string().min(1),
      }),
    )
    .default([]),
  /** 逐字節錄（必須逐字出現在 blockIds 之中） */
  excerpt: z.string().min(MIN_EXCERPT_LENGTH),
  /** 題目內容指紋（questionFingerprint）：內容被改過即不套用 */
  contentFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  /** 為甚麼這個段落支持這條題目與其答案 */
  rationale: z.string().min(1),
  verifiedAt: z.string().min(1),
  /** 核對方法（記錄當時的規則） */
  verification: z.string().min(1),
  /** 套用前的狀態（用於確認題目仍在清單預期的版本） */
  previous: z.object({
    excerpt: z.string(),
    sourceLocation: z.string(),
    blockIds: z.array(z.string()),
    revision: z.number().int().positive(),
    status: z.string(),
  }),
  /** 套用後的版本編號（套用時由 updateQuestion 遞增；記錄用） */
  appliedRevision: z.number().int().positive().optional(),
});

export const remappingManifestSchema = z.object({
  version: z.literal(1),
  title: z.string().min(1),
  purpose: z.string().min(1),
  sourceMaterials: z.string().min(1),
  generatedFrom: z.record(z.string(), z.string()),
  entries: z.array(remappingEntrySchema).min(1),
});

export type RemappingEntry = z.infer<typeof remappingEntrySchema>;
export type RemappingManifest = z.infer<typeof remappingManifestSchema>;

/** 節錄可用作教材依據的最短長度（與 import-service 的修復流程共用同一規則） */
export { MIN_EXCERPT_LENGTH } from "./block-search";

export type RemappingOutcome = "applied" | "already-applied" | "planned" | "failed";

export interface RemappingEntryResult {
  questionId: string;
  outcome: RemappingOutcome;
  /** 人類可讀的說明（成功＝目標段落；失敗＝原因） */
  detail: string;
}

export interface RemappingReport {
  results: RemappingEntryResult[];
  applied: number;
  alreadyApplied: number;
  planned: number;
  failed: number;
}

export interface ApplyRemappingOptions {
  /** 只檢查及報告，不寫入資料庫（預設 false） */
  dryRun?: boolean;
  /**
   * 要求目標段落所屬文件已開放給學生（`student_distribution` + 版權／內容確認）。
   * 正式環境的流程應在 `npm run open:materials -- --apply` 之後加上這個旗標。
   */
  requireOpenDocuments?: boolean;
}

/** 以集合方式比較段落 ID（順序不影響是否已套用的判斷） */
function sameBlockIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sorted = [...right].sort();
  return [...left].sort().every((value, index) => value === sorted[index]);
}

/** 內容指紋（重用平台的 questionFingerprint：只涵蓋學生作答相關欄位，不含教材依據欄位） */
export function remappingContentFingerprint(question: Parameters<typeof questionFingerprint>[0]): string {
  return questionFingerprint(question);
}

/** 清單的內容雜湊（用於報告及記錄，方便確認套用的是同一份清單） */
export function manifestDigest(manifest: RemappingManifest): string {
  const payload = manifest.entries
    .map((entry) => `${entry.questionId}:${entry.blockIds.join(",")}:${entry.excerpt}`)
    .join("\n");
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * 依清單把題目的教材依據重新連結。
 *
 * 決定性：清單的次序即處理次序；每條獨立判斷，一條失敗不影響其他條目
 * （正式環境執行時應以回報的失敗清單決定是否繼續）。
 */
export function applyRemappingManifest(
  input: RemappingManifest,
  options: ApplyRemappingOptions = {},
): RemappingReport {
  const manifest = remappingManifestSchema.parse(input);
  const dryRun = options.dryRun ?? false;
  const distributable = options.requireOpenDocuments
    ? listStudentDistributableDocumentIds()
    : null;

  const results: RemappingEntryResult[] = [];

  /** 依檔名＋位置字串解析目標段落（跨資料庫；段落 ID 只在產生清單的資料庫有效） */
  const resolveByLocation = (topicId: string, documentFileName: string, sourceLocation: string) =>
    listBlocksByTopic(topicId).filter(
      (block) =>
        block.sourceLocation.trim() === sourceLocation.trim() &&
        block.sourceLocation.split("·")[0]!.trim() === documentFileName,
    );

  for (const entry of manifest.entries) {
    const fail = (reason: string) =>
      results.push({ questionId: entry.questionId, outcome: "failed", detail: reason });

    const question = getQuestion(entry.questionId);
    if (!question) {
      fail("找不到題目");
      continue;
    }
    if (
      question.topicId !== entry.topicId ||
      question.sectionId !== entry.sectionId ||
      question.questionType !== entry.questionType
    ) {
      fail(
        `題目的課題／分節／題型與清單不符（現為 ${question.topicId}／${question.sectionId}／${question.questionType}）`,
      );
      continue;
    }

    // 目標段落：先按清單記載的段落 ID（產生清單的資料庫），再按檔名＋位置（其他資料庫）
    const byId = getBlocksByIds(entry.blockIds);
    const resolvedById = byId.length === entry.blockIds.length;
    const resolvedTargets = resolvedById
      ? byId
      : resolveByLocation(entry.topicId, entry.documentFileName, entry.sourceLocation);
    if (resolvedTargets.length === 0) {
      fail(
        resolvedById
          ? "節錄不是清單所列段落的逐字內容（不做相似度判斷）"
          : `在以段落 ID 或位置（${entry.sourceLocation}）都找不到目標段落`,
      );
      continue;
    }
    // 以位置解析時，同一位置對應多個段落即屬歧義：不接受「任選一段」的寫法（fail closed）
    if (!resolvedById && resolvedTargets.length > 1) {
      fail(`來源位置在資料庫中對應多個段落（${resolvedTargets.length} 段，歧義），未套用`);
      continue;
    }
    const supporting = resolvedTargets.filter((block) => excerptAppearsInBlock(block, entry.excerpt));
    if (supporting.length === 0) {
      fail("節錄不是目標段落的逐字內容（不做相似度判斷）");
      continue;
    }
    if (!supporting.some((block) => block.sourceLocation.trim() === entry.sourceLocation.trim())) {
      fail("清單的來源位置與解析到的目標段落不符");
      continue;
    }
    if (
      resolvedTargets.some(
        (block) => block.sourceLocation.split("·")[0]!.trim() !== entry.documentFileName,
      )
    ) {
      fail("目標段落不屬於清單所列的教材文件");
      continue;
    }

    // 其他引用段落（如有）同樣以位置解析。清單可能同時把同一段落列為主要及相關段落
    // （產生清單時兩者都來自同一次核對），因此收集時要避免重複加入同一段落：重複的 ID
    // 會令 `getBlocksByIds` 的長度與 ID 數目不符，學生端會依 fail-closed 直接不顯示節錄。
    const targetBlocks: typeof resolvedTargets = [];
    const seenTargetIds = new Set<string>();
    const addTarget = (block: (typeof resolvedTargets)[number]) => {
      if (seenTargetIds.has(block.id)) return;
      seenTargetIds.add(block.id);
      targetBlocks.push(block);
    };
    for (const block of resolvedTargets) addTarget(block);

    let relatedFailure: string | null = null;
    for (const locator of entry.relatedBlockLocators) {
      const matches = resolveByLocation(entry.topicId, locator.documentFileName, locator.sourceLocation);
      if (matches.length === 0) {
        relatedFailure = `清單所述的其他引用段落找不到（${locator.sourceLocation}）`;
        break;
      }
      if (matches.length > 1) {
        relatedFailure = `清單所述的其他引用位置對應多個段落（${locator.sourceLocation}，歧義）`;
        break;
      }
      for (const block of matches) addTarget(block);
    }
    if (relatedFailure) {
      fail(relatedFailure);
      continue;
    }

    const targetBlockIds = targetBlocks.map((block) => block.id);
    if (distributable && targetBlocks.some((block) => !distributable.has(block.documentId))) {
      fail("目標段落所屬文件尚未開放給學生（--require-open）");
      continue;
    }

    const alreadyApplied =
      question.sourceExcerpt === entry.excerpt &&
      question.sourceLocation.trim() === entry.sourceLocation.trim() &&
      sameBlockIds(question.sourceBlockIds, targetBlockIds) &&
      question.sourceVerified;
    if (alreadyApplied) {
      results.push({
        questionId: entry.questionId,
        outcome: "already-applied",
        detail: `已連結至 ${targetBlockIds.join("、")}`,
      });
      continue;
    }

    // 內容指紋只在「即將改寫依據」時才有意義：已套用的條目不會寫入任何欄位，因此無需
    // 以指紋擋下（否則題目其後由教師或另一份清單更新用詞時，重複執行會誤報失敗）。
    if (questionFingerprint(question) !== entry.contentFingerprint) {
      fail("題目內容自核對後已改（內容指紋不符），未套用");
      continue;
    }

    // 確認題目仍在清單記載的套用前狀態（以節錄及來源位置判斷——段落 ID 屬個別資料庫，
    // 不用於跨資料庫的狀態比對）
    const stillExpectedPrevious =
      question.sourceExcerpt === entry.previous.excerpt &&
      question.sourceLocation.trim() === entry.previous.sourceLocation.trim();
    if (!stillExpectedPrevious) {
      fail("題目目前的教材依據與清單記載的套用前狀態不符（可能已由教師處理），未套用");
      continue;
    }

    if (dryRun) {
      results.push({
        questionId: entry.questionId,
        outcome: "planned",
        detail: `將連結至 ${targetBlockIds.join("、")}`,
      });
      continue;
    }

    updateQuestion(question.id, {
      ...question,
      sourceExcerpt: entry.excerpt,
      sourceLocation: entry.sourceLocation,
      sourceBlockIds: targetBlockIds,
      sourceVerified: true,
    });
    results.push({
      questionId: entry.questionId,
      outcome: "applied",
      detail: `連結至 ${targetBlockIds.join("、")}`,
    });
  }

  const count = (outcome: RemappingOutcome) =>
    results.filter((result) => result.outcome === outcome).length;
  return {
    results,
    applied: count("applied"),
    alreadyApplied: count("already-applied"),
    planned: count("planned"),
    failed: count("failed"),
  };
}
