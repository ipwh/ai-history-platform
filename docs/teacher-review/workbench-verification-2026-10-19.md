# 審核工作台驗證與可用性檢視（Sprint 17，2026-10-19）

範圍：`/teacher/review`（Sprint 16）、佇列 API、servability 及 Golden 表單。

## 1. 瀏覽器／UI 自動化測試：**未加入（無可用框架）**

【實測】`package.json` 的 dependencies／devDependencies 沒有任何 Playwright、Puppeteer、Cypress、
Testing Library、jsdom／happy-dom 或 axe 套件；`node_modules` 亦沒有 `playwright`／`@playwright/test`。
現有 E2E（`scripts/e2e-flow.mjs`）是 HTTP 流程腳本，不渲染 React，不能驗證 UI 行為。

依 Sprint 17 §2，**不安裝新依賴**；以下為最小可行方案（尚未實作）：

| 項目 | 建議 |
| --- | --- |
| 框架 | `@playwright/test`（devDependency，單一工具同時覆蓋瀏覽器、無障礙快照及截圖） |
| 伺服器 | `next build` + `next start`，`APP_DATABASE_PATH`／`APP_UPLOADS_DIR` 指向 `%TEMP%` 複本，`LLM_PROVIDER=mock` |
| 登入 | 以既有 `AUTH_SECRET` 簽發工作階段 cookie（教師／admin／學生各一），必要時用 `HISTORY_REVIEWER_EMAILS` 隔離測試名單 |
| 測試檔 | `tests/ui/review-workbench.spec.ts`，5 個案例：佇列載入與分頁、空／缺報告狀態、servability 表單驗證與 409、Golden 表單必填與失敗訊息、角色拒絕（學生／admin／非名單教師） |
| CI 成本 | 需安裝瀏覽器二進位（`npx playwright install chromium`）；本機與 CI 各約 1–2 分鐘 |
| 風險 | 依賴 `next start` 埠與 cookie 簽署；可用固定埠及測試專用 `AUTH_SECRET` 降低不穩定 |

**未執行原因**：安裝瀏覽器依賴屬環境變更，Sprint 明文要求先提出方案、不得自動安裝。
因此 **UI 自動化覆蓋 = `UNVERIFIED`**；API 測試通過不等於 UI 已驗證。

## 2. 既有自動化覆蓋（實際有跑的）

| 範圍 | 證據 |
| --- | --- |
| 佇列 API 權限、分批、上限、計數 | `tests/review-queue.test.ts`（8 項） |
| 所有特權路由的負向授權（含新佇列路由） | `tests/authz-negative.test.ts`（150 項） |
| servability 裁決（409、403、非核准不派發） | `tests/servability-adjudication.test.ts`（12 項） |
| Golden 核准（必填、403、409、冪等） | `tests/golden-approval.test.ts`（9 項） |
| 唯讀 CLI／manifest | `tests/read-only-cli.test.ts`（7）、`tests/read-only-sidecar.test.ts`（6） |

## 3. 無障礙與可用性：程式碼檢視（非正式審核）

**已具備**

- 所有輸入有 `<label htmlFor>`；決定選單預設空值（servability）或明確 `approved` 選項但需填寫全部評估欄位（Golden）。
- 佇列計數、分頁、成功／錯誤訊息使用 `aria-live="polite"`。
- 按鈕使用原生 `<button>`／`<select>`／`<textarea>`，可用鍵盤操作；tablist 使用 `role="tab"`＋`aria-selected`。
- 狀態不只靠顏色：文字標示（quarantined／servable／pending-review／stale）＋說明。
- 既有覆核歷史放在 `<details>` 內，與新表單分開；自動證據與人類決定有明確文字區分。
- 題目、答案、來源位置、grading 資訊以定義清單呈現，長文本可換行。

**已知缺口（本次未修正，因為屬 UI 行為改動，需與瀏覽器測試一併驗證）**

1. **提交後沒有移動焦點**至結果訊息或下一個欄位；409 後焦點仍留在提交按鈕。
2. 表單錯誤以一般 `<Notice>` 顯示，**沒有 `aria-describedby` 與欄位關聯**，讀屏不會自動朗讀哪個欄位出錯。
3. 沒有 `aria-invalid` 標記。
4. 未執行 axe／Lighthouse 自動掃描（無套件）。
5. 沒有真實教師試用；**teacher usability = `UNVERIFIED`**。
6. 佇列切換時未保留未提交的理由文字（元件以 `key` 重建）；對長理由的教師可能造成資料遺失，建議加「離開前確認」。

**建議的最小修正（下一 Sprint，與瀏覽器測試一起做）**

- 錯誤訊息加 `id`，對應欄位加 `aria-describedby`／`aria-invalid`。
- 提交成功／409 後以 `ref.focus()` 移到狀態區（`role="status"`）。
- 切換佇列或題目前，若有未提交內容則以 `window.confirm`（或 inline 提示）確認。

## 4. 角色與工作階段行為【實測（API 層）】

| 角色 | 佇列 | servability 核准 | Golden 核准 |
| --- | --- | --- | --- |
| 未登入 | 401 | 401 | 401 |
| 學生 | 403 | 403 | 403 |
| admin（不在名單） | 200（唯讀） | 403 | 403 |
| 教師（不在名單） | 200（唯讀） | 403 | 403 |
| 名單內歷史科教師 | 200 | 允許 | 允許 |

UI 隱藏不是授權：上述拒絕都由伺服器回傳（`tests/authz-negative.test.ts`、`tests/golden-approval.test.ts`、`tests/servability-adjudication.test.ts`）。

## 5. 結論

- UI 自動化：**未加入**（已記錄約束及最小方案）。
- 無障礙：程式碼檢視發現 6 項缺口，**未完成正式審核**，teacher usability 未驗證。
- 這些限制**不影響**現有安全契約：所有寫入仍由伺服器驗證授權、版本及指紋。
