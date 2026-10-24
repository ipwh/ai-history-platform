# Sprint 28 — 題目脫敏、伺服器端批改、SQLite／備份加固與歷史科專名同義詞庫

**日期**：2026-10-24
**基準**：`main` = `279dfd8`（部署 revision `history-self-study-00055-s9c`）
**範圍**：P0（防作弊資料脫敏）、P1（SQLite 併發與 GCS 備份）、P2（歷史科專名同義詞庫）

> 本 Sprint 只改動程式碼及文件，**沒有**修改正式資料庫、沒有改動任何教材或題目內容。
> 部署後由啟動還原沿用雲端既有快照（見第五節）。

---

## 1. 背景：檢視時發現的實際缺口

| # | 缺口 | 影響 |
| --- | --- | --- |
| 1 | 學生端題目原本以「從完整題目剔除敏感欄位」的方式產生 | 題目結構日後新增欄位時會靜默外洩；`knowledgePoint`（往往就是標準答案）亦一直傳到瀏覽器 |
| 2 | 沒有獨立的伺服器端批改端點 | 答案核對只能依賴練習流程，其他（自學／單題核對）情境無統一入口 |
| 3 | `GET /api/practice/{sessionId}/result` 在練習完成前可呼叫，並回傳**所有**題目（含未作答）的標準答案與解釋 | 學生可在作答前先讀取回應取得全部答案（防作弊缺口） |
| 4 | SQLite 連線未設定 `synchronous` | WAL 模式下預設 `FULL` 會令每次交易強制 fsync；沒有明確宣告亦令行為取決於編譯預設 |
| 5 | 備份快照寫在主資料庫同目錄，重試為線性退避（`delay × attempt`） | 備份檔與 WAL 争用同一目錄；網絡抖動時重試間隔不足，多個執行個體會同步重試 |

## 2. 改動

### P0：題目脫敏與伺服器端批改

| 檔案 | 改動 |
| --- | --- |
| [src/lib/types.ts](../src/lib/types.ts) | `studentQuestionSchema` 由 `omit(敏感欄位)` 改為 `pick(白名單)`；新增 `studentQuestionFields`。移除 `knowledgePoint`（它往往就是標準答案） |
| [src/lib/student-question.ts](../src/lib/student-question.ts)（新） | 白名單序列化器 `toStudentQuestion` / `toStudentQuestions`、機密欄位清單 `QUESTION_CONFIDENTIAL_FIELDS`、遞迴掃描 `findConfidentialQuestionFields()` |
| [src/server/services/practice-service.ts](../src/server/services/practice-service.ts) | 改用共用序列化器；`getPracticeResult` 只回傳**已作答**題目的回饋；`submitAnswer` 支援多段作答 |
| [src/server/services/quiz-submission-service.ts](../src/server/services/quiz-submission-service.ts)（新） | 批改服務：`{ questionId, studentAnswer }`（可選 `sessionId`）；帶 `sessionId` 時沿用 `submitAnswer`（記錄作答、AI 批改、重複提交不改分），否則以題庫題目作確定性批改（含同義詞庫，不呼叫 AI） |
| [src/app/api/quiz/submit/route.ts](../src/app/api/quiz/submit/route.ts)（新） | `POST /api/quiz/submit`；`requireSignInBeforeBody` + `resolveLearnerId`（已登入時一律以工作階段為準） |

批改端點只接受**已發布課題**中**已發布**、**非待教師覆核**且結構上可作答的題目（與建立練習同一道閘門），避免未發布內容成為取得答案的入口。

### P1：SQLite 併發與 GCS 備份

| 檔案 | 改動 |
| --- | --- |
| [src/server/db/connection.ts](../src/server/db/connection.ts) | 加入 `PRAGMA synchronous = NORMAL`（原有 `journal_mode = WAL`、`busy_timeout = 5000` 保留並補充說明） |
| [src/server/db/backup.ts](../src/server/db/backup.ts) | 快照改以 `VACUUM INTO` 輸出到作業系統暫存目錄（每次備份獨立檔名、備份後刪除、自動清除逾 1 小時的殘留快照）；重試改為**指數退避 + 20% 抖動**（300ms→600ms→1200ms，上限 30 秒，最多 4 次），408／429 重試、其餘 4xx 立即回報；每次重試及最終失敗寫入日誌與備份狀態 |

備份**不會**讀取鎖定中的主資料庫：WAL 模式下主檔案不含最新交易日誌，直接複製會得到過期或損毀的內容，因此一律以單一交易匯出快照後上載。

### P2：歷史科專名同義詞庫

| 檔案 | 改動 |
| --- | --- |
| [src/lib/history-lexicon.ts](../src/lib/history-lexicon.ts)（新） | 232 組專名（課題1–12 及高中），涵蓋時序／重大事件、條約與協定、改革與制度、歷史人物；`normalizeHistoryAnswer()`、`canonicalHistoryTerm()`、`historyTermAliases()`、`historyAnswersMatch()`；另附簡繁字元對照 |
| [src/server/services/grading.ts](../src/server/services/grading.ts) | 逐字比對失敗後以同義詞庫比對（**只限填充題**）；新增 `gradeSubmittedAnswer()` 處理多段作答 |

設計邊界（刻意保守）：

- **有歧義的簡稱不收錄**（例如「新政」可指清末新政或羅斯福新政）。
- 名稱相近但不同事物不會互相匹配（一戰 vs 二戰、拿破崙 vs 拿破崙戰爭、宗教改革 vs 反宗教改革）。
- **選擇題不套用同義詞**：選項互斥，若容許同義詞會令名稱相近但錯誤的選項得分。
- 同義詞表內沒有任何一個寫法同時屬於兩組（測試會檢查）。

## 3. 測試

新增 5 個測試檔：

| 測試檔 | 覆蓋 |
| --- | --- |
| [tests/question-sanitization.test.ts](../tests/question-sanitization.test.ts) | 直接呼叫真實 route handler（`POST /api/practice`、`GET /api/practice/{id}`、`GET .../result`），驗證回應無任何敏感欄位；未作答前結果端點沒有回饋 |
| [tests/quiz-submit.test.ts](../tests/quiz-submit.test.ts) | 批改端點：答對／答錯、同義詞、未發布題目 409、未發布課題 404、空白作答 400、帶練習場境會記錄且重複提交不改分、多段作答 |
| [tests/history-lexicon.test.ts](../tests/history-lexicon.test.ts) | 標準化（空白／標點／全半形／簡體）、同義詞匹配、反例、詞庫一致性（無衝突寫法） |
| [tests/db-connection-pragmas.test.ts](../tests/db-connection-pragmas.test.ts) | `journal_mode=wal`、`busy_timeout=5000`、`synchronous=1`、WAL 檔產生、第二個連線套用相同設定 |
| [tests/db-backup-retry.test.ts](../tests/db-backup-retry.test.ts) | 快照寫入暫存目錄、上載內容為可用 SQLite、殘留快照清理、5xx 指數退避重試、4xx 即時失敗、429 重試 |

既有測試調整（行為**改善**後的期望）：

- `tests/pilot-adversarial.test.ts` D2：簡體答案現由詞庫接受為正確（原本標示不確定）。
- `tests/student-journey-audit.test.ts`：簡體字答案現判為正確（原本被判錯）。
- `tests/teacher-student-flow.test.ts`：結果端點只回已作答題目的回饋。
- `tests/grading.test.ts`、`tests/authz-negative.test.ts`：新增同義詞及新路由的案例（後者把 `POST /api/quiz/submit` 納入路由清單及跨學生負向測試）。

## 4. 驗證（本機實測）

```text
npm run typecheck  通過（next typegen + tsc --noEmit）
npm run lint       0 error（僅 scripts/verify-questionbank-sync.ts 一個既有 warning，非本次改動）
npm test           130 個測試檔、1572 項通過、4 項略過
npm run build      成功；路由表包含 ƒ /api/quiz/submit
```

## 5. 部署（2026-10-24 已執行）

| 項目 | 結果 |
| --- | --- |
| 部署方式 | `scripts/deploy-preserving-config.ps1`（讀取線上現有環境變數 → `gcloud builds submit`），沿用既有 Cloud Run 設定，避免用到 `cloudbuild.yaml` 的空預設值 |
| Cloud Build | `b3b32762-1ca5-4839-86cd-f40b4539c14e`，SUCCESS（3 分 48 秒） |
| 新 revision | `history-self-study-00056-8rx`（前一版 `00055-s9c`），100% 流量 |
| 映像 digest | `sha256:78a6494423a2f6bb98a777b6b7e4fa336b498de16a0500dcba95ee41985ccb55` |
| 資料庫 | 本次**沒有**上載任何本機資料庫；新 revision 啟動時由 `BACKUP_BUCKET` 既有快照還原（`persistence.restore = restored`） |
| `/api/health` | 200；`database = sqlite/ok`、`authEnabled = true`、`staffApiOpen = false`、教材 46 份／26,599 段／學生可見 22 份（與上一版相同） |
| 備份實測 | 新 revision 啟動後完成 1 次備份（`backupsUploaded = 1`、`lastError = null`），確認 `VACUUM INTO` 至暫存目錄的路徑在正式環境可運作 |
| 未登入存取 | `GET /api/topics` → 401、`POST /api/quiz/submit` → 401（符合 `AUTH_REQUIRE_SIGN_IN = true`） |

完整證據：[deployment-evidence-2026-10-24.json](./deployment-evidence-2026-10-24.json)。

## 6. 已知限制（如實說明）

1. 獨立批改端點在每次提交後都會揭示該題答案——與一般自學平台相同，屬設計取捨；端點只限已發布且可作答的題目，亦不提供批量查詢。
2. 同義詞庫是**人工整理的對照表**，不是語意判斷：未收錄的寫法仍會判錯並交由 AI／教師處理；有歧義的寫法刻意不收錄。
3. 多空格題型在現行資料模型（一題一答案）下不會派給學生；`studentAnswer: string[]` 只作介面兼容及逐項比對之用。
4. 簡繁字元對照是**字元對照**而非全文轉換，未收錄的字元維持原樣；最壞情況是判為不匹配，不會把不相關答案判成正確。
