# 覆核可稽核性：三個選項的比較與建議（Sprint 8.8 第三階段）

> **狀態：建議，未實作。** 本文件比較三個可稽核性方案，並建議一個最小侵入的做法。
> 依指示，**在取得決定之前不會新增任何 schema migration**；現有 10 筆覆核紀錄及 788 條
> 已發布題目不受影響。

## 1. 現況（已核實）

| 事實 | 位置 |
| --- | --- |
| 覆核紀錄保存 `revision`、`question_fingerprint`（SHA-256，涵蓋題幹／選項／答案／解釋／知識點／評分點／技能）、`reviewer_email`、`reviewer_role`、`decision`、`reason`、`created_at` | `question_reviews`（[migrations.ts](../../src/server/db/migrations.ts)） |
| 覆核紀錄**只增不改**：repository 只有 `insertQuestionReview` 及 SELECT，沒有 update／delete；路由只有 GET／POST | `src/server/repositories/questions.ts`、`src/app/api/teacher/questions/[questionId]/review/route.ts` |
| 覆核綁定「目前版本」：`approvedReviewFor` 以 `revision` + `question_fingerprint` 比對 | `src/server/services/question-service.ts` |
| **沒有**題目版本歷史表；修改題目只會令 `questions.revision` 遞增並覆寫內容 | 同上 |
| **沒有**覆核當時的題目內容快照；指紋是單向雜湊，無法還原內容 | 同上 |
| 題目目前 4 個寫入路徑：`updateManualQuestion`、`insertQuestion`、`updateQuestion`（重連／隊列）、`setQuestionStatus` | `question-service.ts`、`reference-remapping.ts`、`question-queue-actions.ts` |

**後果**：教師覆核後，若同一題再被修改（或教材重連改寫了來源欄位以外的內容），
系統仍能證明「有一個覆核對應某個指紋」，但**無法重現教師當時看到的題目全文**。
要回答「教師是否看過這句話？」只能靠指紋比對，而不能展示當時的內容。

## 2. 三個選項

### 選項 1：覆核時寫入不可變的題目內容快照（`question_reviews.content_snapshot_json`）

在 `insertQuestionReview` 的同一次寫入中，把教師所見題目（與指紋相同的欄位集合）序列化為 JSON
一併存入新欄位。

| 面向 | 評估 |
| --- | --- |
| 資料完整性 | **強**：快照與 `revision`／`fingerprint`／`reviewer`／`created_at` 同一筆寫入，原子性由單一 INSERT 保證；快照與指紋可互相驗證（對快照重算指紋必須等於儲存的指紋） |
| Migration 風險 | **低**：只新增一個 nullable TEXT 欄位（`ALTER TABLE question_reviews ADD COLUMN content_snapshot_json TEXT`），不重寫任何表、不改索引 |
| Backfill 風險 | **無需 backfill**：既有 10 筆紀錄保持 `NULL`，語意為「沒有快照，只有版本與指紋」，並在教師介面如實顯示，不假造歷史內容 |
| 私隱與存取控制 | 與覆核紀錄同表同權限（只有教師／管理員可讀）；快照含題目內容（非教材原文），沒有新的敏感資料類別 |
| 儲存影響 | 每筆約 1–3 KB；以小量覆核計可忽略（1,000 筆 ≈ 3 MB） |
| 與既有覆核兼容 | **完全兼容**：不改 `revision`／`fingerprint` 語意，舊紀錄照常比對 |
| 並發與過時批准 | 不變：Sprint 8.7 的 `expectedRevision` 樂觀鎖仍在前；快照只記錄「已通過樂觀鎖的那一版」 |
| 成本 | 約 1 個 migration ＋ 2 個函式改動（插入時寫入、讀取時回傳）＋ 顯示與測試 |

### 選項 2：新增 append-only 題目版本歷史表（`question_revisions`）

每次題目內容變更都插入一列（`question_id, revision, content_json, changed_at, changed_by, change_source`）。

| 面向 | 評估 |
| --- | --- |
| 資料完整性 | **最強**：可重建任何版本的完整歷史，並可比較差異 |
| Migration 風險 | **中高**：新表 ＋ 需要在**每一個**寫入路徑插入歷史（`updateManualQuestion`、`updateQuestion`、重連、隊列、種子匯入）；漏掉任何一條路徑就會產生無法解釋的斷層 |
| Backfill 風險 | **高**：788 條既有題目沒有歷史，只能補一列「目前版本、來源不詳」；補記內容本身需要如實標示為推定 |
| 私隱與存取控制 | 另需決定誰可讀取歷史（教師／管理員）及是否可見到已被刪除的題目內容 |
| 儲存影響 | 每次修改約 1–3 KB；長期成長取決於修改頻率（目前 788 條、revision 最多 7） |
| 與既有覆核兼容 | 兼容，但覆核仍需知道「當時那一版」是哪一列（可用 `revision` 對應） |
| 並發與過時批准 | 需要與樂觀鎖協調：版本列必須在內容寫入的同一交易內插入 |
| 成本 | 明顯高於選項 1：migration ＋ 5 條寫入路徑 ＋ 後台檢視 ＋ 測試 |

### 選項 3：不新增結構，只強化既有版本＋指紋的檢索與稽核證據

例如在覆核紀錄另外保存「題目內容的穩定序列化字串雜湊」以外的輔助欄位（例如題幹長度、選項數目），
或把 `question_fingerprint` 的組成寫入文件並提供重算工具。

| 面向 | 評估 |
| --- | --- |
| 資料完整性 | **弱**：指紋是單向的，只能證明「內容未變」，不能重現內容；輔助欄位只提高比對能力 |
| Migration 風險 | 最低（甚至可零 migration） |
| Backfill 風險 | 無 |
| 私隱 | 無變化 |
| 儲存影響 | 可忽略 |
| 與既有覆核兼容 | 完全兼容 |
| 並發與過時批准 | 不變 |
| 成本 | 最低 |

## 3. 建議

**建議採用選項 1，並保留選項 3 的重算／驗證工具。**

理由：

1. 它直接解決已核實的缺口——「無法重現教師當時看到的內容」——而不改動任何既有的
   版本／指紋／樂觀鎖語意。
2. 一個 nullable 欄位、無 backfill、無新增寫入路徑，是三者中風險最低而收益最直接的組合。
3. 選項 2 的額外能力（逐版差異、修改來源追蹤）目前沒有具體需求；在 788 條題目及
   4 條寫入路徑的規模下，漏記一條路徑的風險高於它帶來的好處。若日後需要「誰在何時改了甚麼」的
   完整帳目，可在選項 1 之上再加歷史表（兩者不衝突：快照解決覆核稽核，歷史表解決編輯稽核）。
4. 選項 3 保留為工具（文件化指紋組成、提供重算指令），不作為唯一方案。

## 4. 若獲批准，落實選項 1 的最小改動範圍（未執行）

1. `0019` 之後新增 migration：`ALTER TABLE question_reviews ADD COLUMN content_snapshot_json TEXT`。
2. `insertQuestionReview` 接受並寫入快照；`recordQuestionReview` 以同一個 `existing` 物件
   （即已通過 `expectedRevision` 檢查的那一版）產生快照。
3. `questionReviewSchema` 新增 `contentSnapshot: z.record(...).nullable()`；舊紀錄為 `null`。
4. 教師介面顯示「此覆核有內容快照／只有版本及指紋」，並在快照存在時提供展開閱讀。
5. 測試：指紋可由快照重算並相等；舊紀錄（`null`）仍可通過發布關卡；快照不影響 `expectedRevision` 的 409 行為；
   修改題目後舊覆核的 `reviewState` 仍為 `stale-approval`。

**風險提示**：migration 一旦套用即不能降版（見 README 第十節）；套用前必須先有已驗證的資料庫備份，
並在暫存副本上先演練升版。

## 5. 明確不做的事

- 沒有建立或套用任何 migration。
- 沒有改動 `question_reviews` 的內容、數量或語意。
- 沒有把「覆核快照」當成教師已批准其他版本的證據。
