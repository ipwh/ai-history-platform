# 歷史科題目人工覆核流程（Teacher Review Workflow）

> **本流程的目的**：把「系統證明節錄文字對得上教材」（`sourceVerified`）與
> 「教師確認史實正確、題目適合學生」（`reviewed`）分開。系統只做前者；後者必須由
> 歷史科教師完成，而且必須留下紀錄。**AI 不會、也不可以提供人工覆核結果。**
>
> **Sprint 7.8（2026-10-16）起的位置**：學生自學**不再等待教師逐題預先批准**。題目只要通過
> 系統的**自動品質驗證**（見 README「學生自學優先」一節）就會供學生練習；本文件描述的
> 人工覆核改為**事後補救與抽樣**流程。自動驗證紀錄與人工覆核紀錄分開保存，教師端一律
> 分得出「機器檢查通過」與「教師確認過」。
>
> **2026-10-16 教材更新後的後續處理（已完成）**：以 2026-10 版教材取代舊教材後，有 **66 條題目**的原文節錄
> 在新教材找不到逐字相符的段落（課題11 佔 35 條，多為舊版用詞改寫，例如「欠發達國家」→
> 「發展中國家」；其餘為舊教師版的「資料題」練習內容，新教材已刪去）。其後逐題把題目**與答案**放回新教材核對：
> 其中 **30 條**找到逐字相符的段落並重新連結（見 `docs/material-remapping/2026-10-material-refresh.json`）；
> 其餘 36 條按擁有者指示處理（「一切以新教材內容為準；新教材沒有相關內容者刪除」）：
>
> | 處理 | 條數 | 詳情 |
> | --- | --- | --- |
> | 改寫（含更正答案、更新用詞） | 31 | 見 `docs/teacher-review/question-queue-actions-2026-10.json` |
> | 刪除（新教材完全沒有相關內容） | 5 | 非殖民地化方式分類（3 條）、施里芬計劃、最後通牒時限 |
> | 另：已重新連結題目的用詞對齊 | 23 | 見 `docs/material-remapping/2026-10-wording-alignment.json` |
>
> 36 條的處理結果已寫回 `docs/teacher-review/material-decision-queue-2026-10.json` 的 `resolution` 欄位
> （每條標示改寫後版本號或已刪除）。改寫的題目一律以新教材段落作依據（逐字節錄驗證），
> **沒有**建立任何人工覆核紀錄；刪除的 5 條在刪除前已確認作答紀錄、題目回報及覆核紀錄均為 0。
> 教師如認為某條改寫後的題目不合用，可在 `/teacher/questions` 再修改或停用。
> 尚有 **25 條課題1 校內試題**在教材更新前已「未通過教材依據核對」（屬校內試卷題目，非本次範圍）。
> 2026-10-16 後續處理：其中 **10 條短答題**的節錄只因匯入時的版面標記（`\n@O`）而從未連結段落，
> 已改為試卷文件內逐字相等的題幹並連結該段落（見 `docs/teacher-review/school-paper-evidence-links-2026-10.json`）；
> 餘下 **25 條**（5 條 MCQ、20 條 DBQ）的節錄由題幹、資料引文及子題等多段文字組成，
> 平台的核對規則要求**單一段落**包含整個節錄，因此無法取得單一段落依據——
> 逐條原因及逐行證據記錄在 `docs/teacher-review/school-paper-unverified-2026-10.json`。
> 校內試題（`origin = school-paper`）的節錄本來就不會顯示給學生（見 README「沒有引用段落 ≠ 可以顯示」），
> 所以這是教師端的狀態記錄，不影響學生；教師如要處理，可為題目改用較短的單段節錄
> （例如只引用資料原文）或把同組子題拆成獨立題目。
>
> **2026-10-20：解釋品質與技能標籤**——原本 1,875 題的解釋全部屬「佔位文字」（1,329 題，同一句
> 「答案依校內試題檔的評卷參考。」）或「只列答案」（546 題），技能標籤 **100% 空白**。
> **現況（2026-10-20 完成）**：全部 1,875 題的解釋已由 AI 逐題依課本段落補寫並通過品質分類器
> （佔位／只列答案／過短均為 0），`explanation_rewritten` 標記 1,875 筆；`questions.skill` 依負責人
> 決定**維持空白**。補寫**不是**覆核：`question_content_flags` 只是工作狀態，`question_reviews`
> 沒有因此增加，題目 `revision` 如實 +1。
> 工作清單：[explanation-skill-worklist-2026-10-20.md](explanation-skill-worklist-2026-10-20.md)；
> 補寫指引及 AI 起草 prompt 範本：[explanation-rewrite-guidelines-2026-10-20.md](explanation-rewrite-guidelines-2026-10-20.md)；
> 診斷：[../quality/explanation-skill-diagnosis-2026-10-20.md](../quality/explanation-skill-diagnosis-2026-10-20.md)；
> 進度及決定：[decision-2026-10-20-explanation-rewrite.md](decision-2026-10-20-explanation-rewrite.md)。
> 這批工作**不會**代替本文件描述的覆核：`question_content_flags` 內「解釋待重寫」等標記只是
> 工作狀態，不是覆核決定，不會改變題目的發布狀態。

## 1. 四種狀態必須分開

| 狀態 | 由誰決定 | 代表甚麼 | 系統欄位 |
| --- | --- | --- | --- |
| 教材依據成立 | 系統（自動） | `sourceExcerpt` 逐字出現在**該題引用的段落**中，且節錄長度達 8 字（太短的片段會在無關段落中出現；作者撰寫的節錄——示範題庫、教師手動建立——不受長度限制，見 `src/server/materials/block-search.ts`） | `Question.sourceVerified` |
| 完整題目品質（答案唯一、選項同類、解釋一致、無答案洩露等） | 系統（自動） | 見 [src/server/llm/question-quality.ts](../../src/server/llm/question-quality.ts) 及 README「自動品質閘門的能力與限制」 | `questions.auto_validated_at`／`auto_validated_revision`／`auto_validated_fingerprint` |
| **未確定：項目保留，只記錄警告（2026-10-18 放寬）** | 系統（自動）判定，交教師覆核但**不阻礙發布** | 其他未確定項目（教材只交代先後卻寫成因果等）；答案只是教材語句的改寫、填充題答案未能對應歷史元素清單但見於教材則屬此類 | `questions.quality_warnings`；`teacher_confirmation_required` 只在其餘未確定項目（如 `unsupported-causation`、`dimension-unsupported`、`asserted-inference`）時使用 |
| **結構上無法作答：暫停派發** | 系統（自動）判定，**學生看不到** | 填充題題幹有多個空格但只有一個答案、題幹沒有空格、答案仍印在題幹、選項全部變成「.」或重複、時序題已把各事件的年份印在題幹（學生只須比較題幹的數字即可排序，見 [chronology-stem.ts](../../src/server/llm/chronology-stem.ts)） | `teacher_confirmation_required`（品質警告以「平台自動檢查：」開頭）；時序題一類由 `checkQuestionServable()` 判定，教師端的「不可派發原因」會顯示理由；以 `npm run repair:questions` 修正原卷問題後會自動清除標記；擁有者確認無法修復時可加 `--delete-unusable` 刪除（2026-10-18 已刪除 29 題） |
| 需教師核對的疑點 | 系統（自動） | 教材未提及的人名／條約名、選項重複等 | `Question.qualityWarnings` |
| 已人工覆核 | **歷史科教師** | 史實、用語、選項、答案及解釋均已確認 | `question_reviews` 的紀錄 + `Question.revision` |

「未確定」與「已人工覆核」的關係：未確定是**系統無法確認**，因此必須由人補上判斷。
教師在「題目管理」看到「等待教師確認（自動發布暫緩）」標記、具體的品質訊息、目前的題目
版本及完整節錄後，可以（a）「覆核通過並發布」——代表疑問已由人解決；或（b）「重新執行
品質驗證」——重跑機器檢查，通過即記錄驗證結果；或（c）修正內容、退回修改或標示不可用。
所有決定都綁定**目前版本**，修改內容後自動失效。**系統不會**在任何路徑上把「未確定」當作
「已確認」——包括教師沒有處理時題庫組題、學生即時生成及擁有者授權的批次發布
（見 README「未確定題目的交付路徑」）。

`sourceVerified = true` **不代表**史實正確。它只代表題目引用的文字確實來自教材。

> **Sprint 6 追加：節錄是否「向學生顯示」是另一個獨立的閘門，與覆核狀態無關。**
> 學生作答後的「教材來源」只會在該題引用的**全部**教材段落都屬於「已確認可向學生發布」
> 的文件、且該段落不屬教師專用內容（答案／評分參考）時才顯示節錄；否則回饋會標示
> `sourceWithheld`，並略去節錄、來源位置及段落 ID（題目、答案及解釋不受影響）。
> 因此**即使題目已由教師覆核通過，學生仍可能看不到節錄**，直到管理員在
> `/admin/materials` 確認該文件的發行權（教師版另需內容安全覆核）。
> 教師端覆核畫面一律顯示完整節錄，不受此閘門影響（見 README「教材版權與學生閱讀範圍」）。
> 覆核時若 `sourceExcerpt` 對得上教材但未開放，應在覆核紀錄的 `reasoning` 說明依據來源，
> 以免日後無法追溯。
>
> 這個閘門同樣可以由**擁有者授權批次開放**（`npm run open:materials`）：仍然要作出同一組兩項
> 確認，但由擁有者一次過作出，並把決定寫入
> [`owner-material-openings.json`](owner-material-openings.json)（擁有者電郵、原因、時間、
> 開放了哪幾份文件，以及每份有多少段落被判定為教師專用而不會顯示）。教師版的
> `content_reviewed_by` 會如實標明「擁有者授權批次開放，未逐段人工核對」——**不得**當作
> 已逐段核對的證明。

`questions.status` 仍然是「學生是否可見」的唯一來源（`published` = 可見）；**兩種授權紀錄**
（人工覆核、自動品質驗證）都必須對應**目前版本**才有效，系統**不會**新增「已覆核」狀態欄位，
避免兩套狀態互相衝突：「覆核狀態」是由 `status`、`revision` 及 `question_reviews`
**推導**出來的（見 [src/lib/types.ts](../../src/lib/types.ts) 的 `questionReviewStateSchema`）；
自動驗證則另外以 `auto_validated_*` 三個欄位記錄，教師端顯示為「已發布（未經人工覆核）」。

## 2. 覆核步驟

> **發布關卡由程式強制執行**：`PATCH /api/teacher/questions/[questionId]` 設定
> `status = published` 時，必須存在對應**目前版本**的人工覆核紀錄**或**自動品質驗證紀錄，
> 否則回 **409**（見 [src/server/services/question-service.ts](../../src/server/services/question-service.ts)）。
> 單憑 `sourceVerified`（教材依據自動核對）不足夠。
> 教師端「題目管理」提供「覆核通過並發布」「退回修改」「標示不可用」三個按鈕，並顯示每一題的
> 覆核狀態、版本編號、自動驗證時間及「以舊版批改的作答數」。
> 教師端回報面板另提供「暫時下架題目」及「重新執行品質驗證」兩個補救按鈕（Sprint 7.8）。

1. 教師在 `/teacher/questions` 會看到全部題目；`draft`（草稿）題目學生看不到，
   `published` 題目學生可見（可能是經自動品質驗證發布，教師可查看驗證時間及版本）。
2. 逐題核對下列項目，並在 `golden-questions.v1.json` 記錄結果：
   - 課程層級（中一／中二／中三）、課題及分節是否正確。
   - 題幹、選項、標準答案（`correctAnswer`）是否只有一個站得住腳的答案。
   - 每一個錯誤選項為甚麼錯（必須是真實存在、同類而容易被混淆的史實）。
   - 解釋是否足以說明「為甚麼正確」及「為甚麼其他選項不對」。
   - 短答題得分要點是否接受實質正確的其他寫法（`acceptedAnswers`）。
   - 是否有任何教材沒有交代的年份、人名、條約或事件（`qualityWarnings`）。
   - 若依據來自 OCR 辨識文字，該段文字是否與原圖一致。
   - **自動品質驗證無法判斷的個案**：題幹的史實前提是否被扭曲、錯誤選項是否其實與答案
     同義（不同譯名、同一人的不同稱號）——這些只有教師判斷得到（見 README 同一節的限制表）。
3. 在教師端按「覆核通過並發布」，系統會：
   - 把**覆核者（電郵及角色）、時間、決定、題目版本及內容指紋**寫入 `question_reviews`；
   - 將題目狀態設為 `published`，令學生可見。
   介面提交時會帶同**教師正在審閱的版本**（`expectedRevision`）；若題目在你審閱期間已被別人修改，
   系統會回 **409** 並要求重新載入，**不會**把你的決定記到你沒有看過的版本上（Sprint 8.7）。
   **經人工覆核與經自動驗證的題目都會出現在學生練習的題庫中**，兩者以教師端的覆核狀態區分；
   沒有任何一種驗證紀錄的題目**不會**出現（學生端的 AI 即時生成亦套用同一套自動品質驗證；
   示範模式自動發布的題目會標示為「已發布（未經人工覆核）」）。
4. 有疑點的題目按「退回修改」或「標示不可用」並**填寫原因**（系統要求必填）；題目會回到草稿狀態，學生不會看到（已在進行中的練習仍保留凍結試卷，見第 6.5 節）。
5. **修改題目內容後**：版本會遞增，**人工覆核與自動驗證一併失效**，題目會自動回到草稿並顯示「覆核後已修改，需重新覆核」；必須重新覆核（或重新執行自動品質驗證）才可再次發布。這確保學生看到的內容永遠對應「被驗證的那一版」。此外，系統會記下每次作答批改時的版本，教師端因此看到「有 N 筆舊版作答」，**不會**靜默重算學生的歷史分數。

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

## 6. 覆核作業手冊（Runbook）

以下步驟供實際負責覆核的歷史科教師使用。**人工智能不會、也不可以提供覆核結果**；
平台只負責保存紀錄及防止未覆核的題目發布。

### 6.1 覆核者資格

- 必須是學校的歷史科教師（或經科主任授權的人員），具備該課題的教學經驗。
- 教師帳戶須列在 `AUTH_TEACHER_EMAILS`（或按學校選定的角色政策取得教師權限，例如學校
  暫時採用的 `AUTH_STAFF_ACCESS_POLICY=school-domain`；見 README 第八節）。
- 覆核者姓名／代號會寫入 `question_reviews.reviewer_email` 及黃金題庫紀錄，因此**必須是
  可追溯至真人的身分**，不可共用帳戶。
- 如沒有符合資格的覆核者，本關卡維持 pending；**不得**以代號或程式冒充覆核。

### 6.2 覆核每題時的檢查順序（建議）

1. **課程對應**：課題、分節、年級是否正確；難度標示是否合理。
2. **史實正確性**：題幹、選項、答案、解釋是否有史實錯誤（包括日期、人物、條約、因果）。
3. **教材依據**：`sourceExcerpt` 是否真的支持答案；若來自 OCR，對照原圖確認文字無誤。
   注意 `sourceVerified = true` **只代表節錄出自所引教材**，不代表史實正確。
4. **答案與選項**：是否只有一個站得住腳的正確答案；每個錯誤選項是否同類而明顯錯誤
   （不是無關或可反駁的）；選項長度／用詞是否提示答案。
5. **用語與適齡程度**：用語是否符合課程程度，是否含不必要或敏感的表述。
6. **品質警告**：逐項處理 `qualityWarnings`（教材未提及的人名／條約名等）。
7. **填充題的其他寫法**：確認 `acceptedAnswers` 已列出合理的等效寫法（繁簡、全半形、
   同義詞）；否則學生會因寫法不同而被判錯。
8. **填充題的答案是否為歷史要素**：填充題的答案應是著名歷史事件、人物、年份、國家、
   地點、條約、神祇、思想、政治制度等具歷史意義的要素，**不應**是普通詞語或形容詞
   （例如「為生方法」、「時代特徵」）。系統已在生成及驗證階段丟棄不合格的答案
   （判定見 `src/server/llm/historical-answer.ts`，規則見 README「填充題答案必須是歷史要素」），
   因此覆核時若仍見到這類答案，代表它來自舊批次或教師手動建立，應改寫或標示不可用。

### 6.3 決定與紀錄

- **通過**：在教師端按「覆核通過並發布」。系統會記錄覆核者、時間、題目**版本**及內容
  指紋；該題才可發布。
- **退回修改**：必須填寫原因（例如「選項 2 與 3 意思相近」、「解釋未說明錯誤選項為何錯」）。
  題目維持草稿，學生看不到。
- **標示不可用**：必須填寫原因（例如「教材未提及此史實」）。題目維持草稿。
- 每題都要在 `docs/teacher-review/golden-questions.v1.json` 留下紀錄（格式見第 3 節）。

### 6.4 覆核後修改題目

任何內容修改都會遞增版本並令先前的覆核**及自動品質驗證**立即失效，題目自動回到草稿。
**必須重新覆核**（第 6.2 節）或重新執行自動品質驗證才可再次發布。這是刻意設計：學生看到的
內容永遠對應「被驗證的那一版」。

> 重新驗證**不會**自動把已撤回的題目復活：`revalidateQuestion`／回報面板的「重新執行品質
> 驗證」只記錄驗證結果，發布仍然是一個明確的動作。

### 6.5 發布後的抽樣與監控（建議做法）

平台提供以下訊號，建議每次發布批次後檢查：

1. **學生回報**（`/teacher/questions` 的「待覆核回報」）：學生可就「題目不清楚／答案有爭議／
   解釋不明白／教材來源有問題」回報。回報會記下**當時的題目版本、內容指紋及學生當時的答案**，
   並在題目被修改後標示「回報的是舊版本」。教師可逐筆處理，或直接用面板上的按鈕
   「暫時下架題目」（`status = disabled`，可隨時重新發布）及「重新執行品質驗證」；
   實際採取的行動會記錄在回報的 `resolution_action`。**回報本身不會自動改動題目或分數**，
   亦不會自動結案。
2. **AI 批改標示為「需要教師覆核」的填充題**：學生的答案與標準答案只差一個字時系統不會
   自行判定，會標示出來，代表該題的 `acceptedAnswers` 可能需要補充。
3. **抽樣比例**：建議首批每題由第二位教師抽樣複核（例如 10%），並在黃金題庫紀錄的
   `version` 中反映修訂。自動品質驗證只擋機器可判斷的缺陷，**不能代替抽樣**。
4. **舊版作答**：教師端題目會顯示「以舊版批改的作答數」（`staleAttempts`）。修正題目後
   建議檢查這些作答是否需要跟進；系統不會自行重算，任何重新計算都必須由人明確決定並記錄。
5. **覆蓋率**：`golden-questions.v1.json` 的 `coverage` 欄位顯示各類別已覆核的題數；
   未達標的類別不可聲稱已涵蓋。

> **凍結試卷**：學生已經開始的練習會凍結當時的題目。撤回題目只會令它不再出現在**新**練習，
> 該次既有練習仍可作答及查看（這是刻意的，避免追溯改寫學生看到的試卷）。

> **若日後確認已交付的題目有重大錯誤（例如史實錯誤、答案不成立）**：**既有設計不變**，
> 平台不會回頭改寫學生已看到的試卷或已記錄的分數。建議的處置順序是：
> 1. **立即撤回**（`status = disabled`，或修正後重新覆核發布）——令該題不再進入**新**練習；
> 2. **保留證據**：學生回報已記下當時的題目版本、內容指紋及學生答案（見第 6.5 節第 1 項），
>    足以判斷「哪些學生在舊版作答過」，教師端亦顯示「以舊版批改的作答數」；
> 3. **人工更正**：必要時由教師在課堂或課後向受影響班別說明正確內容，這一步必須由人執行；
> 4. **不要**把中斷中的練習即時抽走題目或重算分數——那會令學生看到的試卷前後不一致，
>    亦會令既有的作答紀錄無法解釋。若將來要改為「即時中斷」，必須先由擁有者決定並更新
>    本節，而不是由程式自行決定。

### 6.6 不可聲稱的事項

- **不可**聲稱已涵蓋課程全部歷史技能：需要向學生展示史料的技能（歸納推論、比較不同解釋、
  質疑資料可信性）在本階段**未實作**（見 README「未實作的範圍」）。
- **不可**把 `sourceVerified`、AI 驗證或本手冊的完成度當作史實正確的證明。
- **不可**在沒有具名覆核者的情況下標示任何題目為已覆核。

## 5. 現況

**平台內的覆核紀錄**：本機資料庫現有 3,148 筆「通過」紀錄，全部由同一個管理員帳號
（`ipwh@pochiu.edu.hk`，`reviewer_role = admin`）於 2026-10-18 寫入，名義分為兩類：
批次發布（1,882 筆）、自動修復後補記（1,266 筆）。早前文件記述的 17 筆「經登入工作階段
逐題覆核」**不在**這份本機快照內；本報告無法確認它們是否仍存在於其他環境，因此不能與
上列數字相加。這兩類紀錄的性質不同，系統目前**沒有欄位**區分（見
[稽核報告](../audit-2026-10-18-platform-audit.md) AU-04），所以不可把 3,148 筆一律當成
逐題人類審閱，也**不可**反推「沒有人核對過」。

**上載前的史實核對（在平台以外進行）**：擁有者確認題目上載前已由科組核對歷史事實。
倉庫內的書面證據是 [`owner-publication-overrides.json`](owner-publication-overrides.json)
2026-10-15T08:41:22Z 的授權理由「科組已審閱課本及校內試卷題目，授權上線前批次發布
（未逐題留下覆核紀錄）」（143 題）。該次核對的逐題範圍及結論不在倉庫內，**無法**逐題重建。

**黃金題庫是一份獨立的評估資料集**：`golden-questions.v1.json` 的 `questions` 陣列刻意保持
空白，避免以程式產生的內容冒充人工覆核結果。這項 pending 指的是**這份評估資料集尚未建立**
（因而無法量度閘門與教師判斷的一致度），而**不是**「題目從未經史實核對」。

**Sprint 7.8 之後，學生的自學不再被這項 pending 阻塞**：程式會先套用自動品質驗證
（機器可判斷的缺陷：答案不唯一、教材不支持、解釋空洞等），通過的題目即供學生練習，
並在教師端如實標示為「已發布（未經人工覆核）」。發布仍然必須有對應**目前版本**的一種
驗證紀錄（人工覆核或自動驗證），否則一律 **409**——因此「沒有驗證就發布」依然不可能。

**不可混淆的是**：自動品質驗證**不是**史實正確的證明（見 README「自動品質閘門的能力與限制」）。
上載前的科組核對、本節的黃金題庫，以及平台內的逐題覆核紀錄是三件不同的事；任何一項都不能
單獨證明「現行版本的全部題目已獲史實批准」。學生回報與教師抽樣（第 6.5 節）仍然是發現
個別史實問題的主要途徑。

**修復來源（repair provenance）**：2026-10-19 的唯讀稽核
[repair-provenance-2026-10-19.json](./repair-provenance-2026-10-19.json) 以 `materials/` 內的原始
試題檔重建修復前內容，逐題比較後發現 **18 題**的考核答案在自動修復後已改變
（舊紀錄的「考核的答案不變」對這 18 題並不準確）。程式已改為：會改變考核答案時**不改寫**，
標示待教師確認。本機資料集先以 `--quarantine` 隔離全部 18 題，然後由擁有者於 2026-10-19
逐題裁決：**16 題核准、2 題拒絕並刪除、0 題仍隔離**；其中 2 題先退回、按指示修正後於第 6 版核准，
1 題按指示新增可接受答案「鄉議局」。逐題理由見
[repair-adjudication-results-2026-10-19.md](./repair-adjudication-results-2026-10-19.md)，
裁決前的證據快照見 [repair-adjudication-2026-10-19.md](./repair-adjudication-2026-10-19.md)。
本節的黃金題庫仍然保持空白，兩者不可互相代替。

**隔離之後的重新確認**：18 題在隔離時版本會遞增（第 5–8 版），隔離前的核准因此自動失效；
教師重新核准會寫入一筆帶新時間戳的紀錄（migration 0021），不會沿用舊紀錄。2026-10-19 的 18 題
裁決已完成：16 核准（含 2 題修正後於第 6 版核准）、2 拒絕並刪除。

**機器用的驗收樣本不是覆核紀錄**：[question-quality-fixtures.v1.json](./question-quality-fixtures.v1.json)是 Sprint 8.5 的教學品質閘門測試樣本（合成教材、機器判定，`reviewStatus: machine-fixtures-not-teacher-approved`）。
它**不是**黃金題庫，也不代表任何題目已獲教師或史實批准；請勿把兩者混為一談。

**真實生成題目的覆核樣本仍待覆核**：[generated-question-sample-2026-10.json](./generated-question-sample-2026-10.json)
收錄 8 條由本機資料庫抽出的真實生成題目，附出處、完整逐字節錄、所引用段落原文及七項審題欄位。
每一項的 `reviewerDecision` 都是 `pending-review`，覆核者及日期留空；填寫後必須同時填上覆核者及日期，
否則測試會失敗（不得偽造覆核）。套件版本為 v3（Sprint 8.7）：每題的 `provenance.sourceContext`
提供所引用段落的原文（每段上限 400 字），令教師能判斷節錄有沒有被斷章取義。

## 7. Sprint 8.7 新增的覆核工具與證據

| 檔案／指令 | 用途 | 現況 |
| --- | --- | --- |
| `npm run review:package -- --write`（[build-review-package.ts](../../scripts/build-review-package.ts)） | 以**唯讀**方式產生教師覆核套件（v3） | 5 題（`material-mock` 示範題已於 2026-10-17 全部清除，套件只餘 `material-ai`），全部 `pending-review` |
| `npm run review:calibration -- --write`（[build-calibration-report.ts](../../scripts/build-calibration-report.ts)） | 把教師決定與機器判定並列，分類為假通過／假攔截／內容問題／教學問題 | [human-vs-machine-calibration-2026-10.json](./human-vs-machine-calibration-2026-10.json)：5 題全部待覆核、0 項分歧，不含任何比率 |
| [review-workflow-audit-2026-10.json](./review-workflow-audit-2026-10.json) | 覆核流程 12 項契約的逐項審核（角色、示範身分、版本綁定、只增不改、暫緩標記、來源可見性）及已知限制 | 發現 1 個實際缺陷並已修正（見下） |
| [published-question-risk-report-2026-10.json](./published-question-risk-report-2026-10.json) | 兩條在 Sprint 8.6 被重算判 `reject` 的題目之風險評估 | 只有 1 條已發布（`q_058eda0378394d0f`）；另一條為草稿。**沒有**改動任何題目或發布狀態 |
| [explanation-reference-corrections-2026-10.json](./explanation-reference-corrections-2026-10.json) | 7 條解釋段號的建議修正（v2，附舊值／建議值／信心／所需授權） | 全部 `applied: false`，**未取得授權、未套用** |
| `npm run review:adjudication`（[build-teacher-adjudication.ts](../../scripts/build-teacher-adjudication.ts)） | 由修復來源報告產生 18 題逐題裁決套件（原始 vs 現行、空格位置及答案次序、版本與紀錄來源、待填決定欄）；**唯讀** | [repair-adjudication-2026-10-19.md](./repair-adjudication-2026-10-19.md)：18 題全部 `decision.unset`，`proposedCorrection: null` |
| `npm run review:content-queue`（[build-content-quality-queue.ts](../../scripts/build-content-quality-queue.ts)） | 把**不同性質**的內容問題分開列出（附錄 B 疑點、佔位解釋、知識點、技能／難度、來源不可追溯、教材發行權） | [content-quality-queue-2026-10-19.md](./content-quality-queue-2026-10-19.md)：各分類互不等價，不是發布批准 |

**已修正的實際缺陷（覆核版本綁定）**：`POST /api/teacher/questions/[questionId]/review` 以往只接受
`decision`，教師的頁面若長時間開啟，可對已被別人修改的題目送出 `approved`，覆核紀錄便會綁到教師
從未看過的版本。現在必須提交 `expectedRevision`（教師看到的版本）：非正整數 → **400**，與現行版本
不符 → **409** 並要求重新載入，且**不寫入**任何覆核紀錄。教師端三顆按鈕已帶上版本；端對端測試亦
加了一項「覆核指明的版本與現行版本不符會被拒絕（409）」的檢查。回歸測試見
[tests/teacher-review-workflow-integrity.test.ts](../../tests/teacher-review-workflow-integrity.test.ts)。

**仍然只可由人決定的事**：史實是否正確、答案是否唯一、錯誤選項是否有意義、解釋是否幫助理解、
難度及課程取捨。上述工具只整理證據及機器結果，不會代替教師判斷，亦不會因為樣本小而調整門檻。

## 8. Sprint 8.8：教師覆核工作階段指引（給實際審題的歷史科教師）

> 這一節描述**教師實際會做甚麼**，以及系統會如實記錄甚麼。所有紀錄在教師按下決定之前都是
> `pending-review`；程式不會代填，也不會有「先通過再審」的流程。

### 8.1 在哪裏審題

1. **平台教師介面**（`/teacher/questions`，需教師或管理員帳戶）：每一題顯示題幹、選項（正確答案
   標示）、標準答案、解釋、知識點、教材依據位置、**逐字節錄**、品質警告、目前版本、覆核狀態、
   以及「學生看不到節錄」等來源可見性提示。
2. **覆核套件**（[generated-question-sample-2026-10.json](./generated-question-sample-2026-10.json)）：
   同一批 8 題的離線版本，另附所引用段落的原文（`provenance.sourceContext`，每段上限 400 字）
   及生成時／以現行規則重算的閘門結果。**用途是對照原文**，不是替代平台紀錄。
3. **完整課文**：若該教材文件已開放給學生（`studentDistribution = true`），教師可在課題閱讀頁
   看到全文；未開放的教材，教師只會看到節錄及出處位置。

### 8.2 審題時要判斷的七項（與套件的 `reviewChecklist` 一致）

| 代號 | 要判斷的事 |
| --- | --- |
| `learningObjective` | 這題考核哪一項學習重點？是否在課程範圍之內？ |
| `questionClarity` | 學生只讀題目文字，是否清楚知道要答甚麼？ |
| `historicalAccuracy` | 題目、答案及解釋的史實是否正確？（須對照課本原文） |
| `answerCompleteness` | 標準答案及得分要點是否完整回應題目的要求？ |
| `distractorValidity` | 錯誤選項是否同類、明確錯誤，而且不會同樣成立？ |
| `explanationUsefulness` | 解釋是否幫學生理解推理，而不是重複答案或抄錄課文？ |
| `cognitiveDemand` | 認知要求是否配合難度標示？ |

### 8.3 如何記錄決定（平台）

| 動作 | 系統行為 |
| --- | --- |
| 「覆核通過並發布」 | 會先問**覆核理由（可留空）**；提交時帶同**你正在審閱的版本**（`expectedRevision`）。成功後題目即發布、暫緩標記（如有）會由你的決定清除，紀錄含覆核者、時間、版本、內容指紋、理由。 |
| 「退回修改」 | **必須填寫原因**；題目回到草稿，學生即時看不到。 |
| 「標示不可用」 | **必須填寫原因**；題目回到草稿，不會自動刪除（保留回報及作答紀錄）。 |
| 題目在你審閱期間被別人修改 | 提交會回 **409**，訊息會說明「你正在覆核的是第 N 版，目前是第 M 版」；**不會**留下任何紀錄。請重新載入、重新核對後再提交。 |
| 重複提交相同決定 | 回 `created: false`，不會重複寫入（冪等）。 |
| 提交失敗（網絡或 400） | 介面顯示錯誤，題目狀態不變；沒有「假成功」訊息。 |

> 覆核紀錄**只增不改、不可刪除**（沒有對應 API）。若同一題其後被修改，舊覆核會被視為
> `stale-approval`，題目自動回到草稿，必須重新覆核。

### 8.4 已發布題目的風險處理（Sprint 8.8）

[published-question-containment-2026-10.json](./published-question-containment-2026-10.json)
逐一記錄了兩條被機器判 `reject` 的題目：內容、來源段落、閘門判定理由、可達性、下架機制實測結果，
以及給擁有者／教師的具體建議。

- `q_058eda0378394d0f`（**已發布**）：題幹問「詞語」但答案是時期標示，選項跨層級；**建議即時下架**，
  其後改寫並重新覆核。
- `q_062fdfd516314f3d`（**草稿**）：答案出現在題幹；**保持草稿**，修正後才可發布。
- 下架方式：在教師介面按「暫時下架」，或 `PATCH /api/teacher/questions/{id}` `{action:'status', status:'disabled'}`。
  已在資料庫副本上實測：下架即時離開學生題庫、教師仍可讀取、可逆、可再發布（需目前版本的驗證紀錄）。

### 8.5 分歧與校準（未量度）

`npm run review:calibration -- --write` 會把**已記錄的**教師決定與機器判定並列
（[human-vs-machine-calibration-2026-10.json](./human-vs-machine-calibration-2026-10.json)）。
現時 `calibrationStatus = unmeasured`、0 項分歧、所有計數為 0：**在沒有真實覆核之前，不存在任何
可報告的一致率、準確率或誤報率**。任何數字都不得由測試結果或合成樣本推出。

### 8.6 覆核可稽核性的已知限制

覆核紀錄保存版本及內容指紋，但**沒有**保存教師當時看到的題目全文快照，也沒有題目版本歷史表。
三個改善方案的比較與建議（建議：覆核時寫入不可變快照，一個 nullable 欄位、無 backfill）見
[review-auditability-options-2026-10.md](./review-auditability-options-2026-10.md)。上述快照建議**未實作**（沒有新增快照欄位）。

另外兩項由 2026-10-19 裁決衝刺確認的限制：

- **舊自動修復紀錄的角色欄不可靠**：18 題的舊紀錄以 `reviewer_role = admin` 寫入，理由含「自動修復」。
  角色欄因此不能單獨證明是否人工覆核；裁決套件按理由另行標示，**不改寫歷史紀錄**。新寫入的修復紀錄
  一律用 `automation`，教師介面亦會加註「（自動記錄）」。
- **重新確認需要新紀錄**：同一版本可能先後出現兩次相同的核准決定（批次核准 → 隔離 → 教師重新確認）。
  Migration 0021 已移除 `question_reviews` 的唯一索引，令第二次決定可以帶自己的時間戳；冪等改由
  `insertQuestionReview()` 在題目沒有待確認標記時維持。此 migration 未在正式環境執行。

## 9. 內容品質稽核與發布閘門（Sprint 9，2026-10-19）

### 9.1 唯讀稽核

`npm run audit:content`（[audit-content-quality.ts](../../scripts/audit-content-quality.ts)）逐題分類：

| 類別 | 分類 |
| --- | --- |
| 來源 | `traceable`／`partial`／`unknown`／`pending_verification`（只代表可定位程度，不代表史實或版權） |
| 解釋 | `placeholder`／`answer_only`／`insufficient`／`potentially_inconsistent`／`not_assessed`，另標示「有人工覆核但仍低品質」 |
| 元數據 | 知識點空白／排版殘留／通用標籤／與分節對不上；技能空白；無效課題或分節關聯（阻擋級） |
| 政策 | `hard_block`／`teacher_review`／`warning`／`policy_pending` |

報告：[../quality/content-audit-2026-10-19.md](../quality/content-audit-2026-10-19.md)。

**重要界線**：分類只會發現問題，不會修改題目，也不會裁定歷史事實、答案正確性或版權。

### 9.2 發布閘門

`npm run release:gate` 只讀取資料庫及既有報告，輸出
[../release-gate-2026-10-19.md](../release-gate-2026-10-19.md)。未定義標準（例如佔位解釋是否暫緩派發）
會顯示 `POLICY_PENDING`，沒有證據（Golden dataset 空、部署證據）會顯示 `INSUFFICIENT_EVIDENCE`，
兩者都不會當作通過。

### 9.3 版權確認

擁有者已於 2026-10-19 確認版權，紀錄見
[copyright-owner-attestation-2026-10-19.md](./copyright-owner-attestation-2026-10-19.md)。
此紀錄是擁有者聲明，不是逐份出版社授權；`material_documents` 的逐份權利紀錄仍為 12／36，
未有批次回填。版權許可與來源可追溯性、歷史準確性必須分開判斷。

## 10. 可作答性、審核來源與 Golden 基準（Sprint 10，2026-10-19）

### 10.1 結構不可作答的 97 題

`npm run audit:servability`（[報告](../quality/servability-remediation-2026-10-19.md)）逐題列出：

- 96 題：選項以羅馬數字指涉題幹，但題幹沒有 i／ii 標示（`MCQ_ROMAN_LABEL_MISSING`）；
- 1 題：填充題答案仍出現在題幹（`FILL_ANSWER_LEAKS`）；
- 全部 0 次作答、0 個練習快照；建議一律 `teacher_review_required`；
- **沒有修改任何題目**——要退回草稿或隔離，需要另行授權及逐題處理。

### 10.2 審核紀錄來源（修正 Sprint 9 的 1,279 筆）

`npm run audit:review-provenance`（[報告](../quality/review-provenance-2026-10-19.md)）：

| 類別 | 數量 | 說明 |
| --- | --- | --- |
| 擁有者批次 | 1,882 | 人類決定，但不是逐題教師覆核 |
| 自動修復 | **1,266** | 理由為「模擬學生使用後自動修復」或「自動修復多空格填充題」；角色仍是 `admin` |
| 教師裁決 | 20 | 2026-10-19 的逐題裁決 |
| 來源不明 | 0 | — |

Sprint 9 的 1,279 = 1,266 筆自動修復 + 13 筆被字串規則誤判的教師裁決（理由含「自動修復」）。
目前版本：16 題有教師裁決、1,241 題只有擁有者批次、623 題只有自動修復證據。
**原始紀錄全部保留**，沒有改寫角色、時間或指紋。

### 10.3 Golden evaluation dataset v2

- [golden-questions.v2.json](./golden-questions.v2.json)：schema、狀態（`draft`／`pending-review`／`approved`／`rejected`／`superseded`）及備註；**approved fixture 仍為 0**。
- [golden-candidates-2026-10-19.json](./golden-candidates-2026-10-19.json)：42 個 `pending-review` 候選（教師裁決過的題目、答案映射曾改變、不可作答、可接受答案、有教材依據的 MC／填充），**不是** fixture，也沒有 reviewer。
- `npm run golden:eval`：approved fixture 為 0 → `INSUFFICIENT_EVIDENCE`（不是零錯誤）。
- 教師要建立 approved fixture，必須逐題填寫 reviewer、reviewedAt、題目版本／內容指紋及來源證據；題目內容一改即失效。

---

## 11. 教師裁決流程與 Golden 核准（Sprint 11，2026-10-19）

完整報告：[sprint-11-report-2026-10-19.md](../sprint-11-report-2026-10-19.md)。

### 11.1 逐題裁決 97 題不可作答題目

`POST /api/teacher/questions/[questionId]/servability`

```json
{ "decision": "keep_quarantined", "reason": "原文缺少 i、ii、iii 標示，需教師核對原卷", "expectedRevision": 8 }
```

- `decision`：`return_to_draft`／`keep_quarantined`／`request_more_evidence`／`reject`／`approve_after_verified_repair`（後者只在題目已修復至結構可作答時成功，否則 409）。
- `reason` 至少 5 個字；`expectedRevision` 是教師實際看到的版本，題目已改動時回 **409** 且不記錄任何裁決。
- 裁決寫入 `question_reviews`（理由前綴 `結構裁決（ISSUE_CODE）：…`），綁定版本及內容指紋；覆核者與時間只取自伺服器端工作階段。
- `keep_quarantined` 會設定 `teacher_confirmation_required = 1`；題目留在草稿。
- **核准不能繞過可作答性**：`recordQuestionReview(approved)` 遇到結構不可作答的題目回 409。要核准必須先修正內容（版本遞增），再經覆核 API。
- **發布狀態也不能繞過**：`changeQuestionStatus(published)` 同樣檢查 `checkQuestionServable()`；即使題目仍有舊核准紀錄，直接改狀態一樣回 409。
- 需要真實教師／管理員工作階段；未登入 401、學生 403、示範模式身分不可記錄裁決。

### 11.2 96 題羅馬數字題目的原文證據

`npm run audit:servability-evidence`（[報告](../quality/servability-evidence-2026-10-19.md)）：

| 結果 | 題數 |
| --- | --- |
| 原文標示不齊全（80 題完全無編號、1 題只有 i–iii、缺 iv） | 81 |
| 原文陳述數與選項指涉不符 | 10 |
| 原始檔缺失 | 4 |
| 找不到題幹段落 | 1 |
| **可由原文直接補上標示** | **0** |

原文本身已失去編號（表格／分欄轉存時被拆散）。按選項順序補 i／ii／iii 屬推測，因此 **96 題全部需要教師裁決**，或由科組提供原卷掃描。

### 11.3 Golden fixture 逐題核准

`GET /api/teacher/golden` 檢視候選；`POST /api/teacher/golden/[questionId]`：

```json
{
  "decision": "approved",
  "reason": "教師核對課本第 12 頁後核准",
  "expectedRevision": 3,
  "fixture": {
    "category": "chronology",
    "reasoning": "教師核對課本第 12 頁後確認此題考核文藝復興的核心思想。",
    "grading": [{ "answer": "人文主義", "correct": true }],
    "distractorNotes": [
      { "option": "重商主義", "why": "重商主義屬近代經濟政策，不是文藝復興核心思想" },
      { "option": "軍國主義", "why": "軍國主義與文藝復興的人文精神無關" },
      { "option": "封建主義", "why": "封建主義屬中古制度，非文藝復興核心思想" }
    ],
    "knownEdgeCases": [],
    "reference": "課本第 12 頁",
    "level": 1
  }
}
```

- **核准必須附上 `fixture`**：沒有 category、reasoning 及預期 grading 就不能只記「核准」（400）。
- 裁決寫入 `golden_fixture_reviews`（migration 0022，只新增），綁定版本＋指紋；題目改動後裁決自動失效（候選狀態 `stale`）。
- `npm run golden:export` 只匯出仍有效並通過 `goldenFixtureSchema` 的 approved fixture；`-- --check` 只檢查。
- 核准 Golden fixture **不會**改變題目發布狀態；Golden 裁決也不能代替發布覆核。
- 目前 **0 approved**：本 Sprint 沒有真實歷史科教師完成核准，`golden:eval` 維持 `INSUFFICIENT_EVIDENCE`。

### 11.4 仍未決定（需要科組／負責人）

1. 96 題羅馬數字題目：提供原卷逐一補標示、退回草稿重寫，或永久不派發。
2. `qb-JTH2ndEdFBQ09015`：維持原文但不派發（現狀）、改寫題幹，或退回課程設計者。
3. 623 題（P1 530、P3 93）：現有自動修復證據是否足以支持目前版本。
4. 1,334 題佔位解釋、1,880 題空白技能標籤的發布政策。
5. 由哪位歷史科教師負責 Golden 逐題核准（需要真實身分，不能用 admin 代替）。

---

## 12. 學科授權與發布控制（Sprint 12，2026-10-19）

完整報告：[sprint-12-report-2026-10-19.md](../sprint-12-report-2026-10-19.md)；決策清單：[policy-decisions-2026-10-19.md](./policy-decisions-2026-10-19.md)。

### 12.1 學科授權邊界（`HISTORY_REVIEWER_EMAILS`）

- `teacher`／`admin` 是**平台角色**，不是歷史科學科資格。以下兩個動作需要名單內的帳戶：
  1. `POST /api/teacher/golden/[questionId]` 的任何裁決（Golden fixture 是標準答案的背書）；
  2. `POST /api/teacher/questions/[questionId]/servability` 的 `approve_after_verified_repair`。
- 名單未設定 → **fail-closed**：admin 及教師都不能核准（403），但仍可退回、保留隔離、要求補充證據、標示不可用。
- 名單只做完整電郵比對；不會由 `AUTH_TEACHER_EMAILS`、網域或角色推斷。人選需科組正式指定。

### 12.2 併發與快照的防護

| 情境 | 行為 |
| --- | --- |
| 題目在覆核與更新之間被修改 | 條件式更新 `WHERE revision = ?` → 0 rows → 409，不記錄決定 |
| 批次發布／批次覆核遇到不可作答題目 | 候選清單排除（列入 held），不會中斷整批 |
| 舊練習快照中未作答的題目在題庫被隔離 | 作答回 409；已作答題目仍顯示原本回饋 |
| 資料庫沒有題目資料 | 內容閘門一律 `INSUFFICIENT_EVIDENCE`，整體 `NOT READY` |

### 12.3 仍需決定

見 [policy-decisions-2026-10-19.md](./policy-decisions-2026-10-19.md) 第 9 項：**誰加入 `HISTORY_REVIEWER_EMAILS`**，以及是否需要把科目級角色寫入資料表。在決定前 Golden 核准維持 0。

---

## 13. 唯讀 CLI 與 migration 責任（Sprint 13，2026-10-19）

完整報告：[sprint-13-report-2026-10-19.md](../sprint-13-report-2026-10-19.md)；契約矩陣：[audit-cli-contract-2026-10-19.md](../audit-cli-contract-2026-10-19.md)。

| 指令 | 會否執行 migration | 會否寫 DB | 會否寫檔 |
| --- | --- | --- | --- |
| `audit:*`（content／servability／servability-evidence／review-provenance／repair-provenance／provenance-risk） | 否（`readOnly: true`） | 否 | 報告檔 |
| `golden:candidates`、`golden:eval` | 否 | 否 | 報告檔 |
| `golden:export -- --check` | **否（已修正）** | 否 | **否** |
| `golden:export`（一般） | 否 | 否 | 只寫 `--out` |
| `release:gate` | 否 | 否 | JSON＋MD |
| `db:migrate -- --database <path>` | 是（用途） | 是（只 schema） | 否 |

- 退出碼：audit 工具 0 只代表「報告已產生」；`golden:export` 0／2（INSUFFICIENT_EVIDENCE）／1；`release:gate` 加 `--fail-on-not-ready` 時非 READY → 1。
- 教師端流程（覆核、裁決、Golden）與 Sprint 12 相同；Golden 核准仍需 `HISTORY_REVIEWER_EMAILS`。
- 已知限制：唯讀開啟 WAL 資料庫可能建立 `-shm`／`-wal` sidecar 檔，主資料庫內容不變（測試以雜湊驗證）。

---

## 14. 待裁決工作分流與 Golden 準備度（Sprint 14，2026-10-19）

完整報告：[sprint-14-report-2026-10-19.md](../sprint-14-report-2026-10-19.md)。

### 14.1 97 題工作清單

`npm run audit:adjudication-worklist` → [adjudication-worklist-2026-10-19.md](../quality/adjudication-worklist-2026-10-19.md)

| 分類 | 題數 |
| --- | --- |
| Roman 題：原卷可核對但 i／ii／iii 標示不齊全 | 81 |
| Roman 題：原卷存在但題目／選項陳述不一致 | 10 |
| Roman 題：原卷缺失 | 4 |
| Roman 題：原文段落無法定位 | 1 |
| 答案外洩（`qb-JTH2ndEdFBQ09015`） | 1 |
| **可自動補標示** | **0** |

每題列出：revision／fingerprint、issue code、答案與評分方式、原文位置、缺甚麼證據、既有 review、建議下一步，並標示**必須維持隔離**。清單不是裁決。

### 14.2 Golden 準備度

`npm run audit:golden-readiness` → [golden-readiness-2026-10-19.md](./golden-readiness-2026-10-19.md)

42 個候選的版本／指紋全部與題庫一致、有來源證據及完整答案，但每一題仍缺：**預期 grading、審核理由／類別、錯誤選項說明**（須由歷史科教師提供）。`HISTORY_REVIEWER_EMAILS` 未設定 → 核准維持 0，任何嘗試回 403。

### 14.3 WAL sidecar 政策

只宣稱 **A. Database-content read-only**（schema／資料不變，允許 `-wal`／`-shm`）；**B. Filesystem read-only 未實作**。需負責人決定（政策清單第 12 項）。

---

## 15. 人類覆核流程與覆核 manifest（Sprint 15，2026-10-19）

完整報告：[sprint-15-report-2026-10-19.md](../sprint-15-report-2026-10-19.md)。

### 15.1 623 題覆核 manifest

`npm run audit:review-manifest` → [review-priority-manifest-2026-10-19.md](../quality/review-priority-manifest-2026-10-19.md)

| 指標 | 數量 |
| --- | --- |
| 題目（唯一）／重複列 | 623／0 |
| P1／P3 | 530／93 |
| 與來源待核實重疊 | 124（P1 31、P3 93；不另計為獨立組別） |
| 目前不可作答 | 21 |
| 已有教師逐題裁決 | 0 |

每題附：revision／fingerprint、修復分類及依據、來源狀態與缺失證據、需要核對的答案／可接受答案／空格位置／grading points／grading 語義、必要角色與決定、目前可作答狀態。
P1 與 P3 各有核對清單；**P3 只代表排序較後，不代表核准**；抽樣不等於逐題覆核。

### 15.2 教師裁決流程現況（如實）

- 已有且經測試：`POST /api/teacher/questions/[id]/servability`（退回／保留隔離／要求補充證據／不可用／已修復並核准）、版本＋指紋綁定、409、學科名單 fail-closed、歷史只新增。
- **未完成**：教師端 UI 沒有 servability 裁決介面，也沒有 Golden 核准表單。現階段必須以 API／CLI 操作，並由教師本人以授權電郵登入。這是明確的待辦，不應描述為「流程已完成」。
- Golden 重複提交已改為冪等（同版本／指紋／決定／理由回 `created: false`）。

---

## 16. 教師審核工作台（Sprint 16，2026-10-19）

完整報告：[sprint-16-report-2026-10-19.md](../sprint-16-report-2026-10-19.md)。

### 16.1 新頁面 `/teacher/review`

> 這一節描述 2026-10-19 的初版；**2026-10-20 已簡化**，畫面行為以下方 16.2 為準。

- 三個分批佇列：不可作答（97）、修復 provenance（623，P1 530／P3 93，只作排序）、Golden 候選（42，全部 pending）。
- 佇列由 `GET /api/teacher/review-queue` 提供（教師／管理員可讀、唯讀、每頁 ≤ 25、報告缺失時如實顯示 `available:false`）。
- 單題顯示：ID、版本、指紋、題幹／選項、標準答案、可接受答案、評分方式、評分要點、來源位置及段落、解釋、既有覆核歷史（唯讀）、不可作答原因。
- 裁決表單：五個既有決定（含後果說明）、理由 ≥ 5 字、提交前必須勾選確認；409 會提示重新載入；不預設核准。
- Golden 表單：核准必須提供類別、審核理由、預期 grading、每個錯誤選項說明、權威來源及級別；只有 `approved` 才要求這些欄位；重申裁決不改題目發布狀態。
- **限制**：provenance 佇列只顯示證據契約，沒有逐題裁決 API（需按 manifest 進行後再以覆核／servability 記錄）。

### 16.2 2026-10-20 簡化（回應「介面太複雜」）

原本的兩個操作障礙已經處理，**裁決值與伺服器驗證完全沒有改變**：

| 原本 | 現在 |
| --- | --- |
| 左右兩欄（左清單、右詳情）＋三個技術名稱的分頁 | **單欄**：清單 → 點一題 → 詳情 → 「← 返回題目清單」；分頁改成白話名稱（學生答唔到的題目／要跟進課本依據的題目／評分示例題） |
| 下拉選單列出五個決定 | **三個大按鈕**（要再查證／先收起這題／已修好，可以派），每個寫明「按完會發生甚麼」；其餘兩個收在「其他決定」 |
| 理由必須自己打 ≥ 5 個字 | **六句快速理由**可點選（每句已長於 5 個字），可另加自由補充，提交前顯示「你會提交的決定：…；理由：…」 |
| 提交前另有「我已閱讀…」勾選框 | 移除勾選框（純前端提示）；安全邊界不變：不預設核准、必須有理由、409 不顯示成功、離開前提示未提交內容 |
| `provenance`／`servability`／`fingerprint`／`Golden fixture` 全部印在畫面上 | 這些字眼**不再出現在畫面**；技術資料全部收在「技術資料（一般不需要理會）」 |
| 使用了不存在的 CSS class（`stack`／`row`／`button`／`muted`），實際是無樣式原始表單 | 改用既有設計系統（`.card`／`.btn`／`.chip`／`.badge`），按鈕加大、對比度提高 |

文字集中管理在 [src/lib/review-workbench-labels.ts](../../src/lib/review-workbench-labels.ts)，由 [tests/review-workbench-labels.test.ts](../../tests/review-workbench-labels.test.ts) 守住「每個系統原因都有白話說明」「按鈕值必須是 API 接受的值」「快速理由必須 ≥ 5 字」「畫面文字不出現內部術語」；瀏覽器行為由 [tests/ui/review-workbench.spec.ts](../../tests/ui/review-workbench.spec.ts) 驗證。

**仍需真人教師試用**：按鈕文字與理由句是否貼近校內說法，只能在真實審題時驗證；如果不合用，只需改 `review-workbench-labels.ts`，不需要改動任何裁決邏輯。

## 17. 擁有者授權的批次發布與「待教師確認」解除（2026-10-21）

完整紀錄：[owner-decision-2026-10-21.md](owner-decision-2026-10-21.md)。

擁有者在 2026-10-21 指示「全部發布及套用，不用教師逐題覆核」。以下三支 CLI 是這次用到的工具，
全部**預設模擬（dry-run）**、**拒絕在正式環境執行**、**不建立任何覆核紀錄**：

| 工具 | 用途 | 安全界線 |
| --- | --- | --- |
| `npm run publish:drafts -- --owner-email … --reason … [--apply]` | 批次發布草稿（擁有者授權，繞過「每題都要有目前版本覆核」的關卡） | 不處理 `teacherConfirmationRequired` 或結構不可作答的題目；授權紀錄寫入 [owner-publication-overrides.json](owner-publication-overrides.json) |
| `npm run resolve:teacher-confirmation -- --plan <json> --owner-email … [--apply]` | 依逐題決定解除 `teacher_confirmation_required`（例如原卷多個空格、答案黏連） | 每題必須有理由；必須通過可作答性檢查；答案修正只限「修正匯入黏連」（須同時提供現值與修正值）；判斷邏輯在 [teacher-confirmation-override.ts](../../src/server/services/teacher-confirmation-override.ts)，由 [tests/teacher-confirmation-override.test.ts](../../tests/teacher-confirmation-override.test.ts) 守住 |
| `npx tsx scripts/build-owner-spot-check-sample.ts --count 20` | 產生隨機抽樣題目清單（Markdown + JSON）供擁有者檢查 | 只讀取資料庫；固定種子，可重複得出同一批題目 |

決定檔格式（`resolve:teacher-confirmation`）：

```json
{
  "decidedBy": "you@school.edu.hk",
  "authorization": "擁有者指示原文",
  "items": [
    { "questionId": "qb-…", "reason": "題幹只有一個空格，答案與題幹一致（至少 10 字）" },
    {
      "questionId": "qb-…",
      "reason": "匯入時答案黏連了下一題文字",
      "correctAnswer": { "from": "（現值，必須完全相符）", "to": "（修正值）" }
    }
  ]
}
```

**這些工具不會令題目變成「已覆核」**：解除標記只令題目可以派發給學生，教師端仍標示
「已發布（未經人工覆核）」，`quality_warnings_json` 亦保留原暫緩理由並附上決定紀錄。

### 17.1 擁有者風險接受（2026-10-21 09:59）

擁有者閱覽隨機抽樣 20 題後表示「沒有任何問題」，並決定：1,822 題**不用逐條覆核**、
1,293 題教材依據**不用逐題核對**（兩者都維持全部發布）、技能標籤**繼續空白**。

機器可讀紀錄：[owner-acceptance-2026-10-21.json](owner-acceptance-2026-10-21.json)（決定的完整說明見
[owner-decision-2026-10-21.md](owner-decision-2026-10-21.md) 第 8 節）。

這是**風險接受（accept by sampling）**，不是覆核紀錄：

- `question_reviews` 仍然只有 2 筆；教師端仍標示「已發布（未經人工覆核）」；
- `source_verified` 仍為 0，`audit:content` 仍如實列出 `pending_verification`；
- 發布閘門的 `review-provenance` 及 `source-traceability` 仍然 **FAIL**，`release:gate` 維持 `NOT READY`；
  這是如實狀態，不是待修故障。

界線由 [tests/owner-acceptance-record.test.ts](../../tests/owner-acceptance-record.test.ts) 守住：
紀錄檔必須明示 `reviewRecordsCreated: 0`，文件不得把「樣本沒有問題」寫成「已逐題覆核」。

### 17.2 「需核對課本依據的題目」佇列已清空（2026-10-21）

擁有者指示：「替我根據教材或歷史知識核對題目，不用人手核對課本依據，完成後清空『需核對課本依據的題目』。」

原本的 623 題全部是**自動修復改動過題幹或選項**的題目（530 題補回其餘空格的答案、93 題只移除項目符號）。
處理方式與結果：

| 項目 | 數量 | 說明 |
| --- | --- | --- |
| 來源清單 | 623 | `docs/quality/provenance-risk-2026-10-19.json` |
| 逐題核對並移出佇列 | **602** | 紀錄：[provenance-verification-2026-10-21.json](../../docs/quality/provenance-verification-2026-10-21.json) |
| 已在題庫中不存在 | 21 | 匯入時被合併／刪除，`matchReportToDatabase` 本來就會略過 |
| 仍需教師決定 | 0 | 沒有 `needs-teacher` 的題目 |
| **佇列現況** | **0** | [manifest](../../docs/quality/review-priority-manifest-2026-10-19.md) 仍如實記錄 623→602→0 的過程 |

核對方法分兩類，紀錄中逐題標明：

- **manual-review（530 題）**：逐題閱讀題幹、填回的答案及記錄的答案，對照課本段落及史實判斷；每題都寫**獨立理由**（同一句手寫理由最多可用 6 次，超過即拒絕寫入）。
- **automated-diff（72 題）**：只移除項目符號、全形空白及空格標記，以程式比對「正規化後與原卷完全相同」並記錄 `checks`。

核對時發現並修正的**三處內容錯誤**（工具：[fix-question-content.ts](../../scripts/fix-question-content.ts)，
清單與紀錄：[content-fixes-2026-10-21.json](../../docs/quality/content-fixes-2026-10-21.json)）：

| 題目 | 問題 | 修正 |
| --- | --- | --- |
| `qb-JTH2ndEdFBQ05044` | 題幹「抨擊教會及教士的**腐章運動**」為匯入漏字黏連 | 改為「腐敗」（答案不變：馬丁路德） |
| `qb-JTH2ndEdFBQ09211` | 題幹「被判處**罪**終身監禁」多字 | 改為「被判處終身監禁」（答案不變：種族滅絕） |
| `qb-NJCFN0120000063` | 答案「市政局與區域市政局」，但區域市政局 1986 年才成立，1983 年不可能已舉行首次分區直選 | 答案改為「市政局」 |

**紀錄綁定版本**：每筆核對都寫入當時的 `revision` 及 `fingerprint`。題目日後再被任何方式修改，
該筆紀錄立即失效，題目會**自動重回佇列**（[tests/provenance-verification.test.ts](../../tests/provenance-verification.test.ts) 守住）。
因此「清空」不是永久豁免，而是「這個版本已經核對過」。

**不是教師覆核**：紀錄的 `verifiedBy` 是 `ai-textbook-verification`，`question_reviews` 沒有新增任何一筆；
教師端仍顯示「已發布（未經人工覆核）」，`release:gate` 的 `review-provenance` 仍然 FAIL。
佇列清空只代表「自動修復造成的差異已逐題核對」，不代表題目的歷史準確性已由教師確認。

重做方式：

```powershell
# 1. 匯出待核對批次（唯讀）
npx tsx scripts/verify-provenance-manifest.ts --database <正式快照.db> --export tmp/batches
# 2. 撰寫核對結果（id|理由）後轉成 verdicts JSON，再寫入紀錄
npx tsx scripts/verify-provenance-manifest.ts --database <正式快照.db> --verdicts <verdicts.json> --apply
# 3. 重新產生 manifest（已核對的題目自動移出）
npx tsx scripts/audit-review-priority-manifest.ts --database <正式快照.db>
```

## 18. 全題庫逐題 AI 核對（2026-10-21）

擁有者指示：「題目太多，沒可能做人工覆核。你用教材及網上權威資源查證題目及答案，替我覆核並發布。」

這是平台第一次**對全部題目**（不只是草稿或自動修復過的題目）逐題核對答案。完整紀錄：

- [answer-verification-release-2026-10-21.md](answer-verification-release-2026-10-21.md)（發布、回滾、界線）
- [answer-verification-2026-10-21.md](../quality/answer-verification-2026-10-21.md)（方法、統計、33 題修正）
- [answer-verification-2026-10-21.jsonl](../quality/answer-verification-2026-10-21.jsonl)（逐題結果）
- [answer-verification-2026-10-21-adjudication.json](../quality/answer-verification-2026-10-21-adjudication.json)（校準、誤報裁決、網上資源）

工具（全部預設唯讀或模擬，不會在正式環境執行）：

| 工具 | 用途 |
| --- | --- |
| `node scripts/verify-question-answers.mjs` | 逐題核對；可 `--calibrate` 做「故意改錯答案」的敏感度測試，`--ids` 只重核指定題目 |
| `node scripts/show-question-context.mjs` | 印出題目、教材段落及核對結果，供逐題裁決 |
| `node scripts/search-materials.mjs <字詞>` | 在課文／筆記搜尋依據 |
| `npx tsx scripts/build-answer-verification-plan.ts` | 由裁決檔產生修正清單（補上資料庫現值及指紋） |
| `npx tsx scripts/fix-question-content.ts` | 套用修正；現已支援題幹、選項、標準答案、可接受答案及解釋 |
| `node scripts/build-answer-verification-report.mjs` | 由裁決檔及資料庫重新產生報告 |

結果：2,082 題全部核對（校準 20/20），33 題修正、2 題刪除（平台無法顯示附圖）、3 題模型誤報維持原答案；
修正後 33 題全部重核為正確。26 條原本待教師確認的草稿逐題核對後解除暫緩並發布，
正式題庫 2,080 題全部已發布、0 條待教師確認。

**仍然不是教師覆核**：`question_reviews` 沒有新增（仍為 40 筆），教師端顯示「已發布（未經人工覆核）」，
`release:gate` 的 `review-provenance` 及 `source-traceability` 仍然 FAIL。





## 19. 課題9 的主題按時期拆分（2026-10-22）

用家回報：學生想集中複習第一次世界大戰，但練習設定頁的課題9 只有兩個主題，
其中一個分節混合了一戰、兩戰之間及二戰共 176 題，抽到的題目大部分不是一戰。

原因：練習設定頁的「主題」＝課題下的分節（`sections`），課題9 在 migration 0025
（2026-10-20 擁有者指示「分節對學生而言太瑣碎」）被整合為單一分節。

處理：只拆分課題9（其他課題保持 0025 的整合結果），分為五個主題：

| 主題 | 分節 ID | 移入題目（正式快照，2026-10-22） |
| --- | --- | --- |
| 第一次世界大戰（1914–1918）：背景、經過與結果 | `topic-9-ww1` | 41 |
| 兩次大戰之間（1919–1939）：巴黎和會、經濟大衰退與極權擴張 | `topic-9-interwar` | 66 |
| 第二次世界大戰（1939–1945）：爆發、經過與結果 | `topic-9-ww2` | 22 |
| 兩次世界大戰的關聯與比較（未能歸入單一時期者） | `topic-9-world-wars` | 42 |
| 種族滅絕：二戰期間的「猶太大屠殺」 | `topic-9-holocaust` | 5（該主題另有 31 題既有題目，合計 36） |

工具：`npm run plan:topic-focus -- --topic topic-9`（預設唯讀模擬；`--apply` 需同時提供
`--owner-email`，正式環境拒絕執行）。分類規則在
[topic-focus.ts](../../src/server/quality/topic-focus.ts)，由
[tests/topic-focus.test.ts](../../tests/topic-focus.test.ts) 守住。

- 題目以題幹及教材節錄的關鍵詞判斷時期；題幹沒有關鍵詞時，改看它引用的教材段落
  （只在一題引用的段落全部屬同一時期時採用）。
- 同時命中多個時期而分數相同、或同時提到兩次大戰的題目，一律留在「綜合」主題，不猜測。
- 教材段落按段落文字判斷；沒有關鍵詞的段落沿用同一文件內前一段的時期（標題及短段落）。
- 只改 `section_id`：題目內容、`revision` 及既有覆核紀錄不變。

實際套用紀錄：[topic-9-period-split-2026-10-22.json](topic-9-period-split-2026-10-22.json)
（197 題的分節指派、每題的關鍵詞命中分數及是否屬歧義）。

**未完成的部分**：拆分後「第二次世界大戰：經過與結果」起初只有 22 題、進階／挑戰題為 0，
已於 §19.4 補題（現為 9 基礎／5 進階／5 挑戰選擇題）。其他巨型主題（冷戰、文藝復興與宗教改革）
已於 §19.1 處理；其餘課題的主題界線仍需教師逐一決定。

工具亦提供全課題稽核，用來找出其他「主題過粗」的課題（不需要預先寫好拆分方案）：

```
npm run plan:topic-focus -- --audit --database data/exports/production-hs.db
```

判準預設為「每個主題 ≥ 60 題＝過粗、< 10 題＝過細」，可用 `--threshold`／`--thin` 調整。
2026-10-22 的稽核結果（在正式站快照上）：12 個主題過粗，最大的是課題10「冷戰的主要發展」
（247 題）、課題5「文藝復興與宗教改革」（197 題）、課題9（176 題，已於本節處理）；
另有 6 個主題少於 10 題。其他課題的拆分界線需由歷史科教師逐個決定。

### 19.1 課題5 及課題10 的主題拆分（同日追加）

按同一原則處理稽核結果中最大的兩個主題（教師邊界取自教材本身的章節）：

| 課題 | 來源主題 | 拆分後的主題（移入題目，正式快照） |
| --- | --- | --- |
| 課題5 | 文藝復興與宗教改革（197 題） | 文藝復興 86、宗教改革 28、科學革命與啟蒙運動 25（移回既有分節，該分節共 71 題）、綜合與比較 58 |
| 課題10 | 冷戰的主要發展（247 題） | 展開與初期對抗 82、解凍／危機／緩和 84、再度加劇 21、跨階段比較 60 |

- 課題5 的「科學革命與啟蒙運動」是**跨分節修正**：該分節內原本混入了哥白尼、伽利略、
  社會契約、權力分立等題目，工具按關鍵詞把它們移回既有分節（`create: false`）。
- 兩個課題的「綜合與比較」保留未能確定的題目（例如題幹只寫「＿＿＿時期的藝術家」、
  或引用的教材小節同時包含兩個主題），不猜測，交由教師覆核。
- 套用紀錄：[topic-5-split-2026-10-22.json](topic-5-split-2026-10-22.json)、
  [topic-10-split-2026-10-22.json](topic-10-split-2026-10-22.json)。
- **注意**：本機 `data/app.db` 與正式站快照的題目分佈不同（例如本機的課題10 大部分題目
  仍掛在「冷戰的背景與成因」），因此本機套用後各主題的題數會與上表不同；正式站的數字
  以在正式站快照上執行模擬的結果為準。

### 19.2 課題7、12、6、2 的主題拆分（同日追加）

教師指定按教材本身的章節作分界（而不是按「經濟／政治／宗教」等因素），處理稽核結果中
接下來的四個過粗主題：

| 課題 | 來源主題 | 拆分後的主題（移入題目，正式快照） |
| --- | --- | --- |
| 課題7 | 美國革命的內外因素及影響（123 題，另合併兩個 9 題主題） | 美國革命的背景與經過（1775–1783）33、美國憲法與政治體制 13、十九世紀的美國：領土拓展與南北內戰 70、綜合與比較 25 |
| 課題12 | 第二次世界大戰前的香港（108 題） | 戰前香港的經濟發展 35、戰前華人的崛起及其角色 19、第二次世界大戰前的香港：綜合 54（其餘三個主題不變） |
| 課題6 | 歐洲殖民擴張的原因（97 題） | 早期殖民擴張（十六至十八世紀）22、後期殖民擴張（十九至二十世紀）27、原因：綜合 31、方式及影響 17（移回既有分節，該分節共 67 題） |
| 課題2 | 古典文明的介紹（90 題） | 古希臘文明 22、古羅馬文明 34、古典文明的介紹（概論與綜合）6、中古時代的歐洲 28（移回既有分節，該分節共 39 題）、古典文明的遺產與意義 9（既有） |

- **合併過細主題**：課題7 原本的「十九世紀的美國領土拓展」（9 題）及「南北內戰前後的美國」
  （9 題）各自太細，一輪練習就會重複，因此合併為「十九世紀的美國：領土拓展與南北內戰」。
  工具只會在來源分節已無題目、亦無教材段落時才刪除分節（`removeEmptySectionIds`），
  兩個舊分節在套用後已刪除。
- **跨分節修正**：課題6 的「方式及影響」及課題2 的「中古時代的歐洲」是既有分節
  （`create: false`），工具把錯置於「原因」／「古典文明的介紹」的題目移回，避免重複建立主題。
- 課題2 的「概論與綜合」在拆分後只有 6 題（時期的劃分、早期文明概況），屬過渡性質；已於
  §19.4 補題（現時選擇題 5 基礎／5 進階／5 挑戰）。
- 套用紀錄：[topic-7-split-2026-10-22.json](topic-7-split-2026-10-22.json)、
  [topic-12-split-2026-10-22.json](topic-12-split-2026-10-22.json)、
  [topic-6-split-2026-10-22.json](topic-6-split-2026-10-22.json)、
  [topic-2-split-2026-10-22.json](topic-2-split-2026-10-22.json)。

七個課題（9、5、10、7、12、6、2）的種子資料已同步更新；其餘課題的主題界線仍需教師逐一決定，
工具不會自行猜測。

### 19.3 補題建議（`--topup`）

拆分後每個主題都可以獨立自學，但部分主題題目太少，或進階／挑戰級題目不足（拆分前多數主題
只有 3 題進階及 3 題挑戰，等於一輪練習就抽完）。用以下指令列出每個主題還差多少題：

```
npm run plan:topic-focus -- --topup --database data/exports/production-next-2026-10-22.db
```

預設目標分佈為「每個主題 ≥ 24 題，其中選擇題進階 ≥ 5、挑戰 ≥ 5、填充題 ≥ 8」，可用
`--target`、`--target-advanced`、`--target-challenge`、`--target-fill` 調整。輸出按課題分組，
逐個主題列出需補的題型及數量，並另列完全沒有題目的主題（本機快照曾有 23 個；正式快照沒有
空主題）。

### 19.4 進階／挑戰題補題結果（2026-10-22，正式快照）

按 §19.3 的目標，在**正式快照**（`data/exports/production-next-2026-10-22.db`，即已套用七個
主題拆分的同一份檔案）上以 DeepSeek（`deepseek-flash`）補題：

```
$env:APP_DATABASE_PATH = "data/exports/production-next-2026-10-22.db"
npx tsx --env-file=.env.local scripts/generate-question-bank.ts --count 15 --types mc
```

`--types mc --count 15` 即「每個主題的選擇題目標為基礎 5、進階 5、挑戰 5」，已達標的主題會
略過（不重複生成）。共執行三輪（依序 +386、+63、+9 題），合計新增 **458** 條選擇題，
其中 **439** 條通過自動品質驗證並即時供學生練習，其餘留在草稿待教師覆核（fail-closed）。

| 項目 | 補題前 | 補題後 |
| --- | --- | --- |
| 題目總數 | 2,392 | 2,850 |
| 已發布 | 2,383 | 2,822 |
| 選擇題 進階（已發布） | 193 | 376 |
| 選擇題 挑戰（已發布） | 183 | 377 |
| 選擇題 基礎（已發布） | 1,000 | 1,062 |
| 「每主題 ≥5 進階及 ≥5 挑戰」的主題 | 1／60 | 72／75 |

- 生成題目與教材段落綁定（`blk_*`），因此**必須**在正式快照上生成；本機 `data/app.db` 的
  段落 ID 與正式環境不通用，複製本機題目會令「教材依據」指向不存在的段落。
- 未能達標的主題（如實記錄，全部可重現）：`topic-12`「第二次世界大戰前的香港：綜合」
  （48 基礎／0 進階／5 挑戰）——該分節只保留未能歸入單一主題的題目及少量教材段落，
  生成器連續三輪都無法為它產生進階題（教材不足以支撐）；`topic-10`「冷戰的發展：跨階段比較」
  （6／4／2，22 段）、`topic-12`「戰前華人的崛起及其角色」（8／4／5）。追補方法：教師在
  `/teacher/questions` 手動建立，或先補充該主題的教材段落再重跑同一指令。
- 學生端行為不變：選進階／挑戰時先由題庫出題，題庫不足才即時以教材生成，因此上述 3 個
  主題仍不會出現「沒有題目」的情況。
