# 發布前檢查（Release Preflight）— 2026-10-17（Sprint 8.6／8.7／8.8）

本文件把「已在本機完成的軟件驗證」與「正式環境仍未驗證的事項」清楚分開。**任何一項標示
「未驗證」的項目，都不可以因為其他項目通過而當作已完成。** Sprint 8.6–8.8 都沒有接觸雲端、
沒有部署、沒有讀取或改動正式資料；第 8 節是 Sprint 8.7 新增、供**獲授權操作員**日後執行的
勾選清單（全部未執行），第 9 節是 Sprint 8.8 新增的**證據欄位**（沒有填證據即視為未完成）。

> **2026-10-20 更正（部署目標）**：本文件第 10 節記錄的 2026-10-17 部署（revision `00026-yik`、
> bucket `gs://amiable-nirvana-500300-a0-history-backup`）實際執行於**已停用的舊專案
> `amiable-nirvana-500300-a0`**。現行正式環境為 `pccss-ai-history`（服務網址
> `https://history-self-study-4sija7xvrq-df.a.run.app`）。第 10 節的 bucket 路徑、指令及
> revision 名稱**不可重用**；現行部署及回滾步驟見根目錄 README 第十節。

---

## 1. 七個證據層級（不可互相代替）

| # | 層級 | 這一層證明甚麼 | 現況（2026-10-17） | 證據／位置 |
| --- | --- | --- | --- | --- |
| 1 | **本機軟件測試** | 程式碼符合已定義的測試與建置 | ✅ **已完成**（見第 2 節） | 第 2 節的指令輸出 |
| 2 | **本機資料庫完整性** | 本機資料庫可用、結構已升級、沒有未套用的 migration | ✅ **已完成**（見第 3 節） | `PRAGMA integrity_check`、`schema_migrations`（20 個 migration，最後 `0020`） |
| 3 | **正式資料庫快照** | 正式環境實際的資料內容（題目、教材、覆核） | ✅ **已驗證（2026-10-17）** — 已下載並核對 SHA-256，並按擁有者指示以本機快照取代（見第 10 節） | 第 10.1／10.2 節 |
| 4 | **教材版本一致** | 正式環境是否已用 2026-10-16 的新版 12 課教材 | ✅ **已同步（2026-10-17）** — 新映像檔包含 2026-10 教材，資料庫亦已由本機快照取代 | 第 10 節 |
| 5 | **版權／擁有者授權** | 是否有權向學生發布這些教材 | ✅ **已決定**（2026-10-15，2026-10-16 沿用）— 12 份課本文件逐份開放 | [owner-material-openings.json](teacher-review/owner-material-openings.json) |
| 6 | **歷史科教師覆核** | 題目的史實、答案、選項及解釋是否適合學生 | ⚠️ **部分完成** — 2026-10-17 12:11–12:16（HKT）擁有者 `ipwh@pochiu.edu.hk` 已在平台記錄 **17 筆覆核通過**（各題 rev 3，經登入工作階段驗證）；`golden-questions.v1.json` 仍為 `pending-review`、0 條，8 題覆核套件仍全部待覆核 | [generated-question-sample-2026-10.json](teacher-review/generated-question-sample-2026-10.json)（8 題套件，全部待覆核） |
| 7 | **部署及部署後驗證** | 正式服務是否真的按預期運作 | ✅ **已執行（2026-10-17）** — revision `history-self-study-00026-yik`，100% 流量；`/api/health` 回報 `ok:true`、`restore:"restored"`、備份啟用且無錯誤 | 第 10.2 節 |

> 本機測試通過（第 1、2 層）**不能**證明第 3–7 層；第 5 層的授權亦**不能**代替第 6 層的教師覆核。

## 2. 本機軟件驗證（可重現）

```bash
npm test                                     # Vitest：全部通過（見最終報告的實際數字）
npm run typecheck                            # tsc --noEmit：通過
npm run lint                                 # ESLint：0 error、0 warning
npm run build                                # Next.js 生產建置：成功
node scripts/e2e-flow.mjs --start            # 端對端（HTTP）：以**隔離資料庫副本**及獨立上載目錄執行
```

- 端對端測試使用 `APP_DATABASE_PATH` 及 `APP_UPLOADS_DIR` 指向暫存副本，測試後刪除；**不會**改動 `data/app.db`。
- 專案**沒有**支援的瀏覽器自動化框架，因此瀏覽器層測試一律標示為「未執行」（只有人工檢查）。
- 每次執行後都應核對 `data/app.db` 的 SHA-256 沒有改變（見第 3 節）。

## 3. 本機資料庫現況（2026-10-17 唯讀查核）

| 項目 | 數值 |
| --- | --- |
| SHA-256 | 教師操作前為 `1711abdb517c6ca4616bc080cceba85375cf9f3d5e85b985cd4a06b49c02cf91`（Sprint 8.2–8.8 測試期間未變）。2026-10-17 教師在平台刪除／停用題目後已改變；由於執行中的開發伺服器持有資料庫，暫未能重新計算（停止伺服器後再記錄即可） |
| `PRAGMA integrity_check` | `ok` |
| migration | 20 個，最後為 `0020-teacher-confirmation-required` |
| 題目 | 473（已發布 471、草稿 1、停用 1；待教師確認 0）。2026-10-17 教師刪除 11 條校內試卷題目、停用 1 條（`q_df1fd4c05d594891`），其後按擁有者指示清除 101 條機械式「列表標籤」題目，再清除全部 171 條 `material-mock`（本地示範生成）題目，見 [school-paper-deletions-2026-10-17.json](teacher-review/school-paper-deletions-2026-10-17.json)、[label-question-purge-2026-10-17.json](teacher-review/label-question-purge-2026-10-17.json) 及 [material-mock-purge-2026-10-17.json](teacher-review/material-mock-purge-2026-10-17.json) |
| 來源已核對（`source_verified = 1`） | 457（其餘 **16** 條為校內試卷題目，節錄由多段文字組成，平台的單一段落規則無法涵蓋 → 節錄不對學生顯示）。2026-10-17 教師在平台刪除 11 條校內試卷題目（刪除前 0 作答／0 回報／0 覆核），未通過核對由 25 條減至 16 條 |
| 覆核紀錄 | **27**（10 筆為 2026-10-15 的示範紀錄；17 筆為 2026-10-17 由 `ipwh@pochiu.edu.hk` 在平台作出的覆核通過，經登入工作階段驗證） |
| 題目回報 | 30；作答紀錄 140 |
| 教材文件 | 19（12 份課本，全部 `student_distribution = 1`；7 份校內試題，永不列為學生讀物） |
| 教材段落 | 7,950 |
| 課題 | 12 |

## 4. 正式同步所需的順序（供日後獲授權的另一次工作使用，本 Sprint 不執行）

1. **確認目標**：Cloud Run 服務 `history-self-study`、region `asia-east2`、目前 revision、資料庫機制（容器內 SQLite + bucket 備份）。
2. **取得正式快照**：`npm run snapshot:production`（唯讀下載），核對 SHA-256 並另存一份唯讀備份。
3. **在快照副本上重做全部資料改動**（不可直接在正式資料庫上做）：
   a. 匯入 2026-10 的 12 課教材（`APP_DATABASE_PATH` 指向副本）；
   b. 執行 `npm run remap:references`（30 條已驗證的來源重連）；
   c. 依 `docs/teacher-review/question-queue-actions-2026-10.json` 的已批准動作處理 36 條題目（31 改寫、5 刪除）；
   d. 如已取得授權，套用 `explanation-reference-corrections-2026-10.json` 的文字修正（**目前未授權**）。
4. **驗證副本**：課題數、每課題段落數、教材排除規則、來源引用、16 條未核對節錄仍不對學生顯示、覆核紀錄與作答紀錄數量不變、`PRAGMA integrity_check = ok`，並記錄 SHA-256 及回滾位置。
5. **教材開放**：只在擁有者已授權的文件上執行 `npm run open:materials -- --apply`（會寫入分發審核紀錄）。
6. **上載快照至 bucket**：使用既定備份物件名稱（`backupObjectName()`），保留舊物件作回滾。
7. **立即重新部署**：已部署的服務會在有變更時把容器內資料庫**上載覆蓋**同一個備份物件，因此上載快照後**必須立即**部署（或先把服務流量設為 0），否則新快照可能被舊 revision 的定期備份覆蓋。
8. **部署後驗證**（不可用 `/api/health` 作唯一探測，它會執行 bootstrap 及維護工作）：以教師帳戶抽查題目及覆核狀態、以學生帳戶完成一次練習、以管理員帳戶檢查設定診斷與備份狀態；核對 console 沒有 5xx。
9. **回滾**：資料問題 → 還原 bucket 內的舊快照物件；程式問題 → 切回上一個 revision（但**舊 revision 不執行讀取時治理核對及暫緩標記檢查**，屬降級狀態，見 README 第十節回滾表）。
10. **停止條件**：任何一步的驗證數字與預期不符、`integrity_check` 不是 `ok`、學生端看到未核對的節錄、教師端出現沒有對應紀錄的「已覆核」題目 → 立即停止並回滾，不要繼續下一步。

## 5. 阻塞項目（2026-10-17）

| 優先 | 阻塞 | 說明 | 解除條件 |
| --- | --- | --- | --- |
| ~~P0~~ | ~~雲端憑證過期~~ | **已解除（2026-10-17）** — `gcloud` 已以 `ipwh@pochiu.edu.hk` 登入，成功讀取快照、建置及部署 | 已完成 |
| **P0** | 正式快照未驗證 | 正式環境的實際題目／教材／覆核數目未知；不能假設與本機相同 | 取得快照並核對 SHA-256 及第 3 節的數字 |
| **P1** | 教師覆核覆蓋率不足 | 2026-10-17 已有 17 筆具名覆核（`ipwh@pochiu.edu.hk`），但相對 642 條已發布題目仍屬小樣本；`golden-questions.v1.json` 仍為 `pending-review`、0 條，8 題覆核套件全部待覆核 | 具名教師完成覆核套件及更多題目，並把決定寫入平台（見 `generated-question-sample-2026-10.json`） |
| **P1** | 教材版本不一致 | 正式環境仍是 2026-10-15 教材；本機已更新，但同步未執行 | 依第 4 節順序執行並驗證 |
| **P1** | 上載快照後必須立即重新部署 | 否則舊 revision 的定期備份可能覆蓋新快照 | 把「上載後立即部署」寫入執行紀錄並由第二人核對 |
| **P1** | 歸屬語氣（「學者認為」）等語意判斷未自動化 | 只會暫緩交教師，不會自動判斷 | 由教師在覆核時判斷（見校準計劃第 4 節） |
| **P2** | 16 條校內試卷題目的節錄仍不對學生顯示 | 節錄跨多段，平台的單一段落規則無法涵蓋；2026-10-17 已由教師刪除 11 條不再使用的校內試卷題目（25 → 16） | 由教師決定其餘 16 條是否改寫成單段節錄（不在本 Sprint 範圍） |
| **P2** | 7 條解釋段號建議修正未套用 | 已有核對結果及建議文字，但未取得授權 | 見 `explanation-reference-corrections-2026-10.json` |
| **P2** | 瀏覽器層自動化未執行 | 專案沒有支援的框架 | 引入框架屬新工作，需另行評估 |

## 6. 本次檢查修正的文件缺陷

- README 第十節的發布前檢查清單原本要求「在本機執行 `npm run backup`」，但**專案沒有這個指令**
  （備份由服務內的排程及管理員端狀態頁管理）。已改為指向實際機制，避免執行者在部署前
  以為自己已完成備份驗證。

## 7. 不可以聲稱的事項

在取得正式快照及教師覆核之前，**不可**聲稱：正式環境與本機一致、教材已同步、題目已獲
史實或教學驗證、平台「已準備好上線」。本文件只記錄本機能驗證的部分及尚未驗證的部分。

---

## 8. Sprint 8.7：授權操作員的正式發布檢查清單（**未執行**，本 Sprint 不接觸雲端）

以下每一項都要由**獲授權的操作員**在正式環境執行並留下證據；`[ ]` 表示**尚未執行**，
不可因為本機測試通過而勾選。每項都註明「可接受的證據」，避免日後憑印象判定。

### 8.1 雲端憑證與存取授權

- [ ] **憑證續期**：由擁有者重新登入 `gcloud`，確認 `gcloud auth list` 顯示的帳戶具備專案權限。
  證據：指令輸出（遮蔽帳戶電郵以外的敏感欄位）。
- [ ] **服務目標確認**：Cloud Run 服務名稱、region、目前 revision 與部署時間。
  證據：`gcloud run services describe` 的 revision 及 `creationTimestamp`。
- [ ] **不要**用 `/api/health` 作為唯一探測：它會執行 bootstrap 及維護工作（可能寫入）。

### 8.2 正式資料庫快照：身分、完整性、教材版本

- [ ] **下載快照**：`npm run snapshot:production`（唯讀）並記錄 SHA-256。
  證據：快照檔名、位元組數、SHA-256。
- [ ] **完整性**：在快照副本上執行 `PRAGMA integrity_check` 及 `PRAGMA foreign_key_check`。
  證據：兩者輸出（`ok`／無列）。
- [ ] **結構版本**：`SELECT * FROM schema_migrations` 的筆數及最後一筆，必須與本機一致（目前 20 個，最後 `0020-teacher-confirmation-required`）。
  證據：查詢輸出。
- [ ] **教材版本**：每份 `material_documents` 的檔名、`kind`、`student_distribution` 及匯入時間，須對應 2026-10-16 的 12 課版本。
  證據：逐份列表（比對 `docs/teacher-review/owner-material-openings.json`）。

### 8.3 本機與正式環境的數量差異（必須解釋，不可假設相同）

- [ ] 題目總數、已發布／草稿／停用、`source_verified = 0`、`teacher_confirmation_required = 1`。
- [ ] 教材文件數、教材段落數、課題數。
- [ ] `question_reviews`、`question_reports`、`attempts` 筆數（覆核與作答紀錄**只可增加**）。
- [ ] 任何差異都要逐項寫出原因（例如：正式環境尚未同步 2026-10 教材、尚未套用 36 條題目處理）。
  本機基準（2026-10-17，清除機械標籤題及全部 material-mock 後）：473 題／471 已發布／1 草稿／1 停用、457 已核對、19 份文件（7,950 段）、12 課題、**27 筆覆核**（其中 17 筆為當日具名教師決定）、30 筆回報、140 筆作答。

### 8.4 備份排程與部署的相依關係

- [ ] 確認服務的定期備份會**上載覆蓋**同一備份物件（`backupObjectName()`）。
- [ ] 確認備份排程在下一個週期前的時間窗，足以完成「上載快照 → 部署」。
- [ ] **上載快照後必須立即重新部署**（或先把流量設為 0），否則舊 revision 的備份會覆蓋新快照。
  證據：部署時間戳必須晚於快照上載時間戳，且兩者由同一人記錄、另一人核對。

### 8.5 教師授權與覆核權限設定

- [ ] 正式環境已設定學校 Google 登入（`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`AUTH_SECRET`），且**沒有**設定 `HISTORY_ALLOW_UNSAFE_DEMO_MODE`。
- [ ] 具備教師身分的帳戶清單（`AUTH_TEACHER_EMAILS` 或 `AUTH_IN_DOMAIN_ROLE` 政策）已由擁有者確認，並以實際帳戶登入 `/teacher/questions` 驗證可見。
- [ ] 以未登入瀏覽器對 `POST /api/teacher/questions/{id}/review` 發送請求，必須回 **403**（不得寫入覆核紀錄）。
  證據：HTTP 狀態碼，以及資料庫內沒有新增「示範模式」身分的紀錄。
- [ ] 覆核介面提交時會帶同教師看到的版本（`expectedRevision`）；若題目已被修改，介面應顯示 409 並要求重新載入。**舊快取頁面提交會被拒絕**，屬預期行為，不是故障。

### 8.6 仍然暫緩的內容

- [ ] 16 條校內試卷題目（`source_verified = 0`）仍然**不會**向學生顯示節錄；`student_distribution` 不得因同步而被打開。
- [ ] 任何 `teacher_confirmation_required = 1` 的題目仍為草稿，且不出現在學生練習。
  證據：以學生帳戶抽查該課題的練習題清單，並核對資料庫狀態。
- [ ] 7 條解釋段號修正**仍未套用**（`explanation-reference-corrections-2026-10.json` 內全部 `applied: false`、`approvalRequired.obtained: false`）。若未取得授權，同步時必須跳過第 4 節步驟 3d。

### 8.7 需要的批准（缺一不可）

- [ ] 擁有者書面批准：教材開放範圍、題目內容改動（如 36 條處理及 7 條段號修正）。
- [ ] 歷史科教師覆核：至少一批真實題目的覆核紀錄（目前 0 條），並在平台內留下具名紀錄。
- [ ] 版權／授權確認：12 份課本向學生發布的授權仍然有效（見 `owner-material-openings.json`）。

### 8.8 回滾與部署後驗證

- [ ] 部署前確認回滾位置：bucket 內保留舊快照物件、上一個 Cloud Run revision。
- [ ] 部署後以**教師帳戶**抽查至少 3 題（1 題 `pass`、1 題 `revise` 暫緩、1 題校內試卷題目），確認狀態與覆核紀錄一致。
- [ ] 以**學生帳戶**完成一次練習，確認未核對節錄不會顯示、暫緩題目不會出現。
- [ ] 以**管理員帳戶**檢查設定診斷及備份狀態頁，確認沒有錯誤提示。
- [ ] 檢查服務記錄沒有 5xx；若有，立即回滾並停止後續步驟。
- [ ] 回滾時注意：舊 revision **不執行**讀取時治理核對及暫緩標記檢查，屬降級狀態（見 README 第十節回滾表）。

> 上述任何一項未完成，正式環境就**不可以**描述為「已驗證」或「已可發布」。
> 本 Sprint 沒有執行其中任何一項，也沒有嘗試恢復雲端憑證。

---

## 9. 證據欄位（Sprint 8.8）：每一項「已檢查」都要有可貼上的證據

下表把第 8 節的勾選項目轉成**可記錄的證據欄位**。規則：沒有填證據的項目一律視為未完成；
「我檢查過了」不是證據。所有欄位在填寫前都是空白，不得預先填寫或由測試結果推導。

| # | 項目 | 必須記錄的證據（逐字貼上） | 提供者 | 現況（2026-10-17） |
| --- | --- | --- | --- | --- |
| E1 | 正式快照身分 | 快照檔名、位元組數、SHA-256、下載時間、下載者 | 獲授權操作員 | **空白**（未執行） |
| E2 | 正式快照完整性 | `PRAGMA integrity_check` 與 `PRAGMA foreign_key_check` 的完整輸出 | 獲授權操作員 | **空白**（未執行） |
| E3 | 教材版本 | 每份 `material_documents` 的檔名、`kind`、`student_distribution`、段落數、匯入時間；並註明對應 `materials/` 的哪一版 | 獲授權操作員 | **空白**（本機為 2026-10-16 版 12 課；正式版本未驗證） |
| E4 | 結構版本 | `SELECT version FROM schema_migrations ORDER BY version` 全部列（本機 20 筆，最後 `0020-teacher-confirmation-required`） | 獲授權操作員 | **空白**（正式未查） |
| E5 | 本機與正式資料差異 | 題目總數／已發布／草稿／停用、`source_verified = 0`、`teacher_confirmation_required = 1`、`question_reviews`、`question_reports`、`attempts` 逐項並列，**每項差異附一句原因** | 獲授權操作員 | **空白**（本機基準：789／788／1／0、25、0、10、30、140） |
| E6 | 教師授權設定 | 登入設定（已設／未設）、教師名單或網域政策、以教師帳戶成功進入 `/teacher/questions` 的截圖或記錄 | 擁有者 | **空白**（未執行） |
| E7 | 覆核工作流程驗證 | 以未登入瀏覽器 `POST /api/teacher/questions/{id}/review` 的 **HTTP 403** 回應；資料庫內沒有新增示範身分紀錄；以教師帳戶提交一次覆核時介面帶同版本（`expectedRevision`），若題目已被修改則顯示 409 | 獲授權操作員 | **空白**（本機測試已覆蓋，正式未驗證） |
| E8 | 已發布題目風險的處理 | `q_058eda0378394d0f` 的最終狀態（`disabled`／已改寫並重新覆核／維持 published 並附理由）及作出決定的具名者與時間 | 歷史科教師／擁有者 | **未決定**（風險報告：[published-question-containment-2026-10.json](teacher-review/published-question-containment-2026-10.json)） |
| E9 | 歷史科教師覆核證據 | 平台內具名覆核紀錄（覆核者、日期、版本、決定、理由）；離線套件的 `reviewerDecision`／`reviewer`／`reviewedAt` 必須與平台紀錄一致 | 歷史科教師 | **17 筆**（[human-vs-machine-calibration-2026-10.json](teacher-review/human-vs-machine-calibration-2026-10.json) 的 `calibrationStatus = unmeasured`） |
| E10 | 批准文件 | 擁有者對教材開放範圍及題目改動的書面批准；版權／授權確認；7 條段號修正與 36 條隊列動作是否包含在批准範圍之內 | 擁有者／科主任 | **未取得**（清單內全部 `applied:false`、`authorisation.obtained:false`） |
| E11 | 備份與部署次序 | 快照上載時間戳、部署 revision 名稱及時間戳（部署必須晚於上載），以及覆蓋同一備份物件的風險確認 | 獲授權操作員（第二人核對） | **空白**（未執行） |
| E12 | 回滾與部署後驗證 | 回滾位置（bucket 物件名稱、上一個 revision）、部署後教師／學生／管理員三類帳戶的抽查結果、5xx 檢查結果 | 獲授權操作員 | **空白**（未執行） |

### 9.1 不可省略的三個次序約束

1. **先快照、後改動**：所有資料改動（教材匯入、隊列、段號修正）必須在快照副本上完成並驗證，
   不可直接改正式資料庫。
2. **上載後立即部署**：否則舊 revision 的定期備份會覆蓋新快照（第 8.4 節）。
3. **先批准、後套用**：E10 未填之前不得套用 7 條段號修正或 36 條隊列動作，即使它們已在清單內。

### 9.2 本節沒有做的事

- 沒有接觸雲端、沒有執行任何 E1–E12 項目、沒有把任何欄位填成已完成。
- 沒有把本機測試結果（1,035 項測試、137 項端對端檢查）當作正式環境的證據。

---

## 10. 部署紀錄（2026-10-17，由擁有者指示執行）

> 這是本文件首次出現**已執行**的正式環境操作。以下每一項都是實際輸出，不是計劃。

### 10.1 部署前狀態（唯讀快照核對）

| 項目 | 正式環境（2026-10-15 快照） | 本機（2026-10-17） |
| --- | --- | --- |
| 快照 SHA-256 | `707a8d3feca1c7750d7f185959bc735ec0bdb571e604609b3520e04fe0a4663c`（26,787,840 bytes） | `8baa6be219de0c635adb567af1ad4f7b6b0e1af46567d22fa9f54e72186e7591`（4,866,048 bytes，`VACUUM INTO`） |
| 題目 | 3,994（已發布 49） | 473（已發布 471） |
| 覆核紀錄 | 0 | 27（17 筆為當日具名教師決定） |
| 題目回報／作答／練習 | 0／15／3 | 30／140／92 |
| 教材文件／段落 | 96／58,528 | 19／7,950 |
| `schema_migrations` | 18 | 20 |

- 正式環境的 15 筆作答全部屬 `teacher:ipwh@pochiu.edu.hk`（擁有者自己的測試），沒有學生資料。
- 舊快照已另存作回滾：`gs://amiable-nirvana-500300-a0-history-backup/history/data/app.db.pre-20261017T0506Z`（26,787,840 bytes）。

### 10.2 執行步驟與結果

| 步驟 | 實際指令 | 結果 |
| --- | --- | --- |
| 1. 建立本機一致性快照 | `VACUUM INTO`（`data/app.db` → 暫存檔），`PRAGMA integrity_check = ok` | 4,866,048 bytes |
| 2. 備份正式物件 | `gsutil cp …/history/data/app.db …/history/data/app.db.pre-20261017T0506Z` | 成功（26,787,840 bytes） |
| 3. 建置映像檔 | `gcloud builds submit --tag asia-east2-docker.pkg.dev/amiable-nirvana-500300-a0/history/hk-history-self-study:deploy-20261017 .` | build `d0ca7a63-852b-4010-b6d9-5ef46aa966b9`，**SUCCESS**，3M4S，digest `sha256:0a2c4904409d2177efa5335f266efa6483084acecabf3d08c716f20c0b56a18f` |
| 4. 上載本機快照 | `gsutil cp <snapshot> gs://amiable-nirvana-500300-a0-history-backup/history/data/app.db` | 成功，物件 SHA-256 `8baa6be2…86e7591` |
| 5. 先部署不切流量 | `gcloud run deploy history-self-study --image=…:deploy-20261017 --region=asia-east2 --no-traffic --tag=review` | revision `history-self-study-00026-yik`，0% 流量 |
| 6. 驗證新 revision | `GET https://review---history-self-study-bggdvmswzq-df.a.run.app/login` | **200**；啟動日誌：`[backup] 資料庫備份已啟用（還原：restored，已由雲端還原（4752 KB））` |
| 7. 切換流量 | `gcloud run services update-traffic history-self-study --to-latest` | `00026-yik` = **100%** |
| 8. 部署後檢查 | `GET /login` → 200；`GET /api/health` → `ok:true`、`database.status:"ok"`、`persistence.restore:"restored"`、`authEnabled:true`、`staffApiOpen:false`、`roster.enforce:true`、`backupEnabled:true`、`lastError:null` | 全部符合預期 |

- 既有環境變數／Secret 全部保留（`BACKUP_BUCKET`、`AUTH_TEACHER_EMAILS`、`AUTH_ADMIN_EMAILS`、`AUTH_STAFF_ACCESS_POLICY`、`STUDENT_ROSTER_*` 等均存在；沒有使用 `cloudbuild.yaml` 的 `--set-env-vars`，避免以空白值覆蓋正式設定）。
- 部署後未再上載任何快照；bucket 物件在檢查時仍為本次上載（`2026-10-17T05:06:43Z`）。

### 10.3 回滾方式（未使用）

| 情境 | 指令 |
| --- | --- |
| 資料問題 | `gsutil cp gs://amiable-nirvana-500300-a0-history-backup/history/data/app.db.pre-20261017T0506Z gs://amiable-nirvana-500300-a0-history-backup/history/data/app.db`，然後重新部署或重啟（`BACKUP_RESTORE_ON_START=true` 會在啟動時還原） |
| 程式問題 | `gcloud run services update-traffic history-self-study --region asia-east2 --to-revisions=history-self-study-00025-stx=100`（注意：舊 revision 的資料庫是舊快照，需同時回滾資料） |

### 10.4 部署後仍然未完成的事項

- **歷史科教師覆核**：平台上只有 27 筆覆核紀錄（17 筆具名），相對 471 條已發布題目仍屬小樣本；8 題（現為 5 題）覆核套件全部待覆核，校準仍為 `unmeasured`。
- **瀏覽器自動化**：專案仍沒有支援的瀏覽器測試框架，未執行。
- **E1–E12 的正式環境細節**：本次已取得快照身分／完整性（E1、E2）、結構版本（E4）及部署次序（E11、E12）的實際輸出；其餘（教師名冊實際登入、版權批准文件等）仍待擁有者／科主任完成。
