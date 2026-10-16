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
  …_2.FBQ / _3.TFQ / _4.MUQ / _5.COQ / _6.LAQ / _7.DBQ
```

- 書本內容的檔名要包含「課題N」（例如「課題5 近代歐洲的興起.docx」），系統才會自動對應課題；
  放在課題子資料夾亦可（系統會遞迴掃描，以所在資料夾名稱優先判斷）。
- 校內試題檔以檔名判斷課題（例如 `HNC2A2E_QB_T5_1.MCQ.docx` → 課題5），可放在同一層或課題子資料夾。
- 檔名與判斷規則見 [src/server/materials/material-files.ts](../src/server/materials/material-files.ts)。

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
4. **驗證**：`npm test`、`npm run typecheck`；在 `/learn/<topicId>` 檢查課文，
   並在 `/teacher/questions` 查看標示為「未通過教材依據核對」的題目。

