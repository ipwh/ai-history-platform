# 學生／教師使用模擬及程式審核報告（2026-10-23）

本報告由自動化模擬產生，配合靜態程式審核。**沒有**重審任何題目的史實、答案或解釋：
題目內容在上載時已由科組逐題審核，本輪只審核程式與流程，並在發現內容疑點時記錄
`question_id`，交由擁有者抽樣覆核。

## 一、環境（全程隔離，未觸及真實資料）

| 項目 | 值 |
| --- | --- |
| 暫存資料庫 | `%TEMP%\hist-sim-20261023\app.db`（`APP_DATABASE_PATH`） |
| 暫存上載目錄 | `%TEMP%\hist-sim-20261023\uploads`（`APP_UPLOADS_DIR`） |
| 暫存 OCR 快取 | `%TEMP%\hist-sim-20261023\ocr-cache` |
| LLM | `LLM_PROVIDER=mock`（本地示範生成，不呼叫外部模型、不產生費用） |
| 登入 | 未啟用 Google 登入，`HISTORY_ALLOW_UNSAFE_DEMO_MODE=true`（示範模式） |
| 後台權杖 | `ADMIN_TOKEN` 已設定（長度足夠），用於教師端煙霧測試 |
| 建置 | `npm run build` 成功，以 `next start` 執行模擬（避免 dev 模式即時編譯） |
| 真實 `data/app.db` | **未被修改**（`LastWriteTime` 全程為 2026-10-22T15:36:36，大小 16,855,040 bytes） |

## 二、模擬結果

### 2.1 學生端（`scripts/simulate-student-usage.mjs`）

- 練習次數：**70**；作答次數：**458**；檢查項目：**409**
- 異常（程式層面）：**0**
- 疑似題目內容問題：**0**
- 組合矩陣：**12 個組合，通過 12，需跟進 0**

覆蓋範圍：12 個已發布初中課題 × 選擇題／填充題／混合 × 三種難度 × 1–30 題，
另加隨機組合、重做錯題（題庫及即時生成練習之後）、空錯題、學生回報（5 種原因）、
進度及重溫、等價答案寫法、部分作答、併發重複提交、邊界輸入。

### 2.2 組合矩陣（新增 `[J]`，每個年級一個代表課題）

| 課題 | 年級 | 組合 | 題型 | 難度 | 作答 | 要求題數 | 實際題數 | 不可作答題 | HTTP | 結果 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| topic-2 | 1 | single-mc-basic-1 | mc | basic | 全對 | 1 | 1 | 0 | 201 | 通過 |
| topic-2 | 1 | single-fill-advanced-5 | fill | advanced | 部分 | 5 | 5 | 0 | 201 | 通過 |
| topic-2 | 1 | multi-mixed-challenge-10 | mc+fill | challenge | 全對 | 10 | 10 | 0 | 201 | 通過 |
| topic-2 | 1 | multi-mc-basic-30 | mc | basic | 全錯 | 30 | 20 | 0 | 201 | 通過 |
| topic-5 | 2 | single-mc-basic-1 | mc | basic | 全對 | 1 | 1 | 0 | 201 | 通過 |
| topic-5 | 2 | single-fill-advanced-5 | fill | advanced | 部分 | 5 | 2 | 0 | 201 | 通過 |
| topic-5 | 2 | multi-mixed-challenge-10 | mc+fill | challenge | 全對 | 10 | 10 | 0 | 201 | 通過 |
| topic-5 | 2 | multi-mc-basic-30 | mc | basic | 全錯 | 30 | 27 | 0 | 201 | 通過 |
| topic-10 | 3 | single-mc-basic-1 | mc | basic | 全對 | 1 | 1 | 0 | 201 | 通過 |
| topic-10 | 3 | single-fill-advanced-5 | fill | advanced | 部分 | 5 | 4 | 0 | 201 | 通過 |
| topic-10 | 3 | multi-mixed-challenge-10 | mc+fill | challenge | 全對 | 10 | 10 | 0 | 201 | 通過 |
| topic-10 | 3 | multi-mc-basic-30 | mc | basic | 全錯 | 30 | 20 | 0 | 201 | 通過 |

「題數少於要求」13 項（例如課題4 選 10 題只得 4 題）：全部屬平台**如實告知**的降級
（教材／題目不足），練習通知已逐項說明並提出可行動建議，不是缺陷。清單見附錄。

### 2.3 教師端（`scripts/simulate-teacher-usage.mjs`）

- 請求 40 次、檢查 56 項、異常 **0**
- 覆蓋：學習記錄查詢（全部／按課題／按學習者／按日期）及四種格式匯出、
  題目清單篩選、手動新增（必須為草稿）、未覆核即發布被拒（409）、覆核發佈、
  修改已發布題目自動下架、停用、刪除、回報清單及狀態切換
- 覆核工作台及內容改進佇列在未登入時回 **401**（fail-closed，符合設計）

### 2.4 權限（負向）

| 情境 | 預期 | 實測 |
| --- | --- | --- |
| 未帶權杖呼叫 `/api/teacher/*`、`/api/admin/*`（`ADMIN_TOKEN` 已設定） | 401 | 401 |
| 未帶權杖呼叫 `/api/admin/materials` | 401 | 401 |
| 正式建置、未啟用登入、未開示範模式 → 後台 API | 403 | 403（`/api/admin/materials`、`/api/teacher/overview`、`/api/teacher/records/export`、`/api/admin/system/overview`） |
| 同上 → `/admin`、`/teacher` 頁面 | 重導向 | 307 → `/login?error=not_configured` |
| 未登入時傳 `learnerId=school:<電郵>` 讀取他人記錄 | 401 | 401（既有 `tests/authz-negative.test.ts`） |
| 其他學習者讀取／完成他人練習 | 403 | 403（模擬逐次核對） |

## 三、已修正的程式問題

### 1. `npm run setup` 只匯入 2／12 課題的教材（`scripts/setup.ts`）

- **原因**：`setup.ts` 只按課程種子記錄的檔名（`materialFile`）組合路徑，並以
  `fs.existsSync` 檢查。2026-10 擁有者把書本內容移入以課題命名的子資料夾並改名為
  「…_筆記.docx」後，種子記錄的檔名全部對不上，於是 10 個已發布課題既沒有教材也沒有
  題目——學生選了只會看到「此分節暫時沒有可用題目」。同一個資料夾用
  `npm run import:materials`（遞迴掃描）卻完全正常，兩條匯入路徑結果不一致。
- **修正**：`scripts/setup.ts` 改用 `collectMaterialFiles()`（與 `import:materials` 相同
  的遞迴掃描）並排除校內試題檔，`--pilot` 仍只匯入課題5。
- **驗證**：重建暫存資料庫後，匯入由 2 份教材（966 段）增至 **22 份教材（7,346 段）**，
  17 個課題全部有教材；題庫由 58 題增至 **279 題**（243 題新增，其中 234 題自動發布）。

### 2. 模擬腳本：429（AI 用量上限）被誤報為缺陷（`scripts/simulate-student-usage.mjs`）

- **原因**：`runPractice` 只把 409／5xx 當成已知降級，`429` 落入「建立練習失敗」分支。
  AI 用量上限是 `ai-limits.ts` 的**設計行為**（先保留、後呼叫），不是缺陷，卻令模擬
  以非零狀態結束，並掩蓋真正的問題。
- **修正**：429 改為記錄降級，並額外核對訊息可行動（含「上限」及「稍後／再試」）。

### 3. 模擬腳本：臨時報告預設寫入專案 `data/` 之內

- **原因**：`--report` 預設 `data/tmp-sim/report.json`，模擬產物會留在版本控制範圍內。
- **修正**：JSON 及新增的 Markdown 報告預設寫入作業系統暫存目錄。

### 4. 模擬腳本：新增 `[J]` 系統化組合矩陣及 Markdown 報告（功能擴充）

- 每個年級一個代表課題 × 單／多分節 × 題型 × 難度 × 題數（1／5／10／超過庫存）×
  作答模式（全對／部分／全錯），逐個案記錄 HTTP 狀態、要求／實際題數、不可作答題數。
- 每個組合使用**獨立學習者 ID**，避免 AI 每人用量上限令後面的組合全部變 429。
- 新增負向檢查：空錯題（409 且訊息可行動）、未發布課題不可出現在學生清單或建立練習、
  學生身分不可呼叫教師／管理員 API。
- `--report-md` 輸出 Markdown（組合結果、異常、疑似內容問題清單、題數不足、已知降級），
  `--no-matrix` 可跳過矩陣。

## 四、未改動的決策（刻意不做）

- **沒有**重審、改寫或批量修改任何 `correct_answer`、選項、`explanation` 或技能標籤。
- **沒有**為讓檢查變綠而把未覆核題目標成已覆核，亦沒有改動發佈關卡或 Golden 紀錄。
- **沒有**改動 `EXPLANATION_HOLD_POLICY` 等產品政策的預設值。
- **沒有**改動 `data/app.db`，亦沒有執行任何 migration／flag／apply／publish 指向真實資料庫。

## 五、待產品確認（只建議，未執行）

1. **題數不足的頻率**：13 項「要求 N 題、實際較少」，主因是每個難度只有少量已發布題目，
   而正式建置下即時生成的題目需教師確認後才可派發。建議擁有者檢視是否為個別課題補充
   題庫題目（屬內容決定）。
2. **正式建置下的補題提示**：生成題目在正式環境會被「待教師確認」攔下，學生看到的
   訊息是「未能即時生成額外題目…教師可在『題目管理』補充題目」。訊息可行動但略為籠統，
   是否要區分「已生成但待覆核」由產品決定。
3. **Next.js 安全通告**：建置及啟動時提示目前 Next.js 版本受已知安全弱點影響，建議排期升級。

## 六、驗證

| 指令 | 結果 |
| --- | --- |
| `npm run lint` | 通過（0 error；1 個既有 warning：`scripts/verify-questionbank-sync.ts` 未使用的 `fs`） |
| `npm run typecheck` | 通過 |
| `npm test` | 通過：112 個檔案、1,430 個測試（4 skipped）、0 失敗 |
| `npm run build` | 通過（57 條路由） |
| `simulate:usage`（正式建置） | 退出碼 0；409 項檢查、0 異常 |
| `simulate:teacher` | 退出碼 0；56 項檢查、0 異常 |

## 七、重現方法

```powershell
$temp = Join-Path $env:TEMP "hist-sim"
New-Item -ItemType Directory -Force -Path $temp, "$temp\uploads" | Out-Null
$env:APP_DATABASE_PATH      = "$temp\app.db"
$env:APP_UPLOADS_DIR        = "$temp\uploads"
$env:OCR_CACHE_PATH         = "$temp\ocr-cache"
$env:LLM_PROVIDER           = "mock"
$env:HISTORY_ALLOW_UNSAFE_DEMO_MODE = "true"
$env:AUTH_REQUIRE_SIGN_IN   = "false"
$env:GOOGLE_CLIENT_ID       = " "; $env:GOOGLE_CLIENT_SECRET = " "; $env:AUTH_SECRET = " "
$env:ADMIN_TOKEN            = "sim-admin-token-0123456789abcdef"

npx tsx scripts/setup.ts          # 只寫入暫存資料庫
npm run build; npm run start -- -p 3101

node scripts/simulate-student-usage.mjs --base-url http://127.0.0.1:3101 `
  --database "$env:APP_DATABASE_PATH" --report-md "$temp\report-simulation.md"
node scripts/simulate-teacher-usage.mjs --base-url http://127.0.0.1:3101
```

## 八、清理

本次建立的暫存目錄 `%TEMP%\hist-sim-20261023`（資料庫、uploads、OCR 快取、報告副本）
已於任務完成後刪除；`data/app.db`、`data/uploads` 未被寫入，背景伺服器程序已停止。

---

### 附錄：題數少於要求的個案（13 項）

| 練習 | 要求 | 實際 |
| --- | --- | --- |
| topic-3 fill advanced ×5（bank） | 5 | 4 |
| topic-4 mc basic ×5（bank） | 5 | 3 |
| topic-4 fill advanced ×5（bank） | 5 | 4 |
| topic-4 mc+fill challenge ×10（bank） | 10 | 4 |
| topic-6 fill advanced ×5（bank） | 5 | 4 |
| topic-6 mc+fill challenge ×10（bank） | 10 | 7 |
| topic-12 fill advanced ×5（bank） | 5 | 4 |
| topic-6 mc+fill challenge ×15（ai） | 15 | 13 |
| topic-2 mc basic ×30（bank） | 30 | 20 |
| topic-5 fill advanced ×5（bank） | 5 | 2 |
| topic-5 mc basic ×30（bank） | 30 | 27 |
| topic-10 fill advanced ×5（bank） | 5 | 4 |
| topic-10 mc basic ×30（bank） | 30 | 20 |
