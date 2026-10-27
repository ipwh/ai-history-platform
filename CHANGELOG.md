# 變更記錄（CHANGELOG）

本檔記錄本平台（`hk-history-self-study`）的產品及行為變更，格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，但**不**引入語意化版本標籤：專案目前沒有 git tag，版本號沿用 [package.json](package.json) 的 `version`，實際部署以 Cloud Run revision 為準（見 README 第十節）。

分類說明：

| 分類 | 意思 |
| --- | --- |
| 新增 | 新功能、新端點、新頁面、新資料表 |
| 變更 | 既有行為或介面文字改變（包括配額語意） |
| 修正 | 修正缺陷（會說明根因及迴歸測試） |
| 安全 | 權限、防外洩、防繞過等與安全性相關的改動 |
| 資料庫 | migration 編號及影響；**已套用**與**只寫入程式碼**會分開說明 |

> **本檔的起點**：專案在 2026-10-26 之前沒有變更記錄檔。為了不憑記憶補寫歷史（那會變成不可核實的聲明），本檔由 2026-10-26 起記錄；之前的演進請以 [docs/](docs/) 內的 `sprint-*-report-*.md`、各項稽核證據及 README 第十二節「已知限制與假設」為準。

---

## [未發布] — AI 歷史自學學伴（Beta）MVP

**日期**：2026-10-26
**分支**：`feat/ai-history-tutor`
**Pull Request**：`#1`（Draft）<https://github.com/ipwh/ai-history-platform/pull/1>
**基準**：`origin/main` = `ad34050`
**狀態**：**已合併至 `main`**（2026-10-26，PR [#1](https://github.com/ipwh/ai-history-platform/pull/1)，功能 commit `4d295a1`）。部署為 Cloud Run revision **`history-self-study-00059-77s`**（2026-10-26，中間經 `00057-pxr` 首次部署及 `00058-kwh` 修復環境變數；證據見 [docs/deployment-evidence-2026-10-26.json](docs/deployment-evidence-2026-10-26.json)）。回滾只需把 100% 流量指回 `00056-8rx`。

> 本功能的定位是「課後自學學伴」，**不是**全知老師，亦**不是**批改系統。介面及文件一律標示為 Beta，史實以課本與科任老師為準。

### 新增

| 項目 | 說明 |
| --- | --- |
| `GET /api/tutor/chat` | 讀取自己的學伴對話（最近 40 則）及當日剩餘提問次數；同時回報 `windowLimitReached`，令前端可預先顯示時間窗已滿 |
| `POST /api/tutor/chat` | 送出歷史提問；通過硬閘及配額檢查後以 **SSE** 串流回傳 DeepSeek 回應（`stream: true`、`temperature: 0.4`） |
| `/tutor` 頁面 | 學生自學介面：Beta 標籤、免責聲明、剩餘次數、逐字串流、基本 Markdown（粗體／斜體／行內程式碼／列點／引號）；超額或時間窗已滿時輸入框轉為唯讀。頁面為 server component 並呼叫 `guardStudentPage("/tutor")`，未登入者由伺服器端 `307` 導向 `/login?next=%2Ftutor`；全站導覽對已登入學生顯示「歷史學伴」連結，教師／管理員及名冊未核對的學生會看到原因說明（不是每次送出都收到 403 的對話框） |
| [src/server/services/tutor.ts](src/server/services/tutor.ts) | 歷史主題硬閘、短跟進判定、香港時區日界線及每日配額計算 |
| [src/server/repositories/tutor.ts](src/server/repositories/tutor.ts) | `tutor_sessions`／`tutor_messages` 的資料存取及當日提問計數 |
| [tests/tutor-chat.test.ts](tests/tutor-chat.test.ts) | 14 項學伴測試（**全部 mock LLM**，不會發出真實 API 請求） |

**歷史主題硬閘的判定方式**（刻意可解釋，而不是黑箱語意分類）：

- 直接沿用既有 [src/lib/history-lexicon.ts](src/lib/history-lexicon.ts) 的 `HISTORY_TERM_GROUPS`（`canonical` 加 `aliases`），例如「一戰」「WWI」「凡爾賽條約」「明治維新」「冷戰」。
- 另接受時間特徵：`1914 年`、`20 世紀`、`公元前 3000 年` 等。
- **短跟進**（例如「點解？」「邊一年？」「有什麼影響」）只有在**同一對話、且上一輪仍標記為歷史主題**時才放行；上一輪被判離題後，該對話的短跟進亦會被擋，需重新提出含歷史關鍵詞的問題。
- 未匹配任何歷史詞且沒有上文 → 回傳固定引導句，**不呼叫 LLM**：
  > 我是你的歷史科自學學伴，只能討論歷史科相關話題喔！你可以告訴我你想探討哪一個歷史事件或課題嗎？

### 變更

| 項目 | 說明 |
| --- | --- |
| AI 用量語意（**產品上知情**） | 學伴提問在呼叫 DeepSeek 前使用 `reserveAiOperation(learnerId, "generation")`，因此與「AI 即時出題／補題」**共用**同一個個人及全域時間窗；管理員儀表板的 `generation` 數字亦已包含聊天用量。程式以常數 `TUTOR_OPERATION_KIND` 集中標示，日後要分開只需改一處 |
| [README.md](README.md)「AI 用量上限」 | 新增上述共用配額的說明，並列明學伴另有獨立的**每日 15 次**（`Asia/Hong_Kong` 日期）上限 |

### 安全

| 項目 | 行為 |
| --- | --- |
| 身分 | 只接受**已登入且在學生名冊內核對過**的學生（`rosterVerified`）；身分一律由既有 session／`requireStudentOrTeacher` 推導，**不**採信前端傳來的電郵、學習者 ID 或角色 |
| 未登入 | `401`（沿用既有文案「請先以學校 Google 帳戶登入」） |
| 教師／管理員 | `403`：本階段只限學生使用（見「已知限制」） |
| 跨學生存取 | 讀取或寫入他人的 `sessionId` 一律回傳 **`404`**（不用 `403`，避免洩漏該對話是否存在） |
| 離題 | **不呼叫 LLM、不寫入提問紀錄、不扣每日額度**；只有「通過硬閘且成功 `reserve`」的提問才計次 |
| 超額 | 每日上限 → `429`；既有 `ai_operations` 個人或全域時間窗上限 → 同樣 `429` 並沿用既有文案 |
| 金鑰缺失 | 未設定 DeepSeek 金鑰／模型／端點時回傳 **`503`** 及可讀錯誤碼（`TUTOR_LLM_NOT_CONFIGURED`），**不**靜默失敗、**不**回傳空字串 |
| 上游異常 | 連線失敗、非 2xx、空白回應、串流格式錯誤各有明確訊息的 `503` 或 SSE `error` 事件 |
| 防外洩 | 後端**不查詢**題目、標準答案或評分參考；MVP **不注入任何教材**。System prompt 要求：拒絕跨科、蘇格拉底式引導而不直接給答案、忽略解除角色／背誦全文的指令、不聲稱查閱過教材或題庫、回覆不得重現課本原文 |

### 資料庫

| 項目 | 說明 |
| --- | --- |
| Migration | **`0031-ai-history-tutor`**（新增於 [src/server/db/migrations.ts](src/server/db/migrations.ts)，接續 `0030-question-quality-findings`） |
| `tutor_sessions` | `id`（PK）、`learnerId`（FK → `learners`，`ON DELETE CASCADE`）、`createdAt`、`topicId`（可空，FK → `topics`）、`lastTurnOnTopic`（0/1，供短跟進判定）及 `(learnerId, createdAt DESC)` 索引 |
| `tutor_messages` | `id`（PK）、`sessionId`（FK → `tutor_sessions`，`ON DELETE CASCADE`）、`role`（`user`／`assistant`）、`content`、`tokensUsed`、`createdAt` 及 `(sessionId, createdAt)` 索引 |
| 時間格式 | 以 `+08:00` 表示的香港時間 ISO 8601 字串；每日額度以香港日期 00:00 作界線，避免伺服器 UTC 造成重置時間位移 |
| 正式環境（**已套用**） | 2026-10-26 部署 revision `00057-pxr` 時，由啟動流程（`getDb()` → `runMigrations`）自動套用；串流前後的 `/api/health` 均報告 `database: sqlite / ok`（若 0031 失敗，`getDb()` 會拋錯並令資料庫狀態變為 unavailable） |
| 本機／其他環境（**未套用**） | 本分支**沒有**對本機 `data/app.db` 執行 migration。唯讀檢查顯示本機 `app.db` 的 `schema_migrations` 最高仍為 **`0028`**，`tutor_sessions`／`tutor_messages` 均**不存在** |

> 正式環境已於 2026-10-26 的部署自動套用 `0031`；**本機及其他環境**仍需執行 `npm run db:migrate`（或沿用既有啟動流程），切勿假設已套用。

### 修正

| 項目 | 根因與影響 |
| --- | --- |
| 內容標記事件次序不穩定（既有缺陷，CI 偶發失敗） | `question_content_flags` 事件原本以 `created_at, id` 排序，而 `id` 是隨機 UUID；同一毫秒內的「先標記、後解除」會被隨機次序反轉，令現行狀態誤報為 `open`（CI 出現 `expected 'open' to be 'cleared'`）。改為 `created_at, rowid`（符合原註解「同一時間以輸入次序為準」），並新增迴歸測試；已用舊排序驗證該測試會失敗、新排序穩定通過 |
| 新路由未列入授權契約 | [tests/authz-negative.test.ts](tests/authz-negative.test.ts) 要求每個 API handler 必須在特權表格或公開清單聲明；已加入 `GET`／`POST /api/tutor/chat`，否則 CI 會以「有沒有人測試過這條特權路由」失敗 |
| 部署指令碼會清空 `HISTORY_REVIEWER_EMAILS`（既有缺陷） | [scripts/deploy-preserving-config.ps1](scripts/deploy-preserving-config.ps1) 只沿用部分線上設定，`HISTORY_REVIEWER_EMAILS` 回落到 `cloudbuild.yaml` 的預設 `""`；自 revision `00056-8rx` 起正式環境因而失去學科審核者，Golden 及學科裁決一律 fail-closed 403。已令指令碼讀取並傳遞 `_REVIEWER_EMAILS`，並在留空時輸出警告；正式環境先以 `--update-env-vars` 即時修復（`00058-kwh`），再隨 `00059-77s` 保留 |
| `deploy-preserving-config.ps1` 失去 UTF-8 BOM | PowerShell 5.1 會把無 BOM 的 UTF-8 當作 ANSI，中文註解令整份腳本無法解析（`The string is missing the terminator`）。已補回 BOM 並以 `Parser::ParseFile` 驗證 `PARSE_OK`；另 `scripts/check-onedrive-health.ps1` 同樣無 BOM，但本輪未觸及，建議另行處理 |
| `/tutor` 原本沒有伺服器端頁面守衛 | client component 令未登入者先收到介面骨架（200）；已改為 server component 呼叫 `guardStudentPage`，並新增 [tests/tutor-page-guard.test.ts](tests/tutor-page-guard.test.ts) 斷言 `NEXT_REDIRECT` 及 `%2Ftutor` |

### 已知限制（MVP，刻意接受）

| 限制 | 影響／理由 |
| --- | --- |
| 與 AI 出題共用 `generation` 配額 | 學生多做即時出題會壓縮學伴可用次數，反之亦然；管理員儀表板無法區分兩者。要分開需新增 `AiOperationKind: "tutor"` 及對應環境變數，**不可**改寫既有 `generation` 紀錄 |
| 教師／管理員不可使用 | 與專案「教師可測試學生端」的慣例不同；本階段只開放已核對名冊的學生，教師開 `/tutor` 會看到說明頁而非對話介面（API 回 403），以免與學生配額及對話記錄混用。如要開放需另立決定 |
| 歷史硬閘是關鍵詞比對 | 不是語意分類：可能誤擋冷僻但合理的歷史問題，亦可能放行含歷史詞彙的非歷史問題。系統 prompt 仍會拒絕跨科，但**伺服器端不再攔截**，因此該次會計次 |
| 不注入教材 | 模型沒有教材依據，史實可能有誤；這是防範「第二條洩教材路徑」的刻意取捨，介面已明示僅供參考 |
| `tokensUsed` 暫存為 0 | 串流期間無法即時取得準確用量，故如實寫 0（schema 允許），不填入估算值假裝精確 |
| 前端狀態只有 API 契約保證 | 免責聲明、剩餘次數、超額唯讀均有自動測試覆蓋 API 行為，但**未**加入瀏覽器 e2e；建議做一次登入後人工煙霧 |
| 對話保留期 | 目前**沒有**自動清理 `tutor_*`；如要與 `ai_operations` 的 30 天保留期一致，需另立維護工作 |

### 不在範圍

- 教材 RAG／長文注入、題庫或標準答案連線、自動批改。
- 把 `generation` 拆成獨立 `tutor` kind（建議另開 issue）。
- 修改既有教材、題目、題庫或任何 `main` 分支上與本功能無關的程式碼。

### 驗證

| 檢查 | 結果 |
| --- | --- |
| `npm test`（全套） | 132 files、**1,588 passed**、4 skipped、0 failed |
| `npm run typecheck` | 通過（`next typegen` + `tsc --noEmit`） |
| `npm run lint` | 0 error；1 個**既有** warning（[scripts/verify-questionbank-sync.ts](scripts/verify-questionbank-sync.ts) 第 29 行 `fs` 未使用，非本功能引入，未修改） |
| 學伴相關測試 | `tests/tutor-chat.test.ts` 14 項、`tests/tutor-page-guard.test.ts` 1 項、`tests/tutor-access.test.ts` 4 項、`tests/content-improvement-flags.test.ts` 14 項（含迴歸測試） |
| GitHub Actions | PR `#1` 的 `Test, typecheck, lint, build` **success**（最新 commit） |
| 真實 API | **沒有**在任何測試或驗證中呼叫 DeepSeek；所有 LLM 回應均由 mock 提供 |
| 正式資料庫 | 唯讀開啟 `data/app.db` 確認 `tutor_*` 表不存在、`schema_migrations` 最高為 `0028` |
| **部署（2026-10-26／27）** | Cloud Build `23e1053b` **SUCCESS**（3M19S）→ `00057-pxr`；環境變數修復 → `00058-kwh`；守衛修正後重建 `e8ec992a` **SUCCESS**（4M17S）→ `00059-77s`；導覽入口修正後重建 `a1183497` **SUCCESS** → **`history-self-study-00060-mln`**（100% 流量）。`/api/health` 200／`database: sqlite/ok`／`demoMode=false`／DeepSeek 已設定；`GET /tutor` 未登入 **307 → /login?next=%2Ftutor**；`GET`／`POST /api/tutor/chat` 未登入 `401`；`00059-77s` 及 `00060-mln` 均無 ERROR 級日誌；`HISTORY_REVIEWER_EMAILS=ipwh@pochiu.edu.hk` 已在該 revision；已確認部署的 JS chunk 含導覽標籤「歷史學伴」。證據見 [docs/deployment-evidence-2026-10-26.json](docs/deployment-evidence-2026-10-26.json) |
