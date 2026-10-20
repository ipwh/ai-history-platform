# Sprint 19 — CI 瀏覽器測試整合與發布證據重新驗證（2026-10-19）

## 1. Git 狀態

| 時點 | 分支 | HEAD | origin/main | 未提交項目 |
| --- | --- | --- | --- | --- |
| 開始 | `main` | `6895db9` | `6895db9` | 105（28 modified + 77 untracked） |
| 結束 | `main` | `6895db9` | `6895db9` | 見 §2（原有 105 項全部保留，另加 Sprint 19 檔案） |

未執行 `git reset`／`clean`／`checkout --`／`restore`；未 commit、未 push、未部署。

## 2. 變更檔案及原因

| 檔案 | 類型 | 原因 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | 新增 | 建立 CI：`verify` job（`npm test`／`typecheck`／`lint`／`build`，GitHub 託管 runner 可完整執行）；`ui-tests` job（Playwright，只在具備內容資料庫的 self-hosted runner 及 `workflow_dispatch` 明確要求時執行，缺少 `data/app.db` 時 fail closed） |
| `tests/ui/run-server.mjs` | 修改 | 資料庫快照改為 **唯讀連線 + `VACUUM INTO`**（原本複製 `app.db`＋`-wal`＋`-shm` 有競態）；快照後驗證來源大小不變及 `PRAGMA integrity_check = ok`；缺少內容資料庫時**明確失敗並說明原因**（不以空資料庫代替）；新增 `UI_TEST_SOURCE_DB` 供 self-hosted runner 指定快照路徑 |
| `docs/sprint-19-report-2026-10-19.md` | 新增 | 本報告 |

未新增任何 npm 依賴（沿用 Sprint 18 的 `@playwright/test`）。

## 3. CI 內容與實際執行情況

`.github/workflows/ci.yml`：

- 觸發：`push`（main）、`pull_request`、`workflow_dispatch`
- `permissions: contents: read`、`concurrency` 取消同分支重複執行、`NEXT_TELEMETRY_DISABLED=1`
- `verify` job：`npm ci` → `npm test` → `npm run typecheck` → `npm run lint` → `npm run build`
- `ui-tests` job：`npm ci` → 檢查 `data/app.db` 存在（否則 `::error::` 並失敗，不以空資料庫代替）→ `npx playwright install --with-deps chromium` → `npm run build` → `npm run test:ui` → 失敗時上載 `test-results/`

**未在 GitHub Actions 實際執行**（本機沒有 runner、沒有 GitHub 連線）：屬 `UNVERIFIED`。上述每個命令都已在本機以相同順序單獨執行（見 §4）。

**已知阻塞（如實記錄）**：`data/` 與 `materials/*` 依版權政策列入 `.gitignore`，GitHub 託管 runner 沒有內容資料庫；瀏覽器測試需要真實或經核准的內容快照，因此 `ui-tests` 需 self-hosted runner。這是政策限制，不是可以用空資料庫繞過的技術問題。

## 4. 本次實際執行的檢查（全部為本 Sprint 新鮮結果）

| 命令 | 退出碼 | 結果 |
| --- | --- | --- |
| `npm test` | 0 | 92 files、**1,235 passed**、4 skipped |
| `npm run typecheck` | 0 | 通過 |
| `npm run lint` | 0 | 通過 |
| `npm run build` | 0 | 通過 |
| `npm run test:ui`（=`npx playwright test`） | 0 | **13 passed**、0 failed、0 skipped |
| `node scripts/e2e-flow.mjs --start`（暫存資料庫＋複製 uploads，`GOOGLE_CLIENT_ID=' '`） | 0 | **128 項通過、0 項失敗** |
| `audit:servability` | 0 | 97 題待裁決（`teacher_review_required: 97`） |
| `audit:servability-evidence` | 0 | 核對 96：`labels_missing_in_source` 81、`statement_count_mismatch` 10、`source_file_missing` 4、`source_block_not_found` 1 |
| `audit:provenance-risk` | 0 | P0 0／P1 530／P2 0／P3 93 |
| `audit:review-manifest` | 0 | 623 題只有自動修復證據；0 題教師逐題裁決 |
| `audit:golden-readiness` | 0 | 42 候選、0 approved；`reviewerAllowlistConfigured false`（見 §7 發現） |
| `audit:source-crosswalk` | 0 | 交叉分析輸出（623 × 1,003） |
| `audit:adjudication-worklist` | 0 | 97 題工作清單（5 個類別） |
| `npm run golden:eval` | 0 | `INSUFFICIENT_EVIDENCE`（fixtures 0） |
| `npm run release:gate` | 0 | **NOT READY**（15 個 gate，狀態與 Sprint 18 完全相同） |

所有 `audit:*` 及 `golden:eval` 皆使用唯讀資料庫模式，只寫入 `docs/quality/*`、`docs/teacher-review/*` 報告檔，沒有修改題目、覆核紀錄或發布狀態。

## 5. 資料庫與檔案系統隔離證據

- **快照一致性**：`VACUUM INTO` 由唯讀連線產生單檔快照；實測 `data/app.db` 位元組在操作前後**完全相同**、快照 `PRAGMA integrity_check = ok`、`questions` 1,880 筆、**沒有** `-wal`／`-shm` sidecar 伴隨快照檔。原本「複製主檔＋`-wal`＋`-shm`」在 WAL 正在寫入時可能得到不一致複本，已移除。
- **隔離範圍**：`APP_DATABASE_PATH`／`APP_UPLOADS_DIR`／`APP_MATERIALS_DIR` 全部指向 `%TEMP%\ai-history-ui-test`（每次執行前重建）；`data/` 只被讀取並複製、`materials/` 只建立空目錄；E2E 使用 `%TEMP%\e2e-s19` 及其 `uploads` 副本。
- **伺服器**：`reuseExistingServer: false`，固定埠 3100，`workers: 1`（維持單 worker）。Playwright 於 `webServer.url` 就緒後才執行測試；伺服器由 `run-server.mjs` 啟動並在收到 `SIGINT`／`SIGTERM` 時轉發給子程序。
- **準備失敗即中止**：環境準備（快照／integrity／cookie）任何一步失敗會以非零退出碼結束，不會帶著半完成狀態啟動伺服器。
- **登入契約一致**：測試 cookie 由應用程式自身的 `encodeSession` 簽署（同一 `AUTH_SECRET`、同一 HMAC 與 `exp` 契約），伺服器端以 `decodeSession` + `revalidateSessionUser` 驗證；因此角色降權、名單移除等行為在測試中與正式一致。

## 6. 無障礙驗證結果與限制

Sprint 18 的修正全部保留並由瀏覽器測試覆蓋：錯誤區 `role="alert"`＋`tabIndex={-1}`＋callback ref 聚焦（含 409 重載後）、`aria-invalid`／`aria-describedby`、佇列錯誤 `alert`／成功 `status`、切換佇列／頁碼／題目前確認未提交內容、Golden 決定不預選核准。

**未引入 axe 或任何自動無障礙掃描**：本 Sprint 未新增依賴（§1.7），且現有 Playwright 設定無 axe 整合；因此**沒有**任何「符合 WCAG」的聲明。

仍需人工驗證（未執行）：螢幕閱讀器（NVDA／VoiceOver）實際播報內容與順序、純鍵盤完整操作路徑（Tab／Shift+Tab 循環、Esc 行為）、放大 200%／窄視窗、真實教師可用性測試。

## 7. Release gate 矩陣（本次重新執行，與 Sprint 18 對照）

| Gate | Sprint 18 | Sprint 19（本次） | 證據變化 |
| --- | --- | --- | --- |
| question-isolation | PASS | PASS | 無（0／1880） |
| question-servability | FAIL | **FAIL** | 無（97／1880） |
| answer-provenance | PASS | PASS | 無（0／18） |
| source-traceability | POLICY_PENDING | POLICY_PENDING | 無（877／1880，待核實 1,003） |
| explanation-quality | POLICY_PENDING | POLICY_PENDING | 無（1,334／546） |
| metadata | POLICY_PENDING | POLICY_PENDING | 無（1,880 技能空白） |
| teacher-decisions | PASS | PASS | 無 |
| review-provenance | POLICY_PENDING | POLICY_PENDING | 無（623） |
| copyright | WARN | WARN | 無（12／36） |
| golden-evaluation | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE | 無（fixtures 0） |
| servability-adjudication | POLICY_PENDING | POLICY_PENDING | 無（97 待裁決、0 裁決） |
| provenance-risk | POLICY_PENDING | POLICY_PENDING | 無（P1 530／P3 93） |
| golden-approval | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE | 無（0／42） |
| tests | PASS | PASS | 重新執行（1,235 passed、13 UI、128 E2E） |
| deployment | INSUFFICIENT_EVIDENCE | INSUFFICIENT_EVIDENCE | 無 |

**結論：`NOT READY` 不變，沒有任何 gate 因加入 CI 或重新執行測試而改變。** 加入 CI 與瀏覽器測試只影響 `tests` gate 的可信度，不影響內容、版權、政策或部署阻塞。

### 本 Sprint 的發現（未修正，需負責人決定）

`audit:golden-readiness` 回報 `reviewerAllowlistConfigured false`，而 `.env.local` 已於 Sprint 18 設定 `HISTORY_REVIEWER_EMAILS`。原因：`tsx` 執行的 CLI 不會載入 Next 的 `.env.local`，只有應用程式執行時會。影響：CLI 產生的證據會顯示「未設定名單」，與應用程式實際行為不一致。**未修改**，因為讓 CLI 自動載入 `.env.local` 會令工具讀取含密鑰的環境檔，屬安全性決定。建議列為後續工作（例如為 CLI 提供明確的 `--env-file` opt-in）。

## 8. 仍未解決的治理決策（需要真人證據）

1. 97 題不可作答題目（96 Roman numeral + `qb-JTH2ndEdFBQ09015`）的教師裁決。
2. 623 題 provenance 風險（P1 530／P3 93）的覆核政策。
3. 1,003 題來源待核實的安排。
4. 1,334 題佔位解釋及 546 題只列答案的標準。
5. 1,880 題技能標籤缺失的政策。
6. 材料版權證據 12/36 的其餘 24 份。
7. Golden Dataset 42 候選的教師核准（0 approved）。
8. staging／production 的 `HISTORY_REVIEWER_EMAILS`（本機設定不代表正式授權）。
9. deployment 驗收證據、`export-production-snapshot`／`pilot-deepseek` 驗證、WAL sidecar 政策 B 是否採納、multi-instance SQLite 適用性。

本 Sprint 沒有核准、發布、清除隔離、改寫任何覆核紀錄或時間戳／指紋。

## 9. 未執行項目及原因

| 項目 | 原因 |
| --- | --- |
| GitHub Actions 實際執行 | 本機無 runner／無 GitHub 連線；workflow 語法未經 Actions 解析器驗證 |
| `ui-tests` job 在 GitHub 託管 runner 執行 | `data/` 依版權政策不入版本控制，託管 runner 無內容資料庫；不以空資料庫代替 |
| axe／自動無障礙掃描 | 需新增依賴，Sprint 19 明確不新增依賴 |
| 螢幕閱讀器／鍵盤人工測試 | 需真人操作，未執行 |
| 正式資料庫、migration、部署 | 明確禁止 |
| `export-production-snapshot`、`pilot-deepseek` | 仍 `UNVERIFIED`（Sprint 14 起） |

## 10. 安全性聲明

本次沒有：存取或修改正式資料庫、執行任何 migration、呼叫付費 AI 服務、建立假教師／假核准／假 Golden fixture、修改 `HISTORY_REVIEWER_EMAILS` 的 staging／production 設定、實作 provenance 寫入 API／schema／migration、commit、push 或部署。所有測試身分只存在於 `%TEMP%` 的瀏覽器測試環境變數中。

## 11. 追補：2026-10-19 晚間依負責人指示的題目資料變更

負責人對不可作答題目逐項作出決定，以下為**實際執行**的變更（每步都有備份及前後稽核）：

| 步驟 | 內容 | 結果 |
| --- | --- | --- |
| 1 | 修正 4 題來源檔名（資料庫記錄多一個底線，原卷實際存在） | `source_file_missing` 4 → **0** |
| 2 | 硬刪除 `qb-NJCMN0020000002`（原卷無法定位；負責人指示刪除） | 連帶刪除 3 筆覆核紀錄 |
| 3 | 套用 93 題「只插入羅馬數字編號」 | 字詞未改，revision +1 |
| 4 | 硬刪除 `qb-JTH2ndEdMCQ10144`、`qb-NJCMN0060000039` | 連帶刪除 4 筆覆核紀錄 |
| 5 | 由原始試題檔還原 5 題的陳述分行及編號（文字逐字取自 `.docx`） | 5 題通過結構檢查 |

### 前後對照

| 指標 | 變更前 | 變更後 |
| --- | --- | --- |
| 題目總數 | 1,880 | **1,877** |
| 已發布但不可作答 | 97 | **3** |
| `question-servability` | FAIL（97／1880） | **FAIL（3／1877）** |
| `review-provenance` | POLICY_PENDING | **FAIL（602／1877；完全沒有證據 93）** |
| 教師逐題裁決 | 0 | **0**（未代簽任何裁決） |

### 必須如實指出的兩個後果

1. **`review-provenance` 由 POLICY_PENDING 變成 FAIL**：93 題 revision 因補號 +1，先前覆核紀錄不再對應新版本，因此被正確視為沒有證據。這是修改題目內容的必然代價，不可抹平。
2. **題目已可派發**：1877 題為 `published` 且 `teacher_confirmation_required = 0`；派發條件為 `published && !teacherConfirmationRequired && checkQuestionServable().ok`。補號後除 3 題外，其餘題目**已可供學生作答**。與負責人「全數發布」的指示一致，但**沒有任何教師裁決紀錄**支持，屬已知治理缺口。

### 未執行（明確拒絕）

- 沒有代任何帳戶簽署裁決、沒有建立 lookalike 教師紀錄、沒有改寫歷史時間戳或指紋。
- `qb-JTH2ndEdMCQ10099`、`qb-NJCMN0060000045` 的題幹與原卷不一致（原卷問的是另一組陳述），未自動補號。
- `qb-JTH2ndEdFBQ09015`（填充題答案外洩）需改寫題幹，未自行改寫。

### 驗證（本次新鮮結果）

`npm test` 92 files／1,235 passed／4 skipped；`npm run typecheck` 0；`npm run lint` 0（0 warnings）；`npm run build` 0；`npm run test:ui` **12 passed／1 skipped**（分頁測試因佇列只剩 3 題正確 skip）；`npm run release:gate` → **NOT READY**。


### ???16:57??????????????

| ?? | ?? | ?? |
| --- | --- | --- |
| `qb-NJCMN0060000045` | ???????????? | ????? 3 ????? |
| `qb-JTH2ndEdMCQ10099` | ?????????? | ????? 1 ????? |
| `qb-JTH2ndEdFBQ09015` | ?????????????????????????? | ????revision 6 ? 7 |

??? `answerLeaksIntoStem` ? `true` ? `false`????? 1,875?

### ?? release gate????????

```
NOT READY
PASS                   question-isolation?0?1875?
PASS                   question-servability?0?1875?      ? ? FAIL ? PASS
PASS                   answer-provenance?0?18?
POLICY_PENDING         source-traceability?877?1875???? 998?
POLICY_PENDING         explanation-quality??? 1329????? 546?
POLICY_PENDING         metadata????? 1875?
PASS                   teacher-decisions?0???
FAIL                   review-provenance??????? 92?  ? ? POLICY_PENDING ? FAIL
WARN                   copyright?12?36?
INSUFFICIENT_EVIDENCE  golden-evaluation?0?0?
PASS                   servability-adjudication?0?0?     ? ? POLICY_PENDING ? PASS
POLICY_PENDING         provenance-risk?P1 530?P3 93?
INSUFFICIENT_EVIDENCE  golden-approval?0?42?
PASS                   tests?0?24?
INSUFFICIENT_EVIDENCE  deployment?????
```

**????????????**?`question-servability` ? `servability-adjudication` ????????? PASS?`review-provenance` ? revision ?????????? FAIL?

## 12. 正式環境部署記錄（2026-10-19，負責人明確授權）

> **2026-10-20 更正（目標專案錯誤）**：本節的 `gcloud builds submit` 及 `gcloud run services update`
> 指令**沒有**帶 `--project`，而本機 `gcloud config` 的預設專案是當時仍在使用的
> `amiable-nirvana-500300-a0`，因此 revision `00027`–`00029` 及 1,875 題新題庫的還原
> **實際落在舊專案的服務**，不是對外的正式服務 `pccss-ai-history`
> （`https://history-self-study-4sija7xvrq-df.a.run.app` 當時仍是舊版本，缺 `/teacher/review`
> 及 `/api/teacher/golden`）。舊專案 `amiable-nirvana-500300-a0` 其後已停用；現行部署一律要帶
> `--project pccss-ai-history`（見根目錄 README 第十節）。

### 授權依據

負責人書面確認接受下列後果後執行：**刪除正式獨有 400 題、改寫題幹、作答紀錄孤立**。

### 執行前實測差異（唯讀下載 bucket 快照比對）

| 項目 | 正式（部署前） | 本機 |
| --- | --- | --- |
| 題目 | 473（`qb-` 116／`demo-` 49／雜湊 308） | 1,875（全 `qb-`） |
| 共同題目 | 73（其中 11 題題幹不同） | — |
| 只在正式 | 400 | — |
| migration | 0020 | 0022 |
| 學習者 | 34 | 34（**完全重疊**） |
| 作答／練習 | 140／92 | 162／83 |

### 已執行步驟

1. **備份**：`gs://…-history-backup/history/data/app.db.pre-s19-20261019T0915Z`（4,866,048 bytes）。
2. **匯出**：`npm run snapshot:production`（`VACUUM INTO`＋完整性檢查 `ok`；清除教材開放狀態 12→0、`distribution_audit` 78→0）。
3. **建置及部署**：`gcloud builds submit --config cloudbuild.yaml`，build `b2696420-…`，映像 `hk-history-self-study:b2696420-…`，revision `00027`。substitutions 全部沿用線上現有值（admin、84 位教師、roster sheet、backup bucket、執行身分 `history-run@…`），避免用到 YAML 內的空預設值。
4. **上載新快照**：`data/exports/app.db`（13,107,200 bytes → bucket）。
5. **觸發還原**：revision `00028`、`00029`（`--update-env-vars=APP_BUILD_ID`）。

### 遇到的競態（已解決並驗證）

第一次觸發（00028）時，容器在快照上載完成前已還原**舊**資料（日誌：`已由雲端還原（4752 KB）`）。再次觸發後，線上實例於 09:25:23 自行上載 **12,490,496 bytes** 備份（`backupsUploaded: 1`），證明執行中資料庫已是新題庫。

### 部署後驗證（由執行中容器自行上載的快照下載核對）

```
questions: 1875 / published: 1875 / learners: 34 / attempts: 162
question_reviews: 3157 / migrations: 22 / integrity_check: ok
```

`/api/health` → `200`，`persistence: {"backupEnabled":true,"lastSuccessAt":"2026-10-19T09:25:23Z","backupsUploaded":1,"restore":"restored"}`。

### 如實記錄的代價

- 正式獨有的 400 題（含 49 題 `demo-*`）已不存在。
- 原正式的 15 筆作答、17 次練習紀錄被本機資料取代。
- 歷史練習紀錄仍可顯示：83 次練習全部存放 `question_snapshot_json`；但 `attempts.question_id` 有 157 筆指向不存在題目（歷史回饋可讀，按課題統計錯題的 INNER JOIN 會略過這些紀錄）。
- 正式環境先前 58 題不可作答（57 已發布）的問題，隨題庫替換一併消失。

### 回滾

```
gcloud storage cp gs://amiable-nirvana-500300-a0-history-backup/history/data/app.db.pre-s19-20261019T0915Z \
  gs://amiable-nirvana-500300-a0-history-backup/history/data/app.db
gcloud run services update history-self-study --region=asia-east2 --update-env-vars=APP_BUILD_ID=rollback-<時間>
```
