# Provenance 裁決契約設計（Sprint 17，2026-10-19）

> **狀態：設計完成，實作暫緩（BLOCKED ON CONTRACT APPROVAL）。**
> 依 Sprint 17 §4–§5：若契約未能與現有架構及政策一致，先提交設計並保持實作暫停，
> 不得以既有 servability API 代替。本文件沒有寫入任何 API、schema 或 migration。

## 1. 為何不能重用現有 API

| 現有機制 | 處理的問題 | 為何不能直接用於 623 題 |
| --- | --- | --- |
| `POST /api/teacher/questions/[id]/servability` | 題目**目前**結構不可作答的處置 | provenance 問題是「過去的自動修復是否改變考核語義」，不是結構可作答性；用同一決定會混淆兩種風險 |
| `POST /api/teacher/golden/[id]` | Golden **評估基準**的背書 | provenance 覆核不是 Golden fixture 核准，也不應影響評估資料集 |
| `POST /api/teacher/questions/[id]/review`（approved/returned/rejected） | 題目發布覆核 | provenance 覆核只回答「修復證據是否足夠」，不應自動等於發布核准 |

三者與新流程必須**分開儲存**，避免一個「已覆核」標記被另一種語義引用。

## 2. 建議的決定值（概念，未經批准）

| 概念 | 語義 | 是否影響 gate |
| --- | --- | --- |
| `not_reviewed`（預設，不寫入） | 未進行覆核 | 否（維持 POLICY_PENDING） |
| `evidence_insufficient` | 缺少原卷／修復前版本／必要比較維度 | 否（仍 pending） |
| `verified_repair_semantics` | 已核對空格、答案映射、可接受答案、grading points，確認修復未改變語義 | 可作為 provenance 覆核進度證據，但**不**令題目變成可派發、不通過版權或部署閘門 |
| `correction_required` | 修復可能改變語義，需修正或進一步查證 | 否（列為待處理） |
| `rejected` | 覆核後判定不可用（仍需另行決定發布狀態） | 否 |

> 這些名稱是設計用語；**在 schema 契約批准前，不得成為 API enum**。

## 3. 每筆紀錄的必要欄位（只記錄審核者實際提供／核實的內容）

- `question_id`、`revision`、`question_fingerprint`（伺服器計算，不接受客戶端提供）
- `repair_category`（來自 manifest，唯讀）
- `source_verification`：`verified` / `evidence_insufficient` + 來源參考（不得虛構頁碼）
- 填充題：空格數量、考核空格位置、答案→空格映射、可接受答案、正規化規則
- grading points 及 grading semantics 的描述
- `decision`（上表之一）、`rationale`（≥ 20 字）、`reviewer_email`（取自工作階段）、`created_at`
- `missing_evidence`（明確列出未知項；不得以猜測填補 `null`）

## 4. 授權、冪等與失效

- 需要 `HISTORY_REVIEWER_EMAILS` 名單內的帳戶（與 Golden 相同的學科授權邊界）；admin 不足。
- 以 `(question_id, revision, fingerprint, decision, rationale)` 冪等：相同提交回傳既有紀錄（`created:false`）；理由不同則新增一筆。
- 題目 revision／fingerprint 改變 → 舊紀錄標示 `stale`，不計入任何「已核實」計數。
- 只新增、不更新、不刪除歷史紀錄。

## 5. 為何實作暫緩（BLOCKED 原因）

1. **需要新資料表＋migration**（例如 `provenance_reviews`）。專案 migration 需經檢視及在隔離資料庫測試；本 Sprint 未獲授權執行 migration，且新增 schema 屬契約決定。
2. **決定名稱與 gate 消費方式需要負責人批准**：哪些決定可令 `provenance-risk` 由 POLICY_PENDING 前進、是否需要「已核實」門檻（例如 P1 需 100% 或抽樣政策），屬政策決定（policy 第 3 項）。
3. **P1 grading 語義需要教師提供**（空格位置、映射、可接受答案、grading points）。程式只能儲存與顯示，不能代填。
4. 若不先批准契約就加 API，會產生第三套互相矛盾的審核來源——正是 Sprint 明文禁止的情況。

## 6. 實作前置條件（完成即可解除 BLOCKED）

- [ ] 政策負責人批准第 2 節的決定值及「是否影響 gate」的映射。
- [ ] 批准新表 schema（欄位、索引、唯一性、stale 判定）。
- [ ] 在隔離測試資料庫完成 migration 測試（升級、冪等、既有紀錄保留）。
- [ ] 決定 provenance 覆核與 `provenance-risk` gate 的關係（例如：P0 需全部 `verified`，P1 需政策決定的抽樣或全部）。
- [ ] 決定 UI 呈現方式（工作台第三個佇列的詳情面板加表單）。

## 7. 現階段可安全進行的工作（不需要 schema）

- 以 manifest 作人工覆核工作紙（現有唯讀 manifest 已含證據契約）。
- 教師在平台外用原卷核對，再以既有題目覆核／servability 決定記錄**實際發布相關**的決定。
- 任何「已核實修復語義」的結論，現階段只能留在報告／會議紀錄，不能寫入系統假裝成資料。

## 8. 與 release gate 的關係

在契約批准及實作前：

- `provenance-risk` 維持 `POLICY_PENDING`（P1 530、P3 93）；不得因本設計文件存在而改變。
- `review-provenance` 維持 `POLICY_PENDING`（623 題只有自動修復證據）。
- 任何 provenance 決定**都不會**令題目變成可派發（`checkQuestionServable()` 仍是唯一可作答判斷）。

## 附錄 A — 實作準備度矩陣（Sprint 18）

本矩陣只記錄「要開始實作還缺什麼」，不代表任何項目已獲批准。未確定的值一律保留為 `UNKNOWN`，不得自行填入。

| 項目 | 現況 | 開始實作前必須具備 | 負責人 | 狀態 |
| --- | --- | --- | --- | --- |
| 決定契約（decision contract） | 設計已完成（本文件第 2 節）：`verified_by_source`／`source_insufficient`／`require_teacher_recheck`／`reject` | 科組書面批准契約名稱及語義 | 歷史科科主任 | `UNASSIGNED` |
| 必要證據欄位 | 設計列出 source locator、excerpt、repair diff fingerprint | 批准哪些欄位為必填、哪些可留空 | 科組 + 系統負責人 | `UNASSIGNED` |
| 審核者授權 | 沿用 `HISTORY_REVIEWER_EMAILS` fail-closed 名單；admin 不自動取得 | 正式名單及設定責任人 | 系統負責人 | `UNASSIGNED`（名單未配置） |
| Revision／fingerprint 綁定 | 設計要求沿用 `setQuestionStatusIfRevision` 及 `question-fingerprint.ts` | 確認 stale decision 的處理（拒絕 vs. 標示失效） | 系統負責人 | 設計已定，未實作 |
| 審核歷史 | 沿用 `question_reviews` 唯讀歷史，不覆寫 | 批准是否需新增審核來源欄位（migration 0023） | 系統負責人 | `UNASSIGNED` |
| 冪等性 | 設計要求重複提交回 `created: false`（與 Golden 相同） | 確認契約 | 系統負責人 | 設計已定，未實作 |
| 與 servability 的關係 | 明確分離：provenance 決定不改變可作答性 | 確認沒有任何路徑可令 97 題重新派發 | 科組 | 設計已定 |
| 與 Golden 的關係 | 分離：Golden 核准只影響評估基準 | 確認交叉影響 | 科組 | 設計已定 |
| Release gate 對應 | `provenance-risk`、`review-provenance` 保持 `POLICY_PENDING` | 只有真實逐題裁決才可改變；不得以工具或批次代替 | 科組 | 阻塞中 |
| 需要的政策批准 | 13 項政策決定全部 `UNASSIGNED` | 至少第 3、4 項（P1 530／P3 93 覆核政策、1,003 題來源核實） | 科組 | 阻塞中 |
| 需要的學科專家核實 | 623 題全部需要逐題歷史科教師判斷 | 教師工時及安排 | 科組 | 阻塞中 |

Sprint 18 明確**沒有**實作：provenance 寫入 API、schema 變更、migration、批次自動裁決。
