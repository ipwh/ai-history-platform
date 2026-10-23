# 瀏覽器支援基線與舊裝置處理（Sprint 23；Sprint 24 補充方案比較）

最後更新：2026-10-23

---

## 1. 結論：最低支援基線

**本網站的最低支援基線是 Safari 16.4（iPadOS／iOS 16.4）**，與 Next.js 16 的官方要求一致。

| 引擎 | 最低版本 | 來源 |
| --- | --- | --- |
| Safari（macOS／iPadOS／iOS） | 16.4 | `node_modules/next/dist/docs/.../supported-browsers.md` |
| Chrome／Edge（Chromium） | 111 | 同上（Next.js 預設 `browserslist`） |
| Firefox | 111 | 同上 |

Next.js 文件的預設值為：

```
"browserslist": ["chrome 111", "edge 111", "firefox 111", "safari 16.4"]
```

本專案 `package.json` **沒有**自訂 `browserslist`，`next.config.ts` 亦沒有覆寫 build target，
因此實際輸出就是上述基線。

---

## 2. 為甚麼舊版 Safari 看不到題目

這是**引擎無法解析**的問題，不是資料或權限問題：

1. 本機 `.next/static/chunks` 的實際輸出含 ES2022 語法（class static block、private field
   `#x`、`?.`、`??`、`Array.prototype.at()`）。Safari 16.4 以前的引擎在**解析階段**就會
   拋出 `SyntaxError`，整個 chunk 不會執行。
2. 學生練習頁 `/practice/[sessionId]` 由 `PracticeRunner`（client component）負責向
   `/api/practice/{id}` 取得題目；在 hydrate 之前，伺服器輸出只有「正在載入題目…」。
3. 因此舊裝置看到的是**永遠不會結束的載入畫面**，沒有錯誤訊息、沒有重試按鈕，
   也沒有辦法自行判斷原因。

同一機制影響所有需要 JavaScript 的頁面（首頁課題清單、教師端、管理員端），
但學生練習頁的情況最明顯，因為畫面完全依賴該元件。

### 為甚麼不「降級編譯」

- Next.js 的 client runtime 本身要求 Safari 16.4；把應用程式碼 transpile 到 ES5
  並不能令框架執行。
- 全面改寫成舊技術（例如放棄 React Server Components／App Router）屬重構，遠超
  本 Sprint 範圍，而且會令現有安全與權限設計重新受考驗。

---

## 3. 已實施的處理（Sprint 23）

### 3.1 舊裝置看門狗（`src/app/layout.tsx` + `src/lib/browser-support.ts`）

- 根版面注入一段**只用 ES5 語法**的 `<script>`（沒有箭頭函式、`const`／`let`、
  樣板字串、class、展開運算子）。因為它是傳統腳本，即使框架 bundle 解析失敗它仍會執行。
- 它會：
  1. 檢查必要功能是否齊全（`Promise.prototype.finally`、`fetch`、`AbortController`、
     `Object.fromEntries`、`Object.hasOwn`、`Array.prototype.at`）；
  2. 監看 `document.documentElement[data-app-hydrated]`（由 `AppShell` 在 hydrate 後設定）；
  3. 若功能不足或約 20 秒內仍未 hydrate，隱藏應用程式內容並顯示**伺服器已輸出**的
     提示面板（`#browser-support-fallback`），內容包括：偵測到的系統版本、支援基線、
     更新 iPadOS 的步驟、「重新載入」連結，以及要求截圖通知老師。
- 提示面板與 `<noscript>` 都由伺服器輸出，因此即使 JavaScript 完全不可用也會顯示。
- 提示**不會**用假資料或示範題掩蓋失敗，也不會把錯誤說成成功。

### 3.2 錯誤分類（`src/lib/api-errors.ts` + `src/components/ui.tsx`）

前端不再把所有失敗顯示成同一句訊息。分類如下：

| 類別 | 判斷依據 | 是否建議重試 |
| --- | --- | --- |
| 網絡失敗 | `fetch` 拋出 `TypeError` | 是 |
| 逾時 | `AbortError`／`ApiError.kind = "timeout"` | 是 |
| 登入失效／無權限 | 401／403 | 否（提示重新登入） |
| 找不到資料 | 404 | 否 |
| 版本衝突 | 409 | 是（先重新載入） |
| 操作太頻繁 | 429 | 是 |
| 伺服器錯誤 | 5xx | 是 |
| 回應格式不正確 | HTTP 成功但非 JSON（`kind = "format"`） | 是 |
| 空題目清單 | `kind = "empty"` | 是 |
| 瀏覽器功能不足 | 看門狗面板（見 3.1） | — |

### 3.3 消除兩個「永遠載入」的情況

1. `PracticeRunner` 的題目請求加上 20 秒時限（`api.get(..., { timeoutMs: 20_000 })`），
   網絡停滯不再無限等待。提交答案**不設**時限，因為伺服器端可能需要 AI 批改。
2. 伺服器回應成功但 `questions` 為空時，以前會因為 `!current` 而永遠顯示
   「正在載入題目…」；現在改為明確且可重試的錯誤。

### 3.4 儲存空間不可用時不再崩潰

`getLearnerId()` 現在以 `try/catch` 存取 `localStorage`，並在儲存不可用時使用
記憶體中的識別碼。舊版 Safari 私密瀏覽會在 `setItem` 拋出例外，以前的寫法會令
整個頁面在載入階段就失敗。

---

## 4. 如何驗證

### 4.1 自動化（本機可執行）

```bash
npm test -- tests/browser-support.test.ts tests/api-errors.test.ts
```

- `tests/browser-support.test.ts`：UA 判定（iPadOS 15.7／16.0／16.3／16.4、桌面 Safari、
  Chromium、Firefox、無法識別）、看門狗腳本的 ES5-only 檢查及語法解析。
- `tests/api-errors.test.ts`：錯誤分類矩陣、載入時限。

Playwright 的 WebKit 專案（如已安裝瀏覽器）可驗證學生練習流程；**桌面 WebKit 不等同
實體舊 iPadOS Safari**，通過也不能當作已在舊裝置驗證。

### 4.2 實機驗收（尚未執行）

需要在下列裝置上以學生帳戶完成一次完整練習（載入 → 作答 → 提交 → 下一題 → 重新載入）：

| 裝置 | 系統 | 預期結果 |
| --- | --- | --- |
| iPad（第 5／6 代，或任何停留在 iPadOS 15.x 的裝置） | iPadOS 15.7 | 見到「練習未能載入」提示，並顯示偵測到的版本；不會無限載入 |
| iPad（停留在 iPadOS 16.0–16.3） | iPadOS 16.3 | 同上 |
| iPad（iPadOS 16.4 或以上） | iPadOS 16.4+ | 正常載入及作答 |
| 舊款 iPhone（iOS 15） | iOS 15 | 同上（提示） |

要收集的錯誤資訊：裝置型號、系統版本、畫面截圖（含提示面板的「偵測到」一行）、
以及是否所有頁面都受影響。

---

## 5. 未驗證／待產品負責人確認

- **未在實體舊 iPad 上驗證**：本 Sprint 沒有可用的實機或舊版 Safari 模擬器，
  以上行為由程式碼與 UA 判定推導，並以單元測試覆蓋判斷邏輯，但**未經實機確認**。
- **支援政策**：專案文件以往沒有明文承諾瀏覽器版本；`docs/release-preflight-2026-10.md`
  只說明沒有瀏覽器自動化框架。若學校要求支援 iPadOS 15 或更舊的裝置，必須由產品負責人
  決定（選項包括：改用其他裝置、把平台改為伺服器端渲染題目、或另行評估框架版本）。
- **長者／共用裝置**：學校借用的舊 iPad 常見於 iPadOS 15，屬上述情況。

---

## 6. 相關程式碼

- `src/lib/browser-support.ts`：基線常數、UA 判定、看門狗腳本、提示文案
- `src/app/layout.tsx`：注入看門狗、提示面板、`<noscript>`
- `src/components/AppShell.tsx`：hydrate 標記
- `src/lib/api-errors.ts`：`ApiError` 及 `describeApiFailure`
- `src/lib/api-client.ts`：請求時限、儲存空間容錯
- `src/components/ui.tsx`：`ErrorNotice` 的分類顯示
- `src/components/PracticeRunner.tsx`：載入時限、空題目清單處理

---

## 7. Sprint 24 方案比較（維持現狀 vs 支援更舊 iPadOS vs 替代路徑）

### 7.1 官方文件依據

`node_modules/next/dist/docs/03-architecture/supported-browsers.md`（Next.js 16.4.1）：

- 「Next.js supports **modern browsers** with zero configuration: Chrome 111+、Edge 111+、
  Firefox 111+、Safari 16.4+」。
- 可用 `package.json` 的 `browserslist` 指定目標；預設值即上述四個版本。
- Next.js 只自動注入 `fetch`、`URL`、`Object.assign` 三個 polyfill；「If your own code or
  any external npm dependencies require features not supported by your target browsers，
  you need to add polyfills yourself」。

即：**框架沒有承諾支援 Safari 16.4 以下**；`browserslist` 可以調整轉譯目標，但
文件沒有保證降低目標後框架（React 19 + App Router + Turbopack 產物）仍可運作。

### 7.2 三個方案

| 方案 | 內容 | 成本 | 風險 | 目前狀態 |
| --- | --- | --- | --- | --- |
| **A. 維持 Safari 16.4 基線，只改善提示** | 舊裝置顯示可操作說明；主流瀏覽器正常 | 已付出（Sprint 23） | 舊裝置仍然不能使用（這是事實，不是可修好的錯誤） | ✅ 已實作並測試 |
| **B. 支援更舊的 iPadOS／Safari** | 以 `browserslist` 降低目標 + 自行加 polyfill（`Object.hasOwn`、`Array.prototype.at`、`Promise.prototype.finally` 等）+ 修正 CSS（Tailwind 4 的 `@property`／`color-mix` 需要 Safari 16.4） | 高：需要改 build target、加 polyfill bundle、逐頁回歸、處理 CSS 降級；每次框架升級都要重做 | 高：Next.js 沒有為此提供支援承諾；可能出現只在舊引擎重現的行為差異；測試需實機；bundle 變大拖慢所有裝置 | ❌ **未實作**（需授權，見 7.4） |
| **C. 替代使用路徑** | 學生改用較新裝置／更新 iPadOS；或由學校提供支援版本的平板 | 低（行政） | 需要學校層面配合 | ⚠️ 建議路徑（不需改程式） |

**「只把 bundle 降級到 ES5」不足夠**：CSS（Tailwind 4 的 `@property`、`color-mix()`、
`oklch`）與 React 19 的執行期假設同樣需要處理；單靠語法降級不能宣稱相容。

### 7.3 已完成的相容性測試矩陣（Sprint 24）

以 `npx playwright test tests/ui/student-practice.spec.ts` 在
**Chromium（Playwright chromium）與 WebKit 27.2** 各執行一次；伺服器為真實
`next start`，資料為 `data/app.db` 的暫存快照，登入為真實 cookie 授權。

| 情境 | Chromium | WebKit | 備註 |
| --- | --- | --- | --- |
| 登入後載入題目、作答、取得回饋、重新載入（選項次序不變） | ✅ | ✅ | 真資料 |
| 下一題導覽，重新載入後回到第一題且內容相同 | ✅ | ✅ | 真資料 |
| `localStorage` 被封鎖（模擬私密瀏覽） | ✅ | ✅ | 仍可載入及作答（記憶體後備） |
| 未登入存取練習頁 | ✅ | ✅ | 伺服器守衛導向 `/login`，不派題 |
| API 500 | ✅ | ✅ | 「伺服器暫時出錯」＋重試 |
| API 回應不是 JSON | ✅ | ✅ | 「伺服器回應格式不正確」 |
| 網絡中斷 | ✅ | ✅ | 「未能連接伺服器」 |
| API 逾時（20 秒無回應） | ✅ | ✅ | 「載入逾時」＋重試 |
| 題目清單為空 | ✅ | ✅ | 明確錯誤，不再無限載入 |
| JavaScript 被封鎖（模擬舊引擎無法解析 bundle） | ✅ | ✅ | 顯示「練習未能載入」提示面板 |

**這些結果不代表舊版 Safari 可用**：桌面 WebKit 27.2 是現代引擎，與 Safari 15／16.0–16.3
的差異正是本次要處理的部分（無法解析 bundle）。看門狗之所以會被測到，是因為測試
直接封鎖 JavaScript 來重現「bundle 從未執行」的狀態。

### 7.4 方案 B 的實驗計畫（需授權，未執行）

若要認真評估支援 iPadOS 15／16.0–16.3，最小可行實驗：

1. 在 `package.json` 加入 `"browserslist": ["safari 15", "chrome 111", "firefox 111"]`；
2. `npm run build`，檢查 `.next/static/chunks` 是否已無 class static block／private field；
3. 以 WebKit 專案跑現有 UI 測試（只能證明現代引擎仍可運作，**不能**證明舊引擎）；
4. 借實體 iPad（iPadOS 15.7）完成 §4.2 的驗收步驟；
5. 檢查 Tailwind 4 產出的 CSS 在舊引擎的降級表現（可能需要放棄部分樣式）。

未執行的原因：需修改 `package.json` 與整個 build target，屬跨 Sprint 的架構決定，
而且缺少實機驗證；依 Sprint 24 授權要求，先提供計畫而不執行。

### 7.5 尚未實測的裝置

| 裝置 | 系統 | 狀態 |
| --- | --- | --- |
| iPad（第 5／6 代） | iPadOS 15.7 | **未實測**（預期：顯示「練習未能載入」提示） |
| iPad（任意） | iPadOS 16.0–16.3 | **未實測**（預期同上） |
| iPad / iPhone | iOS 15 | **未實測** |
| iPad | iPadOS 16.4+ | **未實測**（預期正常，桌面 WebKit 測試只作參考） |
| 桌面 Safari / Chrome / Edge / Firefox 現行版本 | — | Chromium 已測；桌面 Safari 未測（WebKit 27.2 只作近似） |

驗收時需要收集：裝置型號、系統版本、畫面截圖（含提示面板「偵測到」一行）、
是否所有頁面都受影響、以及瀏覽器主控台（如可開啟）的第一個錯誤訊息。

---

## 8. Sprint 25：iPad 第 8 代本機相容性驗證（未含實機）

### 8.1 目標與範圍

- **目標裝置**：Apple iPad 第 8 代（邏輯解析度 810 × 1080，直向）。
- **目標系統**：iPadOS 16.4 或更新版本。
- **本階段只做本機驗證**：build 產物檢查、語法／CSS 特性比對、Chromium 與 WebKit
  自動化測試。**沒有實機**，因此不得視為實機驗收。

### 8.2 現有設定是否足夠（結論：足夠，無需改 build target）

以 `.next` 建置產物實際掃描（22 個 JS chunk、891 KB；1 個 CSS 檔、29 KB），
並對照 Safari 的支援版本：

| 特性 | 產物出現次數 | Safari 最低版本 | 是否阻礙 iPadOS 16.4 |
| --- | --- | --- | --- |
| class static block `static { }` | 1 | **16.4** | 否（剛好符合基線） |
| class private field `#x` | 1 | 14.1 | 否 |
| optional chaining `?.` | 17 | 13.1 | 否 |
| nullish `??` | 19 | 13.1 | 否 |
| logical assignment `\|\|=` 等 | 1 | 14 | 否 |
| `Array.prototype.at()` | 1 | 15.4 | 否 |
| `Object.hasOwn`（watchdog 需要） | — | 15.4 | 否 |
| `for await` | 1 | 12 | 否 |
| regex named group / unicode property escape | 各 1 | 11.1 | 否 |
| regex lookbehind / BigInt / top-level await | 0 | — | 否 |
| CSS `@property`（Tailwind 4 產出） | 35 | **16.4** | 否（剛好符合基線） |
| CSS `color-mix()` | 20 | 16.2 | 否 |
| CSS `@layer` | 5 | 15.4 | 否 |
| CSS `oklch()`／`:has()`／container query | 0 | — | 否 |

**綁定條件**正是 Safari 16.4（class static block 與 `@property`），與 Next.js 16 官方
基線一致。`package.json` 沒有自訂 `browserslist`，因此現有設定已滿足 iPadOS 16.4+，
**無需修改 build target**（依 B2「只有證據顯示不足才改」的規定，未作任何 build 設定變更）。

### 8.3 本機測試結果

| 測試 | 環境 | 結果 |
| --- | --- | --- |
| 學生流程 10 個情境（載入／作答／回饋／重新載入／下一題／私密瀏覽／未登入／500／非 JSON／網絡中斷／逾時／空清單／JS 被封鎖） | Chromium、WebKit 27.2 | 全部通過 |
| iPad 尺寸 810 × 1080（觸控）：無水平溢出、選項觸控目標 ≥44 px、可點選／提交／下一題、提示面板不出現 | Chromium、WebKit 27.2 | 通過 |
| 窄螢幕 320 × 568：無水平溢出、可閱讀及操作 | Chromium、WebKit 27.2 | 通過（修正後，見 8.4） |
| 橫向 1080 × 810：無水平溢出 | Chromium、WebKit 27.2 | 通過 |

### 8.4 本階段發現並修正的缺陷

**頁首在窄螢幕（320 px）水平溢出 269 px**：登入後的電郵徽章（寬 260 px）與名冊徽章
不可換行，把整個頁面的 `scrollWidth` 推到 589 px，學生需要橫向滾動才能看到登出按鈕。

- 修正：`src/components/AppShell.tsx` 的狀態區改為可換行（`flex-wrap`、`justify-end`、
  `min-w-0`），電郵徽章加上 `max-w-full truncate`。
- 驗證：修正後 `scrollWidth = clientWidth = 320`，溢出偵測回報 0 個元素；
  三個尺寸的版面測試全部通過（見 8.3）。
- 影響範圍：只改頁首排版，未改任何權限、資料或評分邏輯；iPad 810 px 及桌面版不受影響。

### 8.5 明確**未**驗證的項目

- iPad 第 8 代**實機 Safari** 載入、作答、捲動及觸控手感；
- iPadOS 16.4+ 的**虛擬鍵盤**（填充題聚焦時的版面位移）；
- 實機效能、記憶體壓力、長時間使用及背景切換；
- iPadOS 16.3 或更舊版本（不在目標範圍）；
- 桌面 Safari 現行版本（只以 WebKit 27.2 作近似）。

### 8.6 實機驗收清單（待執行）

1. 在 iPad 第 8 代（iPadOS 16.4+）以學生帳戶開啟練習頁；
2. 完成 3 題選擇題：點選、提交、看回饋、下一題、重新載入；
3. 以填充題測虛擬鍵盤出現時的版面（輸入框是否被遮住、是否需要捲動）；
4. 以 Safari 私密瀏覽重做一次（`localStorage` 被封鎖路徑）；
5. 將 Safari 切換到 50%／75% 頁面縮放，確認沒有水平滾動；
6. 記錄：系統版本、Safari 版本、截圖、任何主控台錯誤。


