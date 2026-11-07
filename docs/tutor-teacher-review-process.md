# 學伴答案教師覆核流程

## 目的與邊界

學生提問矩陣用於檢查軟體行為及準備教師覆核，不是已核准的 golden answers。`automated-verified` 只表示可由程式檢查的硬閘、課題推斷、回覆深度或短追問行為；它不代表答案在歷史上正確、材料充分或教學適切。歷史內容、教材充分度、教學及語言覆核必須由具資格的人員逐題完成。

本流程不會呼叫模型、不會寫入或遷移資料庫、不會改動矩陣的既有覆核狀態，也不會把任何待覆核項目改成已核准。唯讀套件匯出只供準備工作；必須由教師在獲授權的測試環境安全重現實際回答，才可覆核回答品質。

## 矩陣數量差異

驗收附件要求保留 73 條提問；目前版本控制中的 `TUTOR_STUDENT_QUERY_MATRIX` 實際有 83 條。此變更保留所有現有案例，不刪除任何案例，也不假設多出的 10 條可以丟棄。匯出的套件會逐條保留來源矩陣內容；在矩陣擁有者確認附件的 73 條與目前 83 條的對應關係前，數量驗收仍需標示待確認。

## 準備教師覆核套件

先選用經授權、非正式環境的本機教材資料庫。輸出必須放在版本庫以外，因為套件會包含教材段落節錄：

```powershell
npm run tutor:export-review-packet -- --database "data\app.db" --out "$env:TEMP\tutor-review-packet.json"
```

可用 `--database` 指向另一個核准的本機唯讀資料庫。工具會以 SQLite 唯讀模式載入課程索引，輸出所有矩陣案例、可觀察的程式行為檢查、命中／選入段落及選段稽核摘要；不會連線模型。輸出檔以 `wx` 建立，已存在時會失敗而不覆寫。若資料庫不存在、課程索引為空或輸出路徑位於版本庫內，工具會明確失敗。

若已有受控模型評估記錄（JSON 陣列或 `{ answers: [...] }`，每筆含 `caseId`、`answer`，可另有 `model`、`promptVersion`、`generatedAt`），可加 `--answers <檔案>` 合併入套件：

```powershell
npm run tutor:export-review-packet -- --database "data\app.db" --answers "$env:TEMP\tutor-live-answers.json" --out "$env:TEMP\tutor-review-packet.json"
```

合併只會填入 `actualAnswer` 及 `actualAnswerProvenance`；**不會**改變任何覆核狀態，`review.status` 仍是 `pending-human-review`。套件同時記錄 `promptVersion`（`TUTOR_PROMPT_VERSION`）及 `answersIncluded` 數量。

### 受控評估案例（`liveEvaluationCases`，Sprint 33）

83 條教師矩陣以外，套件另有 `liveEvaluationCases` 一節，收錄 12 條受控評估案例（`tests/fixtures/tutor-live-eval-dataset.ts`）。每條分開四段，**刻意不合併成單一通過狀態**：

| 欄位 | 內容 | 可不可以構成核准 |
| --- | --- | --- |
| `expected` | 計劃時的期望狀態、證據政策、C 信心層級、披露要求、難度、評估重點 | 不可以（只是期望） |
| `deterministic` | 分類器實判狀態、信心層級、深度、檢索狀態、片段數 | 不可以（只證明程式行為） |
| `liveModel` | 實際模型回覆、model、prompt version、產生時間 | 不可以（只證明模型說過甚麼） |
| `teacherDecision` | 歷史科教師裁決（`pending-human-review`／`teacher-approved`／`teacher-rejected`／`requires-revision`） | **只有這一層可以是核准** |

`liveEvaluationAnswersIncluded` 顯示已合併多少條真實回覆。匯出前後須核對 `data/app.db` 的 SHA-256 相同（工具以唯讀模式開啟資料庫）。`deterministic` 與 `liveModel` 不一致時（例如分類器判 C、模型回覆卻明確引用教材段落），必須在 `teacherDecision.notes` 記錄差異，不可自行以其中一層覆蓋另一層。

套件可能含內部教材節錄與檢索分數，應存放於校方核准的受限位置，只向覆核人員提供；不可提交到 Git、貼入公開問題追蹤系統或傳送至未核准的外部服務。覆核完成後按校方資料保留政策刪除工作副本。

## 逐題覆核

匯出套件每條案例現在包含 `answerability`（A 教材支持／B 部分支持／C 一般歷史知識／D 需澄清／out-of-scope）、`recommendedDepth`、`studentLevel` 及 `gateExpectationVsPolicy`（舊硬閘期望與新政策的差異）。這些欄位是**自動判斷**，只供覆核參考，不構成核准。

每條案例均須獨立記錄以下判斷；遇到材料不足或無法安全重現時，保留待覆核並說明原因，不得推定通過。評分細節見 [答案質素評估](tutor-answer-quality-policy.md#7-答案質素評分表教師用)。

| 面向 | 覆核問題 |
| --- | --- |
| 軟體行為 | 硬閘是否正確放行、澄清或拒絕？課題／回覆深度／短追問是否符合可測規格？是否正確處理前文？ |
| 歷史內容 | 年代、人物、事件及因果是否準確？是否修正錯誤前提，並把事實、詮釋與推論分清？是否避免單因論及虛構史學共識？ |
| 材料充分度 | 每個關鍵主張是否有對應教材證據？比較問題的雙方是否都有材料？材料不足時是否清楚披露，而非自行補寫？ |
| 教學適切性 | 是否符合學生程度、提供可理解的引導而非代寫作業，並支援短追問？ |
| 語言品質 | 是否使用清晰、準確的繁體中文書面語；專名是否符合教材用語；混合語言問題是否仍能理解？ |
| 一般歷史知識標示 | 狀態為 C／B 時，答案有沒有清楚標明「校本教材找不到這部分」及「以下屬一般歷史知識」，並避免假稱課本內容？ |

建議使用以下值填寫匯出 JSON 的 `review` 欄位：

- `softwareBehavior`: `pass`、`revise` 或 `pending-human-review`。
- `historicalContentVerified`: `verified`、`needs-correction` 或 `pending-human-review`。
- `materialEvidenceSufficient`: `sufficient`、`partial`、`insufficient` 或 `pending-human-review`。
- `pedagogicallyAppropriate`: `yes`、`revise` 或 `pending-human-review`。
- `languageQualityAccepted`: `yes`、`revise` 或 `pending-human-review`。
- `status`: 只可用下列四個值（Sprint 30 統一）：
  - `pending-human-review`（預設，未經教師決定）；
  - `teacher-approved`（**只有**獲授權的歷史科教師在完成全部適用面向後才可填）；
  - `teacher-rejected`（內容不正確或不可接受）；
  - `requires-revision`（方向可行但需修改）。
- `reviewer` 應使用校方核准的覆核者代碼，不記錄學生身份；`notes` 不得包含不必要的個人資料。

`teacher-approved` 不可由任何自動程序寫入；AI 評估、模型自評或自動測試結果一律不可代替教師決定。

任何一項 `pending-human-review` 都代表尚未核准。歷史內容有疑義、證據不足或回答與材料衝突時，應標示修訂或補證，不得用自動檢查結果抵銷。

## 實際回答與安全驗證

匯出工具的 `actualAnswer` 預設為 `null`，因為工具本身不會發出模型請求。若已透過受控評估取得回覆（見[受控模型評估計劃](tutor-live-evaluation-plan-2026-11-07.md)），可用 `--answers` 合併；合併後仍是 `pending-human-review`，並會記錄模型及提示詞版本。

教師亦應使用獲授權的測試帳戶及核准的測試部署重現問題，檢視完整回答和學生可見的來源呈現；不要使用真實學生帳戶或複製學生個人資料。只有當覆核目的確實需要保留回答時，才可將經最小化處理的回答放入受限套件；不得把完整對話或學生身份寫入一般測試紀錄。

## 選段可觀測性與私隱設計

目前 `TutorPassageSelectionAudit` 是單次請求內的診斷資料，不會持久化或回傳學生端。這次只在教師準備套件中輸出必要的選段結果供離線檢視，沒有新增資料庫 migration 或正式環境寫入。

若日後需要持久化抽樣診斷，實作前須另行完成私隱與保留政策審批。建議只保存隨機事件識別碼、時間桶、經分類的問題類型／閘門結果、課題 ID、段落 ID、分數及受控的選段／排除原因；不保存學生身份、session ID、原始查詢、完整對話或教材全文。若需要跨請求關聯，應以輪替的有期限假名化識別碼取代帳戶 ID，並先評估重新識別風險。

持久化設計至少要包含：只限指定覆核人員及管理員的角色存取、存取記錄、傳輸與靜態加密、到期刪除及備份到期處理。可先以分層抽樣覆蓋課題、語言、硬閘及零命中情形，並限制每一使用者的採樣率；在沒有容量資料前不作無限制收集。暫定保存期可先按 90 日估算，再由校方資料負責人核准或調整；以實際事件量乘上最小欄位大小估算儲存成本。以上均是後續設計建議，並非本次已部署的持久化機制。
