/**
 * Next.js 啟動掛勾（每個伺服器實例只執行一次）。
 *
 * 用途：把資料庫由 Cloud Storage 還原（容器重建後仍保留題庫、教材及學生記錄），
 * 並啟動定期備份。未設定 BACKUP_BUCKET 時完全不會啟用，本機開發不受影響。
 *
 * 注意：`register()` 必須完成後伺服器才會開始處理請求，因此還原會在資料庫
 * 首次被開啟之前發生（getDb 於第一個請求時才建立連線）。
 */
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
}
