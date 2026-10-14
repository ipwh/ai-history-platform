# 歷史自學互動網站（香港教育局歷史科課程：中一至中三）

供香港中學生使用的歷史科自學平台。學生以**學校 Google Workspace 帳戶**登入後，可揀選課題及課題內的多個**主題（分節，可多選）**，由 **AI 即時生成多項選擇題**（亦可改用教師題庫），完成練習後查看答案、解釋、知識點及**教材來源位置**；教師可上載 DOCX／PDF 教材、檢視及修正系統擷取的內容（包括**圖片 OCR 文字辨識**）、生成並查核題目。

內建**香港教育局歷史科課程（中一至中三，共 12 個課題）**的完整架構，並已匯入 `materials/` 內 12 本教師版教材 + 2 份課程指引。

平台仍聚焦「教材 → 題目 → 練習 → 成績」的核心流程，不會擴展成學校管理系統。

---

## 一、快速開始（約 3 分鐘）

### 1. 環境要求

| 項目 | 要求 | 備註 |
| --- | --- | --- |
| Node.js | **22 或以上（建議 24）** | 使用內建 `node:sqlite`，不需要額外資料庫 |
| npm | 10 或以上 | |
| 作業系統 | Windows / macOS / Linux | 已在 Windows + Node 24 測試 |

### 2. 安裝及啟動

```bash
npm install          # 安裝依賴
npm run setup        # 建立資料庫、匯入課程架構及 materials/ 內全部教材、生成題目
npm run dev          # 啟動開發伺服器
```

開啟 <http://localhost:3000> 即可使用。

**不需要任何 API key**：未設定 LLM 時會自動使用「本地示範生成」模式，網站功能完整可用；未設定 OCR 服務時會自動使用本機 OCR（tesseract.js）；未設定 Google 憑證時不啟用登入，學生以匿名學習 ID 使用。

**建議設定（選用但建議）**：

| 設定 | 作用 | 章節 |
| --- | --- | --- |
| `LLM_PROVIDER=deepseek` + `DEEPSEEK_API_KEY` | 學生揀選課題及多個主題後由 AI 即時出題（已驗證教材依據） | 七、LLM 設定 |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `AUTH_SECRET` | 讓學生以學校 Google Workspace 帳戶登入，學習記錄跟隨帳戶，並保護教師端及管理員端 | 八、角色與權限 |
| `AUTH_TEACHER_EMAILS=你的電郵` | 非校內網域帳戶（例如個人 Gmail）亦可使用教師端，方便本機測試 | 八、角色與權限 |
| `AUTH_ADMIN_EMAILS=你的電郵` | 指定管理員帳戶（可使用教材管理、OCR、課題發布及系統狀態），方便本機測試 | 八、角色與權限 |

**頁面入口**：學生端在 `/`（課題選擇）；教師端在 `/teacher`（首頁）、`/teacher/questions`（題目與回報）、`/teacher/records`（學生練習記錄）；管理員端在 `/admin`（儀表板）、`/admin/materials`（教材）、`/admin/settings`（課題與系統狀態）。教師及管理員帳戶亦可使用全部學生端功能作測試（見「三、頁面及功能」的「教師／管理員測試學生端」）。

首次執行 `npm run setup` 約需 1–2 分鐘（匯入 14 份文件、約 9,200 個段落）。如需同時辨識教材圖片內的文字，可執行 `npm run setup -- --ocr`（預設 `npm run setup` 不執行 OCR，因為圖表辨識較慢）。

### 3. 常用指令

| 指令 | 用途 |
| --- | --- |
| `npm run dev` | 啟動開發伺服器（<http://localhost:3000>） |
| `npm run build` | 建立正式版本（Next.js + Turbopack） |
| `npm run start` | 啟動正式版本（需先 `npm run build`） |
| `npm run lint` | ESLint 檢查 |
| `npm run typecheck` | TypeScript 型別檢查（先 `next typegen`） |
| `npm test` | 單元及整合測試（Vitest） |
| `npm run e2e` | 端對端流程測試（需先啟動伺服器） |
| `npm run setup` | 重建／更新示範資料（可加 `--ocr` 同時執行 OCR、`--pilot` 只匯入課題5） |
| `npm run import:materials` | 由命令列匯入 `materials/` 內的教材及校內試題（可加 `--books`、`--questions`、`--topic`、`--ocr`） |
| `npm run generate:questions` | 為各課題生成題目（`--topic`、`--count`、`--draft-only`） |
| `docker build -t hk-history-self-study .` | 建立 Cloud Run 用的容器映像檔（見第十節） |
| `./scripts/deploy-cloud-run.ps1 -Project <專案ID>` | 部署到 Google Cloud Run（預設只顯示指令，加 `-Apply` 才執行） |

端對端測試可自行啟動伺服器：

```bash
npm run build
node scripts/e2e-flow.mjs --start     # 或先 npm start，再另開視窗執行 npm run e2e
```

---

## 二、課程編排（教育局歷史科）

平台的首頁、練習設定、教材管理及題目管理均按教育局歷史科課程編排顯示：每個課題都標示**年級、課程主題及課題編號**。

| 年級 | 課程主題 | 課題 |
| --- | --- | --- |
| 中一 | 古代世界（史前時期至 14 世紀）：區域文明的誕生與交流 | 課題1 人類的需要：古與今<br>課題2 歐洲文明的發展<br>課題3 伊斯蘭文明的興起與中古時代歐亞的文化交流<br>課題4 早期香港地區的歷史、文化與傳承 |
| 中二 | 近代世界（15 至 19 世紀）：西力的形成與外延 | 課題5 近代歐洲的興起<br>課題6 歐洲國家的殖民擴張<br>課題7 美國的成立及發展<br>課題8 香港直至19世紀末的成長與發展 |
| 中三 | 現代世界（20 世紀至今）：邁向多極與相互依存 | 課題9 20世紀的國際紛爭及危機(I)–兩次世界大戰<br>課題10 20世紀的國際紛爭及危機(II)–冷戰及後冷戰時代<br>課題11 20世紀以來的國際合作<br>課題12 20世紀香港的成長與蛻變 |

- 課程架構定義於 [src/server/seed/curriculum.ts](src/server/seed/curriculum.ts)：每個課題包含分節、子分節、教材檔名及分節關鍵詞。
- 課程的**學習目標**及每個課題的**學習重點（精簡摘要）**（按教育局《歷史科學習目標》及《預期學習內容》整理）定義於 [src/server/seed/curriculum-focus.ts](src/server/seed/curriculum-focus.ts)：出題提示詞會把所屬課題的學習重點一併交給模型，讓題目切合課程範圍及考核要求（詳見第七節）。
- 另設「教師參考：歷史科課程指引」分類（`level = 0`），用於存放 `materials/` 內的課程指引 PDF；它**不會**出現在學生的課題選擇頁，只供教師查閱。
- 課題的發布狀態可透過 `PATCH /api/admin/topics/[topicId]` 或 `src/server/seed/curriculum.ts` 管理。

### 各課題的教材與分節

`materials/` 以**課題資料夾**存放教材（2026 學年更新），每個資料夾內有書本內容及 7 份校內試題：

```
materials/
  課題5 近代歐洲的興起/
    課題5 近代歐洲的興起.docx        ← 書本內容（AI 出題依據，匯入教材段落）
    HNC2A2E_QB_T5_1.MCQ.docx       ← 校內試題：選擇題
    HNC2A2E_QB_T5_2.FBQ.docx       ← 填充題
    HNC2A2E_QB_T5_3.TFQ.docx       ← 是非題
    HNC2A2E_QB_T5_4.MUQ.docx       ← 配對題（平台尚未支援，匯入時略過並記錄）
    HNC2A2E_QB_T5_5.COQ.docx       ← 時序題（平台尚未支援，匯入時略過並記錄）
    HNC2A2E_QB_T5_6.LAQ.docx       ← 長題目（轉為短答題）
    HNC2A2E_QB_T5_7.DBQ.docx       ← 資料題（轉為短答題）
  歷史科課程指引.pdf、官方_個人、社會及人文教育_課程指引.pdf   ← 教師參考
```

| 課題 | 書本內容（相對 `materials/`） | 教材段落 | 題庫題數 |
| --- | --- | --- | --- |
| 課題1 人類的需要：古與今 | `課題1人類的需要 古與今/課題1人類的需要 古與今.docx` | 148 | 116 |
| 課題2 歐洲文明的發展 | `課題2 歐洲文明的發展/課題2 歐洲文明的發展.docx` | 548 | 209 |
| 課題3 伊斯蘭文明的興起與中古時代歐亞的文化交流 | `課題3 伊斯蘭文明的興起/課題3 伊斯蘭文明的興起.docx` | 298 | 90 |
| 課題4 早期香港地區的歷史、文化與傳承 | `課題4 早期香港地區的歷史/課題4 早期香港地區的歷史.docx` | 357 | 105 |
| 課題5 近代歐洲的興起 | `課題5 近代歐洲的興起/課題5 近代歐洲的興起.docx` | 802 | 719 |
| 課題6 歐洲國家的殖民擴張 | `課題6 歐洲國家的殖民擴張/課題6 歐洲國家的殖民擴張.docx` | 248 | 275 |
| 課題7 美國的成立及發展 | `課題7 美國的成立及發展/課題7 美國的成立及發展.docx` | 326 | 241 |
| 課題8 香港直至19世紀末的成長與發展 | `課題8 直至二十世紀初香港的成長與發展/課題8 直至二十世紀初香港的成長與發展.docx` | 263 | 237 |
| 課題9 20世紀的國際紛爭及危機(I)–兩次世界大戰 | `課題9 20 世紀的國際紛爭及危機 (I) — 兩次世界大戰/…docx` | 718 | 739 |
| 課題10 20世紀的國際紛爭及危機(II)–冷戰及後冷戰時代 | `課題10 20 世紀的國際紛爭及危機 (II) — 冷戰及後冷戰時代/…docx` | 980 | 693 |
| 課題11 20世紀以來的國際合作 | `課題11 20世紀以來的國際合作/課題11 20世紀以來的國際合作.docx` | 237 | 243 |
| 課題12 20世紀香港的成長與蛻變 | `課題12 二十世紀香港的成長與蛻變/課題12 二十世紀香港的成長與蛻變.docx` | 484 | 361 |
| 教師參考：歷史科課程指引 | `歷史科課程指引.pdf`、`官方_個人、社會及人文教育_課程指引.pdf` | 3,463 | — |

題數為實際匯入題庫的數目（`npm run import:materials`，2026 年 10 月實測）：共 **4,028 題**，其中 49 題為示範題庫（課題5，已發布），其餘為校內試題（**草稿，待教師審核**）。匯入方式見第五節。

> **課題1 考核範圍**：本校只考核「古埃及文明（尼羅河流域）」，新月沃土文明、（黃河、長江流域）中華文明及印度河流域文明**不會**寫入資料庫、不會出現在學生端，亦不會成為題目內容（規則見 [src/server/materials/exclusions.ts](src/server/materials/exclusions.ts)，資料庫遷移 `0008` 會清除舊資料）。匯入時會略過相關段落、分節及題目。

（課題5 的分節結構：文藝復興、宗教改革、科學革命與啟蒙運動、工業革命、法國大革命及拿破崙時代，各含子分節，共 23 個分節節點。）

系統會依「分節標題／關鍵詞 + 文件次序」自動把段落分配到分節（實測 9,251 段中 97% 以上可自動對應）；教師可在 `/admin/materials` 逐一修正。分節關鍵詞儲存於 `sections.match_keywords_json`，可透過 `PATCH /api/admin/sections/[sectionId]` 更新。

---

## 三、頁面及功能

### 學生端

| 頁面 | 路徑 | 功能 |
| --- | --- | --- |
| 學校帳戶登入 | `/login` | 以學校 Google Workspace 帳戶登入（未設定憑證時顯示設定說明） |
| 課題選擇 | `/` | **只有 12 個課題按鈕**（中一／中二／中三各 4 個），顯示課題編號、名稱及主題數；點選課題後直接進入練習設定 |
| 練習設定 | `/practice/new?topic=…&section=…` | 依分節分組揀選主題（可多選／可全選一個分節）、題型、難度、題數、**出題方式（AI 即時生成／使用題庫）**、完整練習或重溫錯題 |
| 練習作答 | `/practice/[sessionId]` | 一次一題、進度顯示、提交後顯示答案／解釋／知識點／教材來源；填充題及短答題另有 **AI 語意批改**；每題可**回報問題** |
| 練習結果 | `/practice/[sessionId]/result` | 完成題數、答對題數、正確率、需重溫知識點、逐題回顧（含 AI 批改結果）、針對錯題再練習；教師／管理員測試時另有返回後台首頁的入口 |
| 我的帳戶 | `/account` | 登入狀態及身分（學生／教師／管理員）、**班別及學號（來自學生名冊）**、登出；教師及管理員另有後台入口 |

- **首頁刻意保持簡潔**：只列出 3 個年級、每級 4 個課題（共 12 個按鈕），避免一次顯示過多資訊。
- **點選課題後直接進入「練習設定」**：課題編號及名稱只在課題卡片顯示一次；由於練習設定內已有分節及主題可選，學生毋須再經另一個「選擇分節及主題」頁面重複選擇。
- **課題 → 分節 → 主題**的選擇集中在練習設定：
  - 練習設定的「1. 選擇主題（可多選）」把主題按分節分組，每個分節有「全選此分節（n/N）」可一次選取，亦可逐個主題挑選；右上角顯示「已選 N 個主題」及「清除選擇」。
  - 已選取的主題會以藍底顯示；整個分節全選時，該分節群組會加框強調。
- **不顯示分節題目數量**：題目數量只反映題庫存量，與「可否練習」無關（設定了 AI 後，任何已匯入教材的主題都可以即時出題），因此介面改為顯示主題數，只在示範模式（沒有 AI）才額外顯示題庫題數，避免學生誤會「0 題 = 不能練習」。
- 分節或主題若**既無已發布題目、亦無教材段落**，會標示「未有教材」並停用，避免學生選了卻出不到題。相關欄位為 `materialBlockCount`（含子分節）及 [src/lib/types.ts](src/lib/types.ts) 的 `isSectionPractisable`。
- **填充題及短答題由 AI 按語意批改**（`LLM_GRADING_ENABLED`，預設開啟；需設定真正的 LLM provider）：
  - **填充題**：先做字詞比對（含全形／半形、標點、可接受寫法）；比對不合格時交由 AI 判斷學生的答案在意思上是否等同標準答案（例如「文藝復興時期」與「文藝復興」），意思相同即當作**答對**並計入正確率，另附 AI 說明。已比對成功的答案不會再呼叫 AI，節省時間及費用。
  - **短答題**：本來不會自動評分，現在 AI 會逐項核對「得分要點」，列出**已達到／未達到的要點**及具體建議；仍保留「我已掌握／需要重溫」自我檢查按鈕，學生可覆核 AI 的判斷。**短答題不計入正確率**，避免與正式 HKDSE 評分混淆。
  - AI 批改以題目、參考答案、得分要點及解釋作依據，**不可以改變標準答案**；提示詞明確要求「用字、詞序、繁簡、同義詞、錯別字、補充說明或語句不完整都不可直接判錯」。
  - 批改結果會寫入作答記錄（`attempts.ai_grading_json`），重新載入頁面毋須重複呼叫 AI；被 AI 判定未達到要求的短答題亦會列入「需要重溫」及可「針對錯題再練習」。
  - **批改失敗不會影響作答**：未設定 AI、逾時或回應格式不合時，系統會沿用原本的字詞比對／自我檢查，並在介面註明「AI 語意批改暫時無法使用」。
  - 介面多處明確標示這**不是正式 HKDSE 評分**，只作練習參考。
- **AI 生成的題目不含 Markdown／標題符號**：提示詞要求純文字（不可出現 #、##、**、- 等），[validation.ts](src/server/llm/validation.ts) 亦會過濾行首或句中誤插的標題記號（`stripMarkdownArtifacts`），確保短答題的中文語句通順。教材原文節錄（`sourceExcerpt`）不受影響，仍須逐字對應教材。
- **出題方式有兩種**：
  - **AI 即時生成題目**（預設，已設定 AI provider 時）：學生揀選課題及多個主題（分節）後，系統把題數平均分配到各主題，即時按該主題的教材內容出題，每題都經教材依據驗證。生成需時約 3 至 20 秒（視題數及主題數）。若某個主題的教材內容不足以出題，系統會由其他已成功出題的主題補足題數，並在練習頁如實說明實際題數。
  - **使用題庫題目**：由教師已發布的題目及內建示範題庫組題，不足時才即時生成。
  - AI 即時生成的題目**只存放在該次練習的快照內**，不會自動寫入題庫，因此不會令題庫膨脹；學生仍可作答、看成績及重溫錯題。
- **難度會影響題目內容**：練習設定可選基礎／進階／挑戰。使用 AI 時，系統會把該難度的要求寫入提示詞（基礎＝辨認教材字詞／史實、進階＝理解說明、挑戰＝分析比較或時序因果）；使用本地示範生成（示範模式）時，三個難度採用不同的出題規則（見「七、LLM 設定」）。
- **登入（可選）**：設定 Google 憑證後，學生須以學校帳戶登入，學習記錄跟隨帳戶；未設定時系統在瀏覽器產生**匿名學習 ID**（UUID），不要求姓名、電話等個人資料。詳見「八、角色與權限」。
- **學生名冊（可選）**：可連接 Google Sheet 名冊，只限名冊內的學生登入；登入後頁首會顯示「班別 學號」標籤，「我的帳戶」會顯示班別、學號及「已在學生名冊核對」。名冊只存放班別、學號、姓名及電郵，不含密碼。
- **重溫錯題**：只抽取你之前答錯，或在短答題自我檢查中標記「需要重溫」的題目，並依你這次選擇的主題（分節）及題型篩選；題目會由該次練習的記錄取回，因此 AI 即時生成的題目同樣可以重做。
- **作答前不會顯示答案**：API 回傳的題目資料不含 `correctAnswer`、`explanation`、`sourceExcerpt`。
- **選擇題選項次序會打亂**：組成練習時會隨機排列選項（標準答案以文字比對，不受影響），令正確答案平均分佈於各位置，避免學生只靠固定的答案位置取分。
- 題目不會要求學生參考「教材」、「上文」或「標題」：開頭的引導語（例如「根據教材，…」、「綜合教材所述，…」）會自動移除；題目或選項若仍提及教材／上文／標題，整條題目會被丟棄（`MATERIAL_REFERENCE`），因為學生作答時不會看到教材。純標題段落亦不會用來出題。
- **短答題不會自動評分**：系統提供參考答案及得分要點，學生自行標記「我已掌握／需要重溫」，介面明確說明這不是正式 HKDSE 評分。
- 若題目的教材依據來自 OCR 辨識文字，答案頁會標示「來源為 OCR 辨識」，提醒學生以課本為準。
- **每題都可「回報此題」**：學生可選問題類別（題目不清楚／答案有爭議／解釋不明白／教材來源有問題／其他）並填寫補充說明（最多 500 字）。回報會寫入資料庫，令該題在教師端顯示「待覆核」，**不會**自動刪除或停用題目；同一學生重複回報同一題目不會產生重複記錄，而回報只會記錄學習者身分（教師端只顯示「學生回報」，不會顯示姓名或電郵）。**AI 即時生成的題目（只存在於該次練習快照、未存入題庫）同樣可以回報**，教師端會以「AI 即時生成題目」標籤及「只存於該次練習，未存入題庫」標示，並附上該題文字供核對。
- 已提交的題目重複提交不會改變分數，避免看到答案後再作答影響成績。
- 手機及桌面版均已驗證（手機為單欄排版，無水平捲動）。
- **教師或管理員以學生身分進入學生端時**，頂部會顯示「教師測試模式」／「管理員測試模式」橫幅及返回後台首頁的連結，說明練習記錄只屬於該帳戶、不會影響學生。

### 教師端

教師端只保留**出題相關功能**及**查看學生練習記錄**，其餘（教材、OCR、課題發布、系統狀態）已移至管理員端。

| 頁面 | 路徑 | 功能 |
| --- | --- | --- |
| 教師端首頁 | `/teacher` | 題庫概況（題目總數／已發布／草稿／已停用／校內試題待核對／未通過教材核對／待覆核回報）、學生練習記錄數量及常用操作入口 |
| 題目管理 | `/teacher/questions` | 生成題目預覽（附教材依據）、手動新增／編輯／發布／停用／刪除題目、依分節及狀態篩選、**題目回報覆核**（可按狀態及課題篩選，標記已處理／已略過／重設待覆核；即時生成題目會標示「AI 即時生成題目」及「只存於該次練習，未存入題庫」） |
| 題目生成與審核 | `/teacher/questions/generate` | 同上，預設捲動至生成區塊，方便直接出題及審核 |
| 學生練習記錄 | `/teacher/records` | 查閱學生練習記錄（可按課題、學習者及日期篩選），顯示作答日期、課題、題型、答對及答錯的題目，並可**下載 CSV** 存檔（每題一列，含學生答案、正確答案及結果） |

### 管理員端

管理員擁有教師的全部功能，另可管理教材、OCR、課題發布及系統狀態。

| 頁面 | 路徑 | 功能 |
| --- | --- | --- |
| 管理員儀表板 | `/admin` | 課題／教材／段落／OCR／題庫／待覆核回報統計、系統狀態（版本、資料庫、LLM、OCR、登入、部署提示）、最近 7 天 AI 用量及批改成功率、全部功能的常用操作入口 |
| 教材管理 | `/admin/materials` | 按課題（含年級分組）列出教材、上載 DOCX／PDF、批次匯入 `materials/` 全部教材、執行 OCR、檢視檔案狀態及錯誤訊息、擷取內容預覽（可只顯示 OCR 段落）、修改段落分節、指定課題、刪除教材 |
| 教材內容 | `/admin/materials/[documentId]` | 直接展開指定教材的段落、OCR 狀態、分節對應及教材依據修正 |
| 課題與系統狀態 | `/admin/settings` | 課題發布狀態（學生端只看到已發布的課題）、系統狀態、環境變數提示及部署提醒 |

- **舊路徑相容**：`/teacher/materials` 會轉址至 `/admin/materials`、`/teacher/settings` 轉址至 `/admin/settings`、`/admin/questions` 轉址至 `/teacher/questions`。
- 「示範資料（內建）」與「已上載教材」以標籤清楚區分（資料庫 `kind` 欄位）。
- 教師端（`/teacher` 及 `/api/teacher/*`）只限教師及管理員帳號；管理員端（`/admin` 及 `/api/admin/*`）只限管理員帳號。學生帳戶會收到 `403`，未登入會收到 `401`。未啟用登入時維持開放（僅適合本機示範）。
- 解析失敗時顯示可理解的錯誤訊息（例如不支援 `.doc`、PDF 沒有文字層），不會中斷網站。
- 每個教材文件都顯示 OCR 狀態（未執行／辨識中／完成／部分完成）及辨識張數、跳過張數及原因。
- 生成題目會顯示每一題的**教材原文節錄、來源位置及對應段落 ID**，方便教師查核；未見於教材的人名／條約名會標示品質警告，學生回報的題目會標示「待覆核回報」。

### 教師／管理員測試學生端

教師及管理員帳戶本身已可使用**全部學生端功能**，方便完整測試學生體驗：

1. 以教師或管理員帳戶登入後，頂部導覽的「學生端測試」即為學生端首頁（`/`）；亦可由教師端或管理員端首頁的「學生端測試」入口進入。
2. 選擇課題 → 練習設定（分節／主題多選、題型、難度、題數、AI 即時生成或題庫）→ 作答 → 查看答案、解釋、知識點及教材來源 → 成績 → 重做錯題。
3. 學生端頂部會顯示「教師測試模式」／「管理員測試模式」橫幅，說明現正以後台身分使用學生端，練習記錄只屬於該帳戶。
4. 學生、教師及管理員的學習記錄以**不同學習者身分**儲存（`school:<電郵>`／`teacher:<電郵>`／`admin:<電郵>`），不會混用；教師及管理員無法透過學生端讀取任何學生的練習記錄。
5. 練習記錄一律留檔（學生端沒有刪除記錄功能）；「我的帳戶」（`/account`）只提供登入狀態及登出。

---

## 四、技術架構

```
瀏覽器（React 客戶端元件）
   │  fetch /api/...
   ▼
Next.js Route Handlers（src/app/api/**）      ← 唯一後端入口，統一回應格式
   ▼
服務層（src/server/services/**）               ← 業務流程：組題、評分、成績、教材匯入、題庫生成
   ├── LLM 服務層（src/server/llm/**）         ← provider 介面 + mock + DeepSeek + Gemini + OpenAI 相容
   ├── 登入／授權層（src/server/auth/**）       ← Google OAuth、工作階段 cookie、角色判定、guards.ts 集中守衛
   ├── 檔案儲存層（src/server/storage/**）     ← provider 介面 + 本機（data/uploads）+ Cloud Storage（預留）
   ├── OCR 服務層（src/server/ocr/**）         ← provider 介面 + tesseract.js + Google Vision
   ├── 教材解析層（src/server/materials/**）   ← DOCX（mammoth）、PDF（unpdf）、分節對應
   └── 資料存取層（src/server/repositories/**）← 所有 SQL 只在這裡
          ▼
      SQLite（node:sqlite，檔案：data/app.db）
```

- **共用資料契約**：[src/lib/types.ts](src/lib/types.ts) 以 zod schema 為唯一事實來源，前端及後端共用同一份型別。
- **LLM 只會在伺服器端呼叫**：前端永遠不會接觸 API key；key 只由環境變數讀取（[src/server/config.ts](src/server/config.ts)）。
- **資料庫**：使用 Node.js 內建 `node:sqlite`（無原生依賴）；所有 SQL 集中在 `src/server/db/` 及 `src/server/repositories/`，route handler、服務層及元件都不會直接執行 SQL，日後要換成 Cloud SQL 只需替換這一層。
- **檔案儲存**：教材原始檔及 OCR 需要的檔案經 [src/server/storage/](src/server/storage/) 的 provider 存取（本機 / Cloud Storage），業務邏輯不會寫死本機路徑。
- **權限**：所有 API 守衛集中在 [src/server/auth/guards.ts](src/server/auth/guards.ts)（`requireSignedIn`／`requireTeacher`／`resolveLearnerId`），route handler 開頭一律檢查角色；學習者 ID 只由工作階段推導。

### 目錄重點

```
src/lib/types.ts                  資料契約（zod schema + 型別）
src/server/config.ts              環境變數與伺服器設定
src/server/config-diagnostics.ts  設定驗證（缺少憑證、暫時性儲存、Cloud Run 偵測、備份狀態）
src/server/instrumentation.ts     啟動掛勾：還原雲端備份並啟動備份排程
src/server/db/                    連線、migration 清單、Cloud Storage 資料庫備份（backup.ts）
src/server/repositories/          SQL 存取（topics / materials / questions / practice / learners / reports / llm-logs）
src/server/storage/               檔案儲存 provider（local / gcs 預留）
src/server/materials/             DOCX、PDF 解析、圖片與段落對應、分節對應、匯入流程、校內試題解析、教材檔案掃描
src/server/ocr/                   OCR provider 介面、tesseract.js、Google Vision、PNG 編碼
src/server/auth/                  Google OAuth、工作階段 cookie、角色判定、guards.ts 集中授權
src/server/llm/                   provider 介面、mock、DeepSeek、Gemini、OpenAI 相容、輸出驗證
src/server/services/              練習流程、題目生成、題庫批次生成、OCR、教材管理、評分、回報、AI 用量統計
src/server/seed/                  教育局課程架構、學習重點（精簡摘要）、示範題庫、教材依據核對
src/app/api/                      REST API（學生端、教師端 /api/teacher/**、管理員端 /api/admin/**）
src/app/                          頁面（學生端 /、/practice/**、/account；教師端 /teacher/**；管理員端 /admin/**）
src/components/                   前端元件
tests/                            Vitest 測試（25 個測試檔）
scripts/setup.ts                  初始化示範環境
scripts/import-materials.ts       命令列匯入教材
scripts/generate-question-bank.ts 命令列批次生成題目
scripts/e2e-flow.mjs              端對端流程測試
```

### 主要 API

| 方法及路徑 | 用途 |
| --- | --- |
| `GET /api/health` | 健康檢查：版本、資料庫狀態（不含路徑）、LLM／OCR provider、登入及後台保護狀態、資料備份狀態（是否啟用、上次備份時間） |
| `GET /api/auth/session` | 目前登入狀態及學校帳戶（未啟用登入時 `enabled: false`） |
| `GET /api/auth/google/start` | 開始 Google 登入（導向 Google 同意頁） |
| `GET /api/auth/google/callback` | Google 回呼：建立工作階段 cookie |
| `POST /api/auth/sign-out` | 登出（清除工作階段 cookie） |
| `GET /api/topics?learnerId=` | 課題（含年級分組）、分節及進度 |
| `GET /api/topics/[topicId]?learnerId=` | 單一課題的詳細內容（分節、主題、教材可用性、進度） |
| `POST /api/practice` | 建立練習（回傳不含答案的題目；`questionSource: "ai"` 為即時生成） |
| `GET /api/practice/[sessionId]?learnerId=` | 取得題目及已作答題目的回饋 |
| `POST /api/practice/[sessionId]/answers` | 提交答案，回傳答案、解釋、知識點、教材來源 |
| `POST /api/practice/[sessionId]/self-assessment` | 短答題自我檢查 |
| `POST /api/practice/[sessionId]/complete` | 完成練習並取得成績 |
| `GET /api/practice/[sessionId]/result?learnerId=` | 重看成績 |
| `POST /api/reports` | 學生回報題目（`{ learnerId, questionId, sessionId, reason, detail }`；已登入時忽略前端 learnerId；題庫題目及 AI 即時生成的題目都可回報） |
| `GET/POST /api/admin/materials` | 教材清單／上載（亦可用 `source=pilot` 匯入專案內試點教材）—**管理員** |
| `GET/POST /api/admin/materials/[documentId]/ocr` | 查詢 OCR 狀態／開始辨識（背景執行，`?wait=1` 為同步） |
| `GET/POST /api/admin/materials/import` | 列出 `materials/` 內可匯入檔案／批次匯入（`{ "all": true, "runOcr": true }`） |
| `GET/PATCH/DELETE /api/admin/materials/[documentId]` | 段落預覽／指定課題／刪除 |
| `PATCH /api/admin/materials/blocks/[blockId]` | 修改段落內容或分節 |
| `GET /api/teacher/overview` | 教師端首頁統計（題庫狀態、待覆核回報、練習記錄數量）—**教師及管理員** |
| `GET/POST /api/teacher/questions` | 題目清單／手動新增 |
| `POST /api/teacher/questions/generate` | 生成題目（含驗證及教材依據核對） |
| `PATCH/DELETE /api/teacher/questions/[questionId]` | 發布／停用／編輯／刪除題目 |
| `GET/PATCH /api/teacher/reports` | 題目回報清單（可按狀態／課題篩選）／更新回報狀態（只影響回報，不會改動題目） |
| `GET /api/teacher/records` | 學生練習記錄（可按 `topicId`、`learnerId`、`from`／`to` 日期篩選），每筆含作答日期、課題、題型及答對／答錯的題目 |
| `GET /api/teacher/records/export` | 下載學生練習記錄 CSV（同樣支援上述篩選；UTF-8 BOM，Excel 可直接開啟） |
| `PATCH /api/admin/sections/[sectionId]` | 修改分節名稱、說明及關鍵詞（**管理員**） |
| `PATCH /api/admin/topics/[topicId]` | 發布／取消發布課題（**管理員**） |
| `GET /api/admin/system/health` | 管理員端系統狀態（版本、資料庫、LLM、OCR、登入、部署提示、環境變數問題）（**管理員**） |
| `GET /api/admin/system/overview` | 管理員儀表板統計（課題／教材／題庫／回報）及 AI 用量、批改成功率（**管理員**） |

**權限分工**：`/api/teacher/*` 只包含出題相關（題目、回報）及學生練習記錄，教師及管理員皆可使用；
`/api/admin/*` 包含教材、OCR、分節、課題發布及系統狀態，只限管理員。舊路徑
`/api/teacher/materials*`、`/api/teacher/sections/*`、`/api/teacher/topics/*`、`/api/teacher/system/*` 及
`/api/admin/questions*` 已移除，請改用上表的新路徑。

---

## 五、教材匯入

> **教材檔案不在倉庫內**：`materials/` 內的課程指引、出版社溫習筆記及校內試題庫屬第三方版權內容，
> 已加入 `.gitignore` 不會上載到 GitHub。請先向歷史科教師索取教材，放到 `materials/` 的對應位置
> （結構見 [materials/README.md](materials/README.md)），再按下文匯入。

### 方式 1：管理員介面上載（建議）

1. 開啟 `/admin/materials`。
2. 選擇課題（可留空，系統會嘗試由檔名或所在資料夾判斷，例如 `課題5 近代歐洲的興起/…docx` → 課題5）。
3. 選擇 `.docx` 或 `.pdf` 檔案，系統會即時解析並顯示結果；如已設定 OCR 並勾選「上載後執行 OCR」，會同時辨識圖片文字。

### 方式 2：命令列匯入 `materials/` 內的教材（建議用於首次建立）

```bash
npm run import:materials                          # 匯入 12 個課題的書本內容及全部校內試題（建議）
npm run import:materials -- --books               # 只匯入書本內容（AI 出題依據）
npm run import:materials -- --questions           # 只匯入校內試題（題庫草稿）
npm run import:materials -- --topic topic-5       # 只匯入指定課題
npm run import:materials -- --ocr                 # 匯入後執行 OCR（辨識圖片文字）
```

管理員端亦可按「匯入 materials 資料夾全部教材」一次匯入全部課題的書本內容及校內試題。
`materials/` 的檔案會遞迴掃描，課題以**所在資料夾**優先判斷。

### 校內試題（題庫來源）如何匯入

- 匯入後題目一律為**草稿**（`status = draft`、`origin = school-paper`），教師需在 `/teacher/questions` 核對後才發布給學生。
- 答案**完全取自試題檔的答案區**，程式不會自行推測；格式不完整的題目會略過並在匯入報告列出原因。
- 題目 ID 由試題檔的題號推導（例如 `NJCMN0060000001` → `qb-NJCMN0060000001`），**重複匯入會更新同一題**，不會產生重複題目。
- 試題檔有兩種排版（`[[題號 … ]]` 與 `|!|題號|!|`），兩者都會解析；是非題轉為「是／非」兩個選項的選擇題，長題目及資料題轉為短答題並保留評卷參考的得分要點。
- **配對題（MUQ）及時序題（COQ）平台尚未支援**：會略過並在報告中列出題數，教師日後可用手動建立功能補上。
- 題目若需原檔的圖片（地圖、漫畫、照片等）才能作答，會標示「品質警告」，教師在題目管理會看到提示，避免學生看到無法作答的題目。
- 不考核範圍（課題1 的新月沃土／黃河、長江流域／印度河三個文明）的題目不會匯入；古埃及文明的題目可以匯入。
- 校內試題檔的段落**不會**作為 AI 出題依據（只作題庫來源），避免以答案文字出題。

### 上載檔案的保存位置

教師上載的原始檔案會另存於 `data/uploads/`（資料庫只記錄路徑），方便日後重新解析或匯出；`data/` 已被 `.gitignore` 忽略，不會被提交。

> **同名教材會視為重新匯入**：再次匯入相同檔名的教材時，系統會先移除舊版本（連同其段落）再匯入新版本，避免重複教材。匯入後會自動用原文節錄為受影響的題目重新定位教材依據（標題、段落及表格列皆可比對）：找得到就更新對應段落並保持「已核對」，找不到則標示為「未通過教材依據核對」，提醒教師在 `/teacher/questions` 重新檢查。教材變更後亦應重新執行 OCR（介面的「匯入後執行 OCR」會自動處理）。

### 試點教材（課題5）

- 檔案：`materials/課題5 近代歐洲的興起/課題5 近代歐洲的興起.docx`
- 課題：**課題5：近代歐洲的興起**
- 擷取結果：約 800 個段落（標題／清單／段落／表格）；圖片未能辨識時仍只標示「圖片內容未能自動擷取」，已辨識的會加入 OCR 文字。
- 分節結構（5 個主要分節，共 23 個分節節點）：
  1. 文藝復興（主要特點、出現原因、起源與發展、文學、藝術與自然科學、影響）
  2. 宗教改革（背景、發展、影響）
  3. 科學革命與啟蒙運動（科學革命的原因、發展及影響；啟蒙運動的背景、思想、傳播及影響）
  4. 工業革命（特點及出現原因、英國率先展開的原因、主要發展、工業革命的影響）
  5. 法國大革命及拿破崙時代（背景與成因、革命經過、拿破崙的上台、改革與帝國、法國大革命及拿破崙時代的影響）

系統會依「分節標題／關鍵詞 + 文件次序」自動把段落分配到分節；教師可在 `/admin/materials` 逐一修正。分節關鍵詞儲存於 `sections.match_keywords_json`，可透過 `PATCH /api/admin/sections/[sectionId]` 更新。

### 支援限制

| 格式 | 支援情況 |
| --- | --- |
| `.docx` | 支援標題、清單（含巢狀）、段落、表格（保留合併儲存格）。圖片會保留位置；**可用 OCR 辨識圖片內的文字**（見第六節）。 |
| `.pdf` | 擷取文字層；**沒有文字層的頁面會以頁面圖片進行 OCR**；沒有可辨識內容時會如實顯示「沒有可擷取的文字層」而不會猜測內容。 |
| `.doc`、其他格式 | 不支援，會回報清楚的錯誤訊息（課題2 的試題檔目前是舊版 `.doc`，請在 Word 另存為 `.docx` 後再匯入）。 |

---

## 六、OCR 圖片文字辨識

教材（尤其是教師版 DOCX）大量使用圖表、地圖及思維導圖，當中有不少文字。這些文字會以 OCR 辨識後**加入教材段落**，成為生成題目的素材。

### OCR provider

| Provider | 設定 | 說明 |
| --- | --- | --- |
| `tesseract`（預設） | 不需設定 | 使用 [tesseract.js](https://github.com/naptha/tesseract.js) 在本機執行，**不需要 API key**，亦可離線使用。首次執行會下載繁體中文語言資料（存放於 `data/ocr-cache/`）。 |
| `google-vision` | `OCR_PROVIDER=google-vision` + `OCR_API_KEY` | Google Cloud Vision API，準確度較高（尤其是圖表），按用量收費。 |
| `none` | `OCR_PROVIDER=none` | 完全停用 OCR，圖片段落只會顯示「圖片內容未能自動擷取」。 |

設定範例（`.env.local`）：

```env
# 使用本機 OCR（預設值，可省略）
OCR_PROVIDER=tesseract
OCR_LANGUAGES=chi_tra

# 或使用 Google Cloud Vision
# OCR_PROVIDER=google-vision
# OCR_API_KEY=你的 API key
```

其他可調參數（詳見 [.env.example](.env.example)）：`OCR_PAGE_SEG_MODE`（預設 `11`，SPARSE_TEXT，適合散落文字的圖表）、`OCR_MIN_CHARS`、`OCR_SKIP_LOW_CONFIDENCE`、`OCR_MAX_IMAGES`、`OCR_IMAGE_TIMEOUT_MS`、`OCR_RUN_TIMEOUT_MS`、`OCR_CACHE_PATH`、`OCR_LANG_PATH`。

如需**完全離線**執行：把 `chi_tra.traineddata` 放到某個目錄，再設定 `OCR_LANG_PATH` 指向該目錄即可（不需連接網絡）。

### 使用方式

1. **整套教材**：`npm run setup -- --ocr`，或 `npm run import:materials -- --ocr`。
2. **單一文件**：在 `/admin/materials` 教材清單按該文件的「執行 OCR」，或在同一頁上載教材時勾選「上載後執行 OCR」。
3. **API**：
   - `GET /api/admin/materials/[documentId]/ocr` 查詢狀態（辨識張數、跳過張數、說明）
   - `POST /api/admin/materials/[documentId]/ocr` 開始辨識（背景執行，介面會自動輪詢）；加 `?wait=1` 會同步完成後才回應
   - `GET /api/admin/materials/import` 列出 `materials/` 內可匯入的檔案、對應課題及目前 OCR 引擎
   - `POST /api/admin/materials/import` 批次匯入（`{ "all": true, "runOcr": true }`）

### 實測結果（`materials/` 內 14 份文件）

| 項目 | 數量 |
| --- | --- |
| 教材段落 | 9,333 段（其中 82 段由 OCR 辨識所得） |
| 圖片段落 | 360 段 |
| 文件中圖片總數 | 496 張 |
| 可辨識格式（PNG 198 張、JPEG 94 張） | 292 張 |
| 不支援格式（EMF／WMF／WDP，向量或專有格式） | 67 張 |
| 已辨識出文字並加入教材 | 82 張 |
| 沒有可用文字（格式不支援或字數不足） | 419 張／頁 |

### 支援限制（重要）

| 情況 | 系統行為 |
| --- | --- |
| `.emf`、`.wmf`、`.wdp` 圖片 | **無法辨識**（屬向量／專有格式，需先轉成點陣圖）。系統會如實回報，例如「18 張圖片為不支援的格式（.EMF）」，不會猜測內容。 |
| 掃描／手寫文字 | 辨識率較低，結果可能不完整。 |
| 地圖、時間軸等圖表 | 文字散落各處，辨識結果可能是零散單字。系統會把這類文字標示為 OCR 擷取並保留給教師參考，但**規則式（本地示範）生成會略過這類雜訊**，避免產生無意義題目；使用真正 LLM 時仍會把原文交給模型判斷。 |
| 辨識文字的使用 | OCR 文字會以「（以上文字由 OCR 從圖片擷取：檔案 · 圖片路徑）」標示，來源位置亦會加上「· OCR 擷取」，**教師必須在 `/admin/materials` 核對後才發布相關題目**。 |
| 剩餘圖片 | 未能辨識的圖片仍會顯示「圖片內容未能自動擷取」，系統不會虛構內容。 |

> OCR 是輔助工具：辨識結果可能有錯漏，網站不會把 OCR 文字當作已核實的史實。教師在 `/admin/materials` 的段落預覽中可勾選「只顯示 OCR 段落」集中檢查。

---

## 七、LLM 設定

### 預設：本地示範生成（`LLM_PROVIDER=mock`）

- 規則式生成，**不需要 API key**。
- 只產生答案唯一的題型：定義句（「詞語：說明」）、年份題、引號詞語挖空。
- **難度（`difficulty`）會改變出題規則**，令示範模式下的「難度選擇」真正影響題目內容：
  - **基礎**：直接辨認教材的關鍵詞語——選擇題「…」是指哪一個詞語？、填充題填寫詞語、短答題解釋詞語（1–2 個得分要點）。
  - **進階**：以句子挖空為主（「引號詞語」／年份）；選擇題改為「以下哪一項是「X」的說明？」，短答題為「試說明與「X」相關的內容。」（最多 4 個得分要點）。
  - **挑戰**：以年份（時序）挖空為主；短答題須綜合較多要點（最多 5 個）。
  - 每個難度都有後備模板：該分節的教材不足以支持該難度的模板時（例如句子內沒有足夠年份），會自動退到下一個模板，不會因此減少可出的題目數量。
- 為避免產生無意義的題目，以下素材不會用來出題（使用真正 LLM 時仍會交給模型判斷）：
  - **標題（heading）段落**：標題只是結構，本身沒有可作答的內容；若把標題交給模型，會得出「以下哪一項是教材中提及的主題？」這類學生無法作答的題目。以純標題為依據的分節會標示「未有教材」並停用。
  - 零散單字形式的 OCR 雜訊（完整可讀的 OCR 文字仍會使用）
  - 三欄或以上的寬表格列（欄位並列無法拼成問得通的題目）
- 產生的題目同樣會標註教材原文節錄及來源位置。
- 若教材以敘述為主、無法產生清晰題目，系統會**減少題目數量並顯示說明**，不會產生含糊或有爭議的題目；學生端會改用題庫內已有的題目。

### 題庫：讓每個課題都有題目

執行 `npm run setup` 時會自動為課程內每個分節生成題目（每個分節目標 5 題），亦可隨時手動補充：

```bash
npm run generate:questions                     # 為所有課題補足題目（每個分節目標 5 題）
npm run generate:questions -- --topic topic-9  # 只處理課題9
npm run generate:questions -- --count 6        # 每個分節目標 6 題（三個難度各 2 題）
npm run generate:questions -- --draft-only     # 只建立草稿，不自動發布
```

- **每個分節的目標題數會平均分配到三個難度**：5 題 → 基礎 2、進階 2、挑戰 1；6 題 → 三個難度各 2 題。因此題庫會同時齊備基礎、進階及挑戰的題目，學生選擇任何難度都有題庫題目可用（不會再出現「所選難度的題目不足」）。
- 選用本地示範生成時，`DEMO_AUTO_PUBLISH_QUESTIONS=true`（預設）會**自動發布**生成題目，令學生無需教師逐一審核也能練習；介面會標示題目來源為「本地示範生成（未使用 AI）」。
- **正式環境請設 `DEMO_AUTO_PUBLISH_QUESTIONS=false`**，讓教師在 `/teacher/questions` 核對教材依據後才發布。
- 生成時會避免與題庫內既有題目重複；**逐個難度**計算目標題數，已達該難度目標的分節會略過（補充其他難度時不會重複產生基礎題目）。
- 選用真正的 LLM provider（DeepSeek／Gemini／OpenAI 相容）時，生成的題目一律為**草稿**，需教師在 `/teacher/questions` 核對後發布；`DEMO_AUTO_PUBLISH_QUESTIONS` 只影響本地示範生成。
- 實測（`LLM_PROVIDER=deepseek`、`npm run generate:questions`，每個分節目標 5 題）：12 個課題、85 個分節共新增 **320 題**（基礎 10、進階 155、挑戰 155），題庫合計 **688 題**（基礎 353、進階 176、挑戰 159）；有數個以敘述為主的子分節未能產生合乎要求的題目，指令會如實列出而不會硬湊題目。以真正的 LLM 生成時，這些題目為**草稿**，需教師審核發布（見上一節）。

### AI 用量及批改監控（教師端）

- 每次 LLM 出題及 AI 批改都會寫入統計記錄（`llm_usage_logs`、`ai_grading_logs`）：
  - **出題**：請求類型（學生即時出題／題庫批次生成）、provider、模型、是否成功、回應時間、輸入／輸出 token（API 有提供時）及錯誤類別。
  - **批改**：題型、provider、成功與否、**是否回退**（改用字詞比對／學生自我檢查）、回應時間及錯誤類別。
- 記錄**不會**包含 API key、完整回應內容或學生的答案內容；錯誤只記錄類別（例如 `timeout`、`rate-limit`、`invalid-response`）。
- 教師可在管理員儀表板（`/teacher`）查看最近 7 天的請求數、失敗數、token 總數、批改成功率、失敗原因分佈及最近紀錄，或呼叫 `GET /api/admin/system/overview`。
- 本地示範生成（`mock`）不使用外部 API，因此不會產生 LLM 用量記錄。

### 啟用真正的 LLM

1. 複製環境變數範例：

   ```bash
   cp .env.example .env.local      # Windows PowerShell：Copy-Item .env.example .env.local
   ```

2. 編輯 `.env.local`：

   **DeepSeek（本專案預設示範用的 AI provider）**
   ```env
   LLM_PROVIDER=deepseek
   DEEPSEEK_API_KEY=你的 API key
   LLM_MODEL=deepseek-flash
   ```

   **Google Gemini**
   ```env
   LLM_PROVIDER=gemini
   GEMINI_API_KEY=你的 API key
   LLM_MODEL=gemini-2.5-flash
   ```

   **OpenAI 或相容 API**
   ```env
   LLM_PROVIDER=openai-compatible
   LLM_API_KEY=你的 API key
   LLM_BASE_URL=https://api.openai.com/v1
   LLM_MODEL=gpt-4o-mini
   ```

3. 重新啟動伺服器，開啟 `/api/health` 可確認目前 provider。設定好之後，學生在「練習設定」的「出題方式」會預設選擇「AI 即時生成題目」。

| Provider | 環境變數 | 預設端點／模型 |
| --- | --- | --- |
| `deepseek` | `DEEPSEEK_API_KEY` | `https://api.deepseek.com`／`deepseek-flash`（可用 `LLM_MODEL=deepseek-v4-pro` 提高準確度） |
| `gemini` | `GEMINI_API_KEY` | `https://generativelanguage.googleapis.com/v1beta`／`gemini-2.5-flash` |
| `openai-compatible` | `LLM_API_KEY` | `https://api.openai.com/v1`／`gpt-4o-mini`（可用 `LLM_BASE_URL`、`LLM_MODEL` 指向其他相容服務） |

#### DeepSeek 相關參數（依 [DeepSeek API 文件](https://api-docs.deepseek.com/zh-cn/)）

| 環境變數 | 預設 | 說明 |
| --- | --- | --- |
| `LLM_THINKING` | `disabled` | DeepSeek 專屬。DeepSeek 的思考模式預設為**開啟**且強度 `high`。出題屬「按提供的教材段落作結構化生成」，毋須思維鏈，因此本專案預設關閉：實測同一請求由 **17.9 秒／2,939 個思考 tokens** 降至 **1.4 秒／0 個思考 tokens**。設 `enabled` 可改用思考模式，設 `default` 則把參數交回 API 決定（其他 provider 未設定時不會傳送此參數）。 |
| `LLM_REASONING_EFFORT` | 未設定 | 思考強度（`low`／`medium`／`high`／`max`），只在 `LLM_THINKING=enabled` 時傳送。 |
| `LLM_MAX_TOKENS` | DeepSeek `8192`，其他 provider 不傳送 | 單次回應上限。DeepSeek「JSON Output」文件要求設定此值以免 JSON 被中途截斷；設 `off` 表示不傳送。 |
| `LLM_EMPTY_RETRIES` | `1` | JSON 模式偶爾會回傳空白 `content`，此為自動重試次數（重試仍空白才回報錯誤）。 |
| `LLM_GRADING_ENABLED` | `true` | 是否用 AI 按語意批改填充題及短答題。設 `false` 則填充題只作字詞比對、短答題只由學生自我檢查；本地示範模式（mock）永遠不會啟用。 |

其他已依文件落實的細節：

- Base URL 使用文件所列的 `https://api.deepseek.com`（程式會接上 `/chat/completions`）。
- 使用 `response_format: { type: "json_object" }`，而 system prompt 內含「JSON」字樣及輸出範例（JSON Output 的兩項要求）。
- 思考模式不支援 `temperature`，因此**只在關閉思考模式時**才傳送 `temperature`；`top_p` 在非思考模式下無效，故不傳送。
- 不使用 `tools`／function calling，因此毋須回傳 `reasoning_content`。
- 回應只取 `content` 解析 JSON；思考模式的 `reasoning_content` 不會進入題目內容。

> API key 只放在 `.env.local`（已被 `.gitignore` 忽略），**不會進入前端程式碼或版本控制**；`.env.example` 內只有空白欄位。

### 生成流程與驗證（重要）

1. 依學生／教師選擇的分節，只抽取相關教材段落（每段會標示段落 ID 及來源位置）。
2. 要求 LLM 以 JSON 回應題目。
3. [src/server/llm/validation.ts](src/server/llm/validation.ts) 逐題驗證：
   - zod schema 欄位檢查
   - 題型是否符合要求；選擇題答案必須在選項之內
   - **教材依據**：`sourceBlockIds` 必須是我們提供的段落，`sourceExcerpt` 必須真的出現在該段落文字中
   - **杜撰檢查（年份）**：題目、參考答案、解釋及得分要點中出現的年份，必須見於已提供的教材段落（錯誤選項不受此限，因為錯誤選項本來就是錯誤答案）；出現教材沒有交代的年份即整題丟棄
   - **杜撰警告（人名、條約／文件及著作名稱）**：題目、參考答案、解釋及得分要點中出現的人名及《》內的名稱（或「XX條約／宣言／憲章」等寫法）若未見於教材，會記錄為**品質警告**。人名沒有固定寫法，偵測可能出錯，因此**不會丟棄題目**，而是保留題目並在教師介面標示，由教師核對後才發布（見 FAQ「甚麼是品質警告」）
   - 移除題目文字中的「根據教材」等提示語
   - 丟棄重複題目；短答題必須有得分要點
4. 沒有通過驗證的題目會被丟棄並記錄原因；有品質警告的題目會保留並標示警告。若全部不合規，回報清楚錯誤，並可回退本地示範生成（`LLM_ALLOW_MOCK_FALLBACK=true`）。
5. 通過驗證的題目寫入題庫（示範模式預設自動發布，見上文 `DEMO_AUTO_PUBLISH_QUESTIONS`；正式環境為**草稿**，教師查核後才發布）；學生即時練習使用的題目會凍結在該次練習記錄中。
6. **學生即時出題（`questionSource: "ai"`）不會寫入題庫**：題目只凍結在該次練習快照內，避免學生每次練習都在題庫留下大量草稿；重溫錯題改為由練習快照取回原題，因此同樣可以重做。
7. 提示詞要求 `sourceExcerpt` 必須逐字、連續抄自單一段落（見 [src/server/llm/prompt.ts](src/server/llm/prompt.ts)）；無法逐字對應的題目會被丟棄，並由其他分節補足題數，最後在練習頁如實說明實際題數。
8. 提示詞同時載明香港歷史科的專業要求：年級及課程主題（例如「中二 · 近代世界（15 至 19 世紀）」）、課程重視的歷史概念（時序、分期、因果、比較、轉變與延續、原始資料與二手資料）與歷史技能（見 [src/lib/types.ts](src/lib/types.ts) 的 `HISTORY_CONCEPTS`／`HISTORY_SKILLS`，取自教育局《歷史科課程指引》第 1.3 節），以及用語規範（繁體中文、專有名詞及年份沿用教材寫法）與禁止杜撰的具體要求。
9. **課程學習重點（精簡摘要）**：提示詞會載入教育局《歷史科學習目標》（知識和理解、技能、態度和價值觀）及**所屬課題**的學習重點（見 [src/server/seed/curriculum-focus.ts](src/server/seed/curriculum-focus.ts)，按《預期學習內容》整理，包括每個分題的學習重點及課程「著重」的方向）。課程明確表示「不須強記」的內容（例如只須介紹 1-2 位代表人物、不要求背誦事件經過、不必強記發明家及其發明）不可用來出題。學習重點只界定**範圍及考核要求**，不是史實依據：題目、答案及解釋的史實一律以教材段落為準。
10. 題目會儲存教師查核資訊：`sourceExcerpt`／`sourceLocation`／`sourceBlockIds`（教材依據）及 `qualityWarnings`（未見於教材的人名或條約名稱，見第 3 步）。

### 教材依據的來源說明

每題都會記錄：
- `sourceExcerpt`：教材原文節錄（必須真的出現在對應段落中）
- `sourceLocation`：來源位置（檔名、段落類型、圖片路徑；若來自 OCR 會標示「· OCR 擷取」）
- `sourceBlockIds`：對應的教材段落 ID
- `qualityWarnings`：未見於教材的人名或條約／文件名稱（只供教師核對，不會顯示給學生；教師在管理介面修改題目後會清除，代表已人工核對）

若題目的依據是 OCR 辨識文字，學生端的答案頁亦會顯示「來源為 OCR 辨識」提示，教師可在 `/teacher/questions` 逐一核對。

---

## 八、角色與權限（學校 Google Workspace 登入）

參考 [ai-english-platform](https://github.com/ipwh/ai-english-platform) 的登入設計：學生以學校提供的 Google Workspace 帳戶登入，學習記錄跟隨帳戶。

### 角色與權限模型

| 角色 | 學習者身分 | 可使用功能 |
| --- | --- | --- |
| 學生 | `school:<電郵>` | 學生端全部功能（課題、練習、AI 即時出題、成績、錯題重溫、回報題目） |
| 教師 | `teacher:<電郵>` | **學生端全部功能**（方便測試）＋ 教師端（題目生成與審核、回報覆核、查看／下載學生練習記錄） |
| 管理員 | `admin:<電郵>` | **教師全部功能** ＋ 管理員端（教材管理、OCR、分節及課題發布、系統狀態） |
| 未登入（匿名示範模式） | 瀏覽器產生的匿名 ID | 只在未啟用登入時可使用學生端；教師端及管理員端同時開放，**只適合本機開發及示範** |

- 權限由伺服器端工作階段判定，**不信任前端傳來的 `role` 或 `learnerId`**；集中於 [src/server/auth/guards.ts](src/server/auth/guards.ts) 的 `requireSignedIn`／`requireTeacher`／`requireAdmin`／`resolveLearnerId`。
- 學生 API 一律由工作階段推導學習者 ID；教師或管理員呼叫學生 API 時使用**自己的**身分，因此測試記錄與任何學生完全分開。
- 未登入呼叫受保護 API 會回傳 `401`（身分檢查在讀取 request body 之前完成，未登入不會先看到欄位驗證訊息）；學生呼叫教師或管理員 API 會回傳 `403`，教師呼叫管理員 API 亦會回傳 `403`。
- 教師及管理員不可透過學生端 API 讀取或修改其他學習者的練習記錄（服務層會核對 `session.learnerId`，不符即回傳 `403`）；只可經教師端「學生練習記錄」（`/teacher/records`）查閱及下載學生的練習記錄。
- 自動化腳本可在 `ADMIN_TOKEN` 設定後以 `x-admin-token` 標頭呼叫後台 API。
- 未啟用登入（未設定 Google 憑證）時，`/api/teacher/*` 及 `/api/admin/*` 會保持開放，方便本機測試；管理員端系統狀態頁會明確顯示「後台 API 未受保護」的警告。

### 設定步驟（約 5 分鐘）

1. 到 [Google Cloud Console](https://console.cloud.google.com/apis/credentials) 建立「OAuth 用戶端 ID」（應用程式類型：**網頁應用程式**）。
2. 「已授權的重新導向 URI」加入：

   ```
   http://localhost:3000/api/auth/google/callback
   ```

   正式環境請另加該網域的相同路徑（例如 `https://history.example.edu.hk/api/auth/google/callback`），或在 `.env.local` 以 `AUTH_REDIRECT_URI` 指定固定值。
3. 在 `.env.local` 設定：

   ```env
   GOOGLE_CLIENT_ID=你的用戶端 ID
   GOOGLE_CLIENT_SECRET=你的用戶端密碼
   AUTH_SECRET=隨機字串          # 可用 node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" 產生
   AUTH_SCHOOL_DOMAINS=pochiu.edu.hk
   ```

4. 重新啟動伺服器。首頁右上角會出現「登入」，學生訪問 `/` 或練習頁時會被導向 `/login`。

> 未設定 `GOOGLE_CLIENT_ID`／`GOOGLE_CLIENT_SECRET` 時**不會啟用登入**，網站維持原有的匿名示範模式（產生匿名學習 ID），教師端亦維持開放，方便本機開發及測試。

### 角色判定

| 登入帳戶 | 角色 | 說明 |
| --- | --- | --- |
| 校內網域且學號形式（`s` + 7 位數字，例：`s2024146@pochiu.edu.hk`） | 學生 | 使用練習功能、學習記錄跟隨帳戶 |
| 校內網域的其他帳戶（例：`history.teacher@pochiu.edu.hk`） | 教師 | 可使用教師端，亦可使用全部學生端功能作測試 |
| `AUTH_TEACHER_EMAILS` 內的帳戶 | 教師 | 供教師使用非校內網域帳戶（例：個人 Gmail）時使用；**本機測試教師端時建議把自己的電郵加入此處** |
| `AUTH_ADMIN_EMAILS` 內的帳戶 | 管理員 | 與 `AUTH_TEACHER_EMAILS` 可同時存在，但以管理員為準（先判斷管理員）；**本機測試管理員端時把自己的電郵加入此處** |
| 非校內網域（例：`@gmail.com`） | 學生 | 永不取得教師或管理員權限 |

- 網域比對要求**完整標籤**：`x@pochiu.edu.hk.evil.com` 會被判為學生（不會誤認為校內帳戶）。
- 規則的單一事實來源：[src/server/auth/role.ts](src/server/auth/role.ts)。

### 運作方式與安全設計

- 採用 Google **授權碼流程 + PKCE**（S256）及 `state` 參數；`state` 與 code verifier 存放在 10 分鐘有效的 HttpOnly 臨時 cookie 內。
- 換取 token 及讀取 `userinfo` 都由伺服器以 TLS 直接向 Google 進行，並要求帳戶的電郵已驗證（`email_verified`）；伺服器不會信任瀏覽器傳來的帳戶資料。
- 工作階段存放於 **HttpOnly、SameSite=Lax、經 HMAC-SHA256 簽署**的 cookie（30 天），內容無法由瀏覽器自行修改；正式環境會加上 `Secure`。
- 學生 API 的學習者 ID **一律由工作階段推導**（學生為 `school:<電郵>`、教師為 `teacher:<電郵>`、管理員為 `admin:<電郵>`），前端傳來的 `learnerId` 會被忽略，因此任何人都無法讀取或修改他人的練習記錄。
- 啟用登入後，未登入呼叫受保護 API 會回傳 `401`；學生帳戶呼叫教師或管理員 API 會回傳 `403`，教師帳戶呼叫管理員 API 亦會回傳 `403`。
- 學生、教師及管理員使用不同的學習者 ID 前綴，記錄不會混用；教師或管理員以學生端測試時，記錄只屬於該帳戶。
- 登出：`POST /api/auth/sign-out`（清除 cookie；首頁右上角有「登出」按鈕）。
- 教師或管理員帳號以外，亦可設定 `ADMIN_TOKEN` 以供自動化腳本以 `x-admin-token` 標頭呼叫後台 API。
- 若要把登入設為非強制（仍保留匿名使用），可設定 `AUTH_REQUIRE_SIGN_IN=false`。

### 學生名冊（Google Sheet）—— 只限名冊內的學生登入

名冊用於兩件事：**核對誰可以使用本網站**，以及為學生顯示**班別、學號及姓名**。名冊只存放班別、學號、姓名及電郵，**不含密碼**——學生仍然以學校 Google 帳戶登入。

| 項目 | 說明 |
| --- | --- |
| 名冊來源 | `sheets-api`（服務帳戶讀取私人 Sheet，建議正式使用）／`csv`（「知道連結的任何人可檢視」的 CSV 匯出）／`file`（本機 CSV，離線或測試用） |
| 欄名 | 自動偵測「班別／班級／Class」、「學號／學生編號／Student ID」、「姓名／學生姓名／Name」、「電郵／Email／學校電郵」；可用 `STUDENT_ROSTER_COLUMN_*` 覆寫。保良局蔡繼有中學的名冊欄名為 `CLASSCODE`／`CLASSNO`／`ENNAME`／`CHNAME`／`SEX`／`EMAIL`，部署時以 `STUDENT_ROSTER_COLUMN_NAME=CHNAME` 顯示中文姓名 |
| 沒有電郵欄時 | 以「學號 + 第一個校內網域」推導（例：`s2024146` → `s2024146@pochiu.edu.hk`） |
| 核對結果 | 名冊內的學生：工作階段會帶入 `className`、`studentNumber`（學生端頁首及「我的帳戶」可見）；名冊外：`rosterVerified = false` |
| 強制登入 | `STUDENT_ROSTER_ENFORCE=true`（預設）時，名冊以外的學生會被導向 `/login?error=not_in_roster` 並說明原因；教師帳戶**不受名冊限制** |
| 班別範圍 | `STUDENT_ROSTER_CLASS_PREFIXES=1,2,3`（前綴比對，只開放中一至中三）或 `STUDENT_ROSTER_CLASSES=1A,2B`（完全比對）；留空 = 不設限。範圍外的學生會被導向 `/login?error=outside_scope` 並顯示「本平台只開放中一至中三」 |
| 快取 | 預設 600 秒（`STUDENT_ROSTER_CACHE_TTL_SECONDS`）；讀取失敗時沿用上一次成功的名冊（並在管理員端顯示錯誤），完全沒有可用名冊時**預設拒絕登入**（`STUDENT_ROSTER_FAIL_OPEN=true` 可改為放行，安全性較低） |
| 個資 | 名冊只存在伺服器記憶體快取，不會寫入資料庫或回傳給前端；健康檢查及教師端只顯示來源、人數及更新時間，**不含姓名或電郵** |

**方案 A：Google Sheets API + 服務帳戶（建議）**

1. 在 Google Cloud 建立服務帳戶（例如 `history-roster-reader`），並下載 JSON 金鑰。
2. 把學生名冊的 Google Sheet **分享給該服務帳戶電郵**（檢視者權限即可）。
3. 設定環境變數：

   ```env
   STUDENT_ROSTER_ENABLED=true
   STUDENT_ROSTER_ENFORCE=true
   STUDENT_ROSTER_SOURCE=sheets-api
   STUDENT_ROSTER_SHEET_ID=1RlzeojjxJqu8vk7ctTliVRahA1sXnR-BJRiyFMCr_uM
   STUDENT_ROSTER_SHEET_NAME=名冊
   STUDENT_ROSTER_SERVICE_ACCOUNT_JSON=./secrets/roster-sa.json   # 或直接貼上 JSON 內容
   ```

**方案 B：CSV 匯出（最快，但 Sheet 需開放檢視權限）**

1. 把 Google Sheet 設為「知道連結的任何人可檢視」（或「檔案 → 共用 → 發布到網絡」）。
2. 設定：

   ```env
   STUDENT_ROSTER_ENABLED=true
   STUDENT_ROSTER_ENFORCE=true
   STUDENT_ROSTER_SOURCE=csv
   STUDENT_ROSTER_SHEET_ID=1RlzeojjxJqu8vk7ctTliVRahA1sXnR-BJRiyFMCr_uM
   STUDENT_ROSTER_SHEET_NAME=名冊
   ```

**方案 C：本機 CSV（離線／測試）**

```env
STUDENT_ROSTER_SOURCE=file
STUDENT_ROSTER_FILE=./data/student-roster.csv
```

> 想先試用而不影響登入，可設 `STUDENT_ROSTER_ENFORCE=false`：名冊只提供班別及學號，不會阻止名冊以外的帳戶登入。
> 教師端「課題與系統狀態」頁會顯示名冊來源、是否已載入、人數、更新時間及最近錯誤；`/api/health` 亦回報名冊狀態（不含學生資料）。

---

## 九、資料儲存與隱私

- 資料庫：`data/app.db`（SQLite），首次啟動或執行 `npm run setup` 時自動建立。
- 上載教材內容存於資料庫（可在 `/admin/materials` 刪除）；**原始檔案經儲存層（預設 `data/uploads/`）保存**；OCR 語言資料存放於 `data/ocr-cache/`；`data/` 整個目錄已被 `.gitignore` 忽略。
- **檔案儲存抽象**：教材原始檔及 OCR 需要的檔案一律經 [src/server/storage/](src/server/storage/) 存取，業務邏輯不會寫死本機路徑。本機使用 `LocalStorageProvider`；未來部署 Cloud Run 可改用 `GcsStorageProvider`（已預留介面，尚未實作，設定 `STORAGE_PROVIDER=gcs` 時會回報清楚的「尚未實作」錯誤）。
- 學習記錄：只儲存學習者 ID（匿名 UUID、`school:<電郵>` 或 `teacher:<電郵>`）、練習設定、作答內容及分數，**不收集姓名、電話或其他個人資料**。
- 教師與學生的記錄以不同學習者 ID 前綴儲存，不會混用；教師以學生端測試時亦只會產生自己的記錄。
- 題目回報（`question_reports`）：儲存回報的學習者 ID、題目、原因及補充說明，供教師覆核；教師端只顯示「學生／教師回報」類別，不顯示姓名或電郵。`question_id` 刻意不加外鍵，因為 AI 即時生成的題目只存在於練習快照、不會寫入題庫（題目是否存在由服務層核對）。
- **資料持久化（Cloud Run 免費方案）**：SQLite 快照（`VACUUM INTO`）定期上傳到 Cloud Storage，並在啟動時還原；未設定 `BACKUP_BUCKET` 時完全不會啟用。詳見第十節「資料持久化」。
- AI 用量及批改記錄（`llm_usage_logs`、`ai_grading_logs`）：只儲存 provider、模型、請求類型、成功與否、回應時間、token 數及**錯誤類別**，不儲存 API key、完整回應內容或學生的答案內容。
- 啟用登入後，資料庫會儲存學校帳戶的電郵、顯示名稱及頭像網址（用於顯示登入狀態）；如學校政策要求，可只保留電郵而移除名稱及頭像（修改 [src/server/auth/role.ts](src/server/auth/role.ts) 的 `buildSessionUser`）。
- **學生的作答內容不會傳送給 LLM 作為出題依據**：生成題目時只傳送教材段落。AI 批改會傳送該題的題目、參考答案、得分要點、解釋及學生在該題的答案（僅用於判斷該答案是否達到要求）。
- **使用 `OCR_PROVIDER=google-vision` 時，教材圖片會上傳到 Google Cloud Vision 進行辨識**（`tesseract` 則完全在本機執行）。請只上載不含個人資料的教材，並確認符合學校的資料處理要求。
- 練習記錄一律留檔：學生端**沒有**刪除記錄的功能，教師可在 `/teacher/records` 查閱及下載（CSV），確保學習記錄可供教學檢視。要徹底重設示範資料，請刪除 `data/` 目錄後再執行 `npm run setup`。
- 徹底重設示範資料：刪除 `data/` 目錄後再執行 `npm run setup`。
- 環境變數可調整資料位置：`APP_DATABASE_PATH`、`APP_UPLOADS_DIR`、`APP_MATERIALS_DIR`、`STORAGE_PROVIDER`、`GCS_BUCKET`、`APP_MAX_UPLOAD_BYTES`、`APP_MAX_BLOCKS`。

### 上線前必須檢查的私隱事項

1. **後台的保護取決於是否啟用登入**：啟用學校帳戶登入後，`/teacher` 及 `/api/teacher/*` 只限教師及管理員帳號，`/admin` 及 `/api/admin/*` 只限管理員帳號；未啟用登入時則完全開放（僅適合本機示範）。公開部署前請務必設定 Google 憑證，或使用 Cloud Run + Identity-Aware Proxy 限制只允許學校 Google Workspace 網域。
2. 確認學校對「學生學習記錄」、「題目回報」及「AI 用量記錄」的保存期限及家長同意要求。
3. 若使用第三方 LLM 或 Google Cloud Vision OCR，需確認服務條款允許傳送教材內容及學生答案（**請勿傳送含個人資料的教材**）。
4. 生產環境的資料持久化：本專案已內建「SQLite 快照 + Cloud Storage」備份（見第十節「資料持久化」），足以應付單一執行個體的自學平台；如日後需要多執行個體或更高併發，再把資料庫改為 Cloud SQL（所有 SQL 都集中在 `src/server/repositories/**`，介面已預留）。
5. 若容器化部署，`tesseract.js` 需下載語言資料：建議把 `chi_tra.traineddata` 打包進映像檔（設定 `OCR_LANG_PATH`），以免執行時需要網絡（見第十節）。

---

## 十、本機開發與 Google Cloud Run 部署準備

> 目前專案**只在本機執行及測試**；本節說明未來部署到 Google Cloud Run 前必須處理的事項，本階段不會建立任何 GCP 資源。

### 本機開發與測試

```bash
npm install
npm run setup            # 建立資料庫、匯入示範資料（可加 --ocr 一併執行圖片 OCR）
npm run dev              # http://localhost:3000
npm run import:materials                    # 首次建立：匯入 12 個課題的書本內容及校內試題
npm run generate:questions                # 生成題庫（示範模式＝本地規則式生成）

npm run lint && npm run typecheck && npm test && npm run build   # 提交前檢查
node scripts/e2e-flow.mjs --start         # 端對端流程（會自行啟動 next start）
```

- 本機建議以「匿名示範模式」測試後台（不需要登入）：不設定 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`。
- 若要測試**教師身分**的權限（403／401、教師測試模式橫幅），請設定 Google 憑證，並把測試者電郵加入 `AUTH_TEACHER_EMAILS`；要測試**管理員身分**（教材管理、系統狀態），請把電郵加入 `AUTH_ADMIN_EMAILS`。
- 端對端測試會實際寫入資料庫（新增題目、練習記錄、題目回報），建議以臨時資料庫執行：

  ```powershell
  $env:LLM_PROVIDER='mock'; $env:GOOGLE_CLIENT_ID=''; $env:GOOGLE_CLIENT_SECRET=''
  $env:APP_DATABASE_PATH="$env:TEMP\hist-e2e.db"; $env:APP_UPLOADS_DIR="$env:TEMP\hist-e2e-uploads"
  node scripts/e2e-flow.mjs --start
  ```

### 部署邊界（Cloud Run）

1. **單一服務**：本專案已是一個 Next.js 應用（App Router + Route Handlers），可直接打包成單一容器部署到 Cloud Run，不需要拆分前端／後端。
2. **環境變數由 Cloud Run 注入**：所有設定都經 [src/server/config.ts](src/server/config.ts) 讀取；憑證請用 Secret Manager 掛載成環境變數，**不要寫進映像檔或版本控制**。管理員儀表板及 `GET /api/admin/system/health` 會顯示設定問題（缺少憑證、未設定 `AUTH_SECRET`、暫時性儲存等）。
3. **資料庫**：本機用 SQLite（`APP_DATABASE_PATH`）。Cloud Run 的容器檔案系統**不是永久儲存**，因此本專案內建「SQLite 快照 + Cloud Storage 備份」（見下方「資料持久化」）；如日後需要多執行個體或更高併發，再改用 Cloud SQL（建議 PostgreSQL）或掛載 Filestore／GCS FUSE。
   - 所有 SQL 都集中在 `src/server/repositories/**`，服務層及 route handler 不會直接執行 SQL，因此只需替換這一層。
   - 仍屬 SQLite 專屬、移植時需要改寫的部分：`PRAGMA journal_mode/foreign_keys`、`AUTOINCREMENT`／`?` 佔位符語法（目前使用者）、`node:sqlite` 的 `DatabaseSync` API、以及以 `TEXT` 儲存 JSON 的欄位（`*_json`）。目前沒有使用 SQLite 獨有的函式。
   - 產生快照的方式是 SQLite 內建的 `VACUUM INTO`（`node:sqlite` 沒有 `db.backup()`），產生的是**一致**的資料庫副本，可在執行期間安全備份。
4. **上載檔案**：經 [src/server/storage/](src/server/storage/) 存取。部署前完成 `src/server/storage/gcs.ts`（Cloud Storage），並設定 `STORAGE_PROVIDER=gcs` 及 `GCS_BUCKET`；`GcsStorageProvider` 未完成時會回報清楚的錯誤，不會靜默失敗。
5. **OCR 語言資料**：`tesseract.js` 預設在 `OCR_CACHE_PATH`（`data/ocr-cache/`）下載 `chi_tra.traineddata`，容器重建後會遺失。建議把語言資料**打包進映像檔**（例如放到 `/app/tessdata/`）並設定 `OCR_LANG_PATH=/app/tessdata`；或改用 `OCR_PROVIDER=google-vision`。
6. **工作階段密鑰**：`AUTH_SECRET` 未設定時會在本機 `data/` 產生隨機密鑰；在 Cloud Run（多個執行個體）會令已登入使用者被登出，部署前必須由 Secret Manager 注入固定值。
7. **健康檢查**：`GET /api/health` 可作為 Cloud Run 的 startup／liveness probe（回傳版本、資料庫狀態、provider，且**不會**洩漏路徑或憑證）。
8. **IAP（建議）**：可用 Cloud Run + Identity-Aware Proxy 只允許學校 Google Workspace 網域存取，作為應用程式登入以外的第二層保護。

### 資料持久化（Cloud Run 免費方案）

Cloud Run 的容器檔案系統在執行個體停止或重新部署後會清空，因此本專案內建**以 Cloud Storage 保存 SQLite 快照**的持久化機制（[src/server/db/backup.ts](src/server/db/backup.ts)、啟動掛勾 [src/instrumentation.ts](src/instrumentation.ts)）：

```text
容器啟動  →  若雲端有備份且（本機沒有資料庫 或 BACKUP_PREFER_CLOUD=true）→ 下載並還原
API 請求  →  到期時在請求週期內完成備份（未到期只有兩次 stat，成本極低）：
             VACUUM INTO 產生一致快照 → 上傳 Cloud Storage
背景計時器／收到終止訊號  →  額外嘗試備份（Cloud Run 會節流閒置 CPU，故只屬保險）
```

| 環境變數 | 預設值 | 說明 |
| --- | --- | --- |
| `BACKUP_BUCKET` | （空） | 備份用的 bucket 名稱；**未設定時完全不會啟用** |
| `BACKUP_PREFIX` | `history` | bucket 內的物件前置路徑 |
| `BACKUP_INTERVAL_SECONDS` | `300` | 最長備份間隔（秒）；設 0 表示不設間隔 |
| `BACKUP_MIN_SPACING_SECONDS` | `60` | 偵測到資料變更時，兩次備份之間的最短間隔（秒）；越小則資料遺失窗口越小、備份越頻繁 |
| `BACKUP_RESTORE_ON_START` | `true` | 啟動時是否由雲端還原資料庫 |
| `BACKUP_PREFER_CLOUD` | `false` | 還原時以雲端版本為準（Cloud Run 建議 `true`，避免用到映像檔內的舊資料庫） |
| `BACKUP_ENABLED` | `true` | 是否啟用備份（保留 bucket 設定但暫時停用） |

- **不需要任何金鑰**：備份程式在 Cloud Run／GCE 內會向 metadata server 取得存取權杖；只需要把 bucket 的 `roles/storage.objectAdmin` 授予 Cloud Run 的執行身分。
- **備份在請求週期內執行（重要）**：Cloud Run 只在處理請求時分配 CPU，容器閒置時的背景計時器會被節流（實測會以 `fetch failed` 失敗）；Next.js 亦有自己的 SIGTERM 處理，令關機備份未必來得及完成。因此可靠的機制是 **API 請求期間的到期檢查**（`handleRoute` 內 `await backupIfDue()`）：未到期時成本只是兩次 `stat`，到期才做快照及上載（實測 27 MB 資料庫在區內上載只需數秒）。背景計時器與關機備份仍會嘗試，屬額外保險。
- **資料有變更才會上載**：以資料庫檔案（含 `-wal`）的修改時間判斷，沒有變更時完全跳過快照及上載，因此頻繁瀏覽不會產生多餘備份。
- **費用**：資料庫只有數十 MB，標準儲存每月每 GB 約 HK$0.2 以下，一般落在 Cloud Storage 免費額度內；asia-east2（香港）的延遲最低，如需貼近零成本可改用美國區域（`-BackupLocation us-central1`）。同區 Cloud Run → Cloud Storage 的流量不收費。
- **不是即時同步**：兩次備份之間的寫入（預設最多 1 分鐘後若有請求即會備份；最長 5 分鐘）在執行個體被強制終止時可能遺失。
- **教材原始檔案不會備份**：`data/uploads/` 內的上載檔案仍只存在容器內；書本內容及校內試題本來就打包在映像檔的 `materials/`，重新匯入即可。若教師曾上載自訂教材，重新部署後需重新上載。
- 教師端「課題與系統狀態」（`/admin/settings`）及 `GET /api/admin/system/health` 會顯示備份是否啟用、上次備份時間、上傳次數及還原結果。

驗證方式（部署後，本專案已實測）：

1. 以教師帳戶登入，按「匯入 materials 資料夾全部教材」（或 `gcloud run services update` 觸發一次請求）。
2. 檢查 bucket 內的 `history/data/app.db` 已更新（大小應為數十 MB）。
3. 重新部署（`gcloud run services update ... --image <同一映像檔>`）。
4. 重新開啟網站：課題、題庫及練習記錄應仍然存在。



專案已包含部署所需的全部檔案：

| 檔案 | 用途 |
| --- | --- |
| [Dockerfile](Dockerfile) | 多階段建置（`node:24-bookworm-slim`）；使用 Next.js `output: "standalone"`，並在建置時下載 `chi_tra.traineddata` 到 `/app/ocr-lang`（容器離線亦可 OCR） |
| [.dockerignore](.dockerignore) | 排除 `node_modules`、`.next`、`data/`、`.env*`，確保憑證與本機資料不會進入映像檔 |
| [.gcloudignore](.gcloudignore) | `gcloud builds submit` 上載時排除 `secrets/`、`data/`、`node_modules`、`.next`、`.env*`。本專案不是 git 儲存庫，若沒有這個檔案，`.gitignore` 不會生效，服務帳戶金鑰就會被上載到 Cloud Build 暫存 bucket |
| [cloudbuild.yaml](cloudbuild.yaml) | Cloud Build：建置映像檔 → 推送 Artifact Registry → 部署 Cloud Run（環境變數及 `--set-secrets` 已備妥） |
| [scripts/deploy-cloud-run.ps1](scripts/deploy-cloud-run.ps1) | 一鍵完成：啟用 API → 建立 Artifact Registry → 建立**資料備份 bucket 並授權執行身分** → 建立 Secret（`AUTH_SECRET` 隨機產生）→ 建立名冊服務帳戶 → 建置及部署 → 輸出服務網址與 OAuth 重新導向網址。**預設為模擬模式，加 `-Apply` 才真正執行** |

```powershell
# 1. 先看會執行哪些指令（不會建立任何雲端資源）
./scripts/deploy-cloud-run.ps1 -Project 你的專案ID

# 2. 實際部署（需已啟用 billing 及具備 Cloud Run／Artifact Registry／Secret Manager／Storage 權限）
./scripts/deploy-cloud-run.ps1 -Project 你的專案ID -Apply `
    -RosterSheetId 1RlzeojjxJqu8vk7ctTliVRahA1sXnR-BJRiyFMCr_uM -RosterSheetName 名冊 `
    -AdminEmails ipwh@pochiu.edu.hk `
    -LlmApiKey $env:DEEPSEEK_API_KEY -RosterServiceAccountFile ./secrets/roster-sa.json
# 資料備份 bucket 預設為「專案ID-history-backup」（asia-east2）；
# 如需零成本可改用美國區域：-BackupLocation us-central1
```

> **後台角色一定要設定**：`-AdminEmails` 指定誰可以使用管理員端（`/admin`：教材、OCR、課題發布及系統狀態）；
> 沒有設定就**沒有人能進入管理員端**。多個電郵以**分號**分隔（例如 `-AdminEmails a@pochiu.edu.hk;b@pochiu.edu.hk`）。
> `-TeacherEmails` 只在教師使用非校內網域帳戶（例如個人 Gmail）時才需要；
> 校內網域但非學號形式（例：`history.teacher@pochiu.edu.hk`）的帳戶本身已是教師。
> 兩個參數都會帶入 Cloud Build 的 `_ADMIN_EMAILS`／`_TEACHER_EMAILS` substitution，再由 `cloudbuild.yaml`
> 寫入 Cloud Run 的 `AUTH_ADMIN_EMAILS`／`AUTH_TEACHER_EMAILS` 環境變數，因此**每次部署都會保留**。
>
> 已部署但想臨時補上（下次部署會被 `cloudbuild.yaml` 的設定覆蓋）：
>
> ```powershell
> gcloud run services update history-self-study --region=asia-east2 `
>   --update-env-vars AUTH_ADMIN_EMAILS=ipwh@pochiu.edu.hk
> ```
>
> （用 `--update-env-vars` 只加／改該變數；`--set-env-vars` 會整個取代，請避免手動使用以免覆蓋其他設定。）

或以 Cloud Build 直接建置（需先自行建立 Secret）：

```bash
gcloud builds submit --config cloudbuild.yaml \
  --substitutions=_REGION=asia-east2,_SERVICE=history-self-study,_REPOSITORY=history
```

**部署後必做**

1. **OAuth 重新導向 URI**：在 Google Cloud Console 的 OAuth 用戶端加入
   `https://<服務網址>/api/auth/google/callback`（指令碼會輸出完整網址）。
2. **名冊服務帳戶**：把學生名冊 Google Sheet 分享給指令碼輸出的服務帳戶電郵（例如
   `history-roster-reader@<專案>.iam.gserviceaccount.com`，檢視者權限）。
3. **管理員帳戶**：確認部署時已用 `-AdminEmails` 指定管理員（見上）。沒有指定就沒有人能進入
   `/admin`（教材、OCR、課題發布及系統狀態）；臨時可用
   `gcloud run services update <服務名稱> --region=<區域> --update-env-vars AUTH_ADMIN_EMAILS=你的電郵`。
4. **檢查**：開啟 `https://<服務網址>/api/health`，確認 `database.status = ok`、`roster.loaded = true`；
   管理員端「課題與系統狀態」頁會列出名冊人數及任何設定提示。
5. **首次匯入教材**：以管理員帳戶登入 → 教材管理 → 「匯入全部課程教材」（`materials/` 已打包在映像檔內）。

**部署時實際遇到的問題與處理（本機與 Cloud Run 差異）**

| 現象 | 原因 | 處理 |
| --- | --- | --- |
| `invalid image name ...:` | `$SHORT_SHA` 只在 Git 觸發的建置才有值 | [cloudbuild.yaml](cloudbuild.yaml) 改用 `$BUILD_ID` |
| `Permission denied on secret ... roles/secretmanager.secretAccessor` | Cloud Run 執行身分無權讀取 Secret | 指令碼會建立專用執行身分 `history-run` 並逐個 Secret 授權（最小權限） |
| `--allow-unauthenticated: ignored explicit argument 'true'` | 該旗標是切換式旗標 | 以 `_AUTH_FLAG` 傳入完整旗標或留空（IAP 模式），並以 bash 展開 |
| Cloud Run 上 `llmProvider` 仍是 `mock` | 容器不會讀取本機 `.env.local` | 部署時一併以 `--set-env-vars` 設定 `LLM_PROVIDER`／`LLM_MODEL` 等（已寫入 cloudbuild.yaml） |
| 重新部署後題庫、教材、練習記錄消失 | 資料庫位於容器內 `/tmp/data`（映像檔不會保存） | 已內建 Cloud Storage 備份（設定 `BACKUP_BUCKET`，並把 `BACKUP_PREFER_CLOUD=true`）：重新部署後會自動還原上次快照。若未設定，則每次重新部署後需重新匯入教材 |
| 學生登入顯示「名冊暫時無法讀取」 | Sheet 未分享給名冊服務帳戶 | 把 Sheet 分享給 `history-roster-reader@<專案>.iam.gserviceaccount.com`（檢視者） |
| Google 登入回 `redirect_uri_mismatch`，或網址出現 `https://0.0.0.0:8080/...` | 容器內看到的網址是內部位址，未使用反向代理標頭 | [google.ts](src/server/auth/google.ts) 的 `resolveRedirectUri` 會依序使用 `AUTH_REDIRECT_URI`、`X-Forwarded-Host`／`X-Forwarded-Proto`、再退回請求來源；雲端已實測輸出正確的公開網址 |
| 重複部署後教師被登出 | 每次執行部署指令碼都會產生新的 `AUTH_SECRET` | 指令碼改為只在 Secret 尚未有版本時才產生，之後保留原有密鑰（如需強制更換可手動新增版本） |
| `fetch failed`（備份失敗） | Cloud Run 只會在處理請求時分配 CPU，容器閒置時的背景計時器會被節流；Next.js 亦有自己的 SIGTERM 處理，關機備份未必來得及完成 | 備份改為在 API 請求週期內執行（`handleRoute` 內 `await backupIfDue()`），並只在資料有變更時上載；實測 27 MB 備份可在請求內完成 |
| 後台 API 在 Cloud Run 上回 `403` | 未設定 Google 憑證（`authEnabled=false`），守衛拒絕公開存取 | 設定 `GOOGLE_CLIENT_ID`／`GOOGLE_CLIENT_SECRET` 後重新部署；臨時示範可用 `HISTORY_ALLOW_UNSAFE_DEMO_MODE=true` |
| 登入後進入 `/admin` 被導向「只限管理員帳戶使用」 | `AUTH_ADMIN_EMAILS` 未設定（`cloudbuild.yaml` 的 `_ADMIN_EMAILS` 留空），因此沒有任何帳戶是管理員 | 部署時加 `-AdminEmails 你的電郵`，或用 `gcloud run services update <服務> --region=<區域> --update-env-vars AUTH_ADMIN_EMAILS=你的電郵` |

**本機以 Docker 驗證（建議部署前先做）**

```powershell
docker build -t hk-history-self-study:local .
docker run --rm -p 8080:8080 -e LLM_PROVIDER=mock -e APP_DATABASE_PATH=/tmp/data/app.db `
  -e STUDENT_ROSTER_FILE=/app/roster.csv hk-history-self-study:local
```

> **雲端儲存注意（重要）**：資料庫、上載教材及 OCR 快取預設寫入容器內的 `/tmp/data`
> （Cloud Run 唯一可寫的位置），**重新部署或縮容後資料會清空**。
> - **已內建的持久化方案**：設定 `BACKUP_BUCKET`（部署指令碼會自動建立 bucket 及授權）後，
>   平台會定期把 SQLite 快照上傳到 Cloud Storage，並在啟動時自動還原（見下方「資料持久化」）。
> - 試行階段：設定 `--max-instances=1`（`cloudbuild.yaml` 已預設 `_MAX_INSTANCES=1`）。
> - 進一步方案（多執行個體）：改用 Cloud SQL（PostgreSQL）存放資料庫，並完成 `GcsStorageProvider` 存放教材檔案；
>   或將 Filestore／Cloud Storage bucket 掛載為 Cloud Run volume 並把 `APP_DATABASE_PATH`／`APP_UPLOADS_DIR` 指向該掛載點。
> - 教師端系統狀態頁會顯示備份是否啟用、上次備份時間，並在未啟用備份時顯示「需處理」提示。

### 環境變數說明（摘要）

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `LLM_PROVIDER` | `mock` | `mock`／`deepseek`／`openai-compatible`／`gemini`；未設定憑證時自動回退本地示範生成 |
| `DEEPSEEK_API_KEY`／`LLM_API_KEY`／`GEMINI_API_KEY` | 無 | LLM 憑證（只由伺服器端讀取，不會進入前端） |
| `LLM_MODEL`／`LLM_BASE_URL` | 依 provider | 模型及端點 |
| `LLM_TIMEOUT_MS`／`LLM_MAX_TOKENS`／`LLM_THINKING`／`LLM_EMPTY_RETRIES` | `45000`／`8192`／`disabled`／`1` | 逾時、token 上限、思考模式、空白回應重試 |
| `LLM_GRADING_ENABLED` | `true` | 是否以 AI 按語意批改填充題／短答題 |
| `GOOGLE_CLIENT_ID`／`GOOGLE_CLIENT_SECRET` | 無 | 未設定＝不啟用登入（匿名示範模式） |
| `AUTH_SECRET` | 自動產生 | 工作階段 cookie 簽署密鑰（部署時必須由 Secret Manager 注入） |
| `AUTH_SCHOOL_DOMAINS`／`AUTH_TEACHER_EMAILS`／`AUTH_ADMIN_EMAILS`／`AUTH_REQUIRE_SIGN_IN` | `pochiu.edu.hk`／空／空／`true` | 角色判定及是否強制登入 |
| `STUDENT_ROSTER_ENABLED`／`STUDENT_ROSTER_ENFORCE` | 依來源／同左 | 學生名冊開關及是否只限名冊帳戶登入 |
| `STUDENT_ROSTER_SOURCE` | 自動判斷 | `sheets-api`／`csv`／`file` |
| `STUDENT_ROSTER_SHEET_ID`／`STUDENT_ROSTER_SHEET_NAME`／`STUDENT_ROSTER_RANGE` | 無／第一張工作表／自動 | 名冊所在的 Google Sheet 及讀取範圍 |
| `STUDENT_ROSTER_SERVICE_ACCOUNT_JSON` | 無 | 服務帳戶 JSON 內容或檔案路徑（建議由 Secret Manager 注入） |
| `STUDENT_ROSTER_CSV_URL`／`STUDENT_ROSTER_FILE` | 無 | 名冊的 CSV 網址或本機檔案 |
| `STUDENT_ROSTER_CACHE_TTL_SECONDS`／`STUDENT_ROSTER_FAIL_OPEN` | `600`／`false` | 名冊快取秒數；來源失效時是否仍允許登入 |
| `STUDENT_ROSTER_COLUMN_EMAIL`／`_STUDENT_NUMBER`／`_CLASS`／`_NAME` | 自動偵測 | 名冊欄名覆寫 |
| `OCR_PROVIDER` | `tesseract` | `tesseract`／`google-vision`／`none` |
| `OCR_LANGUAGES`／`OCR_CACHE_PATH`／`OCR_LANG_PATH`／`OCR_MAX_IMAGES` | `chi_tra`／`data/ocr-cache`／空／`150` | OCR 語言、快取及離線語言資料位置 |
| `OCR_API_KEY`／`OCR_BASE_URL` | 無 | 使用 Google Cloud Vision 時需要 |
| `APP_DATABASE_PATH`／`APP_UPLOADS_DIR`／`APP_MATERIALS_DIR` | `data/app.db`／`data/uploads`／`materials` | 資料位置（Cloud Run 需改為持久化方案） |
| `STORAGE_PROVIDER`／`GCS_BUCKET` | `local`／空 | 檔案儲存 provider（`gcs` 尚未實作） |
| `BACKUP_BUCKET`／`BACKUP_PREFIX`／`BACKUP_INTERVAL_SECONDS`／`BACKUP_MIN_SPACING_SECONDS` | 空／`history`／`300`／`60` | 資料持久化：備份 bucket、前置路徑、最長間隔及最短間隔 |
| `BACKUP_RESTORE_ON_START`／`BACKUP_PREFER_CLOUD`／`BACKUP_ENABLED` | `true`／`false`／`true` | 啟動還原、以雲端版本為準及備份開關 |
| `APP_MAX_UPLOAD_BYTES`／`APP_MAX_BLOCKS` | `26214400`／`4000` | 上載大小及單一文件段落上限 |
| `ADMIN_TOKEN` | 空 | 供自動化腳本以 `x-admin-token` 呼叫後台 API（教師端及管理員端） |
| `DEMO_AUTO_PUBLISH_QUESTIONS` | `true` | 示範模式是否自動發布生成的題目（正式環境應設 `false`） |

---

## 十一、測試與驗證

```bash
npm run lint        # ESLint：0 error、0 warning
npm run typecheck   # tsc --noEmit：通過
npm test            # Vitest：254 項測試全部通過（25 個測試檔）
npm run build       # Next.js 生產建置：成功
node scripts/e2e-flow.mjs --start   # 端對端 96 項檢查全部通過（含 OCR、教師端、題目回報、學生名冊及權限）
```

> 端對端測試包含 AI 即時生成題目及其回報，因此執行前需先匯入教材（`npm run import:materials`），否則相關檢查會如實失敗並提示原因。

測試覆蓋範圍：

| 測試檔 | 內容 |
| --- | --- |
| `tests/text-utils.test.ts` | 文字正規化、標題判斷、相鄰重複去除、年份抽取、表格列接合（生成題目與核對依據共用）、**移除模型輸出的標題／Markdown 符號** |
| `tests/grading.test.ts` | 選擇／填充題自動評分、可接受寫法、短答題不評分、正確率 |
| `tests/llm-validation.test.ts` | schema 驗證、選項與答案一致性、**教材依據核對**、提示語與 Markdown 符號移除、**丟棄要求學生參考教材／上文／標題的題目**、短答題留空 `correctAnswer` 時以得分要點補回、重複題目 |
| `tests/mock-provider.test.ts` | 本地示範生成：教材節錄必為教材原文、答案在選項內、短答題有得分要點、寬表格列不會出題、不同難度採用不同出題規則 |
| `tests/curriculum.test.ts` | 教育局課程架構：12 個課題、年級／課題編號、教材檔名對應、分節關鍵詞不重複 |
| `tests/ocr.test.ts` | OCR 文字正規化、可用性判斷、圖片格式支援、PNG 編碼、OCR 雜訊過濾、OCR 文字仍可出題 |
| `tests/section-mapper.test.ts` | 兩層分節對應（先用頂層分節切段，再對應子分節） |
| `tests/materials-parsers.test.ts` | 真實 DOCX／PDF 解析、分節覆蓋率、示範題目教材依據核對、**重新匯入同名教材會取代舊版本並重新核對題目依據**、不支援格式錯誤訊息 |
| `tests/practice-flow.test.ts` | 完整練習流程：組題 → 作答 → 答案回饋 → 成績 → 重做錯題 → 短答自我檢查 → 練習記錄留檔及 CSV 匯出 |
| `tests/practice-ai-mode.test.ts` | AI 即時出題：題數分配、題目只存在於練習快照（不寫入題庫）、不在題庫的題目也可重做錯題、分節可用性（教材段落數、`isSectionPractisable`、主題數計算） |
| `tests/question-bank.test.ts` | 題庫難度分配：每個分節的目標題數平均分配到基礎／進階／挑戰，生成後題庫確實齊備三個難度 |
| `tests/auth.test.ts` | 學校帳戶角色判定（含相似網域不得取得教師權限）、工作階段 cookie 簽署／改動／過期、OAuth state cookie、DeepSeek 及其他 provider 設定（模型、端點、思考模式、`max_tokens`） |
| `tests/llm-provider.test.ts` | OpenAI 相容／DeepSeek 請求內容（`response_format`、`max_tokens`、思考模式時省略 `temperature`、prompt 含「JSON」）、空白回應自動重試、API 錯誤訊息 |
| `tests/ai-grading.test.ts` | AI 語意批改：要點核對與判斷修正、越界索引、填充題語意等同即當作答對（含寫入作答記錄）、短答題附要點且不影響正確率、批改失敗時回退、選擇題不會呼叫 AI |
| `tests/access-control.test.ts` | 角色與權限：學生呼叫教師／管理員 API 得 `403`、教師呼叫管理員 API 得 `403`、管理員可存取兩者、未登入得 `401`（即使 body 未通過格式驗證亦先回 `401`）、學生／教師／管理員的學習者 ID 前綴不同、**前端 `learnerId` 不可覆寫工作階段身分**、教師不可讀取學生的練習記錄 |
| `tests/teacher-student-flow.test.ts` | 教師以學生身分完成完整流程（出題 → 作答 → 回饋 → 成績 → 重做錯題）、教師與學生記錄分開、教師端記錄檢視清楚區分教師（測試）與學生 |
| `tests/reports.test.ts` | 題目回報：寫入及待覆核標示、重複回報不重複記錄、不可回報他人練習的題目、教師可處理回報且不改動題目、學生不可呼叫教師回報 API、**AI 即時生成題目（只存在於練習快照）亦可回報並標示不在題庫** |
| `tests/storage-and-config.test.ts` | 儲存抽象（本機寫入／讀取／刪除、拒絕跳出目錄的路徑、GCS 未實作的清楚錯誤）及設定驗證（缺少憑證、OCR 設定、未啟用登入、Cloud Run 偵測、版本讀取）；健康檢查不洩漏資料庫路徑或憑證 |
| `tests/roster.test.ts` | 學生名冊：CSV 解析（引號／BOM／CRLF）、中英文欄名自動偵測及覆寫、以學號推導電郵、來源 provider（本機檔案、CSV 網址、**Sheets API 服務帳戶 JWT 簽章驗證**）、快取與失效沿用舊快照、登入欄位對應、狀態不含學生個資 |
| `tests/login-roster.test.ts` | 學生登入流程（以本機 stub 取代 Google 端點）：名冊內學生取得班別／學號／姓名、名冊外被拒絕並導向 `/login?error=not_in_roster`、名冊無法讀取時預設拒絕（`FAIL_OPEN=true` 才放行）、教師不受名冊限制、`state` 不符及電郵未驗證不會建立工作階段 |
| `tests/question-warnings.test.ts` | 品質警告（未見於教材的人名／條約名）寫入資料庫、讀回及學生端不外洩 |
| `tests/question-bank-import.test.ts` | 校內試題解析與匯入：兩種排版（`[[ … ]]` 與 `\|!\|題號\|!\|`）、七種題型、答案忠實取自答案區、平台未支援的題型會略過、匯入為草稿、重複匯入更新同一題、課題1 不考核範圍（新月沃土／黃河、長江流域／印度河）略過、古埃及文明題目可匯入、需圖片作答加上品質警告 |
| `tests/db-backup.test.ts` | 免費資料持久化：未設定 `BACKUP_BUCKET` 時不啟用、`VACUUM INTO` 快照內容正確、上傳及下載（含 `gs://` 前綴）、啟動還原與 `BACKUP_PREFER_CLOUD`、還原失敗不阻止服務啟動、到期判斷（含「資料未變更不重複備份」與「變更後縮短間隔」）、狀態在多個模組實例（啟動掛勾與 API）之間一致 |

端對端測試（[scripts/e2e-flow.mjs](scripts/e2e-flow.mjs)）會依序檢查：健康檢查（版本、資料庫狀態、不洩漏路徑或憑證）→ 登入狀態 → 課程編排（12 個課題、年級分組、課題編號、教材就緒）→ 課題及分節 → 建立練習 → 作答前不洩露答案 → 提交答案並取得教材來源 → 重複提交不重複計分 → 成績及需重溫知識點 → 錯題再練習 → 短答題自我檢查 → 管理員端教材清單及預覽 → 生成題目（含教材依據、草稿狀態）→ 不支援格式錯誤 → OCR 狀態及執行 → DOCX 上載及刪除 → 修改分節及題目狀態 → 管理員端系統狀態及儀表板統計 → **學生回報題目及教師覆核** → **回報 AI 即時生成的題目（教師端標示該題不在題庫）** → **教師以學生身分測試（記錄分開、他人不可讀取）** → **後台功能分家（教師端／管理員端路徑）** → **教師查閱及下載學生練習記錄（CSV）**。

---

## 十二、已知限制與假設

1. **後台的保護取決於是否啟用登入**：未啟用登入（本機示範模式）時 `/teacher`、`/admin` 及對應 API 完全開放，公開部署前必須設定登入或加上其他驗證（見第八節）。
2. **本地示範生成只產生答案唯一的題型**：以敘述為主的教材可能無法生成題目，系統會減少題數並顯示說明。需要更多題型請啟用真正的 LLM provider。
3. **OCR 只支援點陣圖格式**：`.emf`／`.wmf`／`.wdp` 等向量或專有格式無法辨識（本課程教材共有 67 張），系統會如實回報張數。如要辨識，需先把圖片轉為 PNG／JPEG 再重新上載。
4. **OCR 並非百分百準確**：地圖、時間軸等圖表的辨識結果可能只有零散單字。系統會標示來源，教師必須在 `/admin/materials` 核對；規則式（本地示範）生成會略過這類雜訊文字。
5. **掃描版 PDF**：沒有文字層的頁面會以頁面圖片進行 OCR；若辨識不到足夠文字，系統會顯示「沒有可擷取的文字層」，不會猜測內容。
6. **規則式生成不使用寬表格列**：三欄或以上的表格列（欄位並列）不適合自動出題，本地示範生成會略過（教師可手動建立題目，或啟用真正的 LLM provider）。
7. **分節自動對應使用關鍵詞比對**：不同排版的教材可能需要教師手動修正（`/admin/materials` → 預覽擷取內容 → 指派分節）。
8. **題目快照**：每次練習會凍結當時的題目，教師之後修改題目不會影響已完成的練習記錄。
9. **短答題沒有自動評分**：只提供參考答案及得分要點，不作 AI 評分，亦不聲稱等同 HKDSE 分數。
10. **短答題的評分是練習回饋，不是正式評分**：AI 會依得分要點批改並列出已達到／未達到的要點，但仍可能出錯；介面提供自我檢查按鈕讓學生覆核，亦明確說明不是 HKDSE 分數，短答題也不會計入正確率。
11. **AI 批改需要網絡及 API 額度**：未設定 provider、逾時或回應格式不合時，填充題會回退到字詞比對，短答題則回到自我檢查，介面會註明情況；後台會記錄成功、失敗及回退次數，但這不會影響提交答案。
12. **已關閉 `cacheComponents`**（[next.config.ts](next.config.ts)）：本網站每次請求都會讀取資料庫，屬完全動態應用，開啟 Cache Components 對本專案沒有好處（詳見設定檔註解）。
13. **示範題庫（49 題）** 由教師按課題5 教材內容撰寫；`npm run setup` 會自動核對每題的教材節錄是否真的出現在教材中，核對失敗的題目會降為草稿並在指令輸出中列出。
14. **本地示範生成的題目會自動發布**（`DEMO_AUTO_PUBLISH_QUESTIONS=true`）：這是為了讓沒有教師在場時仍可試用；正式使用前應設為 `false` 並由教師審核。
15. **分節標題按教材目錄整理**：課程架構依各冊「溫習筆記」的目錄編寫，不同版本教材的排序可能略有差異，可在 `src/server/seed/curriculum.ts` 調整。
16. **人名及條約名的杜撰檢查是「警告」而非判錯**：中文人名沒有固定寫法，系統只能用稱謂、常見行為動詞及生卒年推測，可能有漏報或誤報，因此未見於教材的名稱只會標示品質警告交由教師核對（例如教材用「馬丁路德」而題目寫「馬丁路德金」時未必能察覺）。實測 12 冊教材共 901 題由教材原文生成的題目，品質警告為 0（沒有誤報）；年份方面則仍然嚴格：出現教材沒有交代的年份會直接丟棄題目。
17. **學習重點（精簡摘要）依教育局《預期學習內容》整理**：內容屬「範圍及考核要求」，不保證與個別教材的章節編排完全一致；如教師發現某課題的重點與實際教學有出入，可在 `src/server/seed/curriculum-focus.ts` 修改。
18. **題目回報只作提示，不會自動處理**：學生回報只會令題目在教師端顯示「待覆核回報」，系統不會自動刪除、停用或修改題目；教師必須自行核對教材後處理。回報沒有「通知教師」機制（教師需自行查看教師端／管理員端）
19. **配對題（MUQ）及時序題（COQ）尚未支援**：這兩類題目需要新的互動題型，目前匯入校內試題時會略過並列出題數（本輪共 781 題）。教師可用手動建立功能補上，或日後新增題型。
20. **需圖片作答的題目只作警告**：校內試題中有部分題目（本輪 107 題）需要原檔的圖表、地圖或漫畫才能作答，平台只保存文字，未能顯示原圖。這些題目會以草稿匯入並標示品質警告，教師發布前必須確認或補上圖片。
21. **課題2 的試題檔原本是舊版 `.doc`**：現已轉為 `.docx` 並成功匯入 209 題。若再遇到 `.doc`，平台不支援，需先另存為 `.docx` 才能匯入題庫（書本內容不受影響）。
22. **資料備份有時間差**：備份會在 API 請求週期內執行（資料有變更且距上次備份超過 `BACKUP_MIN_SPACING_SECONDS`，預設 60 秒；最長 `BACKUP_INTERVAL_SECONDS`，預設 300 秒），因此最後一次寫入與備份之間若沒有任何請求，該段寫入在執行個體被回收時會遺失。縮小 `BACKUP_MIN_SPACING_SECONDS` 可縮短窗口，但會更頻繁備份。。
19. **AI 用量及批改記錄是基本統計，不是完整監控平台**：只提供最近 7 天的請求數、失敗數、token 總數、批改成功率及最近記錄，沒有圖表、告警或多用戶分析；資料只儲存在本機資料庫。
20. **Google Cloud Storage provider 尚未實作**：`STORAGE_PROVIDER=gcs` 時會回報清楚的錯誤；本機仍使用 `data/uploads/`。Cloud Run 部署前必須完成 `src/server/storage/gcs.ts`。
21. **SQLite 仍有限制**：單一寫入者、不適合多執行個體同時寫入；Cloud Run 多執行個體部署前必須改用 Cloud SQL，SQLite 專屬語法（`PRAGMA`、`node:sqlite` API、以 `TEXT` 儲存 JSON）需要在該階段一併處理。
22. **教師學習記錄與舊版不同**：教師的學習者身分由 `school:` 改為 `teacher:`（避免與學生記錄混用），因此升級前教師留下的匿名／帳戶練習記錄不會再顯示；資料仍保留在資料庫中。
23. **學生名冊的姓名以名冊為準**：若名冊的「姓名」欄留空，會沿用 Google 帳戶的顯示名稱；名冊更新後最長需 `STUDENT_ROSTER_CACHE_TTL_SECONDS`（預設 600 秒）才會生效。學生改班或退選時，教師需更新 Google Sheet。
24. **名冊只能以「學號／電郵」核對**：系統不會以姓名比對（同名學生無法區分）。名冊若同時缺少學號及電郵欄，登入會被拒絕並在管理員端顯示設定提示。
25. **部署到 Cloud Run 後資料仍是暫時性的（但有備份）**：映像檔預設把資料庫、上載教材及 OCR 快取放在 `/tmp/data`（Cloud Run 唯一可寫位置），**重新部署、擴容或閒置回收後會清空**。已內建 Cloud Storage 備份（第十節「資料持久化」）：設定 `BACKUP_BUCKET` 後，重新部署會自動還原最近的快照，實測 27 MB 資料庫可正常往返。**未經備份的上載教材檔案**（`data/uploads/`）仍會遺失；如要完全消除此問題，需改用 Cloud SQL／Filestore 或掛載 GCS volume。試行階段請保持 `--max-instances=1`。
26. **容器映像檔體積約 750MB**：包含 Next.js 執行環境、`materials/`（66MB）及 OCR 語言資料（2.4MB）。若不需要在容器內批次匯入教材，可從 [Dockerfile](Dockerfile) 移除 `COPY materials` 以縮小映像檔。
27. **Artifact Registry 空間（費用相關）**：每次部署都會推送一個新映像檔（約 750 MB，層與層之間會重複使用），而 Artifact Registry 免費額度是 **0.5 GB**，重複部署後可能產生少量費用。建議部署成功並確認服務正常後，刪除已被取代的映像檔標籤（保留 `latest` 及目前版本使用的標籤）：

    ```powershell
    # 目前版本使用的映像檔標籤
    gcloud run services describe history-self-study --region asia-east2 `
      --format "value(spec.template.spec.containers[0].image)"
    # 刪除其他舊標籤（只刪標籤，不影響目前版本）
    gcloud artifacts docker tags delete `
      asia-east2-docker.pkg.dev/<專案>/history/hk-history-self-study:<舊標籤> --quiet
    ```

---

## 十三、常見問題

**Q：沒有 API key 可以試用嗎？**
可以。預設 `LLM_PROVIDER=mock`，所有流程（選課題 → 練習 → 看答案 → 看成績 → 重做錯題）都能運作。

**Q：`npm run dev` 出現資料庫錯誤？**
先執行 `npm run setup` 建立資料庫及示範資料。要重新開始可刪除 `data/` 後再執行。

**Q：上載教材後題目生成失敗？**
表示該分節的教材段落不足以產生「答案唯一」的題目。可改用其他分節、減少題數，或在 `.env.local` 設定真正的 LLM provider。

**Q：為什麼有些課題顯示 0 題可用？**
表示該課題的分節教材尚不足以產生題目（例如教材尚未匯入，或內容以敘述為主）。先執行 `npm run import:materials` 匯入教材，再執行 `npm run generate:questions` 補足題目。

**Q：如何辨識教材圖片內的文字（OCR）？**
在 `/admin/materials` 按文件的「執行 OCR」，或執行 `npm run setup -- --ocr`（首次會下載語言資料，之後可離線使用）。辨識結果會加入教材段落並標示「OCR 擷取」，教師可在段落預覽勾選「只顯示 OCR 段落」集中檢查。

**Q：OCR 沒有辨識到某些圖片？**
`.emf`／`.wmf`／`.wdp` 等向量格式無法辨識（介面會顯示張數及原因）；地圖、時間軸等圖表可能因文字散落而辨識不足。要提升準確度可設定 `OCR_PROVIDER=google-vision` 及 `OCR_API_KEY`，或把圖片轉成 PNG 後重新上載。

**Q：如何只用課程架構、不匯入教材？**
執行 `npm run setup -- --no-questions` 可略過題目生成；或直接 `npm run dev` 後在 `/admin/materials` 自行上載教材。

**Q：重複按「匯入全部課程教材」會不會產生重複教材？**
不會。系統以檔名判斷，同名教材會先移除舊版本再匯入（見第五節說明），因此可安全地重複執行。

**Q：題目在 `/teacher/questions` 顯示「未通過教材依據核對」？**
表示該題原本引用的教材段落已經不存在（例如教材被重新匯入後原文節錄有變）。系統匯入時會先嘗試自動重新定位，仍找不到的題目會標示出來，請教師核對內容、更新來源或刪除該題。

**Q：甚麼是品質警告？**
生成題目時，若題目、參考答案、解釋或得分要點出現**教材沒有提及的人名或條約／文件／著作名稱**（例如教材只提「馬丁路德」，題目卻寫「喀爾文」並引用《基督教要義》），系統會在該題標示「品質警告」並列出可疑名稱。警告**不會**刪除題目（人名偵測只能靠句式推測，可能有誤），教師可對照題目的教材節錄核對後才發布；在管理介面修改題目後警告即會清除。相對而言，出現教材沒有交代的**年份**會直接丟棄題目，因為年份是可直接核對的客觀資料。

**Q：如何完全重設學習記錄及教材？**
學生端沒有刪除記錄的功能（記錄一律留檔供教師查閱）；要完全重設，刪除 `data/` 目錄，再執行 `npm run setup`。

**Q：如何讓學生以學校 Google 帳戶登入，並只限名冊內的學生？**
先設定 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` 及 `AUTH_SECRET`（見第八節），再把學生名冊（Google Sheet）連接起來，例如：

```env
STUDENT_ROSTER_ENABLED=true
STUDENT_ROSTER_ENFORCE=true
STUDENT_ROSTER_SOURCE=sheets-api
STUDENT_ROSTER_SHEET_ID=你的試算表 ID
STUDENT_ROSTER_SHEET_NAME=名冊
STUDENT_ROSTER_SERVICE_ACCOUNT_JSON=./secrets/roster-sa.json
```

並把該 Google Sheet 分享給服務帳戶電郵（檢視者權限）。名冊欄名會自動偵測（班別／學號／姓名／電郵）；若表頭寫法特殊，可用 `STUDENT_ROSTER_COLUMN_*` 指定。想先試用而不影響登入，可設 `STUDENT_ROSTER_ENFORCE=false`。

**Q：學生登入後顯示「你的帳戶不在本學年的學生名冊內」？**
表示該電郵不在名冊內（或名冊的學號／電郵欄與學生的 Google 帳戶不一致）。請教師在 Google Sheet 核對學號或電郵；名冊更新後最多 10 分鐘（`STUDENT_ROSTER_CACHE_TTL_SECONDS`）生效。教師帳戶不受名冊限制。

**Q：名冊讀取失敗會不會令全班無法登入？**
會（預設 fail-closed）：名冊完全無法讀取時，系統為免未授權帳戶進入而暫停學生登入，並在管理員端顯示錯誤。若希望 Google 故障時仍可登入，可設 `STUDENT_ROSTER_FAIL_OPEN=true`（安全性較低）。若已有成功快照，系統會沿用上一次的名冊，登入不受影響。

**Q：學生登入後看到「需要教師帳戶」？**
教師端（`/teacher`）及教師 API 只限教師及管理員帳號：校內網域但**非**學號形式（`s` + 7 位數字）的帳戶、`AUTH_TEACHER_EMAILS` 或 `AUTH_ADMIN_EMAILS` 內的帳戶。學生帳戶呼叫教師或管理員 API 會收到 `403`，這是預期行為。

**Q：如何在教師端測試學生流程？**
以教師（或管理員）帳戶登入後，按頂部導覽的「學生端測試」（即學生端首頁 `/`），或由教師端／管理員端首頁的「學生端測試」入口進入；學生端頂部會顯示「教師測試模式」／「管理員測試模式」，並可隨時返回後台首頁。教師的練習記錄使用 `teacher:<電郵>`、管理員使用 `admin:<電郵>` 身分，與所有學生分開。

**Q：管理員端出現「後台 API 未受保護」警告？**
表示尚未啟用學校帳戶登入（未設定 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`），此時教師 API 及管理員 API 完全開放，只適合本機開發及示範。正式使用前請設定 Google 憑證。

**Q：舊書籤還能用嗎？**
`/teacher/materials` 會轉址到 `/admin/materials`、`/teacher/settings` 轉址到 `/admin/settings`、`/admin/questions` 轉址到 `/teacher/questions`。API 方面，教材／OCR／分節／課題／系統狀態已統一在 `/api/admin/*`（只限管理員），題目／回報／學生練習記錄在 `/api/teacher/*`（教師及管理員）；舊的 `/api/teacher/materials*`、`/api/teacher/system/*`、`/api/admin/questions*` 已移除。

**Q：學生回報題目後會怎樣？**
回報會寫入資料庫，題目在教師端（`/teacher/questions`）會標示「待覆核回報」，並可在「題目回報」區塊按狀態及課題篩選、標記「已處理」或「略過」。系統**不會**自動刪除、停用或修改題目，教師需自行核對教材後處理。學生重複回報同一題目不會產生重複記錄。教師及管理員可在「學生練習記錄」（`/teacher/records`）查閱及下載學生的練習記錄。

**Q：在哪裡查看 AI 用量及批改成功率？**
管理員儀表板（`/admin`）的「最近 7 天 AI 使用情況」，或 `GET /api/admin/system/overview`。只記錄統計資料（provider、模型、請求類型、成功與否、回應時間、token 數及錯誤類別），不會記錄 API key、完整回應內容或學生的答案內容。

**Q：`GET /api/health` 為何不再顯示資料庫路徑？**
健康檢查會回報狀態（例如 `sqlite`／`ok`）而不回報完整路徑，避免在公開部署時洩漏部署資訊或憑證。管理員端的系統狀態頁會顯示較詳細的設定提示（仍不含憑證）。

**Q：部署 Cloud Run 前要改甚麼？**
專案已包含 [Dockerfile](Dockerfile)、[cloudbuild.yaml](cloudbuild.yaml) 及 [scripts/deploy-cloud-run.ps1](scripts/deploy-cloud-run.ps1)（見第十節）。部署時必做：`AUTH_SECRET`／LLM API key／名冊服務帳戶由 Secret Manager 注入（指令碼會建立）、把服務網址加進 OAuth 重新導向 URI、把 Google Sheet 分享給名冊服務帳戶。**資料持久化**已內建（SQLite 快照 + Cloud Storage，見第十節「資料持久化」）：設定 `BACKUP_BUCKET`（指令碼會自動建立 bucket 並授權）即會在重新部署後自動還原資料。教材檔案仍建議打包在映像檔的 `materials/`，試行階段請保持 `--max-instances=1`。

**Q：重新部署後資料會不會消失？**
若已設定 `BACKUP_BUCKET`，不會：容器啟動時會先由 Cloud Storage 還原最近的資料庫快照，之後在 API 請求週期內（資料有變更且距上次備份超過 `BACKUP_MIN_SPACING_SECONDS`，預設 60 秒；最長 `BACKUP_INTERVAL_SECONDS`，預設 300 秒）自動備份。**教師另外上載的自訂教材檔案**（`data/uploads/`）不在備份範圍，需重新上載；由 `materials/` 匯入的書本內容及校內試題則可重新匯入。

**Q：雲端儲存要收費嗎？**
資料庫只有數 MB，標準儲存費用約每月 HK$0.01 以下，一般落在 Cloud Storage 免費額度內；如需貼近絕對零成本，可把備份 bucket 放在美國區域（`-BackupLocation us-central1`）。另需注意 Artifact Registry 的免費額度是 0.5 GB，而本專案的映像檔約 750 MB，可能每月產生少量費用；可設定映像檔保留政策只保留最新版本。

**Q：校內試題（題庫）為何都是「草稿」？**
校內試題匯入後一律為草稿（`origin = school-paper`），答案直接取自試題檔的評卷參考，程式不會自行推測。教師需在 `/teacher/questions` 核對後才發布給學生；配對題（MUQ）及時序題（COQ）平台尚未支援，匯入時會略過並在報告列出題數。題目若需原檔圖片（地圖、漫畫）才能作答，會顯示品質警告提醒教師。

**Q：課題2 為何沒有題目？**
課題2 的校內試題檔原本是舊版 `.doc` 格式（平台只支援 `.docx` 及 `.pdf`），現已轉存為 `.docx`，匯入後得到 209 題（選擇 50、填充 49、是非 47、長題 25、資料題 38；配對題 30 題及時序題 30 題因平台未支援而略過）。若日後再遇到 `.doc`，請先在 Word 另存為 `.docx`，再執行 `npm run import:materials -- --topic topic-2`。

**Q：課題1 為甚麼只考古埃及文明？**
本校本課程只考核「古埃及文明（尼羅河流域）」，新月沃土、（黃河、長江流域）中華及印度河流域文明**不考核**，因此不會寫入資料庫、不會出現在學生端，也不會成為題目內容（規則見 [src/server/materials/exclusions.ts](src/server/materials/exclusions.ts)）。改動後請在 `/admin/materials` 重新匯入課題1 的教材，令古埃及文明的段落寫入資料庫。

**Q：AI 出題比指定題數少？**
題目必須通過教材依據驗證（節錄要逐字對應教材原文），若題目、參考答案、解釋或得分要點出現教材沒有交代的年份，亦會被視為疑似杜撰而不採用；若某個主題的教材內容不足以出題，系統會由其他主題補足，並在練習頁說明實際題數。可改選其他主題、減少題數，或再練習一次取得新題目。

**Q：AI 批改可靠嗎？**
AI 只作練習回饋：填充題用字不同但意思相同會當作正確，短答題會列出已達到／未達到的得分要點。介面多處說明這不是正式 HKDSE 評分，短答題亦不計入正確率，學生可按要點自行覆核。如要完全停用 AI 批改，設 `LLM_GRADING_ENABLED=false`。

**Q：可否改用較準確的 DeepSeek 模型？**
可以，在 `.env.local` 設 `LLM_MODEL=deepseek-v4-pro`（較慢、較貴，但推理較強）；維持預設 `deepseek-flash` 一般已足夠。如要讓模型先寫思維鏈，可設 `LLM_THINKING=enabled`（實測同一請求由約 1.4 秒增至 10–19 秒）。

**Q：可否用英文或其他語言？**
目前介面及題目均以繁體中文為主；介面文字集中在 `src/components/`，種子內容在 `src/server/seed/`，OCR 語言可用 `OCR_LANGUAGES` 調整（例如 `chi_tra+eng`）。
