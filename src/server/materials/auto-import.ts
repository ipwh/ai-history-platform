/**
 * 啟動時自動匯入映像檔內的教材（2026-10-21）。
 *
 * 背景：教材檔（`materials/`）會隨 Docker 映像檔一併部署，但**匯入**是把檔案內容寫進
 * 資料庫的另一步。正式環境的資料庫是全新／由舊備份還原的空教材狀態，因此部署後
 * 學生端每個課題都顯示「尚未匯入教材」，而唯一補救方法是在瀏覽器按「匯入全部課程教材」
 * ——對只有一般電腦技能的老師並不合理，而且每次重建容器都要重做。
 *
 * 這裡把該步自動化：容器啟動後（資料庫已還原）若**資料庫內完全沒有教材**，
 * 便把映像檔內的教材匯入一次。設計要點：
 *   1. **只在沒有教材時執行**：已匯入過的資料庫不會被覆寫（使用者上載的教材亦不會被刪）。
 *   2. **不阻塞啟動**：背景執行，`/api/health` 會回報進度；匯入期間網站仍可使用題庫題目。
 *   3. **如實回報**：結果（成功／失敗數量、錯誤原因）寫入狀態，不假裝成功。
 *   4. 匯入後依 `MATERIAL_AUTO_OPEN_POLICY` 自動開放課文／筆記（見 material-distribution.ts）。
 */
import { getServerConfig } from "../config";
import { collectMaterialFiles } from "../materials/material-files";
import { isRetiredQuestionBankFileName } from "../materials/question-bank";
import { listDocuments } from "../repositories/materials";
import { importMaterialFromDisk } from "../services/material-service";
import { autoOpenAllLessonDocuments } from "../services/material-distribution";

export interface MaterialsAutoImportStatus {
  /** 是否已嘗試（避免重複執行） */
  attempted: boolean;
  /** 目前狀態：執行中／完成／略過／失敗 */
  state: "idle" | "running" | "done" | "skipped" | "failed";
  /** 略過或失敗的原因（成功時為 null） */
  message: string | null;
  documents: number;
  ready: number;
  failed: number;
  /** 依政策自動開放的課文數 */
  openedForStudents: number;
  startedAt: string | null;
  finishedAt: string | null;
}

let status: MaterialsAutoImportStatus = {
  attempted: false,
  state: "idle",
  message: null,
  documents: 0,
  ready: 0,
  failed: 0,
  openedForStudents: 0,
  startedAt: null,
  finishedAt: null,
};

let running: Promise<MaterialsAutoImportStatus> | null = null;

export function materialsAutoImportStatus(): MaterialsAutoImportStatus {
  return { ...status };
}

/**
 * 若資料庫內沒有教材，就把映像檔內的教材匯入一次。
 *
 * 可安全地重複呼叫：第一次之後直接回傳既有狀態，不會重複匯入。
 */
export function ensureMaterialsImported(): Promise<MaterialsAutoImportStatus> {
  if (running) return running;
  if (status.attempted) return Promise.resolve(materialsAutoImportStatus());

  status = {
    ...status,
    attempted: true,
    state: "running",
    startedAt: new Date().toISOString(),
  };

  running = (async () => {
    const { materialsDir } = getServerConfig();

    // 已有教材：不覆寫（保留使用者在瀏覽器上載／匯入的版本）
    if (listDocuments().length > 0) {
      status = {
        ...status,
        state: "skipped",
        message: "資料庫內已有教材，因此沒有自動匯入（不會覆寫既有教材）。",
        finishedAt: new Date().toISOString(),
      };
      return materialsAutoImportStatus();
    }

    const files = collectMaterialFiles(materialsDir).filter(
      (entry) => !isRetiredQuestionBankFileName(entry.relativePath),
    );
    if (files.length === 0) {
      status = {
        ...status,
        state: "skipped",
        message:
          "映像檔內沒有教材檔案（materials 資料夾只有說明檔），因此沒有可匯入的內容。" +
          "請確認部署時 materials/ 已包含教材，或由管理員上載教材。",
        finishedAt: new Date().toISOString(),
      };
      return materialsAutoImportStatus();
    }

    let ready = 0;
    let failed = 0;
    const failureNotes: string[] = [];
    for (const entry of files) {
      try {
        const result = await importMaterialFromDisk(entry.relativePath, { runOcr: false });
        if (result && result.outcome.document.status === "ready") ready += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        failureNotes.push(
          `${entry.fileName}：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // 依政策自動開放（校內試題檔及教師版材料不會被開放）
    const openResult = autoOpenAllLessonDocuments();

    status = {
      ...status,
      state: failed === 0 ? "done" : "failed",
      message:
        failed === 0
          ? null
          : `${failed} 份教材匯入失敗：${failureNotes.slice(0, 3).join("；")}`,
      documents: files.length,
      ready,
      failed,
      openedForStudents: openResult.opened + openResult.alreadyOpen,
      finishedAt: new Date().toISOString(),
    };
    console.log(
      `[materials] 自動匯入完成：成功 ${ready}、失敗 ${failed}、已開放給學生 ${status.openedForStudents} 份`,
    );
    return materialsAutoImportStatus();
  })()
    .catch((error: unknown) => {
      status = {
        ...status,
        state: "failed",
        message: `自動匯入教材時發生未預期的錯誤：${error instanceof Error ? error.message : String(error)}`,
        finishedAt: new Date().toISOString(),
      };
      console.error("[materials] 自動匯入失敗：", error);
      return materialsAutoImportStatus();
    })
    .finally(() => {
      running = null;
    });

  return running;
}
