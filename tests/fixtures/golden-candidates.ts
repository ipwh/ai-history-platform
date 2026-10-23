/**
 * 測試用的 Golden 候選清單（合成，不涉及真實教材或試題內容）。
 *
 * ── 為甚麼需要 ────────────────────────────────────────────────────────
 * `docs/teacher-review/golden-candidates-*.json` 是由 `npm run golden:candidates` 從資料庫
 * 產生的檔案，內含完整題幹／答案／原文段落，依版權政策**不納入版本控制**。因此乾淨
 * checkout 的 CI 沒有這個檔案，令 golden 相關的 API、CLI 及稽核腳本全部失敗
 * （GitHub Actions run 39885612625：golden-approval 500、golden:export exit 2、
 * review-queue 沒有 total）。
 *
 * 這些測試驗證的是**流程契約**（候選 → 裁決 → fixture、唯讀保證、fail-closed），
 * 不是真實候選清單的內容，因此改為在暫存目錄寫出一份合成清單，並以
 * `GOLDEN_CANDIDATES_FILE` 指向它（見 `src/server/services/golden-approval.ts`）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 本套件使用的暫存候選清單檔名前綴 */
export const TEST_GOLDEN_CANDIDATES_PREFIX = "hist-test-golden-candidates-";

/**
 * 寫出合成候選清單並令 `GOLDEN_CANDIDATES_FILE` 指向它。
 *
 * `items` 必須符合 `GoldenCandidate` 的形狀（見 `listGoldenCandidateViews`）。
 * 每次呼叫會覆寫同一個檔案，因此同一測試檔內可在 `beforeEach` 更新內容。
 */
export function writeGoldenCandidatesFile(items: unknown[]): string {
  const file = path.join(os.tmpdir(), `${TEST_GOLDEN_CANDIDATES_PREFIX}${process.pid}.json`);
  // 防線：路徑必須留在作業系統暫存目錄內
  if (path.resolve(path.dirname(file)) !== path.resolve(os.tmpdir())) {
    throw new Error(`測試候選清單不在暫存目錄內：${file}`);
  }
  const payload = {
    notice: "合成測試候選清單：只供測試流程使用，不含真實教材內容。",
    groups: [{ group: "test", items }],
  };
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.env.GOLDEN_CANDIDATES_FILE = file;
  return file;
}

/** 產生指定數量、指向不存在題目的合成候選（用於 fail-closed 契約） */
export function syntheticCandidates(count: number, prefix = "synthetic-golden"): unknown[] {
  return Array.from({ length: count }, (_unused, index) => ({
    questionId: `${prefix}-${index + 1}`,
    questionRevision: 1,
    questionFingerprint: "0".repeat(64),
    stem: `合成候選題幹 ${index + 1}`,
    options: ["選項甲", "選項乙", "選項丙", "選項丁"],
    correctAnswer: "選項甲",
    acceptedAnswers: [],
    explanation: "合成候選解釋",
    servable: true,
    selectionReason: "合成測試候選",
    evidence: {
      sourceExcerpt: "合成候選節錄",
      sourceLocation: "合成候選位置",
      sourceBlockIds: [],
      hasTraceableDocument: false,
    },
  }));
}

/** 刪除本程序的暫存候選清單（失敗不拋出） */
export function removeGoldenCandidatesFile(): void {
  const file = path.join(os.tmpdir(), `${TEST_GOLDEN_CANDIDATES_PREFIX}${process.pid}.json`);
  if (path.resolve(path.dirname(file)) !== path.resolve(os.tmpdir())) return;
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // 清理失敗不應令測試失敗
  }
}
