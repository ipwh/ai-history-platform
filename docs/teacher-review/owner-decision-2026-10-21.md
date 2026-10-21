# 2026-10-21 擁有者授權：全部發布、套用解釋補寫、自行處理不當內容

## 1. 授權原文

> 全部發布及套用，不用教師逐題覆核，若有任何不當，請你根據教材內容及歷史知識自行處理。你可以隨機抽出題目讓我檢查。

授權人：`ipwh@pochiu.edu.hk`（擁有者／歷史科教師）。

## 2. 這次實際做了甚麼

| 步驟 | 內容 | 結果 |
| --- | --- | --- |
| 1 | 從備份 bucket 下載正式資料庫（`gs://pccss-ai-history-history-backup/history/data/app.db`，2026-10-21T01:13:49Z） | 1,822 題（38 已發布／1,784 草稿） |
| 2 | 上載還原用快照 `app.db.pre-20261021T0120Z`（回滾點） | 完成 |
| 3 | 套用 51 份解釋補寫 manifest（1,875 條） | 1,784 條套用成功；91 條對應的題目已不在正式資料庫（匯入時被合併／刪除），已從 manifest 剔除並記錄 |
| 4 | 補寫 4 條仍是「填充題答案（依空格次序）」的解釋 | `docs/teacher-review/explanation-batches/owner-remediation-2026-10-21.json` |
| 5 | 逐題核對 18 條被品質閘門暫緩的題目 | 17 條維持原答案；1 條修正匯入黏連（詳見第 4 節） |
| 6 | 發布全部 1,784 條草稿 | 1,822 題全部 `published` |
| 7 | 重新稽核 | 見第 5 節 |

## 3. 解釋補寫的範圍與界線

- 只改 `explanation`，**沒有**改題幹、選項、正確答案（唯一例外見第 4 節）、難度、知識點或來源位置。
- 每次寫入都由 [explanation-rewrite.ts](../../src/server/services/explanation-rewrite.ts) 驗證：長度 25–220 字、不含內部用語（評卷參考／答案依／填充題答案／校內試題／見課本）、必須通過同一套解釋分類器（`not_assessed`）。
- 每條寫入都會令 `revision` +1，並留下 `explanation_rewritten` 內容標記；**沒有**寫入任何 `question_reviews` 覆核紀錄。

## 4. 唯一一處答案修正（匯入黏連）

`qb-JTH2ndEdFBQ09028`：

- 題幹：`法國的極端民族主義鼓吹報復德國，奪回在普法戰爭中失去的＿＿＿。`
- 原答案：`阿爾薩斯—洛林 1919年，第一次世界大戰的戰勝國召開______________，並與德國簽訂《______________條約》。 巴黎和會`
  （匯入時把下一題的文字黏在一起，並殘留兩個空格標記，學生無法作答）
- 修正後答案：`阿爾薩斯—洛林`
- 判斷依據：普法戰爭（1870—1871）後法國割讓阿爾薩斯—洛林予德國，題幹問的正是這處失地；只刪去黏連文字，**考核內容不變**。

其餘 17 條被暫緩的題目（原卷有多個空格，平台只有一個輸入框）逐題核對後維持原答案；理由逐題寫在
[owner-content-repairs-2026-10-21.json](owner-content-repairs-2026-10-21.json)，執行紀錄在
[owner-content-repairs-applied.json](owner-content-repairs-applied.json)。這些題目的原暫緩理由仍然保留在
`quality_warnings_json`，並附上一行「【2026-10-21 擁有者授權決定】…」，不覆蓋歷史證據。

## 5. 發布後的稽核結果（正式資料庫快照）

| 指標 | 數值 |
| --- | --- |
| 題目總數 | 1,822（全部 `published`） |
| 解釋分類 | `not_assessed` 1,822；佔位 0、只列答案 0、過短 0、與答案矛盾 0 |
| 結構不可作答（`audit:servability`） | 0 |
| 仍待教師確認（`teacher_confirmation_required`） | 0（18 條已依第 4 節處理） |
| 技能標籤空白 | 1,822（擁有者決定暫緩，見 2026 前次決定） |
| 來源可追溯 | `traceable` 529、`pending_verification` 1,293 |
| 覆核紀錄 | 2 筆（沒有新增） |

## 6. 明確**不**聲稱的事項

1. 這 1,822 題**沒有**逐題人工覆核紀錄。教師端會如實顯示「已發布（未經人工覆核）」，`revision` 已因解釋補寫而增加，任何舊有核准都不再對應目前版本。
2. 解釋補寫是 AI 依教材段落及歷史知識撰寫，**不代表**歷史準確性已由教師確認；1,293 題的教材依據仍未逐題核對。
3. 抽樣清單（[owner-spot-check-2026-10-21.md](owner-spot-check-2026-10-21.md)）只是隨機 20 題，不能當作全庫品質證明。

## 7. 如何重做或核對

```powershell
# 1. 下載正式資料庫快照（唯讀核對用）
gcloud storage cp gs://pccss-ai-history-history-backup/history/data/app.db "$env:TEMP\prod-work\app.db"

# 2. 重新產生隨機抽樣（同一 seed 會得出同一批題目）
npx tsx scripts/build-owner-spot-check-sample.ts --database "$env:TEMP\prod-work\app.db" --count 20

# 3. 重新稽核（只讀，不寫入題目）
npx tsx scripts/audit-content-quality.ts --database "$env:TEMP\prod-work\app.db"
npx tsx scripts/audit-servability.ts --database "$env:TEMP\prod-work\app.db"
```

批次工具的界線（dry-run 預設、正式環境拒絕執行、不建立覆核紀錄）見
[README.md](README.md) 第 17 節。
