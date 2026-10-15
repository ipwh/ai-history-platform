/**
 * Next.js 啟動掛勾（每個伺服器實例只執行一次）。
 *
 * 用途：把資料庫由 Cloud Storage 還原（容器重建後仍保留題庫、教材及學生記錄）、
 * 啟動定期備份，並執行定期維護（資料保留期清理，見 server/services/maintenance.ts）。
 * 未設定 BACKUP_BUCKET 時備份完全不會啟用，本機開發不受影響。
 *
 * 注意：`register()` 必須完成後伺服器才會開始處理請求，因此還原會在資料庫
 * 首次被開啟之前發生（getDb 於第一個請求時才建立連線），維護則在還原之後執行。
 */
/** 啟動掛勾（每個伺服器實例只執行一次）。 */
export async function register(): Promise<void> {
  // Edge runtime 不支援 node:fs / node:sqlite，只在 Node.js runtime 執行
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { restoreOnStartup, startBackupScheduler, getBackupStatus } = await import(
      "./server/db/backup"
    );
    await restoreOnStartup();
    startBackupScheduler();
    const status = getBackupStatus();
    if (status.enabled) {
      console.log(
        `[backup] 資料庫備份已啟用（還原：${status.restore}${status.restoreMessage ? `，${status.restoreMessage}` : ""}）`,
      );
    }
  } catch (error) {
    // 備份失敗不應阻止服務啟動：網站仍可使用，只是資料不會跨部署保留
    console.warn("[backup] 初始化失敗：", error instanceof Error ? error.message : error);
  }

  // 定期維護（資料保留期清理）：在啟動時強制執行一次，令保留期有明確的執行保證，
  // 而不只是「剛好有請求時才順帶清理」。還原資料庫之後才執行，確保作用於正式資料。
  try {
    const { runMaintenance } = await import("./server/services/maintenance");
    const result = runMaintenance("ai-operation-retention", { force: true });
    if (result.error !== null) {
      console.error(`[maintenance] 保留期清理失敗：${result.error}`);
    } else if (result.executed) {
      console.log(`[maintenance] 保留期清理完成，刪除 ${result.deleted} 筆用量記錄`);
    }
  } catch (error) {
    // 維護失敗不應阻止服務啟動（使用者仍可正常使用平台）
    console.error(
      "[maintenance] 啟動維護未執行：",
      error instanceof Error ? error.message : error,
    );
  }
}
