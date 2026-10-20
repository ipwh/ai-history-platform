# Sprint 18 — 瀏覽器測試基礎與審核工作台無障礙修正（2026-10-19）

## 1. Git 狀態

| 時點 | 分支 | HEAD | origin/main | 未提交項目 |
| --- | --- | --- | --- | --- |
| 開始 | `main` | `6895db9` | `6895db9` | 94（25 modified + 69 untracked），與 Sprint 17 報告一致 |
| 結束 | `main` | `6895db9` | `6895db9` | **105（28 modified + 77 untracked）**（原有 94 項全部保留，另加 Sprint 18 檔案） |

未執行 `git reset`、`git clean`、`git checkout --`、`git restore`，沒有 commit、push 或部署。

## 2. 新增與修改檔案（只列 Sprint 18 部分；Sprint 9–17 的 94 項未提交成果全部保留）

新增：

- `playwright.config.ts`
- `tests/ui/test-env.ts`
- `tests/ui/mint-cookies.ts`
- `tests/ui/run-server.mjs`
- `tests/ui/review-workbench.spec.ts`
- `docs/sprint-18-report-2026-10-19.md`（本文件）
- `src/server/quality/adjudication-packet.ts`、`scripts/export-adjudication-packet.ts`、`tests/adjudication-packet.test.ts`、`docs/teacher-review/adjudication-packet-2026-10-19.csv`、`docs/teacher-review/adjudication-packet-2026-10-19.html`（第 13 節追補的裁決包）

修改：

- `package.json`：`devDependencies` 加 `@playwright/test`；新增 `test:ui`、`test:ui:install` scripts。
- `package-lock.json`（安裝 Playwright 所產生）。
- `src/components/ReviewWorkbench.tsx`：無障礙、焦點管理、未提交內容保護、Golden 決定不預選。
- `src/app/api/teacher/questions/[questionId]/review/route.ts`：`GET` 加入 `servability` 及 `reviews`（修正工作台開啟題目時的執行期錯誤）。
- `docs/teacher-review/provenance-adjudication-design-2026-10-19.md`：新增實作準備度矩陣附錄。

## 3. 新增測試依賴及用途

| 依賴 | 版本 | 用途 |
| --- | --- | --- |
| `@playwright/test` | 1.64.1（devDependency） | 唯一新增的測試框架；瀏覽器層 UI 測試 |
| Chromium headless shell | Playwright 1248 版 | 由 `npm run test:ui:install` 安裝於使用者層 `ms-playwright` 目錄 |

沒有新增 Testing Library、jsdom、Cypress、Puppeteer 或 axe。沒有升級任何既有套件。

## 4. 瀏覽器測試基建

- **啟動方式**：`tests/ui/run-server.mjs` 先重建暫存環境（`%TEMP%\ai-history-ui-test`），複製 `data/app.db`（含 `-wal`／`-shm`）及 `data/uploads`，以 `tsx` 產生測試登入 cookie，再以 `next start --port 3100` 啟動 Next.js。因為 Playwright 會先啟動 webServer，環境準備必須在同一程序內先行完成，否則伺服器會建立空的資料庫檔。
- **登入隔離**：cookie 由 `tests/ui/mint-cookies.ts` 以應用程式本身的 `encodeSession` 簽署，`AUTH_SECRET` 為測試專用值；名單為 `AUTH_ADMIN_EMAILS=ui-admin@example.test`、`AUTH_TEACHER_EMAILS=ui-teacher@example.test,ui-reviewer@example.test`、`HISTORY_REVIEWER_EMAILS=ui-reviewer@example.test`。學生身分 `ui-student-0000001@example.test` 不在任何教師名單。
- **不能指向正式環境**：`APP_DATABASE_PATH`、`APP_UPLOADS_DIR`、`APP_MATERIALS_DIR` 全部指向暫存目錄；`GOOGLE_CLIENT_ID` 設為測試值以明確關閉匿名示範模式；`reuseExistingServer: false` 避免接上開發者的伺服器。
- **清理**：每次執行前刪除並重建暫存目錄，正式 `data/` 及 `materials/` 只被讀取複製。
- **CI**：可在 CI 以 `npm run test:ui:install` 加 `npm run test:ui` 執行；**本 Sprint 沒有在 CI 實際執行**，屬 `UNVERIFIED`。

## 5. 瀏覽器測試覆蓋（13 passed / 0 failed / 0 skipped）

> **更新（2026-10-20）**：下表是 Sprint 18 當時的覆蓋。工作台在 2026-10-20 簡化後，測試已同步
> 改寫（改用三個決定按鈕、快速理由、`data-question-id`、`#servability-form-error`／
> `#golden-form-error`），並新增「單欄流程可返回清單」「未選決定前沒有提交按鈕」兩項；
> 「缺少勾選確認」一項已隨勾選框移除而改成「未選理由時拒絕提交」。
> 現行清單見 [tests/ui/review-workbench.spec.ts](../../tests/ui/review-workbench.spec.ts)。

| 場景 | 測試 |
| --- | --- |
| 佇列與分頁 | 顯示伺服器提供的數量與第一頁項目；分頁使用伺服器端限制並可返回第一頁 |
| 不可作答表單 | 沒有預選核准、驗證錯誤與欄位關聯並取得焦點；缺少勾選確認時拒絕提交；409 要求重新載入且不顯示成功；429 顯示可理解錯誤並可重試 |
| Golden 表單 | 沒有預選核准、核准需要完整評估欄位（`#golden-decision` 必填、類別必填） |
| 授權邊界 | 未登入 401；學生 403；管理員非歷史科審核者提交 Golden 被拒 403；授權審核者可讀取 |
| 錯誤與復原 | 佇列載入 500 → `role="alert"` → 重試成功；切換佇列前要求確認未提交的理由 |

限制：

- 只在 Chromium headless 執行；沒有 Firefox／WebKit 覆蓋。
- 沒有 axe 或任何自動無障礙掃描（未加入依賴），因此**未做正式無障礙稽核**。
- 409／429／500 以 route interception 製造回應，但授權、版本與指紋檢查仍由真實 route handler 執行；沒有 mock 授權。
- 沒有真實教師參與可用性測試。

## 6. 無障礙與未提交內容修正

1. 兩個裁決表單加上 `noValidate`，由應用程式自己的錯誤訊息處理驗證，避免瀏覽器原生提示繞過 `aria-describedby`。
2. 錯誤區塊改為 `role="alert"` + `tabIndex={-1}`，以 callback ref 在每次掛載時取得焦點（包括 409 重新載入後同樣錯誤再次出現）。
3. 失敗欄位設定 `aria-invalid="true"` 及 `aria-describedby` 指向錯誤區塊（決定、理由、確認勾選）。
4. 佇列層錯誤以 `role="alert"`、成功訊息以 `role="status"` 包裝，避免重複或不一致的播報。
5. Golden 表單的決定改為 `""` 起始，加入「請選擇（不會預設為核准）」選項及必填驗證，不再預選核准。
6. 未提交的裁決內容：切換佇列、頁碼、題目或按「重新載入題目」前以 `window.confirm` 確認；離開頁面時以 `beforeunload` 提示。理由欄位內容不會被默默丟棄。

保留不變：授權（`requireTeacher` + `HISTORY_REVIEWER_EMAILS`）、決定值、版本／指紋綁定、伺服器端驗證、歷史覆核紀錄唯讀，以及「裁決 ≠ 可發布」。

## 7. 修正的實際缺陷（Sprint 17 未發現）

`GET /api/teacher/questions/:id/review` 只回傳 `{ view: teacherQuestionView(question) }`，但工作台前端假設 `view.servability` 與 `view.reviews` 存在 → 在 `/teacher/review` 點選任何不可作答題目即觸發 `Cannot read properties of undefined (reading 'ok')`，整頁進入 Next 錯誤邊界。已在 route 加入 `servability`（`checkQuestionServable`）與 `reviews`（`listQuestionReviews`）兩個伺服器端欄位，前端在缺少欄位時以「不視為可派發」的安全預設顯示。此為 Sprint 16 起即存在、Sprint 17 未能發現的問題，正是缺少瀏覽器層測試的後果。

## 8. Provenance 政策邊界

沒有新增 provenance 寫入 API、schema 變更或 migration。實作準備度矩陣見 `docs/teacher-review/provenance-adjudication-design-2026-10-19.md` 附錄 A；13 項政策決定仍全部 `UNASSIGNED`。

## 9. 計數（本 Sprint 未改變）

| 項目 | 數值 | 來源 |
| --- | --- | --- |
| 不可作答題目 | 97（`FILL_ANSWER_LEAKS` 1 + `MCQ_ROMAN_LABEL_MISSING` 96） | `release:gate` |
| 可由原文直接補標示 | 0 | `release:gate` servability-adjudication |
| Provenance 風險 | 623（P0 0／P1 530／P2 0／P3 93） | `release:gate` |
| Provenance 與來源待核實重疊 | 124（交集，非互斥） | Sprint 14/15 |
| 來源待核實 | 1,003（可定位 877） | `release:gate` |
| Golden 候選／已核准 | 42／0 | `release:gate` |
| `HISTORY_REVIEWER_EMAILS` | 未配置（正式環境） | 政策阻塞 |

## 10. 測試與驗收（實際執行）

| 命令 | 退出碼 | 結果 |
| --- | --- | --- |
| `npx playwright install chromium` | 0 | Chromium headless shell 1248 已下載 |
| `npx playwright test`（最終） | 0 | 13 passed、0 failed、0 skipped |
| `npm test` | 0 | 91 files、1,229 passed、4 skipped |
| `npm run typecheck` | 0 | `next typegen` + `tsc --noEmit` 無錯誤 |
| `npm run lint` | 0 | 無錯誤 |
| `npm run build` | 0 | 建置成功（`/teacher/review` 動態路由） |
| `npm run release:gate` | 0 | `NOT READY`（15 個 gate 狀態與 Sprint 17 相同） |

未執行：`npm run e2e`（HTTP E2E，本次未重跑；上次結果為 Sprint 17 的 128 pass／0 fail，**不視為本次實測**）、`golden:eval`、各 `audit:*`（本 Sprint 未改動相關程式碼；`release:gate` 已重新讀取既有報告並輸出相同狀態）。

## 11. 未驗證項目

- CI 執行 Playwright（沒有 CI 環境可測）。
- 正式部署、Cloud Run、多實例 SQLite、production snapshot 工具。
- axe 或任何自動無障礙掃描。
- 真實教師可用性與螢幕閱讀器實測。
- Firefox／WebKit。
- `next start` 在 `output: standalone` 設定下會輸出警告（仍可正常服務）；尚未改以 `.next/standalone/server.js` 啟動。

## 12. Release gate 與安全性聲明

- 15 個 gate 狀態與 Sprint 17 完全相同，**沒有因為新增瀏覽器測試或修正無障礙缺陷而提升任何 gate**。`NOT READY` 維持不變。
- 沒有存取或修改正式資料庫、沒有執行 migration、沒有呼叫付費 AI API、沒有部署、沒有 commit、沒有 push。
- 沒有建立假教師、假核准、假 Golden fixture 或虛構來源證據；測試身分只存在於暫存測試環境的名單變數中。

## 13. 追補：97 題裁決包（同日追加）

依使用者選擇「產生 97 題裁決包」新增唯讀匯出工具：

- [`src/server/quality/adjudication-packet.ts`](src/server/quality/adjudication-packet.ts)：純函式，把既有工作清單 JSON 轉成 CSV 及可列印 HTML，**不讀寫資料庫、不作裁決**。
- [`scripts/export-adjudication-packet.ts`](scripts/export-adjudication-packet.ts) + `npm run review:adjudication-packet`：只讀取 `docs/quality/adjudication-worklist-2026-10-19.json`，輸出 `docs/teacher-review/adjudication-packet-2026-10-19.csv`／`.html`。
- [`tests/adjudication-packet.test.ts`](tests/adjudication-packet.test.ts)：6 個測試（97 列、26 欄、指紋／版本／必須維持隔離、HTML 不預先勾選任何裁決、類別統計與來源一致、CSV 轉義）。

實際輸出：97 題（`original_available` 81、`original_inconsistent` 10、`original_missing` 4、`locator_missing` 1、`machine_undecidable` 1），原卷可核對 91、必須維持隔離 97、0 題有任何自動核准。HTML 每題提供四個未勾選選項及簽署欄，頁首明確聲明「列印或勾選不會改變題目狀態」。

驗證：`npm run lint` 0、`npm run typecheck` 0、`npm test` → 92 files／1,235 passed／4 skipped。未改動任何 gate 狀態（`NOT READY` 不變），未 commit／push。

## 14. 追補：`HISTORY_REVIEWER_EMAILS` 負責人決定（2026-10-19）

使用者（負責人）決定：

| 項目 | 決定 |
| --- | --- |
| 名單電郵 | `ipwh@pochiu.edu.hk` |
| 環境 | **本機**（`.env.local`，已被 `.gitignore` 排除，不會提交） |
| 日後增減責任人 | `ipwh@pochiu.edu.hk` |
| 雙人覆核 | 不需要 |

已寫入 `.env.local`（連同決定日期、適用範圍、撤銷方式及職責分離說明）。**staging／production 未設定，兩處仍 fail closed。**

驗證（全部實際執行、唯讀、沒有寫入任何資料庫）：

| 檢查 | 結果 |
| --- | --- |
| 名單解析 | `["ipwh@pochiu.edu.hk"]` |
| 負責人（含大小寫／空白變體） | `true` |
| 同網域其他帳戶、未登入、空字串 | `false` |
| 移除變數後連負責人 | `false`（fail closed） |
| `tests/authz-negative.test.ts` + `golden-approval` + `servability-adjudication` | 171 passed |
| `npm test`（全套） | 92 files／1,235 passed／4 skipped |
| `npm run release:gate` | 仍 `NOT READY`；`golden-approval` 仍 `INSUFFICIENT_EVIDENCE`（0／42）、`golden-evaluation` 仍 `INSUFFICIENT_EVIDENCE`、`servability-adjudication` 仍 `POLICY_PENDING`（0 題裁決） |

**沒有**因為設定名單而：核准任何 fixture、提交任何裁決、改變任何 gate、寫入資料庫、或把 admin 角色當成學科資格。決策記錄已同步更新至 [policy-decisions-2026-10-19.md](docs/teacher-review/policy-decisions-2026-10-19.md) 第 8 項與第 9 節。
