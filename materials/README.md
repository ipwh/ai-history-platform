# 教材來源檔案（不在版本控制內）

此資料夾存放平台的教材來源檔案，**不會**上載到 GitHub（見根目錄 `.gitignore`），
原因是這些檔案屬第三方版權內容（教科書內容、出版社溫習筆記及校內試題庫）。

## 需要的結構

```
materials/
  課題1人類的需要 古與今/
    課題1人類的需要 古與今.docx        ← 書本內容（作為 AI 出題依據）
    HNC1A2E_QB_T1_1.MCQ.docx          ← 校內試題（匯入題庫，草稿待教師審核）
    …_2.FBQ / _3.TFQ / _4.MUQ / _5.COQ / _6.LAQ / _7.DBQ
  課題2 歐洲文明的發展/
    …
```

> 課程指引等教師參考 PDF 並非出題依據，平台不會讀取，請勿放入此資料夾。

## 如何取得

請向歷史科教師索取教材檔案，放到上述位置。檔名格式見
[src/server/materials/material-files.ts](../src/server/materials/material-files.ts)，
系統會依資料夾名稱（`課題N …`）自動對應課題。

## 匯入方式

```powershell
npm run import:materials                       # 匯入全部課題（書本內容 + 校內試題）
npm run import:materials -- --topic topic-1    # 只匯入指定課題
npm run import:materials -- --ocr              # 匯入後執行 OCR（辨識圖片文字）
```

亦可在管理員端 `/admin/materials` 上載 DOCX／PDF 或批次匯入。
