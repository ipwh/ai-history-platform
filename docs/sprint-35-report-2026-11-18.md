# Sprint 35：學生學伴模擬與選擇題解釋修正

**日期**：2026-11-18  
**範圍**：學生學伴回歸模擬、選擇題解釋位置標籤、文件對齊

## 1. 本次修正

舊題庫的選擇題解釋可能以「選項 A／B／C／D」指涉答案。建立練習時若重新排列選項，解釋中的位置便會指向錯誤選項。現在：

- 含位置標籤的舊題目保留原選項次序，避免歷史解釋失配；
- 新題目提示詞要求引用選項完整文字，不再依賴位置標籤；
- 新增回歸測試，覆蓋建立練習、學生端資料隔離、評分及重做流程。

## 2. 學生使用模擬

| 驗證 | 結果 |
|---|---:|
| 學伴 tutor 回歸測試檔 | 37 通過 |
| 學伴 tutor 測試項目 | 1,018 通過 |
| 受控 12 案例 self-test | 12／12 完成 |
| self-test 模型呼叫 | 0（本機 mock transport） |
| self-test 重試 | 0 |

self-test 只驗證評估引擎、案例契約、預算及 journal 路徑，**不代表真實模型回答已通過教師覆核**。本次沒有執行付費 live evaluation。

## 3. 發現與處理

本次模擬沒有發現新的可由確定性測試重現的課題未命中、錯誤離題判斷或片面解說缺口。既有回歸測試已涵蓋：

- 粵語、簡體、英文及中英混合提問；
- 錯誤前提、追問、上文不足、跨課題切換及非歷史問題；
- 教材 A／B／C／D 可答性狀態、證據披露及回答深度；
- 學生練習的題型、題數、評分、重做、回報及權限邊界。

以下限制仍然存在，不能以本次 mock 結果宣稱已解決：

1. 定義型問題沒有獨立的「定義證據」檢查，可能需要教師判斷 A／B。
2. 學生用完全不同措辭提問時，字詞檢索未命中且無教材詞彙，仍可能需要語意改寫。
3. 只說「二戰」而沒有其他線索時，課題推斷仍可能偏向錯誤分節。
4. 真實模型輸出的史實、完整度、語言及教學適切性仍須逐題教師覆核。

## 4. 驗證指令

```powershell
# 學伴回歸測試
$files = (Get-ChildItem -Path tests -Filter 'tutor*.test.ts' -File | ForEach-Object { $_.FullName })
npx vitest run $files

# 型別檢查
npm run typecheck

# 只產生評估計劃，不呼叫模型
npx tsx scripts/tutor-live-eval.ts --max-cases 12 --out "$env:TEMP\tutor-eval-plan.json"

# 本機 mock self-test；不連線、不產生模型費用
$env:TUTOR_EVAL_ALLOW_LIVE_CALLS = "1"
npx tsx scripts/tutor-live-eval.ts --apply --self-test --max-cases 12 `
  --budget-usd 0.20 --pricing-input-usd-per-million 0.28 `
  --pricing-output-usd-per-million 2.5 --pricing-source "self-test" `
  --journal "$env:TEMP\tutor-selftest.jsonl"
```

