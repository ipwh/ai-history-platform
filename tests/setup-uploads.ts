/**
 * Vitest `setupFiles`：把所有測試的上載目錄指向暫存資料夾。
 *
 * 匯入教材的測試會經儲存層把教材副本寫入上載目錄，而測試檔只設定 `APP_DATABASE_PATH`；
 * 若沿用預設的 `APP_UPLOADS_DIR`，副本就會寫進專案的 `data/uploads`，在測試資料庫被
 * 丟棄後成為孤立檔案（原因、實測數字及安全規則見 `tests/test-uploads.ts`）。
 *
 * 這裡在每個測試檔載入前指定暫存上載資料夾（因此測試檔讀取設定時已生效），並在該測試檔
 * 結束後刪除。個別測試若自行指定 `APP_UPLOADS_DIR`（例如 `tests/storage-and-config.test.ts`
 * 使用自己的 tempRoot），仍以測試檔的設定為準。
 */
import { afterAll } from "vitest";

import { freshTestUploadsDir, removeTestUploadsDir } from "./test-uploads";

const uploadsDir = freshTestUploadsDir();
process.env.APP_UPLOADS_DIR = uploadsDir;

afterAll(() => {
  removeTestUploadsDir(uploadsDir);
});
