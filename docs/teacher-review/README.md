# 歷史科題目人工覆核流程（Teacher Review Workflow）

> **本流程的目的**：把「系統證明節錄文字對得上教材」（`sourceVerified`）與
> 「教師確認史實正確、題目適合學生」（`reviewed`）分開。系統只做前者；後者必須由
> 歷史科教師完成，而且必須留下紀錄。**AI 不會、也不可以提供人工覆核結果。**

## 1. 三種狀態必須分開

| 狀態 | 由誰決定 | 代表甚麼 | 系統欄位 |
| --- | --- | --- | --- |
| 教材依據成立 | 系統（自動） | `sourceExcerpt` 逐字出現在**該題引用的段落**中 | `Question.sourceVerified` |
| 需教師核對的疑點 | 系統（自動） | 教材未提及的人名／條約名、選項重複等 | `Question.qualityWarnings` |
| 已人工覆核 | **歷史科教師** | 史實、用語、選項、答案及解釋均已確認 | `Question.status`（`draft` → `published`）＋本文件的紀錄 |

`sourceVerified = true` **不代表**史實正確。它只代表題目引用的文字確實來自教材。

`questions.status` 仍然是「學生是否可見」的唯一來源（`published` = 可見），覆核紀錄則回答
「這一版由誰在何時確認過」。系統**不會**新增第二個「已覆核」狀態欄位，避免兩套狀態互相衝突：
「覆核狀態」是由 `status`、`revision` 及 `question_reviews` **推導**出來的（見
[src/lib/types.ts](../src/lib/types.ts) 的 `questionReviewStateSchema`）。

## 2. 覆核步驟

> **Sprint 4 起，步驟 3 的「發布」由程式強制執行**：沒有對應**目前版本**的人工覆核紀錄時，
> 發布會回 **409**（見 [src/server/services/question-service.ts](../src/server/services/question-service.ts)）。
> 教師端「題目管理」提供「覆核通過並發布」「退回修改」「標示不可用」三個按鈕，
> 並顯示每一題的覆核狀態及版本編號。

1. 教師在 `/teacher/questions` 只會看到 `draft`（草稿）題目；已發布題目為學生可見。
2. 逐題核對下列項目，並在 `golden-questions.v1.json` 記錄結果：
   - 課程層級（中一／中二／中三）、課題及分節是否正確。
   - 題幹、選項、標準答案（`correctAnswer`）是否只有一個站得住腳的答案。
   - 每一個錯誤選項為甚麼錯（必須是真實存在、同類而容易被混淆的史實）。
   - 解釋是否足以說明「為甚麼正確」及「為甚麼其他選項不對」。
   - 短答題得分要點是否接受實質正確的其他寫法（`acceptedAnswers`）。
   - 是否有任何教材沒有交代的年份、人名、條約或事件（`qualityWarnings`）。
   - 若依據來自 OCR 辨識文字，該段文字是否與原圖一致。
3. 在教師端按「覆核通過並發布」，系統會：
   - 把**覆核者（電郵及角色）、時間、決定、題目版本及內容指紋**寫入 `question_reviews`；
   - 將題目狀態設為 `published`，令學生可見。
   **未經覆核的題目不可能出現在學生練習的題庫選項中**（學生端的 AI 即時生成亦不會寫入題庫；示範模式自動發布的題目會標示為「已發布（未經人工覆核）」）。
4. 有疑點的題目按「退回修改」或「標示不可用」並**填寫原因**（系統要求必填）；題目會維持草稿狀態，學生不會看到。
5. **覆核後如果修改了題目內容**：版本會遞增，舊覆核立即失效，題目會自動回到草稿並顯示「覆核後已修改，需重新覆核」；必須重新覆核才可再次發布。這確保學生看到的內容永遠對應「被覆核的那一版」。

## 3. 紀錄格式（`golden-questions.v1.json`）

每一筆紀錄必須包含：

| 欄位 | 說明 |
| --- | --- |
| `id` | 題目 ID（`questions.id`）或 `golden-<序號>` |
| `version` | 本題紀錄的版本（每次修改遞增） |
| `curriculum` | `{ level, topicId, topicTitle, sectionId, sectionTitle }` |
| `stem` | 題幹文字 |
| `options` | 選擇題選項（非選擇題為空陣列） |
| `approvedAnswer` | 教師確認的標準答案 |
| `acceptedAlternatives` | 短答／填充題可接受的其他寫法 |
| `gradingRubric` | 短答題得分要點（若適用） |
| `evidence` | 依據：`{ sourceExcerpt, sourceLocation, sourceBlockIds, reference }`；`reference` 為教材以外的權威來源（教科書頁數、官方文件），沒有就填 `null` |
| `reasoning` | 史實解釋：為甚麼這個答案是對的 |
| `distractorNotes` | 逐個錯誤選項為甚麼錯 |
| `skill` | 這題主要考核的歷史技能（`HISTORY_SKILLS` 之一；未標示為 `null`） |
| `category` | 覆蓋類別：`chronology`／`cause-consequence`／`significance`／`comparison`／`people`／`treaty`／`plausible-distractors`。<br>**注意**：`source-interpretation`（史料解讀）需要向學生展示史料，屬「DEFERRED — OUT OF SCOPE FOR THIS PHASE」，現有題型無法產生，因此不在此列。 |
| `reviewStatus` | `pending-review`（待覆核）或 `approved`（已覆核） |
| `reviewer` | 覆核教師姓名／代號；`pending-review` 時必須為 `null` |
| `reviewedAt` | 覆核日期（ISO 8601）；`pending-review` 時必須為 `null` |

> `reviewStatus: "approved"` 的紀錄若沒有 `reviewer` 及 `reviewedAt`，`tests/golden-questions.test.ts`
> 會令測試失敗——這是刻意的：**不得偽造教師覆核**。

## 4. 覆蓋範圍

黃金題庫的目標是覆蓋課綱要求的主要題型與史實能力（每類至少 2 題，經教師覆核）：

- [ ] `chronology` 時序判斷
- [ ] `cause-consequence` 因果關係
- [ ] `significance` 歷史意義
- [ ] `comparison` 比較
- [ ] `people` 人物
- [ ] `treaty` 條約／文件
- [ ] `plausible-distractors` 錯誤選項的迷惑性

> **不在本階段範圍**：需要向學生展示史料再作推論／比較／評價的類別（史料解讀、來源可靠性、衝突史料的比較）**未實作**，因此不會出現在覆蓋清單中，亦不可聲稱已涵蓋這些課程技能。

目前的覆蓋狀態見 `golden-questions.v1.json` 的 `coverage` 欄位。

## 5. 現況

**本流程尚未執行：平台目前沒有可用的歷史科教師覆核者，因此沒有任何一題已被人工覆核。**
`golden-questions.v1.json` 的 `questions` 陣列刻意保持空白，避免以程式產生的內容冒充
人工覆核結果。在完成至少一輪教師覆核前，本項發布關卡（historical teacher review）
維持 **pending**。

Sprint 4 之後，程式已強制「未覆核不可發布」（見第 2 節），因此這項 pending 關卡現在
**無法被繞過**：目前學生可見的題目全部屬「已發布（未經人工覆核）」（示範題庫由
`DEMO_AUTO_PUBLISH_QUESTIONS` 自動發布），任何**新增**的發布都必須先有教師覆核紀錄。
兩者的分別會同時顯示在教師端題目清單及 API 回應中。
