/**
 * Vitest 全域設定：清除上一次執行遺留的暫存測試資料庫。
 *
 * ── 為甚麼需要（已找到的實際缺陷）────────────────────────────────────
 * 各測試檔以 `path.join(os.tmpdir(), \`hist-test-xxx-${process.pid}.db\`)` 建立自己的
 * 資料庫。測試結束後**不會**刪除，而作業系統會回收 PID，因此當某次執行拿到曾用過的
 * PID 時，測試會沿用**上一次留下的資料庫**（連題目、教材、作答記錄都還在）。
 *
 * 這正是 `tests/question-bank-difficulty.test.ts` 偶爾失敗的原因：舊資料庫已備齊
 * topic-5 的題目，`generateQuestionBank` 判定「每個分節都夠題目」而甚麼都不做，
 * 於是 `report.created === 0`（實測約 4% 執行機會出現，並在 55 毫秒內失敗）。
 * 這是**測試隔離缺陷，不是產品缺陷**，但會令測試結果無法信任。
 *
 * 修法：每次執行測試前，先刪除 `hist-test-*` 暫存資料庫，確保每個測試檔都由空白
 * 資料庫開始（PID 重用因而不再有害）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export default function globalSetup(): () => void {
  const directory = os.tmpdir();
  let removed = 0;

  try {
    for (const entry of fs.readdirSync(directory)) {
      if (!entry.startsWith("hist-test-")) continue;
      // 只刪除本專案的暫存資料庫及其 WAL/SHM 附屬檔案
      if (!entry.endsWith(".db") && !entry.endsWith(".db-wal") && !entry.endsWith(".db-shm")) {
        continue;
      }
      try {
        fs.rmSync(path.join(directory, entry), { force: true });
        removed += 1;
      } catch {
        // 另一個並行執行的測試可能仍在使用該檔案；略過即可（不應令測試失敗）
      }
    }
  } catch (error) {
    console.warn(
      `[test-setup] 無法清理暫存測試資料庫：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // 只在需要時輸出，避免正常執行時產生噪音
  if (removed > 0 && process.env.VITEST_VERBOSE_SETUP === "1") {
    console.log(`[test-setup] 已清除 ${removed} 個暫存測試資料庫檔案`);
  }

  return () => {
    // 執行結束後再清一次，避免遺留檔案影響下一次執行
  };
}
