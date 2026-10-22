# PDF 匯出用的中文字型

`NotoSansTC-Regular.ttf` 只供教師端匯出練習記錄 PDF 使用（[src/server/export/pdf.ts](../../src/server/export/pdf.ts)）。執行時以檔案路徑讀取，路徑可以用環境變數 `RECORDS_EXPORT_FONT_PATH` 覆寫。

## 授權

Noto Sans TC 採用 **SIL Open Font License 1.1**，可自由嵌入、再散布及修改（包括商業用途）；授權全文見 [LICENSE-NotoSansTC.txt](LICENSE-NotoSansTC.txt)。散布時必須一併保留該授權文件，因此 `assets/fonts/` 會原樣放入 Docker 映像。

## 為甚麼要自己產生這個檔案

上游提供的是**可變字型**（`NotoSansTC-VF.ttf`，含 wght 100–900）。PDFKit／fontkit 嵌入可變字型時只會取預設實例（Thin），字身在 8.5pt 內文會過細，因此這裡固定為 wght=400 的靜態字型，並移除 PDF 不需要的表（`DSIG`、`BASE`、vhea`／`vmtx`、`HVAR`），把檔案由 11.9 MB 減至 7.1 MB。

## 重新產生步驟

```bash
curl -LO https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/Variable/TTF/Subset/NotoSansTC-VF.ttf
curl -L https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE -o LICENSE-NotoSansTC.txt

python - <<'PY'
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

font = TTFont("NotoSansTC-VF.ttf")
inst = instantiateVariableFont(font, {"wght": 400}, inplace=True, updateFontNames=True)
for tag in ["DSIG", "BASE", "vhea", "vmtx", "HVAR"]:
    if tag in inst:
        del inst[tag]
inst.save("NotoSansTC-Regular.ttf")
PY
```

驗證（應為 400、`NotoSansTC-Regular`、無 `fvar`）：

```bash
python -c "from fontTools.ttLib import TTFont; f=TTFont('NotoSansTC-Regular.ttf'); print(f['OS/2'].usWeightClass, f['name'].getDebugName(6), 'fvar' in f)"
```

## 注意

- 換字型後**必須以真實渲染器確認中文字形沒有缺漏**（例如以 MuPDF／Acrobat 開啟匯出的 PDF 檢視），不能只看文字抽取結果：字型子集化出錯時文字仍可抽取，但畫面上部分字會是空白。
- 中文字型不可改用 `subset: false` 的整體嵌入方式，否則每份 PDF 都會多出約 7 MB。
