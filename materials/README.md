# 教材來源檔案（不在版本控制內）

此資料夾存放平台的教材來源檔案，**不會**上載到 GitHub（見根目錄 `.gitignore`），
原因是這些檔案屬第三方版權內容（教科書內容、出版社溫習筆記及校內試題庫）。

## 需要的結構

2026 年 10 月重整後，每個課題一份書本內容檔案，直接放在 `materials/` 之下：

```
materials/
  課題1人類的需要 古與今.docx            ← 書本內容（作為 AI 出題依據）
  課題2 歐洲文明的發展.docx
  …
  課題12 二十世紀香港的成長與蛻變.docx
  HNC1A2E_QB_T1_1.MCQ.docx              ← 校內試題（匯入題庫，草稿待教師審核）
  …_2.FBQ / _3.TFQ / _4.MUQ / _5.COQ / _6.LAQ
```

課題1 亦可把新教材放在課題子資料夾（2026-10 擁有者提供）：

```
materials/課題1人類的需要 古與今/
  課題1人類的需要 古與今_課文.docx      ← 書本內容（AI 出題及生成答案的依據）
  課題1人類的需要 古與今_填充題.docx    ← 校內試題（匯入題庫）
  課題1人類的需要 古與今_MCQ.docx       ← 校內試題（匯入題庫）
```

**高中（中四至中六）教材**按教育局高中課程的兩個主題存放（2026-10-22 上載）：

```
materials/高中/
  引言及主題甲：二十世紀亞洲的現代化與蛻變/
    1.1 香港的政治及行政轉變筆記答案.docx
    1.2 香港作為國際城市的發展筆記答案.docx
    2.1 中國早期的現代化努力 — 改革與革命筆記答案.docx
    2.2 毛澤東時代的社會主義現代化筆記答案.docx
    3.1 日本的現代化與蛻變筆記答案.docx
  主題乙：二十世紀世界的衝突與合作/
    4.1 1900年至1914年的國際關係筆記答案.docx
    4.2 兩次世界大戰及有關和約的簽署筆記答案.docx
    4.3.1 超級大國的對抗與關係緩和筆記答案.docx
    5.1 經濟方面的國際協作筆記答案.docx
    5.2 社會及文化方面的國際協作筆記答案.docx
```

- 高中檔名不含「課題N」，因此**必須**在 [src/server/seed/senior-curriculum.ts](../src/server/seed/senior-curriculum.ts)
  的 `materialFiles` 逐一登記，系統才會自動對應課題；`materialFileSections` 另外聲明每份筆記所屬的分節。
- 校本範圍不設「0 引言」、「3.2 東南亞」及「4.3.2 其他主要衝突」；這些章節的檔案不需要放入 `materials/`。
- 檔名含「筆記答案」會被判定為教師版，匯入後**不會自動開放**給學生，需經 `npm run open:materials`（或管理介面）確認。

- 書本內容的檔名要包含「課題N」（例如「課題5 近代歐洲的興起.docx」），系統才會自動對應課題；
  放在課題子資料夾亦可（系統會遞迴掃描，以所在資料夾名稱優先判斷）。
- 校內試題檔以檔名判斷課題（例如 `HNC2A2E_QB_T5_1.MCQ.docx` → 課題5），可放在同一層或課題子資料夾。
- 試題檔的類型以檔名末段判斷：`….MCQ.docx`／`…_MCQ.docx`，或中文後綴
  `…_選擇題`／`…_填充題`／`…_是非題`／`…_配對題`／`…_時序題`／`…_短答題`（`_長答題`、`_問答題`）。
  檔案是否為試題檔只按檔名判斷，因此書本內容（例如「…_課文.docx」）不會被誤當成題庫來源。
- **資料題（`…_資料題.docx`／`.DBQ.docx`）已從平台移除**：這類檔案不會匯入題庫，亦不會當作課文教材匯入。
- 題目文字若提及「上圖／下圖／地圖／漫畫／照片」等，表示必須配合原檔圖片才能作答；平台只保存文字，
  這類題目**匯入時一律排除**（不會進入題庫），匯入報告會列出題數。
- **填充題一句有多個空格時**，平台的作答介面只有一個輸入框，因此匯入時會把其餘空格的答案
  （來自評卷參考的「(1) …、(2) …」）填回題幹，只保留一個空格；若有空格未能還原答案，
  該題**不會匯入**並在報告列出原因（請按原卷補回答案後重新匯入）。
- **選項在解析後失效**（全部變成「.」、空白、重複，或標準答案不在選項內）的選擇題同樣不會匯入；
  選項開頭殘留的排版符號（「A. . i和ii」）會自動移除。
- 檔名與判斷規則見 [src/server/materials/material-files.ts](../src/server/materials/material-files.ts)
  及 [src/server/materials/question-bank.ts](../src/server/materials/question-bank.ts)。

> 課程指引等教師參考 PDF 並非出題依據，平台不會讀取，請勿放入此資料夾。

## 如何取得

請向歷史科教師索取教材檔案，放到上述位置。

## 匯入方式

```powershell
npm run import:materials                       # 匯入全部課題（書本內容 + 校內試題）
npm run import:materials -- --books            # 只匯入書本內容（AI 出題依據）
npm run import:materials -- --topic topic-5    # 只匯入指定課題
npm run import:materials -- --ocr              # 匯入後執行 OCR（辨識圖片文字）
```

亦可在管理員端 `/admin/materials` 上載 DOCX／PDF 或批次匯入。

## 以最新版本取代平台內容（2026-10-16 實例）

1. **備份資料庫**（匯入會刪除同名文件的舊版本連同段落）：
   `Copy-Item data\app.db data\exports\app.db.pre-material-refresh-<日期>.db`
2. **匯入最新檔案**：`npm run import:materials -- --books`
   - **同名檔案**：先刪除舊版本再匯入，並自動以原文節錄為受影響的題目重新定位教材依據
     （找不到相符段落者標示「未通過教材依據核對」，學生端依 fail-closed 不顯示節錄）。
   - **已改名的檔案**（例如由 `HNC2A2E_T5_SN_TE.docx` 改為 `課題5 近代歐洲的興起.docx`）：
     會被視為新文件，舊文件仍然存在——請在 `/admin/materials` 刪除被取代的舊文件，
     否則學生閱讀頁會同時顯示新舊兩份教材。
3. **重新開放給學生**：重新匯入會令發行權回到 fail-closed，需再次確認：
   `npm run open:materials -- --owner-email <擁有者電郵> --reason "<理由>" --apply`
4. **重新連結題目依據（如需要）**：若該次更新有逐條核對過的對應清單，以
   `APP_DATABASE_PATH=<快照> npm run remap:references -- --apply` 套用
   （`docs/material-remapping/`；預設模擬、可重複執行、第二次為 no-op）。
5. **套用題目修正動作清單（如需要）**：把題目按新教材改寫或刪除（擁有者指示「一切以新教材內容為準」時）：
   `APP_DATABASE_PATH=<快照> npm run apply:question-queue -- --apply`
   （及 `-- --manifest docs/material-remapping/2026-10-wording-alignment.json --apply` 統一同批題目用詞）。
   預設模擬；每條驗證題目內容指紋及逐字節錄；重複執行為 no-op；**不會**建立任何覆核紀錄。
   > **`--` 不可以省略**：`npm run <腳本> --apply` 的 `--apply` 會被 npm 吞掉，腳本會以模擬模式執行並
   > 顯示「將套用」，看起來像成功但沒有寫入（2026-10-16 實測）。請確認報告顯示「模式：套用（--apply）」
   > 及「已套用」數字。
6. **驗證**：`npm test`、`npm run typecheck`；
   並在 `/teacher/questions` 檢查題目（逐條處理建議見 `docs/teacher-review/material-decision-queue-2026-10.json`）。
   學生可見內容的驗證請用**唯讀**端點（`/api/topics`、`/api/topics/<topicId>` 的 `studentMaterialBlockCount`），
   **不要**用 `GET /api/health`：它會執行 `ensureBootstrap()` 及保留期清理（會寫入資料）。

> **已改名的檔案（離線快照）**：第 2 步的「在 `/admin/materials` 刪除」只適用於有管理介面的
> 情況；在「快照 + 還原」的離線流程（README 第十節做法 A）請改用
> `npm run retire:materials -- --files "<檔名,…>" --apply`，刪除路徑完全相同
> （`deleteDocumentWithFile` → `repairQuestionsWithMissingBlocks`），並會回報每個課題的
> 題目修復結果。

