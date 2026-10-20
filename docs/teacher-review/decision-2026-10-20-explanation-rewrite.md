# 決定紀錄：解釋補寫與技能標籤（2026-10-20）

> 決策者：產品負責人（本專案擁有者）。以下四項由負責人明確回答，取代先前的建議選項。
> 相關文件：[解釋品質診斷](../quality/explanation-skill-diagnosis-2026-10-20.md)、
> [補寫指引](explanation-rewrite-guidelines-2026-10-20.md)。

## 決定總表

| # | 事項 | 決定 | 系統狀態 |
| --- | --- | --- | --- |
| 1 | 佔位解釋的題目是否暫緩派發 | **否** | `EXPLANATION_HOLD_POLICY` 維持 `off`（預設值），題目照樣派給學生 |
| 2 | 由誰逐題補寫解釋 | **由 AI（Copilot）逐題補寫**，教師事後抽核 | 已建立批次、核對、套用及紀錄流程，第一批 40 題已寫入 |
| 3 | 技能標籤 | **暫緩**（不進行） | `questions.skill` 維持 `NULL`；工作清單與建議規則保留，隨時可恢復 |
| 4 | 新增史料題（覆蓋第 3、5、7、8、9 項技能） | **否** | 不新增題型；技能覆蓋範圍維持現狀並如實記錄 |

## 第 1 項：不暫緩派發

`EXPLANATION_HOLD_POLICY=off`。**沒有**任何題目因為解釋品質而停止派發。

理由與影響（已如實記錄）：

- 若啟用 `placeholder`，可派發題目會由 1,875 題減至 546 題；`placeholder-or-answer-only` 則為 0 題。
- 決定的實際後果：在解釋補寫完成前，學生仍會看到「答案依校內試題檔的評卷參考。」這類
  沒有教學功能的解釋。這是負責人已知並接受的取捨，不是系統故障。
- 設定開關與診斷警示保留：日後如改變決定，只需設定環境變數，已寫入的解釋不受影響。

## 第 2 項：由 AI 逐題補寫

### 護欄（不可繞過）

1. **只改 `explanation`**：`correctAnswer`、`acceptedAnswers`、`options`、題幹及空格完全不變
   （測試：`tests/explanation-rewrite.test.ts`「套用後只改 explanation…」）。
2. **保留發布狀態**：已發布的仍然發布，不因補寫而下架。
3. **版本如實遞增**：`revision` +1、`question_fingerprint` 改變，舊的人工覆核紀錄
   **如實變成「已失效」**，不會被偽造成仍然有效。
   **產品負責人已確認接受（2026-10-20）**：這是讓題目留在線上、又不偽造覆核的唯一誠實做法。
   若日後改變主意，可加 `--to-draft` 令補寫後回到草稿、須重新覆核。
4. **不寫 `question_reviews`**：補寫不是教師覆核。機制紀錄寫入 `question_content_flags`
   的 `explanation_rewritten`（誰、何時、批次標題、依據說明）。
5. **預設模擬 + atomic**：`npm run explanation:apply` 預設唯讀模擬；任何一條不合格，
   整批不寫入。
6. **自動品質閘門**：新解釋必須通過同一套分類器（不可仍屬佔位文字／只列答案／過短／
   與答案矛盾），並禁止出現「評卷參考」「答案依」等內部用語。

### 依據來源

每批補寫都以**同課題的課本／筆記段落**核對（`material_blocks` 內 `student_distribution = 1`
的文件）。批次上下文檔會附上最相關的 1–3 段原文，不會在沒有依據的情況下改寫。

### 進度

| 課題 | 題數 | 已完成 | 狀態 |
| --- | --- | --- | --- |
| 課題1：人類的需要：古與今 | 73 | 73 | **已完成** |
| 課題2：歐洲文明的發展 | 93 | 93 | **已完成** |
| 課題3：伊斯蘭文明的興起 | 38 | 38 | **已完成** |
| 課題4：早期香港地區的歷史 | 56 | 56 | **已完成** |
| 課題5：近代歐洲的興起 | 338 | 338 | **已完成**（分 9 批） |
| 課題6：歐洲國家的殖民擴張 | 137 | 137 | **已完成**（分 4 批） |
| 課題7：美國的成立及發展 | 117 | 117 | **已完成**（分 3 批） |
| 課題8：香港直至19世紀末的成長與發展 | 118 | 118 | **已完成**（分 3 批） |
| 課題9：兩次世界大戰 | 223 | 223 | **已完成**（分 6 批） |
| 課題10：冷戰及後冷戰時代 | 360 | 360 | **已完成**（分 9 批） |
| 課題11：20世紀以來的國際合作 | 114 | 114 | **已完成**（分 3 批） |
| 課題12：20世紀香港的成長與蛻變 | 208 | 208 | **已完成**（分 6 批） |
| **合計** | **1,875** | **1,875**（100%） | 餘 0 |

批次清單：`docs/teacher-review/explanation-batches/`（`*-context.json` 為依據，
`*.json` 為寫入清單）。`*-context.json` 含課本原文節錄，依版權政策**不提交**
（`.gitignore`），可用 `npm run explanation:batch` 重新產生；補寫清單本身只有題目 ID 及新解釋，
會提交作可追溯紀錄。同樣地，逐題工作清單 `docs/quality/explanation-skill-worklist-*.json`
（內含題幹及來源節錄）不提交，可用 `npm run audit:explanation-worklist` 重新產生；
教師版 Markdown（只有統計數字）會提交。套用後資料庫狀態（2026-10-20 核對）：

- 1,875 題**仍然全部為 `published`**（沒有題目因補寫而下架）；
- 全部 **1,875 題**已補寫並通過品質分類器（工作清單重新分類結果：
  `placeholder` 0、`answer_only` 0、`insufficient` 0，其餘全為 `not_assessed`）；
- `question_reviews` **沒有增加**（3,157 筆），補寫紀錄為 1,875 筆
  `question_content_flags`（`explanation_rewritten`），
  `explanation_needs_rewrite` 標記已自動清零（0 筆）。
- 解釋長度：最短 25 字、平均 51 字，全部符合 25–220 字的閘門。

### 教師仍需做的事

- **抽核**：AI 補寫的解釋仍應由歷史科教師抽樣核實（尤其是涉及因果判斷的題目）。
- 發現錯誤時：用教師端「編輯題目」修正（會再 +1 版本），或把該題標記為
  `explanation_needs_rewrite` 並在理由寫明問題。

## 第 3 項：技能標籤暫緩

`questions.skill` 維持 `NULL`（1,875 題）。因此 `/api/progress` 的技能進度統計仍然
不會有數據——這是**已知且已接受**的狀態，不是缺陷回報。

保留而不刪除的部分：`HISTORY_SKILLS` 清單、`suggestSkills()` 建議規則、
`GET/POST /api/teacher/content-improvement` 的 `skill_needs_confirmation` 標記、
以及工作清單內的每題技能建議。恢復時不需要重新開發。

## 第 4 項：不新增史料題

不新增附引文／圖表的新題型。後果如實記錄：教育局 9 項歷史技能中，第 3、5、7、8、9 項
（描述圖表特徵、比較不同解釋、質疑資料可信性、運用想像、組織表達）**現有題型無法考核**；
即使日後補上技能標籤，也不應把題目標示為考核這些技能。

## 相關指令

```bash
# 產生某一課題的補寫批次（唯讀，附課本段落）
npm run explanation:batch -- --topic topic-2 --limit 40 --out docs/teacher-review/explanation-batches/topic-2-batch-1-context.json

# 模擬套用（預設唯讀，不寫入）
npm run explanation:apply -- --manifest docs/teacher-review/explanation-batches/topic-1-batch-1.json

# 真正寫入
npm run explanation:apply -- --manifest docs/teacher-review/explanation-batches/topic-1-batch-1.json \
  --actor ai-copilot-2026-10-20 --actor-role automation --apply
```
