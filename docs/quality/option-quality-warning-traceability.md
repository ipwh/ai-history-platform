# 選擇題表面線索警告：可追溯性契約（Sprint 24）

最後更新：2026-10-23

---

## 1. 警告文字格式（人機可讀）

每一條由 [src/server/quality/option-quality.ts](../../src/server/quality/option-quality.ts) 產生的警告，
在寫入資料庫前會由 [src/server/llm/validation.ts](../../src/server/llm/validation.ts) 加上前綴，
並在本模組內加上尾碼：

```
品質檢查提示：<白話說明>（規則 option-quality/v1 · <代碼>）
```

| 部分 | 用途 |
| --- | --- |
| `品質檢查提示：` | 既有前綴，教師介面一直沿用 |
| 白話說明 | 給教師看；說明現象與建議，**不作**錯誤結論 |
| `（規則 option-quality/<版本> · <代碼>）` | 機器可讀：`parseOptionQualityWarning()` 解析出 `{ code, version }` |

代碼（`OPTION_QUALITY_CODES`）：

| 代碼 | 檢查內容 |
| --- | --- |
| `option-length-asymmetry` | 正確項唯一最長、≥1.5× 最長干擾項、且多出 ≥4 字 |
| `option-form-mismatch` | 正確項與干擾項的句式不一致（說明句 vs 短標籤） |
| `option-absolutist-distractor` | 干擾項使用「一定／必然／完全／所有／永遠／必定／唯一」而正確項沒有 |
| `option-duplicate` | 選項正規化後重複 |

**版本遞增規則**：只在門檻、判定邏輯或訊息語意改變時把 `OPTION_QUALITY_RULE_VERSION`
由 `v1` 遞增。版本不同代表兩條警告不可直接相加比較；`summariseOptionQualityWarnings()`
會分開統計各版本。

---

## 2. 警告與題目／版本／路徑／練習的關係

| 維度 | 目前的關係 | 可追溯性 |
| --- | --- | --- |
| **題目 ID** | 警告存在該題的 `questions.quality_warnings_json` | ✅ 1:1，可直接以題目 ID 查詢 |
| **規則版本 + 代碼** | 寫在警告文字內 | ✅ 可用 `parseOptionQualityWarning()` 或 SQL `LIKE '%option-quality/v1%'` 統計 |
| **題目 revision** | 警告**不**記錄 revision；`questionFingerprint` **不包含** `qualityWarnings` | ⚠️ 只能說「這題目前的警告是最近一次生成或重新檢查寫入的」；無法逐條對應版本號 |
| **生成路徑** | `origin`（`material-ai` / `material-mock` / `school-paper` / `demo`）＋ `auto_validated_at`；即時生成題只在快照內 | ⚠️ 生成 vs 重新檢查可由 `auto_validated_at` 推斷，但無獨立欄位 |
| **練習 session** | 即時生成題（`persist:false`）連同 `qualityWarnings` 存在 `practice_sessions.question_snapshot_json` | ⚠️ 存在但只能解析 JSON 取得，沒有獨立表／索引 |
| **教師介面** | 「題目管理」顯示 `品質警告 N 項` 並列出全文；`GET /api/teacher/questions` 回傳 `qualityWarnings` | ✅ |
| **學生端** | `studentQuestionSchema` 不含 `qualityWarnings`、`correctAnswer`、`explanation` | ✅ 不外洩 |

---

## 3. 何時寫入

| 路徑 | 是否寫入警告 | 位置 |
| --- | --- | --- |
| AI 生成並落庫（`generateQuestions`） | ✅ | `insertQuestion` 的 `qualityWarnings` |
| AI 即時生成（`persist:false`，學生練習） | ✅（只存在快照） | `practice_sessions.question_snapshot_json` |
| 生成重試／品質重寫／mock fallback | ✅ | 同上（共用 `validateLlmQuestions`） |
| 教師按「重新檢查」（`revalidateQuestion`） | ✅（Sprint 24 新增） | `setQualityWarnings`，只更新該欄位 |
| 學校試卷匯入 | ❌（刻意不套用 AI 規則） | 原卷內容與來源追溯不變 |

`revalidateQuestion` 的安全前提（全部有測試）：

- `questionFingerprint` 不包含 `qualityWarnings` → 寫入警告**不會**令既有教師覆核變成
  `stale-approval`；
- `setQualityWarnings` 只更新 `quality_warnings_json`，不改 revision、狀態、題幹、選項、
  正確答案或任何覆核紀錄；
- 只替換「本模組產生的」警告（依尾碼標記辨識），其他品質警告原樣保留；
- 重複執行冪等（不會累積重複警告）。

---

## 4. 目前狀態（本機 2026-10-23 快照，唯讀量度）

`npx tsx scripts/audit-option-bias.ts`：

| 位置 | 帶有表面線索警告的題目 | 分母 |
| --- | --- | --- |
| `questions.quality_warnings_json` | **0** | 2,235 選擇題 |
| 練習快照內即時生成題 | **0** | 222 題（未落庫） |
| `question_quality_findings`（Sprint 25 新表） | **0 列** | — |

原因：規則於 Sprint 23 才加入，而 Sprint 23／24／25 均**沒有**對任何題目執行「重新檢查」
（不可代教師操作），亦沒有重新生成任何題目。因此「已儲存警告 = 0」是預期狀態，
不是缺陷。`question_quality_findings` 只在本機測試資料庫建立（migration 0030），
正式環境未套用。

同一工具亦報告「若現在執行檢查會標記多少」（不寫入）：`material-ai` 28.2%
（341/1,210）、`school-paper` 2.7%（27/982）、`demo` 35.7%（10/28）、
`material-mock` 0%（0/15）。

---

## 5. 結構化診斷表（Sprint 25 已實作，migration `0030-question-quality-findings`）

### 5.1 資料模型

| 欄位 | 說明 |
| --- | --- |
| `id` | `qqf_…`（應用層產生） |
| `code` | 檢查代碼，例如 `option-length-asymmetry`（CHECK：不可為空白） |
| `rule_version` | 例如 `option-quality/v1`（CHECK：不可為空白） |
| `severity` | `warning`（保留 `review` 值供日後使用；本 Sprint 不寫入） |
| `origin` | `revalidation`（教師重新檢查落庫題目）或 `instant`（學生練習的即時生成題） |
| `question_id` | 落庫題目 ID（`revalidation` 必填） |
| `question_revision` | 判定時看到的版本（僅作說明，不參與指紋） |
| `session_id` | 練習 session（`instant` 必填） |
| `snapshot_question_id` | 快照內題目 ID（`instant` 必填；題目本身不落庫） |
| `detected_at` | 判定時間 |

CHECK 約束同時保證「來源必須有對應關聯鍵」：`revalidation` 一定要有 `question_id`，
`instant` 一定要有 `session_id` + `snapshot_question_id`，不會出現無主診斷列。

### 5.2 索引

| 索引 | 用途 |
| --- | --- |
| `idx_question_quality_findings_question`（唯一，partial） | `(question_id, code, rule_version, origin)`：同一題同代碼同版本同來源只一列（冪等） |
| `idx_question_quality_findings_session`（唯一，partial） | `(session_id, snapshot_question_id, code, rule_version)` |
| `idx_question_quality_findings_code` | 按代碼／版本／時間統計 |
| `idx_question_quality_findings_time` | 按時間清理或匯出 |

### 5.3 生命週期

| 事件 | 行為 |
| --- | --- |
| 教師「重新檢查」 | `replaceRevalidationFindings`：**整體替換**該題 `revalidation` 列（已解決的項目消失），與 `quality_warnings_json` 更新同屬一個交易（見 `services/question-service.ts`） |
| 重複重新檢查 | 冪等：語意相同的結果不會累積（列 ID 會重新產生） |
| 規則版本升級 | 新版本列與舊版本列**並存**，因此「升級前後」可比較；同一代碼不同版本不互相覆蓋 |
| 學生練習（即時生成題） | **本 Sprint 預設不寫入**（函式 `recordSessionFindings` 已就緒並有測試）。原因：診斷會與個別學生的 session 產生關聯，需先決定隱私與保留期 |
| 題目被刪除 | `deleteQuestion` 會一併刪除該題診斷；`deleteQuestionsByOrigin` 之後執行 `purgeOrphanedFindings()` |
| 保留政策 | 目前**沒有自動刪除**；`revalidation` 列最多為「題目 × 代碼 × 版本」的數量（有界）。若日後啟用 `instant`，必須先定保留期（建議：與練習 session 相同的保留期，現有 maintenance 已清理舊 session） |

### 5.4 查詢方式

```sql
-- 某一題目前的診斷
SELECT code, rule_version, question_revision, detected_at
  FROM question_quality_findings WHERE question_id = ?;

-- 某版本規則標記了多少題（分母要另外由 questions 取得）
SELECT code, COUNT(*) FROM question_quality_findings
 WHERE origin = 'revalidation' AND rule_version = 'option-quality/v1'
 GROUP BY code;
```

應用層封裝：`listFindingsForQuestion`、`listFindingsForSession`、`summariseFindings`、
`deleteFindingsForQuestion`、`purgeOrphanedFindings`
（[src/server/repositories/question-quality-findings.ts](../../src/server/repositories/question-quality-findings.ts)）。

### 5.5 保留的缺口

| 缺口 | 影響 | 需要的事 |
| --- | --- | --- |
| 教師端未按代碼篩選／顯示 | 教師只看到文字警告 | UI 工作（可按 `listFindingsForQuestion` 擴充） |
| `instant` 未啟用 | 學生實際題目的診斷仍只在快照 JSON | 隱私與保留期決定後才寫入 |
| 沒有歷史時間序列 | 只能看「目前狀態」與每列 `detected_at` | 若需趨勢，改為 append-only 事件表 |
| 舊題目需教師逐一重新檢查 | 不會自動掃描整批題目 | 需授權的批次工具（不在本 Sprint 範圍） |


---

## 6. 這些警告**不是**甚麼

- 不是教師批准、不是覆核紀錄、不是發布許可；
- 不是歷史事實正確性的證據（`correctAnswer` 只是平台記錄的答案）；
- 不是版權或 provenance 已處理的證明；
- 不是「已消除選最長漏洞」的證明——Sprint 22／23 已證實長度線索在選項打亂後仍然存在，
  本 Sprint 只令它可以被**看見與統計**。
